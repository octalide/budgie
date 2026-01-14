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

    const acctOpts = ['<option value="">(none)</option>']
        .concat(accounts.data.map((a) => `<option value="${a.id}">${escapeHtml(a.name)}</option>`))
        .join('');

    const schedOpts = ['<option value="">(none)</option>']
        .concat(schedules.data.map((s) => `<option value="${s.id}">${escapeHtml(s.name)}</option>`))
        .join('');

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
                  <button class="danger" data-del-entry="${r.id}">Delete</button>
                </div>
              `,
              { id: 'entries', filter: true, filterPlaceholder: 'Filter entries…' }
          )}
        `
    );

    wireTableFilters($('#page'));

    const entryModalHtml = () => `
      <div class="grid three">
        <div>
          <label>Date</label>
          <input id="em_date" value="${isoToday()}" />
        </div>
        <div>
          <label>Name</label>
          <input id="em_name" placeholder="Expense" />
        </div>
        <div>
          <label>Amount ($)</label>
          <input id="em_amount" placeholder="0.00" />
        </div>

        <div>
          <label>Src account (expense/transfer)</label>
          <select id="em_src">${acctOpts}</select>
        </div>
        <div>
          <label>Dest account (income/transfer)</label>
          <select id="em_dest">${acctOpts}</select>
        </div>
        <div>
          <label>Link to schedule (optional)</label>
          <select id="em_schedule">${schedOpts}</select>
        </div>

        <div style="grid-column: 1 / -1;">
          <label>Description</label>
          <input id="em_desc" placeholder="" />
        </div>
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="primary" id="em_create">Create</button>
      </div>
    `;

    const showEntryModal = () => {
        const { root, close } = showModal({
            title: 'Add entry',
            subtitle: 'Unscheduled expense/income/transfer (dated).',
            bodyHtml: entryModalHtml(),
        });

        const modal = root.querySelector('.modal');
        modal.querySelector('#em_create').onclick = async () => {
            try {
                const amount_cents = parseCentsFromDollarsString(modal.querySelector('#em_amount').value);
                if (amount_cents === null) throw new Error('Amount is required');

                await api('/api/entries', {
                    method: 'POST',
                    body: JSON.stringify({
                        entry_date: modal.querySelector('#em_date').value,
                        name: modal.querySelector('#em_name').value,
                        amount_cents,
                        src_account_id: modal.querySelector('#em_src').value ? Number(modal.querySelector('#em_src').value) : null,
                        dest_account_id: modal.querySelector('#em_dest').value ? Number(modal.querySelector('#em_dest').value) : null,
                        schedule_id: modal.querySelector('#em_schedule').value ? Number(modal.querySelector('#em_schedule').value) : null,
                        description: modal.querySelector('#em_desc').value || null,
                    }),
                });

                close();
                location.hash = '#/entries';
            } catch (e) {
                alert(e.message);
            }
        };
    };

    $('#e_add').onclick = showEntryModal;

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
