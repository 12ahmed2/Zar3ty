// Universal navbar. Exposes window.refreshAuthUI() and window.me
(function () {
  const PLACEHOLDER_ID = 'navbar-placeholder';
  const API_ME = '/api/me';
  const LOGOUT_PATH = '/api/auth/logout';

  function isLoggedInCookie() {
    return document.cookie.includes('access_token=') || document.cookie.includes('token=');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/[&<>"']/g, (m) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m]));
  }

  // Build navbar HTML
  function buildNavbar(me, active = 'home') {
    const nav = document.createElement('nav');
    nav.className = 'main-navbar';
    const username = me ? (me.name || me.fullname || me.email || 'Account') : null;

    // Language selector HTML (pulls saved lang from localStorage)
    const lang = localStorage.getItem('lang') || 'en';
    const langSelector = `
      <select id="lang-switcher" class="lang-switcher" aria-label="Language">
        <option value="en"${lang === 'en' ? ' selected' : ''}>English</option>
        <option value="ar"${lang === 'ar' ? ' selected' : ''}>العربية</option>
      </select>
    `;

    const leftLinks = `
      <a href="/" class="nav-link${active === 'home' ? ' active' : ''}" data-translate="navbar.home"></a>
      <a href="/courses" class="nav-link${active === 'courses' ? ' active' : ''}" data-translate="navbar.courses"></a>
      <a href="/bot" class="nav-link${active === 'bot' ? ' active' : ''}" data-translate="navbar.bot"></a>
    `;

    const rightLinks = me ? `
      <button id="btn-open-cart" class="nav-link icon" aria-label="Open cart" >
        <label data-translate="navbar.cart"></label> <span id="cart-count" class="badge">0</span>
      </button>
      <a href="/profile" class="nav-link${active === 'profile' ? ' active' : ''}">${escapeHtml(username)}</a>
      <button id="navbar-logout" class="nav-link" type="button" style="background:none;border:none;cursor:pointer;" data-translate="navbar.logout"></button>
      ${langSelector}
    ` : `
      <button id="btn-open-cart" class="nav-link icon" aria-label="Open cart">
        <label data-translate="navbar.cart"></label> <span id="cart-count" class="badge">0</span>
      </button>
      <a href="#" class="nav-link" id="navbar-login" data-translate="navbar.login"></a>
      <a href="#" class="nav-link" id="navbar-signup" data-translate="navbar.signup"></a>
      ${langSelector}
    `;

    nav.innerHTML = `
      <div class="nav-inner">
        <a href="/" class="nav-logo${active === 'home' ? ' active' : ''}" data-translate="navbar.title"></a>
        <div class="nav-links">
          ${leftLinks}
        </div>
        <div class="nav-links" style="gap:0.5rem;">
          ${rightLinks}
        </div>
      </div>
    `;
    return nav;
  }

  // Wire navbar events
  function wireNavbar(navRoot) {
    // login / signup dialogs
    navRoot.querySelector('#navbar-login')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('dlg-login')?.showModal();
    });
    navRoot.querySelector('#navbar-signup')?.addEventListener('click', (e) => {
      e.preventDefault();
      document.getElementById('dlg-signup')?.showModal();
    });

    // logout
    navRoot.querySelector('#navbar-logout')?.addEventListener('click', async (e) => {
      e.preventDefault();
      try {
        await fetch(LOGOUT_PATH, {
          method: 'POST',
          credentials: 'include',
          headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' }
        });
      } catch (err) { /* ignore network errors */ }

      const secureFlag = location.protocol === 'https:' ? '; Secure' : '';
      ['access_token', 'token', 'fp', 'guest_cart'].forEach(name => {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=None${secureFlag}`;
      });

      try { if (typeof window.refreshAuthUI === 'function') await window.refreshAuthUI(); } catch {}
      try { if (typeof window.updateCartBadge === 'function') await window.updateCartBadge(); } catch {}

      renderIntoPlaceholder();
      location.href = '/';
    });

    // open cart
    navRoot.querySelector('#btn-open-cart')?.addEventListener('click', (e) => {
      e.preventDefault();
      if (typeof window.openCart === 'function') { window.openCart(); return; }
      const cartDrawer = document.getElementById('cart-drawer');
      if (cartDrawer) cartDrawer.classList.add('open');
      if (typeof window.renderCart === 'function') window.renderCart().catch(() => {});
    });

    // language switcher handler
    const langSwitcher = navRoot.querySelector('#lang-switcher');
    if (langSwitcher) {
      langSwitcher.addEventListener('change', async function () {
        const selectedLang = this.value;
        localStorage.setItem('lang', selectedLang);
        document.documentElement.dir = (selectedLang === 'ar') ? 'rtl' : 'ltr';

        // Reload translations if available
        if (typeof window.loadLanguage === 'function') {
          await window.loadLanguage(selectedLang);
        }
        // Re-render navbar with new translations
        renderIntoPlaceholder();
      });
    }
  }

  // Detect which link is active
  function detectActive() {
    const p = location.pathname;
    if (p.startsWith('/courses')) return 'courses';
    if (p.startsWith('/profile')) return 'profile';
    if (p.startsWith('/bot')) return 'bot';
    return 'home';
  }

  // Render navbar into placeholder
  function renderIntoPlaceholder(active) {
    const placeholder = document.getElementById(PLACEHOLDER_ID);
    if (!placeholder) return;
    placeholder.innerHTML = '';
    const nav = buildNavbar(window.me || null, active || detectActive());
    placeholder.appendChild(nav);
    wireNavbar(nav);

    // Keep badge accurate after render
    if (typeof window.updateCartBadge === 'function') window.updateCartBadge().catch(() => {});

    // After re-render, ensure translation applied
    if (typeof window.loadLanguage === 'function') {
      const currentLang = localStorage.getItem('lang') || 'en';
      window.loadLanguage(currentLang);
    }
  }

  // Fetch /me and refresh UI
  async function refreshAuthUI() {
    try {
      const res = await fetch(API_ME, { credentials: 'include', headers: { 'Accept': 'application/json' } });
      if (res.ok) {
        const data = await res.json();
        window.me = data || null;
      } else {
        window.me = null;
      }
    } catch (err) {
      window.me = isLoggedInCookie() ? { email: 'user' } : null;
    }
    renderIntoPlaceholder();
    return window.me;
  }

  window.refreshAuthUI = refreshAuthUI;
  window.me = window.me || null;

  // Init on load
  (function init() {
    const placeholder = document.getElementById(PLACEHOLDER_ID);
    if (!placeholder) return;
    window.me = isLoggedInCookie() ? window.me || { email: 'user' } : null;

    // Set dir based on saved lang
    const currentLang = localStorage.getItem('lang') || 'en';
    document.documentElement.dir = (currentLang === 'ar') ? 'rtl' : 'ltr';

    renderIntoPlaceholder();
    refreshAuthUI().catch(() => {});
  })();
})();
