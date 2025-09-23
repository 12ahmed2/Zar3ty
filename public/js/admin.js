// public/js/admin.js — Admin dashboard (fixed)

const ORDER_STATUS = ['created','paid','processing','shipped','cancelled','cancelled_by_user'];

let PRODUCTS = [];
let COURSES = [];
let selectedUser = null;
let ordersFilter = { q: '', status: '', userId: null };
let editingCourseId = null;

/* ---------------- API helper ---------------- */
function getFP() {
  let v = localStorage.getItem('client_fp');
  if (!v) {
    v = [...crypto.getRandomValues(new Uint8Array(16))]
      .map(b => b.toString(16).padStart(2, '0')).join('');
    localStorage.setItem('client_fp', v);
  }
  document.cookie = 'fp=' + v + '; Path=/; SameSite=Strict' + (location.protocol === 'https:' ? '; Secure' : '');
  return v;
}
async function api(path, { method = 'GET', json, headers = {}, credentials = 'include' } = {}, _retry = false) {
  const opts = { method, credentials, headers: { 'x-client-fingerprint': getFP(), ...headers } };
  if (json !== undefined) { opts.headers['Content-Type'] = 'application/json'; opts.body = JSON.stringify(json); }
  const res = await fetch(path, opts);
  const txt = await res.text().catch(() => null);
  let data;
  try { data = txt ? JSON.parse(txt) : null; } catch { data = txt; }
  if (!res.ok) {
    if (res.status === 401 && !_retry) {
      await fetch('/refresh', { method: 'POST', credentials: 'include', headers: { 'x-client-fingerprint': getFP() } }).catch(() => {});
      return api(path, { method, json, headers, credentials }, true);
    }
    const err = new Error(data?.error || res.statusText); err.status = res.status; err.data = data; throw err;
  }
  return data;
}

/* ---------------- Elements ----------------- */
const els = {
  filter: document.querySelector('#filter-users'),
  list: document.querySelector('#list'),
  detail: document.querySelector('#detail'),
  form: document.querySelector('#form-create'),
  msg: document.querySelector('#create-msg'),

  pForm: document.querySelector('#form-product-create'),
  pMsg: document.querySelector('#p-create-msg'),
  pFilter: document.querySelector('#filter-products'),
  pList: document.querySelector('#products-list'),

  pEditModal: document.querySelector('#modal-p-edit'),
  pEditForm: document.querySelector('#form-edit-product'),
  pEditMsg: document.querySelector('#p-edit-msg'),

  cForm: document.querySelector('#form-c-create'),
  cMsg: document.querySelector('#c-create-msg'),
  cFilter: document.querySelector('#filter-courses'),
  cList: document.querySelector('#courses-list'),
  cEditModal: document.querySelector('#modal-c-edit'),
  cEditForm: document.querySelector('#form-edit-course'),
  cEditMsg: document.querySelector('#c-edit-msg'),
  modulesList: document.querySelector('#modules-list'),
};

/* ---------------- Render helpers ----------- */
const fmtMD = ts => ts ? new Date(ts).toLocaleDateString(undefined, { month:'short', day:'2-digit' }) : '';
const dollars = c => (Number(c||0)/100).toFixed(2);
const centsFromFloat = x => { const n = parseFloat(x); return Number.isFinite(n) ? Math.round(n*100) : 0; };

function userRow(u){
  return `
  <div class="user-card" data-user="${u.id}">
    <div class="user-head">
      <div>
        <button class="link" data-open="${u.id}"><strong>${u.fullname || '(no name)'}</strong></button>
        ${u.is_admin ? '<span class="badge">admin</span>' : ''}
        <div class="muted">${u.email}</div>
      </div>
      <div class="hstack gap">
        <button class="btn sm" data-toggle="${u.id}" data-flag="${u.is_admin ? 0 : 1}">${u.is_admin ? 'Revoke admin' : 'Make admin'}</button>
        <button class="btn danger sm" data-del="${u.id}">Delete</button>
      </div>
    </div>
  </div>`;
}

function orderRow(o){
  const items = (o.items||[]).map(it => `${it.name || ('#'+it.product_id)} × ${it.qty}`).join(', ');
  const opts  = ORDER_STATUS.map(s => `<option value="${s}" ${s===o.status?'selected':''}>${s}</option>`).join('');
  return `<tr data-order-row="${o.id}"><td>${fmtMD(o.created_at)}</td><td>$${dollars(o.total_cents)}</td><td><select class="order-status" data-order="${o.id}">${opts}</select></td><td>${items}</td></tr>`;
}

function groupByUser(orders){
  const m = new Map();
  for (const o of orders) {
    const k = o.user_id;
    if (!m.has(k)) m.set(k, { user_id:k, email:o.email, fullname:o.fullname, orders:[] });
    m.get(k).orders.push(o);
  }
  return [...m.values()].sort((a,b)=>String(a.fullname||a.email).localeCompare(String(b.fullname||b.email)));
}

function renderLanding(){
  if (!els.detail) return;
  const who = selectedUser
    ? `<div class="muted">Selected user:</div>
       <div><strong>${selectedUser.fullname||'(no name)'}</strong><div class="muted">${selectedUser.email}</div></div>
       <div class="hstack gap mt-8"><button id="btn-show-user" class="btn">Show this user's orders</button><button id="btn-show-all" class="btn ghost">Show all orders</button></div>`
    : `<div class="muted">Orders are hidden.</div><div class="hstack gap mt-8"><button id="btn-show-all" class="btn">Show all orders</button></div>`;
  els.detail.innerHTML = `<div class="user-card"><h2 class="pane-title">Orders</h2>${who}</div>`;
}

function renderOrdersPane(orders){
  if (!els.detail) return;
  const groups = groupByUser(orders);
  const statusOpts = [''].concat(ORDER_STATUS).map(s=>`<option value="${s}">${s||'any'}</option>`).join('');
  const scope = ordersFilter.userId && selectedUser ? `${selectedUser.fullname||selectedUser.email}` : 'all users';
  const groupsHtml = groups.map(g => `
    <details class="group" open>
      <summary class="group-head">
        <div><strong>${g.fullname||'(no name)'}</strong><div class="muted">${g.email}</div></div>
        <span class="pill">${g.orders.length} order${g.orders.length===1?'':'s'}</span>
      </summary>
      <div class="group-body">
        <table class="orders">
          <thead><tr><th>Date</th><th>Total</th><th>Status</th><th>Items</th></tr></thead>
          <tbody>${g.orders.map(orderRow).join('')}</tbody>
        </table>
      </div>
    </details>`).join('');

  els.detail.innerHTML = `
    <div class="user-card">
      <div class="row">
        <h2 class="pane-title">Orders <span class="muted">(${scope})</span></h2>
        <div class="hstack">
          <input id="orders-q" class="input" placeholder="Search user (name/email)" value="${ordersFilter.q}">
          <select id="orders-status" class="input">${statusOpts}</select>
          <button id="orders-clear" class="btn ghost sm">Clear</button>
          ${ordersFilter.userId ? `<button id="orders-unfilter" class="btn ghost sm">All users</button>` : ''}
          <button id="orders-close" class="btn sm">Hide</button>
        </div>
      </div>
      <div class="mt-12 vstack gap orders-scroll">${groupsHtml || '<div class="muted">No orders.</div>'}</div>
    </div>`;

  const sel = els.detail.querySelector('#orders-status'); if (sel) sel.value = ordersFilter.status || '';
}

/* ---------------- Orders API helpers ---------------- */
async function fetchAndShowUserOrders(userId) {
  try {
    const orders = await api(`/api/admin/users/${userId}/orders`);
    const users = await api(`/api/admin/users?q=${userId}`);
    selectedUser = (Array.isArray(users) && users[0]) ? users[0] : { id: userId, fullname: '(user)', email: '' };
    ordersFilter.userId = Number(userId);
    ordersFilter.q = '';
    ordersFilter.status = '';
    renderOrdersPane(orders);
  } catch (err) {
    alert(err.data?.error || 'Failed to load user orders');
  }
}

async function fetchAndShowAllOrders(q = '', status = '') {
  try {
    ordersFilter.userId = null;
    ordersFilter.q = q || '';
    ordersFilter.status = status || '';
    const params = new URLSearchParams();
    if (q) params.set('q', q);
    if (status) params.set('status', status);
    const url = '/api/admin/orders' + (params.toString() ? ('?' + params.toString()) : '');
    const orders = await api(url);
    selectedUser = null;
    renderOrdersPane(orders);
  } catch (err) {
    alert(err.data?.error || 'Failed to load orders');
  }
}

/* ----------------- Loaders --------------- */
async function loadUsers(){
  try {
    const users = await api('/api/admin/users');
    if (els.list) els.list.innerHTML = (users || []).map(userRow).join('');
  } catch (err) {
    console.error('loadUsers failed', err);
  }
}
async function loadProducts(){
  try {
    PRODUCTS = await api('/api/admin/products');
    renderProducts(PRODUCTS || []);
  } catch (err) { console.error('loadProducts failed', err); }
}
async function loadCourses(){
  try {
    COURSES = await api('/api/admin/courses');
    renderCourses(COURSES || []);
  } catch (err) { console.error('loadCourses failed', err); }
}

/* -------------- Products & Courses render -------------- */
function renderProducts(list){
  if (!els.pList) return;
  if (!list || !list.length) { els.pList.innerHTML = '<div class="muted">No products.</div>'; return; }
  els.pList.innerHTML = list.map(p => `
    <article class="product-card" data-prod="${p.id}">
      <div class="p-head">
        <div class="p-title">
          <button type="button" class="link" data-edit-prod="${p.id}">
            <strong>${p.name}</strong>
          </button>
          <div class="muted">$${dollars(p.price_cents)} ${p.stock==null?'· ∞ stock':`· stock: ${p.stock}`}</div>
        </div>
        <div class="p-actions">
          <button type="button" class="btn sm" data-edit-prod="${p.id}">Edit</button>
          <button type="button" class="btn danger sm" data-del-prod="${p.id}">Delete</button>
        </div>
      </div>
      ${p.description ? `<p class="muted">${p.description}</p>` : ''}
    </article>
  `).join('');
}

function renderCourses(list){
  if (!els.cList) return;
  if (!list || !list.length) { els.cList.innerHTML = '<div class="muted">No courses.</div>'; return; }
  els.cList.innerHTML = list.map(c => `
    <article class="product-card" data-course="${c.id}">
      <div class="p-head">
        <div class="p-title">
          <button type="button" class="link" data-edit-course="${c.id}">
            <strong>${c.title}</strong>
          </button>
          <div class="muted">${Array.isArray(c.modules) ? `${c.modules.length} Modules` : '0 Modules'}</div>
        </div>
        <div class="p-actions">
          <button type="button" class="btn sm" data-edit-course="${c.id}">Edit</button>
          <button type="button" class="btn danger sm" data-del-course="${c.id}">Delete</button>
        </div>
      </div>
      ${c.description ? `<p class="muted">${c.description}</p>` : ''}
    </article>
  `).join('');
}

/* Course module editor */
function renderModule(m, modIdx) {
  const videosHtml = (m.videos || []).map((v, vidIdx) => `
    <div class="f-item video-item" data-vid-idx="${vidIdx}">
      <label><span class="lbl">Video title</span>
        <input class="input" name="mod-${modIdx}-vid-${vidIdx}-title" value="${v.title || ''}" required>
      </label>
      <label><span class="lbl">Video URL (YouTube ID)</span>
        <input class="input" name="mod-${modIdx}-vid-${vidIdx}-url" value="${v.url || ''}" required>
      </label>
      <button type="button" class="btn danger sm" data-del-video="${modIdx}-${vidIdx}">Delete</button>
    </div>
  `).join('');

  const el = document.createElement('div');
  el.className = 'module-card';
  el.setAttribute('data-mod-idx', modIdx);
  el.innerHTML = `
    <div class="pane-head">
      <h5 class="pane-title">
        <input class="input" name="mod-${modIdx}-title" placeholder="Module Title" value="${m.title || ''}" required>
      </h5>
      <div class="hstack gap">
        <button type="button" class="btn sm" data-add-video="${modIdx}">Add Video</button>
        <button type="button" class="btn danger sm" data-del-module="${modIdx}">Delete</button>
      </div>
    </div>
    <div class="vstack gap videos-list">
      ${videosHtml}
    </div>
  `;
  return el;
}

/* Modal editor */
function openProductModal(p){
  const overlay = els.pEditModal;
  const form    = els.pEditForm;
  if (!overlay || !form) return;
  overlay.style.display = 'flex';
  form.elements.id.value          = p.id;
  form.elements.name.value        = p.name || '';
  form.elements.description.value = p.description || '';
  form.elements.price.value       = dollars(p.price_cents || 0);
  form.elements.image_url.value   = p.image_url || '';
  form.elements.stock.value       = p.stock == null ? '' : p.stock;
}

function openCourseModal(c) {
  const overlay = els.cEditModal;
  const form = els.cEditForm;
  if (!overlay || !form) return;

  editingCourseId = c.id;
  form.elements.id.value = c.id;
  form.elements.title.value = c.title || '';
  form.elements.description.value = c.description || '';
  form.elements.image_url.value = c.image_url || '';

  const modules = Array.isArray(c.modules) ? c.modules : [];
  if (els.modulesList) {
    els.modulesList.innerHTML = `<div class="pane-head"><h4 class="pane-title">Modules</h4><button type="button" class="btn sm" data-add-module>Add Module</button></div>`;
    modules.forEach((mod, modIdx) => els.modulesList.appendChild(renderModule(mod, modIdx)));
  }

  overlay.style.display = 'flex';
}

function closeModals() {
  document.querySelectorAll('.modal-overlay').forEach(el => el.style.display = 'none');
}

/* ---------------- Event bindings ----------------- */
els.form?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(els.form);
  const payload = {
    fullname: f.get('fullname'), email: f.get('email'),
    password: f.get('password'), is_admin: !!f.get('is_admin'),
  };
  try {
    await api('/api/admin/users', { method:'POST', json: payload });
    els.form.reset(); if (els.msg) els.msg.textContent = 'User created.'; await loadUsers();
  } catch (err) { if (els.msg) els.msg.textContent = err.data?.error || 'Create failed'; }
});

els.pForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(els.pForm);
  const payload = {
    name: f.get('name'), description: f.get('description') || null,
    price_cents: centsFromFloat(f.get('price')),
    image_url: f.get('image_url') || null,
    stock: f.get('stock') !== '' ? Number(f.get('stock')) : null,
  };
  try {
    await api('/api/admin/products', { method:'POST', json: payload });
    els.pForm.reset(); if (els.pMsg) els.pMsg.textContent = 'Product created.'; await loadProducts();
  } catch (err) { if (els.pMsg) els.pMsg.textContent = err.data?.error || 'Create failed'; }
});

els.cForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = new FormData(els.cForm);
  const payload = {
    title: f.get('title'),
    description: f.get('description') || null,
    image_url: f.get('image_url') || null,
  };
  try {
    await api('/api/admin/courses', { method:'POST', json: payload });
    els.cForm.reset(); if (els.cMsg) els.cMsg.textContent = 'Course created.'; await loadCourses();
  } catch (err) {
    if (els.cMsg) els.cMsg.textContent = err.data?.error || 'Create failed';
  }
});

els.cEditForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const courseId = form.elements.id.value;
  const modules = [];
  form.querySelectorAll('.module-card').forEach((modEl, modIdx) => {
    const videos = [];
    modEl.querySelectorAll('.video-item').forEach(vidEl => {
      videos.push({
        title: vidEl.querySelector('input[name*="-title"]').value,
        url: vidEl.querySelector('input[name*="-url"]').value,
      });
    });
    modules.push({
      title: modEl.querySelector('input[name*="-title"]').value,
      videos: videos,
    });
  });

  const payload = {
    title: form.elements.title.value,
    description: form.elements.description.value || null,
    image_url: form.elements.image_url.value || null,
    modules: modules,
  };

  try {
    await api(`/api/admin/courses/${courseId}`, { method: 'PUT', json: payload });
    if (els.cEditMsg) els.cEditMsg.textContent = 'Course saved!';
    await loadCourses();
  } catch (err) {
    if (els.cEditMsg) els.cEditMsg.textContent = err.data?.error || 'Save failed';
  }
});

els.pEditForm?.addEventListener('submit', async (e) => {
  e.preventDefault();
  const form = e.target;
  const id = form.elements.id.value;
  const payload = {
    name: form.elements.name.value,
    description: form.elements.description.value || null,
    price_cents: centsFromFloat(form.elements.price.value),
    image_url: form.elements.image_url.value || null,
    stock: form.elements.stock.value !== '' ? Number(form.elements.stock.value) : null,
  };
  try {
    await api(`/api/admin/products/${id}`, { method: 'PUT', json: payload });
    if (els.pEditMsg) els.pEditMsg.textContent = 'Product saved.';
    closeModals();
    await loadProducts();
  } catch (err) {
    if (els.pEditMsg) els.pEditMsg.textContent = err.data?.error || 'Save failed';
  }
});

/* delegated click (Edit/Delete) */
document.addEventListener('click', async (e) => {
  const target = e.target;

  const openUser = target.closest('[data-open]');
  if (openUser) {
    const id = Number(openUser.dataset.open);
    if (!Number.isInteger(id)) return;
    await fetchAndShowUserOrders(id);
    return;
  }

  const delUser = target.closest('[data-del]');
  if (delUser) {
    const id = Number(delUser.dataset.del);
    if (!confirm('Delete this user?')) return;
    try { await api(`/api/admin/users/${id}`, { method: 'DELETE' }); await loadUsers(); }
    catch (err) { alert(err.data?.error || 'Delete failed'); }
    return;
  }

  const toggleBtn = target.closest('[data-toggle]');
  if (toggleBtn) {
    const id = Number(toggleBtn.dataset.toggle);
    const flag = !!Number(toggleBtn.dataset.flag);
    try { await api(`/api/admin/users/${id}/admin`, { method: 'PUT', json: { is_admin: flag } }); await loadUsers(); }
    catch (err) { alert(err.data?.error || 'Toggle admin failed'); }
    return;
  }

  const btnShowUser = target.closest('#btn-show-user');
  if (btnShowUser && selectedUser && selectedUser.id) {
    await fetchAndShowUserOrders(selectedUser.id);
    return;
  }

  const btnShowAll = target.closest('#btn-show-all');
  if (btnShowAll) {
    await fetchAndShowAllOrders();
    return;
  }

  const ordersClose = target.closest('#orders-close');
  if (ordersClose) {
    ordersFilter = { q:'', status:'', userId:null };
    selectedUser = null;
    renderLanding();
    return;
  }

  const ordersUnfilter = target.closest('#orders-unfilter');
  if (ordersUnfilter) { await fetchAndShowAllOrders(); return; }

  const ordersClear = target.closest('#orders-clear');
  if (ordersClear) {
    ordersFilter = { q:'', status:'', userId:null };
    selectedUser = null;
    renderLanding();
    return;
  }

  const delProd = target.closest('[data-del-prod]');
  if (delProd) {
    const id = Number(delProd.dataset.delProd);
    if (!confirm('Delete this product?')) return;
    await api(`/api/admin/products/${id}`, { method:'DELETE' });
    await loadProducts();
    return;
  }

  const editProd = target.closest('[data-edit-prod]');
  if (editProd) {
    const id = Number(editProd.dataset.editProd);
    const p  = PRODUCTS.find(x => Number(x.id) === id);
    if (p) openProductModal(p);
    return;
  }

  const delCourse = target.closest('[data-del-course]');
  if (delCourse) {
    const id = Number(delCourse.dataset.delCourse);
    if (!confirm('Delete this course?')) return;
    await api(`/api/admin/courses/${id}`, { method: 'DELETE' });
    await loadCourses();
    return;
  }

  const editCourse = target.closest('[data-edit-course]');
  if (editCourse) {
    const id = Number(editCourse.dataset.editCourse);
    const c = COURSES.find(x => Number(x.id) === id);
    if (c) openCourseModal(c);
    return;
  }

  const addMod = target.closest('[data-add-module]');
  if (addMod) {
    e.preventDefault();
    const modulesContainer = els.modulesList;
    const newModIdx = (modulesContainer?.querySelectorAll('.module-card')?.length) || 0;
    modulesContainer?.appendChild(renderModule({ title: '' }, newModIdx));
    return;
  }

  const delMod = target.closest('[data-del-module]');
  if (delMod) {
    e.preventDefault();
    delMod.closest('.module-card')?.remove();
    return;
  }

  const addVid = target.closest('[data-add-video]');
  if (addVid) {
    e.preventDefault();
    const modIdx = addVid.dataset.addVideo;
    const videosContainer = document.querySelector(`.module-card[data-mod-idx="${modIdx}"] .videos-list`);
    const newVidIdx = videosContainer ? videosContainer.children.length : 0;
    if (videosContainer) videosContainer.insertAdjacentHTML('beforeend', `
      <div class="f-item video-item" data-vid-idx="${newVidIdx}">
        <label><span class="lbl">Video title</span>
          <input class="input" name="mod-${modIdx}-vid-${newVidIdx}-title" required>
        </label>
        <label><span class="lbl">Video URL (YouTube ID)</span>
          <input class="input" name="mod-${modIdx}-vid-${newVidIdx}-url" required>
        </label>
        <button type="button" class="btn danger sm" data-del-video="${modIdx}-${newVidIdx}">Delete</button>
      </div>
    `);
    return;
  }

  const delVid = target.closest('[data-del-video]');
  if (delVid) {
    e.preventDefault();
    delVid.closest('.video-item')?.remove();
    return;
  }

  const closeBtn = target.closest('[data-close-modal]');
  if (closeBtn) { closeModals(); return; }
});

/* handle order status change (delegated) */
document.addEventListener('change', async (e) => {
  const sel = e.target.closest('select[data-order]');
  if (!sel) return;
  const orderId = Number(sel.dataset.order);
  const newStatus = String(sel.value);
  if (!ORDER_STATUS.includes(newStatus)) { alert('Invalid status'); return; }
  try {
    await api(`/api/admin/orders/${orderId}/status`, { method: 'PUT', json: { status: newStatus } });
    if (ordersFilter.userId) await fetchAndShowUserOrders(ordersFilter.userId);
    else await fetchAndShowAllOrders(ordersFilter.q, ordersFilter.status);
  } catch (err) {
    alert(err.data?.error || 'Status update failed');
  }
});

/* orders pane inputs */
document.addEventListener('input', (e) => {
  const ip = e.target.closest('#orders-q');
  const st = e.target.closest('#orders-status');
  if (ip) {
    ip.addEventListener('keydown', async (ev) => {
      if (ev.key === 'Enter') {
        await fetchAndShowAllOrders(ip.value.trim(), document.querySelector('#orders-status')?.value || '');
      }
    }, { once: true });
  }
  if (st) {
    fetchAndShowAllOrders(document.querySelector('#orders-q')?.value || '', st.value || '');
  }
});

/* ----------------- Boot ----------------- */
async function boot() {
  await loadUsers();
  await loadProducts();
  await loadCourses();
  closeModals();
  renderLanding();
}

boot().catch(err => {
  console.error("Boot error:", err);
  if (err && err.status === 401) location.href = '/login';
  else alert('An error occurred. See console.');
});
