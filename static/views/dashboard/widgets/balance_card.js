import { fmtDollarsAccountingFromCents } from '../../../js/money.js';

export const balanceCard = {
  type: 'balance_card',
  title: 'Account Balance',
  description: 'Single-account balance card with selection sync.',
  defaultSize: 'md',
  minW: 2,
  minH: 2,
  defaultConfig: {
    accountId: '',
    syncSelection: true,
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `
        <div class="dash-balance-card">
          <div class="dash-balance-title"></div>
          <div class="dash-balance-value mono"></div>
          <div class="dash-balance-sub"></div>
        </div>
      `;
    const titleEl = body.querySelector('.dash-balance-title');
    const valueEl = body.querySelector('.dash-balance-value');
    const subEl = body.querySelector('.dash-balance-sub');

    const update = async () => {
      const cfg = { ...balanceCard.defaultConfig, ...(instance.config || {}) };
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      if (!accountId) {
        if (titleEl) titleEl.textContent = 'Account balance';
        if (valueEl) valueEl.textContent = '—';
        if (subEl) subEl.textContent = 'Select an account in settings.';
        return;
      }

      const useSelection = cfg.syncSelection && context.selection?.locked;
      const selectionMode = context.selection?.mode || 'projected';
      const useProjected = useSelection && selectionMode === 'projected';
      const baseDate = useSelection ? context.selection.date : context.asOf;
      const balances = await context.getBalances(baseDate, {
        mode: useProjected ? 'projected' : 'actual',
        fromDate: context.asOf,
      });

      const row = (balances || []).find((r) => Number(r.id) === accountId);
      const name = row?.name || context.accountById.get(accountId)?.name || `Account #${accountId}`;
      const cents = Number(row?.balance_cents ?? row?.projected_balance_cents ?? 0);

      if (titleEl) titleEl.textContent = name;
      if (valueEl) valueEl.textContent = fmtDollarsAccountingFromCents(cents);
      if (subEl) subEl.textContent = `As-of ${baseDate}${useProjected ? ' (projected)' : ''}`;
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
