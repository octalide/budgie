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

export function distinctSeriesPalette(keys, alpha = 0.92, opts = {}) {
    // Generate a palette that is *distinct within the provided set of keys*.
    // This avoids the "4 shades of purple" issue that can happen with per-key hashing.
    //
    // Notes:
    // - Colors are deterministic for a given set of keys.
    // - If the set of keys changes (accounts added/removed), hues may shift.
    const uniq = Array.from(new Set((keys || []).map((k) => String(k))));
    const n = uniq.length;
    const out = new Map();
    if (n === 0) return out;

    // Stable ordering regardless of input order.
    uniq.sort((a, b) => {
        const ha = hash32FNV1a(a);
        const hb = hash32FNV1a(b);
        return ha === hb ? (a < b ? -1 : a > b ? 1 : 0) : ha - hb;
    });

    // A small hue offset keeps us away from hard primaries on dark backgrounds.
    const seed = String(opts.seed ?? 'budgie');
    const offset = (hash32FNV1a(`palette:${seed}:${n}`) % 360) + 11;

    // Cycle lightness/saturation a bit so adjacent hues remain distinguishable
    // even when n is large.
    const satCycle = [78, 70, 82, 66];
    const lightCycle = [60, 52, 66, 56];

    for (let i = 0; i < n; i++) {
        const key = uniq[i];
        const hue = (offset + (i * 360) / n) % 360;
        const s = satCycle[i % satCycle.length];
        const l = lightCycle[i % lightCycle.length];
        out.set(key, `hsla(${hue.toFixed(1)}, ${s}%, ${l}%, ${alpha})`);
    }
    return out;
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

    // If this canvas previously had interactive handlers attached, remove them.
    if (canvas.__budgieLineChartCleanup) {
        try {
            canvas.__budgieLineChartCleanup();
        } catch {
            // ignore
        }
        canvas.__budgieLineChartCleanup = null;
    }

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

    // Clear immediately so "No data" doesn't overlay a previous render.
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(0,0,0,0.10)';
    ctx.fillRect(0, 0, w, h);

    const crosshairEnabled = Boolean(cfg.crosshair);
    const crosshairCfg = typeof cfg.crosshair === 'object' && cfg.crosshair ? cfg.crosshair : null;
    const crosshairLockOnClick = Boolean(crosshairCfg?.lockOnClick);
    const lockedIndex =
        crosshairCfg && (crosshairCfg.lockedIndex === null || crosshairCfg.lockedIndex === undefined)
            ? null
            : Number.isFinite(Number(crosshairCfg?.lockedIndex))
              ? Number(crosshairCfg.lockedIndex)
              : null;
    const onLockedIndexChange = typeof crosshairCfg?.onLockedIndexChange === 'function' ? crosshairCfg.onLockedIndexChange : null;

    // Cosmetic: show an affordance that the chart is interactive.
    if (crosshairEnabled) canvas.style.cursor = crosshairLockOnClick ? 'crosshair' : 'default';

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

    const mono11 = '11px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
    const mono12 = '12px ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';

    const xTicks = clamp(cfg.xTicks ?? 4, 2, 10);

    const valueFmt =
        typeof cfg.formatValue === 'function'
            ? cfg.formatValue
            : (v) => fmtDollarsAccountingFromCents(Math.round(Number(v ?? 0)));

    const render = (hoverIndex) => {
        ctx.clearRect(0, 0, w, h);

        // Background
        ctx.fillStyle = 'rgba(0,0,0,0.10)';
        ctx.fillRect(0, 0, w, h);

        // Grid + Y ticks
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(156,163,175,0.15)';
        ctx.fillStyle = 'rgba(156,163,175,0.65)';
        ctx.font = mono11;

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
        ctx.fillStyle = 'rgba(156,163,175,0.65)';
        ctx.font = mono11;
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

        if (!crosshairEnabled) return;

        // If a selection is locked, it should take precedence and remain visible even if the mouse leaves.
        const idxSource = lockedIndex !== null ? lockedIndex : hoverIndex;
        if (idxSource === null || idxSource === undefined) return;
        if (!labels || labels.length === 0) return;
        const i = clamp(Math.round(idxSource), 0, labels.length - 1);
        const x = xAt(i);

        // Crosshair line
        ctx.lineWidth = 1;
        ctx.strokeStyle = 'rgba(229,231,235,0.35)';
        ctx.beginPath();
        ctx.moveTo(x, padding.t);
        ctx.lineTo(x, padding.t + plotH);
        ctx.stroke();

        // Points + tooltip content
        const tooltipLines = [];
        const dateLabel = String(labels[i] || '');
        tooltipLines.push({ kind: 'title', text: dateLabel });

        for (const s of series) {
            const values = s.values || [];
            const v = values[i];
            if (typeof v !== 'number' || !Number.isFinite(v)) continue;
            const name = String(s.name || '');
            const text = `${name}: ${valueFmt(v)}`;
            tooltipLines.push({ kind: 'series', text, color: s.color || 'rgba(203,213,225,0.95)', value: v });

            // point marker
            const y = yAt(v);
            ctx.fillStyle = s.color || 'rgba(203,213,225,0.95)';
            ctx.beginPath();
            ctx.arc(x, y, 3, 0, Math.PI * 2);
            ctx.fill();
            ctx.strokeStyle = 'rgba(15,23,42,0.65)';
            ctx.lineWidth = 1;
            ctx.stroke();
        }

        // Tooltip
        ctx.font = mono12;
        const padX = 10;
        const padY = 8;
        const lineH = 15;
        let maxW = 0;
        for (const ln of tooltipLines) {
            maxW = Math.max(maxW, ctx.measureText(ln.text).width);
        }
        const boxW = Math.ceil(maxW + padX * 2 + 14);
        const boxH = Math.ceil(padY * 2 + tooltipLines.length * lineH);
        let boxX = x + 12;
        if (boxX + boxW > w - 6) boxX = x - 12 - boxW;
        boxX = clamp(boxX, 6, w - 6 - boxW);
        let boxY = padding.t + 6;
        if (boxY + boxH > h - 6) boxY = h - 6 - boxH;
        boxY = clamp(boxY, 6, h - 6 - boxH);

        ctx.fillStyle = 'rgba(15,23,42,0.92)';
        ctx.strokeStyle = 'rgba(148,163,184,0.25)';
        ctx.lineWidth = 1;
        ctx.fillRect(boxX, boxY, boxW, boxH);
        ctx.strokeRect(boxX, boxY, boxW, boxH);

        let yCursor = boxY + padY + lineH - 4;
        for (let idx = 0; idx < tooltipLines.length; idx++) {
            const ln = tooltipLines[idx];
            if (ln.kind === 'title') {
                ctx.fillStyle = 'rgba(229,231,235,0.95)';
                ctx.fillText(ln.text, boxX + padX, yCursor);
            } else {
                // swatch
                ctx.fillStyle = ln.color;
                ctx.fillRect(boxX + padX, yCursor - 10, 10, 10);
                ctx.fillStyle = 'rgba(229,231,235,0.90)';
                ctx.fillText(ln.text, boxX + padX + 14, yCursor);
            }
            yCursor += lineH;
        }
    };

    render(null);

    if (crosshairEnabled && labels.length > 0) {
        let lastIdx = null;

        const onMove = (e) => {
            // When locked, keep the crosshair fixed.
            if (lockedIndex !== null) return;
            const r = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const rel = (mx - padding.l) / Math.max(1, plotW);
            const idx = clamp(Math.round(rel * Math.max(1, labels.length - 1)), 0, labels.length - 1);
            if (idx === lastIdx) return;
            lastIdx = idx;
            render(idx);
        };
        const onLeave = () => {
            lastIdx = null;
            // If locked, keep rendering the locked crosshair; otherwise clear.
            render(null);
        };

        const onClick = (e) => {
            if (!crosshairLockOnClick || !onLockedIndexChange) return;
            const r = canvas.getBoundingClientRect();
            const mx = e.clientX - r.left;
            const rel = (mx - padding.l) / Math.max(1, plotW);
            const idx = clamp(Math.round(rel * Math.max(1, labels.length - 1)), 0, labels.length - 1);

            // Shift-click to clear selection.
            if (e.shiftKey) {
                onLockedIndexChange(null);
                return;
            }
            onLockedIndexChange(idx);
        };

        // Allow Escape to clear a locked selection.
        // Use a window handler so you don't have to keep the canvas focused.
        const onKeyDown = (e) => {
            if (!crosshairLockOnClick || !onLockedIndexChange) return;
            if (e.key !== 'Escape') return;
            if (lockedIndex === null) return;
            onLockedIndexChange(null);
        };

        canvas.addEventListener('mousemove', onMove);
        canvas.addEventListener('mouseleave', onLeave);
        canvas.addEventListener('click', onClick);
        window.addEventListener('keydown', onKeyDown);

        canvas.__budgieLineChartCleanup = () => {
            canvas.removeEventListener('mousemove', onMove);
            canvas.removeEventListener('mouseleave', onLeave);
            canvas.removeEventListener('click', onClick);
            window.removeEventListener('keydown', onKeyDown);
        };
    }
}
