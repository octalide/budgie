import { $, escapeHtml } from '../js/dom.js';
import { getSession } from '../js/api.js';
import { activeNav, card } from '../js/ui.js';
import { ensureSession, loginWithPassword, registerWithPassword, startOIDCLogin } from '../js/auth.js';

export async function viewLogin() {
    activeNav('');
    const session = (await ensureSession()) || getSession() || {};
    const auth = session.auth || {};
    const provider = auth.oidc_provider || 'OIDC';
    const oidcEnabled = Boolean(auth.oidc_enabled);
    const allowSignup = Boolean(auth.allow_signup);
    const passwordMin = auth.password_min || 12;

    $('#page').innerHTML = card(
        'Sign in',
        'Use a local account or your identity provider.',
        `
        <div class="grid two">
          <div>
            <div class="notice" style="margin-bottom: 10px;">
              Local sign-in uses your Budgie password. ${oidcEnabled ? `You can also use ${escapeHtml(provider)} (passkeys supported if your provider enables them).` : ''}
            </div>
            <label>Email</label>
            <input id="login_email" type="email" placeholder="you@example.com" />
            <label style="margin-top: 10px;">Password</label>
            <input id="login_password" type="password" placeholder="••••••••" />
            <div class="actions" style="margin-top: 10px;">
              <button class="primary" id="login_btn">Sign in</button>
              ${oidcEnabled ? `<button id="oidc_btn">Continue with ${escapeHtml(provider)}</button>` : ''}
            </div>
          </div>
          <div>
            <div class="notice" style="margin-bottom: 10px;">
              ${allowSignup ? `Create a backup local account (min ${passwordMin} characters).` : 'Signups are currently disabled.'}
            </div>
            <label>Display name (optional)</label>
            <input id="reg_name" placeholder="Your name" ${allowSignup ? '' : 'disabled'} />
            <label style="margin-top: 10px;">Email</label>
            <input id="reg_email" type="email" placeholder="you@example.com" ${allowSignup ? '' : 'disabled'} />
            <label style="margin-top: 10px;">Password</label>
            <input id="reg_password" type="password" placeholder="••••••••" ${allowSignup ? '' : 'disabled'} />
            <div class="actions" style="margin-top: 10px;">
              <button class="primary" id="reg_btn" ${allowSignup ? '' : 'disabled'}>Create account</button>
            </div>
          </div>
        </div>
        `
    );

    const loginBtn = $('#login_btn');
    if (loginBtn) {
        loginBtn.onclick = async () => {
            const email = $('#login_email').value || '';
            const password = $('#login_password').value || '';
        try {
          await loginWithPassword(email, password);
          location.hash = '#/dashboard';
        } catch (e) {
          alert(e.message);
        }
        };
    }

    const oidcBtn = $('#oidc_btn');
    if (oidcBtn) {
        oidcBtn.onclick = () => startOIDCLogin();
    }

    const regBtn = $('#reg_btn');
    if (regBtn && allowSignup) {
        regBtn.onclick = async () => {
            const email = $('#reg_email').value || '';
            const password = $('#reg_password').value || '';
            const name = $('#reg_name').value || '';
        try {
          await registerWithPassword(email, password, name);
          location.hash = '#/dashboard';
        } catch (e) {
          alert(e.message);
        }
        };
    }
}
