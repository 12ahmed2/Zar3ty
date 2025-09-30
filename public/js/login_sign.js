// inject-auth-dialogs.js
(function injectAuthDialogs() {
  if (document.getElementById('dlg-login') || document.getElementById('dlg-signup')) return;

  const html = `
  <!-- Login dialog -->
  <dialog id="dlg-login" class="modal" aria-labelledby="login-title">
    <form id="form-login" class="card" method="dialog">
      <h3 id="login-title" data-translate="auth.login.title">Log in</h3>

      <label>
        <lable data-translate="auth.login.email"> Email </lable>
        <input type="email" name="email" required autocomplete="email" />
      </label>

      <label>
        <label data-translate="auth.login.password">Password</label>
        <input type="password" name="password" required minlength="8" autocomplete="current-password" />
      </label>

      <button class="btn wide" type="submit" data-translate="auth.login.title">Log in</button>
      <button class="btn ghost wide" type="button" data-close data-translate="auth.login.cancel">Cancel</button>

      <p class="hint"> <label data-translate="auth.login.noAccount">No account?</label> <a href="#" data-open-signup data-translate="auth.signup.title">Sign up</a></p>
      <p id="login-error" class="error" role="alert" aria-live="assertive"></p>
    </form>
  </dialog>

  <!-- Signup dialog -->
  <dialog id="dlg-signup" class="modal" aria-labelledby="signup-title">
    <form id="form-signup" class="card" method="dialog">
      <h3 id="signup-title" data-translate="auth.signup.title">Create account</h3>

      <label>
        <label data-translate="auth.signup.fullname">Full name</label>
        <input type="text" name="fullname" required maxlength="200" autocomplete="name" />
      </label>

      <label>
        <label data-translate="auth.signup.email">Email</label>
        <input type="email" name="email" required autocomplete="email" />
      </label>

      <label>
        <label data-translate="auth.signup.password"> Password </label>
        <input type="password" name="password" required minlength="8" autocomplete="new-password" />
      </label>

      <button class="btn wide" type="submit" data-translate="auth.signup.title" >Sign up</button>
      <button class="btn ghost wide" type="button" data-close data-translate="auth.signup.cancel">Cancel</button>

      <p id="signup-error" class="error" role="alert" aria-live="assertive"></p>
    </form>
  </dialog>
  `;

  // Insert into document body
  const wrapper = document.createElement('div');
  wrapper.innerHTML = html;
  // Append dialogs (they are inert until shown)
  document.body.appendChild(wrapper);

  // Utility to open/close safely
  function safeShow(d) { try { d.showModal?.(); } catch (e) { /* older browsers fallback */ d.setAttribute('open',''); } }
  function safeClose(d) { try { d.close?.(); } catch (e) { d.removeAttribute('open'); } }

  // wire close buttons
  document.body.addEventListener('click', (ev) => {
    const btn = ev.target.closest('[data-close]');
    if (!btn) return;
    const dlg = btn.closest('dialog');
    if (dlg) safeClose(dlg);
  }, { capture: true });

  // wire open-signup links inside login
  document.body.addEventListener('click', (ev) => {
    const open = ev.target.closest('[data-open-signup]');
    if (!open) return;
    ev.preventDefault();
    const login = document.getElementById('dlg-login');
    const signup = document.getElementById('dlg-signup');
    if (login) safeClose(login);
    if (signup) safeShow(signup);
  }, { capture: true });

  // allow anchor-like elements to open login/sign up if they exist elsewhere
  document.body.addEventListener('click', (ev) => {
    const t = ev.target;
    const openLogin = t.closest('[data-open-login]');
    if (openLogin) {
      ev.preventDefault();
      const login = document.getElementById('dlg-login');
      if (login) safeShow(login);
      return;
    }
    const openSignup = t.closest('[data-open-signup-link]');
    if (openSignup) {
      ev.preventDefault();
      const signup = document.getElementById('dlg-signup');
      if (signup) safeShow(signup);
    }
  });

  // Escape closes any open dialog
  document.addEventListener('keydown', (ev) => {
    if (ev.key === 'Escape') {
      document.querySelectorAll('dialog').forEach(d => {
        if (d.open) safeClose(d);
      });
    }
  });

  // Prevent form method="dialog" from closing forms unexpectedly in some browsers.
  // Keep default behavior; user code (index.js) attaches submit handlers to #form-login and #form-signup.
})();