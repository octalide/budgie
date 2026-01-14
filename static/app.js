import { loadMeta } from './js/api.js';
import { ensureSession, renderAuthControls } from './js/auth.js';
import { route } from './router.js';

(async function boot() {
    try {
        await loadMeta();
        const session = await ensureSession();
        renderAuthControls(session);
    } catch {
        // loadMeta already set status
    }

    window.addEventListener('hashchange', route);
    await route();
})();
