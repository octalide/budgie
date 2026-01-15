import { $, $$, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, showModal, table, wireTableFilters } from '../js/ui.js';

export async function viewEntries() {
    activeNav('entries');
    const accounts = await api('/api/accounts');
    const schedules = await api('/api/schedules');
    const entries = await api('/api/entries');

    const buildOptions = (items, selectedId) => {
      const selected = selectedId == null ? null : Number(selectedId);
      return ['<option value="">(none)</option>']
        .concat(
          items.map((item) => {
            const isSelected = selected != null && Number(item.id) === selected ? ' selected' : '';
            return `<option value="${item.id}"${isSelected}>${escapeHtml(item.name)}</option>`;
          })
        )
        .join('');
    };

    const rows = entries.data.slice(0, 200).map((e) => ({
        id: e.id,
        entry_date: e.entry_date,
        name: e.name,
        amount: fmtDollarsFromCents(e.amount_cents),
        src: e.src_account_name || '',
        dest: e.dest_account_name || '',
        schedule: e.schedule_name || '',
    }));

    $('#page').innerHTML = card(
        'Entries',
        `Showing latest ${rows.length} (cap 200 in UI)`,
        `
          <div class="actions" style="margin-bottom: 10px;">
            <button class="primary" id="e_add">Add entry</button>
          </div>
          ${table(
              ['entry_date', 'name', 'amount', 'src', 'dest', 'schedule'],
              rows,
              (r) => `
                <div class="row-actions">
                  <button data-edit-entry="${r.id}">Edit</button>
                  <button class="danger" data-del-entry="${r.id}">Delete</button>
                </div>
              `,
              { id: 'entries', filter: true, filterPlaceholder: 'Filter entries…' }
          )}
        `
    );

    wireTableFilters($('#page'));

    const entryTypeFromEntry = (entry) => {
      const hasSrc = entry?.src_account_id != null && entry?.src_account_id !== '';
      const hasDest = entry?.dest_account_id != null && entry?.dest_account_id !== '';
      if (hasSrc && hasDest) return 'transfer';
      if (hasDest) return 'income';
      return 'expense';
    };

    const entryModalHtml = (entry) => {
        const isEdit = Boolean(entry);
        const entryType = entryTypeFromEntry(entry);
        return `
      <div class="grid three">
        <div>
          <label>Date</label>
          <input id="em_date" value="${escapeHtml(entry?.entry_date || isoToday())}" />
        </div>
        <div>
          <label>Name</label>
          <input id="em_name" value="${escapeHtml(entry?.name || '')}" placeholder="Entry" />
        </div>
        <div>
          <label>Amount ($)</label>
          <input id="em_amount" value="${isEdit ? fmtDollarsFromCents(entry.amount_cents) : ''}" placeholder="0.00" />
        </div>

        <div>
          <label>Type</label>
          <select id="em_type">
            <option value="expense"${entryType === 'expense' ? ' selected' : ''}>Expense</option>
            <option value="income"${entryType === 'income' ? ' selected' : ''}>Income</option>
            <option value="transfer"${entryType === 'transfer' ? ' selected' : ''}>Transfer</option>
          </select>
        </div>
        <div data-entry-src>
          <label>From account</label>
          <select id="em_src">${buildOptions(accounts.data, entry?.src_account_id)}</select>
        </div>
        <div data-entry-dest>
          <label>To account</label>
          <select id="em_dest">${buildOptions(accounts.data, entry?.dest_account_id)}</select>
        </div>
        <div>
          <label>Link to schedule (optional)</label>
          <select id="em_schedule">${buildOptions(schedules.data, entry?.schedule_id)}</select>
        </div>

        <div style="grid-column: 1 / -1;">
          <label>Description</label>
          <input id="em_desc" value="${escapeHtml(entry?.description || '')}" placeholder="" />
        </div>
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="primary" id="em_save">${isEdit ? 'Save' : 'Create'}</button>
      </div>
      `;
      };

      const showEntryModal = (entry) => {
        const isEdit = Boolean(entry);
        const { root, close } = showModal({
          title: isEdit ? `Edit entry #${entry.id}` : 'Add entry',
          subtitle: 'Unscheduled expense/income/transfer (dated).',
          bodyHtml: entryModalHtml(entry),
        });

        const modal = root.querySelector('.modal');
        const typeSel = modal.querySelector('#em_type');
        const srcWrap = modal.querySelector('[data-entry-src]');
        const destWrap = modal.querySelector('[data-entry-dest]');
        const srcSelect = modal.querySelector('#em_src');
        const destSelect = modal.querySelector('#em_dest');
        const srcLabel = srcWrap?.querySelector('label');
        const destLabel = destWrap?.querySelector('label');

        const syncEntryTypeUI = () => {
          const type = typeSel?.value || 'expense';
          if (type === 'expense') {
            if (srcLabel) srcLabel.textContent = 'From account (expense)';
            if (destLabel) destLabel.textContent = 'To account';
            if (srcWrap) srcWrap.style.display = '';
            if (destWrap) destWrap.style.display = 'none';
            if (srcSelect) srcSelect.disabled = false;
            if (destSelect) {
              destSelect.disabled = true;
              destSelect.value = '';
            }
            return;
          }
          if (type === 'income') {
            if (srcLabel) srcLabel.textContent = 'From account';
            if (destLabel) destLabel.textContent = 'To account (income)';
            if (srcWrap) srcWrap.style.display = 'none';
            if (destWrap) destWrap.style.display = '';
            if (srcSelect) {
              srcSelect.disabled = true;
              srcSelect.value = '';
            }
            if (destSelect) destSelect.disabled = false;
            return;
          }

          if (srcLabel) srcLabel.textContent = 'From account (transfer)';
          if (destLabel) destLabel.textContent = 'To account (transfer)';
          if (srcWrap) srcWrap.style.display = '';
          if (destWrap) destWrap.style.display = '';
          if (srcSelect) srcSelect.disabled = false;
          if (destSelect) destSelect.disabled = false;
        };

        typeSel?.addEventListener('change', syncEntryTypeUI);
        syncEntryTypeUI();

        modal.querySelector('#em_save').onclick = async () => {
            try {
                const amount_cents = parseCentsFromDollarsString(modal.querySelector('#em_amount').value);
                if (amount_cents === null) throw new Error('Amount is required');

            const entryType = typeSel?.value || 'expense';
            const srcValue = srcSelect?.value || '';
            const destValue = destSelect?.value || '';
            const src_account_id =
              entryType === 'expense' || entryType === 'transfer'
                ? (srcValue ? Number(srcValue) : null)
                : null;
            const dest_account_id =
              entryType === 'income' || entryType === 'transfer'
                ? (destValue ? Number(destValue) : null)
                : null;

            if (entryType === 'expense' && !src_account_id) {
              throw new Error('Select a source account for an expense');
            }
            if (entryType === 'income' && !dest_account_id) {
              throw new Error('Select a destination account for income');
            }
            if (entryType === 'transfer' && (!src_account_id || !dest_account_id)) {
              throw new Error('Select both accounts for a transfer');
            }
            if (src_account_id && dest_account_id && src_account_id === dest_account_id) {
              throw new Error('Source and destination accounts must differ');
            }

            const payload = {
              entry_date: modal.querySelector('#em_date').value,
              name: modal.querySelector('#em_name').value,
              amount_cents,
              src_account_id,
              dest_account_id,
              schedule_id: modal.querySelector('#em_schedule').value ? Number(modal.querySelector('#em_schedule').value) : null,
              description: modal.querySelector('#em_desc').value || null,
            };

            const path = isEdit ? `/api/entries/${entry.id}` : '/api/entries';
            const method = isEdit ? 'PUT' : 'POST';

            await api(path, { method, body: JSON.stringify(payload) });

                close();
                location.hash = '#/entries';
            } catch (e) {
                alert(e.message);
            }
        };
    };

    $('#e_add').onclick = () => showEntryModal(null);

    const byId = new Map(entries.data.map((e) => [e.id, e]));

    $$('#page [data-edit-entry]').forEach((btn) => {
      btn.onclick = () => {
        const id = Number(btn.dataset.editEntry);
        const entry = byId.get(id);
        if (!entry) return;
        showEntryModal(entry);
      };
    });

    $$('#page [data-del-entry]').forEach((btn) => {
        btn.onclick = async () => {
            const id = Number(btn.dataset.delEntry);
            if (!confirm('Delete entry?')) return;
            try {
                await api(`/api/entries/${id}`, { method: 'DELETE' });
                location.hash = '#/entries';
            } catch (e) {
                alert(e.message);
            }
        };
    });
}
