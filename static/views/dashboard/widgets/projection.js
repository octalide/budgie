import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../../../js/chart.js';
import { addMonthsISO, clamp, asInt } from '../utils.js';

export const projection = {
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
    showLiabilities: false,
    showHidden: false,
    accountId: '',
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'includeInterest', label: 'Include interest', type: 'checkbox' },
    { key: 'stepDays', label: 'Granularity (days)', type: 'number', min: 1, max: 366, step: 1 },
    { key: 'monthsAhead', label: 'Months ahead', type: 'number', min: 1, max: 24, step: 1 },
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
      selected: new Set(['gross', 'net']),
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

    const filteredAccounts = (cfg, options = {}) => {
      const accounts = state.seriesData?.accounts || [];
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const includeLiabilities = options.includeLiabilities ?? true;
      return accounts.filter((a) => {
        if (!cfg.showHidden && Number(a.exclude_from_dashboard ?? 0) === 1) return false;
        if (!includeLiabilities && Number(a.is_liability ?? 0) === 1) return false;
        if (accountId && Number(a.id) !== accountId) return false;
        return true;
      });
    };

    const computeGrossSeries = (accounts) => {
      const dates = state.seriesData?.dates || [];
      const out = new Array(dates.length).fill(0);
      for (const a of accounts || []) {
        const vals = a.balance_cents || [];
        for (let i = 0; i < out.length; i++) out[i] += Number(vals[i] ?? 0);
      }
      return out;
    };

    const computeNetSeries = (accountsVisible) => {
      const dates = state.seriesData?.dates || [];
      const assets = new Array(dates.length).fill(0);
      const liab = new Array(dates.length).fill(0);

      for (const a of accountsVisible || []) {
        const isL = Number(a?.is_liability ?? 0) === 1;
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
      if (key === 'gross') return 'hsla(210, 15%, 92%, 0.92)';
      if (key === 'net') return 'hsla(150, 55%, 74%, 0.92)';
      return stableSeriesColor(String(key), 0.92);
    };

    const ensureSelected = (accounts, allowNet) => {
      if (!state.selected.size) {
        state.selected.add('gross');
        if (allowNet) state.selected.add('net');
      }
      const visible = new Set(accounts.map((a) => String(a.id)));
      for (const key of Array.from(state.selected)) {
        if (key !== 'gross' && key !== 'net' && !visible.has(key)) state.selected.delete(key);
      }
      if (!state.selected.has('gross')) state.selected.add('gross');
      if (allowNet && !state.selected.has('net')) state.selected.add('net');
      if (!allowNet) state.selected.delete('net');
    };

    const redraw = (cfg) => {
      if (!canvas || !state.seriesData) return;
      const sel = state.selected;
      const series = [];

      const lineAccounts = filteredAccounts(cfg, { includeLiabilities: Boolean(cfg.showLiabilities) });
      const grossAccounts = filteredAccounts(cfg, { includeLiabilities: false });
      const netAccounts = filteredAccounts(cfg, { includeLiabilities: true });
      const allowNet = Boolean(cfg.showLiabilities);
      const acctKeys = lineAccounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
      const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
      const colorFor = (key) => {
        if (key === 'gross' || key === 'net') return fixedLineColor(key);
        return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
      };

      const grossSeries = computeGrossSeries(grossAccounts);
      const netSeries = computeNetSeries(netAccounts);

      if (sel.has('gross')) {
        series.push({
          name: 'Gross',
          values: grossSeries.map((v) => Number(v)),
          color: colorFor('gross'),
          width: 3,
        });
      }

      if (allowNet && sel.has('net')) {
        series.push({
          name: 'Net',
          values: netSeries.map((v) => Number(v)),
          color: colorFor('net'),
          width: 3,
        });
      }

      lineAccounts.forEach((a) => {
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
      const lineAccounts = filteredAccounts(cfg, { includeLiabilities: Boolean(cfg.showLiabilities) });
      const grossAccounts = filteredAccounts(cfg, { includeLiabilities: false });
      const netAccounts = filteredAccounts(cfg, { includeLiabilities: true });
      const allowNet = Boolean(cfg.showLiabilities);
      ensureSelected(lineAccounts, allowNet);

      const acctKeys = lineAccounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
      const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
      const colorFor = (key) => {
        if (key === 'gross' || key === 'net') return fixedLineColor(key);
        return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
      };

      const idx = selectedIndex();
      const dates = state.seriesData?.dates || [];
      const date = dates[idx] || context.asOf;

      const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

      const grossSeries = computeGrossSeries(grossAccounts);
      const netSeries = computeNetSeries(netAccounts);
      const lines = [];
      lines.push(
        `<label class="chart-line">
            <input type="checkbox" data-line="gross" ${state.selected.has('gross') ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor('gross')}"></span>
            <span title="assets only">Gross</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(grossSeries[idx] ?? 0)}</span>
          </label>`
      );
      lines.push(
        `<label class="chart-line">
            <input type="checkbox" data-line="net" ${allowNet && state.selected.has('net') ? 'checked' : ''} ${allowNet ? '' : 'disabled'} />
            <span class="chart-swatch" style="background:${colorFor('net')}"></span>
            <span title="assets - liabilities">Net</span>
            <span class="chart-line-val mono" title="${escapeHtml(date)}">${allowNet ? valText(netSeries[idx] ?? 0) : '—'}</span>
          </label>`
      );

      lineAccounts.forEach((a) => {
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
            <label class="chart-line" style="margin-left: 6px;">
              <input type="checkbox" data-lines-liabilities ${allowNet ? 'checked' : ''} />
              <span>Show liabilities</span>
            </label>
          </div>
          <div class="chart-lines-list">${lines.join('')}</div>
        `;

      const allBtn = linesBox.querySelector('[data-lines-all]');
      const noneBtn = linesBox.querySelector('[data-lines-none]');
      const liabToggle = linesBox.querySelector('[data-lines-liabilities]');
      allBtn.onclick = () => {
        state.selected.clear();
        state.selected.add('gross');
        if (allowNet) state.selected.add('net');
        for (const a of lineAccounts) state.selected.add(String(a.id));
        renderLines(cfg);
        redraw(cfg);
      };
      noneBtn.onclick = () => {
        state.selected.clear();
        state.selected.add('gross');
        if (allowNet) state.selected.add('net');
        renderLines(cfg);
        redraw(cfg);
      };

      if (liabToggle) {
        liabToggle.onchange = () => {
          const next = Boolean(liabToggle.checked);
          if (!next) state.selected.delete('net');
          if (context.updateWidgetConfig) context.updateWidgetConfig(instance.id, { showLiabilities: next });
          else instance.config = { ...(instance.config || {}), showLiabilities: next };
          const nextCfg = { ...projection.defaultConfig, ...(instance.config || {}), showLiabilities: next };
          renderLines(nextCfg);
          redraw(nextCfg);
        };
      }

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
        state.selected.add('gross');
        if (cfg.showLiabilities) state.selected.add('net');
        const lineAccounts = filteredAccounts(cfg, { includeLiabilities: Boolean(cfg.showLiabilities) });
        for (const a of lineAccounts) state.selected.add(String(a.id));
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
