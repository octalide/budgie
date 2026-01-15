import { clamp, asInt } from './utils.js';

export const GRID_MIN_COL_WIDTH = 160;
export const GRID_ROW_RATIO = 0.7;
export const GRID_ROW_MIN = 72;
export const GRID_ROW_MAX = 148;
export const GRID_HEIGHT_MIN = 480;
export const GRID_GAP = 12;
export const GRID_MIN_COLS = 4;
export const GRID_MAX_COLS = 12;

export const SIZE_GRID = {
  sm: { w: 3, h: 3 },
  md: { w: 4, h: 4 },
  lg: { w: 6, h: 6 },
};

export const DASHBOARD_LAYOUT_VERSION = 3;

let widgetSeq = 0;

export function newWidgetId(prefix) {
  widgetSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${widgetSeq.toString(36)}`;
}

const getDef = (widgetDefs, type) => (widgetDefs ? widgetDefs[type] : null);

export function normalizeLayout(raw, widgetDefs) {
  if (raw && raw.version === DASHBOARD_LAYOUT_VERSION && Array.isArray(raw.widgets)) {
    const widgets = normalizeWidgets(raw.widgets, widgetDefs);
    if (widgets.length) return { version: DASHBOARD_LAYOUT_VERSION, widgets: assignWidgetPositions(widgets) };
  }
  if (raw && raw.version === 2 && Array.isArray(raw.widgets)) {
    const widgets = normalizeWidgets(raw.widgets, widgetDefs);
    if (widgets.length) return { version: DASHBOARD_LAYOUT_VERSION, widgets: assignWidgetPositions(widgets) };
  }
  if (raw && typeof raw === 'object' && raw.positions) {
    return migrateLegacyLayout(raw, widgetDefs);
  }
  return createDefaultLayout(widgetDefs);
}

export function normalizeWidgets(widgets, widgetDefs) {
  const out = [];
  const seen = new Set();
  for (const w of widgets || []) {
    const inst = normalizeWidgetInstance(w, widgetDefs);
    if (!inst) continue;
    if (seen.has(inst.id)) inst.id = newWidgetId(inst.type);
    seen.add(inst.id);
    out.push(inst);
  }
  return out;
}

export function normalizeWidgetInstance(raw, widgetDefs) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim();
  const def = getDef(widgetDefs, type);
  if (!def) return null;
  const id = raw.id ? String(raw.id) : newWidgetId(type);
  const size = typeof raw.size === 'string' && raw.size ? raw.size : def.defaultSize;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : def.title;
  const dims = SIZE_GRID[size] || SIZE_GRID[def.defaultSize] || { w: 4, h: 4 };
  const minW = def.minW || 2;
  const minH = def.minH || 2;
  const w = clamp(asInt(raw.w, dims.w), minW, 99);
  const h = clamp(asInt(raw.h, dims.h), minH, 99);
  const x = Number.isFinite(raw.x) ? Math.max(0, Math.floor(raw.x)) : null;
  const y = Number.isFinite(raw.y) ? Math.max(0, Math.floor(raw.y)) : null;
  const config = {
    ...def.defaultConfig,
    ...(raw.config && typeof raw.config === 'object' ? raw.config : {}),
  };
  if (type === 'projection' && config.showLiabilities === undefined && config.includeLiabilities !== undefined) {
    config.showLiabilities = Boolean(config.includeLiabilities);
  }
  return { id, type, size, title, config, x, y, w, h };
}

export function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

export function findNextSpot(widget, placed, cols) {
  const w = clamp(widget.w, 1, cols);
  const h = Math.max(1, widget.h);
  let y = 0;
  while (y < 500) {
    for (let x = 0; x <= cols - w; x += 1) {
      const candidate = { x, y, w, h };
      const hit = placed.some((p) => rectsOverlap(candidate, p));
      if (!hit) return { x, y };
    }
    y += 1;
  }
  return { x: 0, y: y };
}

export function assignWidgetPositions(widgets, cols = GRID_MAX_COLS) {
  const placed = [];
  for (const widget of widgets) {
    if (!Number.isFinite(widget.x) || !Number.isFinite(widget.y)) {
      const pos = findNextSpot(widget, placed, cols);
      widget.x = pos.x;
      widget.y = pos.y;
    }
    placed.push({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
  }
  return widgets;
}

export function migrateLegacyLayout(raw, widgetDefs) {
  const positions = raw.positions || {};
  const posToWidget = {};
  for (const [widget, pos] of Object.entries(positions)) {
    if (getDef(widgetDefs, widget)) posToWidget[pos] = widget;
  }
  const order = ['left-top', 'right', 'left-bottom'];
  const fallback = ['upcoming', 'projection', 'snapshot'];
  const widgets = order
    .map((pos, idx) => posToWidget[pos] || fallback[idx])
    .filter((type) => getDef(widgetDefs, type))
    .map((type) => {
      const def = getDef(widgetDefs, type);
      const dims = SIZE_GRID[def.defaultSize] || { w: 4, h: 4 };
      return {
        id: newWidgetId(type),
        type,
        size: def.defaultSize,
        title: def.title,
        config: { ...def.defaultConfig },
        x: null,
        y: null,
        w: dims.w,
        h: dims.h,
      };
    });
  return { version: DASHBOARD_LAYOUT_VERSION, widgets: assignWidgetPositions(widgets) };
}

export function createDefaultLayout(widgetDefs) {
  const defaults = [
    { type: 'upcoming', size: 'md' },
    { type: 'snapshot', size: 'md' },
    { type: 'projection', size: 'lg' },
  ];
  const widgets = defaults
    .map((entry) => {
      const def = getDef(widgetDefs, entry.type);
      if (!def) return null;
      const size = entry.size || def.defaultSize;
      const dims = SIZE_GRID[size] || SIZE_GRID[def.defaultSize] || { w: 4, h: 4 };
      return {
        id: newWidgetId(entry.type),
        type: entry.type,
        size,
        title: def.title,
        config: { ...def.defaultConfig },
        x: null,
        y: null,
        w: dims.w,
        h: dims.h,
      };
    })
    .filter(Boolean);
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: assignWidgetPositions(widgets),
  };
}
