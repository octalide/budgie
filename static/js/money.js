export function fmtDollarsFromCents(cents) {
    if (cents === null || cents === undefined) return '';
    const n = Number(cents);
    if (!Number.isFinite(n)) return '';
    const sign = n < 0 ? '-' : '';
    const abs = Math.abs(n);
    return `${sign}${(abs / 100).toFixed(2)}`;
}

// Accounting-style display: negatives in parentheses, no leading minus sign.
export function fmtDollarsAccountingFromCents(cents) {
    if (cents === null || cents === undefined) return '';
    const n = Number(cents);
    if (!Number.isFinite(n)) return '';
    const abs = Math.abs(n);
    const s = `${(abs / 100).toFixed(2)}`;
    return n < 0 ? `(${s})` : s;
}

export function parseCentsFromDollarsString(s) {
    if (s === null || s === undefined) return null;
    const t = String(s).trim();
    if (!t) return null;
    const n = Number(t);
    if (!Number.isFinite(n)) return null;
    return Math.round(n * 100);
}
