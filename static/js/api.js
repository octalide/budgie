import { $ } from './dom.js';

let _session = null;

export function getSession() {
    return _session;
}

export function setSession(session) {
    _session = session;
}

export async function loadSession() {
    const res = await api('/api/session');
    _session = res.data;
    return _session;
}

export async function api(path, opts = {}) {
    const method = (opts.method || 'GET').toUpperCase();
    const headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
    if (method !== 'GET' && method !== 'HEAD' && method !== 'OPTIONS') {
        const csrf = _session?.csrf_token;
        if (csrf && !headers['X-CSRF-Token']) headers['X-CSRF-Token'] = csrf;
    }
    const res = await fetch(path, {
        credentials: 'same-origin',
        ...opts,
        headers,
    });
    const data = await res.json().catch(() => ({}));
    if (res.status === 401 && path !== '/api/session' && !path.startsWith('/api/auth')) {
        _session = null;
        setStatus('bad', 'Authentication required');
        location.hash = '#/login';
    }
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
