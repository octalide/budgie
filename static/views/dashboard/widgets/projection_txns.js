import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { table, wireTableFilters } from '../../../js/ui.js';
import { NAME_TRUNCATE, addDaysISO, clamp, asInt, truncateText } from '../utils.js';

export const projectionTxns = {
  type: 'projection_txns',
  title: 'Scheduled Transactions',
  description: 'Scheduled feed linked to the projection selection window.',
  defaultSize: 'md',
  minW: 1,
  minH: 1,
  defaultConfig: {
    windowDays: 14,
    syncSelection: true,
    showHidden: false,
    accountId: '',
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'windowDays', label: 'Window (days)', type: 'number', min: 3, max: 120, step: 1 },
    { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
    { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `
        <div class="dash-txns">
          <div class="dash-txns-sub"></div>
          <div class="dash-txns-table"></div>
        </div>
      `;
    const subEl = body.querySelector('.dash-txns-sub');
    const tableEl = body.querySelector('.dash-txns-table');
    const tableId = `dashboard-txns-${instance.id}`;

    const acctName = (id) => {
      if (id === null || id === undefined || id === '') return '';
      const n = Number(id);
      if (!Number.isFinite(n)) return '';
      return context.accountById.get(n)?.name || String(id);
    };

    const update = async () => {
      const cfg = { ...projectionTxns.defaultConfig, ...(instance.config || {}) };
      const windowDays = clamp(asInt(cfg.windowDays, 14), 3, 120);
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
      const half = Math.floor(windowDays / 2);
      const fromDate = addDaysISO(baseDate, -half);
      const toDate = addDaysISO(baseDate, half);

      const occ = await context.getOccurrences(fromDate, toDate);
      const meta = await context.getAccountMeta();

      const isHidden = (id) => {
        if (id === null || id === undefined || id === '') return false;
        const n = Number(id);
        if (!Number.isFinite(n)) return false;
        return Number(meta.get(n)?.exclude_from_dashboard ?? 0) === 1;
      };

      const filtered = (occ || []).filter((o) => {
        if (!cfg.showHidden && isHidden(o?.src_account_id)) return false;
        if (accountId) {
          const src = Number(o?.src_account_id);
          const dest = Number(o?.dest_account_id);
          if (src !== accountId && dest !== accountId) return false;
        }
        return true;
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

      if (subEl) subEl.textContent = `${fromDate} → ${toDate}`;

      const rows = filtered.map((o) => ({
        date: o.occ_date,
        kind: o.kind,
        name: truncateText(o.name, NAME_TRUNCATE),
        amount: {
          text: fmtDollarsAccountingFromCents(Number(o.amount_cents ?? 0)),
          className: Number(o.amount_cents ?? 0) < 0 ? 'num neg mono' : 'num mono',
          title: String(o.amount_cents ?? ''),
        },
        src: acctName(o.src_account_id),
        dest: acctName(o.dest_account_id),
      }));

      tableEl.innerHTML = rows.length
        ? table(['date', 'kind', 'name', 'amount', 'src', 'dest'], rows, null, {
            id: tableId,
            filter: true,
            filterPlaceholder: 'Filter scheduled…',
          })
        : `<div class="notice">No scheduled transactions in this window.</div>`;
      wireTableFilters(body);
    };

    const unsub = context.on('selection', () => update());
    update();

    return {
      update,
      resize() {},
      destroy() {
        unsub();
      },
    };
  },
};
