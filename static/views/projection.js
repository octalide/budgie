import { $ } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../js/chart.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';

function addYearsISO(isoDate, years) {
  // isoDate: YYYY-MM-DD
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setFullYear(d.getFullYear() + Number(years || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function isoToDayNumber(iso) {
  // Convert YYYY-MM-DD to an integer day number (UTC-ish) for cheap comparisons.
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return NaN;
  return Math.floor(t / 86400000);
}

function lowerBound(arr, x) {
  // First index i where arr[i] >= x
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export async function viewProjection() {
    activeNav('projection');
  const from_default = isoToday();
  const as_of_default = addYearsISO(from_default, 1);

    $('#page').innerHTML = `
    ${card(
        'Projection',
        'Compute balances as-of a date (actual or projected using schedules + revisions).',
        `
        <div class="grid three">
          <div>
            <label>Mode</label>
            <select id="p_mode">
              <option value="projected" selected>projected</option>
              <option value="actual">actual</option>
            </select>
          </div>
          <div>
            <label>As-of date</label>
            <input id="p_as_of" value="${as_of_default}" />
          </div>
          <div>
            <label>From date (chart/window start)</label>
            <input id="p_from" value="${from_default}" />
          </div>
        </div>
        <div class="grid three" style="margin-top: 12px;">
          <div>
            <label>Chart step (days)</label>
            <input id="p_step" value="1" />
          </div>
          <div>
            <label>Interest</label>
            <label class="chart-line" style="gap: 10px; align-items:center;">
              <input type="checkbox" id="p_inc_interest" checked />
              <span>Include interest (projected)</span>
            </label>
          </div>
          <div style="grid-column: 2 / -1;">
            <label>Chart lines</label>
            <div id="p_lines" class="chart-lines">
              <div class="notice">Run to load chart lines.</div>
            </div>
          </div>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button class="primary" id="p_run">Run</button>
          <button id="p_occ">Show scheduled transactions (window)</button>
        </div>
        <div style="margin-top: 12px;" id="p_out"></div>
      `
    )}
  `;

    let lastSeries = null;
    let lastOcc = null;

  const moneyCell = (cents) => {
    const n = Number(cents ?? 0);
    const cls = n < 0 ? 'num neg mono' : n > 0 ? 'num pos mono' : 'num mono';
    return { text: fmtDollarsAccountingFromCents(n), className: cls, title: String(cents ?? '') };
  };

  const fixedLineColor = (key) => {
    // Keep aggregate lines highly readable (almost-white / mint).
    if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
    if (key === 'net') return 'hsla(150, 55%, 74%, 0.92)';
    return stableSeriesColor(String(key), 0.92);
  };

  const buildLineToggles = () => {
    const box = $('#p_lines');
    if (!box || !lastSeries) return;

    // Default: show total + all accounts.
    const selected = new Set(['total', 'net']);
    for (const a of lastSeries.accounts) selected.add(String(a.id));

    const accountKeys = (lastSeries.accounts || []).map((a) => {
      const id = String(a.id);
      return `acct:${id}:${a.name || ''}`;
    });
    const palette = distinctSeriesPalette(accountKeys, 0.92, { seed: 'accounts' });

    const colorFor = (key) => {
      if (key === 'total' || key === 'net') return fixedLineColor(key);
      return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
    };

    const render = () => {
      const lines = [];

      lines.push(
        `<label class="chart-line">
          <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
          <span class="chart-swatch" style="background:${colorFor('total')}"></span>
          <span>Total (gross)</span>
        </label>`
      );

      lines.push(
        `<label class="chart-line">
          <input type="checkbox" data-line="net" ${selected.has('net') ? 'checked' : ''} />
          <span class="chart-swatch" style="background:${colorFor('net')}"></span>
          <span title="gross - liabilities">Net</span>
        </label>`
      );

      lastSeries.accounts.forEach((a) => {
        const id = String(a.id);
        // Include name in the key to reduce accidental collisions if ids ever overlap.
        const key = `acct:${id}:${a.name || ''}`;
        lines.push(
          `<label class="chart-line">
            <input type="checkbox" data-line="${id}" ${selected.has(id) ? 'checked' : ''} />
            <span class="chart-swatch" style="background:${colorFor(key)}"></span>
            <span>${a.name}</span>
          </label>`
        );
      });

      box.innerHTML = `
        <div class="chart-lines-actions">
          <button id="p_lines_all" type="button">All</button>
          <button id="p_lines_none" type="button">None</button>
        </div>
        <div class="chart-lines-list">${lines.join('')}</div>
      `;

      $('#p_lines_all').onclick = () => {
        selected.clear();
        selected.add('total');
        selected.add('net');
        for (const a of lastSeries.accounts) selected.add(String(a.id));
        render();
        redraw();
      };
      $('#p_lines_none').onclick = () => {
        selected.clear();
        render();
        redraw();
      };

      box.querySelectorAll('input[data-line]').forEach((inp) => {
        inp.onchange = () => {
          const key = inp.getAttribute('data-line');
          if (!key) return;
          if (inp.checked) selected.add(key);
          else selected.delete(key);
          redraw();
        };
      });
    };

    const getSelected = () => selected;

    render();

    return { getSelected, colorForKey: colorFor };
  };

  let lineState = null;
  let expenseState = null;

    const redraw = () => {
        if (!lastSeries) return;
        const dates = lastSeries.dates;

    const selected = lineState?.getSelected ? lineState.getSelected() : new Set(['total', 'net']);
    const series = [];

    const gross = lastSeries.total_cents.map((v) => Number(v));
    const liability = new Array(gross.length).fill(0);
    for (const a of lastSeries.accounts || []) {
      if (Number(a?.is_liability ?? 0) !== 1) continue;
      const vals = a.balance_cents || [];
      for (let i = 0; i < liability.length; i++) liability[i] += Number(vals[i] ?? 0);
    }
    const net = gross.map((g, i) => g - (liability[i] ?? 0));

    if (selected.has('total')) {
      series.push({
        name: 'Total (gross)',
        values: gross,
        color: lineState?.colorForKey ? lineState.colorForKey('total') : fixedLineColor('total'),
        width: 3,
      });
    }

    if (selected.has('net')) {
      series.push({
        name: 'Net',
        values: net,
        color: lineState?.colorForKey ? lineState.colorForKey('net') : fixedLineColor('net'),
        width: 3,
      });
    }

    lastSeries.accounts.forEach((a) => {
      const id = String(a.id);
      if (!selected.has(id)) return;
      const key = `acct:${id}:${a.name || ''}`;
      series.push({
        name: a.name,
        values: a.balance_cents.map((v) => Number(v)),
        color: lineState?.colorForKey ? lineState.colorForKey(key) : stableSeriesColor(String(key), 0.92),
        width: 2,
      });
    });

        const canvas = $('#p_chart');
        if (!canvas) return;
        drawLineChart(canvas, {
            labels: dates,
      series,
            xTicks: 4,
          crosshair: true,
        });
    };

  const renderExpenses = () => {
    const wrap = $('#p_expenses');
    if (!wrap) return;

    if (!lastSeries || !lastOcc) {
      wrap.innerHTML = `<div class="notice">Run to load recurring expenses.</div>`;
      return;
    }

    const dates = lastSeries.dates || [];
    if (dates.length === 0) {
      wrap.innerHTML = `<div class="notice">No series dates available.</div>`;
      return;
    }

    const dayAxis = dates.map(isoToDayNumber);
    if (!Number.isFinite(dayAxis[0])) {
      wrap.innerHTML = `<div class="notice">Could not parse date axis.</div>`;
      return;
    }

    // Group occurrences by schedule (only expenses).
    const groups = new Map();
    for (const o of lastOcc || []) {
      if (!o) continue;
      if (String(o.kind || '') !== 'E') continue;
      const sid = Number(o.schedule_id);
      if (!Number.isFinite(sid)) continue;
      const name = String(o.name || `Schedule #${sid}`);
      const amt = Number(o.amount_cents ?? 0);
      const d = String(o.occ_date || '');
      const dn = isoToDayNumber(d);
      if (!Number.isFinite(dn)) continue;
      let g = groups.get(sid);
      if (!g) {
        g = {
          id: sid,
          name,
          count: 0,
          total: 0,
          minDay: dn,
          maxDay: dn,
          minDate: d,
          maxDate: d,
          buckets: new Array(dates.length).fill(0),
        };
        groups.set(sid, g);
      }
      g.count++;
      g.total += amt;
      if (dn < g.minDay) {
        g.minDay = dn;
        g.minDate = d;
      }
      if (dn > g.maxDay) {
        g.maxDay = dn;
        g.maxDate = d;
      }

      // Bucket into the first visible index whose date >= occ_date.
      let idx = lowerBound(dayAxis, dn);
      if (idx >= dates.length) idx = dates.length - 1;
      g.buckets[idx] += amt;
    }

    const all = Array.from(groups.values());
    all.sort((a, b) => (b.total || 0) - (a.total || 0));

    const topN = 12;
    const shown = all.slice(0, topN);

    // Build cumulative series per schedule.
    const keys = shown.map((g) => `sched:${g.id}:${g.name}`);
    const palette = distinctSeriesPalette(keys, 0.92, { seed: 'expenses' });

    // Total spend should reflect *all* expense schedules, not just the top N.
    const totalBucketsAll = new Array(dates.length).fill(0);
    for (const g of all) {
      for (let i = 0; i < totalBucketsAll.length; i++) totalBucketsAll[i] += Number(g.buckets[i] ?? 0);
    }
    let totRun = 0;
    const totalCum = totalBucketsAll.map((v) => {
      totRun += Number(v ?? 0);
      return totRun;
    });

    for (const g of shown) {
      let run = 0;
      g.cum = g.buckets.map((v) => {
        run += Number(v ?? 0);
        return run;
      });
    }

    // Defaults: show total + top 5 schedules.
    const selected = new Set(['total']);
    shown.slice(0, 5).forEach((g) => selected.add(String(g.id)));

    const colorFor = (k) => {
      if (k === 'total') return 'hsla(40, 80%, 72%, 0.92)';
      return palette.get(String(k)) || stableSeriesColor(String(k), 0.92);
    };

    const redrawExpenses = () => {
      const canvas = $('#p_exp_chart');
      if (!canvas) return;
      const series = [];
      if (selected.has('total')) {
        series.push({ name: 'Total spend', values: totalCum, color: colorFor('total'), width: 3 });
      }
      for (const g of shown) {
        if (!selected.has(String(g.id))) continue;
        const k = `sched:${g.id}:${g.name}`;
        series.push({ name: g.name, values: g.cum || [], color: colorFor(k), width: 2 });
      }
      drawLineChart(canvas, { labels: dates, series, xTicks: 4, crosshair: true, formatValue: (v) => fmtDollarsAccountingFromCents(Math.round(v)) });
    };

    const lines = [];
    lines.push(
      `<label class="chart-line">
        <input type="checkbox" data-exp-line="total" ${selected.has('total') ? 'checked' : ''} />
        <span class="chart-swatch" style="background:${colorFor('total')}"></span>
        <span>Total spend</span>
      </label>`
    );
    shown.forEach((g) => {
      const id = String(g.id);
      const k = `sched:${g.id}:${g.name}`;
      lines.push(
        `<label class="chart-line">
          <input type="checkbox" data-exp-line="${id}" ${selected.has(id) ? 'checked' : ''} />
          <span class="chart-swatch" style="background:${colorFor(k)}"></span>
          <span>${g.name}</span>
        </label>`
      );
    });

    const rows = shown.map((g) => ({
      schedule: g.name,
      count: g.count,
      total: { text: fmtDollarsAccountingFromCents(g.total), className: 'num mono', title: String(g.total) },
      first: g.minDate || '',
      last: g.maxDate || '',
    }));

    wrap.innerHTML = `
      ${card(
        'Recurring expenses (cumulative)',
        `Top ${shown.length} by total cost in window`,
        `
          <div class="table-tools table-tools--wrap" style="margin-bottom: 10px; align-items:center;">
            <div>
              <label>Lines</label>
              <div id="p_exp_lines" class="chart-lines">${lines.join('')}</div>
            </div>
          </div>
          <canvas id="p_exp_chart" class="chart"></canvas>
          <div style="margin-top: 12px;">
            ${table(['schedule', 'count', 'total', 'first', 'last'], rows, null, {
              id: 'projection-expenses',
              filter: true,
              filterPlaceholder: 'Filter expenses…',
            })}
          </div>
        `
      )}
    `;

    wireTableFilters(wrap);

    wrap.querySelectorAll('input[data-exp-line]').forEach((inp) => {
      inp.onchange = () => {
        const k = inp.getAttribute('data-exp-line');
        if (!k) return;
        if (inp.checked) selected.add(k);
        else selected.delete(k);
        redrawExpenses();
      };
    });

    expenseState = { redraw: redrawExpenses };
    redrawExpenses();
  };

    $('#p_run').onclick = async () => {
        try {
            const mode = $('#p_mode').value;
            const as_of = $('#p_as_of').value;
            const from_date = $('#p_from').value;
        const step_days = $('#p_step').value;
      const include_interest = Boolean($('#p_inc_interest')?.checked) && mode === 'projected';

            const qs = new URLSearchParams({ as_of, mode });
            if (mode === 'projected') qs.set('from_date', from_date);

            const res = await api(`/api/balances?${qs.toString()}`);

            // Fetch series for charts (even for actual mode it can be useful).
            const qsSeries = new URLSearchParams({ mode, from_date, to_date: as_of, step_days });
            if (include_interest) qsSeries.set('include_interest', '1');
            const series = await api(`/api/balances/series?${qsSeries.toString()}`);
            lastSeries = series.data;

            // Occurrences for recurring-expenses visualization.
            const occ = await api(`/api/occurrences?${new URLSearchParams({ from_date, to_date: as_of }).toString()}`);
            lastOcc = occ.data;

            let lastByID = null;
            if (include_interest && lastSeries && Array.isArray(lastSeries.accounts)) {
              lastByID = new Map();
              for (const a of lastSeries.accounts) {
                const vals = a.balance_cents || [];
                lastByID.set(Number(a.id), Number(vals[vals.length - 1] ?? 0));
              }
            }

            const rows = res.data.map((r) => ({
              account: r.name,
              opening: moneyCell(r.opening_balance_cents),
              delta: moneyCell(r.delta_cents),
              balance: moneyCell(
                include_interest && lastByID ? lastByID.get(Number(r.id)) : Number(r.balance_cents ?? r.projected_balance_cents)
              ),
            }));

            lineState = buildLineToggles();

            $('#p_out').innerHTML = `
              ${card(
                'Chart',
                `mode=${mode}${include_interest ? ' + interest' : ''}, ${from_date} → ${as_of} (step ${step_days || '7'}d)`,
                `<canvas id="p_chart" class="chart"></canvas>`
              )}
              <div style="margin-top: 12px;">
              ${card(
                'Balances',
                `mode=${mode}${include_interest ? ' + interest' : ''}`, 
                table(['account', 'opening', 'delta', 'balance'], rows, null, {
                  id: 'projection-balances',
                  filter: true,
                  filterPlaceholder: 'Filter balances…',
                })
              )}
              </div>
              <div style="margin-top: 12px;" id="p_expenses"></div>
            `;

            wireTableFilters($('#p_out'));
            redraw();
            renderExpenses();

            // Redraw on resize.
            window.onresize = () => {
              redraw();
              if (expenseState?.redraw) expenseState.redraw();
            };
        } catch (e) {
            alert(e.message);
        }
    };

    $('#p_occ').onclick = async () => {
        try {
            const from_date = $('#p_from').value;
            const to_date = $('#p_as_of').value;

        const accountsRes = await api('/api/accounts');
        const acctByID = new Map((accountsRes.data || []).map((a) => [Number(a.id), a]));
        const acctName = (id) => {
          if (id === null || id === undefined || id === '') return '';
          const n = Number(id);
          if (!Number.isFinite(n)) return '';
          return acctByID.get(n)?.name || String(id);
        };

            const res = await api(
                `/api/occurrences?from_date=${encodeURIComponent(from_date)}&to_date=${encodeURIComponent(to_date)}`
            );
            const rows = res.data.slice(0, 300).map((o) => ({
                date: o.occ_date,
                kind: o.kind,
                name: o.name,
              amount: moneyCell(o.amount_cents),
          src: acctName(o.src_account_id),
          dest: acctName(o.dest_account_id),
            }));

        $('#p_out').innerHTML = card(
          'Occurrences',
          `Showing ${rows.length} (cap 300) from ${from_date} → ${to_date}`,
          table(['date', 'kind', 'name', 'amount', 'src', 'dest'], rows, null, {
            id: 'projection-occurrences',
            filter: true,
            filterPlaceholder: 'Filter occurrences…',
          })
        );

        wireTableFilters($('#p_out'));
        } catch (e) {
            alert(e.message);
        }
    };
}
