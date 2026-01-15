import { $, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsAccountingFromCents } from '../js/money.js';
import { drawLineChart, distinctSeriesPalette, stableSeriesColor } from '../js/chart.js';
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

const DASHBOARD_WIDGETS = ['upcoming', 'snapshot', 'projection'];
const DASHBOARD_POSITIONS = ['left-top', 'right', 'left-bottom'];
const DASHBOARD_POSITION_CLASSES = {
  'left-top': 'dash-pos-left-top',
  'left-bottom': 'dash-pos-left-bottom',
  right: 'dash-pos-right',
};
const DASHBOARD_DEFAULT_LAYOUT = {
  version: 1,
  positions: {
    upcoming: 'left-top',
    snapshot: 'left-bottom',
    projection: 'right',
  },
};

function normalizeDashboardLayout(layout) {
  const out = {
    version: 1,
    positions: {},
  };
  const positions = layout && typeof layout === 'object' ? layout.positions : null;
  const used = new Set();
  for (const widget of DASHBOARD_WIDGETS) {
    const pos = positions && typeof positions === 'object' ? positions[widget] : null;
    if (DASHBOARD_POSITIONS.includes(pos) && !used.has(pos)) {
      out.positions[widget] = pos;
      used.add(pos);
    }
  }
  const remaining = DASHBOARD_POSITIONS.filter((pos) => !used.has(pos));
  for (const widget of DASHBOARD_WIDGETS) {
    if (!out.positions[widget]) {
      out.positions[widget] = remaining.shift() || DASHBOARD_DEFAULT_LAYOUT.positions[widget];
    }
  }
  return out;
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
        stepDays: 1,
        lockedIdx: null,
    };

    const UPCOMING_DAYS = 7;

    const balancesRes = await api(`/api/balances?${new URLSearchParams({ mode: 'actual', as_of }).toString()}`);
    const balancesAll = balancesRes.data || [];

    const fetchUpcoming = async () => {
        const toUpcoming = addDaysISO(as_of, UPCOMING_DAYS);
        const qs = new URLSearchParams({ from_date: as_of, to_date: toUpcoming });
        const res = await api(`/api/occurrences?${qs.toString()}`);
        return { to: toUpcoming, data: res.data || [] };
    };

    const fetchSeries = async () => {
      const qs = new URLSearchParams({
        mode: 'projected',
        from_date: as_of,
        to_date,
        step_days: String(state.stepDays),
      });
      if (state.includeInterest) qs.set('include_interest', '1');
      const seriesRes = await api(`/api/balances/series?${qs.toString()}`);
      return seriesRes.data;
    };

    let seriesData = await fetchSeries();
    let upcoming = await fetchUpcoming();

    let layout = normalizeDashboardLayout(null);
    try {
      const layoutRes = await api('/api/dashboard/layout');
      layout = normalizeDashboardLayout(layoutRes?.data?.layout);
    } catch {
      layout = normalizeDashboardLayout(null);
    }

    const dashboardBody = `
      <div class="dash-grid" id="dash_grid">
        <div class="dash-widget" data-widget="upcoming">
          ${card(
            'Upcoming expenses',
            'Scheduled expenses in the next 7 days.',
            `
              <div id="d_upcoming" class="dash-upcoming"></div>
            `
          )}
        </div>

        <div class="dash-widget" data-widget="snapshot">
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
        </div>

        <div class="dash-widget" data-widget="projection">
          ${card(
            'Next 6 months',
            'Projected total (and optional per-account lines).',
            `
              <div class="dash-projection">
                <div class="table-tools table-tools--wrap" style="margin-bottom: 10px; align-items:center;">
                  <label class="chart-line" style="gap: 10px;">
                    <input type="checkbox" id="d_inc_interest" checked />
                    <span>Include interest</span>
                  </label>
                  <label class="chart-line" style="gap: 10px; margin-left: auto;">
                    <span>Granularity</span>
                    <select id="d_step">
                      <option value="1">Daily</option>
                      <option value="7">Weekly</option>
                      <option value="14">Biweekly</option>
                      <option value="30">Monthly</option>
                    </select>
                  </label>
                </div>
                <div id="d_sel" class="dash-selection"></div>
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
      </div>
    `;

    $('#page').innerHTML = `
      <div class="dashboard">
        ${card('Dashboard', `as-of ${as_of} • lookahead to ${to_date}`, dashboardBody)}
      </div>
    `;

    const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
    const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

    const acctByID = new Map(balancesAll.map((a) => [Number(a.id), a]));
    const acctName = (id) => {
      if (id === null || id === undefined || id === '') return '';
      const n = Number(id);
      if (!Number.isFinite(n)) return '';
      return acctByID.get(n)?.name || String(id);
    };

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

    const renderUpcoming = () => {
      const box = $('#d_upcoming');
      if (!box) return;

      const days = UPCOMING_DAYS;
      const toUpcoming = upcoming?.to || addDaysISO(as_of, days);
      const occ = (upcoming?.data || []).filter((o) => String(o?.kind || '') === 'E');

      // Respect "Show hidden accounts" for upcoming items (based on src account).
      const filtered = occ.filter((o) => {
        if (state.showHidden) return true;
        const src = o?.src_account_id;
        const a = src === null || src === undefined ? null : acctByID.get(Number(src));
        return a ? !isHidden(a) : true;
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

      const maxRows = 7;
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
      const subtitle = `${as_of} → ${toUpcoming}`;
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

    const box = $('#d_lines');

    const totalColor = 'hsla(210, 15%, 92%, 0.92)';

    const selected = new Set();

    const filteredSeriesAccounts = () => applyAccountFilters(seriesData?.accounts || []);

    const selectAllLines = () => {
      selected.clear();
      selected.add('total');
      for (const a of filteredSeriesAccounts()) {
        selected.add(String(a.id));
      }
    };

    const seriesTotalValues = () => computeTotalSeries(filteredSeriesAccounts());

    const selectedIndex = () => {
      const n = seriesData?.dates?.length || 0;
      const idx = state.lockedIdx === null || state.lockedIdx === undefined ? 0 : Number(state.lockedIdx);
      if (!Number.isFinite(idx) || n <= 0) return 0;
      return clamp(Math.round(idx), 0, n - 1);
    };

    const updateSelectionLabel = () => {
      const el = $('#d_sel');
      if (!el) return;
      const dates = seriesData?.dates || [];
      const idx = selectedIndex();
      const date = dates[idx] || as_of;
      if (state.lockedIdx === null || state.lockedIdx === undefined) {
        el.innerHTML = `Selection: <span class="mono">${escapeHtml(date)}</span> (timeline start — click chart to lock)`;
      } else {
        el.innerHTML = `Selection locked: <span class="mono">${escapeHtml(date)}</span> (Shift+click or Esc to clear)`;
      }
    };

    const redraw = () => {
        const canvas = $('#d_chart');
        if (!canvas || !seriesData) return;

        const sel = selected;
        const s = [];

      const accts = filteredSeriesAccounts();
      const acctKeys = accts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
      const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
      const colorFor = (key) => {
        if (key === 'total') return totalColor;
        return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
      };

        if (sel.has('total')) {
            s.push({
                name: 'Total',
            values: seriesTotalValues().map((v) => Number(v)),
            color: colorFor('total'),
                width: 3,
            });
        }

        accts.forEach((a) => {
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
          crosshair: {
            lockOnClick: true,
            lockedIndex: state.lockedIdx,
            onLockedIndexChange: (idx) => {
              state.lockedIdx = idx;
              updateSelectionLabel();
              renderToggles();
              redraw();
            },
          },
        });
    };

    const renderToggles = () => {
        if (!box || !seriesData) return;

      const accts = filteredSeriesAccounts();
      const acctKeys = accts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
      const palette = distinctSeriesPalette(acctKeys, 0.92, { seed: 'accounts' });
      const colorFor = (key) => {
        if (key === 'total') return totalColor;
        return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
      };

        const idx = selectedIndex();
        const dates = seriesData?.dates || [];
        const date = dates[idx] || as_of;

        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

        const lines = [];

        lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor('total')}"></span>
              <span>Total</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(seriesTotalValues()[idx] ?? 0)}</span>
            </label>`
        );

        accts.forEach((a) => {
            const id = String(a.id);
            const key = `acct:${id}:${a.name || ''}`;
            const v = (a.balance_cents || [])[idx] ?? 0;
            lines.push(
                `<label class="chart-line">
                  <input type="checkbox" data-line="${id}" ${selected.has(id) ? 'checked' : ''} />
                  <span class="chart-swatch" style="background:${colorFor(key)}"></span>
                  <span>${a.name}</span>
                  <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(v)}</span>
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

    const saveLayout = async () => {
      try {
        await api('/api/dashboard/layout', {
          method: 'PUT',
          body: JSON.stringify(layout),
        });
      } catch {
        // ignore layout save errors
      }
    };

    const applyLayout = () => {
      const grid = $('#dash_grid');
      if (!grid) return;

      const widgets = Array.from(grid.querySelectorAll('.dash-widget'));
      const positionBuckets = {
        'left-top': [],
        right: [],
        'left-bottom': [],
      };
      for (const w of widgets) {
        const id = w.getAttribute('data-widget');
        const pos = layout?.positions?.[id] || DASHBOARD_DEFAULT_LAYOUT.positions[id] || 'right';
        w.dataset.pos = pos;
        w.classList.remove(...Object.values(DASHBOARD_POSITION_CLASSES));
        const cls = DASHBOARD_POSITION_CLASSES[pos];
        if (cls) w.classList.add(cls);
        if (positionBuckets[pos]) positionBuckets[pos].push(w);
      }

      const ordered = [
        ...positionBuckets['left-top'],
        ...positionBuckets['right'],
        ...positionBuckets['left-bottom'],
      ];
      for (const w of ordered) grid.appendChild(w);
    };

    const updateLayoutFromDOM = () => {
      const grid = $('#dash_grid');
      if (!grid) return;
      const widgets = Array.from(grid.querySelectorAll('.dash-widget'));
      const positions = {};
      const used = new Set();
      let posIdx = 0;
      for (const w of widgets) {
        const id = w.getAttribute('data-widget');
        if (!DASHBOARD_WIDGETS.includes(id)) continue;
        while (posIdx < DASHBOARD_POSITIONS.length && used.has(DASHBOARD_POSITIONS[posIdx])) {
          posIdx += 1;
        }
        const pos = DASHBOARD_POSITIONS[posIdx] || DASHBOARD_DEFAULT_LAYOUT.positions[id];
        positions[id] = pos;
        used.add(pos);
        posIdx += 1;
      }
      const remaining = DASHBOARD_POSITIONS.filter((pos) => !Object.values(positions).includes(pos));
      for (const widget of DASHBOARD_WIDGETS) {
        if (!positions[widget]) {
          positions[widget] = remaining.shift() || DASHBOARD_DEFAULT_LAYOUT.positions[widget];
        }
      }
      layout = normalizeDashboardLayout({ positions });
      applyLayout();
      saveLayout();
    };

    const wireDragAndDrop = () => {
      const grid = $('#dash_grid');
      if (!grid) return;
      grid.addEventListener('dragover', (e) => {
        e.preventDefault();
        const dragging = grid.querySelector('.dash-widget.dragging');
        if (!dragging) return;

        const dropTarget = e.target.closest('.dash-widget');
        if (!dropTarget || dropTarget === dragging) return;

        const rect = dropTarget.getBoundingClientRect();
        const before = e.clientY < rect.top + rect.height / 2;
        if (before) grid.insertBefore(dragging, dropTarget);
        else grid.insertBefore(dragging, dropTarget.nextSibling);
      });

      grid.addEventListener('drop', (e) => {
        e.preventDefault();
      });

      grid.addEventListener('dragend', (e) => {
        const dragging = e.target.closest('.dash-widget');
        if (dragging) dragging.classList.remove('dragging');
        updateLayoutFromDOM();
      });

      grid.querySelectorAll('.dash-widget').forEach((widget) => {
        widget.setAttribute('draggable', 'true');
        widget.addEventListener('dragstart', (e) => {
          widget.classList.add('dragging');
          if (e.dataTransfer) {
            e.dataTransfer.effectAllowed = 'move';
            e.dataTransfer.setData('text/plain', widget.getAttribute('data-widget') || '');
          }
        });
      });
    };

    applyLayout();
    wireDragAndDrop();

    selectAllLines();
    renderToggles();
    updateSelectionLabel();
    redraw();
    window.onresize = redraw;

    // Wire dashboard controls.
    const liab = $('#d_inc_liab');
    const hidden = $('#d_show_hidden');
    const interest = $('#d_inc_interest');
    const step = $('#d_step');

    if (liab) liab.checked = state.includeLiabilities;
    if (hidden) hidden.checked = state.showHidden;
    if (interest) interest.checked = state.includeInterest;
    if (step) step.value = String(state.stepDays);

    const reRender = () => {
      renderSnapshot();
      renderUpcoming();
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

    step?.addEventListener('change', async () => {
      const n = Number(step.value);
      if (!Number.isFinite(n) || n < 1 || n > 366) return;
      state.stepDays = n;
      seriesData = await fetchSeries();
      reRender();
    });

    renderSnapshot();
    renderUpcoming();
}
