// public/js/profile.js
// public/js/profile.js

/* -------------------- Fingerprint + API helper -------------------- */
const FP_KEY = 'client_fp';
function getFP(){ let v=localStorage.getItem(FP_KEY);
  if(!v){ v=[...crypto.getRandomValues(new Uint8Array(16))].map(b=>b.toString(16).padStart(2,'0')).join(''); localStorage.setItem(FP_KEY,v); }
  // keep cookie in sync
  document.cookie = `fp=${v}; Path=/; SameSite=Strict${location.protocol==='https:'?'; Secure':''}`;
  return v;
}

async function api(path, { method='GET', json, headers={}, credentials='include' } = {}, _retry=false) {
  const opts = { method, credentials, headers: { 'x-client-fingerprint': getFP(), ...headers } };
  if (json !== undefined) { opts.headers['Content-Type']='application/json'; opts.body=JSON.stringify(json); }
  const res = await fetch(path, opts);
  const text = await res.text(); let data; try { data = text ? JSON.parse(text) : null; } catch { data = text; }

  if (!res.ok) {
    if (res.status === 401 && !_retry) {
      // silent refresh once
      await fetch('/refresh', { method:'POST', credentials:'include', headers:{ 'x-client-fingerprint': getFP() } }).catch(()=>{});
      return api(path, { method, json, headers, credentials }, true);
    }
    const err = new Error(data?.error || res.statusText); err.status=res.status; err.data=data; throw err;
  }
  return data;
}

/* ----------------------------- Elements --------------------------- */
const els = {
  email:      document.getElementById('pf-email'),
  fullname:   document.getElementById('pf-fullname'),
  save:       document.getElementById('pf-save'),
  msg:        document.getElementById('pf-msg'),
  logout:     document.getElementById('btn-logout'),
  ordersList: document.getElementById('orders-list'),
  ordersMsg:  document.getElementById('orders-msg'),
  profileForm: document.getElementById('form-profile')

};

/* ------------------------ Admin nav helper ------------------------ */
function ensureAdminLink() {
  const nav = document.querySelector('.nav');
  if (!nav || document.querySelector('#nav-admin')) return;
  const a = document.createElement('a');
  a.id = 'nav-admin';
  a.className = 'btn ghost sm';
  a.href = '/admin';
  a.textContent = 'Admin';
  const before = document.querySelector('#btn-logout');
  nav.insertBefore(a, before || nav.firstChild);
}

/* ------------------------------ Me ------------------------------- */
async function loadMe() {
  const me = await api('/api/me').catch(() => null);
  if (!me) { location.href = '/'; return null; }
  if (els.email)    els.email.value    = me.email || '';
  if (els.fullname) els.fullname.value = me.fullname || '';
  if (me.is_admin) ensureAdminLink();
  return me;
}

/* ---------------------------- Orders ------------------------------ */
async function loadOrders() {
  let orders = await api('/api/orders').catch(() => []);
  orders = orders.filter(o => o.status !== 'cancelled' && o.status !== 'cancelled_by_user');

  if (!orders.length) {
    if (els.ordersList) els.ordersList.innerHTML = '';
    if (els.ordersMsg)  els.ordersMsg.textContent = 'No active orders.';
    return;
  }
  if (els.ordersMsg) els.ordersMsg.textContent = '';
  if (els.ordersList) {
    els.ordersList.innerHTML = orders.map(o => {
      const total = (o.total_cents / 100).toFixed(2);
      const items = (o.items || []).map(it =>
        `<li><strong>${it.name || ('#' + it.product_id)}</strong> × ${it.qty} · $${(it.price_cents / 100).toFixed(2)}</li>`
      ).join('');
      const canCancel = o.status === 'created';
      const when = o.created_at ? new Date(o.created_at).toLocaleString() : '';
      return `
        <article class="card">
          <div class="row">
            <div><strong>Order #${o.id}</strong></div>
            <div class="muted">${when}</div>
          </div>
          <p>Status: <strong>${o.status}</strong></p>
          <ul>${items}</ul>
          <div class="row">
            <div><strong>Total: $${total}</strong></div>
            <div class="hstack gap">
              ${canCancel ? `<button class="btn sm" data-cancel="${o.id}" data-translate="gradients.cancel"></button>` : ''}
              <button class="btn ghost sm" data-refresh="${o.id}" data-translate="gradients.refresh">Refresh</button>
            </div>
          </div>
        </article>`;
    }).join('');
  }
}

/* ------------------------- Event bindings ------------------------- */
els.ordersList?.addEventListener('click', async (e) => {
  const c = e.target.closest('[data-cancel]');
  const r = e.target.closest('[data-refresh]');
  try {
    if (c) {
      const id = c.getAttribute('data-cancel');
      await api(`/api/orders/${id}/cancel`, { method: 'POST' });
      await loadOrders();
    } else if (r) {
      await loadOrders();
    }
  } catch (err) {
    alert(err.data?.error || 'Failed');
  }
});

els.profileForm?.addEventListener('submit', async (e) => {
  e.preventDefault()
  els.msg && (els.msg.textContent = '');
  try {
    await api('/api/me', { method: 'PUT', json: { fullname: els.fullname?.value || '' } });
    if (els.msg) els.msg.textContent = 'Saved.';
  } catch (e2) {
    if (els.msg) els.msg.textContent = e2.data?.error || 'Update failed';
  }
});

els.logout?.addEventListener('click', async () => {
  await api('/api/auth/logout', { method: 'POST' });
  location.href = '/';
});



// profile-enrollments.js
async function fetchMyEnrollments() {
  const res = await fetch('/api/me/enrollments', { credentials: 'include' });
  if (!res.ok) throw new Error('Failed to fetch enrollments');
  return res.json(); // [{ course_id, enrolled_at, meta, title, image_url }, ...]
}

function renderMyEnrollments(list) {
  const el = document.getElementById('my-enrollments');
  if (!el) return;
  if (!list.length) {
    el.innerHTML = `<div class="muted">You have no enrollments.</div>`;
    return;
  }

  el.innerHTML = list.map(item => `
    <div class="enroll-card" data-course-id="${item.course_id}">
      <img src="${item.image_url || 'https://via.placeholder.com/300x180'}" alt="">
      <div class="content">
        <div class="title">${item.title || 'Untitled'}</div>
        <div class="muted">Enrolled: ${new Date(item.enrolled_at).toLocaleString()}</div>
        <div class="actions">
          <a class="btn" href="/course/${item.course_id}" data-translate="gradients.open">Open</a>
          <button class="btn danger unenroll-btn" data-course-id="${item.course_id}" data-translate="courses.unenroll">Unenroll</button>
        </div>
      </div>
    </div>
  `).join('');

  // attach handlers
  el.querySelectorAll('.unenroll-btn').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      const courseId = e.currentTarget.dataset.courseId;
      if (!confirm('Unenroll from this course?')) return;
      try {
        const res = await fetch(`/api/courses/${courseId}/enroll`, {
          method: 'DELETE',
          credentials: 'include'
        });
        if (!res.ok) {
          const data = await res.json().catch(()=>({ error: res.statusText }));
          throw new Error(data.error || res.statusText);
        }
        // remove card from DOM
        const card = document.querySelector(`.enroll-card[data-course-id="${courseId}"]`);
        if (card) card.remove();
        // optional: show message if list empty now
        if (!el.querySelectorAll('.enroll-card').length) el.innerHTML = `<div class="muted">You have no enrollments.</div>`;
      } catch (err) {
        console.error('Unenroll failed', err);
        alert('Failed to unenroll. See console.');
      }
    });
  });
}


/* ------------------------------ Boot ------------------------------ */
(async function boot() {
  try {
    await loadMe();                 // redirects to / if not authenticated
    await loadOrders();
    // load and render enrollments for profile page
    try {
      const enrollments = await fetchMyEnrollments();
      renderMyEnrollments(enrollments);
    } catch (err) {
      console.error('Load enrollments failed', err);
      const el = document.getElementById('my-enrollments');
      if (el) el.innerHTML = `<div class="muted">Failed to load enrollments.</div>`;
    }
  } catch (err) {
    console.error('Boot error:', err);
    if (err?.status === 401) location.href = '/login';
    else alert('An error occurred. See console.');
  }
})();
