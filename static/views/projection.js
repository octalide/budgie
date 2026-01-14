import { $, escapeHtml } from '../js/dom.js';
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

export async function viewProjection() {
    activeNav('projection');

    const from_default = isoToday();
    const to_default = addYearsISO(from_default, 1);

    const state = {
        mode: 'projected',
        from_date: from_default,
        to_date: to_default,
        stepDays: 1,
        includeInterest: true,
        includeLiabilities: false,
        showHidden: false,
        lockedIdx: null,
    };

    const SELECTION_WINDOW_DAYS = 14;

    let acctByID = new Map();
    let seriesData = null;
    let occData = [];

    // Persist line selections across refetches.
    const selected = new Set(['total', 'net']);

    const moneyCell = (cents) => {
        const n = Number(cents ?? 0);
        const cls = n < 0 ? 'num neg mono' : n > 0 ? 'num pos mono' : 'num mono';
        return { text: fmtDollarsAccountingFromCents(n), className: cls, title: String(cents ?? '') };
    };

    const acctName = (id) => {
        if (id === null || id === undefined || id === '') return '';
        const n = Number(id);
        if (!Number.isFinite(n)) return '';
        return acctByID.get(n)?.name || String(id);
    };

    const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
    const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

    const applyAccountFilters = (arr) =>
        (arr || []).filter((r) => {
            if (!state.showHidden && isHidden(r)) return false;
            if (!state.includeLiabilities && isLiability(r)) return false;
            return true;
        });

    const selectedIndex = () => {
        const n = seriesData?.dates?.length || 0;
        const idx = state.lockedIdx === null || state.lockedIdx === undefined ? 0 : Number(state.lockedIdx);
        if (!Number.isFinite(idx) || n <= 0) return 0;
        return clamp(Math.round(idx), 0, n - 1);
    };

    const fixedLineColor = (key) => {
        if (key === 'total') return 'hsla(210, 15%, 92%, 0.92)';
        if (key === 'net') return 'hsla(150, 55%, 74%, 0.92)';
        return stableSeriesColor(String(key), 0.92);
    };

    const computeTotalSeries = (accounts) => {
        const dates = seriesData?.dates || [];
        const out = new Array(dates.length).fill(0);
        for (const a of accounts || []) {
            const vals = a.balance_cents || [];
            for (let i = 0; i < out.length; i++) out[i] += Number(vals[i] ?? 0);
        }
        return out;
    };

    const computeNetSeries = (accountsVisible) => {
        // Net worth = sum(assets) - sum(liabilities).
        // Liabilities may be stored as negative (e.g., -30000) or positive (e.g., 30000);
        // treat the magnitude as the amount owed and always subtract it.
        // Also respect the "Include liabilities" toggle.
        const dates = seriesData?.dates || [];
        const assets = new Array(dates.length).fill(0);
        const liab = new Array(dates.length).fill(0);

        for (const a of accountsVisible || []) {
            const isL = Number(a?.is_liability ?? 0) === 1;
            if (isL && !state.includeLiabilities) continue;

            const vals = a.balance_cents || [];
            for (let i = 0; i < dates.length; i++) {
                const v = Number(vals[i] ?? 0);
                if (isL) liab[i] += Math.abs(v);
                else assets[i] += v;
            }
        }

        return assets.map((v, i) => v - (liab[i] ?? 0));
    };

    const updateSelectionLabel = () => {
        const el = $('#p_sel');
        if (!el) return;
        const dates = seriesData?.dates || [];
        const idx = selectedIndex();
        const date = dates[idx] || state.from_date;
        if (state.lockedIdx === null || state.lockedIdx === undefined) {
            el.innerHTML = `Selection: <span class="mono">${escapeHtml(date)}</span> (timeline start - click chart to lock)`;
        } else {
            el.innerHTML = `Selection locked: <span class="mono">${escapeHtml(date)}</span> (Shift+click or Esc to clear)`;
        }

        const clearBtn = $('#p_sel_clear');
        if (clearBtn) clearBtn.style.display = state.lockedIdx === null || state.lockedIdx === undefined ? 'none' : '';
    };

    const selectedWindow = () => {
        const full = { from: state.from_date, to: state.to_date, label: `${state.from_date} → ${state.to_date}` };
        if (state.lockedIdx === null || state.lockedIdx === undefined) return full;
        const dates = seriesData?.dates || [];
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

    const renderShell = () => {
        $('#page').innerHTML = `
      <div class="projection">
      ${card(
          'Projection',
          'Timeline projection with a linked transactions view.',
          `
          <div class="proj-filterbar">
            <div class="proj-filterrow table-tools table-tools--wrap" style="margin-bottom: 0;">
              <div class="tool tool--tiny">
                <label>Mode</label>
                <select id="p_mode">
                  <option value="projected" selected>projected</option>
                  <option value="actual">actual</option>
                </select>
              </div>

              <div class="tool tool--small">
                <label>From</label>
                <input id="p_from" value="${escapeHtml(state.from_date)}" />
              </div>
              <div class="tool tool--small">
                <label>To</label>
                <input id="p_to" value="${escapeHtml(state.to_date)}" />
              </div>

              <div class="tool tool--tiny">
                <label>Granularity</label>
                <select id="p_step">
                  <option value="1" selected>Daily</option>
                  <option value="7">Weekly</option>
                  <option value="14">Biweekly</option>
                  <option value="30">Monthly</option>
                </select>
              </div>

              <label class="chart-line tool tool--small" style="gap:10px; align-items:center;">
                <input type="checkbox" id="p_inc_interest" checked />
                <span>Include interest</span>
              </label>

              <label class="chart-line tool tool--small" style="gap:10px; align-items:center;">
                <input type="checkbox" id="p_inc_liab" />
                <span>Include liabilities</span>
              </label>

              <label class="chart-line tool tool--small" style="gap:10px; align-items:center;">
                <input type="checkbox" id="p_show_hidden" />
                <span>Show hidden</span>
              </label>

              <div class="tool tool--actions">
                <button class="primary" id="p_run" type="button">Run</button>
              </div>
            </div>

            <div style="margin-top: 10px;">
              <label>Lines</label>
              <div id="p_lines" class="chart-lines"><div class="notice">Loading…</div></div>
            </div>
          </div>

          <div class="proj-split">
            <div class="proj-chartpane">
              <div class="proj-selection">
                <div id="p_sel"></div>
                <button id="p_sel_clear" type="button">Clear</button>
              </div>
              <canvas id="p_chart" class="chart proj-chart"></canvas>
            </div>

            <div class="proj-txnpane">
              <div class="proj-txns-head">
                <div>
                  <div class="proj-txns-title">Transactions (scheduled)</div>
                  <div class="proj-txns-sub" id="p_txns_sub"></div>
                </div>
              </div>
              <div id="p_txns" class="proj-txns-body"></div>
            </div>
          </div>
        `
      )}
      </div>
    `;

        const mode = $('#p_mode');
        const from = $('#p_from');
        const to = $('#p_to');
        const step = $('#p_step');
        const interest = $('#p_inc_interest');
        const liab = $('#p_inc_liab');
        const hidden = $('#p_show_hidden');
        const runBtn = $('#p_run');
        const clearBtn = $('#p_sel_clear');

        if (mode) mode.value = state.mode;
        if (from) from.value = state.from_date;
        if (to) to.value = state.to_date;
        if (step) step.value = String(state.stepDays);
        if (interest) interest.checked = state.includeInterest;
        if (liab) liab.checked = state.includeLiabilities;
        if (hidden) hidden.checked = state.showHidden;

        const syncInterestEnabled = () => {
            const enabled = state.mode === 'projected';
            if (interest) interest.disabled = !enabled;
            if (!enabled) state.includeInterest = false;
            if (interest) interest.checked = Boolean(state.includeInterest);
        };
        syncInterestEnabled();

        mode?.addEventListener('change', () => {
            state.mode = String(mode.value || 'projected');
            syncInterestEnabled();
        });
        from?.addEventListener('change', () => (state.from_date = String(from.value || state.from_date)));
        to?.addEventListener('change', () => (state.to_date = String(to.value || state.to_date)));
        step?.addEventListener('change', () => {
            const n = Number(step.value);
            if (Number.isFinite(n) && n >= 1 && n <= 366) state.stepDays = n;
        });
        interest?.addEventListener('change', () => (state.includeInterest = Boolean(interest.checked)));
        liab?.addEventListener('change', () => {
            state.includeLiabilities = Boolean(liab.checked);
            renderLines();
            redrawChart();
        });
        hidden?.addEventListener('change', () => {
            state.showHidden = Boolean(hidden.checked);
            renderLines();
            redrawChart();
            renderTxns();
        });
        clearBtn?.addEventListener('click', () => {
            state.lockedIdx = null;
            updateSelectionLabel();
            renderLines();
            redrawChart();
            renderTxns();
        });
        runBtn?.addEventListener('click', async () => {
            await fetchAll();

            const n = seriesData?.dates?.length || 0;
            if (state.lockedIdx !== null && state.lockedIdx !== undefined) {
                const idx = Number(state.lockedIdx);
                if (!Number.isFinite(idx) || idx < 0 || idx >= n) state.lockedIdx = null;
            }

            renderLines();
            redrawChart();
            renderTxns();
            updateSelectionLabel();
        });
    };

    const fetchAll = async () => {
        // Accounts for names + hidden flags.
        const accountsRes = await api('/api/accounts');
        acctByID = new Map((accountsRes.data || []).map((a) => [Number(a.id), a]));

        const qs = new URLSearchParams({
            mode: state.mode,
            from_date: state.from_date,
            to_date: state.to_date,
            step_days: String(state.stepDays),
        });
        if (state.mode === 'projected' && state.includeInterest) qs.set('include_interest', '1');
        const seriesRes = await api(`/api/balances/series?${qs.toString()}`);
        seriesData = seriesRes.data;

        const occRes = await api(
            `/api/occurrences?${new URLSearchParams({ from_date: state.from_date, to_date: state.to_date }).toString()}`
        );
        occData = (occRes.data || []).slice();
        occData.sort((a, b) => {
            const da = String(a?.occ_date || '');
            const db = String(b?.occ_date || '');
            if (da < db) return 1;
            if (da > db) return -1;
            const na = String(a?.name || '');
            const nb = String(b?.name || '');
            return na.localeCompare(nb);
        });
    };

    const renderLines = () => {
        const box = $('#p_lines');
        if (!box) return;
        if (!seriesData) {
            box.innerHTML = `<div class="notice">Run to load lines.</div>`;
            return;
        }

        const allAccounts = (seriesData.accounts || []).slice();
        const visibleAccounts = allAccounts.filter((a) => (state.showHidden ? true : !isHidden(a)));
        const includedAccounts = applyAccountFilters(allAccounts);

        for (const a of allAccounts) {
            const id = String(a.id);
            if (!selected.has(id)) selected.add(id);
        }

        const idx = selectedIndex();
        const dates = seriesData.dates || [];
        const date = dates[idx] || state.from_date;
        const valText = (cents) => escapeHtml(fmtDollarsAccountingFromCents(Number(cents ?? 0)));

        const accountKeys = includedAccounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(accountKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
            if (key === 'total' || key === 'net') return fixedLineColor(key);
            return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const totalSeries = computeTotalSeries(includedAccounts);
        const netSeries = computeNetSeries(visibleAccounts);

        const lines = [];
        lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="total" ${selected.has('total') ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor('total')}"></span>
              <span>Total</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(totalSeries[idx] ?? 0)}</span>
            </label>`
        );
        lines.push(
            `<label class="chart-line">
              <input type="checkbox" data-line="net" ${selected.has('net') ? 'checked' : ''} />
              <span class="chart-swatch" style="background:${colorFor('net')}"></span>
              <span title="assets - liabilities">Net</span>
              <span class="chart-line-val mono" title="${escapeHtml(date)}">${valText(netSeries[idx] ?? 0)}</span>
            </label>`
        );

        includedAccounts.forEach((a) => {
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
        <button id="p_lines_all" type="button">All</button>
        <button id="p_lines_none" type="button">None</button>
      </div>
      <div class="chart-lines-list">${lines.join('')}</div>
    `;

        $('#p_lines_all').onclick = () => {
            selected.clear();
            selected.add('total');
            selected.add('net');
            for (const a of includedAccounts) selected.add(String(a.id));
            renderLines();
            redrawChart();
        };
        $('#p_lines_none').onclick = () => {
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
        const canvas = $('#p_chart');
        if (!canvas || !seriesData) return;

        const allAccounts = (seriesData.accounts || []).slice();
        const visibleAccounts = allAccounts.filter((a) => (state.showHidden ? true : !isHidden(a)));
        const includedAccounts = applyAccountFilters(allAccounts);

        const accountKeys = includedAccounts.map((a) => `acct:${String(a.id)}:${a.name || ''}`);
        const palette = distinctSeriesPalette(accountKeys, 0.92, { seed: 'accounts' });
        const colorFor = (key) => {
            if (key === 'total' || key === 'net') return fixedLineColor(key);
            return palette.get(String(key)) || stableSeriesColor(String(key), 0.92);
        };

        const s = [];
        const totalSeries = computeTotalSeries(includedAccounts);
        const netSeries = computeNetSeries(visibleAccounts);

        if (selected.has('total')) s.push({ name: 'Total', values: totalSeries.map((v) => Number(v)), color: colorFor('total'), width: 3 });
        if (selected.has('net')) s.push({ name: 'Net', values: netSeries.map((v) => Number(v)), color: colorFor('net'), width: 3 });

        includedAccounts.forEach((a) => {
            const id = String(a.id);
            if (!selected.has(id)) return;
            const key = `acct:${id}:${a.name || ''}`;
            s.push({ name: a.name, values: (a.balance_cents || []).map((v) => Number(v)), color: colorFor(key), width: 2 });
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
                    renderLines();
                    redrawChart();
                    renderTxns();
                },
            },
        });
    };

    const renderTxns = () => {
        const box = $('#p_txns');
        const sub = $('#p_txns_sub');
        if (!box || !sub) return;

        if (!occData || occData.length === 0) {
            sub.textContent = `${state.from_date} → ${state.to_date}`;
            box.innerHTML = `<div class="notice">No scheduled transactions in this window.</div>`;
            return;
        }

        const filtered = occData.filter((o) => {
            if (state.showHidden) return true;
            const src = o?.src_account_id;
            const a = src === null || src === undefined ? null : acctByID.get(Number(src));
            return a ? !Number(a?.exclude_from_dashboard ?? 0) : true;
        });

        const window = selectedWindow();
        const windowed = filtered.filter((o) => {
            const d = String(o?.occ_date || '');
            if (!d) return false;
            return d >= window.from && d <= window.to;
        });

        const cap = 500;
        const rows = windowed.slice(0, cap).map((o) => ({
            date: o.occ_date,
            kind: o.kind,
            name: o.name,
            amount: moneyCell(o.amount_cents),
            src: acctName(o.src_account_id),
            dest: acctName(o.dest_account_id),
        }));

        sub.textContent = `Showing ${rows.length}${windowed.length > cap ? ` of ${windowed.length}` : ''} • ${window.label}`;
        box.innerHTML = table(['date', 'kind', 'name', 'amount', 'src', 'dest'], rows, null, {
            id: 'projection-txns',
            filter: true,
            filterPlaceholder: 'Filter transactions…',
        });
        wireTableFilters(box);
    };

    renderShell();
    await fetchAll();
    renderLines();
    redrawChart();
    renderTxns();
    updateSelectionLabel();

    window.onresize = () => {
        redrawChart();
    };
}
