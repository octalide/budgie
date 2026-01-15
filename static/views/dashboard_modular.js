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

const WIDGET_SIZES = [
  { value: 'sm', label: 'Small' },
  { value: 'md', label: 'Medium' },
  { value: 'lg', label: 'Large' },
];

const DASHBOARD_LAYOUT_VERSION = 2;

const WIDGET_DEFS = createWidgetDefinitions();

let widgetSeq = 0;

function newWidgetId(prefix) {
  widgetSeq += 1;
  return `${prefix}-${Date.now().toString(36)}-${widgetSeq.toString(36)}`;
}

function normalizeLayout(raw) {
  if (raw && raw.version === DASHBOARD_LAYOUT_VERSION && Array.isArray(raw.widgets)) {
    const widgets = normalizeWidgets(raw.widgets);
    if (widgets.length) return { version: DASHBOARD_LAYOUT_VERSION, widgets };
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
  const size = WIDGET_SIZES.some((s) => s.value === raw.size) ? raw.size : def.defaultSize;
  const title = typeof raw.title === 'string' && raw.title.trim() ? raw.title.trim() : def.title;
  const config = {
    ...def.defaultConfig,
    ...(raw.config && typeof raw.config === 'object' ? raw.config : {}),
  };
  return { id, type, size, title, config };
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
    .map((type) => ({
      id: newWidgetId(type),
      type,
      size: WIDGET_DEFS[type].defaultSize,
      title: WIDGET_DEFS[type].title,
      config: { ...WIDGET_DEFS[type].defaultConfig },
    }));
  return { version: DASHBOARD_LAYOUT_VERSION, widgets };
}

function createDefaultLayout() {
  const defaults = [
    { type: 'upcoming', size: 'md' },
    { type: 'snapshot', size: 'md' },
    { type: 'projection', size: 'lg' },
  ];
  return {
    version: DASHBOARD_LAYOUT_VERSION,
    widgets: defaults.map((entry) => {
      const def = WIDGET_DEFS[entry.type];
      return {
        id: newWidgetId(entry.type),
        type: entry.type,
        size: entry.size || def.defaultSize,
        title: def.title,
        config: { ...def.defaultConfig },
      };
    }),
  };
}

function createDashboardContext(asOf) {
  const emitter = createEmitter();
  const balancesCache = new Map();
  const seriesCache = new Map();
  const occurrencesCache = new Map();
  let accountMeta = new Map();

  const context = {
    asOf,
    selection: { locked: false, date: asOf, idx: 0, source: null },
    on: emitter.on,
    emit: emitter.emit,
    setSelection(next) {
      context.selection = { ...context.selection, ...next };
      emitter.emit('selection', context.selection);
    },
    async getBalances(date) {
      const key = String(date || asOf);
      if (balancesCache.has(key)) return balancesCache.get(key);
      const res = await api(`/api/balances?${new URLSearchParams({ mode: 'actual', as_of: key }).toString()}`);
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
    async getAccountMeta() {
      if (accountMeta.size) return accountMeta;
      await context.getBalances(asOf);
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
    defaultConfig: {
      days: 7,
      maxRows: 7,
      syncSelection: true,
      showHidden: false,
    },
    settings: [
      { key: 'days', label: 'Window (days)', type: 'number', min: 1, max: 365, step: 1 },
      { key: 'maxRows', label: 'Max rows', type: 'number', min: 1, max: 50, step: 1 },
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
        const maxRows = clamp(asInt(cfg.maxRows, 7), 1, 50);
        const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
        const toDate = addDaysISO(baseDate, days);

        const occ = await context.getOccurrences(baseDate, toDate);
        const meta = await context.getAccountMeta();

        const acctName = (id) => {
          if (id === null || id === undefined || id === '') return '';
          const n = Number(id);
          if (!Number.isFinite(n)) return '';
          return meta.get(n)?.name || String(id);
        };
        const isHidden = (id) => {
          if (id === null || id === undefined || id === '') return false;
          const n = Number(id);
          if (!Number.isFinite(n)) return false;
          return Number(meta.get(n)?.exclude_from_dashboard ?? 0) === 1;
        };

        const filtered = (occ || [])
          .filter((o) => String(o?.kind || '') === 'E')
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

        const shown = filtered.slice(0, maxRows);
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
          ${filtered.length > maxRows ? `<div class="dash-upcoming-more">Showing ${maxRows} of ${filtered.length}.</div>` : ''}
        `;
      };

      const unsub = context.on('selection', () => update());
      update();

      return {
        update,
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
    defaultConfig: {
      includeLiabilities: false,
      showHidden: false,
      syncSelection: true,
    },
    settings: [
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
        const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
        const balancesAll = await context.getBalances(baseDate);

        const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
        const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

        const balances = (balancesAll || []).filter((r) => {
          if (!cfg.showHidden && isHidden(r)) return false;
          if (!cfg.includeLiabilities && isLiability(r)) return false;
          return true;
        });

        const netWorthCents = balances.reduce((acc, r) => acc + Number(r.balance_cents ?? 0), 0);

        if (statsEl) {
          statsEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px;">
              <div>
                <div style="font-size:12px; color: var(--muted);">Net worth</div>
                <div class="mono" style="font-size:18px; margin-top:4px;">${fmtDollarsAccountingFromCents(netWorthCents)}</div>
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
            ['account', 'opening', 'delta', 'balance'],
            balances.map((r) => ({
              account: r.name,
              opening: moneyCell(r.opening_balance_cents),
              delta: moneyCell(r.delta_cents),
              balance: moneyCell(r.balance_cents),
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
        destroy() {
          unsub();
        },
      };
    },
  };

  const projection = {
    type: 'projection',
    title: 'Projection',
    description: 'Projected balances and selectable lines.',
    defaultSize: 'lg',
    defaultConfig: {
      includeInterest: true,
      stepDays: 7,
      monthsAhead: 6,
      includeLiabilities: false,
      showHidden: false,
    },
    settings: [
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
        selected: new Set(['total']),
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
        return accounts.filter((a) => {
          if (!cfg.showHidden && Number(a.exclude_from_dashboard ?? 0) === 1) return false;
          if (!cfg.includeLiabilities && Number(a.is_liability ?? 0) === 1) return false;
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

      const ensureSelected = (accounts) => {
        if (!state.selected.size) state.selected.add('total');
        const visible = new Set(accounts.map((a) => String(a.id)));
        for (const key of Array.from(state.selected)) {
          if (key !== 'total' && !visible.has(key)) state.selected.delete(key);
        }
        if (!state.selected.has('total')) state.selected.add('total');
      };

      const redraw = (cfg) => {
        if (!canvas || !state.seriesData) return;
        const sel = state.selected;
        const series = [];

        const accounts = filteredAccounts(cfg);
        const acctKeys = accounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
          if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const totalSeries = computeTotalSeries(accounts);

        if (sel.has('total')) {
          series.push({
            name: 'Total',
            values: totalSeries.map((v) => Number(v)),
            color: colorFor('total'),
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
        ensureSelected(accounts);

        const acctKeys = accounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
          if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
          return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const idx = selectedIndex();
        const dates = state.seriesData?.dates || [];
        const date = dates[idx] || context.asOf;

        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

        const totalSeries = computeTotalSeries(accounts);
        const lines = [];
        lines.push(
          `<label class="chart-line">
            <input type="checkbox" data-line="total" ${state.selected.has('total') ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor('total')}"></span>
            <span>Total</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(totalSeries[idx] ?? 0)}</span>
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
          for (const a of accounts) state.selected.add(String(a.id));
          renderLines(cfg);
          redraw(cfg);
        };
        noneBtn.onclick = () => {
          state.selected.clear();
          state.selected.add('total');
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
        const monthsAhead = clamp(asInt(cfg.monthsAhead, 6), 1, 24);
        const fromDate = context.asOf;
        const toDate = addMonthsISO(fromDate, monthsAhead);
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
        }

        updateSelectionLabel();
        renderLines(cfg);
        redraw(cfg);
        syncSelection(cfg);
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

      const onResize = () => {
        const cfg = { ...projection.defaultConfig, ...(instance.config || {}) };
        redraw(cfg);
      };
      window.addEventListener('resize', onResize);

      update();

      return {
        update,
        destroy() {
          selectionUnsub();
          window.removeEventListener('resize', onResize);
        },
      };
    },
  };

  return { upcoming, snapshot, projection };
}

function widgetSettingsForm(def, instance) {
  const config = { ...def.defaultConfig, ...(instance.config || {}) };
  const sizeValue = WIDGET_SIZES.some((s) => s.value === instance.size) ? instance.size : def.defaultSize;
  const fields = def.settings
    .map((field) => {
      const id = `ws_${field.key}`;
      if (field.type === 'checkbox') {
        return `
          <div>
            <label class="chart-line" style="gap: 10px;">
              <input type="checkbox" id="${id}" ${config[field.key] ? 'checked' : ''} />
              <span>${field.label}</span>
            </label>
          </div>
        `;
      }
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
      return '';
    })
    .join('');

  const sizeOpts = WIDGET_SIZES.map((opt) => `<option value="${opt.value}" ${opt.value === sizeValue ? 'selected' : ''}>${opt.label}</option>`).join('');

  return `
    <div class="grid two">
      <div>
        <label>Title</label>
        <input id="ws_title" value="${escapeHtml(instance.title || '')}" placeholder="${escapeHtml(def.title)}" />
      </div>
      <div>
        <label>Size</label>
        <select id="ws_size">${sizeOpts}</select>
      </div>
      ${fields}
    </div>
    <div class="actions" style="margin-top: 12px;">
      <button class="primary" id="ws_save">Save</button>
      <button class="danger" id="ws_remove">Remove widget</button>
    </div>
  `;
}

export async function viewDashboard() {
  activeNav('dashboard');

  const asOf = isoToday();
  const toDate = addMonthsISO(asOf, 6);
  const context = createDashboardContext(asOf);

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
          <div class="dash-subtitle">as-of ${escapeHtml(asOf)} • lookahead to ${escapeHtml(toDate)}</div>
        </div>
        <div class="dash-actions">
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
  let editMode = false;

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
      el.className = `dash-widget size-${instance.size}`;
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

    wireDragAndDrop();
    applyEditMode();

    await Promise.all(Array.from(controllers.values()).map((ctrl) => ctrl?.update?.()));
  };

  const applyEditMode = () => {
    if (!root) return;
    root.classList.toggle('edit-mode', editMode);
    grid.querySelectorAll('.dash-widget').forEach((widget) => {
      widget.setAttribute('draggable', 'false');
      const handle = widget.querySelector('.dash-widget-handle');
      if (handle) handle.setAttribute('draggable', editMode ? 'true' : 'false');
    });
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
      bodyHtml: widgetSettingsForm(def, instance),
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
        const sizeSel = modalRoot.querySelector('#ws_size');
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
          }
        }

        instance.title = titleInput?.value?.trim() || def.title;
        instance.size = sizeSel?.value && WIDGET_SIZES.some((s) => s.value === sizeSel.value) ? sizeSel.value : def.defaultSize;
        instance.config = newConfig;

        layout = { version: DASHBOARD_LAYOUT_VERSION, widgets: normalizeWidgets(layout.widgets) };
        saveLayout();
        renderWidgets();
        close();
      });
    }
  };

  const addWidget = (type) => {
    const def = WIDGET_DEFS[type];
    if (!def) return;
    const instance = {
      id: newWidgetId(type),
      type,
      size: def.defaultSize,
      title: def.title,
      config: { ...def.defaultConfig },
    };
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

  const updateLayoutFromDOM = () => {
    const order = Array.from(grid.querySelectorAll('.dash-widget'))
      .map((el) => el.dataset.widgetId)
      .filter(Boolean);
    const index = new Map(order.map((id, idx) => [id, idx]));
    layout.widgets.sort((a, b) => (index.get(a.id) ?? 999) - (index.get(b.id) ?? 999));
    saveLayout();
  };

  const wireDragAndDrop = () => {
    if (!grid) return;

    grid.ondragover = (e) => {
      if (!editMode) return;
      e.preventDefault();
      const dragging = grid.querySelector('.dash-widget.dragging');
      if (!dragging) return;
      const dropTarget = e.target.closest('.dash-widget');
      if (!dropTarget || dropTarget === dragging) return;

      const rect = dropTarget.getBoundingClientRect();
      const before = e.clientY < rect.top + rect.height / 2;
      if (before) grid.insertBefore(dragging, dropTarget);
      else grid.insertBefore(dragging, dropTarget.nextSibling);
    };

    grid.ondrop = (e) => {
      if (!editMode) return;
      e.preventDefault();
    };

    grid.ondragend = (e) => {
      if (!editMode) return;
      const dragging = e.target.closest('.dash-widget');
      if (dragging) dragging.classList.remove('dragging');
      updateLayoutFromDOM();
    };

    grid.querySelectorAll('.dash-widget-handle').forEach((handle) => {
      handle.ondragstart = (e) => {
        if (!editMode) {
          e.preventDefault();
          return;
        }
        const widget = handle.closest('.dash-widget');
        if (!widget) {
          e.preventDefault();
          return;
        }
        widget.classList.add('dragging');
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move';
          e.dataTransfer.setData('text/plain', widget.dataset.widgetId || '');
        }
      };
    });
  };

  const addBtn = $('#dash_add');
  const editBtn = $('#dash_edit');
  const resetBtn = $('#dash_reset');

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

  await renderWidgets();
  applyEditMode();
}
