import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { table, wireTableFilters } from '../../../js/ui.js';

export const snapshot = {
  type: 'snapshot',
  title: 'Snapshot',
  description: 'Balances as-of a specific date.',
  defaultSize: 'md',
  minW: 2,
  minH: 2,
  defaultConfig: {
    includeLiabilities: false,
    showHidden: false,
    syncSelection: true,
    accountId: '',
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'includeLiabilities', label: 'Include liabilities', type: 'checkbox' },
    { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
    { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `
        <div class="dash-snapshot">
          <div class="notice dash-snapshot-stats"></div>
          <div class="dash-snapshot-table"></div>
        </div>
      `;
    const statsEl = body.querySelector('.dash-snapshot-stats');
    const tableEl = body.querySelector('.dash-snapshot-table');
    const tableId = `dashboard-balances-${instance.id}`;

    const update = async () => {
      const cfg = { ...snapshot.defaultConfig, ...(instance.config || {}) };
      const useProjected = cfg.syncSelection && context.selection?.locked;
      const baseDate = useProjected ? context.selection.date : context.asOf;
      const balancesAll = await context.getBalances(baseDate, {
        mode: useProjected ? 'projected' : 'actual',
        fromDate: context.asOf,
      });
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;

      const isLiability = (r) => Number(r?.is_liability ?? 0) === 1;
      const isHidden = (r) => Number(r?.exclude_from_dashboard ?? 0) === 1;

      const balances = (balancesAll || []).filter((r) => {
        if (!cfg.showHidden && isHidden(r)) return false;
        if (!cfg.includeLiabilities && isLiability(r)) return false;
        if (accountId && Number(r.id) !== accountId) return false;
        return true;
      });
      const balanceCents = (r) => Number(r.balance_cents ?? r.projected_balance_cents ?? 0);
      const netWorthCents = balances.reduce((acc, r) => acc + balanceCents(r), 0);

      if (statsEl) {
        statsEl.innerHTML = `
            <div style="display:flex; justify-content:space-between; gap:12px;">
              <div>
                <div style="font-size:12px; color: var(--muted);">Net worth</div>
                <div class="mono" style="font-size:18px; margin-top:4px;">${fmtDollarsAccountingFromCents(netWorthCents)}</div>
                <div style="font-size:11px; color: var(--muted); margin-top:6px;">As-of ${escapeHtml(baseDate)}${useProjected ? ' (projected)' : ''}</div>
              </div>
              <div style="text-align:right;">
                <div style="font-size:12px; color: var(--muted);">Accounts</div>
                <div class="mono" style="font-size:18px; margin-top:4px;">${balances.length}</div>
              </div>
            </div>
          `;
      }

      if (tableEl) {
        const moneyCell = (cents) => {
          const num = Number(cents ?? 0);
          const cls = num < 0 ? 'num neg mono' : num > 0 ? 'num pos mono' : 'num mono';
          return {
            text: fmtDollarsAccountingFromCents(num),
            className: cls,
            title: String(cents ?? ''),
          };
        };
        tableEl.innerHTML = table(
          ['account', 'balance'],
          balances.map((r) => ({
            account: r.name,
            balance: moneyCell(balanceCents(r)),
          })),
          null,
          {
            id: tableId,
            filter: true,
            filterPlaceholder: 'Filter accounts…',
          }
        );
        wireTableFilters(body);
      }
    };

    const unsub = context.on('selection', () => update());
    update();

    return {
      update,
      resize() {
        // layout-only; table and stats adapt via CSS
      },
      destroy() {
        unsub();
      },
    };
  },
};
