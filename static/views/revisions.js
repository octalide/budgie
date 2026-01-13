import { $, $$, escapeHtml } from '../js/dom.js';
import { api } from '../js/api.js';
import { isoToday } from '../js/date.js';
import { fmtDollarsFromCents, parseCentsFromDollarsString } from '../js/money.js';
import { activeNav, card, table, wireTableFilters } from '../js/ui.js';

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

    $('#page').innerHTML = `
    <div class="split">
      ${card(
        'Add revision',
        'Overrides a schedule amount starting on effective_date (inclusive).',
        `
          <div class="grid two">
            <div>
              <label>Schedule</label>
              <select id="r_schedule">${schedOpts}</select>
            </div>
            <div>
              <label>Effective date</label>
              <input id="r_date" value="${isoToday()}" />
            </div>
            <div>
              <label>Amount ($)</label>
              <input id="r_amount" placeholder="0.00" />
            </div>
            <div>
              <label>Description</label>
              <input id="r_desc" placeholder="" />
            </div>
          </div>
          <div class="actions" style="margin-top:10px;">
            <button class="primary" id="r_create">Create</button>
          </div>
        `
    )}

      ${card(
        'Revisions',
        `${rows.length} total`,
        table(
            // ['id', 'schedule_name', 'effective_date', 'amount', 'description'],
            ['schedule_name', 'effective_date', 'amount', 'description'],
            rows,
            (r) => `
            <div class="row-actions">
              <button class="danger" data-del-rev="${r.id}">Delete</button>
            </div>
          `,
            { id: 'revisions', filter: true, filterPlaceholder: 'Filter revisions…' }
        )
    )}
    </div>
  `;

    wireTableFilters($('#page'));

    $('#r_create').onclick = async () => {
        try {
            const amount_cents = parseCentsFromDollarsString($('#r_amount').value);
            if (amount_cents === null) throw new Error('Amount is required');

            await api('/api/revisions', {
                method: 'POST',
                body: JSON.stringify({
                    schedule_id: Number($('#r_schedule').value),
                    effective_date: $('#r_date').value,
                    amount_cents,
                    description: $('#r_desc').value || null,
                }),
            });

            location.hash = '#/revisions';
        } catch (e) {
            alert(e.message);
        }
    };

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
