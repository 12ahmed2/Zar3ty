// /static/js/index.js
// Works with server routes in server.js and with navbar.js
import {detectLanguage,translate} from './translate.js'

const FP_KEY = 'client_fp';
const LS_GUEST = 'guest_cart_ls';
let LANG = 'en'; // default language


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
  const opts = { method, credentials, headers: { 'x-client-fingerprint': getFP(), ...headers, 'x-lang': LANG } };
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
    cartCount: document.querySelector('#cart-count'), // navbar injects this
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
    langBtns: document.querySelectorAll('[data-lang]') // added language buttons
  };
}
refreshEls();

let productsCache = [];
let productsById = new Map();

function fmtMoney(cents) { return `$${(Number(cents || 0) / 100).toFixed(2)}`; }
function escapeHtml(s) { return String(s || '').replace(/[&<>"']/g, m => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[m])); }

/* PRODUCTS with search + pagination */
let currentPage = 0;
const PRODUCTS_PER_PAGE = 9;
let filteredProducts = [];

async function loadProducts() {
  productsCache = await api('/api/products').catch(() => []);
  productsById = new Map((productsCache || []).map(p => [Number(p.id), p]));
  refreshEls();
  if (!els.grid) return;

  // default: all products
  filteredProducts = [...productsCache];
  currentPage = 0;
  await renderProductPage();
}

async function renderProductPage() {
  refreshEls();
  if (!els.grid) return;

  const start = currentPage * PRODUCTS_PER_PAGE;
  const end = start + PRODUCTS_PER_PAGE;
  const pageProducts = filteredProducts.slice(start, end);

  // process each product asynchronously
  const productCards = await Promise.all(pageProducts.map(async p => {
    const price = fmtMoney(p.price_cents);
    const stockNum = (p.stock === null || p.stock === undefined) ? null : Number(p.stock);
    const soldOut = stockNum !== null && stockNum <= 0;
    const stockTxt = stockNum === null
      ? `<span class="muted">&nbsp;</span>`
      : (soldOut
          ? `<span class="error" data-translate="products.soldOut"></span>`
          : `<span class="muted"><label data-translate="index.stock"></label>: ${stockNum}</span>`
        );

    // translate name and description if needed
    const name = detectLanguage(p.name) === LANG
      ? p.name
      : await translate(p.name, detectLanguage(p.name), LANG);

    const description = detectLanguage(p.description || '') === LANG
      ? p.description
      : await translate(p.description, detectLanguage(p.description), LANG);

    return `
      <article class="card product">
        <img class="cart-placeholder-image" src="${p.image_url || (LANG === 'ar' ? '/static/static/img/placeholder-ar.png' : '/static/static/img/placeholder.png')}" alt="">
        <h4>${escapeHtml(name)}</h4>
        <p class="muted">${escapeHtml(description || '')}</p>
        <div class="row" style="justify-content:space-between;align-items:center;">
          <div><strong>${price}</strong><br/>${stockTxt}</div>
          <button class="btn sm" data-add="${p.id}" ${soldOut ? 'disabled' : ''} data-translate="${soldOut ? 'products.soldOut' : 'products.add'}"></button>
        </div>
      </article>`;
  }));

  els.grid.innerHTML = productCards.join('');

  // update pagination display
  const pages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  const paginationEl = document.querySelector('#products-pagination');
  if (paginationEl) {
    paginationEl.textContent = pages > 0 ? `${currentPage + 1} / ${pages}` : '';
  }
}

async function searchProducts(query) {
  const q = query.trim().toLowerCase();

  if (q === "") {
    filteredProducts = [...productsCache];
  } else {
    // نخلي كل check async ونستنى كله بالـ Promise.all
    const checks = await Promise.all(
      productsCache.map(async (p) => {
        const langDetected = detectLanguage(p.name);

        let nameToSearch = p.name;
        if (langDetected !== LANG) {
          try {
            nameToSearch = await translate(p.name, langDetected, LANG);
          } catch (err) {
            console.error("Translation error:", err);
          }
        }

        return {
          product: p,
          match: nameToSearch.toLowerCase().includes(q)
        };
      })
    );

    // ناخد بس المنتجات اللي الـ match بتاعها true
    filteredProducts = checks.filter(c => c.match).map(c => c.product);
  }

  currentPage = 0;
  renderProductPage();
}



function nextProductPage() {
  const pages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  if (pages === 0) return;
  currentPage = (currentPage + 1) % pages;
  renderProductPage();
}

function prevProductPage() {
  const pages = Math.ceil(filteredProducts.length / PRODUCTS_PER_PAGE);
  if (pages === 0) return;
  currentPage = (currentPage - 1 + pages) % pages;
  renderProductPage();
}

/* Hook up search + nav buttons */
document.addEventListener('DOMContentLoaded', () => {
  const searchInput = document.querySelector('#products-search');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => searchProducts(e.target.value));
  }

  const nextBtn = document.querySelector('#products-next');
  const prevBtn = document.querySelector('#products-prev');
  if (nextBtn) nextBtn.addEventListener('click', nextProductPage);
  if (prevBtn) prevBtn.addEventListener('click', prevProductPage);
});

/* localStorage guest mirror */
function lsGetGuest() {
  try {
    const v = JSON.parse(localStorage.getItem(LS_GUEST) || '[]');
    if (!Array.isArray(v)) return [];
    return v.filter(x => x && Number.isInteger(+x.product_id) && Number.isInteger(+x.qty) && +x.qty > 0)
      .map(x => ({ product_id: Number(x.product_id), qty: Number(x.qty) }));
  } catch { return []; }
}
function lsSetGuest(items) { localStorage.setItem(LS_GUEST, JSON.stringify(items || [])); }
function lsAddGuest(product_id, qty = 1) {
  const items = lsGetGuest();
  const i = items.findIndex(x => x.product_id === product_id);
  if (i === -1) items.push({ product_id, qty });
  else items[i].qty += qty;
  lsSetGuest(items);
}
function lsRemoveGuest(product_id) {
  lsSetGuest(lsGetGuest().filter(x => x.product_id !== product_id));
}
function buildGuestViewFromLS() {
  const items = lsGetGuest();
  return items.map(it => {
    const p = productsById.get(it.product_id);
    if (!p) return null;
    return { id: -it.product_id, qty: it.qty, product_id: it.product_id, name: p.name, price_cents: p.price_cents, image_url: p.image_url, stock: p.stock };
  }).filter(Boolean);
}
async function syncLSGuestToServer() {
  const lsItems = lsGetGuest();
  if (!lsItems.length) return;
  try {
    for (const it of lsItems) {
      await api('/api/guest-cart/items', { method: 'POST', json: { product_id: it.product_id, qty: it.qty } });
    }
  } catch {}
}

/* CART UI */
function setCartOpenState(open) {
  refreshEls();
  const drawer = els.cartDrawer;
  const scrim = els.scrim;
  if (!drawer || !scrim) return;
  if (open) {
    drawer.classList.add('open');
    drawer.setAttribute('aria-hidden', 'false');
    scrim.removeAttribute('hidden');
  } else {
    drawer.classList.remove('open');
    drawer.setAttribute('aria-hidden', 'true');
    scrim.setAttribute('hidden', '');
  }
}
function openCart() { setCartOpenState(true); }
function closeCart() { setCartOpenState(false); }

async function getCart() {
  if (window.me) {
    const serverItems = await api('/api/cart').catch(() => []);
    return Array.isArray(serverItems) ? serverItems : [];
  }
  const guest = await api('/api/guest-cart').catch(() => null);
  if (Array.isArray(guest) && guest.length) return guest;
  return buildGuestViewFromLS();
}

async function addToCart(productId) {
  if (window.me) {
    await api('/api/cart/items', { method: 'POST', json: { product_id: productId, qty: 1 } });
    await updateCartBadge();
    return { ok: true };
  }
  lsAddGuest(productId, 1);
  await api('/api/guest-cart/items', { method: 'POST', json: { product_id: productId, qty: 1 } }).catch(() => {});
  await updateCartBadge();
  return { ok: true };
}

async function removeFromCart(item) {
  if (Number(item.id) > 0) {
    await api(`/api/cart/items/${Number(item.id)}`, { method: 'DELETE' }).catch(async () => {
      await api('/api/cart/items', { method: 'DELETE', json: { id: Number(item.id) } }).catch(() => { });
    });
    await updateCartBadge();
    return { ok: true };
  }
  lsRemoveGuest(item.product_id);
  await api(`/api/guest-cart/items/${item.product_id}`, { method: 'DELETE' }).catch(() => { });
  await updateCartBadge();
  return { ok: true };
}

// async function renderCart() {
//   refreshEls();
//   const items = await getCart().catch(() => []);
//   const total = items.reduce((s, it) => s + Number(it.qty) * Number(it.price_cents), 0);
//   const count = items.reduce((s, it) => s + Number(it.qty), 0);

//   if (els.cartCount) els.cartCount.textContent = count;
//   if (els.cartTotal) els.cartTotal.textContent = fmtMoney(total);

//   if (els.cartItems) {
//     els.cartItems.innerHTML = items.map(it => {
//       const encoded = encodeURIComponent(JSON.stringify(it));
//       return `
//       <div class="cart-item" data-cart-id="${it.id ?? ''}">
//         <img src="${it.image_url || '/static/img/placeholder.png'}" alt="">
//         <div class="grow">
//           <div>${escapeHtml(translate(it.name))}</div>
//           <div class="muted">x${it.qty}</div>
//         </div>
//         <div>${fmtMoney(it.price_cents)}</div>
//         <button class="icon-btn" data-rm='${encoded}' aria-label="remove">✖</button>
//       </div>`;
//     }).join('');
//   }

//   // update navbar badge if present
//   const navBadge = document.querySelector('#cart-count');
//   if (navBadge) navBadge.textContent = count;
// }

async function renderCart() {
  refreshEls();
  const items = await getCart().catch(() => []);
  const total = items.reduce((s, it) => s + Number(it.qty) * Number(it.price_cents), 0);
  const count = items.reduce((s, it) => s + Number(it.qty), 0);

  if (els.cartCount) els.cartCount.textContent = count;
  if (els.cartTotal) els.cartTotal.textContent = fmtMoney(total);

  if (els.cartItems) {
    // Wrap map in Promise.all and make callback async
    const cartHtmlArray = await Promise.all(items.map(async (it) => {
      const encoded = encodeURIComponent(JSON.stringify(it));
      const translatedName = detectLanguage(it.name) === LANG
        ? it.name
        : await translate(it.name, detectLanguage(it.name), LANG);

      return `
      <div class="cart-item" data-cart-id="${it.id ?? ''}">
        <img class="cart-placeholder-image" src="${it.image_url || (LANG === 'ar' ? '/static/static/img/placeholder-ar.png' : '/static/static/img/placeholder.png')}" alt="">
        <div class="grow">
          <div>${escapeHtml(translatedName)}</div>
          <div class="muted">x${it.qty}</div>
        </div>
        <div>${fmtMoney(it.price_cents)}</div>
        <button class="icon-btn" data-rm='${encoded}' aria-label="remove">✖</button>
      </div>`;
    }));

    els.cartItems.innerHTML = cartHtmlArray.join('');
  }

  // update navbar badge if present
  const navBadge = document.querySelector('#cart-count');
  if (navBadge) navBadge.textContent = count;
}


async function updateCartBadge() {
  refreshEls();
  try {
    if (window.me) {
      const items = await api('/api/cart').catch(() => []);
      if (Array.isArray(items)) {
        const count = items.reduce((s, it) => s + Number(it.qty || 0), 0);
        if (els.cartCount) els.cartCount.textContent = count;
        const navBadge = document.querySelector('#cart-count');
        if (navBadge) navBadge.textContent = count;
        return;
      }
    } else {
      const guest = await api('/api/guest-cart').catch(() => null);
      if (Array.isArray(guest)) {
        const count = guest.reduce((s, it) => s + Number(it.qty || 0), 0);
        if (els.cartCount) els.cartCount.textContent = count;
        const navBadge = document.querySelector('#cart-count');
        if (navBadge) navBadge.textContent = count;
        return;
      }
    }
  } catch {}
  const ls = lsGetGuest();
  const count = ls.reduce((s, it) => s + Number(it.qty || 0), 0);
  if (els.cartCount) els.cartCount.textContent = count;
  const navBadge = document.querySelector('#cart-count');
  if (navBadge) navBadge.textContent = count;
}

function setLanguage(lang) {
  LANG = lang === 'ar' ? 'ar' : 'en';
  localStorage.setItem('lang', LANG);
  refreshEls();
  loadProducts().catch(() => {});
  renderCart().catch(() => {});
}

/* expose functions for navbar */
window.openCart = openCart;
window.renderCart = renderCart;
window.updateCartBadge = updateCartBadge;
window.setLanguage = setLanguage;

/* Delegated Events */
document.addEventListener('click', async (e) => {
  const addBtn = e.target.closest?.('[data-add]');
  if (addBtn) {
    const id = Number(addBtn.dataset.add);
    try {
      await addToCart(id);
      await renderCart();
      openCart();
    } catch (err) {
      if (err && err.status === 401) { toast(detectLanguage('Please log in') === LANG? 'Please log in': await translate('Please log in', detectLanguage('Please log in'), LANG)); show(document.querySelector('#dlg-login')); return; }
      toast(err?.data?.error || detectLanguage('Add failed') === LANG? 'Add failed': await translate('Add failed', detectLanguage('Add failed'), LANG));
    }
    return;
  }

  // Language buttons
  const langBtn = e.target.closest?.('[data-lang]');
  if (langBtn) {
    setLanguage(langBtn.dataset.lang);
    return;
  }

  if (e.target.closest && e.target.closest('#btn-open-cart')) {
    await renderCart();
    openCart();
    return;
  }

  const rm = e.target.closest?.('[data-rm]');
  if (rm) {
    const item = JSON.parse(decodeURIComponent(rm.dataset.rm));
    try {
      await removeFromCart(item);
      await renderCart();
    } catch (err) {
      toast(err?.data?.error || detectLanguage('Remove failed') === LANG? 'Remove failed': await translate('Remove failed', detectLanguage('Remove failed'), LANG));
    }
    return;
  }

  if (e.target.closest && (e.target.closest('#btn-close-cart') || e.target.closest('#scrim'))) {
    closeCart();
    return;
  }

  if (e.target.closest && e.target.closest('#btn-checkout')) {
    if (typeof window.me === 'undefined' || !window.me) { toast(detectLanguage('Log in to checkout') === LANG? 'Log in to checkout': await translate('Log in to checkout', detectLanguage('Log in to checkout'), LANG)); show(document.querySelector('#dlg-login')); return; }
    try {
      const out = await api('/api/checkout', { method: 'POST' });
      toast(`${detectLanguage('Order') === LANG? 'Order': await translate('Order', detectLanguage('Order'), LANG)} #${out.order_id} ${detectLanguage('placed') === LANG? 'placed': await translate('placed', detectLanguage('placed'), LANG)}`);
      await renderCart();
    } catch (err) {
      toast(err?.data?.error || detectLanguage('Checkout failed') === LANG? 'Checkout failed': await translate('Checkout failed', detectLanguage('Checkout failed'), LANG));
    }
    return;
  }

  // close dialog buttons (data-close)
  const closeBtn = e.target.closest?.('[data-close]');
  if (closeBtn) {
    const dlg = closeBtn.closest('dialog');
    if (dlg && typeof dlg.close === 'function') dlg.close();
    return;
  }
});

/* Keyboard: Escape closes dialogs and cart */
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') {
    document.querySelectorAll('dialog').forEach(d => { if (typeof d.close === 'function') d.close(); });
    closeCart();
  }
});

/* Modal helpers */
function show(el) { el?.showModal?.(); }
function hide(el) { el?.close?.(); }

/* Modal switching */
document.addEventListener('click', (e) => {
  const openSignup = e.target.closest?.('[data-open-signup]');
  if (openSignup) {
    e.preventDefault();
    hide(document.querySelector('#dlg-login'));
    show(document.querySelector('#dlg-signup'));
  }
});

/* Auth forms */
document.addEventListener('submit', async (e) => {
  if (!e.target) return;

  if (e.target.matches && e.target.matches('#form-login')) {
    e.preventDefault();
    refreshEls();
    const f = new FormData(e.target);
    if (els.loginErr) els.loginErr.textContent = '';
    try {
      await api('/login', { method: 'POST', json: { email: f.get('email'), password: f.get('password') } });
      hide(els.loginDlg);
      await api('/api/cart/merge', { method: 'POST' }).catch(() => {});
      lsSetGuest([]);
      await renderCart();
      toast(translate('Logged in'));
      if (typeof window.refreshAuthUI === 'function') await window.refreshAuthUI().catch(() => {});
      location.reload();
    } catch (err) {
      if (els.loginErr) els.loginErr.textContent = err?.data?.error || translate('Login failed');
    }
    return;
  }

  if (e.target.matches && e.target.matches('#form-signup')) {
    e.preventDefault();
    refreshEls();
    const f = new FormData(e.target);
    if (els.signupErr) els.signupErr.textContent = '';
    try {
      await api('/signup', { method: 'POST', json: { fullname: f.get('fullname'), email: f.get('email'), password: f.get('password') } });
      hide(els.signupDlg);
      await api('/api/cart/merge', { method: 'POST' }).catch(() => {});
      lsSetGuest([]);
      await renderCart();
      toast(translate('Account created'));
      if (typeof window.refreshAuthUI === 'function') await window.refreshAuthUI().catch(() => {});
      location.reload();
    } catch (err) {
      if (els.signupErr) els.signupErr.textContent = err?.data?.error || translate('Signup failed');
    }
    return;
  }
});

/* Toast */
function toast(msg) {
  refreshEls();
  const el = els.toast;
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(window.__toastTO);
  window.__toastTO = setTimeout(() => el.classList.remove('show'), 2000);
}

const landingImages = [
  "static/static/img/agri-landing.jpg",
  "static/static/img/agri-landing2.jpg",
  "static/static/img/agri-landing3.jpg"
];

const landingImg = document.querySelector(".landing img");

let currentIndex = 0;

async function changeLandingImage() {
  if (!landingImg) return;

  currentIndex = (currentIndex + 1) % landingImages.length;
  landingImg.src = landingImages[currentIndex];
}


/* Boot */
(async function boot() {
  if (typeof window.refreshAuthUI === 'function') {
    try { await window.refreshAuthUI(); } catch { }
  }
  const storedLang = localStorage.getItem('lang');
  if (storedLang) LANG = storedLang;

  refreshEls();
  await loadProducts().catch(() => {});
  await syncLSGuestToServer().catch(() => {});
  await updateCartBadge().catch(() => {});
  await renderCart().catch(() => {});
  setInterval(changeLandingImage, 2000); 
})();