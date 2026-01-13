import { $, $$, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, fmtDollarsAccountingFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';

export async function viewAccounts() {
    activeNav('accounts');
    const { data } = await api('/api/accounts');

    const moneyCell = (cents) => {
      const n = Number(cents ?? 0);
      const cls = n < 0 ? 'num neg mono' : n > 0 ? 'num pos mono' : 'num mono';
      return { text: fmtDollarsAccountingFromCents(n), className: cls, title: String(cents ?? '') };
    };

    const rows = data.map((a) => ({
        id: a.id,
        name: a.name,
        opening_date: a.opening_date,
      opening_balance: moneyCell(a.opening_balance_cents),
        archived_at: a.archived_at || '',
    }));

    const html = `
    <div class="split">
      ${card(
        'Add account',
        'Opening date + opening balance is your starting point.',
        `
          <div class="grid two">
            <div>
              <label>Name</label>
              <input id="a_name" placeholder="Account Name" />
            </div>
            <div>
              <label>Opening date</label>
              <input id="a_opening_date" value="${isoToday()}" />
            </div>
            <div>
              <label>Opening balance ($)</label>
              <input id="a_opening_balance" placeholder="0.00" />
            </div>
            <div>
              <label>Archived at (optional)</label>
              <input id="a_archived_at" placeholder="YYYY-MM-DD" />
            </div>
            <div style="grid-column: 1 / -1;">
              <label>Description</label>
              <input id="a_desc" placeholder="" />
            </div>
          </div>
          <div class="actions" style="margin-top: 10px;">
            <button class="primary" id="a_create">Create</button>
          </div>
        `
    )}

      ${card(
        'Accounts',
        `${rows.length} total`,
        table(
            //   ['id', 'name', 'opening_date', 'opening_balance', 'archived_at'],
            ['name', 'opening_date', 'opening_balance', 'archived_at'],
            rows,
            (r) => `
            <div class="row-actions">
              <button data-edit-account="${r.id}">Edit</button>
              <button class="danger" data-del-account="${r.id}">Delete</button>
            </div>
          `,
            { id: 'accounts', filter: true, filterPlaceholder: 'Filter accounts…' }
        )
    )}
    </div>

    <div style="margin-top: 12px;">
      ${card(
        'Edit account',
        'Select an account row → Edit',
        `
          <div class="notice" id="a_edit_hint">No account selected.</div>
          <div id="a_edit_form" style="display:none; margin-top: 10px;"></div>
        `
    )}
    </div>
  `;

    $('#page').innerHTML = html;
    wireTableFilters($('#page'));

    $('#a_create').onclick = async () => {
        try {
            const opening_balance_cents = parseCentsFromDollarsString($('#a_opening_balance').value) ?? 0;
            await api('/api/accounts', {
                method: 'POST',
                body: JSON.stringify({
                    name: $('#a_name').value,
                    opening_date: $('#a_opening_date').value,
                    opening_balance_cents,
                    description: $('#a_desc').value,
                    archived_at: $('#a_archived_at').value || null,
                }),
            });
            location.hash = '#/accounts';
        } catch (e) {
            alert(e.message);
        }
    };

    const byId = new Map(data.map((a) => [a.id, a]));

    $$('#page [data-del-account]').forEach((btn) => {
        btn.onclick = async () => {
            const id = Number(btn.dataset.delAccount);
            if (!confirm('Delete account? This will fail if referenced by schedules/entries.')) return;
            try {
                await api(`/api/accounts/${id}`, { method: 'DELETE' });
                location.hash = '#/accounts';
            } catch (e) {
                alert(e.message);
            }
        };
    });

    $$('#page [data-edit-account]').forEach((btn) => {
        btn.onclick = () => {
            const id = Number(btn.dataset.editAccount);
            const a = byId.get(id);
            if (!a) return;

            $('#a_edit_hint').style.display = 'none';
            const form = $('#a_edit_form');
            form.style.display = 'block';
            form.innerHTML = `
        <div class="grid two">
          <div>
            <label>Name</label>
            <input id="ae_name" value="${escapeHtml(a.name)}" />
          </div>
          <div>
            <label>Opening date</label>
            <input id="ae_opening_date" value="${escapeHtml(a.opening_date)}" />
          </div>
          <div>
            <label>Opening balance ($)</label>
            <input id="ae_opening_balance" value="${fmtDollarsFromCents(a.opening_balance_cents)}" />
          </div>
          <div>
            <label>Archived at (optional)</label>
            <input id="ae_archived_at" value="${escapeHtml(a.archived_at || '')}" />
          </div>
          <div style="grid-column: 1 / -1;">
            <label>Description</label>
            <input id="ae_desc" value="${escapeHtml(a.description || '')}" />
          </div>
        </div>
        <div class="actions" style="margin-top: 10px;">
          <button class="primary" id="ae_save">Save</button>
        </div>
      `;

            $('#ae_save').onclick = async () => {
                try {
                    const opening_balance_cents = parseCentsFromDollarsString($('#ae_opening_balance').value) ?? 0;
                    await api(`/api/accounts/${id}`, {
                        method: 'PUT',
                        body: JSON.stringify({
                            name: $('#ae_name').value,
                            opening_date: $('#ae_opening_date').value,
                            opening_balance_cents,
                            description: $('#ae_desc').value,
                            archived_at: $('#ae_archived_at').value || null,
                        }),
                    });
                    location.hash = '#/accounts';
                } catch (e) {
                    alert(e.message);
                }
            };
        };
    });
}
