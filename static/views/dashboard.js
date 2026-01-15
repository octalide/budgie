import { $, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { activeNav, showModal } from '../js/ui.js';
import {
  GRID_MIN_COL_WIDTH,
  GRID_ROW_RATIO,
  GRID_ROW_MIN,
  GRID_ROW_MAX,
  GRID_HEIGHT_MIN,
  GRID_GAP,
  GRID_MIN_COLS,
  GRID_MAX_COLS,
  SIZE_GRID,
  DASHBOARD_LAYOUT_VERSION,
  newWidgetId,
  normalizeLayout,
  normalizeWidgets,
  findNextSpot,
  assignWidgetPositions,
  rectsOverlap,
} from './dashboard/layout.js';
import { createDashboardContext } from './dashboard/context.js';
import { widgetSettingsForm } from './dashboard/settings.js';
import { createWidgetDefinitions } from './dashboard/widgets/index.js';
import { addYearsISO, clamp, asInt } from './dashboard/utils.js';

const WIDGET_DEFS = createWidgetDefinitions();

export async function viewDashboard() {
  activeNav('dashboard');

  const asOf = isoToday();
  const rangeFrom = asOf;
  const rangeTo = addYearsISO(asOf, 1);
  const accountsRes = await api('/api/accounts');
  const accounts = accountsRes.data || [];
  const context = createDashboardContext(asOf, accounts, { from: rangeFrom, to: rangeTo });

  let layout = normalizeLayout(null, WIDGET_DEFS);
  try {
    const layoutRes = await api('/api/dashboard/layout');
    layout = normalizeLayout(layoutRes?.data?.layout, WIDGET_DEFS);
  } catch {
    layout = normalizeLayout(null, WIDGET_DEFS);
  }

  $('#page').innerHTML = `
    <div class="dashboard" id="dashboard_root">
      <div class="dash-header">
        <div>
          <div class="dash-title">Dashboard</div>
          <div class="dash-subtitle">as-of ${escapeHtml(rangeFrom)} • lookahead to ${escapeHtml(rangeTo)}</div>
        </div>
        <div class="dash-actions">
          <div class="dash-range">
            <input id="dash_from" value="${escapeHtml(rangeFrom)}" />
            <span>→</span>
            <input id="dash_to" value="${escapeHtml(rangeTo)}" />
            <button id="dash_apply" type="button">Apply</button>
          </div>
          <button id="dash_add" type="button">Add widget</button>
          <button id="dash_edit" type="button">Edit layout</button>
          <button id="dash_reset" type="button">Reset</button>
        </div>
      </div>
      <div class="dash-grid" id="dash_grid"></div>
    </div>
  `;

  const root = $('#dashboard_root');
  const grid = $('#dash_grid');
  const controllers = new Map();
  const gridState = {
    cols: GRID_MAX_COLS,
    colWidth: GRID_MIN_COL_WIDTH,
    rowHeight: GRID_ROW_MIN,
    gap: GRID_GAP,
  };
  let editMode = false;
  let activeAction = null;
  let resizeRaf = null;

  const saveLayout = async () => {
    try {
      await api('/api/dashboard/layout', {
        method: 'PUT',
        body: JSON.stringify({ layout }),
      });
    } catch {
      // ignore layout save errors
    }
  };

  context.updateWidgetConfig = (id, patch) => {
    const instance = layout.widgets.find((w) => w.id === id);
    if (!instance) return;
    const base = instance.config && typeof instance.config === 'object' ? instance.config : {};
    const next = typeof patch === 'function' ? patch({ ...base }) : { ...base, ...(patch || {}) };
    instance.config = next;
    saveLayout();
  };

  const getConstraints = (instance) => {
    const def = WIDGET_DEFS[instance.type];
    return {
      minW: def?.minW || 2,
      minH: def?.minH || 2,
    };
  };

  const computeGridMetrics = () => {
    if (!grid) return;
    const width = grid.clientWidth || 0;
    const colsRaw = Math.floor((width + GRID_GAP) / (GRID_MIN_COL_WIDTH + GRID_GAP));
    const cols = clamp(colsRaw, GRID_MIN_COLS, GRID_MAX_COLS);
    const colWidth = Math.max(80, Math.floor((width - GRID_GAP * (cols - 1)) / cols));
    const baseRow = Math.round(colWidth * GRID_ROW_RATIO);
    let rowHeight = clamp(Math.round(baseRow / 4) * 4, GRID_ROW_MIN, GRID_ROW_MAX);
    const header = root?.querySelector('.dash-header');
    const available = Math.max(GRID_HEIGHT_MIN, (root?.clientHeight || 0) - (header?.offsetHeight || 0) - GRID_GAP);
    if (available > 0) {
      const targetRows = clamp(Math.round(available / (rowHeight + GRID_GAP)), 6, 16);
      const fitRow = Math.floor((available - GRID_GAP * (targetRows - 1)) / targetRows);
      rowHeight = clamp(Math.round(fitRow / 4) * 4, GRID_ROW_MIN, GRID_ROW_MAX);
    }
    gridState.cols = cols;
    gridState.colWidth = colWidth;
    gridState.rowHeight = rowHeight;
    gridState.gap = GRID_GAP;
    grid.style.setProperty('--grid-col-width', `${colWidth}px`);
    grid.style.setProperty('--grid-row-height', `${rowHeight}px`);
    grid.style.setProperty('--grid-gap', `${GRID_GAP}px`);
  };

  const clampWidgetToGrid = (instance) => {
    const { minW, minH } = getConstraints(instance);
    const cols = gridState.cols || GRID_MAX_COLS;
    instance.w = clamp(asInt(instance.w, minW), minW, cols);
    instance.h = clamp(asInt(instance.h, minH), minH, 99);
    instance.x = clamp(asInt(instance.x, 0), 0, Math.max(0, cols - instance.w));
    instance.y = Math.max(0, asInt(instance.y, 0));
  };

  const resolveOverlaps = () => {
    const placed = [];
    const widgets = [...layout.widgets].sort((a, b) => (a.y ?? 0) - (b.y ?? 0) || (a.x ?? 0) - (b.x ?? 0));
    for (const widget of widgets) {
      clampWidgetToGrid(widget);
      while (placed.some((p) => rectsOverlap(widget, p))) {
        const collisions = placed.filter((p) => rectsOverlap(widget, p));
        const bottom = Math.max(...collisions.map((p) => p.y + p.h));
        widget.y = bottom;
      }
      placed.push({ x: widget.x, y: widget.y, w: widget.w, h: widget.h });
    }
  };

  const updateGridHeight = () => {
    if (!grid) return;
    const maxY = layout.widgets.reduce((acc, w) => Math.max(acc, (w.y || 0) + (w.h || 1)), 1);
    const height = Math.max(1, maxY) * (gridState.rowHeight + gridState.gap) - gridState.gap;
    grid.style.height = `${Math.max(height, gridState.rowHeight)}px`;
  };

  const positionWidgetElement = (instance, element) => {
    if (!element) return;
    const { colWidth, rowHeight, gap } = gridState;
    const left = (instance.x || 0) * (colWidth + gap);
    const top = (instance.y || 0) * (rowHeight + gap);
    const width = (instance.w || 1) * colWidth + ((instance.w || 1) - 1) * gap;
    const height = (instance.h || 1) * rowHeight + ((instance.h || 1) - 1) * gap;
    element.style.left = `${left}px`;
    element.style.top = `${top}px`;
    element.style.width = `${width}px`;
    element.style.height = `${height}px`;
  };

  const layoutGrid = () => {
    if (!grid) return;
    computeGridMetrics();
    assignWidgetPositions(layout.widgets, gridState.cols);
    resolveOverlaps();
    for (const widget of layout.widgets) {
      const el = grid.querySelector(`[data-widget-id="${CSS.escape(widget.id)}"]`);
      positionWidgetElement(widget, el);
    }
    updateGridHeight();
    scheduleResize();
  };

  const scheduleResize = (widgetId = null) => {
    if (resizeRaf) cancelAnimationFrame(resizeRaf);
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = null;
      if (widgetId) {
        controllers.get(widgetId)?.resize?.();
      } else {
        for (const controller of controllers.values()) controller?.resize?.();
      }
    });
  };

  const destroyWidgets = () => {
    for (const controller of controllers.values()) {
      controller?.destroy?.();
    }
    controllers.clear();
  };

  const renderWidgets = async () => {
    destroyWidgets();
    grid.innerHTML = '';
    for (const instance of layout.widgets) {
      const def = WIDGET_DEFS[instance.type];
      if (!def) continue;
      const el = document.createElement('section');
      el.className = 'dash-widget';
      el.dataset.widgetId = instance.id;
      el.dataset.widgetType = instance.type;
      el.innerHTML = `
        <div class="dash-widget-card">
          <div class="dash-widget-head">
            <div class="dash-widget-handle" title="Drag to reorder">⋮⋮</div>
            <div class="dash-widget-title">${escapeHtml(instance.title || def.title)}</div>
            <div class="dash-widget-actions">
              <button type="button" data-action="settings">Settings</button>
              <button type="button" class="danger" data-action="remove">Remove</button>
            </div>
          </div>
          <div class="dash-widget-body"></div>
          <div class="dash-widget-resize" title="Resize"></div>
        </div>
      `;

      const settingsBtn = el.querySelector('[data-action="settings"]');
      const removeBtn = el.querySelector('[data-action="remove"]');
      if (settingsBtn) settingsBtn.onclick = () => openWidgetSettings(instance.id);
      if (removeBtn) removeBtn.onclick = () => removeWidget(instance.id);

      grid.appendChild(el);
      const controller = def.mount({ root: el, context, instance });
      controllers.set(instance.id, controller);
    }

    wireWidgetInteractions();
    applyEditMode();

    requestAnimationFrame(() => layoutGrid());

    await Promise.all(Array.from(controllers.values()).map((ctrl) => ctrl?.update?.()));
  };

  const applyEditMode = () => {
    if (!root) return;
    root.classList.toggle('edit-mode', editMode);
    const editBtn = $('#dash_edit');
    if (editBtn) editBtn.textContent = editMode ? 'Done' : 'Edit layout';
  };

  const openAddWidgetModal = () => {
    const bodyHtml = `
      <div class="grid two">
        ${Object.values(WIDGET_DEFS)
          .map(
            (def) => `
              <div class="dash-widget-picker">
                <div class="dash-widget-picker__title">${escapeHtml(def.title)}</div>
                <div class="dash-widget-picker__sub">${escapeHtml(def.description || '')}</div>
                <div style="margin-top: 8px;">
                  <button type="button" data-add-widget="${escapeHtml(def.type)}">Add</button>
                </div>
              </div>
            `
          )
          .join('')}
      </div>
    `;

    const { root: modalRoot, close } = showModal({
      title: 'Add widget',
      subtitle: 'Choose a widget to add to the dashboard',
      bodyHtml,
    });

    modalRoot.querySelectorAll('[data-add-widget]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const type = btn.getAttribute('data-add-widget');
        if (!type || !WIDGET_DEFS[type]) return;
        addWidget(type);
        close();
      });
    });
  };

  const openWidgetSettings = (id) => {
    const instance = layout.widgets.find((w) => w.id === id);
    if (!instance) return;
    const def = WIDGET_DEFS[instance.type];
    if (!def) return;

    const { root: modalRoot, close } = showModal({
      title: `Edit ${def.title}`,
      subtitle: 'Update widget configuration',
      bodyHtml: widgetSettingsForm(def, instance, accounts),
    });

    const saveBtn = modalRoot.querySelector('#ws_save');
    const removeBtn = modalRoot.querySelector('#ws_remove');

    if (removeBtn) {
      removeBtn.addEventListener('click', () => {
        removeWidget(instance.id);
        close();
      });
    }

    if (saveBtn) {
      saveBtn.addEventListener('click', () => {
        const titleInput = modalRoot.querySelector('#ws_title');
        const newConfig = { ...def.defaultConfig };

        for (const field of def.settings) {
          const el = modalRoot.querySelector(`#ws_${field.key}`);
          if (!el) continue;
          if (field.type === 'checkbox') {
            newConfig[field.key] = Boolean(el.checked);
          } else if (field.type === 'number') {
            const val = asInt(el.value, def.defaultConfig[field.key]);
            newConfig[field.key] = clamp(val, field.min ?? val, field.max ?? val);
          } else if (field.type === 'select') {
            newConfig[field.key] = el.value;
          } else if (field.type === 'account') {
            newConfig[field.key] = el.value || '';
          }
        }

        instance.title = titleInput?.value?.trim() || def.title;
        instance.config = newConfig;

        layout = {
          version: DASHBOARD_LAYOUT_VERSION,
          widgets: assignWidgetPositions(normalizeWidgets(layout.widgets, WIDGET_DEFS), gridState.cols || GRID_MAX_COLS),
        };
        saveLayout();
        renderWidgets();
        close();
      });
    }
  };

  const addWidget = (type) => {
    const def = WIDGET_DEFS[type];
    if (!def) return;
    computeGridMetrics();
    const dims = SIZE_GRID[def.defaultSize] || { w: 4, h: 4 };
    const instance = {
      id: newWidgetId(type),
      type,
      size: def.defaultSize,
      title: def.title,
      config: { ...def.defaultConfig },
      x: 0,
      y: 0,
      w: dims.w,
      h: dims.h,
    };
    const spot = findNextSpot(instance, layout.widgets, gridState.cols || GRID_MAX_COLS);
    instance.x = spot.x;
    instance.y = spot.y;
    layout.widgets.push(instance);
    saveLayout();
    renderWidgets();
    openWidgetSettings(instance.id);
  };

  const removeWidget = (id) => {
    layout.widgets = layout.widgets.filter((w) => w.id !== id);
    if (!layout.widgets.length) layout = normalizeLayout(null, WIDGET_DEFS);
    saveLayout();
    renderWidgets();
  };

  const startAction = (type, instance, element, event) => {
    if (!editMode) return;
    event.preventDefault();
    event.stopPropagation();
    computeGridMetrics();
    activeAction = {
      type,
      instance,
      element,
      startX: event.clientX,
      startY: event.clientY,
      startGridX: instance.x || 0,
      startGridY: instance.y || 0,
      startW: instance.w || 1,
      startH: instance.h || 1,
    };
    element.classList.add('dragging');
    if (event.currentTarget?.setPointerCapture) {
      event.currentTarget.setPointerCapture(event.pointerId);
    }
    window.addEventListener('pointermove', onPointerMove);
    window.addEventListener('pointerup', onPointerUp);
  };

  const onPointerMove = (event) => {
    if (!activeAction) return;
    const { instance, element, type } = activeAction;
    const dx = event.clientX - activeAction.startX;
    const dy = event.clientY - activeAction.startY;
    const stepX = gridState.colWidth + gridState.gap;
    const stepY = gridState.rowHeight + gridState.gap;
    const cols = gridState.cols || GRID_MAX_COLS;
    const { minW, minH } = getConstraints(instance);

    if (type === 'move') {
      const nextX = clamp(activeAction.startGridX + Math.round(dx / stepX), 0, Math.max(0, cols - instance.w));
      const nextY = Math.max(0, activeAction.startGridY + Math.round(dy / stepY));
      instance.x = nextX;
      instance.y = nextY;
    } else if (type === 'resize') {
      const nextW = clamp(activeAction.startW + Math.round(dx / stepX), minW, Math.max(minW, cols - instance.x));
      const nextH = clamp(activeAction.startH + Math.round(dy / stepY), minH, 99);
      instance.w = nextW;
      instance.h = nextH;
    }

    positionWidgetElement(instance, element);
    updateGridHeight();
    scheduleResize(instance.id);
  };

  const onPointerUp = () => {
    if (!activeAction) return;
    const { element } = activeAction;
    element.classList.remove('dragging');
    activeAction = null;
    window.removeEventListener('pointermove', onPointerMove);
    window.removeEventListener('pointerup', onPointerUp);
    resolveOverlaps();
    layoutGrid();
    saveLayout();
  };

  const wireWidgetInteractions = () => {
    grid.querySelectorAll('.dash-widget').forEach((widget) => {
      const id = widget.dataset.widgetId;
      const instance = layout.widgets.find((w) => w.id === id);
      if (!instance) return;
      const handle = widget.querySelector('.dash-widget-handle');
      if (handle) {
        handle.onpointerdown = (e) => startAction('move', instance, widget, e);
      }
      const resizer = widget.querySelector('.dash-widget-resize');
      if (resizer) {
        resizer.onpointerdown = (e) => startAction('resize', instance, widget, e);
      }
    });
  };

  const addBtn = $('#dash_add');
  const editBtn = $('#dash_edit');
  const resetBtn = $('#dash_reset');
  const fromInput = $('#dash_from');
  const toInput = $('#dash_to');
  const applyBtn = $('#dash_apply');

  const applyRange = () => {
    const from = fromInput?.value?.trim() || context.range.from;
    const to = toInput?.value?.trim() || context.range.to;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to)) return;
    const nextFrom = from <= to ? from : to;
    const nextTo = from <= to ? to : from;
    context.setRange({ from: nextFrom, to: nextTo });
    if (fromInput) fromInput.value = nextFrom;
    if (toInput) toInput.value = nextTo;

    if (context.selection.locked && (context.selection.date < nextFrom || context.selection.date > nextTo)) {
      context.setSelection({ locked: false, idx: 0, date: nextFrom, source: null, mode: context.selection.mode || 'projected' });
    }

    for (const controller of controllers.values()) controller?.update?.();
  };

  if (addBtn) addBtn.onclick = () => openAddWidgetModal();
  if (editBtn) {
    editBtn.onclick = () => {
      editMode = !editMode;
      applyEditMode();
    };
  }
  if (resetBtn) {
    resetBtn.onclick = () => {
      layout = normalizeLayout(null, WIDGET_DEFS);
      saveLayout();
      renderWidgets();
    };
  }
  if (applyBtn) applyBtn.onclick = () => applyRange();

  window.addEventListener('resize', () => layoutGrid());

  await renderWidgets();
  applyEditMode();
}
