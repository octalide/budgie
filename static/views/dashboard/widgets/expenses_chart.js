import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../../../js/chart.js';
import { addMonthsISO, buildDateAxis, isoToDayNumber, lowerBound, clamp, asInt } from '../utils.js';

export const expensesChart = {
  type: 'expenses_chart',
  title: 'Expenses',
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
