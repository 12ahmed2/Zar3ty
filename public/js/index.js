// /static/js/index.js
// Works with server routes in server.js and with navbar.js

const FP_KEY = 'client_fp';
const LS_GUEST = 'guest_cart_ls';

function getFP() {
  let v = localStorage.getItem(FP_KEY);
  if (!v) {
    v = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem(FP_KEY, v);
  }
  document.cookie = `fp=${v}; Path=/; SameSite=Strict${location.protocol === 'https:' ? '; Secure' : ''}`;
  return v;
}

async function api(path, { method = 'GET', json, headers = {}, credentials = 'include' } = {}, _retry = false) {
  const opts = { method, credentials, headers: { 'x-client-fingerprint': getFP(), ...headers } };
  if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
  const res = await fetch(path, opts);
  const text = await res.text().catch(() => null);
  let data;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    if (res.status === 401 && !_retry) {
      await fetch('/refresh', { method: 'POST', credentials: 'include', headers: { 'x-client-fingerprint': getFP() } }).catch(() => {});
      return api(path, { method, json, headers, credentials }, true);
    }
    const err = new Error(data?.error || res.statusText);
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

/* Dynamic DOM refs */
let els = {};
function refreshEls() {
  els = {
    grid: document.querySelector('#grid-products'),
    cartDrawer: document.querySelector('#cart-drawer'),
    cartItems: document.querySelector('#cart-items'),
    cartCount: document.querySelector('#cart-count'),
    cartTotal: document.querySelector('#cart-total'),
    closeCart: document.querySelector('#btn-close-cart'),
    checkout: document.querySelector('#btn-checkout'),
    loginDlg: document.querySelector('#dlg-login'),
    signupDlg: document.querySelector('#dlg-signup'),
    loginForm: document.querySelector('#form-login'),
    signupForm: document.querySelector('#form-signup'),
    loginErr: document.querySelector('#login-error'),
    signupErr: document.querySelector('#signup-error'),
    scrim: document.querySelector('#scrim'),
    toast: document.querySelector('#toast'),
  };
}
refreshEls();

let productsCache = [];
let productsById = new Map();

function fmtMoney(cents) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* PRODUCTS */
async function loadProducts() {
  productsCache = await api('/api/products').catch(() => []);
  productsById = new Map((productsCache || []).map(p => [Number(p.id), p]));
  refreshEls();
  if (!els.grid) return;

  els.grid.innerHTML = (productsCache || []).map(p => {
    const price = fmtMoney(p.price_cents);
    const stockNum = (p.stock === null || p.stock === undefined) ? null : Number(p.stock);
    const soldOut = stockNum !== null && stockNum <= 0;

    // Use data-translate keys instead of hardcoded English
    const stockTxt = stockNum === null
      ? `<span class="muted">&nbsp;</span>`
      : (soldOut
        ? `<span class="error" data-translate="products.soldOut">Sold out</span>`
        : `<span class="muted" data-translate="products.stock" data-stock="${stockNum}">Stock: ${stockNum}</span>`);

    return `
      <article class="card product">
        <img src="${p.image_url || '/static/img/placeholder.png'}" alt="">
        <h4>${escapeHtml(p.name)}</h4>
        <p class="muted">${escapeHtml(p.description || '')}</p>
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div><strong>${price}</strong><br/>${stockTxt}</div>
          <button class="btn sm" 
            data-add="${p.id}" 
            ${soldOut ? 'disabled' : ''}
            data-translate="${soldOut ? 'products.soldOut' : 'products.add'}">
            ${soldOut ? 'Sold out' : 'Add'}
          </button>
        </div>
      </article>`;
  }).join('');

  // Ask lang.js to refresh translations after rendering:
  if (typeof window.applyTranslations === 'function') {
    window.applyTranslations();
  }

  attachAddListeners();
}

/* ADD TO CART listeners */
function attachAddListeners() {
  document.querySelectorAll("[data-add]").forEach(btn => {
    btn.addEventListener("click", async e => {
      const id = Number(e.currentTarget.dataset.add);
      await addToCart(id, 1).catch(() => {});
    });
  });
}

/* CART FUNCTIONS */
async function addToCart(id, qty) {
  const product = productsById.get(Number(id));
  if (!product) return;

  try {
    await api('/api/cart', { method: 'POST', json: { product_id: id, quantity: qty } });
  } catch {
    // Save locally if guest
    let ls = JSON.parse(localStorage.getItem(LS_GUEST) || '{}');
    ls[id] = (ls[id] || 0) + qty;
    localStorage.setItem(LS_GUEST, JSON.stringify(ls));
  }
  await updateCartBadge();
  await renderCart();
}

async function updateCartBadge() {
  const cart = await api('/api/cart').catch(() => null);
  let count = 0;
  if (cart && Array.isArray(cart.items)) count = cart.items.reduce((a, c) => a + c.quantity, 0);
  els.cartCount.textContent = count;
}

async function renderCart() {
  const cart = await api('/api/cart').catch(() => null);
  if (!cart || !Array.isArray(cart.items)) return;

  els.cartItems.innerHTML = cart.items.map(item => {
    const p = productsById.get(item.product_id) || {};
    const price = fmtMoney(p.price_cents);
    return `
      <li>
        <span>${escapeHtml(p.name || '')}</span>
        <span>${item.quantity} × ${price}</span>
      </li>`;
  }).join('');
  els.cartTotal.textContent = fmtMoney(cart.total_cents || 0);
}

/* LS guest sync */
async function syncLSGuestToServer() {
  const ls = JSON.parse(localStorage.getItem(LS_GUEST) || '{}');
  const items = Object.entries(ls).map(([product_id, quantity]) => ({ product_id: Number(product_id), quantity }));
  if (!items.length) return;

  try {
    await api('/api/cart/sync', { method: 'POST', json: { items } });
    localStorage.removeItem(LS_GUEST);
  } catch {
    // leave LS intact if sync failed
  }
}

/* Auth forms */
if (els.loginForm) {
  els.loginForm.addEventListener("submit", async e => {
    e.preventDefault();
    els.loginErr.textContent = '';
    try {
      const formData = new FormData(els.loginForm);
      await api('/login', { method: 'POST', json: Object.fromEntries(formData) });
      location.reload();
    } catch (err) {
      els.loginErr.textContent = err.data?.error || 'Login failed';
    }
  });
}

if (els.signupForm) {
  els.signupForm.addEventListener("submit", async e => {
    e.preventDefault();
    els.signupErr.textContent = '';
    try {
      const formData = new FormData(els.signupForm);
      await api('/signup', { method: 'POST', json: Object.fromEntries(formData) });
      location.reload();
    } catch (err) {
      els.signupErr.textContent = err.data?.error || 'Signup failed';
    }
  });
}

/* Cart drawer toggle */
if (els.closeCart) {
  els.closeCart.addEventListener("click", () => {
    els.cartDrawer.classList.remove('open');
    els.scrim.classList.remove('show');
  });
}

if (els.cartDrawer) {
  els.cartDrawer.addEventListener("click", e => {
    if (e.target === els.cartDrawer) {
      els.cartDrawer.classList.remove('open');
      els.scrim.classList.remove('show');
    }
  });
}

/* Boot */
(async function boot() {
  if (typeof window.refreshAuthUI === 'function') {
    try { await window.refreshAuthUI(); } catch {}
  }
  refreshEls();
  await loadProducts().catch(() => {});
  await syncLSGuestToServer().catch(() => {});
  await updateCartBadge().catch(() => {});
  await renderCart().catch(() => {});
})();
