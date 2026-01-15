import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { addDaysISO, clamp, asInt } from '../utils.js';

export const recentExpenses = {
  type: 'recent_expenses',
  title: 'Recent Expenses',
  description: 'Recent expenses including manual entries.',
  defaultSize: 'md',
  minW: 2,
  minH: 2,
  defaultConfig: {
    days: 7,
    syncSelection: true,
    showHidden: false,
    accountId: '',
  },
  settings: [
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'days', label: 'Window (days)', type: 'number', min: 1, max: 365, step: 1 },
    { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
    { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `<div class="dash-upcoming"></div>`;
    const box = body.querySelector('.dash-upcoming');

    const update = async () => {
      const cfg = { ...recentExpenses.defaultConfig, ...(instance.config || {}) };
      const days = clamp(asInt(cfg.days, 7), 1, 365);
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
      const fromDate = addDaysISO(baseDate, -days);

      const occ = await context.getOccurrences(fromDate, baseDate);
      const entries = await context.getEntries();
      const meta = await context.getAccountMeta();
      const accountLookup = context.accountById;

      const acctName = (id) => {
        if (id === null || id === undefined || id === '') return '';
        const n = Number(id);
        if (!Number.isFinite(n)) return '';
        return meta.get(n)?.name || accountLookup.get(n)?.name || String(id);
      };
      const isHidden = (id) => {
        if (id === null || id === undefined || id === '') return false;
        const n = Number(id);
        if (!Number.isFinite(n)) return false;
        return Number(meta.get(n)?.exclude_from_dashboard ?? accountLookup.get(n)?.exclude_from_dashboard ?? 0) === 1;
      };

      const occRows = (occ || [])
        .filter((o) => String(o?.kind || '') === 'E')
        .filter((o) => (!accountId ? true : Number(o?.src_account_id) === accountId))
        .filter((o) => (cfg.showHidden ? true : !isHidden(o?.src_account_id)))
        .map((o) => ({
          date: String(o.occ_date || ''),
          name: String(o.name || ''),
          accountId: o.src_account_id,
          amount: Number(o.amount_cents ?? 0),
          source: 'Scheduled',
        }));

      const entryRows = (entries || [])
        .filter((e) => {
          const d = String(e.entry_date || '');
          if (!d) return false;
          if (d < fromDate || d > baseDate) return false;
          if (accountId) return Number(e?.src_account_id) === accountId;
          return true;
        })
        .filter((e) => e?.src_account_id != null && (e?.dest_account_id == null || e?.dest_account_id === ''))
        .filter((e) => (cfg.showHidden ? true : !isHidden(e?.src_account_id)))
        .map((e) => ({
          date: String(e.entry_date || ''),
          name: String(e.name || ''),
          accountId: e.src_account_id,
          amount: Number(e.amount_cents ?? 0),
          source: 'Entry',
        }));

      const merged = occRows.concat(entryRows).sort((a, b) => {
        if (a.date > b.date) return -1;
        if (a.date < b.date) return 1;
        return a.name.localeCompare(b.name);
      });

      const total = merged.reduce((acc, o) => acc + Number(o.amount ?? 0), 0);

      const rows = merged
        .map((o) => {
          const date = escapeHtml(String(o.date || ''));
          const name = escapeHtml(String(o.name || ''));
          const account = escapeHtml(acctName(o.accountId));
          const amt = fmtDollarsAccountingFromCents(Number(o.amount ?? 0));
          const source = escapeHtml(o.source || '');
          return `
              <div class="dash-upcoming-row">
                <div class="dash-upcoming-date mono">${date}</div>
                <div class="dash-upcoming-name" title="${name}">${name}</div>
                <div class="dash-upcoming-acct" title="${account}">${account}</div>
                <div class="dash-upcoming-amt mono">${escapeHtml(amt)}</div>
                <div class="dash-upcoming-kind">${source}</div>
              </div>
            `;
        })
        .join('');

      const title = `Recent expenses (${days}d)`;
      const subtitle = `${fromDate} → ${baseDate}`;
      const totalLine = `Total: <span class="mono">${escapeHtml(fmtDollarsAccountingFromCents(total))}</span>`;

      box.innerHTML = `
          <div class="dash-upcoming-head">
            <div>
              <div class="dash-upcoming-title">${title}</div>
              <div class="dash-upcoming-sub">${escapeHtml(subtitle)}</div>
            </div>
            <div class="dash-upcoming-total">${totalLine}</div>
          </div>
          ${merged.length ? `<div class="dash-upcoming-list">${rows}</div>` : `<div class="notice">No expenses in the last ${days} days.</div>`}
        `;
    };

    const unsubSel = context.on('selection', () => update());
    const unsubRange = context.on('range', () => update());
    update();

    return {
      update,
      resize() {},
      destroy() {
        unsubSel();
        unsubRange();
      },
    };
  },
};
