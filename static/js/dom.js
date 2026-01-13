export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => Array.from(el.querySelectorAll(sel));

export function escapeHtml(s) {
    return String(s)
        .replaceAll('&', '&amp;')
        .replaceAll('<', '&lt;')
        .replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll("'", '&#039;');
}
