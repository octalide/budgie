import { $ } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, stableSeriesColor } from '../js/chart.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';

export async function viewProjection() {
    activeNav('projection');
    const as_of_default = isoToday();
    const from_default = as_of_default.slice(0, 4) + '-01-01';

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
            <input id="p_step" value="7" />
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
          <button id="p_occ">Show occurrences (window)</button>
        </div>
        <div style="margin-top: 12px;" id="p_out"></div>
      `
    )}
  `;

    let lastSeries = null;

  const moneyCell = (cents) => {
    const n = Number(cents ?? 0);
    const cls = n < 0 ? 'num neg mono' : n > 0 ? 'num pos mono' : 'num mono';
    return { text: fmtDollarsAccountingFromCents(n), className: cls, title: String(cents ?? '') };
  };

  const colorFor = (key) => {
    // Keep total highly readable (almost-white), and give accounts stable vivid colors.
    if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
    return stableSeriesColor(String(key), 0.92);
  };

  const buildLineToggles = () => {
    const box = $('#p_lines');
    if (!box || !lastSeries) return;

    // Default: show total + all accounts.
    const selected = new Set(['total']);
    for (const a of lastSeries.accounts) selected.add(String(a.id));

    const render = () => {
      const lines = [];

      lines.push(
        `<label class="chart-line">
          <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
          <span class="chart-swatch" style="background:${colorFor('total')}"></span>
          <span>Total</span>
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

    const redraw = () => {
        if (!lastSeries) return;
        const dates = lastSeries.dates;

    const selected = lineState?.getSelected ? lineState.getSelected() : new Set(['total']);
    const series = [];

    if (selected.has('total')) {
      series.push({
        name: 'Total',
        values: lastSeries.total_cents.map((v) => Number(v)),
        color: lineState?.colorForKey ? lineState.colorForKey('total') : colorFor('total'),
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
        color: lineState?.colorForKey ? lineState.colorForKey(key) : colorFor(key),
        width: 2,
      });
    });

        const canvas = $('#p_chart');
        if (!canvas) return;
        drawLineChart(canvas, {
            labels: dates,
      series,
            xTicks: 4,
        });
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
            `;

            wireTableFilters($('#p_out'));
            redraw();

            // Redraw on resize.
            window.onresize = redraw;
        } catch (e) {
            alert(e.message);
        }
    };

    $('#p_occ').onclick = async () => {
        try {
            const from_date = $('#p_from').value;
            const to_date = $('#p_as_of').value;
            const res = await api(
                `/api/occurrences?from_date=${encodeURIComponent(from_date)}&to_date=${encodeURIComponent(to_date)}`
            );
            const rows = res.data.slice(0, 300).map((o) => ({
                date: o.occ_date,
                kind: o.kind,
                name: o.name,
              amount: moneyCell(o.amount_cents),
                src: o.src_account_id ?? '',
                dest: o.dest_account_id ?? '',
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
