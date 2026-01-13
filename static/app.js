import { loadMeta } from './js/api.js';
import { route } from './router.js';

(async function boot() {
    try {
        await loadMeta();
    } catch {
        // loadMeta already set status
    }

    window.addEventListener('hashchange', route);
    await route();
})();
