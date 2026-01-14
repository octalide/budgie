import { $, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, showModal, table } from '../js/ui.js';

export async function viewSchedules() {
    activeNav('schedules');

    const accounts = await api('/api/accounts');
    const schedules = await api('/api/schedules');

    const acctById = new Map(accounts.data.map((a) => [a.id, a]));
    const byId = new Map(schedules.data.map((s) => [s.id, s]));

    const acctOpts = ['<option value="">(none)</option>']
        .concat(accounts.data.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
        .join('');

    const acctFilterOpts = ['<option value="">Any</option>', '<option value="__none__">(none)</option>', '<option value="__set__">(set)</option>']
        .concat(accounts.data.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
        .join('');

    const kindLabel = (k) =>
        k === 'E' ? 'E (expense)' : k === 'I' ? 'I (income)' : k === 'T' ? 'T (transfer)' : String(k || '');
    const freqLabel = (f) =>
        f === 'D'
            ? 'D (daily)'
            : f === 'W'
              ? 'W (weekly)'
              : f === 'M'
                ? 'M (monthly)'
                : f === 'Y'
                  ? 'Y (yearly)'
                  : String(f || '');
    const acctName = (id) => {
        if (id === null || id === undefined || id === '') return '';
        const n = Number(id);
        if (!Number.isFinite(n)) return '';
        return acctById.get(n)?.name || String(id);
    };

    $('#page').innerHTML = card(
        'Schedules',
        `${schedules.data.length} total`,
        `
          <div class="actions" style="margin-bottom: 10px;">
            <button class="primary" id="s_add">Add schedule</button>
          </div>

          <div class="table-tools table-tools--wrap" style="margin-bottom: 12px;">
            <div class="tool">
              <label>Search</label>
              <input id="sf_q" placeholder="Name / description…" />
            </div>
            <div class="tool tool--small">
              <label>Kind</label>
              <select id="sf_kind">
                <option value="">Any</option>
                <option value="E">E (expense)</option>
                <option value="I">I (income)</option>
                <option value="T">T (transfer)</option>
              </select>
            </div>
            <div class="tool tool--small">
              <label>Frequency</label>
              <select id="sf_freq">
                <option value="">Any</option>
                <option value="D">D (daily)</option>
                <option value="W">W (weekly)</option>
                <option value="M">M (monthly)</option>
                <option value="Y">Y (yearly)</option>
              </select>
            </div>
            <div class="tool tool--tiny">
              <label>Interval</label>
              <input id="sf_interval" placeholder="any" />
            </div>
            <div class="tool">
              <label>Src</label>
              <select id="sf_src">${acctFilterOpts}</select>
            </div>
            <div class="tool">
              <label>Dest</label>
              <select id="sf_dest">${acctFilterOpts}</select>
            </div>
            <div class="tool tool--small">
              <label>Active</label>
              <select id="sf_active">
                <option value="">Any</option>
                <option value="1">Active</option>
                <option value="0">Inactive</option>
              </select>
            </div>
            <div class="tool tool--actions">
              <button id="sf_clear" type="button">Clear</button>
              <div class="table-count" id="sf_count"></div>
            </div>
          </div>

          <div id="schedules_table"></div>
        `
    );

    const listEl = $('#schedules_table');
    const countEl = $('#sf_count');

    const filterState = {
        q: '',
        kind: '',
        freq: '',
        interval: '',
        src: '',
        dest: '',
        active: '',
    };

    const matchesAcctFilter = (val, id) => {
        if (val === '') return true;
        const cur = id === null || id === undefined ? null : Number(id);
        if (val === '__none__') return cur === null || !Number.isFinite(cur);
        if (val === '__set__') return Number.isFinite(cur);
        const want = Number(val);
        return Number.isFinite(want) && Number.isFinite(cur) && cur === want;
    };

    const applyFilters = () => {
        const q = (filterState.q || '').trim().toLowerCase();
        const wantInterval = (filterState.interval || '').trim();
        const wantIntervalN = wantInterval ? Number(wantInterval) : null;

        return schedules.data.filter((s) => {
            if (filterState.kind && s.kind !== filterState.kind) return false;
            if (filterState.freq && s.freq !== filterState.freq) return false;
            if (filterState.active !== '') {
                const want = Number(filterState.active);
                const cur = Number(s.is_active ? 1 : 0);
                if (cur !== want) return false;
            }
            if (wantIntervalN !== null && Number.isFinite(wantIntervalN)) {
                if (Number(s.interval) !== wantIntervalN) return false;
            }
            if (!matchesAcctFilter(filterState.src, s.src_account_id)) return false;
            if (!matchesAcctFilter(filterState.dest, s.dest_account_id)) return false;
            if (q) {
                const hay = `${s.name || ''} ${(s.description || '')}`.toLowerCase();
                if (!hay.includes(q)) return false;
            }
            return true;
        });
    };

    const scheduleModalHtml = (s) => {
        const isEdit = Boolean(s);
        const kind = s?.kind || 'E';
        const freq = s?.freq || 'M';
        return `
          <div class="grid three">
            <div>
              <label>Name</label>
              <input id="sm_name" value="${escapeHtml(s?.name || '')}" placeholder="Scheduled transaction" />
            </div>
            <div>
              <label>Kind</label>
              <select id="sm_kind">
                <option value="E" ${kind === 'E' ? 'selected' : ''}>E (expense)</option>
                <option value="I" ${kind === 'I' ? 'selected' : ''}>I (income)</option>
                <option value="T" ${kind === 'T' ? 'selected' : ''}>T (transfer)</option>
              </select>
            </div>
            <div>
              <label>Amount ($)</label>
              <input id="sm_amount" value="${isEdit ? fmtDollarsFromCents(s.amount_cents) : ''}" placeholder="0.00" />
            </div>

            <div>
              <label>Start date</label>
              <input id="sm_start" value="${escapeHtml(s?.start_date || isoToday())}" />
            </div>
            <div>
              <label>End date (optional)</label>
              <input id="sm_end" value="${escapeHtml(s?.end_date || '')}" placeholder="YYYY-MM-DD" />
            </div>
            <div>
              <label>Active</label>
              <select id="sm_active">
                <option value="1" ${s?.is_active ? 'selected' : ''}>Yes</option>
                <option value="0" ${s && !s.is_active ? 'selected' : ''}>No</option>
              </select>
            </div>

            <div>
              <label>Frequency</label>
              <select id="sm_freq">
                <option value="M" ${freq === 'M' ? 'selected' : ''}>M (monthly)</option>
                <option value="W" ${freq === 'W' ? 'selected' : ''}>W (weekly)</option>
                <option value="D" ${freq === 'D' ? 'selected' : ''}>D (daily)</option>
                <option value="Y" ${freq === 'Y' ? 'selected' : ''}>Y (yearly)</option>
              </select>
            </div>
            <div>
              <label>Interval</label>
              <input id="sm_interval" value="${escapeHtml(String(s?.interval ?? 1))}" />
            </div>
            <div>
              <label>bymonthday (1-31)</label>
              <input id="sm_dom" value="${escapeHtml(String(s?.bymonthday ?? ''))}" placeholder="" />
            </div>

            <div>
              <label>byweekday (0=Sun..6=Sat)</label>
              <input id="sm_dow" value="${escapeHtml(String(s?.byweekday ?? ''))}" placeholder="" />
            </div>
            <div>
              <label>Src account</label>
              <select id="sm_src">${acctOpts}</select>
            </div>
            <div>
              <label>Dest account</label>
              <select id="sm_dest">${acctOpts}</select>
            </div>

            <div style="grid-column: 1 / -1;">
              <label>Description</label>
              <input id="sm_desc" value="${escapeHtml(s?.description || '')}" placeholder="" />
            </div>
          </div>
          <div class="actions" style="margin-top: 10px;">
            <button class="primary" id="sm_save">${isEdit ? 'Save' : 'Create'}</button>
          </div>
        `;
    };

    const showScheduleModal = (s) => {
        const isEdit = Boolean(s);
        const { root, close } = showModal({
            title: isEdit ? `Edit schedule #${s.id}` : 'Add schedule',
            subtitle: 'kind I/E/T • freq D/W/M/Y • amount is $ (stored as cents)',
            bodyHtml: scheduleModalHtml(s),
        });

        const modal = root.querySelector('.modal');
        const kindSel = modal.querySelector('#sm_kind');
        const srcSel = modal.querySelector('#sm_src');
        const destSel = modal.querySelector('#sm_dest');

        if (srcSel) srcSel.value = String(s?.src_account_id ?? '');
        if (destSel) destSel.value = String(s?.dest_account_id ?? '');

        const applyKindRules = () => {
            const k = kindSel?.value || 'E';
            if (!srcSel || !destSel) return;
            if (k === 'E') {
                destSel.value = '';
                destSel.disabled = true;
                srcSel.disabled = false;
            } else if (k === 'I') {
                srcSel.value = '';
                srcSel.disabled = true;
                destSel.disabled = false;
            } else {
                srcSel.disabled = false;
                destSel.disabled = false;
            }
        };

        kindSel?.addEventListener('change', applyKindRules);
        applyKindRules();

        modal.querySelector('#sm_save').onclick = async () => {
            try {
                const amount_cents = parseCentsFromDollarsString(modal.querySelector('#sm_amount').value);
                if (amount_cents === null) throw new Error('Amount is required');

                const payload = {
                    name: modal.querySelector('#sm_name').value,
                    kind: modal.querySelector('#sm_kind').value,
                    amount_cents,
                    start_date: modal.querySelector('#sm_start').value,
                    end_date: modal.querySelector('#sm_end').value || null,
                    freq: modal.querySelector('#sm_freq').value,
                    interval: Number(modal.querySelector('#sm_interval').value || '1'),
                    bymonthday: modal.querySelector('#sm_dom').value ? Number(modal.querySelector('#sm_dom').value) : null,
                    byweekday: modal.querySelector('#sm_dow').value ? Number(modal.querySelector('#sm_dow').value) : null,
                    src_account_id: srcSel.value ? Number(srcSel.value) : null,
                    dest_account_id: destSel.value ? Number(destSel.value) : null,
                    description: modal.querySelector('#sm_desc').value || null,
                    is_active: Number(modal.querySelector('#sm_active').value),
                };

                if (isEdit) await api(`/api/schedules/${s.id}`, { method: 'PUT', body: JSON.stringify(payload) });
                else await api('/api/schedules', { method: 'POST', body: JSON.stringify(payload) });

                close();
                location.hash = '#/schedules';
            } catch (e) {
                alert(e.message);
            }
        };
    };

    $('#s_add').onclick = () => showScheduleModal(null);

    const bindRowActions = (root) => {
        root.querySelectorAll('[data-del-schedule]').forEach((btn) => {
            btn.onclick = async () => {
                const id = Number(btn.dataset.delSchedule);
                if (!confirm('Delete schedule? (revisions will be deleted, entries will just unlink)')) return;
                try {
                    await api(`/api/schedules/${id}`, { method: 'DELETE' });
                    location.hash = '#/schedules';
                } catch (e) {
                    alert(e.message);
                }
            };
        });

        root.querySelectorAll('[data-edit-schedule]').forEach((btn) => {
            btn.onclick = () => {
                const id = Number(btn.dataset.editSchedule);
                const s = byId.get(id);
                if (!s) return;
                showScheduleModal(s);
            };
        });
    };

    const renderList = () => {
        const filtered = applyFilters();
        const viewRows = filtered.map((s) => ({
            id: s.id,
            name: s.name,
            kind: { text: s.kind, title: kindLabel(s.kind) },
            freq: { text: s.freq, title: freqLabel(s.freq) },
            interval: s.interval,
            amount: fmtDollarsFromCents(s.amount_cents),
            start_date: s.start_date,
            end_date: s.end_date || '',
            src: acctName(s.src_account_id),
            dest: acctName(s.dest_account_id),
            active: { text: s.is_active ? 'Yes' : 'No', title: s.is_active ? '1' : '0' },
        }));

        listEl.innerHTML = table(
            ['name', 'kind', 'freq', 'interval', 'amount', 'start_date', 'end_date', 'src', 'dest', 'active'],
            viewRows,
            (r) => `
              <div class="row-actions">
                <button data-edit-schedule="${r.id}">Edit</button>
                <button class="danger" data-del-schedule="${r.id}">Delete</button>
              </div>
            `
        );

        // Schedules tend to have long names/descriptions; wrap instead of forcing a horizontal scrollbar.
        const tbl = listEl.querySelector('table.table');
        if (tbl) tbl.classList.add('table--wrap');

        if (countEl) countEl.textContent = `${filtered.length} / ${schedules.data.length}`;
        bindRowActions(listEl);
    };

    const q = $('#sf_q');
    const kind = $('#sf_kind');
    const freq = $('#sf_freq');
    const interval = $('#sf_interval');
    const src = $('#sf_src');
    const dest = $('#sf_dest');
    const active = $('#sf_active');

    const sync = () => {
        filterState.q = q?.value || '';
        filterState.kind = kind?.value || '';
        filterState.freq = freq?.value || '';
        filterState.interval = interval?.value || '';
        filterState.src = src?.value || '';
        filterState.dest = dest?.value || '';
        filterState.active = active?.value || '';
        renderList();
    };

    q?.addEventListener('input', sync);
    freq?.addEventListener('change', sync);
    interval?.addEventListener('input', sync);
    src?.addEventListener('change', sync);
    dest?.addEventListener('change', sync);
    active?.addEventListener('change', sync);

    kind?.addEventListener('change', () => {
        // Smart defaults based on kind.
        if (kind.value === 'E') {
            if (dest) dest.value = '__none__';
            if (src && src.value === '__none__') src.value = '';
        } else if (kind.value === 'I') {
            if (src) src.value = '__none__';
            if (dest && dest.value === '__none__') dest.value = '';
        } else if (kind.value === 'T') {
            if (src) src.value = '__set__';
            if (dest) dest.value = '__set__';
        }
        sync();
    });

    $('#sf_clear').onclick = () => {
        if (q) q.value = '';
        if (kind) kind.value = '';
        if (freq) freq.value = '';
        if (interval) interval.value = '';
        if (src) src.value = '';
        if (dest) dest.value = '';
        if (active) active.value = '';
        sync();
    };

    sync();
}
