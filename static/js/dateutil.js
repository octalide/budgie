export function addMonthsISO(isoDate, months) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  const targetMonth = (d.getUTCMonth() + months) % 12;
  const expectedMonth = targetMonth < 0 ? targetMonth + 12 : targetMonth;
  d.setUTCMonth(d.getUTCMonth() + Number(months || 0));
  if (d.getUTCMonth() !== expectedMonth) {
    d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export function addYearsISO(isoDate, years) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  const targetMonth = d.getUTCMonth();
  d.setUTCFullYear(d.getUTCFullYear() + Number(years || 0));
  if (d.getUTCMonth() !== targetMonth) {
    d.setUTCDate(0);
  }
  return d.toISOString().slice(0, 10);
}

export function addDaysISO(isoDate, days) {
  const d = new Date(`${isoDate}T00:00:00Z`);
  if (!Number.isFinite(d.getTime())) return isoDate;
  d.setUTCDate(d.getUTCDate() + Number(days || 0));
  return d.toISOString().slice(0, 10);
}

export function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
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
