import { $, $$, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, table } from '../js/ui.js';

export async function viewSchedules() {
    activeNav('schedules');
    const accounts = await api('/api/accounts');
    const schedules = await api('/api/schedules');

  const acctById = new Map(accounts.data.map((a) => [a.id, a]));

    const acctOpts = ['<option value="">(none)</option>']
        .concat(accounts.data.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
        .join('');

    const acctFilterOpts = ['<option value="">Any</option>', '<option value="__none__">(none)</option>']
      .concat(accounts.data.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
      .join('');

    const rows = schedules.data.map((s) => ({
        id: s.id,
        name: s.name,
        kind: s.kind,
        freq: s.freq,
        interval: s.interval,
        amount: fmtDollarsFromCents(s.amount_cents),
        start_date: s.start_date,
        end_date: s.end_date || '',
        src_account_id: s.src_account_id || '',
        dest_account_id: s.dest_account_id || '',
        bymonthday: s.bymonthday || '',
        byweekday: s.byweekday || '',
        is_active: s.is_active,
    }));

    const kindLabel = (k) => (k === 'E' ? 'E (expense)' : k === 'I' ? 'I (income)' : k === 'T' ? 'T (transfer)' : String(k || ''));
    const freqLabel = (f) => (f === 'D' ? 'D (daily)' : f === 'W' ? 'W (weekly)' : f === 'M' ? 'M (monthly)' : f === 'Y' ? 'Y (yearly)' : String(f || ''));
    const acctName = (id) => {
      if (id === null || id === undefined || id === '') return '';
      const n = Number(id);
      if (!Number.isFinite(n)) return '';
      return acctById.get(n)?.name || String(id);
    };

    $('#page').innerHTML = `
    <div class="split">
      ${card(
        'Add schedule',
        'Use codes: kind I/E/T; freq D/W/M/Y. Amount is $ and stored as cents.',
        `
          <div class="grid three">
            <div>
              <label>Name</label>
              <input id="s_name" placeholder="Scheduled Expense" />
            </div>
            <div>
              <label>Kind</label>
              <select id="s_kind">
                <option value="E">E (expense)</option>
                <option value="I">I (income)</option>
                <option value="T">T (transfer)</option>
              </select>
            </div>
            <div>
              <label>Amount ($)</label>
              <input id="s_amount" placeholder="0.00" />
            </div>

            <div>
              <label>Start date</label>
              <input id="s_start" value="${isoToday()}" />
            </div>
            <div>
              <label>End date (optional)</label>
              <input id="s_end" placeholder="YYYY-MM-DD" />
            </div>
            <div>
              <label>Active</label>
              <select id="s_active">
                <option value="1">Yes</option>
                <option value="0">No</option>
              </select>
            </div>

            <div>
              <label>Frequency</label>
              <select id="s_freq">
                <option value="M">M (monthly)</option>
                <option value="W">W (weekly)</option>
                <option value="D">D (daily)</option>
                <option value="Y">Y (yearly)</option>
              </select>
            </div>
            <div>
              <label>Interval</label>
              <input id="s_interval" value="1" />
            </div>
            <div>
              <label>bymonthday (1-31)</label>
              <input id="s_dom" placeholder="" />
            </div>

            <div>
              <label>byweekday (0=Sun..6=Sat)</label>
              <input id="s_dow" placeholder="" />
            </div>
            <div>
              <label>Src account</label>
              <select id="s_src">${acctOpts}</select>
            </div>
            <div>
              <label>Dest account</label>
              <select id="s_dest">${acctOpts}</select>
            </div>

            <div style="grid-column: 1 / -1;">
              <label>Description</label>
              <input id="s_desc" placeholder="" />
            </div>
          </div>
          <div class="actions" style="margin-top: 10px;">
            <button class="primary" id="s_create">Create</button>
          </div>
        `
    )}

      ${card(
        'Schedules',
        `${rows.length} total`,
        `
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
    )}
    </div>

    <div style="margin-top: 12px;">
      ${card(
        'Edit schedule',
        'Select a schedule row → Edit',
        `
          <div class="notice" id="s_edit_hint">No schedule selected.</div>
          <div id="s_edit_form" style="display:none; margin-top: 10px;"></div>
        `
    )}
    </div>
  `;

    const byId = new Map(schedules.data.map((s) => [s.id, s]));

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
      const want = Number(val);
      return Number.isFinite(want) && Number.isFinite(cur) && cur === want;
    };

    const applyFilters = () => {
      const q = (filterState.q || '').trim().toLowerCase();
      const wantInterval = (filterState.interval || '').trim();
      const wantIntervalN = wantInterval ? Number(wantInterval) : null;

      const filtered = schedules.data.filter((s) => {
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
      return filtered;
    };

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
        btn.onclick = () => renderScheduleEditor(Number(btn.dataset.editSchedule));
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
        is_active: s.is_active ? '1' : '0',
      }));

      listEl.innerHTML = table(
        ['name', 'kind', 'freq', 'interval', 'amount', 'start_date', 'end_date', 'src', 'dest', 'is_active'],
        viewRows,
        (r) => `
          <div class="row-actions">
            <button data-edit-schedule="${r.id}">Edit</button>
            <button class="danger" data-del-schedule="${r.id}">Delete</button>
          </div>
        `,
        { id: 'schedules-list' }
      );

      if (countEl) countEl.textContent = `${filtered.length} / ${schedules.data.length}`;
      bindRowActions(listEl);
    };

    const wireFilters = () => {
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
      kind?.addEventListener('change', sync);
      freq?.addEventListener('change', sync);
      interval?.addEventListener('input', sync);
      src?.addEventListener('change', sync);
      dest?.addEventListener('change', sync);
      active?.addEventListener('change', sync);

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
    };

    $('#s_create').onclick = async () => {
        try {
            const amount_cents = parseCentsFromDollarsString($('#s_amount').value);
            if (amount_cents === null) throw new Error('Amount is required');

            const interval = Number($('#s_interval').value || '1');

            await api('/api/schedules', {
                method: 'POST',
                body: JSON.stringify({
                    name: $('#s_name').value,
                    kind: $('#s_kind').value,
                    amount_cents,
                    start_date: $('#s_start').value,
                    end_date: $('#s_end').value || null,
                    freq: $('#s_freq').value,
                    interval,
                    bymonthday: $('#s_dom').value ? Number($('#s_dom').value) : null,
                    byweekday: $('#s_dow').value ? Number($('#s_dow').value) : null,
                    src_account_id: $('#s_src').value ? Number($('#s_src').value) : null,
                    dest_account_id: $('#s_dest').value ? Number($('#s_dest').value) : null,
                    description: $('#s_desc').value || null,
                    is_active: Number($('#s_active').value),
                }),
            });
            location.hash = '#/schedules';
        } catch (e) {
            alert(e.message);
        }
    };

    const renderScheduleEditor = (id) => {
        const s = byId.get(id);
        if (!s) return;

        $('#s_edit_hint').style.display = 'none';
        const form = $('#s_edit_form');
        form.style.display = 'block';

        const srcVal = s.src_account_id ?? '';
        const destVal = s.dest_account_id ?? '';

        form.innerHTML = `
      <div class="grid three">
        <div>
          <label>Name</label>
          <input id="se_name" value="${escapeHtml(s.name)}" />
        </div>
        <div>
          <label>Kind</label>
          <select id="se_kind">
            <option value="E" ${s.kind === 'E' ? 'selected' : ''}>E (expense)</option>
            <option value="I" ${s.kind === 'I' ? 'selected' : ''}>I (income)</option>
            <option value="T" ${s.kind === 'T' ? 'selected' : ''}>T (transfer)</option>
          </select>
        </div>
        <div>
          <label>Amount ($)</label>
          <input id="se_amount" value="${fmtDollarsFromCents(s.amount_cents)}" />
        </div>

        <div>
          <label>Start date</label>
          <input id="se_start" value="${escapeHtml(s.start_date)}" />
        </div>
        <div>
          <label>End date</label>
          <input id="se_end" value="${escapeHtml(s.end_date || '')}" />
        </div>
        <div>
          <label>Active</label>
          <select id="se_active">
            <option value="1" ${s.is_active ? 'selected' : ''}>Yes</option>
            <option value="0" ${!s.is_active ? 'selected' : ''}>No</option>
          </select>
        </div>

        <div>
          <label>Frequency</label>
          <select id="se_freq">
            <option value="M" ${s.freq === 'M' ? 'selected' : ''}>M</option>
            <option value="W" ${s.freq === 'W' ? 'selected' : ''}>W</option>
            <option value="D" ${s.freq === 'D' ? 'selected' : ''}>D</option>
            <option value="Y" ${s.freq === 'Y' ? 'selected' : ''}>Y</option>
          </select>
        </div>
        <div>
          <label>Interval</label>
          <input id="se_interval" value="${escapeHtml(s.interval)}" />
        </div>
        <div>
          <label>bymonthday</label>
          <input id="se_dom" value="${escapeHtml(s.bymonthday || '')}" />
        </div>

        <div>
          <label>byweekday</label>
          <input id="se_dow" value="${escapeHtml(s.byweekday || '')}" />
        </div>
        <div>
          <label>Src account</label>
          <select id="se_src">${acctOpts}</select>
        </div>
        <div>
          <label>Dest account</label>
          <select id="se_dest">${acctOpts}</select>
        </div>

        <div style="grid-column: 1 / -1;">
          <label>Description</label>
          <input id="se_desc" value="${escapeHtml(s.description || '')}" />
        </div>
      </div>
      <div class="actions" style="margin-top: 10px;">
        <button class="primary" id="se_save">Save</button>
      </div>
    `;

        $('#se_src').value = String(srcVal);
        $('#se_dest').value = String(destVal);

        $('#se_save').onclick = async () => {
            try {
                const amount_cents = parseCentsFromDollarsString($('#se_amount').value);
                if (amount_cents === null) throw new Error('Amount is required');
                await api(`/api/schedules/${id}`, {
                    method: 'PUT',
                    body: JSON.stringify({
                        name: $('#se_name').value,
                        kind: $('#se_kind').value,
                        amount_cents,
                        start_date: $('#se_start').value,
                        end_date: $('#se_end').value || null,
                        freq: $('#se_freq').value,
                        interval: Number($('#se_interval').value || '1'),
                        bymonthday: $('#se_dom').value ? Number($('#se_dom').value) : null,
                        byweekday: $('#se_dow').value ? Number($('#se_dow').value) : null,
                        src_account_id: $('#se_src').value ? Number($('#se_src').value) : null,
                        dest_account_id: $('#se_dest').value ? Number($('#se_dest').value) : null,
                        description: $('#se_desc').value || null,
                        is_active: Number($('#se_active').value),
                    }),
                });
                location.hash = '#/schedules';
            } catch (e) {
                alert(e.message);
            }
        };
    };

    wireFilters();
}
