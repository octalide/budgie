import { $, escapeHtml } from './js/dom.js';
import { setStatus } from './js/api.js';
import { ensureSession, renderAuthControls } from './js/auth.js';
import { card } from './js/ui.js';
import { viewLogin } from './views/login.js';
import { viewAccounts } from './views/accounts.js';
import { viewSchedules } from './views/schedules.js';
import { viewRevisions } from './views/revisions.js';
import { viewEntries } from './views/entries.js';
import { viewDashboard } from './views/dashboard.js';

export async function route() {
    const hash = location.hash || '#/accounts';
    const [, routeName] = hash.split('/');

    const session = await ensureSession();
    renderAuthControls(session);

    if (!session?.user && routeName !== 'login') {
        location.hash = '#/login';
        return;
    }
    if (session?.user && routeName === 'login') {
        location.hash = '#/dashboard';
        return;
    }

    try {
        if (routeName === 'login') return await viewLogin();
        if (routeName === 'dashboard') return await viewDashboard();
        if (routeName === 'accounts') return await viewAccounts();
        if (routeName === 'schedules') return await viewSchedules();
        if (routeName === 'revisions') return await viewRevisions();
        if (routeName === 'entries') return await viewEntries();
    } catch (e) {
        setStatus('bad', e.message);
        $('#page').innerHTML = card(
            'Error',
            e.message,
            `<pre class="mono">${escapeHtml(JSON.stringify(e.details || {}, null, 2))}</pre>`
        );
        return;
    }

    location.hash = '#/accounts';
    return;
}
