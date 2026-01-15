import { $, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../js/chart.js';
import { activeNav, showModal, table, wireTableFilters } from '../js/ui.js';

function addMonthsISO(isoDate, months) {
  // isoDate: YYYY-MM-DD
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setMonth(d.getMonth() + Number(months || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addYearsISO(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setFullYear(d.getFullYear() + Number(years || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function addDaysISO(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function isoToDayNumber(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return NaN;
  return Math.floor(t / 86400000);
}

function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function buildDateAxis(fromISO, toISO, stepDays) {
  const step = Math.max(1, Math.floor(Number(stepDays || 1)));
  const start = isoToDayNumber(fromISO);
  const end = isoToDayNumber(toISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { dates: [], days: [] };

  const days = [];
  const dates = [];
  for (let d = start; d <= end; d += step) {
    days.push(d);
    const dt = new Date(d * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  if (days[days.length - 1] !== end) {
    days.push(end);
    const dt = new Date(end * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  return { dates, days };
}

function asInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function createEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch {
          // ignore
        }
      }
    },
  };
}

const GRID_MIN_COL_WIDTH = 160;
const GRID_ROW_RATIO = 0.7;
const GRID_ROW_MIN = 72;
const GRID_ROW_MAX = 148;
const GRID_HEIGHT_MIN = 480;
const GRID_GAP = 12;
const GRID_MIN_COLS = 4;
const GRID_MAX_COLS = 12;

const SIZE_GRID = {
  sm: { w: 3, h: 3 },
  md: { w: 4, h: 4 },
  lg: { w: 6, h: 6 },
};

const DASHBOARD_LAYOUT_VERSION = 3;

const WIDGET_DEFS = createWidgetDefinitions();

let widgetSeq = 0;

function newWidgetId(prefix) {
  widgetSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${widgetSeq.toString(36)}`;
}

function normalizeLayout(raw) {
  if (raw && raw.version === DASHBOARD_LAYOUT_VERSION && Array.isArray(raw.widgets)) {
    const widgets = normalizeWidgets(raw.widgets);
    if (widgets.length) return { version: DASHBOARD_LAYOUT_VERSION, widgets: assignWidgetPositions(widgets) };
  }
  if (raw && raw.version === 2 && Array.isArray(raw.widgets)) {
    const widgets = normalizeWidgets(raw.widgets);
    if (widgets.length) return { version: DASHBOARD_LAYOUT_VERSION, widgets: assignWidgetPositions(widgets) };
  }
  if (raw && typeof raw === 'object' && raw.positions) {
    return migrateLegacyLayout(raw);
  }
  return createDefaultLayout();
}

function normalizeWidgets(widgets) {
  const out = [];
  const seen = new Set();
  for (const w of widgets || []) {
    const inst = normalizeWidgetInstance(w);
    if (!inst) continue;
    if (seen.has(inst.id)) inst.id = newWidgetId(inst.type);
    seen.add(inst.id);
    out.push(inst);
  }
  return out;
}

function normalizeWidgetInstance(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const type = String(raw.type || '').trim();
  const def = WIDGET_DEFS[type];
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
  return { id, type, size, title, config, x, y, w, h };
}

function rectsOverlap(a, b) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

function findNextSpot(widget, placed, cols) {
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

function assignWidgetPositions(widgets, cols = GRID_MAX_COLS) {
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

function migrateLegacyLayout(raw) {
  const positions = raw.positions || {};
  const posToWidget = {};
  for (const [widget, pos] of Object.entries(positions)) {
    if (WIDGET_DEFS[widget]) posToWidget[pos] = widget;
  }
  const order = ['left-top', 'right', 'left-bottom'];
  const fallback = ['upcoming', 'projection', 'snapshot'];
  const widgets = order
    .map((pos, idx) => posToWidget[pos] || fallback[idx])
    .filter((type) => WIDGET_DEFS[type])
    .map((type) => {
      const def = WIDGET_DEFS[type];
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

function createDefaultLayout() {
  const defaults = [
    { type: 'upcoming', size: 'md' },
    { type: 'snapshot', size: 'md' },
    { type: 'projection', size: 'lg' },
  ];
  const widgets = defaults.map((entry) => {
    const def = WIDGET_DEFS[entry.type];
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
  });
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: assignWidgetPositions(widgets),
  };
}

function createDashboardContext(asOf, accounts = [], range = null) {
  const emitter = createEmitter();
  const balancesCache = new Map();
  const seriesCache = new Map();
  const occurrencesCache = new Map();
  const entriesCache = new Map();
  let accountMeta = new Map();
  const accountById = new Map((accounts || []).map((a) => [Number(a.id), a]));
  const dateRange = {
    from: range?.from || asOf,
    to: range?.to || addYearsISO(range?.from || asOf, 1),
  };

  const context = {
    asOf,
    range: dateRange,
    selection: { locked: false, date: asOf, idx: 0, source: null },
    on: emitter.on,
    emit: emitter.emit,
    setSelection(next) {
      context.selection = { ...context.selection, ...next };
      emitter.emit('selection', context.selection);
    },
    setRange(next) {
      const from = next?.from || dateRange.from;
      const to = next?.to || dateRange.to;
      dateRange.from = from;
      dateRange.to = to;
      context.asOf = from;
      balancesCache.clear();
      seriesCache.clear();
      occurrencesCache.clear();
      entriesCache.clear();
      accountMeta = new Map();
      emitter.emit('range', { from, to });
    },
    async getBalances(date, opts = {}) {
      const mode = opts?.mode || 'actual';
      const fromDate = opts?.fromDate || asOf;
      const key = `${mode}|${String(date || asOf)}|${mode === 'projected' ? fromDate : ''}`;
      if (balancesCache.has(key)) return balancesCache.get(key);
      const qs = new URLSearchParams({ mode, as_of: String(date || asOf) });
      if (mode === 'projected') qs.set('from_date', fromDate);
      const res = await api(`/api/balances?${qs.toString()}`);
      const data = res.data || [];
      balancesCache.set(key, data);
      for (const acct of data) {
        accountMeta.set(Number(acct.id), acct);
      }
      return data;
    },
    async getSeries({ fromDate, toDate, stepDays, includeInterest }) {
      const key = `${fromDate}|${toDate}|${stepDays}|${includeInterest ? '1' : '0'}`;
      if (seriesCache.has(key)) return seriesCache.get(key);
      const qs = new URLSearchParams({
        mode: 'projected',
        from_date: fromDate,
        to_date: toDate,
        step_days: String(stepDays),
      });
      if (includeInterest) qs.set('include_interest', '1');
      const res = await api(`/api/balances/series?${qs.toString()}`);
      const data = res.data || null;
      seriesCache.set(key, data);
      return data;
    },
    async getOccurrences(fromDate, toDate) {
      const key = `${fromDate}|${toDate}`;
      if (occurrencesCache.has(key)) return occurrencesCache.get(key);
      const qs = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      const res = await api(`/api/occurrences?${qs.toString()}`);
      const data = res.data || [];
      occurrencesCache.set(key, data);
      return data;
    },
    async getEntries() {
      const key = 'all';
      if (entriesCache.has(key)) return entriesCache.get(key);
      const res = await api('/api/entries');
      const data = res.data || [];
      entriesCache.set(key, data);
      return data;
    },
    accounts,
    accountById,
    async getAccountMeta() {
      if (accountMeta.size) return accountMeta;
      await context.getBalances(asOf, { mode: 'actual' });
      return accountMeta;
    },
  };

  return context;
}

function createWidgetDefinitions() {
  const upcoming = {
    type: 'upcoming',
    title: 'Upcoming expenses',
    description: 'Scheduled expenses over a configurable window.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      days: 7,
      maxRows: 7,
      syncSelection: true,
      showHidden: false,
      accountId: '',
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'days', label: 'Window (days)', type: 'number', min: 1, max: 365, step: 1 },
      { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
      { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `<div class="dash-upcoming"></div>`;
      const box = body.querySelector('.dash-upcoming');

      const update = async () => {
        const cfg = { ...upcoming.defaultConfig, ...(instance.config || {}) };
        const days = clamp(asInt(cfg.days, 7), 1, 365);
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
        const toDate = addDaysISO(baseDate, days);

        const occ = await context.getOccurrences(baseDate, toDate);
        const meta = await context.getAccountMeta();
        const accountLookup = context.accountById;

        const acctName = (id) => {
          if (id === null || id === undefined || id === '') return '';
          const n = Number(id);
          if (!Number.isFinite(n)) return '';
          return meta.get(n)?.name || accountLookup.get(n)?.name || String(id);
        };
        const isHidden = (id) => {
          if (id === null || id === undefined || id === '') return false;
          const n = Number(id);
          if (!Number.isFinite(n)) return false;
          return Number(meta.get(n)?.exclude_from_dashboard ?? accountLookup.get(n)?.exclude_from_dashboard ?? 0) === 1;
        };

        const filtered = (occ || [])
          .filter((o) => String(o?.kind || '') === 'E')
          .filter((o) => (!accountId ? true : Number(o?.src_account_id) === accountId))
          .filter((o) => (cfg.showHidden ? true : !isHidden(o?.src_account_id)));

        filtered.sort((a, b) => {
          const da = String(a?.occ_date || '');
          const db = String(b?.occ_date || '');
          if (da < db) return -1;
          if (da > db) return 1;
          const na = String(a?.name || '');
          const nb = String(b?.name || '');
          return na.localeCompare(nb);
        });

        const shown = filtered;
        const total = filtered.reduce((acc, o) => acc + Number(o?.amount_cents ?? 0), 0);

        const rows = shown
          .map((o) => {
            const date = escapeHtml(String(o.occ_date || ''));
            const name = escapeHtml(String(o.name || ''));
            const account = escapeHtml(acctName(o.src_account_id));
            const amt = fmtDollarsAccountingFromCents(Number(o.amount_cents ?? 0));
            return `
              <div class="dash-upcoming-row">
                <div class="dash-upcoming-date mono">${date}</div>
                <div class="dash-upcoming-name" title="${name}">${name}</div>
                <div class="dash-upcoming-acct" title="${account}">${account}</div>
                <div class="dash-upcoming-amt mono">${escapeHtml(amt)}</div>
              </div>
            `;
          })
          .join('');

        const title = `Upcoming expenses (${days}d)`;
        const subtitle = `${baseDate} → ${toDate}`;
        const totalLine = `Total: <span class="mono">${escapeHtml(fmtDollarsAccountingFromCents(total))}</span>`;

        box.innerHTML = `
          <div class="dash-upcoming-head">
            <div>
              <div class="dash-upcoming-title">${title}</div>
              <div class="dash-upcoming-sub">${escapeHtml(subtitle)}</div>
            </div>
            <div class="dash-upcoming-total">${totalLine}</div>
          </div>
          ${shown.length ? `<div class="dash-upcoming-list">${rows}</div>` : `<div class="notice">No scheduled expenses in the next ${days} days.</div>`}
        `;
      };

      const unsub = context.on('selection', () => update());
      update();

      return {
        update,
        resize() {
          // layout-only; nothing to recalc for size changes
        },
        destroy() {
          unsub();
        },
      };
    },
  };

  const snapshot = {
    type: 'snapshot',
    title: 'Snapshot',
    description: 'Balances as-of a specific date.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      includeLiabilities: false,
      showHidden: false,
      syncSelection: true,
      accountId: '',
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'includeLiabilities', label: 'Include liabilities', type: 'checkbox' },
      { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
      { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `
        <div class="dash-snapshot">
          <div class="notice dash-snapshot-stats"></div>
          <div class="dash-snapshot-table"></div>
        </div>
      `;
      const statsEl = body.querySelector('.dash-snapshot-stats');
      const tableEl = body.querySelector('.dash-snapshot-table');
      const tableId = `dashboard-balances-${instance.id}`;

      const update = async () => {
        const cfg = { ...snapshot.defaultConfig, ...(instance.config || {}) };
        const useProjected = cfg.syncSelection && context.selection?.locked;
        const baseDate = useProjected ? context.selection.date : context.asOf;
        const balancesAll = await context.getBalances(baseDate, {
          mode: useProjected ? 'projected' : 'actual',
          fromDate: context.asOf,
        });
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;

        const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
        const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

        const balances = (balancesAll || []).filter((r) => {
          if (!cfg.showHidden && isHidden(r)) return false;
          if (!cfg.includeLiabilities && isLiability(r)) return false;
          if (accountId && Number(r.id) !== accountId) return false;
          return true;
        });
        const balanceCents = (r) => Number(r.balance_cents ?? r.projected_balance_cents ?? 0);
        const netWorthCents = balances.reduce((acc, r) => acc + balanceCents(r), 0);

        if (statsEl) {
          statsEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px;">
              <div>
                <div style="font-size:12px; color: var(--muted);">Net worth</div>
                <div class="mono" style="font-size:18px; margin-top:4px;">${fmtDollarsAccountingFromCents(netWorthCents)}</div>
                <div style="font-size:11px; color: var(--muted); margin-top:6px;">As-of ${escapeHtml(baseDate)}${useProjected ? ' (projected)' : ''}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:12px; color: var(--muted);">Accounts</div>
                <div class="mono" style="font-size:18px; margin-top:4px;">${balances.length}</div>
              </div>
            </div>
          `;
        }

        if (tableEl) {
          const moneyCell = (cents) => {
            const num = Number(cents ?? 0);
            const cls = num < 0 ? 'num neg mono' : num > 0 ? 'num pos mono' : 'num mono';
            return {
              text: fmtDollarsAccountingFromCents(num),
              className: cls,
              title: String(cents ?? ''),
            };
          };
          tableEl.innerHTML = table(
            ['account', 'balance'],
            balances.map((r) => ({
              account: r.name,
              balance: moneyCell(balanceCents(r)),
            })),
            null,
            {
              id: tableId,
              filter: true,
              filterPlaceholder: 'Filter accounts…',
            }
          );
          wireTableFilters(body);
        }
      };

      const unsub = context.on('selection', () => update());
      update();

      return {
        update,
        resize() {
          // layout-only; table and stats adapt via CSS
        },
        destroy() {
          unsub();
        },
      };
    },
  };

  const recentExpenses = {
    type: 'recent_expenses',
    title: 'Recent expenses',
    description: 'Recent expenses including manual entries.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      days: 7,
      syncSelection: true,
      showHidden: false,
      accountId: '',
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'days', label: 'Window (days)', type: 'number', min: 1, max: 365, step: 1 },
      { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
      { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `<div class="dash-upcoming"></div>`;
      const box = body.querySelector('.dash-upcoming');

      const update = async () => {
        const cfg = { ...recentExpenses.defaultConfig, ...(instance.config || {}) };
        const days = clamp(asInt(cfg.days, 7), 1, 365);
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
        const fromDate = addDaysISO(baseDate, -days);

        const occ = await context.getOccurrences(fromDate, baseDate);
        const entries = await context.getEntries();
        const meta = await context.getAccountMeta();
        const accountLookup = context.accountById;

        const acctName = (id) => {
          if (id === null || id === undefined || id === '') return '';
          const n = Number(id);
          if (!Number.isFinite(n)) return '';
          return meta.get(n)?.name || accountLookup.get(n)?.name || String(id);
        };
        const isHidden = (id) => {
          if (id === null || id === undefined || id === '') return false;
          const n = Number(id);
          if (!Number.isFinite(n)) return false;
          return Number(meta.get(n)?.exclude_from_dashboard ?? accountLookup.get(n)?.exclude_from_dashboard ?? 0) === 1;
        };

        const occRows = (occ || [])
          .filter((o) => String(o?.kind || '') === 'E')
          .filter((o) => (!accountId ? true : Number(o?.src_account_id) === accountId))
          .filter((o) => (cfg.showHidden ? true : !isHidden(o?.src_account_id)))
          .map((o) => ({
            date: String(o.occ_date || ''),
            name: String(o.name || ''),
            accountId: o.src_account_id,
            amount: Number(o.amount_cents ?? 0),
            source: 'Scheduled',
          }));

        const entryRows = (entries || [])
          .filter((e) => {
            const d = String(e.entry_date || '');
            if (!d) return false;
            if (d < fromDate || d > baseDate) return false;
            if (accountId) return Number(e?.src_account_id) === accountId;
            return true;
          })
          .filter((e) => e?.src_account_id != null && (e?.dest_account_id == null || e?.dest_account_id === ''))
          .filter((e) => (cfg.showHidden ? true : !isHidden(e?.src_account_id)))
          .map((e) => ({
            date: String(e.entry_date || ''),
            name: String(e.name || ''),
            accountId: e.src_account_id,
            amount: Number(e.amount_cents ?? 0),
            source: 'Entry',
          }));

        const merged = occRows.concat(entryRows).sort((a, b) => {
          if (a.date > b.date) return -1;
          if (a.date < b.date) return 1;
          return a.name.localeCompare(b.name);
        });

        const total = merged.reduce((acc, o) => acc + Number(o.amount ?? 0), 0);

        const rows = merged
          .map((o) => {
            const date = escapeHtml(String(o.date || ''));
            const name = escapeHtml(String(o.name || ''));
            const account = escapeHtml(acctName(o.accountId));
            const amt = fmtDollarsAccountingFromCents(Number(o.amount ?? 0));
            const source = escapeHtml(o.source || '');
            return `
              <div class="dash-upcoming-row">
                <div class="dash-upcoming-date mono">${date}</div>
                <div class="dash-upcoming-name" title="${name}">${name}</div>
                <div class="dash-upcoming-acct" title="${account}">${account}</div>
                <div class="dash-upcoming-amt mono">${escapeHtml(amt)}</div>
                <div class="dash-upcoming-kind">${source}</div>
              </div>
            `;
          })
          .join('');

        const title = `Recent expenses (${days}d)`;
        const subtitle = `${fromDate} → ${baseDate}`;
        const totalLine = `Total: <span class="mono">${escapeHtml(fmtDollarsAccountingFromCents(total))}</span>`;

        box.innerHTML = `
          <div class="dash-upcoming-head">
            <div>
              <div class="dash-upcoming-title">${title}</div>
              <div class="dash-upcoming-sub">${escapeHtml(subtitle)}</div>
            </div>
            <div class="dash-upcoming-total">${totalLine}</div>
          </div>
          ${merged.length ? `<div class="dash-upcoming-list">${rows}</div>` : `<div class="notice">No expenses in the last ${days} days.</div>`}
        `;
      };

      const unsubSel = context.on('selection', () => update());
      const unsubRange = context.on('range', () => update());
      update();

      return {
        update,
        resize() {},
        destroy() {
          unsubSel();
          unsubRange();
        },
      };
    },
  };

  const balanceCard = {
    type: 'balance_card',
    title: 'Account balance',
    description: 'Single-account balance card with selection sync.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      accountId: '',
      syncSelection: true,
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `
        <div class="dash-balance-card">
          <div class="dash-balance-title"></div>
          <div class="dash-balance-value mono"></div>
          <div class="dash-balance-sub"></div>
        </div>
      `;
      const titleEl = body.querySelector('.dash-balance-title');
      const valueEl = body.querySelector('.dash-balance-value');
      const subEl = body.querySelector('.dash-balance-sub');

      const update = async () => {
        const cfg = { ...balanceCard.defaultConfig, ...(instance.config || {}) };
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        if (!accountId) {
          if (titleEl) titleEl.textContent = 'Account balance';
          if (valueEl) valueEl.textContent = '—';
          if (subEl) subEl.textContent = 'Select an account in settings.';
          return;
        }

        const useProjected = cfg.syncSelection && context.selection?.locked;
        const baseDate = useProjected ? context.selection.date : context.asOf;
        const balances = await context.getBalances(baseDate, {
          mode: useProjected ? 'projected' : 'actual',
          fromDate: context.asOf,
        });

        const row = (balances || []).find((r) => Number(r.id) === accountId);
        const name = row?.name || context.accountById.get(accountId)?.name || `Account #${accountId}`;
        const cents = Number(row?.balance_cents ?? row?.projected_balance_cents ?? 0);

        if (titleEl) titleEl.textContent = name;
        if (valueEl) valueEl.textContent = fmtDollarsAccountingFromCents(cents);
        if (subEl) subEl.textContent = `As-of ${baseDate}${useProjected ? ' (projected)' : ''}`;
      };

      const unsub = context.on('selection', () => update());
      update();

      return {
        update,
        resize() {},
        destroy() {
          unsub();
        },
      };
    },
  };

  const recentEntries = {
    type: 'recent_entries',
    title: 'Recent entries',
    description: 'Latest manual entries with account filtering.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      accountId: '',
      limit: 20,
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'limit', label: 'Rows', type: 'number', min: 5, max: 200, step: 1 },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `<div class="dash-entries"></div>`;
      const box = body.querySelector('.dash-entries');
      const tableId = `dashboard-entries-${instance.id}`;

      const update = async () => {
        const cfg = { ...recentEntries.defaultConfig, ...(instance.config || {}) };
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        const limit = clamp(asInt(cfg.limit, 20), 5, 200);
        const entries = await context.getEntries();

        const filtered = (entries || [])
          .filter((e) => {
            if (!accountId) return true;
            return Number(e?.src_account_id) === accountId || Number(e?.dest_account_id) === accountId;
          })
          .slice(0, limit);

        const rows = filtered.map((e) => ({
          date: e.entry_date,
          name: e.name,
          amount: {
            text: fmtDollarsAccountingFromCents(Number(e.amount_cents ?? 0)),
            className: Number(e.amount_cents ?? 0) < 0 ? 'num neg mono' : 'num mono',
            title: String(e.amount_cents ?? ''),
          },
          src: e.src_account_name || '',
          dest: e.dest_account_name || '',
        }));

        if (!rows.length) {
          box.innerHTML = `<div class="notice">No entries found.</div>`;
          return;
        }

        box.innerHTML = table(['date', 'name', 'amount', 'src', 'dest'], rows, null, {
          id: tableId,
          filter: false,
        });
      };

      update();

      return {
        update,
        resize() {},
        destroy() {},
      };
    },
  };

  const projectionTxns = {
    type: 'projection_txns',
    title: 'Scheduled transactions',
    description: 'Scheduled feed linked to the projection selection window.',
    defaultSize: 'md',
    minW: 2,
    minH: 2,
    defaultConfig: {
      windowDays: 14,
      syncSelection: true,
      showHidden: false,
      accountId: '',
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'windowDays', label: 'Window (days)', type: 'number', min: 3, max: 120, step: 1 },
      { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
      { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `
        <div class="dash-txns">
          <div class="dash-txns-sub"></div>
          <div class="dash-txns-table"></div>
        </div>
      `;
      const subEl = body.querySelector('.dash-txns-sub');
      const tableEl = body.querySelector('.dash-txns-table');
      const tableId = `dashboard-txns-${instance.id}`;

      const acctName = (id) => {
        if (id === null || id === undefined || id === '') return '';
        const n = Number(id);
        if (!Number.isFinite(n)) return '';
        return context.accountById.get(n)?.name || String(id);
      };

      const update = async () => {
        const cfg = { ...projectionTxns.defaultConfig, ...(instance.config || {}) };
        const windowDays = clamp(asInt(cfg.windowDays, 14), 3, 120);
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
        const half = Math.floor(windowDays / 2);
        const fromDate = addDaysISO(baseDate, -half);
        const toDate = addDaysISO(baseDate, half);

        const occ = await context.getOccurrences(fromDate, toDate);
        const meta = await context.getAccountMeta();

        const isHidden = (id) => {
          if (id === null || id === undefined || id === '') return false;
          const n = Number(id);
          if (!Number.isFinite(n)) return false;
          return Number(meta.get(n)?.exclude_from_dashboard ?? 0) === 1;
        };

        const filtered = (occ || []).filter((o) => {
          if (!cfg.showHidden && isHidden(o?.src_account_id)) return false;
          if (accountId) {
            const src = Number(o?.src_account_id);
            const dest = Number(o?.dest_account_id);
            if (src !== accountId && dest !== accountId) return false;
          }
          return true;
        });

        filtered.sort((a, b) => {
          const da = String(a?.occ_date || '');
          const db = String(b?.occ_date || '');
          if (da < db) return -1;
          if (da > db) return 1;
          const na = String(a?.name || '');
          const nb = String(b?.name || '');
          return na.localeCompare(nb);
        });

        if (subEl) subEl.textContent = `${fromDate} → ${toDate}`;

        const rows = filtered.map((o) => ({
          date: o.occ_date,
          kind: o.kind,
          name: o.name,
          amount: {
            text: fmtDollarsAccountingFromCents(Number(o.amount_cents ?? 0)),
            className: Number(o.amount_cents ?? 0) < 0 ? 'num neg mono' : 'num mono',
            title: String(o.amount_cents ?? ''),
          },
          src: acctName(o.src_account_id),
          dest: acctName(o.dest_account_id),
        }));

        tableEl.innerHTML = rows.length
          ? table(['date', 'kind', 'name', 'amount', 'src', 'dest'], rows, null, {
              id: tableId,
              filter: true,
              filterPlaceholder: 'Filter scheduled…',
            })
          : `<div class="notice">No scheduled transactions in this window.</div>`;
        wireTableFilters(body);
      };

      const unsub = context.on('selection', () => update());
      update();

      return {
        update,
        resize() {},
        destroy() {
          unsub();
        },
      };
    },
  };

  const expensesChart = {
    type: 'expenses_chart',
    title: 'Expenses chart',
    description: 'Top scheduled expenses over time (cumulative).',
    defaultSize: 'lg',
    minW: 3,
    minH: 3,
    defaultConfig: {
      monthsAhead: 6,
      stepDays: 7,
      topN: 8,
    },
    settings: [
      { key: 'monthsAhead', label: 'Months ahead', type: 'number', min: 1, max: 24, step: 1 },
      { key: 'stepDays', label: 'Granularity (days)', type: 'number', min: 1, max: 366, step: 1 },
      { key: 'topN', label: 'Top schedules', type: 'number', min: 3, max: 40, step: 1 },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `
        <div class="dash-expenses">
          <div class="dash-selection"></div>
          <div>
            <label>Lines</label>
            <div class="chart-lines"></div>
          </div>
          <div class="dash-projection-chart">
            <label>Expenses</label>
            <canvas class="chart chart--small"></canvas>
          </div>
        </div>
      `;

      const selectionEl = body.querySelector('.dash-selection');
      const linesBox = body.querySelector('.chart-lines');
      const canvas = body.querySelector('canvas.chart');

      const state = {
        axis: { dates: [], days: [] },
        groups: [],
        selected: new Set(['total']),
        lockedIdx: null,
        totalCum: [],
      };

      const selectedIndex = () => {
        const n = state.axis?.dates?.length || 0;
        const idx = state.lockedIdx === null || state.lockedIdx === undefined ? 0 : Number(state.lockedIdx);
        if (!Number.isFinite(idx) || n <= 0) return 0;
        return clamp(Math.round(idx), 0, n - 1);
      };

      const updateSelectionLabel = () => {
        if (!selectionEl) return;
        const idx = selectedIndex();
        const date = state.axis?.dates?.[idx] || context.asOf;
        if (state.lockedIdx === null || state.lockedIdx === undefined) {
          selectionEl.innerHTML = `Selection: <span class="mono">${escapeHtml(date)}</span> (timeline start — click chart to lock)`;
        } else {
          selectionEl.innerHTML = `Selection locked: <span class="mono">${escapeHtml(date)}</span> (Shift+click or Esc to clear)`;
        }
      };

      const fetchAndCompute = async (cfg) => {
        const fromDate = context.range?.from || context.asOf;
        const toDate = context.range?.to || addMonthsISO(fromDate, clamp(asInt(cfg.monthsAhead, 6), 1, 24));
        state.axis = buildDateAxis(fromDate, toDate, clamp(asInt(cfg.stepDays, 7), 1, 366));
        if (!state.axis.dates.length) {
          state.groups = [];
          state.totalCum = [];
          return;
        }

        const occ = await context.getOccurrences(fromDate, toDate);
        const bySched = new Map();
        for (const o of occ || []) {
          if (!o) continue;
          if (String(o.kind || '') !== 'E') continue;
          const sid = Number(o.schedule_id);
          if (!Number.isFinite(sid)) continue;
          const name = String(o.name || `Schedule #${sid}`);
          const amt = Number(o.amount_cents ?? 0);
          const d = String(o.occ_date || '');
          const dn = isoToDayNumber(d);
          if (!Number.isFinite(dn)) continue;

          let g = bySched.get(sid);
          if (!g) {
            g = {
              id: sid,
              name,
              total: 0,
              buckets: new Array(state.axis.dates.length).fill(0),
            };
            bySched.set(sid, g);
          }

          g.total += amt;
          let idx = lowerBound(state.axis.days, dn);
          if (idx >= state.axis.days.length) idx = state.axis.days.length - 1;
          g.buckets[idx] += amt;
        }

        const all = Array.from(bySched.values());
        all.sort((a, b) => (b.total || 0) - (a.total || 0));
        state.groups = all.slice(0, clamp(asInt(cfg.topN, 8), 3, 40));

        state.selected.clear();
        state.selected.add('total');
        state.groups.slice(0, 5).forEach((g) => state.selected.add(String(g.id)));

        for (const g of state.groups) {
          let run = 0;
          g.cum = g.buckets.map((v) => {
            run += Number(v ?? 0);
            return run;
          });
        }

        const totalBuckets = new Array(state.axis.dates.length).fill(0);
        for (const g of all) {
          for (let i = 0; i < totalBuckets.length; i++) totalBuckets[i] += Number(g.buckets?.[i] ?? 0);
        }
        let totRun = 0;
        state.totalCum = totalBuckets.map((v) => {
          totRun += Number(v ?? 0);
          return totRun;
        });
      };

      const renderLines = () => {
        if (!linesBox) return;
        if (!state.axis?.dates?.length) {
          linesBox.innerHTML = `<div class="notice">No date axis.</div>`;
          return;
        }
        if (!state.groups.length) {
          linesBox.innerHTML = `<div class="notice">No scheduled expenses in this window.</div>`;
          return;
        }

        const idx = selectedIndex();
        const date = state.axis.dates[idx] || context.asOf;

        const keys = state.groups.map((g) => `sched:${g.id}:${g.name}`);
        const palette = distinctSeriesPalette(keys, 0.92, { seed: 'expenses' });
        const colorFor = (key) => {
          if (key === 'total') return 'hsla(40, 80%, 72%, 0.92)';
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));
        const lines = [];
        lines.push(
          `<label class="chart-line">
            <input type="checkbox" data-line="total" ${state.selected.has('total') ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor('total')}"></span>
            <span>Total spend</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(state.totalCum?.[idx] ?? 0)}</span>
          </label>`
        );

        for (const g of state.groups) {
          const id = String(g.id);
          const key = `sched:${g.id}:${g.name}`;
          lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="${id}" ${state.selected.has(id) ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor(key)}"></span>
              <span>${escapeHtml(g.name)}</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(g.cum?.[idx] ?? 0)}</span>
            </label>`
          );
        }

        linesBox.innerHTML = `
          <div class="chart-lines-actions">
            <button data-lines-all type="button">All</button>
            <button data-lines-none type="button">None</button>
          </div>
          <div class="chart-lines-list">${lines.join('')}</div>
        `;

        const allBtn = linesBox.querySelector('[data-lines-all]');
        const noneBtn = linesBox.querySelector('[data-lines-none]');
        allBtn.onclick = () => {
          state.selected.clear();
          state.selected.add('total');
          for (const g of state.groups) state.selected.add(String(g.id));
          renderLines();
          redrawChart();
        };
        noneBtn.onclick = () => {
          state.selected.clear();
          state.selected.add('total');
          renderLines();
          redrawChart();
        };

        linesBox.querySelectorAll('input[data-line]').forEach((inp) => {
          inp.onchange = () => {
            const key = inp.getAttribute('data-line');
            if (!key) return;
            if (inp.checked) state.selected.add(key);
            else state.selected.delete(key);
            redrawChart();
          };
        });
      };

      const redrawChart = () => {
        if (!canvas || !state.axis?.dates?.length) return;

        const keys = state.groups.map((g) => `sched:${g.id}:${g.name}`);
        const palette = distinctSeriesPalette(keys, 0.92, { seed: 'expenses' });
        const colorFor = (key) => {
          if (key === 'total') return 'hsla(40, 80%, 72%, 0.92)';
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const series = [];
        if (state.selected.has('total')) {
          series.push({ name: 'Total spend', values: (state.totalCum || []).map((v) => Number(v)), color: colorFor('total'), width: 3 });
        }
        for (const g of state.groups) {
          const id = String(g.id);
          if (!state.selected.has(id)) continue;
          const k = `sched:${g.id}:${g.name}`;
          series.push({ name: g.name, values: (g.cum || []).map((v) => Number(v)), color: colorFor(k), width: 2 });
        }

        drawLineChart(canvas, {
          labels: state.axis.dates,
          series,
          xTicks: 4,
          crosshair: {
            lockOnClick: true,
            lockedIndex: state.lockedIdx,
            onLockedIndexChange: (idx) => {
              state.lockedIdx = idx;
              updateSelectionLabel();
              renderLines();
              redrawChart();
            },
          },
          formatValue: (v) => fmtDollarsAccountingFromCents(Math.round(v)),
        });
      };

      const update = async () => {
        const cfg = { ...expensesChart.defaultConfig, ...(instance.config || {}) };
        await fetchAndCompute(cfg);
        updateSelectionLabel();
        renderLines();
        redrawChart();
      };

      update();

      return {
        update,
        resize() {
          redrawChart();
        },
        destroy() {},
      };
    },
  };

  const projection = {
    type: 'projection',
    title: 'Projection',
    description: 'Projected balances and selectable lines.',
    defaultSize: 'lg',
    minW: 3,
    minH: 3,
    defaultConfig: {
      includeInterest: true,
      stepDays: 7,
      monthsAhead: 6,
      includeLiabilities: false,
      showHidden: false,
      accountId: '',
    },
    settings: [
      { key: 'accountId', label: 'Account', type: 'account' },
      { key: 'includeInterest', label: 'Include interest', type: 'checkbox' },
      { key: 'stepDays', label: 'Granularity (days)', type: 'number', min: 1, max: 366, step: 1 },
      { key: 'monthsAhead', label: 'Months ahead', type: 'number', min: 1, max: 24, step: 1 },
      { key: 'includeLiabilities', label: 'Include liabilities', type: 'checkbox' },
      { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
    ],
    mount({ root, context, instance }) {
      const body = root.querySelector('.dash-widget-body');
      body.innerHTML = `
        <div class="dash-projection">
          <div class="dash-selection"></div>
          <div>
            <label>Lines</label>
            <div class="chart-lines"></div>
          </div>
          <div class="dash-projection-chart">
            <label>Projection</label>
            <canvas class="chart chart--small"></canvas>
          </div>
        </div>
      `;

      const selectionEl = body.querySelector('.dash-selection');
      const linesBox = body.querySelector('.chart-lines');
      const canvas = body.querySelector('canvas.chart');

      const state = {
        selected: new Set(['total', 'net']),
        lockedIdx: null,
        seriesData: null,
        seriesKey: '',
      };

      const updateSelectionLabel = () => {
        if (!selectionEl) return;
        const dates = state.seriesData?.dates || [];
        const idx = selectedIndex();
        const date = dates[idx] || context.asOf;
        if (state.lockedIdx === null || state.lockedIdx === undefined) {
          selectionEl.innerHTML = `Selection: <span class="mono">${escapeHtml(date)}</span> (timeline start — click chart to lock)`;
        } else {
          selectionEl.innerHTML = `Selection locked: <span class="mono">${escapeHtml(date)}</span> (Shift+click or Esc to clear)`;
        }
      };

      const selectedIndex = () => {
        const n = state.seriesData?.dates?.length || 0;
        const idx = state.lockedIdx === null || state.lockedIdx === undefined ? 0 : Number(state.lockedIdx);
        if (!Number.isFinite(idx) || n <= 0) return 0;
        return clamp(Math.round(idx), 0, n - 1);
      };

      const filteredAccounts = (cfg) => {
        const accounts = state.seriesData?.accounts || [];
        const accountId = cfg.accountId ? Number(cfg.accountId) : null;
        return accounts.filter((a) => {
          if (!cfg.showHidden && Number(a.exclude_from_dashboard ?? 0) === 1) return false;
          if (!cfg.includeLiabilities && Number(a.is_liability ?? 0) === 1) return false;
          if (accountId && Number(a.id) !== accountId) return false;
          return true;
        });
      };

      const computeTotalSeries = (accounts) => {
        const dates = state.seriesData?.dates || [];
        const out = new Array(dates.length).fill(0);
        for (const a of accounts || []) {
          const vals = a.balance_cents || [];
          for (let i = 0; i < out.length; i++) out[i] += Number(vals[i] ?? 0);
        }
        return out;
      };

      const computeNetSeries = (accountsVisible, cfg) => {
        const dates = state.seriesData?.dates || [];
        const assets = new Array(dates.length).fill(0);
        const liab = new Array(dates.length).fill(0);

        for (const a of accountsVisible || []) {
          const isL = Number(a?.is_liability ?? 0) === 1;
          if (isL && !cfg.includeLiabilities) continue;

          const vals = a.balance_cents || [];
          for (let i = 0; i < dates.length; i++) {
            const v = Number(vals[i] ?? 0);
            if (isL) liab[i] += Math.abs(v);
            else assets[i] += v;
          }
        }

        return assets.map((v, i) => v - (liab[i] ?? 0));
      };

      const fixedLineColor = (key) => {
        if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
        if (key === 'net') return 'hsla(150, 55%, 74%, 0.92)';
        return stableSeriesColor(String(key), 0.92);
      };

      const ensureSelected = (accounts) => {
        if (!state.selected.size) {
          state.selected.add('total');
          state.selected.add('net');
        }
        const visible = new Set(accounts.map((a) => String(a.id)));
        for (const key of Array.from(state.selected)) {
          if (key !== 'total' && key !== 'net' && !visible.has(key)) state.selected.delete(key);
        }
        if (!state.selected.has('total')) state.selected.add('total');
        if (!state.selected.has('net')) state.selected.add('net');
      };

      const redraw = (cfg) => {
        if (!canvas || !state.seriesData) return;
        const sel = state.selected;
        const series = [];

        const accounts = filteredAccounts(cfg);
        const visibleAccounts = state.seriesData?.accounts || [];
        const acctKeys = accounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
          if (key === 'total' || key === 'net') return fixedLineColor(key);
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const totalSeries = computeTotalSeries(accounts);
        const netSource = cfg.accountId ? accounts : visibleAccounts || [];
        const netSeries = computeNetSeries(
          netSource.filter((a) => (cfg.showHidden ? true : Number(a.exclude_from_dashboard ?? 0) !== 1)),
          cfg
        );

        if (sel.has('total')) {
          series.push({
            name: 'Total',
            values: totalSeries.map((v) => Number(v)),
            color: colorFor('total'),
            width: 3,
          });
        }

        if (sel.has('net')) {
          series.push({
            name: 'Net',
            values: netSeries.map((v) => Number(v)),
            color: colorFor('net'),
            width: 3,
          });
        }

        accounts.forEach((a) => {
          const id = String(a.id);
          if (!sel.has(id)) return;
          const key = `acct:${id}:${a.name || ''}`;
          series.push({
            name: a.name,
            values: (a.balance_cents || []).map((v) => Number(v)),
            color: colorFor(key),
            width: 2,
          });
        });

        drawLineChart(canvas, {
          labels: state.seriesData.dates || [],
          series,
          xTicks: 4,
          crosshair: {
            lockOnClick: true,
            lockedIndex: state.lockedIdx,
            onLockedIndexChange: (idx) => {
              state.lockedIdx = idx;
              updateSelectionLabel();
              renderLines(cfg);
              redraw(cfg);
              syncSelection(cfg);
            },
          },
        });
      };

      const renderLines = (cfg) => {
        if (!linesBox || !state.seriesData) return;
        const accounts = filteredAccounts(cfg);
        const visibleAccounts = state.seriesData?.accounts || [];
        ensureSelected(accounts);

        const acctKeys = accounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
          if (key === 'total' || key === 'net') return fixedLineColor(key);
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const idx = selectedIndex();
        const dates = state.seriesData?.dates || [];
        const date = dates[idx] || context.asOf;

        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

        const totalSeries = computeTotalSeries(accounts);
        const netSource = cfg.accountId ? accounts : visibleAccounts || [];
        const netSeries = computeNetSeries(
          netSource.filter((a) => (cfg.showHidden ? true : Number(a.exclude_from_dashboard ?? 0) !== 1)),
          cfg
        );
        const lines = [];
        lines.push(
          `<label class="chart-line">
            <input type="checkbox" data-line="total" ${state.selected.has('total') ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor('total')}"></span>
            <span>Total</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(totalSeries[idx] ?? 0)}</span>
          </label>`
        );
        lines.push(
          `<label class="chart-line">
            <input type="checkbox" data-line="net" ${state.selected.has('net') ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor('net')}"></span>
            <span title="assets - liabilities">Net</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(netSeries[idx] ?? 0)}</span>
          </label>`
        );

        accounts.forEach((a) => {
          const id = String(a.id);
          const key = `acct:${id}:${a.name || ''}`;
          const v = (a.balance_cents || [])[idx] ?? 0;
          lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="${id}" ${state.selected.has(id) ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor(key)}"></span>
              <span>${a.name}</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(v)}</span>
            </label>`
          );
        });

        linesBox.innerHTML = `
          <div class="chart-lines-actions">
            <button data-lines-all type="button">All</button>
            <button data-lines-none type="button">None</button>
          </div>
          <div class="chart-lines-list">${lines.join('')}</div>
        `;

        const allBtn = linesBox.querySelector('[data-lines-all]');
        const noneBtn = linesBox.querySelector('[data-lines-none]');
        allBtn.onclick = () => {
          state.selected.clear();
          state.selected.add('total');
          state.selected.add('net');
          for (const a of accounts) state.selected.add(String(a.id));
          renderLines(cfg);
          redraw(cfg);
        };
        noneBtn.onclick = () => {
          state.selected.clear();
          state.selected.add('total');
          state.selected.add('net');
          renderLines(cfg);
          redraw(cfg);
        };

        linesBox.querySelectorAll('input[data-line]').forEach((inp) => {
          inp.onchange = () => {
            const key = inp.getAttribute('data-line');
            if (!key) return;
            if (inp.checked) state.selected.add(key);
            else state.selected.delete(key);
            redraw(cfg);
          };
        });
      };

      const syncSelection = (cfg) => {
        const dates = state.seriesData?.dates || [];
        const locked = state.lockedIdx !== null && state.lockedIdx !== undefined;
        const idx = locked ? clamp(Number(state.lockedIdx || 0), 0, dates.length - 1) : 0;
        const date = dates[idx] || context.asOf;
        if (context.selection.source && context.selection.source !== instance.id && context.selection.locked) return;
        context.setSelection({ locked, idx, date, source: instance.id });
      };

      const update = async () => {
        const cfg = { ...projection.defaultConfig, ...(instance.config || {}) };
        const stepDays = clamp(asInt(cfg.stepDays, 7), 1, 366);
        const fromDate = context.range?.from || context.asOf;
        const toDate = context.range?.to || addMonthsISO(fromDate, clamp(asInt(cfg.monthsAhead, 6), 1, 24));
        const key = `${fromDate}|${toDate}|${stepDays}|${cfg.includeInterest ? '1' : '0'}`;
        if (key !== state.seriesKey) {
          state.seriesKey = key;
          state.seriesData = await context.getSeries({
            fromDate,
            toDate,
            stepDays,
            includeInterest: Boolean(cfg.includeInterest),
          });
          state.selected.clear();
          state.selected.add('total');
          state.selected.add('net');
          const accounts = filteredAccounts(cfg);
          for (const a of accounts) state.selected.add(String(a.id));
        }

        updateSelectionLabel();
        renderLines(cfg);
        redraw(cfg);
        syncSelection(cfg);
      };

      const resize = () => {
        if (!state.seriesData) return;
        const cfg = { ...projection.defaultConfig, ...(instance.config || {}) };
        redraw(cfg);
      };

      const selectionUnsub = context.on('selection', (sel) => {
        if (!sel || sel.source === instance.id) return;
        if (!state.seriesData) return;
        if (sel.locked) {
          const idx = (state.seriesData.dates || []).indexOf(sel.date);
          if (idx >= 0) state.lockedIdx = idx;
        } else {
          state.lockedIdx = null;
        }
        const cfg = { ...projection.defaultConfig, ...(instance.config || {}) };
        updateSelectionLabel();
        renderLines(cfg);
        redraw(cfg);
      });

      const rangeUnsub = context.on('range', () => update());

      const onResize = () => {
        const cfg = { ...projection.defaultConfig, ...(instance.config || {}) };
        redraw(cfg);
      };
      window.addEventListener('resize', onResize);

      update();

      return {
        update,
        resize,
        destroy() {
          selectionUnsub();
          rangeUnsub();
          window.removeEventListener('resize', onResize);
        },
      };
    },
  };

  const defs = [upcoming, recentExpenses, snapshot, balanceCard, recentEntries, projectionTxns, expensesChart, projection];
  return Object.fromEntries(defs.map((def) => [def.type, def]));
}

function widgetSettingsForm(def, instance, accounts = []) {
  const config = { ...def.defaultConfig, ...(instance.config || {}) };
  const checkboxFields = def.settings.filter((field) => field.type === 'checkbox');
  const otherFields = def.settings.filter((field) => field.type !== 'checkbox');

  const renderField = (field) => {
    const id = `ws_${field.key}`;
    if (field.type === 'number') {
      return `
        <div>
          <label>${field.label}</label>
          <input id="${id}" type="number" value="${escapeHtml(String(config[field.key] ?? ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" />
        </div>
      `;
    }
    if (field.type === 'select') {
      const options = (field.options || [])
        .map((opt) => `<option value="${escapeHtml(String(opt.value))}" ${String(config[field.key]) === String(opt.value) ? 'selected' : ''}>${escapeHtml(String(opt.label))}</option>`)
        .join('');
      return `
        <div>
          <label>${field.label}</label>
          <select id="${id}">${options}</select>
        </div>
      `;
    }
    if (field.type === 'account') {
      const opts = ['<option value="">Any account</option>']
        .concat(
          (accounts || []).map(
            (a) =>
              `<option value="${escapeHtml(String(a.id))}" ${String(config[field.key]) === String(a.id) ? 'selected' : ''}>${escapeHtml(a.name || String(a.id))}</option>`
          )
        )
        .join('');
      return `
        <div>
          <label>${field.label}</label>
          <select id="${id}">${opts}</select>
        </div>
      `;
    }
    return '';
  };

  const fields = otherFields.map((field) => renderField(field)).join('');
  const checks = checkboxFields
    .map((field) => {
      const id = `ws_${field.key}`;
      return `
        <label class="dash-settings-check">
          <input type="checkbox" id="${id}" ${config[field.key] ? 'checked' : ''} />
          <span>${field.label}</span>
        </label>
      `;
    })
    .join('');

  return `
    <div class="grid two">
      <div>
        <label>Title</label>
        <input id="ws_title" value="${escapeHtml(instance.title || '')}" placeholder="${escapeHtml(def.title)}" />
      </div>
      ${fields}
    </div>
    ${checks ? `<div class="dash-settings-group">${checks}</div>` : ''}
    <div class="actions" style="margin-top: 12px;">
      <button class="primary" id="ws_save">Save</button>
      <button class="danger" id="ws_remove">Remove widget</button>
    </div>
  `;
}

export async function viewDashboard() {
  activeNav('dashboard');

  const asOf = isoToday();
  const rangeFrom = asOf;
  const rangeTo = addYearsISO(asOf, 1);
  const accountsRes = await api('/api/accounts');
  const accounts = accountsRes.data || [];
  const context = createDashboardContext(asOf, accounts, { from: rangeFrom, to: rangeTo });

  let layout = createDefaultLayout();
  try {
    const layoutRes = await api('/api/dashboard/layout');
    layout = normalizeLayout(layoutRes?.data?.layout);
  } catch {
    layout = createDefaultLayout();
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
          widgets: assignWidgetPositions(normalizeWidgets(layout.widgets), gridState.cols || GRID_MAX_COLS),
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
    if (!layout.widgets.length) layout = createDefaultLayout();
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
      context.setSelection({ locked: false, idx: 0, date: nextFrom, source: null });
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
      layout = createDefaultLayout();
      saveLayout();
      renderWidgets();
    };
  }
  if (applyBtn) applyBtn.onclick = () => applyRange();

  window.addEventListener('resize', () => layoutGrid());

  await renderWidgets();
  applyEditMode();
}
