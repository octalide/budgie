import { $, escapeHtml } from './js/dom.js';
import { setStatus } from './js/api.js';
import { card } from './js/ui.js';
import { viewAccounts } from './views/accounts.js';
import { viewSchedules } from './views/schedules.js';
import { viewRevisions } from './views/revisions.js';
import { viewEntries } from './views/entries.js';
import { viewProjection } from './views/projection.js';
import { viewDashboard } from './views/dashboard.js';
import { viewExpenses } from './views/expenses.js';

export async function route() {
    const hash = location.hash || '#/accounts';
    const [, routeName] = hash.split('/');

    try {
        if (routeName === 'dashboard') return await viewDashboard();
        if (routeName === 'accounts') return await viewAccounts();
        if (routeName === 'schedules') return await viewSchedules();
        if (routeName === 'revisions') return await viewRevisions();
        if (routeName === 'entries') return await viewEntries();
        if (routeName === 'projection') return await viewProjection();
        if (routeName === 'expenses') return await viewExpenses();
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
}
