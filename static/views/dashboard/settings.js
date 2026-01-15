import { escapeHtml } from '../../js/dom.js';

export function widgetSettingsForm(def, instance, accounts = []) {
  const config = { ...def.defaultConfig, ...(instance.config || {}) };
  const checkboxFields = def.settings.filter((field) => field.type === 'checkbox');
  const otherFields = def.settings.filter((field) => field.type !== 'checkbox');

  const renderField = (field) => {
    const id = `ws_${field.key}`;
    if (field.type === 'number') {
      return `
        <div>
          <label>${field.label}</label>
          <input id="${id}" type="number" value="${escapeHtml(String(config[field.key] ?? ''))}" min="${field.min ?? ''}" max="${field.max ?? ''}" step="${field.step ?? 1}" />
        </div>
      `;
    }
    if (field.type === 'select') {
      const options = (field.options || [])
        .map((opt) => `<option value="${escapeHtml(String(opt.value))}" ${String(config[field.key]) === String(opt.value) ? 'selected' : ''}>${escapeHtml(String(opt.label))}</option>`)
        .join('');
      return `
        <div>
          <label>${field.label}</label>
          <select id="${id}">${options}</select>
        </div>
      `;
    }
    if (field.type === 'account') {
      const opts = ['<option value="">Any account</option>']
        .concat(
          (accounts || []).map(
            (a) =>
              `<option value="${escapeHtml(String(a.id))}" ${String(config[field.key]) === String(a.id) ? 'selected' : ''}>${escapeHtml(a.name || String(a.id))}</option>`
          )
        )
        .join('');
      return `
        <div>
          <label>${field.label}</label>
          <select id="${id}">${opts}</select>
        </div>
      `;
    }
    return '';
  };

  const fields = otherFields.map((field) => renderField(field)).join('');
  const checks = checkboxFields
    .map((field) => {
      const id = `ws_${field.key}`;
      return `
        <label class="dash-settings-check">
          <input type="checkbox" id="${id}" ${config[field.key] ? 'checked' : ''} />
          <span>${field.label}</span>
        </label>
      `;
    })
    .join('');

  return `
    <div class="grid two">
      <div>
        <label>Title</label>
        <input id="ws_title" value="${escapeHtml(instance.title || '')}" placeholder="${escapeHtml(def.title)}" />
      </div>
      ${fields}
    </div>
    ${checks ? `<div class="dash-settings-group">${checks}</div>` : ''}
    <div class="actions" style="margin-top: 12px;">
      <button class="primary" id="ws_save">Save</button>
      <button class="danger" id="ws_remove">Remove widget</button>
    </div>
  `;
}
