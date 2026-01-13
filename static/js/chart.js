import { fmtDollarsAccountingFromCents } from './money.js';

function hash32FNV1a(str) {
    // Small, fast, deterministic hash for stable colors.
    // https://en.wikipedia.org/wiki/Fowler%E2%80%93Noll%E2%80%93Vo_hash_function
    let h = 0x811c9dc5;
    const s = String(str);
    for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        // 32-bit FNV-1a prime multiplication via shifts.
        h = (h + (h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24)) >>> 0;
    }
    return h >>> 0;
}

export function stableSeriesColor(key, alpha = 0.92) {
    // Stable, high-contrast colors that remain consistent across reloads.
    // Use a couple of related hashes to vary hue/sat/lightness a bit.
    const h = hash32FNV1a(key) % 360;
    const s = 68 + (hash32FNV1a(`${key}:s`) % 14); // 68–81%
    const l = 54 + (hash32FNV1a(`${key}:l`) % 10); // 54–63%
    return `hsla(${h}, ${s}%, ${l}%, ${alpha})`;
}

function clamp(n, lo, hi) {
    return Math.max(lo, Math.min(hi, n));
}

function niceStep(raw) {
    // Roughly: 1, 2, 5 * 10^k steps
    if (raw <= 0) return 1;
    const k = Math.pow(10, Math.floor(Math.log10(raw)));
    const r = raw / k;
    const m = r <= 1 ? 1 : r <= 2 ? 2 : r <= 5 ? 5 : 10;
    return m * k;
}

export function drawLineChart(canvas, cfg) {
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.floor(rect.width));
    const h = Math.max(1, Math.floor(rect.height));

    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const padding = { l: 54, r: 18, t: 14, b: 34 };
    const plotW = w - padding.l - padding.r;
    const plotH = h - padding.t - padding.b;

    const series = cfg.series || [];
    const labels = cfg.labels || [];

    ctx.clearRect(0, 0, w, h);

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, w, h);

    // Determine min/max
    let minV = Infinity;
    let maxV = -Infinity;
    for (const s of series) {
        for (const v of s.values || []) {
            if (typeof v !== 'number') continue;
            minV = Math.min(minV, v);
            maxV = Math.max(maxV, v);
        }
    }
    if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
        // nothing to draw
        ctx.fillStyle = 'rgba(229,231,235,0.75)';
        ctx.font = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        ctx.fillText('No data', padding.l, padding.t + 14);
        return;
    }
    if (minV === maxV) {
        minV -= 1;
        maxV += 1;
    }

    const pad = (maxV - minV) * 0.08;
    minV -= pad;
    maxV += pad;

    const xAt = (i) => padding.l + (plotW * (i / Math.max(1, labels.length - 1)));
    const yAt = (v) => padding.t + plotH * (1 - (v - minV) / (maxV - minV));

    // Grid + Y ticks
    const gridY = 5;
    const rawStep = (maxV - minV) / gridY;
    const step = niceStep(rawStep);
    const y0 = Math.floor(minV / step) * step;

    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(156,163,175,0.15)';
    ctx.fillStyle = 'rgba(156,163,175,0.65)';
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    for (let k = 0; k <= gridY + 2; k++) {
        const v = y0 + k * step;
        if (v < minV || v > maxV) continue;
        const y = yAt(v);
        ctx.beginPath();
        ctx.moveTo(padding.l, y);
        ctx.lineTo(padding.l + plotW, y);
        ctx.stroke();
        const label = fmtDollarsAccountingFromCents(Math.round(v));
        ctx.fillText(label, 8, y + 4);
    }

    // X ticks (a few)
    const xTicks = clamp(cfg.xTicks ?? 4, 2, 10);
    ctx.fillStyle = 'rgba(156,163,175,0.65)';
    for (let t = 0; t < xTicks; t++) {
        const i = Math.round(((labels.length - 1) * t) / (xTicks - 1));
        const x = xAt(i);
        const label = labels[i] || '';
        ctx.fillText(label, x - Math.min(28, label.length * 3), padding.t + plotH + 20);
    }

    // Axes
    ctx.strokeStyle = 'rgba(229,231,235,0.25)';
    ctx.beginPath();
    ctx.moveTo(padding.l, padding.t);
    ctx.lineTo(padding.l, padding.t + plotH);
    ctx.lineTo(padding.l + plotW, padding.t + plotH);
    ctx.stroke();

    // Series lines
    for (const s of series) {
        const values = s.values || [];
        if (values.length < 2) continue;
        ctx.lineWidth = s.width || 2;
        ctx.strokeStyle = s.color || 'rgba(203,213,225,0.95)';
        ctx.beginPath();
        for (let i = 0; i < values.length; i++) {
            const x = xAt(i);
            const y = yAt(values[i]);
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.stroke();
    }
}
