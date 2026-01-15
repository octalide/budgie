import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { table } from '../../../js/ui.js';
import { NAME_TRUNCATE, clamp, asInt, truncateText } from '../utils.js';

export const recentEntries = {
  type: 'recent_entries',
  title: 'Recent Entries',
  description: 'Latest manual entries with account filtering.',
  defaultSize: 'md',
  minW: 2,
  minH: 2,
  defaultConfig: {
    accountId: '',
    limit: 20,
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'limit', label: 'Rows', type: 'number', min: 5, max: 200, step: 1 },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `<div class="dash-entries"></div>`;
    const box = body.querySelector('.dash-entries');
    const tableId = `dashboard-entries-${instance.id}`;

    const update = async () => {
      const cfg = { ...recentEntries.defaultConfig, ...(instance.config || {}) };
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const limit = clamp(asInt(cfg.limit, 20), 5, 200);
      const entries = await context.getEntries();

      const filtered = (entries || [])
        .filter((e) => {
          if (!accountId) return true;
          return Number(e?.src_account_id) === accountId || Number(e?.dest_account_id) === accountId;
        })
        .slice(0, limit);

      const rows = filtered.map((e) => ({
        date: e.entry_date,
        name: truncateText(e.name, NAME_TRUNCATE),
        amount: {
          text: fmtDollarsAccountingFromCents(Number(e.amount_cents ?? 0)),
          className: Number(e.amount_cents ?? 0) < 0 ? 'num neg mono' : 'num mono',
          title: String(e.amount_cents ?? ''),
        },
        src: e.src_account_name || '',
        dest: e.dest_account_name || '',
      }));

      if (!rows.length) {
        box.innerHTML = `<div class="notice">No entries found.</div>`;
        return;
      }

      box.innerHTML = table(['date', 'name', 'amount', 'src', 'dest'], rows, null, {
        id: tableId,
        filter: false,
      });
    };

    update();

    return {
      update,
      resize() {},
      destroy() {},
    };
  },
};
