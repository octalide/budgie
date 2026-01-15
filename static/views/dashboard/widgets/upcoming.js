import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { addDaysISO, clamp, asInt } from '../utils.js';

export const upcoming = {
  type: 'upcoming',
  title: 'Upcoming Expenses',
  description: 'Scheduled expenses over a configurable window.',
  defaultSize: 'md',
  minW: 2,
  minH: 2,
  defaultConfig: {
    days: 7,
    maxRows: 7,
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
      const cfg = { ...upcoming.defaultConfig, ...(instance.config || {}) };
      const days = clamp(asInt(cfg.days, 7), 1, 365);
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;
      const toDate = addDaysISO(baseDate, days);

      const occ = await context.getOccurrences(baseDate, toDate);
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

      const filtered = (occ || [])
        .filter((o) => String(o?.kind || '') === 'E')
        .filter((o) => (!accountId ? true : Number(o?.src_account_id) === accountId))
        .filter((o) => (cfg.showHidden ? true : !isHidden(o?.src_account_id)));

      filtered.sort((a, b) => {
        const da = String(a?.occ_date || '');
        const db = String(b?.occ_date || '');
        if (da < db) return -1;
        if (da > db) return 1;
        const na = String(a?.name || '');
        const nb = String(b?.name || '');
        return na.localeCompare(nb);
      });

      const shown = filtered;
      const total = filtered.reduce((acc, o) => acc + Number(o?.amount_cents ?? 0), 0);

      const rows = shown
        .map((o) => {
          const date = escapeHtml(String(o.occ_date || ''));
          const name = escapeHtml(String(o.name || ''));
          const account = escapeHtml(acctName(o.src_account_id));
          const amt = fmtDollarsAccountingFromCents(Number(o.amount_cents ?? 0));
          return `
              <div class="dash-upcoming-row">
                <div class="dash-upcoming-date mono">${date}</div>
                <div class="dash-upcoming-name" title="${name}">${name}</div>
                <div class="dash-upcoming-acct" title="${account}">${account}</div>
                <div class="dash-upcoming-amt mono">${escapeHtml(amt)}</div>
              </div>
            `;
        })
        .join('');

      const title = `Upcoming expenses (${days}d)`;
      const subtitle = `${baseDate} → ${toDate}`;
      const totalLine = `Total: <span class="mono">${escapeHtml(fmtDollarsAccountingFromCents(total))}</span>`;

      box.innerHTML = `
          <div class="dash-upcoming-head">
            <div>
              <div class="dash-upcoming-title">${title}</div>
              <div class="dash-upcoming-sub">${escapeHtml(subtitle)}</div>
            </div>
            <div class="dash-upcoming-total">${totalLine}</div>
          </div>
          ${shown.length ? `<div class="dash-upcoming-list">${rows}</div>` : `<div class="notice">No scheduled expenses in the next ${days} days.</div>`}
        `;
    };

    const unsub = context.on('selection', () => update());
    update();

    return {
      update,
      resize() {
        // layout-only; nothing to recalc for size changes
      },
      destroy() {
        unsub();
      },
    };
  },
};
