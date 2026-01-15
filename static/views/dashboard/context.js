import { api } from '../../js/api.js';
import { addYearsISO, createEmitter } from './utils.js';

export function createDashboardContext(asOf, accounts = [], range = null) {
  const emitter = createEmitter();
  const balancesCache = new Map();
  const seriesCache = new Map();
  const occurrencesCache = new Map();
  const entriesCache = new Map();
  let accountMeta = new Map();
  const accountById = new Map((accounts || []).map((a) => [Number(a.id), a]));
  const dateRange = {
    from: range?.from || asOf,
    to: range?.to || addYearsISO(range?.from || asOf, 1),
  };

  const context = {
    asOf,
    range: dateRange,
    selection: { locked: false, date: asOf, idx: 0, source: null, mode: 'projected' },
    on: emitter.on,
    emit: emitter.emit,
    setSelection(next) {
      context.selection = { ...context.selection, ...next };
      emitter.emit('selection', context.selection);
    },
    setRange(next) {
      const from = next?.from || dateRange.from;
      const to = next?.to || dateRange.to;
      dateRange.from = from;
      dateRange.to = to;
      context.asOf = from;
      balancesCache.clear();
      seriesCache.clear();
      occurrencesCache.clear();
      entriesCache.clear();
      accountMeta = new Map();
      emitter.emit('range', { from, to });
    },
    async getBalances(date, opts = {}) {
      const mode = opts?.mode || 'actual';
      const fromDate = opts?.fromDate || asOf;
      const key = `${mode}|${String(date || asOf)}|${mode === 'projected' ? fromDate : ''}`;
      if (balancesCache.has(key)) return balancesCache.get(key);
      const qs = new URLSearchParams({ mode, as_of: String(date || asOf) });
      if (mode === 'projected') qs.set('from_date', fromDate);
      const res = await api(`/api/balances?${qs.toString()}`);
      const data = res.data || [];
      balancesCache.set(key, data);
      for (const acct of data) {
        accountMeta.set(Number(acct.id), acct);
      }
      return data;
    },
    async getSeries({ fromDate, toDate, stepDays, includeInterest, mode }) {
      const seriesMode = mode || 'projected';
      const include = seriesMode === 'projected' && Boolean(includeInterest);
      const key = `${seriesMode}|${fromDate}|${toDate}|${stepDays}|${include ? '1' : '0'}`;
      if (seriesCache.has(key)) return seriesCache.get(key);
      const qs = new URLSearchParams({
        mode: seriesMode,
        from_date: fromDate,
        to_date: toDate,
        step_days: String(stepDays),
      });
      if (include) qs.set('include_interest', '1');
      const res = await api(`/api/balances/series?${qs.toString()}`);
      const data = res.data || null;
      seriesCache.set(key, data);
      return data;
    },
    async getOccurrences(fromDate, toDate) {
      const key = `${fromDate}|${toDate}`;
      if (occurrencesCache.has(key)) return occurrencesCache.get(key);
      const qs = new URLSearchParams({ from_date: fromDate, to_date: toDate });
      const res = await api(`/api/occurrences?${qs.toString()}`);
      const data = res.data || [];
      occurrencesCache.set(key, data);
      return data;
    },
    async getEntries() {
      const key = 'all';
      if (entriesCache.has(key)) return entriesCache.get(key);
      const res = await api('/api/entries');
      const data = res.data || [];
      entriesCache.set(key, data);
      return data;
    },
    accounts,
    accountById,
    async getAccountMeta() {
      if (accountMeta.size) return accountMeta;
      await context.getBalances(asOf, { mode: 'actual' });
      return accountMeta;
    },
  };

  return context;
}
