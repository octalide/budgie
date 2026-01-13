import { $$ } from './dom.js';

export function activeNav(route) {
    $$('.navlink').forEach((a) => a.classList.toggle('active', a.dataset.route === route));
}

export function card(title, subtitle, bodyHtml) {
    return `
    <section class="card">
      <div class="card__head">
        <div>
          <div class="card__title">${title}</div>
          ${subtitle ? `<div class="card__subtitle">${subtitle}</div>` : ''}
        </div>
      </div>
      <div class="card__body">${bodyHtml}</div>
    </section>
  `;
}

export function table(columns, rows, rowActionsHtml, opts = {}) {
  const tableId = opts?.id ? String(opts.id) : '';
  const withFilter = Boolean(opts?.filter);
  const filterPlaceholder = opts?.filterPlaceholder || 'Filter…';

    const head = `<tr>${columns.map((c) => `<th title="${c}">${c}</th>`).join('')}${rowActionsHtml ? '<th></th>' : ''}</tr>`;
    const body = rows
        .map((r) => {
            const tds = columns
                .map((c) => {
            const v = r[c];
            if (v && typeof v === 'object' && Object.prototype.hasOwnProperty.call(v, 'text')) {
              const text = v.text ?? '';
              const title = v.title ?? text;
              const cls = v.className ? ` class="${v.className}"` : '';
              return `<td${cls} title="${title}">${text}</td>`;
            }
            return `<td title="${v ?? ''}">${v ?? ''}</td>`;
                })
                .join('');
            const act = rowActionsHtml ? `<td>${rowActionsHtml(r)}</td>` : '';
            return `<tr>${tds}${act}</tr>`;
        })
        .join('');

  const idAttr = tableId ? ` data-table-id="${tableId}"` : '';
  const tableHtml = `<div class="table-wrap"><table class="table"${idAttr}><thead>${head}</thead><tbody>${body}</tbody></table></div>`;
  if (!withFilter) return tableHtml;

  if (!tableId) {
    // If filtering is requested, we need a stable identifier.
    // Fall back to rendering without filter rather than breaking the page.
    return tableHtml;
  }

  return `
    <div class="table-tools">
    <input class="table-filter" data-table-filter="${tableId}" placeholder="${filterPlaceholder}" />
    <div class="table-count" data-table-count="${tableId}"></div>
    </div>
    ${tableHtml}
  `;
}

export function wireTableFilters(root = document) {
  const inputs = Array.from(root.querySelectorAll('input[data-table-filter]'));
  for (const input of inputs) {
    const id = input.getAttribute('data-table-filter');
    if (!id) continue;

    const table = root.querySelector(`table[data-table-id="${CSS.escape(id)}"]`);
    if (!table) continue;

    const countEl = root.querySelector(`[data-table-count="${CSS.escape(id)}"]`);
    const tbody = table.tBodies?.[0];
    if (!tbody) continue;

    const rows = Array.from(tbody.rows);
    for (const tr of rows) {
      // Cache a normalized search string to keep filtering snappy.
      if (!tr.dataset.searchText) {
        const tds = Array.from(tr.cells);
        let cells = tds;
        if (tds.length >= 2) {
          const last = tds[tds.length - 1];
          // Only exclude last cell if it looks like an actions column.
          if (last && last.querySelector && last.querySelector('button, a')) {
            cells = tds.slice(0, tds.length - 1);
          }
        }
        tr.dataset.searchText = cells.map((td) => td.textContent || '').join(' ').toLowerCase();
      }
    }

    const update = () => {
      const q = (input.value || '').trim().toLowerCase();
      let shown = 0;
      for (const tr of rows) {
        const hay = tr.dataset.searchText || '';
        const ok = q === '' ? true : hay.includes(q);
        tr.style.display = ok ? '' : 'none';
        if (ok) shown++;
      }
      if (countEl) countEl.textContent = `${shown} / ${rows.length}`;
    };

    input.addEventListener('input', update);
    update();
  }
}
