export function addMonthsISO(isoDate, months) {
  // isoDate: YYYY-MM-DD
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setMonth(d.getMonth() + Number(months || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addYearsISO(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setFullYear(d.getFullYear() + Number(years || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function addDaysISO(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setDate(d.getDate() + Number(days || 0));
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

export function truncateText(value, max = 36) {
  const s = String(value ?? '');
  if (s.length <= max) return { text: s, title: s };
  const trimmed = s.slice(0, Math.max(0, max - 1)).trimEnd();
  return { text: `${trimmed}…`, title: s };
}

export function isoToDayNumber(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return NaN;
  return Math.floor(t / 86400000);
}

export function lowerBound(arr, x) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (arr[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function buildDateAxis(fromISO, toISO, stepDays) {
  const step = Math.max(1, Math.floor(Number(stepDays || 1)));
  const start = isoToDayNumber(fromISO);
  const end = isoToDayNumber(toISO);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return { dates: [], days: [] };

  const days = [];
  const dates = [];
  for (let d = start; d <= end; d += step) {
    days.push(d);
    const dt = new Date(d * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  if (days[days.length - 1] !== end) {
    days.push(end);
    const dt = new Date(end * 86400000);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, '0');
    const day = String(dt.getUTCDate()).padStart(2, '0');
    dates.push(`${y}-${m}-${day}`);
  }

  return { dates, days };
}

export function asInt(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export function createEmitter() {
  const listeners = new Map();
  return {
    on(event, handler) {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event).add(handler);
      return () => listeners.get(event)?.delete(handler);
    },
    emit(event, payload) {
      const set = listeners.get(event);
      if (!set) return;
      for (const handler of Array.from(set)) {
        try {
          handler(payload);
        } catch {
          // ignore
        }
      }
    },
  };
}

export const NAME_TRUNCATE = 36;
