import { $, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../js/chart.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';
import { addYearsISO, addDaysISO, clamp, isoToDayNumber, lowerBound, buildDateAxis } from '../js/dateutil.js';

export async function viewExpenses() {
    activeNav('expenses');

    const from_default = isoToday();
    const to_default = addYearsISO(from_default, 1);

    const state = {
        from_date: from_default,
        to_date: to_default,
        stepDays: 1,
        topN: 12,
        lockedIdx: null,
    };

    const SELECTION_WINDOW_DAYS = 14;

    // Persist selected schedules across reruns.
    const selected = new Set(['total']);

    let axis = { dates: [], days: [] };
    let occ = [];
    let groups = []; // computed

    const renderShell = () => {
        $('#page').innerHTML = `
      <div class="expenses">
      ${card(
          'Expenses',
          'Recurring scheduled expenses, grouped by schedule and shown cumulatively over time.',
          `
          <div class="exp-filterbar">
            <div class="table-tools table-tools--wrap" style="margin-bottom: 0;">
              <div class="tool tool--small">
                <label>From</label>
                <input id="e_from" value="${escapeHtml(state.from_date)}" />
              </div>
              <div class="tool tool--small">
                <label>To</label>
                <input id="e_to" value="${escapeHtml(state.to_date)}" />
              </div>
              <div class="tool tool--tiny">
                <label>Granularity</label>
                <select id="e_step">
                  <option value="1" ${state.stepDays === 1 ? 'selected' : ''}>Daily</option>
                  <option value="7" ${state.stepDays === 7 ? 'selected' : ''}>Weekly</option>
                  <option value="14" ${state.stepDays === 14 ? 'selected' : ''}>Biweekly</option>
                  <option value="30" ${state.stepDays === 30 ? 'selected' : ''}>Monthly</option>
                </select>
              </div>
              <div class="tool tool--tiny">
                <label>Top</label>
                <select id="e_top">
                  <option value="8" ${state.topN === 8 ? 'selected' : ''}>8</option>
                  <option value="12" ${state.topN === 12 ? 'selected' : ''}>12</option>
                  <option value="20" ${state.topN === 20 ? 'selected' : ''}>20</option>
                </select>
              </div>
              <div class="tool tool--actions">
                <button class="primary" id="e_run" type="button">Run</button>
              </div>
            </div>
          </div>

          <div class="exp-split">
            <div class="exp-chartpane">
              <div class="proj-selection" style="margin-bottom: 10px;">
                <div id="e_sel"></div>
                <button id="e_sel_clear" type="button">Clear</button>
              </div>
              <label>Lines</label>
              <div id="e_lines" class="chart-lines" style="margin-bottom: 10px;"><div class="notice">Run to load lines.</div></div>
              <canvas id="e_chart" class="chart exp-chart"></canvas>
            </div>
            <div class="exp-tablepane">
              <div class="proj-txns-head" style="border-bottom: 1px solid var(--border);">
                <div>
                  <div class="proj-txns-title">Top scheduled expenses</div>
                  <div class="proj-txns-sub" id="e_tbl_sub"></div>
                </div>
              </div>
              <div id="e_table" class="proj-txns-body"></div>
            </div>
          </div>
        `
      )}
      </div>
    `;

        const from = $('#e_from');
        const to = $('#e_to');
        const step = $('#e_step');
        const top = $('#e_top');
        const run = $('#e_run');
        const clear = $('#e_sel_clear');

        from?.addEventListener('change', () => (state.from_date = String(from.value || state.from_date)));
        to?.addEventListener('change', () => (state.to_date = String(to.value || state.to_date)));
        step?.addEventListener('change', () => {
            const n = Number(step.value);
            if (Number.isFinite(n) && n >= 1 && n <= 366) state.stepDays = n;
        });
        top?.addEventListener('change', () => {
            const n = Number(top.value);
            if (Number.isFinite(n) && n >= 1 && n <= 200) state.topN = n;
        });

        clear?.addEventListener('click', () => {
            state.lockedIdx = null;
            updateSelectionLabel();
            renderLines();
            redrawChart();
            renderTable();
        });

        run?.addEventListener('click', async () => {
            await fetchAndCompute();
            renderLines();
            redrawChart();
            renderTable();
            updateSelectionLabel();
        });
    };

    const selectedIndex = () => {
        const n = axis?.dates?.length || 0;
        const idx = state.lockedIdx === null || state.lockedIdx === undefined ? 0 : Number(state.lockedIdx);
        if (!Number.isFinite(idx) || n <= 0) return 0;
        return clamp(Math.round(idx), 0, n - 1);
    };

    const updateSelectionLabel = () => {
        const el = $('#e_sel');
        if (!el) return;
        const idx = selectedIndex();
        const date = axis?.dates?.[idx] || state.from_date;
        if (state.lockedIdx === null || state.lockedIdx === undefined) {
            el.innerHTML = `Selection: <span class="mono">${escapeHtml(date)}</span> (timeline start - click chart to lock)`;
        } else {
            el.innerHTML = `Selection locked: <span class="mono">${escapeHtml(date)}</span> (Shift+click or Esc to clear)`;
        }

        const clearBtn = $('#e_sel_clear');
        if (clearBtn) clearBtn.style.display = state.lockedIdx === null || state.lockedIdx === undefined ? 'none' : '';
    };

    const selectedWindow = () => {
        const full = { from: state.from_date, to: state.to_date, label: `${state.from_date} → ${state.to_date}` };
        if (state.lockedIdx === null || state.lockedIdx === undefined) return full;
        const dates = axis?.dates || [];
        if (!dates.length) return full;
        const idx = selectedIndex();
        const date = dates[idx] || state.from_date;
        const half = Math.floor(SELECTION_WINDOW_DAYS / 2);
        let from = addDaysISO(date, -half);
        let to = addDaysISO(date, half);
        if (from < state.from_date) from = state.from_date;
        if (to > state.to_date) to = state.to_date;
        return { from, to, label: `${from} → ${to}` };
    };

    const fetchAndCompute = async () => {
        axis = buildDateAxis(state.from_date, state.to_date, state.stepDays);
        if (!axis.dates.length) {
            occ = [];
            groups = [];
            return;
        }

        const occRes = await api(
            `/api/occurrences?${new URLSearchParams({ from_date: state.from_date, to_date: state.to_date }).toString()}`
        );
        occ = (occRes.data || []).slice();

        // Group by schedule (expenses only).
        const bySched = new Map();
        for (const o of occ) {
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
                    count: 0,
                    total: 0,
                    minDate: d,
                    maxDate: d,
                    buckets: new Array(axis.dates.length).fill(0),
                };
                bySched.set(sid, g);
            }

            g.count++;
            g.total += amt;
            if (d < g.minDate) g.minDate = d;
            if (d > g.maxDate) g.maxDate = d;

            let idx = lowerBound(axis.days, dn);
            if (idx >= axis.days.length) idx = axis.days.length - 1;
            g.buckets[idx] += amt;
        }

        const all = Array.from(bySched.values());
        all.sort((a, b) => (b.total || 0) - (a.total || 0));

        groups = all.slice(0, Math.max(1, Math.floor(state.topN || 12)));

        // Defaults: show total + top 5 schedules.
        selected.clear();
        selected.add('total');
        groups.slice(0, 5).forEach((g) => selected.add(String(g.id)));

        // Precompute cumulative arrays.
        for (const g of groups) {
            let run = 0;
            g.cum = g.buckets.map((v) => {
                run += Number(v ?? 0);
                return run;
            });
        }

        // Total spend across all schedules.
        const totalBuckets = new Array(axis.dates.length).fill(0);
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
        const box = $('#e_lines');
        if (!box) return;
        if (!axis?.dates?.length) {
            box.innerHTML = `<div class="notice">No date axis.</div>`;
            return;
        }
        if (!groups.length) {
            box.innerHTML = `<div class="notice">No scheduled expenses in this window.</div>`;
            return;
        }

        const idx = selectedIndex();
        const date = axis.dates[idx] || state.from_date;

        const keys = groups.map((g) => `sched:${g.id}:${g.name}`);
        const palette = distinctSeriesPalette(keys, 0.92, { seed: 'expenses' });
        const colorFor = (key) => {
            if (key === 'total') return 'hsla(40, 80%, 72%, 0.92)';
            return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

        const lines = [];
        lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor('total')}"></span>
              <span>Total spend</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(state.totalCum?.[idx] ?? 0)}</span>
            </label>`
        );

        for (const g of groups) {
            const id = String(g.id);
            const key = `sched:${g.id}:${g.name}`;
            lines.push(
                `<label class="chart-line">
                  <input type="checkbox" data-line="${id}" ${selected.has(id) ? 'checked' : ''} />
                  <span class="chart-swatch" style="background:${colorFor(key)}"></span>
                  <span>${escapeHtml(g.name)}</span>
                  <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(g.cum?.[idx] ?? 0)}</span>
                </label>`
            );
        }

        box.innerHTML = `
      <div class="chart-lines-actions">
        <button id="e_lines_all" type="button">All</button>
        <button id="e_lines_none" type="button">None</button>
      </div>
      <div class="chart-lines-list">${lines.join('')}</div>
    `;

        $('#e_lines_all').onclick = () => {
            selected.clear();
            selected.add('total');
            for (const g of groups) selected.add(String(g.id));
            renderLines();
            redrawChart();
        };
        $('#e_lines_none').onclick = () => {
            selected.clear();
            renderLines();
            redrawChart();
        };

        box.querySelectorAll('input[data-line]').forEach((inp) => {
            inp.onchange = () => {
                const key = inp.getAttribute('data-line');
                if (!key) return;
                if (inp.checked) selected.add(key);
                else selected.delete(key);
                redrawChart();
            };
        });
    };

    const redrawChart = () => {
        const canvas = $('#e_chart');
        if (!canvas) return;
        if (!axis?.dates?.length) return;

        const keys = groups.map((g) => `sched:${g.id}:${g.name}`);
        const palette = distinctSeriesPalette(keys, 0.92, { seed: 'expenses' });
        const colorFor = (key) => {
            if (key === 'total') return 'hsla(40, 80%, 72%, 0.92)';
            return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const series = [];
        if (selected.has('total')) {
            series.push({ name: 'Total spend', values: (state.totalCum || []).map((v) => Number(v)), color: colorFor('total'), width: 3 });
        }
        for (const g of groups) {
            const id = String(g.id);
            if (!selected.has(id)) continue;
            const k = `sched:${g.id}:${g.name}`;
            series.push({ name: g.name, values: (g.cum || []).map((v) => Number(v)), color: colorFor(k), width: 2 });
        }

        drawLineChart(canvas, {
            labels: axis.dates,
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
                    renderTable();
                },
            },
            formatValue: (v) => fmtDollarsAccountingFromCents(Math.round(v)),
        });
    };

    const renderTable = () => {
        const sub = $('#e_tbl_sub');
        const box = $('#e_table');
        if (!sub || !box) return;

        const dateRange = selectedWindow();
        sub.textContent = `${dateRange.label} • ${groups.length} shown`;

        const groupIds = new Set(groups.map((g) => Number(g.id)));
        const bySched = new Map();
        for (const o of occ || []) {
            if (!o) continue;
            if (String(o.kind || '') !== 'E') continue;
            const sid = Number(o.schedule_id);
            if (!Number.isFinite(sid) || !groupIds.has(sid)) continue;
            const d = String(o.occ_date || '');
            if (!d || d < dateRange.from || d > dateRange.to) continue;

            let agg = bySched.get(sid);
            if (!agg) {
                agg = { count: 0, total: 0, minDate: d, maxDate: d };
                bySched.set(sid, agg);
            }
            agg.count += 1;
            agg.total += Number(o.amount_cents ?? 0);
            if (d < agg.minDate) agg.minDate = d;
            if (d > agg.maxDate) agg.maxDate = d;
        }

        const rows = groups.map((g) => {
            const agg = bySched.get(Number(g.id)) || { count: 0, total: 0, minDate: '', maxDate: '' };
            return {
                schedule: escapeHtml(g.name),
                count: agg.count,
                total: { text: fmtDollarsAccountingFromCents(agg.total), className: 'num mono', title: String(agg.total) },
                first: agg.minDate || '',
                last: agg.maxDate || '',
            };
        });

        box.innerHTML = table(['schedule', 'count', 'total', 'first', 'last'], rows, null, {
            id: 'expenses-top',
            filter: true,
            filterPlaceholder: 'Filter schedules…',
        });
        wireTableFilters(box);
    };

    renderShell();
    await fetchAndCompute();
    renderLines();
    redrawChart();
    renderTable();
    updateSelectionLabel();

    const _resizeHandler = () => {
        redrawChart();
    };
    window.addEventListener('resize', _resizeHandler);
}
