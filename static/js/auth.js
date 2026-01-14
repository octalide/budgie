import { $, escapeHtml } from './dom.js';
import { api, getSession, loadSession, setSession, setStatus } from './api.js';

export async function ensureSession() {
    if (!getSession()) {
        try {
            await loadSession();
        } catch (e) {
            setStatus('bad', e.message);
        }
    }
    return getSession();
}

export function renderAuthControls(session) {
    const el = $('#auth');
    if (!el) return;
    const user = session?.user || null;
    const auth = session?.auth || {};
    const oidcEnabled = Boolean(auth?.oidc_enabled);
    const provider = auth?.oidc_provider || 'OIDC';

    document.body.classList.toggle('auth-logged-out', !user);

    if (!user) {
        el.innerHTML = `<a href="#/login">Sign in</a>`;
        return;
    }

    const linkBtn = oidcEnabled && !user.oidc_linked
        ? `<button id="auth_link">Link ${escapeHtml(provider)}</button>`
        : '';

    el.innerHTML = `
        <span class="auth__user">${escapeHtml(user.display_name || user.email || 'Signed in')}</span>
        ${linkBtn}
        <button id="auth_logout">Log out</button>
    `;

    const logoutBtn = $('#auth_logout');
    if (logoutBtn) logoutBtn.onclick = async () => {
        await logout();
    };

    const link = $('#auth_link');
    if (link) link.onclick = () => startOIDCLink();
}

export async function loginWithPassword(email, password) {
    await api('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
    });
    const session = await loadSession();
    renderAuthControls(session);
    setStatus('ok', 'Signed in');
    return session;
}

export async function registerWithPassword(email, password, display_name) {
    await api('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify({ email, password, display_name }),
    });
    const session = await loadSession();
    renderAuthControls(session);
    setStatus('ok', 'Account created');
    return session;
}

export async function logout() {
    await api('/api/auth/logout', { method: 'POST' });
    setSession(null);
    const session = await loadSession();
    renderAuthControls(session);
    setStatus('ok', 'Signed out');
    location.hash = '#/login';
}

export function startOIDCLogin() {
    window.location.href = '/auth/oidc/login';
}

export function startOIDCLink() {
    window.location.href = '/auth/oidc/login?link=1';
}
