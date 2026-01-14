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

    const state = {
      includeLiabilities: false,
      includeInterest: true,
      showHidden: false,
    };

    const balancesRes = await api(`/api/balances?${new URLSearchParams({ mode: 'actual', as_of }).toString()}`);
    const balancesAll = balancesRes.data || [];

    const fetchSeries = async () => {
      const qs = new URLSearchParams({
        mode: 'projected',
        from_date: as_of,
        to_date,
        step_days: '7',
      });
      if (state.includeInterest) qs.set('include_interest', '1');
      const seriesRes = await api(`/api/balances/series?${qs.toString()}`);
      return seriesRes.data;
    };

    let seriesData = await fetchSeries();

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
                <div class="table-tools table-tools--wrap" style="margin-bottom: 10px;">
                  <label class="chart-line" style="gap: 10px;">
                    <input type="checkbox" id="d_inc_liab" />
                    <span>Include liabilities</span>
                  </label>
                  <label class="chart-line" style="gap: 10px;">
                    <input type="checkbox" id="d_show_hidden" />
                    <span>Show hidden accounts</span>
                  </label>
                </div>

                <div class="notice" id="d_snapshot_stats"></div>

                <div class="dash-snapshot-table" id="d_snapshot_table"></div>
              </div>
            `
          )}

          ${card(
              'Next 6 months',
              'Projected total (and optional per-account lines).',
              `
              <div class="dash-projection">
                <div class="table-tools table-tools--wrap" style="margin-bottom: 10px;">
                  <label class="chart-line" style="gap: 10px;">
                    <input type="checkbox" id="d_inc_interest" checked />
                    <span>Include interest</span>
                  </label>
                </div>
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

    const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
    const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

    const applyAccountFilters = (arr) =>
        (arr || []).filter((r) => {
            if (!state.showHidden && isHidden(r)) return false;
            if (!state.includeLiabilities && isLiability(r)) return false;
            return true;
        });

    const computeTotalSeries = (accounts) => {
        const dates = seriesData?.dates || [];
        const out = new Array(dates.length).fill(0);
        for (const a of accounts || []) {
            const vals = a.balance_cents || [];
            for (let i = 0; i < out.length; i++) out[i] += Number(vals[i] ?? 0);
        }
        return out;
    };

    const renderSnapshot = () => {
        const balances = applyAccountFilters(balancesAll);
        const netWorthCents = balances.reduce((acc, r) => acc + Number(r.balance_cents ?? 0), 0);

        $('#d_snapshot_stats').innerHTML = `
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

        $('#d_snapshot_table').innerHTML = table(
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
        );

        wireTableFilters($('#page'));
    };

    const box = $('#d_lines');

    const colorFor = (key) => {
        if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
        return stableSeriesColor(String(key), 0.92);
    };

    const selected = new Set(['total']);

    const filteredSeriesAccounts = () => applyAccountFilters(seriesData?.accounts || []);

    const seriesTotalValues = () => computeTotalSeries(filteredSeriesAccounts());

    const redraw = () => {
        const canvas = $('#d_chart');
        if (!canvas || !seriesData) return;

        const sel = selected;
        const s = [];

        if (sel.has('total')) {
            s.push({
                name: 'Total',
            values: seriesTotalValues().map((v) => Number(v)),
                color: colorFor('total'),
                width: 3,
            });
        }

        filteredSeriesAccounts().forEach((a) => {
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

        const accts = filteredSeriesAccounts();
        accts.forEach((a) => {
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
          for (const a of filteredSeriesAccounts()) selected.add(String(a.id));
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

    // Wire dashboard controls.
    const liab = $('#d_inc_liab');
    const hidden = $('#d_show_hidden');
    const interest = $('#d_inc_interest');

    if (liab) liab.checked = state.includeLiabilities;
    if (hidden) hidden.checked = state.showHidden;
    if (interest) interest.checked = state.includeInterest;

    const reRender = () => {
      renderSnapshot();
      // Drop selections that are no longer visible.
      const visible = new Set(filteredSeriesAccounts().map((a) => String(a.id)));
      for (const key of Array.from(selected)) {
        if (key !== 'total' && !visible.has(key)) selected.delete(key);
      }
      renderToggles();
      redraw();
    };

    liab?.addEventListener('change', () => {
      state.includeLiabilities = Boolean(liab.checked);
      reRender();
    });
    hidden?.addEventListener('change', () => {
      state.showHidden = Boolean(hidden.checked);
      reRender();
    });
    interest?.addEventListener('change', async () => {
      state.includeInterest = Boolean(interest.checked);
      seriesData = await fetchSeries();
      reRender();
    });

    renderSnapshot();
}
