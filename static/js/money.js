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
    if (!/^-?\d+(\.\d+)?$/.test(t)) return null;
    const negative = t.startsWith('-');
    const abs = negative ? t.slice(1) : t;
    const parts = abs.split('.');
    const whole = parseInt(parts[0], 10) || 0;
    let frac = parts[1] || '';
    // Pad or truncate to exactly 2 decimal places, rounding the third digit.
    if (frac.length > 2) {
        const third = parseInt(frac[2], 10);
        frac = frac.slice(0, 2);
        let cents = whole * 100 + parseInt(frac.padEnd(2, '0'), 10);
        if (third >= 5) cents += 1;
        return negative ? -cents : cents;
    }
    frac = frac.padEnd(2, '0');
    const cents = whole * 100 + parseInt(frac, 10);
    return negative ? -cents : cents;
}
