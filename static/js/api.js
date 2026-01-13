import { $ } from './dom.js';

export async function api(path, opts = {}) {
    const res = await fetch(path, {
        headers: { 'Content-Type': 'application/json', ...(opts.headers || {}) },
        ...opts,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || data.ok === false) {
        const msg = data?.error || `Request failed (${res.status})`;
        const err = new Error(msg);
        err.details = data?.details;
        throw err;
    }
    return data;
}

export function setStatus(kind, text) {
    const el = $('#status');
    el.textContent = text;
    el.classList.remove('status--ok', 'status--bad');
    if (kind === 'ok') el.classList.add('status--ok');
    if (kind === 'bad') el.classList.add('status--bad');
}

export async function loadMeta() {
    try {
        const meta = await api('/api/meta');
        setStatus('ok', 'Connected');
        return meta;
    } catch (e) {
        setStatus('bad', e.message);
        throw e;
    }
}
