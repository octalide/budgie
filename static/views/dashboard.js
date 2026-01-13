import { $ } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, stableSeriesColor } from '../js/chart.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';

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

export async function viewDashboard() {
    activeNav('dashboard');

    const as_of = isoToday();
    const to_date = addMonthsISO(as_of, 6);

    const moneyCell = (cents) => {
        const n = Number(cents ?? 0);
        const cls = n < 0 ? 'num neg mono' : n > 0 ? 'num pos mono' : 'num mono';
        return { text: fmtDollarsAccountingFromCents(n), className: cls, title: String(cents ?? '') };
    };

    // Fetch snapshot + 6 month series.
    const [balancesRes, seriesRes] = await Promise.all([
        api(`/api/balances?${new URLSearchParams({ mode: 'actual', as_of }).toString()}`),
        api(
            `/api/balances/series?${new URLSearchParams({
                mode: 'projected',
                from_date: as_of,
                to_date,
                step_days: '7',
            }).toString()}`
        ),
    ]);

    const balances = balancesRes.data || [];
    const seriesData = seriesRes.data;

    const netWorthCents = balances.reduce((acc, r) => acc + Number(r.balance_cents ?? 0), 0);

    $('#page').innerHTML = `
    <div class="dashboard">
    ${card(
        'Dashboard',
        `as-of ${as_of} • lookahead to ${to_date}`,
        `
        <div class="split">
          ${card(
              'Snapshot',
              'Current balances (actual).',
              `
              <div class="dash-snapshot">
                <div class="notice">
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
                </div>

                <div class="dash-snapshot-table" style="margin-top: 12px;">
                  ${table(
                      ['account', 'opening', 'delta', 'balance'],
                      balances.map((r) => ({
                          account: r.name,
                          opening: moneyCell(r.opening_balance_cents),
                          delta: moneyCell(r.delta_cents),
                          balance: moneyCell(r.balance_cents),
                      })),
                      null,
                      {
                          id: 'dashboard-balances',
                          filter: true,
                          filterPlaceholder: 'Filter accounts…',
                      }
                  )}
                </div>
              </div>
            `
          )}

          ${card(
              'Next 6 months',
              'Projected total (and optional per-account lines).',
              `
              <div class="dash-projection">
                <div>
                  <label>Lines</label>
                  <div id="d_lines" class="chart-lines"></div>
                </div>
                <div class="dash-projection-chart">
                  <label>Projection</label>
                  <canvas id="d_chart" class="chart chart--small"></canvas>
                </div>
              </div>
            `
          )}
        </div>
        `
    )}
    </div>
  `;

    wireTableFilters($('#page'));

    const box = $('#d_lines');

    const colorFor = (key) => {
        if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
        return stableSeriesColor(String(key), 0.92);
    };

    const selected = new Set(['total']);

    const redraw = () => {
        const canvas = $('#d_chart');
        if (!canvas || !seriesData) return;

        const sel = selected;
        const s = [];

        if (sel.has('total')) {
            s.push({
                name: 'Total',
                values: (seriesData.total_cents || []).map((v) => Number(v)),
                color: colorFor('total'),
                width: 3,
            });
        }

        (seriesData.accounts || []).forEach((a) => {
            const id = String(a.id);
            if (!sel.has(id)) return;
            const key = `acct:${id}:${a.name || ''}`;
            s.push({
                name: a.name,
                values: (a.balance_cents || []).map((v) => Number(v)),
                color: colorFor(key),
                width: 2,
            });
        });

        drawLineChart(canvas, {
            labels: seriesData.dates || [],
            series: s,
            xTicks: 4,
        });
    };

    const renderToggles = () => {
        if (!box || !seriesData) return;

        const lines = [];

        lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor('total')}"></span>
              <span>Total</span>
            </label>`
        );

        (seriesData.accounts || []).forEach((a) => {
            const id = String(a.id);
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
            <button id="d_lines_all" type="button">All</button>
            <button id="d_lines_none" type="button">None</button>
          </div>
          <div class="chart-lines-list">${lines.join('')}</div>
        `;

        $('#d_lines_all').onclick = () => {
            selected.clear();
            selected.add('total');
            for (const a of seriesData.accounts || []) selected.add(String(a.id));
            renderToggles();
            redraw();
        };
        $('#d_lines_none').onclick = () => {
            selected.clear();
            selected.add('total');
            renderToggles();
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

    renderToggles();
    redraw();
    window.onresize = redraw;
}
