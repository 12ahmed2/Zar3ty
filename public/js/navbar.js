// Complete navbar.js with correct responsive links and full mobile support
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

  function getUserInitials(name) {
    if (!name) return 'U';
    return name.split(' ').map(n => n[0]).join('').toUpperCase().substring(0, 2);
  }

  function buildNavbar(me, active = 'home') {
    const nav = document.createElement('nav');
    nav.className = 'main-navbar';
    const username = me ? (me.name || me.fullname || me.email || 'Account') : null;
    const userInitials = getUserInitials(username);

    const lang = localStorage.getItem('lang') || 'en';
    const langSelector = `
      <select id="lang-switcher" class="lang-switcher" aria-label="Language">
        <option value="en"${lang === 'en' ? ' selected' : ''}>English</option>
        <option value="ar"${lang === 'ar' ? ' selected' : ''}>العربية</option>
      </select>
    `;

    const leftLinks = `
      <a href="/" class="nav-link${active === 'home' ? ' active' : ''}" data-translate="navbar.home">Home</a>
      <a href="/courses" class="nav-link${active === 'courses' ? ' active' : ''}" data-translate="navbar.courses">Courses</a>
      <a href="/bot" class="nav-link${active === 'bot' ? ' active' : ''}" data-translate="navbar.bot">Bot</a>
    `;

    const rightLinks = me ? `
      <button id="btn-open-cart" class="nav-link icon" aria-label="Open cart">
        <span data-translate="navbar.cart">Cart</span> <span id="cart-count" class="badge">0</span>
      </button>
      <a href="/profile" class="nav-link${active === 'profile' ? ' active' : ''}">
        <span class="user-avatar">${userInitials}</span> ${escapeHtml(username)}
      </a>
      <button id="navbar-logout" class="nav-link" type="button" data-translate="navbar.logout">Logout</button>
      ${langSelector}
    ` : `
      <button id="btn-open-cart" class="nav-link icon" aria-label="Open cart">
        <span data-translate="navbar.cart">Cart</span> <span id="cart-count" class="badge">0</span>
      </button>
      <button id="navbar-login" class="nav-link" data-translate="navbar.login">Login</button>
      <button id="navbar-signup" class="nav-link" data-translate="navbar.signup">Sign Up</button>
      ${langSelector}
    `;

    // Single mobile nav panel with both left and right links
    nav.innerHTML = `
      <div class="mobile-menu-overlay" id="mobile-menu-overlay"></div>
      <div class="nav-inner">
        <a href="/" class="nav-logo" data-translate="navbar.title">PG Market</a>
        <div class="nav-links" id="mobile-nav-links">
          <div class="left-links">${leftLinks}</div>
          <div class="right-links">${rightLinks}</div>
        </div>
        <button class="hamburger" id="navbar-hamburger" aria-label="Toggle menu">
          <span></span><span></span><span></span>
        </button>
      </div>
    `;
    return nav;
  }

  // Mobile menu functionality
  function setupMobileMenu(navRoot) {
    const hamburger = navRoot.querySelector('#navbar-hamburger');
    const overlay = navRoot.querySelector('#mobile-menu-overlay');
    const mobileLinks = navRoot.querySelector('#mobile-nav-links');

    function closeMobileMenu() {
      mobileLinks.classList.remove('open');
      overlay.classList.remove('active');
      hamburger.classList.remove('active');
      document.body.classList.remove('no-scroll');
    }

    function openMobileMenu() {
      mobileLinks.classList.add('open');
      overlay.classList.add('active');
      hamburger.classList.add('active');
      document.body.classList.add('no-scroll');
    }

    hamburger.addEventListener('click', () => {
      hamburger.classList.contains('active') ? closeMobileMenu() : openMobileMenu();
    });

    overlay.addEventListener('click', closeMobileMenu);

    navRoot.querySelectorAll('.nav-links .nav-link').forEach(link => {
      link.addEventListener('click', closeMobileMenu);
    });

    document.addEventListener('keydown', e => {
      if (e.key === 'Escape') closeMobileMenu();
    });

    window.addEventListener('resize', () => {
      if (window.innerWidth > 768) closeMobileMenu();
    });

    return { openMobileMenu, closeMobileMenu };
  }

  function wireNavbar(navRoot) {
    const mobileMenu = setupMobileMenu(navRoot);

    navRoot.querySelector('#navbar-login')?.addEventListener('click', e => {
      e.preventDefault();
      mobileMenu.closeMobileMenu();
      document.getElementById('dlg-login')?.showModal();
    });

    navRoot.querySelector('#navbar-signup')?.addEventListener('click', e => {
      e.preventDefault();
      mobileMenu.closeMobileMenu();
      document.getElementById('dlg-signup')?.showModal();
    });

    navRoot.querySelector('#navbar-logout')?.addEventListener('click', async e => {
      e.preventDefault();
      mobileMenu.closeMobileMenu();
      try {
        await fetch(LOGOUT_PATH, { method: 'POST', credentials: 'include', headers: { 'X-Requested-With': 'XMLHttpRequest', 'Accept': 'application/json' } });
      } catch {}

      const secureFlag = location.protocol === 'https:' ? '; Secure' : '';
      ['access_token', 'token', 'fp', 'guest_cart'].forEach(name => {
        document.cookie = `${name}=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; SameSite=None${secureFlag}`;
      });

      try { if (typeof window.refreshAuthUI === 'function') await window.refreshAuthUI(); } catch {}
      try { if (typeof window.updateCartBadge === 'function') await window.updateCartBadge(); } catch {}

      renderIntoPlaceholder();
      location.href = '/';
    });

    navRoot.querySelector('#btn-open-cart')?.addEventListener('click', e => {
      e.preventDefault();
      mobileMenu.closeMobileMenu();
      if (typeof window.openCart === 'function') { window.openCart(); return; }
      const cartDrawer = document.getElementById('cart-drawer');
      if (cartDrawer) cartDrawer.classList.add('open');
      if (typeof window.renderCart === 'function') window.renderCart().catch(() => {});
    });

    const langSwitcher = navRoot.querySelector('#lang-switcher');
    if (langSwitcher) {
      langSwitcher.addEventListener('change', async function () {
        const selectedLang = this.value;
        localStorage.setItem('lang', selectedLang);
        document.documentElement.dir = (selectedLang === 'ar') ? 'rtl' : 'ltr';
        document.documentElement.lang = selectedLang;
        if (typeof window.loadLanguage === 'function') await window.loadLanguage(selectedLang);
        renderIntoPlaceholder();
      });
    }
  }

  function detectActive() {
    const p = location.pathname;
    if (p.startsWith('/courses')) return 'courses';
    if (p.startsWith('/profile')) return 'profile';
    if (p.startsWith('/bot')) return 'bot';
    return 'home';
  }

  function renderIntoPlaceholder(active) {
    const placeholder = document.getElementById(PLACEHOLDER_ID);
    if (!placeholder) return;
    placeholder.innerHTML = '';
    const nav = buildNavbar(window.me || null, active || detectActive());
    placeholder.appendChild(nav);
    wireNavbar(nav);
    if (typeof window.updateCartBadge === 'function') window.updateCartBadge().catch(() => {});
  }

  async function refreshAuthUI() {
    try {
      const res = await fetch(API_ME, { credentials: 'include', headers: { 'Accept': 'application/json' } });
      window.me = res.ok ? await res.json() : null;
    } catch {
      window.me = isLoggedInCookie() ? { email: 'user' } : null;
    }
    renderIntoPlaceholder();
    return window.me;
  }

  window.refreshAuthUI = refreshAuthUI;
  window.me = window.me || null;

  (function init() {
    const placeholder = document.getElementById(PLACEHOLDER_ID);
    if (!placeholder) return;
    window.me = isLoggedInCookie() ? window.me || { email: 'user' } : null;
    const currentLang = localStorage.getItem('lang') || 'en';
    document.documentElement.dir = (currentLang === 'ar') ? 'rtl' : 'ltr';
    document.documentElement.lang = currentLang;
    renderIntoPlaceholder();
    refreshAuthUI().catch(() => {});
  })();
})();
