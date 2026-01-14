import { $, $$, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, showModal, table, wireTableFilters } from '../js/ui.js';

export async function viewRevisions() {
    activeNav('revisions');
    const schedules = await api('/api/schedules');
    const revisions = await api('/api/revisions');

    const schedOpts = schedules.data
        .map((s) => `<option value="${s.id}">${escapeHtml(s.name)} (#${s.id})</option>`)
        .join('');

    const rows = revisions.data.map((r) => ({
        id: r.id,
        schedule_id: r.schedule_id,
        schedule_name: r.schedule_name,
        effective_date: r.effective_date,
        amount: fmtDollarsFromCents(r.amount_cents),
        description: r.description || '',
    }));

    $('#page').innerHTML = card(
        'Revisions',
        `${rows.length} total`,
        `
          <div class="actions" style="margin-bottom: 10px;">
            <button class="primary" id="r_add">Add revision</button>
          </div>
          ${table(
              ['schedule_name', 'effective_date', 'amount', 'description'],
              rows,
              (r) => `
                <div class="row-actions">
                  <button class="danger" data-del-rev="${r.id}">Delete</button>
                </div>
              `,
              { id: 'revisions', filter: true, filterPlaceholder: 'Filter revisions…' }
          )}
        `
    );

    wireTableFilters($('#page'));

    const revisionModalHtml = () => `
      <div class="grid two">
        <div>
          <label>Schedule</label>
          <select id="rm_schedule">${schedOpts}</select>
        </div>
        <div>
          <label>Effective date</label>
          <input id="rm_date" value="${isoToday()}" />
        </div>
        <div>
          <label>Amount ($)</label>
          <input id="rm_amount" placeholder="0.00" />
        </div>
        <div>
          <label>Description</label>
          <input id="rm_desc" placeholder="" />
        </div>
      </div>
      <div class="actions" style="margin-top:10px;">
        <button class="primary" id="rm_create">Create</button>
      </div>
    `;

    const showRevisionModal = () => {
        const { root, close } = showModal({
            title: 'Add revision',
            subtitle: 'Overrides a schedule amount starting on effective_date (inclusive).',
            bodyHtml: revisionModalHtml(),
        });

        const modal = root.querySelector('.modal');
        modal.querySelector('#rm_create').onclick = async () => {
            try {
                const amount_cents = parseCentsFromDollarsString(modal.querySelector('#rm_amount').value);
                if (amount_cents === null) throw new Error('Amount is required');

                await api('/api/revisions', {
                    method: 'POST',
                    body: JSON.stringify({
                        schedule_id: Number(modal.querySelector('#rm_schedule').value),
                        effective_date: modal.querySelector('#rm_date').value,
                        amount_cents,
                        description: modal.querySelector('#rm_desc').value || null,
                    }),
                });

                close();
                location.hash = '#/revisions';
            } catch (e) {
                alert(e.message);
            }
        };
    };

    $('#r_add').onclick = showRevisionModal;

    $$('#page [data-del-rev]').forEach((btn) => {
        btn.onclick = async () => {
            const id = Number(btn.dataset.delRev);
            if (!confirm('Delete revision?')) return;
            try {
                await api(`/api/revisions/${id}`, { method: 'DELETE' });
                location.hash = '#/revisions';
            } catch (e) {
                alert(e.message);
            }
        };
    });
}
