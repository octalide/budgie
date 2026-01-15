import { escapeHtml } from '../../../js/dom.js';
import { fmtDollarsAccountingFromCents } from '../../../js/money.js';
import { stableSeriesColor } from '../../../js/chart.js';
import { addDaysISO, clamp, asInt, truncateText } from '../utils.js';

const LABEL_MAX = 18;

const normalizeName = (value) => {
  const s = String(value ?? '').trim();
  return s ? s : 'Uncategorized';
};

const addToMap = (map, key, amount) => {
  const amt = Number(amount ?? 0);
  if (!Number.isFinite(amt) || amt <= 0) return;
  map.set(key, (map.get(key) || 0) + amt);
};

const mapToList = (map) =>
  Array.from(map.entries())
    .map(([name, amount]) => ({ name, amount }))
    .filter((item) => Number(item.amount ?? 0) > 0);

const takeTop = (list, topN) => {
  const sorted = [...list].sort((a, b) => Number(b.amount ?? 0) - Number(a.amount ?? 0));
  if (sorted.length <= topN) return sorted;
  const head = sorted.slice(0, topN);
  const rest = sorted.slice(topN);
  const restTotal = rest.reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
  if (restTotal > 0) head.push({ name: 'Other', amount: restTotal, isOther: true });
  return head;
};

const colorFor = (name, alpha) => {
  const label = String(name || '');
  if (label === 'Surplus') return `rgba(52, 211, 153, ${alpha})`;
  if (label === 'Deficit') return `rgba(251, 113, 133, ${alpha})`;
  return stableSeriesColor(label, alpha);
};

export const cashflow = {
  type: 'cashflow',
  title: 'Cashflow',
  description: 'Money flow view for a configurable window.',
  defaultSize: 'lg',
  minW: 3,
  minH: 3,
  defaultConfig: {
    mode: 'actual',
    windowDays: 30,
    topN: 8,
    syncSelection: true,
    showHidden: false,
    accountId: '',
  },
  settings: [
    {
      key: 'mode',
      label: 'Mode',
      type: 'select',
      options: [
        { value: 'actual', label: 'Actual (entries)' },
        { value: 'scheduled', label: 'Scheduled (occurrences)' },
      ],
    },
    { key: 'accountId', label: 'Account', type: 'account' },
    { key: 'windowDays', label: 'Window (days)', type: 'number', min: 7, max: 365, step: 1 },
    { key: 'topN', label: 'Top items', type: 'number', min: 3, max: 20, step: 1 },
    { key: 'syncSelection', label: 'Sync to selection', type: 'checkbox' },
    { key: 'showHidden', label: 'Show hidden accounts', type: 'checkbox' },
  ],
  mount({ root, context, instance }) {
    const body = root.querySelector('.dash-widget-body');
    body.innerHTML = `
        <div class="dash-flow">
          <div class="dash-flow-head">
            <div class="dash-flow-title">Cashflow</div>
            <div class="dash-flow-range"></div>
          </div>
          <div class="dash-flow-sub"></div>
          <div class="dash-flow-graph">
            <svg class="dash-flow-svg" aria-label="Cashflow"></svg>
            <div class="dash-flow-empty notice">No cashflow in this window.</div>
          </div>
        </div>
      `;

    const rangeEl = body.querySelector('.dash-flow-range');
    const subEl = body.querySelector('.dash-flow-sub');
    const graphEl = body.querySelector('.dash-flow-graph');
    const svg = body.querySelector('.dash-flow-svg');
    const emptyEl = body.querySelector('.dash-flow-empty');

    const state = {
      flow: null,
    };

    const draw = () => {
      if (!svg || !graphEl || !state.flow) return;
      const rect = graphEl.getBoundingClientRect();
      const width = Math.max(1, Math.floor(rect.width));
      const height = Math.max(1, Math.floor(rect.height));
      svg.setAttribute('width', String(width));
      svg.setAttribute('height', String(height));
      svg.setAttribute('viewBox', `0 0 ${width} ${height}`);

      const { sources, sinks, totalFlow, totalIn, totalOut, displayTotal } = state.flow;
      if (!totalFlow || sources.length === 0 || sinks.length === 0 || width < 80 || height < 80) {
        svg.innerHTML = '';
        if (emptyEl) emptyEl.style.display = 'flex';
        return;
      }

      if (emptyEl) emptyEl.style.display = 'none';

      const padL = 150;
      const padR = 150;
      const padT = 20;
      const padB = 28;
      const nodeW = 8;
      const centerW = 10;
      const minRowH = 14;
      const nodeGap = 4;
      const labelPad = 8;

      const nLeft = sources.length;
      const nRight = sinks.length;

      const availableH = height - padT - padB;
      const centerH = Math.max(100, availableH * 0.85);

      const leftX = padL;
      const rightX = Math.max(leftX + nodeW + 60, width - padR - nodeW);
      const centerX = Math.round((leftX + rightX) / 2 - centerW / 2);

      const centerTop = padT + (availableH - centerH) / 2;

      // Calculate proportional heights for flows at center
      const leftHeights = sources.map((s) => {
        const frac = Number(s.amount ?? 0) / totalFlow;
        return Math.max(2, Math.round(frac * centerH));
      });
      const rightHeights = sinks.map((s) => {
        const frac = Number(s.amount ?? 0) / totalFlow;
        return Math.max(2, Math.round(frac * centerH));
      });

      // Calculate node heights - use flow height but ensure minimum for readability
      const leftNodeHeights = leftHeights.map((h) => Math.max(minRowH, h));
      const rightNodeHeights = rightHeights.map((h) => Math.max(minRowH, h));

      // Calculate total stack heights including gaps
      const leftStackH = leftNodeHeights.reduce((a, b) => a + b, 0) + Math.max(0, nLeft - 1) * nodeGap;
      const rightStackH = rightNodeHeights.reduce((a, b) => a + b, 0) + Math.max(0, nRight - 1) * nodeGap;

      // Center the stacks vertically
      const leftTop = padT + (availableH - leftStackH) / 2;
      const rightTop = padT + (availableH - rightStackH) / 2;

      const paths = [];
      const nodes = [];
      const texts = [];

      let yLeft = leftTop;
      let centerIn = centerTop;
      sources.forEach((item, idx) => {
        const flowH = leftHeights[idx];
        const nodeH = leftNodeHeights[idx];
        const slotY = yLeft + nodeH / 2;
        const centerY = centerIn + flowH / 2;
        const name = item.name || '';
        const label = truncateText(name, LABEL_MAX);
        const amountText = fmtDollarsAccountingFromCents(Number(item.amount ?? 0));
        const nodeColor = colorFor(name, 0.92);
        const flowColor = colorFor(name, 0.45);

        const x0 = leftX + nodeW;
        const x1 = centerX;
        const c0 = x0 + (x1 - x0) * 0.5;
        const c1 = c0;
        const strokeW = Math.max(2, flowH);

        paths.push(
          `<path d="M ${x0} ${slotY} C ${c0} ${slotY}, ${c1} ${centerY}, ${x1} ${centerY}" stroke="${flowColor}" stroke-width="${strokeW}" fill="none" />`
        );
        nodes.push(
          `<rect x="${leftX}" y="${yLeft}" width="${nodeW}" height="${nodeH}" rx="1" fill="${nodeColor}" />`
        );

        const labelX = leftX - labelPad;
        const labelY = slotY + 4;
        texts.push(
          `<text class="flow-label flow-label-left" x="${labelX}" y="${labelY}" text-anchor="end">
            <title>${escapeHtml(label.title)} ${escapeHtml(amountText)}</title>
            <tspan class="flow-label-name">${escapeHtml(label.text)}</tspan>
            <tspan class="flow-label-amt" dx="4">${escapeHtml(amountText)}</tspan>
          </text>`
        );

        yLeft += nodeH + nodeGap;
        centerIn += flowH;
      });

      let yRight = rightTop;
      let centerOut = centerTop;
      sinks.forEach((item, idx) => {
        const flowH = rightHeights[idx];
        const nodeH = rightNodeHeights[idx];
        const slotY = yRight + nodeH / 2;
        const centerY = centerOut + flowH / 2;
        const name = item.name || '';
        const label = truncateText(name, LABEL_MAX);
        const amountText = fmtDollarsAccountingFromCents(Number(item.amount ?? 0));
        const nodeColor = colorFor(name, 0.92);
        const flowColor = colorFor(name, 0.45);

        const x0 = centerX + centerW;
        const x1 = rightX;
        const c0 = x0 + (x1 - x0) * 0.5;
        const c1 = c0;
        const strokeW = Math.max(2, flowH);

        paths.push(
          `<path d="M ${x0} ${centerY} C ${c0} ${centerY}, ${c1} ${slotY}, ${x1} ${slotY}" stroke="${flowColor}" stroke-width="${strokeW}" fill="none" />`
        );
        nodes.push(
          `<rect x="${rightX}" y="${yRight}" width="${nodeW}" height="${nodeH}" rx="1" fill="${nodeColor}" />`
        );

        const labelX = rightX + nodeW + labelPad;
        const labelY = slotY + 4;
        texts.push(
          `<text class="flow-label flow-label-right" x="${labelX}" y="${labelY}" text-anchor="start">
            <title>${escapeHtml(label.title)} ${escapeHtml(amountText)}</title>
            <tspan class="flow-label-name">${escapeHtml(label.text)}</tspan>
            <tspan class="flow-label-amt" dx="4">${escapeHtml(amountText)}</tspan>
          </text>`
        );

        yRight += nodeH + nodeGap;
        centerOut += flowH;
      });

      const centerLabelY = centerTop + centerH / 2 - 6;
      texts.push(
        `<text class="flow-center" x="${centerX + centerW / 2}" y="${centerLabelY}" text-anchor="middle">
          <tspan class="flow-center-title" x="${centerX + centerW / 2}" dy="0">Cash Flow</tspan>
          <tspan class="flow-center-amt" x="${centerX + centerW / 2}" dy="12">${escapeHtml(fmtDollarsAccountingFromCents(displayTotal))}</tspan>
        </text>`
      );

      nodes.push(
        `<rect x="${centerX}" y="${centerTop}" width="${centerW}" height="${centerH}" rx="3" fill="rgba(255,255,255,0.08)" stroke="rgba(148,163,184,0.25)" />`
      );

      const subtitle = `In ${escapeHtml(fmtDollarsAccountingFromCents(totalIn))} • Out ${escapeHtml(fmtDollarsAccountingFromCents(totalOut))}`;
      svg.innerHTML = `
        <rect x="0" y="0" width="${width}" height="${height}" fill="rgba(0,0,0,0)" />
        <g class="flow-paths">${paths.join('')}</g>
        <g class="flow-nodes">${nodes.join('')}</g>
        <g class="flow-text">${texts.join('')}</g>
        <text class="flow-subtitle" x="${width / 2}" y="${height - 8}" text-anchor="middle">${subtitle}</text>
      `;
    };

    const update = async () => {
      const cfg = { ...cashflow.defaultConfig, ...(instance.config || {}) };
      const windowDays = clamp(asInt(cfg.windowDays, 30), 7, 365);
      const topN = clamp(asInt(cfg.topN, 8), 3, 20);
      const mode = cfg.mode === 'scheduled' ? 'scheduled' : 'actual';
      const accountId = cfg.accountId ? Number(cfg.accountId) : null;
      const baseDate = cfg.syncSelection && context.selection?.locked ? context.selection.date : context.asOf;

      let fromDate = baseDate;
      let toDate = baseDate;
      if (mode === 'scheduled') {
        fromDate = baseDate;
        toDate = addDaysISO(baseDate, windowDays);
      } else {
        fromDate = addDaysISO(baseDate, -(windowDays - 1));
        toDate = baseDate;
      }

      if (rangeEl) rangeEl.textContent = `${windowDays}D`;

      const meta = await context.getAccountMeta();
      const isHidden = (id) => {
        if (id === null || id === undefined || id === '') return false;
        const n = Number(id);
        if (!Number.isFinite(n)) return false;
        return Number(meta.get(n)?.exclude_from_dashboard ?? 0) === 1;
      };

      const inflows = new Map();
      const outflows = new Map();

      if (mode === 'scheduled') {
        const occ = await context.getOccurrences(fromDate, toDate);
        for (const o of occ || []) {
          const kind = String(o?.kind || '');
          if (kind !== 'I' && kind !== 'E') continue;
          const amount = Math.abs(Number(o?.amount_cents ?? 0));
          if (!Number.isFinite(amount) || amount <= 0) continue;

          if (kind === 'I') {
            const destId = o?.dest_account_id;
            if (accountId && Number(destId) !== accountId) continue;
            if (!cfg.showHidden && isHidden(destId)) continue;
            addToMap(inflows, normalizeName(o?.name), amount);
          } else {
            const srcId = o?.src_account_id;
            if (accountId && Number(srcId) !== accountId) continue;
            if (!cfg.showHidden && isHidden(srcId)) continue;
            addToMap(outflows, normalizeName(o?.name), amount);
          }
        }
      } else {
        const entries = await context.getEntries();
        for (const e of entries || []) {
          const d = String(e?.entry_date || '');
          if (d < fromDate || d > toDate) continue;
          const srcId = e?.src_account_id;
          const destId = e?.dest_account_id;
          const hasSrc = srcId !== null && srcId !== undefined && srcId !== '';
          const hasDest = destId !== null && destId !== undefined && destId !== '';
          const amount = Math.abs(Number(e?.amount_cents ?? 0));
          if (!Number.isFinite(amount) || amount <= 0) continue;

          if (hasDest && !hasSrc) {
            if (accountId && Number(destId) !== accountId) continue;
            if (!cfg.showHidden && isHidden(destId)) continue;
            addToMap(inflows, normalizeName(e?.name), amount);
          } else if (hasSrc && !hasDest) {
            if (accountId && Number(srcId) !== accountId) continue;
            if (!cfg.showHidden && isHidden(srcId)) continue;
            addToMap(outflows, normalizeName(e?.name), amount);
          }
        }
      }

      const sources = takeTop(mapToList(inflows), topN);
      const sinks = takeTop(mapToList(outflows), topN);
      const totalInBase = sources.reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
      const totalOutBase = sinks.reduce((acc, item) => acc + Number(item.amount ?? 0), 0);
      const net = totalInBase - totalOutBase;

      let totalIn = totalInBase;
      let totalOut = totalOutBase;
      if (net > 0) {
        sinks.push({ name: 'Surplus', amount: net, isBalance: true });
        totalOut += net;
      } else if (net < 0) {
        sources.push({ name: 'Deficit', amount: Math.abs(net), isBalance: true });
        totalIn += Math.abs(net);
      }

      const totalFlow = Math.max(totalIn, totalOut);
      const modeLabel = mode === 'scheduled' ? 'Scheduled' : 'Actual';
      const sub = `${fromDate} → ${toDate} • ${modeLabel}`;
      if (subEl) subEl.textContent = sub;

      state.flow = {
        sources,
        sinks,
        totalIn,
        totalOut,
        totalFlow,
        displayTotal: totalInBase,
      };

      requestAnimationFrame(draw);
    };

    const resize = () => {
      requestAnimationFrame(draw);
    };

    const selectionUnsub = context.on('selection', () => update());
    const rangeUnsub = context.on('range', () => update());

    update();

    return {
      update,
      resize,
      destroy() {
        selectionUnsub();
        rangeUnsub();
      },
    };
  },
};
