// server.js
import express from 'express';
import path from 'path';
import fs from 'fs';
import cookieParser from 'cookie-parser';
import bcrypt from 'bcrypt';
import ms from 'ms';
import compression from 'compression';
import helmet from 'helmet';
import dotenv from 'dotenv';

import pool from './db.js';
import { issueTokens, requireAuth, refreshTokens, logout ,optionalAuth} from './auth.js';

import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);

dotenv.config();
const app = express();

const ORDER_STATUS = ['created','paid','processing','shipped','cancelled','cancelled_by_user'];

/* --------------------------- Middleware --------------------------- */
app.use(compression());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());


app.use(helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: [
        "'self'",
        "blob:",
        "https://cdn.jsdelivr.net",
        "https://run.aicado.ai",
        "https://*.aicado.ai",
        "https://www.youtube.com",
        "https://s.ytimg.com",
        "https://www.youtube-nocookie.com"
      ],
      scriptSrcElem: [
        "'self'",
        "blob:",
        "https://cdn.jsdelivr.net",
        "https://run.aicado.ai",
        "https://*.aicado.ai",
        "https://www.youtube.com",
        "https://s.ytimg.com",
        "https://www.youtube-nocookie.com"
      ],
      connectSrc: [
        "'self'",
        "http://localhost:5000",
        "https://run.aicado.ai",
        "wss://run.aicado.ai",
        "https://*.aicado.ai",
        "https://www.youtube.com",
        "https://s.ytimg.com"
      ],
      imgSrc: [
        "'self'",
        "data:",
        "blob:",
        "https://*.ytimg.com",
        "https://*.youtube.com",
        "https://upload.wikimedia.org",
        "https:"
      ],
      styleSrc: ["'self'", "'unsafe-inline'"],
      workerSrc: ["'self'", "blob:", "https://run.aicado.ai"],
      childSrc: [
        "'self'",
        "blob:",
        "https://www.youtube.com",
        "https://www.youtube-nocookie.com",
        "https://run.aicado.ai",
        "https://*.aicado.ai"
      ],
      frameSrc: [
        "'self'",
        "https://www.youtube.com",
        "https://www.youtube-nocookie.com",
        "https://run.aicado.ai",
        "https://*.aicado.ai"
      ],
      mediaSrc: [
        "'self'",
        "blob:",
        "https://run.aicado.ai",
        "https://*.aicado.ai",
        "https://www.youtube.com",
        "https://www.youtube-nocookie.com"
      ],
      objectSrc: ["'none'"],
      baseUri: ["'self'"]
    }
  },
  frameguard: false
}));


/* ----------------------------- Static ----------------------------- */
const PUBLIC = path.join(__dirname, 'public');
app.use('/static', express.static(PUBLIC));
app.get('/',        (_req, res) => res.sendFile(path.join(PUBLIC, 'html', 'index.html')));
app.get('/login',   (_req, res) => res.sendFile(path.join(PUBLIC, 'html', 'index.html')));
app.get('/bot',   (_req, res) => res.sendFile(path.join(PUBLIC, 'html', 'bot.html')));
app.get('/signup',  (_req, res) => res.sendFile(path.join(PUBLIC, 'html', 'index.html')));
app.get('/profile', requireAuth, async (req, res) => {
  try {
    const r = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.sub]);
    const isAdmin = !!(r.rowCount && r.rows[0].is_admin);
    if (isAdmin) return res.redirect('/admin');
  } catch {}
  return res.sendFile(path.join(PUBLIC, 'html', 'profile.html'));
});
app.get('/courses',  (_req, res) => res.sendFile(path.join(PUBLIC, 'html', 'courses.html')));
/* ---------------------------- Healthcheck ------------------------- */
app.get('/health', async (_req, res) => {
  try { const r = await pool.query('SELECT 1 AS ok'); res.json({ db: 'up', result: r.rows[0] }); }
  catch (e) { res.status(500).json({ db: 'down', error: e.message }); }
});

app.get('/course/:id',optionalAuth, (_req, res) => {
  res.sendFile(path.join(PUBLIC, 'html', 'course.html'));
});

app.get('/lang/:locale', (req, res) => {
  const locale = req.params.locale;
  // Only allow 'en' or 'ar' to prevent path traversal
  if (!['en', 'ar'].includes(locale)) {
    return res.status(404).json({ error: 'Language not supported' });
  }
  const filePath = path.join(__dirname, 'static', 'lang', `lang.${locale}.json`);
  fs.readFile(filePath, 'utf8', (err, data) => {
    if (err) {
      return res.status(404).json({ error: 'Language file not found' });
    }
    res.type('application/json').send(data);
  });
});

/* ----------------------- Guest-cart helpers ----------------------- */
const GUEST_COOKIE = 'guest_cart';
const cookieOpts = () => ({
  httpOnly: true, sameSite: 'Strict',
  secure: process.env.NODE_ENV === 'production',
  path: '/', maxAge: 30 * 24 * 3600 * 1000,
});
function readGuestCart(req){
  try {
    const raw = req.cookies?.[GUEST_COOKIE]; const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr)
      ? arr.filter(x => x && Number.isInteger(+x.product_id) && Number.isInteger(+x.qty) && +x.qty>0)
           .map(x => ({ product_id:Number(x.product_id), qty:Number(x.qty) }))
      : [];
  } catch { return []; }
}
function writeGuestCart(res, items){ res.cookie(GUEST_COOKIE, JSON.stringify(items||[]), cookieOpts()); }
function clearGuestCart(res){ res.cookie(GUEST_COOKIE, '[]', { ...cookieOpts(), maxAge: 0 }); }




/* ------------------------- Auth: signup/login --------------------- */
app.post('/signup', async (req, res) => {
  const { email, password, fullname } = req.body || {};
  if (!email || !password || !fullname) return res.status(400).json({ error: 'email, password, fullname required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password too short' });
  try {
    const dupe = await pool.query('SELECT 1 FROM users WHERE email=$1', [email.trim()]);
    if (dupe.rowCount) return res.status(400).json({ error: 'Email already registered' });

    const hash = await bcrypt.hash(String(password), 12);
    const u = await pool.query(
      `INSERT INTO users (email, password_hash, fullname) VALUES ($1,$2,$3) RETURNING id,email,fullname`,
      [email.trim(), hash, String(fullname).trim()]
    );
    const user = { id: u.rows[0].id, email: u.rows[0].email };
    const out = await issueTokens(res, user, req);
    await mergeGuestCartToUser(req, res, user.id);
    if (!res.headersSent) res.json({ user: { id:user.id, email:user.email, fullname:u.rows[0].fullname }, ...(out || {}) });
  } catch (e) { res.status(500).json({ error: 'Signup failed', detail: e.message }); }
});

app.post('/login', async (req, res) => {
  const { email, password } = req.body || {};
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const r = await pool.query('SELECT id,email,password_hash,fullname FROM users WHERE email=$1', [email.trim()]);
    if (!r.rowCount) return res.status(401).json({ error: 'Invalid credentials' });
    const user = r.rows[0];
    const ok = await bcrypt.compare(String(password), user.password_hash);
    if (!ok) return res.status(401).json({ error: 'Invalid credentials' });
    const out = await issueTokens(res, { id: user.id, email: user.email }, req);
    await mergeGuestCartToUser(req, res, user.id);
    if (!res.headersSent) res.json({ user: { id: user.id, email: user.email, fullname: user.fullname }, ...(out || {}) });
  } catch { res.status(500).json({ error: 'Login failed' }); }
});

app.post('/refresh', async (req, res) => {
  try { const out = await refreshTokens(req, res); if (!res.headersSent && out) res.json(out); }
  catch { if (!res.headersSent) res.status(401).json({ error: 'Refresh failed' }); }
});

app.post('/api/auth/logout', (req, res) => { clearGuestCart(res); return logout(req, res); });

/* ------------------------------ Me ------------------------------- */
app.get('/api/me', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      'SELECT id,email,fullname,is_admin,created_at FROM users WHERE id=$1',
      [req.user.sub]
    );
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query(
        'SELECT id,email,fullname,created_at FROM users WHERE id=$1',
        [req.user.sub]
      );
      if (!r2.rowCount) return res.status(404).json({ error: 'Not found' });
      return res.json({ ...r2.rows[0], is_admin: false });
    }
    res.status(500).json({ error: 'Me failed' });
  }
});

app.put('/api/me', requireAuth, async (req, res) => {
  const { fullname } = req.body || {};
  if (!fullname) return res.status(400).json({ error: 'fullname required' });
  try {
    const r = await pool.query(
      `UPDATE users SET fullname=$1, updated_at=now()
         WHERE id=$2 RETURNING id,email,fullname,is_admin,created_at`,
      [String(fullname).trim(), req.user.sub]
    );
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `UPDATE users SET fullname=$1 WHERE id=$2
           RETURNING id,email,fullname,created_at`,
        [String(fullname).trim(), req.user.sub]
      );
      return res.json({ ...r2.rows[0], is_admin: false });
    }
    res.status(500).json({ error: 'Update failed' });
  }
});

/* ----------------------- Token cleanup job ------------------------ */
setInterval(async () => {
  try {
    const refreshMs = ms(process.env.JWT_REFRESH_EXPIRES_IN || '7d');
    const refreshSec = Math.floor(refreshMs / 1000);
    await pool.query(
      `UPDATE refresh_tokens SET revoked_at = now()
       WHERE revoked_at IS NULL AND created_at < now() - ($1 || ' seconds')::interval`, [refreshSec]);
  } catch {}
}, 5 * 60 * 1000);

/* ------------------------------ Products -------------------------- */
app.get('/api/products', async (_req, res) => {
  try {
    const r = await pool.query('SELECT id,name,description,price_cents,image_url,stock FROM products ORDER BY id');
    res.json(r.rows);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query('SELECT id,name,description,price_cents,image_url FROM products ORDER BY id');
      return res.json(r2.rows.map(p => ({ ...p, stock: null })));
    }
    res.status(500).json({ error: 'Products failed' });
  }
});

app.get('/api/products/:id', async (req, res) => {
  try {
    const r = await pool.query('SELECT id,name,description,price_cents,image_url,stock FROM products WHERE id=$1', [req.params.id]);
    if (!r.rowCount) return res.status(404).json({ error: 'Not found' });
    res.json(r.rows[0]);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query('SELECT id,name,description,price_cents,image_url FROM products WHERE id=$1', [req.params.id]);
      if (!r2.rowCount) return res.status(404).json({ error: 'Not found' });
      return res.json({ ...r2.rows[0], stock: null });
    }
    res.status(500).json({ error: 'Product failed' });
  }
});


// update product (admin)
app.put('/api/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { name, description, price_cents, image_url, stock } = req.body || {};
  if (!name) return res.status(400).json({ error: 'name required' });

  try {
    const q = `UPDATE products
               SET name=$1, description=$2, price_cents=$3, image_url=$4, stock=$5
               WHERE id=$6
               RETURNING id,name,description,price_cents,image_url,stock`;
    const vals = [name, description || null, Number(price_cents), image_url || null, stock == null ? null : Number(stock), id];
    const r = await pool.query(q, vals);
    if (!r.rowCount) return res.status(404).json({ error: 'Product not found' });
    return res.json(r.rows[0]);
  } catch (e) {
    // fallback if DB has no stock column
    if (e.code === '42703') {
      try {
        const q2 = `UPDATE products
                    SET name=$1, description=$2, price_cents=$3, image_url=$4
                    WHERE id=$5 RETURNING id,name,description,price_cents,image_url`;
        const vals2 = [name, description || null, Number(price_cents), image_url || null, id];
        const r2 = await pool.query(q2, vals2);
        if (!r2.rowCount) return res.status(404).json({ error: 'Product not found' });
        return res.json({ ...r2.rows[0], stock: null });
      } catch (e2) {
        console.error('product update fallback error', e2);
        return res.status(500).json({ error: 'Update failed' });
      }
    }
    console.error('product update error', e);
    return res.status(500).json({ error: 'Update failed' });
  }
});


/* ------------------------------- Cart ----------------------------- */
async function ensureCart(userId){
  const r = await pool.query('SELECT id FROM carts WHERE user_id=$1', [userId]);
  if (r.rowCount) return r.rows[0].id;
  const c = await pool.query('INSERT INTO carts (user_id) VALUES ($1) RETURNING id', [userId]);
  return c.rows[0].id;
}
async function getStock(productId){
  try {
    const r = await pool.query('SELECT stock FROM products WHERE id=$1', [productId]);
    return r.rowCount ? Number(r.rows[0].stock) : null;
  } catch (e) {
    if (e.code === '42703') return Infinity;
    throw e;
  }
}

app.get('/api/cart', requireAuth, async (req, res) => {
  const cartId = await ensureCart(req.user.sub);
  const r = await pool.query(
    `SELECT ci.id, ci.qty, p.id AS product_id, p.name, p.price_cents, p.image_url,
            CASE WHEN to_regclass('public.products') IS NOT NULL THEN p.stock ELSE NULL END AS stock
       FROM cart_items ci JOIN products p ON p.id = ci.product_id
      WHERE ci.cart_id=$1 ORDER BY ci.id`,
    [cartId]
  ).catch(async (e) => {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `SELECT ci.id, ci.qty, p.id AS product_id, p.name, p.price_cents, p.image_url
           FROM cart_items ci JOIN products p ON p.id = ci.product_id
          WHERE ci.cart_id=$1 ORDER BY ci.id`,
        [cartId]
      );
      return { rows: r2.rows.map(x => ({ ...x, stock: null })) };
    }
    throw e;
  });
  res.json(r.rows);
});

app.post('/api/cart/items', requireAuth, async (req, res) => {
  const productId = Number(req.body?.product_id);
  const addQty    = Math.max(1, parseInt(req.body?.qty || 1, 10));
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product' });

  const cartId = await ensureCart(req.user.sub);
  const [stockVal, cur] = await Promise.all([
    getStock(productId),
    pool.query('SELECT qty FROM cart_items WHERE cart_id=$1 AND product_id=$2', [cartId, productId]),
  ]);

  if (stockVal === null) return res.status(404).json({ error: 'Product not found' });
  const unlimited = stockVal === Infinity;

  const already = cur.rowCount ? Number(cur.rows[0].qty) : 0;
  const remain  = unlimited ? Infinity : stockVal - already;
  if (!unlimited && remain <= 0) return res.status(400).json({ error: 'Sold out' });

  const toAdd = unlimited ? addQty : Math.min(addQty, remain);
  await pool.query(
    `INSERT INTO cart_items (cart_id, product_id, qty)
     VALUES ($1,$2,$3)
     ON CONFLICT (cart_id, product_id)
     DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty`,
    [cartId, productId, toAdd]
  );
  res.json({ ok: true, added: toAdd, remaining: unlimited ? null : (remain - toAdd) });
});

app.delete('/api/cart/items/:id', requireAuth, async (req, res) => {
  await pool.query('DELETE FROM cart_items WHERE id=$1', [req.params.id]);
  res.json({ ok: true });
});

/* ------------------------------ Checkout -------------------------- */
app.post('/api/checkout', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const cartId = await ensureCart(req.user.sub);
    const items = await client.query(
      `SELECT p.id AS product_id, p.name, p.price_cents, ci.qty, p.stock
         FROM cart_items ci
         JOIN products p ON p.id = ci.product_id
        WHERE ci.cart_id=$1
        FOR UPDATE OF p`,
      [cartId]
    );

    if (!items.rowCount) {
      await client.query('ROLLBACK');
      return res.status(400).json({ error: 'Cart empty' });
    }

    const hasStock = items.rows[0] && Object.prototype.hasOwnProperty.call(items.rows[0], 'stock');
    if (hasStock) {
      for (const row of items.rows) {
        if (row.stock !== null && Number(row.stock) < Number(row.qty)) {
          await client.query('ROLLBACK');
          return res.status(400).json({ error: `Only ${row.stock} left for "${row.name}"` });
        }
      }
      for (const row of items.rows) {
        await client.query(
          `UPDATE products SET stock = stock - $2 WHERE id=$1 AND stock >= $2`,
          [row.product_id, row.qty]
        );
      }
    }

    const orderItems = items.rows.map(r => ({
      product_id: Number(r.product_id),
      name:       String(r.name),
      qty:        Number(r.qty),
      price_cents:Number(r.price_cents),
    }));
    const total = orderItems.reduce((s, x) => s + x.qty * x.price_cents, 0);

    let orderRow;
    try {
      const o = await client.query(
        `INSERT INTO orders (user_id, items, total_cents, status)
         VALUES ($1,$2::jsonb,$3,'created')
         RETURNING id,total_cents,status,created_at`,
        [req.user.sub, JSON.stringify(orderItems), total]
      );
      orderRow = o.rows[0];
    } catch (e) {
      if (e.code === '42703') {
        const o2 = await client.query(
          `INSERT INTO orders (user_id, total_cents, status)
           VALUES ($1,$2,'created')
           RETURNING id,total_cents,status,created_at`,
          [req.user.sub, total]
        );
        orderRow = o2.rows[0];
      } else { throw e; }
    }

    await client.query('DELETE FROM cart_items WHERE cart_id=$1', [cartId]);
    await client.query('COMMIT');

    res.json({
      order_id:   orderRow.id,
      total_cents:orderRow.total_cents,
      status:     orderRow.status,
      created_at: orderRow.created_at,
      items:      orderItems
    });
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: 'Checkout failed', detail: e.message });
  } finally { client.release(); }
});

/* ------------------------------- Orders --------------------------- */
app.get('/api/orders', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT id, items, total_cents, status, created_at, updated_at
         FROM orders
        WHERE user_id=$1
        ORDER BY created_at DESC`,
      [req.user.sub]
    );
    const rows = r.rows.map(o => ({
      ...o,
      items: Array.isArray(o.items) ? o.items :
             (typeof o.items === 'string' ? JSON.parse(o.items) : [])
    }));
    res.json(rows);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `SELECT id, total_cents, status, created_at
           FROM orders WHERE user_id=$1 ORDER BY created_at DESC`,
        [req.user.sub]
      );
      return res.json(r2.rows.map(o => ({ ...o, items: [] })));
    }
    res.status(500).json({ error: 'Orders failed' });
  }
});

app.post('/api/orders/:id/cancel', requireAuth, async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const r = await client.query(
      `SELECT id, items, status FROM orders WHERE id=$1 AND user_id=$2 FOR UPDATE`,
      [req.params.id, req.user.sub]
    );
    if (!r.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }

    const ord = r.rows[0];
    const items = Array.isArray(ord.items) ? ord.items :
                  (typeof ord.items === 'string' ? JSON.parse(ord.items) : []);

    if (ord.status === 'created' && items.length) {
      try {
        for (const it of items) {
          await client.query(`UPDATE products SET stock = stock + $2 WHERE id=$1`, [it.product_id, it.qty]);
        }
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    const u = await client.query(
      `UPDATE orders SET status='cancelled_by_user', updated_at=now()
         WHERE id=$1 AND user_id=$2
       RETURNING id, status`,
      [req.params.id, req.user.sub]
    ).catch(async (e) => {
      if (e.code === '42703') {
        const u2 = await client.query(
          `UPDATE orders SET status='cancelled_by_user'
             WHERE id=$1 AND user_id=$2
           RETURNING id, status`,
          [req.params.id, req.user.sub]
        );
        return u2;
      }
      throw e;
    });

    await client.query('COMMIT');
    res.json(u.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: 'Cancel failed' });
  } finally { client.release(); }
});

/* ---------------------------- Guest cart -------------------------- */
app.get('/api/guest-cart', async (req, res) => {
  const items = readGuestCart(req);
  if (!items.length) return res.json([]);
  const ids = items.map(i => i.product_id);
  const r = await pool.query(
    `SELECT id,name,price_cents,image_url,stock FROM products WHERE id = ANY($1::bigint[])`,
    [ids]
  ).catch(async (e) => {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `SELECT id,name,price_cents,image_url FROM products WHERE id = ANY($1::bigint[])`,
        [ids]
      );
      return { rows: r2.rows.map(p => ({ ...p, stock: null })) };
    }
    throw e;
  });
  const map = new Map(r.rows.map(p => [p.id, p]));
  const detailed = items.filter(i => map.has(i.product_id)).map(i => {
    const p = map.get(i.product_id);
    return { id: -i.product_id, qty: i.qty, product_id: p.id, name: p.name,
             price_cents: p.price_cents, image_url: p.image_url, stock: p.stock };
  });
  res.json(detailed);
});

app.post('/api/guest-cart/items', async (req, res) => {
  const productId = Number(req.body?.product_id);
  const addQty    = Math.max(1, parseInt(req.body?.qty || 1, 10));
  if (!Number.isInteger(productId)) return res.status(400).json({ error: 'Invalid product' });

  const stock = await getStock(productId);
  if (stock === null) return res.status(404).json({ error: 'Product not found' });

  let items = readGuestCart(req);
  const idx = items.findIndex(x => x.product_id === productId);
  const already = idx === -1 ? 0 : items[idx].qty;
  const remain  = stock === Infinity ? Infinity : stock - already;
  if (remain !== Infinity && remain <= 0) return res.status(400).json({ error: 'Sold out' });

  const toAdd = stock === Infinity ? addQty : Math.min(addQty, remain);
  if (idx === -1) items.push({ product_id: productId, qty: toAdd });
  else items[idx].qty += toAdd;

  writeGuestCart(res, items);
  res.json({ ok: true, added: toAdd, remaining: stock === Infinity ? null : (remain - toAdd) });
});

app.delete('/api/guest-cart/items/:productId', async (req, res) => {
  const pid = Number(req.params.productId);
  writeGuestCart(res, readGuestCart(req).filter(x => x.product_id !== pid));
  res.json({ ok: true });
});

app.post('/api/guest-cart/clear', async (_req, res) => { clearGuestCart(res); res.json({ ok: true }); });

app.post('/api/cart/merge', requireAuth, async (req, res) => {
  const merged = await mergeGuestCartToUser(req, res, req.user.sub);
  res.json({ merged });
});

async function mergeGuestCartToUser(req, res, userId){
  const items = readGuestCart(req);
  if (!items.length) return 0;
  const cartId = await ensureCart(userId);

  for (const it of items) {
    const stock = await getStock(it.product_id);
    if (stock === null || stock <= 0) continue;

    const cur = await pool.query(
      'SELECT qty FROM cart_items WHERE cart_id=$1 AND product_id=$2',
      [cartId, it.product_id]
    );
    const already = cur.rowCount ? Number(cur.rows[0].qty) : 0;
    const remain  = stock === Infinity ? Infinity : stock - already;
    if (remain !== Infinity && remain <= 0) continue;

    const toAdd = stock === Infinity ? it.qty : Math.min(it.qty, remain);
    await pool.query(
      `INSERT INTO cart_items (cart_id, product_id, qty)
       VALUES ($1,$2,$3)
       ON CONFLICT (cart_id, product_id)
       DO UPDATE SET qty = cart_items.qty + EXCLUDED.qty`,
      [cartId, it.product_id, toAdd]
    );
  }
  clearGuestCart(res);
  return items.length;
}

/* ------------------------------ Admin ----------------------------- */
async function requireAdmin(req, res, next) {
  if (!req.user) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const r = await pool.query('SELECT is_admin FROM users WHERE id=$1', [req.user.sub]);
    if (!r.rowCount || !r.rows[0].is_admin) return res.status(403).json({ error: 'Forbidden' });
    next();
  } catch (e) {
    if (e.code === '42703') return res.status(403).json({ error: 'Admin not enabled' });
    next(e);
  }
}

app.get('/admin', requireAuth, requireAdmin, (_req, res) =>
  res.sendFile(path.join(PUBLIC, 'html', 'admin.html'))
);

// list users (q can be name/email or numeric id)
app.get('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const q = String(req.query.q || '').trim();
  if (q) {
    if (/^\d+$/.test(q)) {
      const rId = await pool.query(
        `SELECT id,email,fullname,created_at,is_admin FROM users WHERE id=$1 LIMIT 1`, [Number(q)]
      );
      return res.json(rId.rows);
    }
    const like = `%${q}%`;
    const r = await pool.query(
      `SELECT id,email,fullname,created_at,is_admin
         FROM users
        WHERE email ILIKE $1 OR fullname ILIKE $1
        ORDER BY id DESC LIMIT 100`, [like]);
    return res.json(r.rows);
  }
  const r = await pool.query(
    `SELECT id,email,fullname,created_at,is_admin
       FROM users ORDER BY id DESC LIMIT 100`);
  res.json(r.rows);
});

// create user
app.post('/api/admin/users', requireAuth, requireAdmin, async (req, res) => {
  const { email, password, fullname, is_admin = false } = req.body || {};
  if (!email || !password || !fullname) return res.status(400).json({ error: 'email, password, fullname required' });
  if (String(password).length < 8) return res.status(400).json({ error: 'Password too short' });
  const dupe = await pool.query('SELECT 1 FROM users WHERE email=$1', [email.trim()]);
  if (dupe.rowCount) return res.status(400).json({ error: 'Email already exists' });
  const hash = await bcrypt.hash(String(password), 12);
  try {
    const u = await pool.query(
      `INSERT INTO users (email,password_hash,fullname,is_admin)
       VALUES ($1,$2,$3,$4)
       RETURNING id,email,fullname,is_admin,created_at`,
      [email.trim(), hash, String(fullname).trim(), !!is_admin]
    );
    res.json(u.rows[0]);
  } catch (e) {
    if (e.code === '42703') {
      const u2 = await pool.query(
        `INSERT INTO users (email,password_hash,fullname)
         VALUES ($1,$2,$3)
         RETURNING id,email,fullname,created_at`,
        [email.trim(), hash, String(fullname).trim()]
      );
      return res.json({ ...u2.rows[0], is_admin: false });
    }
    res.status(500).json({ error: 'Create failed' });
  }
});

// delete user
app.delete('/api/admin/users/:id', requireAuth, requireAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  await pool.query('DELETE FROM users WHERE id=$1', [uid]);
  res.json({ ok: true });
});

// toggle admin
app.put('/api/admin/users/:id/admin', requireAuth, requireAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  const flag = !!req.body?.is_admin;
  try {
    await pool.query('UPDATE users SET is_admin=$1 WHERE id=$2', [flag, uid]);
  } catch (e) {
    if (e.code === '42703') return res.status(403).json({ error: 'Admin not enabled' });
    throw e;
  }
  res.json({ ok: true });
});

// fetch a user's orders (with schema fallback)
app.get('/api/admin/users/:id/orders', requireAuth, requireAdmin, async (req, res) => {
  const uid = Number(req.params.id);
  try {
    const r = await pool.query(
      `SELECT id, items, total_cents, status, created_at, updated_at
         FROM orders
        WHERE user_id=$1
        ORDER BY created_at DESC`,
      [uid]
    );
    const rows = r.rows.map(o => ({
      ...o,
      items: Array.isArray(o.items) ? o.items :
             (typeof o.items === 'string' ? JSON.parse(o.items) : [])
    }));
    res.json(rows);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `SELECT id, total_cents, status, created_at
           FROM orders WHERE user_id=$1 ORDER BY created_at DESC`,
        [uid]
      );
      return res.json(r2.rows.map(o => ({ ...o, items: [] })));
    }
    res.status(500).json({ error: 'Orders fetch failed' });
  }
});

// change order status
app.put('/api/admin/orders/:id/status', requireAuth, requireAdmin, async (req, res) => {
  const oid = Number(req.params.id);
  const next = String(req.body?.status || '').trim();
  if (!ORDER_STATUS.includes(next)) return res.status(400).json({ error: 'Invalid status' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const cur = await client.query(`SELECT id, status, items FROM orders WHERE id=$1 FOR UPDATE`, [oid]);
    if (!cur.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Not found' }); }
    const prev = cur.rows[0].status;
    const items = Array.isArray(cur.rows[0].items) ? cur.rows[0].items :
                  (typeof cur.rows[0].items === 'string' ? JSON.parse(cur.rows[0].items) : []);

    // restock if moving from created -> cancelled
    if (prev === 'created' && next === 'cancelled' && items.length) {
      try {
        for (const it of items) {
          await client.query(`UPDATE products SET stock = stock + $2 WHERE id=$1`, [it.product_id, it.qty]);
        }
      } catch (e) {
        if (e.code !== '42703') throw e;
      }
    }

    const u = await client.query(
      `UPDATE orders SET status=$2, updated_at=now() WHERE id=$1 RETURNING id,status,updated_at`,
      [oid, next]
    );
    await client.query('COMMIT');
    res.json(u.rows[0]);
  } catch (e) {
    await client.query('ROLLBACK').catch(()=>{});
    res.status(500).json({ error: 'Status update failed' });
  } finally { client.release(); }
});

// products admin (optional)
app.get('/api/admin/products', requireAuth, requireAdmin, async (_req, res) => {
  const r = await pool.query('SELECT id,name,description,price_cents,image_url,stock FROM products ORDER BY id');
  res.json(r.rows);
});
app.post('/api/admin/products', requireAuth, requireAdmin, async (req, res) => {
  const { name, description, price_cents, image_url, stock } = req.body || {};
  const r = await pool.query(
    `INSERT INTO products(name,description,price_cents,image_url,stock)
     VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [name, description || null, Number(price_cents), image_url || null, stock == null ? null : Number(stock)]
  );
  res.json(r.rows[0]);
});


app.delete('/api/admin/products/:id', requireAuth, requireAdmin, async (req, res) => {
  await pool.query('DELETE FROM products WHERE id=$1', [Number(req.params.id)]);
  res.json({ ok: true });
});


// GET all orders (optionally filter by q, status, user_id)
app.get('/api/admin/orders', requireAuth, requireAdmin, async (req, res) => {
  const { q = '', status = '', user_id, limit = 200, offset = 0 } = req.query;

  const clauses = [];
  const params = [];
  let i = 1;

  if (status && ORDER_STATUS.includes(status)) { clauses.push(`o.status = $${i++}`); params.push(status); }
  if (user_id && /^\d+$/.test(user_id))       { clauses.push(`o.user_id = $${i++}`); params.push(Number(user_id)); }
  if (q) { clauses.push(`(u.email ILIKE $${i} OR u.fullname ILIKE $${i})`); params.push(`%${q}%`); i++; }

  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const sql = `
    SELECT o.id, o.user_id, u.email, u.fullname, o.items, o.total_cents, o.status, o.created_at, o.updated_at
      FROM orders o
      JOIN users u ON u.id = o.user_id
      ${where}
     ORDER BY o.created_at DESC
     LIMIT $${i} OFFSET $${i+1}
  `;
  params.push(Number(limit), Number(offset));

  try {
    const r = await pool.query(sql, params);
    const rows = r.rows.map(o => ({
      ...o,
      items: Array.isArray(o.items) ? o.items :
             (typeof o.items === 'string' ? JSON.parse(o.items) : [])
    }));
    res.json(rows);
  } catch (e) {
    if (e.code === '42703') {
      const r2 = await pool.query(
        `SELECT o.id, o.user_id, u.email, u.fullname, o.total_cents, o.status, o.created_at
           FROM orders o JOIN users u ON u.id=u.user_id
           ${where.replace('o.items, ', '').replace('o.updated_at', 'o.created_at')}
           LIMIT $${i} OFFSET $${i+1}`, params
      );
      return res.json(r2.rows.map(o => ({ ...o, items: [] })));
    }
    res.status(500).json({ error: 'All-orders fetch failed' });
  }
});

// Courses listing (public)

app.get('/api/courses', async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, modules, created_at, updated_at
       FROM courses
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Failed to load courses" });
  }
});

app.get('/api/admin/courses',requireAuth, requireAdmin, async (_req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, modules, created_at, updated_at
       FROM courses
       ORDER BY created_at DESC`
    );
    res.json(rows);
  } catch (err) {
    console.error("Error fetching courses:", err);
    res.status(500).json({ error: "Failed to load courses" });
  }
});

// Create a new course (admin only)
app.post('/api/admin/courses',requireAuth, requireAdmin, async (req, res) => {
  const { title, description, image_url } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO courses (title, description, image_url) VALUES ($1, $2, $3) RETURNING id',
      [title, description, image_url]
    );
    res.status(201).json({ id: rows[0].id });
  } catch (e) {
    res.status(500).json({ error: 'Course creation failed' });
  }
});


app.put('/api/admin/courses/:id', requireAuth, requireAdmin, async (req, res) => {
  const id = Number(req.params.id);
  const { title, description, image_url, modules } = req.body;
  if (!title) return res.status(400).json({ error: 'Title is required' });

  try {
    const { rowCount } = await pool.query(
      `UPDATE courses
       SET title=$1, description=$2, image_url=$3, modules=$4
       WHERE id=$5`,
      [title, description, image_url, JSON.stringify(modules || []), id]
    );
    if (!rowCount) return res.status(404).json({ error: 'Course not found' });
    return res.status(200).json({ message: 'Course updated' });
  } catch (e) {
    console.error('Update course error:', e);
    return res.status(500).json({ error: 'Course update failed', detail: e.message });
  }
});


app.delete('/api/admin/courses/:id',requireAuth, requireAdmin, async (req, res) => {
  const { id } = req.params;
  try {
    const { rowCount } = await pool.query('DELETE FROM courses WHERE id=$1', [id]);
    if (!rowCount) return res.status(404).json({ error: 'Course not found' });
    res.status(200).json({ message: 'Course deleted' });
  } catch (e) {
    res.status(500).json({ error: 'Course deletion failed' });
  }
});


//user enrollment

// enroll
app.post('/api/courses/:id/enroll', requireAuth, async (req, res) => {
  const userId = Number(req.user.sub);
  const courseId = Number(req.params.id);
  const r = await pool.query(
    `INSERT INTO enrollments (user_id, course_id) VALUES ($1,$2)
     ON CONFLICT (user_id, course_id) DO NOTHING RETURNING *`,
    [userId, courseId]
  );
  if (!r.rowCount) return res.json({ ok: true, enrolled: true }); // already enrolled
  res.json({ ok: true, enrolled: true, enrolled_at: r.rows[0].enrolled_at });
});

// unenroll
app.delete('/api/courses/:id/enroll', requireAuth, async (req, res) => {
  const userId = Number(req.user.sub);
  const courseId = Number(req.params.id);
  await pool.query('DELETE FROM enrollments WHERE user_id=$1 AND course_id=$2', [userId, courseId]);
  res.json({ ok: true });
});

// list user enrollments



app.get('/api/me/enrollments', requireAuth, async (req, res) => {
  try {
    const r = await pool.query(
      `SELECT e.course_id, e.enrolled_at, e.meta, e.status, c.title, c.image_url
       FROM enrollments e JOIN courses c ON c.id = e.course_id
       WHERE e.user_id=$1 ORDER BY e.enrolled_at DESC`, [Number(req.user.sub)]
    );
    const rows = r.rows.map(row => {
      let meta = row.meta;
      if (typeof meta === 'string' && meta) {
        try { meta = JSON.parse(meta); } catch (e) { meta = {}; }
      }
      return { ...row, meta };
    });
    res.json(rows);
  } catch (e) {
    console.error('GET /api/me/enrollments failed', e);
    res.status(500).json({ error: 'Enrollments fetch failed' });
  }
});




// ensure this route is mounted with optionalAuth middleware:
// app.get('/api/courses/:id', optionalAuth, async (req, res) => { ... });

app.get('/api/courses/:id',optionalAuth, async (req, res) => {
  const courseId = Number(req.params.id);
  try {
    const { rows } = await pool.query(
      `SELECT id, title, description, image_url, modules, created_at, updated_at
         FROM courses WHERE id=$1`, [courseId]
    );
    if (!rows.length) return res.status(404).json({ error: 'Not found' });
    const course = rows[0];

    // normalize modules
    course.modules = Array.isArray(course.modules)
      ? course.modules
      : (typeof course.modules === 'string' ? JSON.parse(course.modules) : []);

    // counts
    const modules_count = course.modules.length;
    const videos_count = course.modules.reduce((s, m) => s + (Array.isArray(m.videos) ? m.videos.length : 0), 0);

    // try to include enrollment/progress if user present (optional)
    let enrolled = false, progress = null, completed_at = null;
    try {
      if (req.user && req.user.sub) {
        const r2 = await pool.query(
          `SELECT enrolled_at, meta, completed_at, status
             FROM enrollments
            WHERE user_id=$1 AND course_id=$2 LIMIT 1`,
          [Number(req.user.sub), courseId]
        );
        if (r2.rowCount) {
          enrolled = true;
          // meta may come back as object or string depending on driver/schema; normalize:
          let meta = r2.rows[0].meta;
          if (typeof meta === 'string' && meta) {
            try { meta = JSON.parse(meta); } catch (e) { /* ignore parse error */ }
          }
          progress = meta || {};
          completed_at = r2.rows[0].completed_at || null;
        }
      }
    } catch (e) {
      // ignore (don't fail entire request for a small enrollment lookup)
      console.warn('enrollment lookup failed', e);
    }

    return res.json({ ...course, modules_count, videos_count, enrolled, progress, completed_at });
  } catch (err) {
    console.error('GET /api/courses/:id error', err);
    return res.status(500).json({ error: 'Failed' });
  }
});


// mark video watched: body { module_idx, video_idx }
app.post('/api/courses/:id/progress', requireAuth, async (req, res) => {
  const userId = Number(req.user.sub);
  const courseId = Number(req.params.id);
  const { module_idx, video_idx } = req.body || {};

  if (!Number.isInteger(module_idx) || !Number.isInteger(video_idx)) {
    return res.status(400).json({ error: 'module_idx and video_idx required' });
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // ensure enrollment
    await client.query(
      `INSERT INTO enrollments(user_id, course_id)
       VALUES($1,$2) ON CONFLICT (user_id, course_id) DO NOTHING`,
      [userId, courseId]
    );

    // load course modules to compute totals
    const c = await client.query('SELECT modules FROM courses WHERE id=$1', [courseId]);
    if (!c.rowCount) { await client.query('ROLLBACK'); return res.status(404).json({ error: 'Course not found' }); }
    const modules = Array.isArray(c.rows[0].modules) ? c.rows[0].modules : (typeof c.rows[0].modules === 'string' ? JSON.parse(c.rows[0].modules) : []);
    const totalVideos = modules.reduce((s,m)=> s + (Array.isArray(m.videos) ? m.videos.length : 0), 0);

    // fetch current meta
    const r = await client.query('SELECT meta FROM enrollments WHERE user_id=$1 AND course_id=$2 FOR UPDATE', [userId, courseId]);
    let meta = r.rowCount ? (r.rows[0].meta || {}) : {};
    if (!meta.watched) meta.watched = {}; // { "m0": [0,1], "m1": [0] }

    const mKey = `m${module_idx}`;
    meta.watched[mKey] = Array.isArray(meta.watched[mKey]) ? meta.watched[mKey] : [];
    if (!meta.watched[mKey].includes(Number(video_idx))) meta.watched[mKey].push(Number(video_idx));

    // count watched videos
    const watchedCount = Object.values(meta.watched).reduce((sum, arr) => sum + (Array.isArray(arr) ? arr.length : 0), 0);

    // mark completed if all watched
    let completedAt = null;
    let status = 'active';
    if (totalVideos > 0 && watchedCount >= totalVideos) {
      completedAt = new Date().toISOString();
      status = 'completed';
    }

    await client.query(
      `UPDATE enrollments SET meta=$1::jsonb, completed_at=$2, status=$3 WHERE user_id=$4 AND course_id=$5`,
      [JSON.stringify(meta), completedAt, status, userId, courseId]
    );


    await client.query('COMMIT');
    return res.json({ ok: true, watchedCount, totalVideos, completed: !!completedAt });
  } catch (err) {
    await client.query('ROLLBACK').catch(()=>{});
    console.error('progress error', err);
    return res.status(500).json({ error: 'Progress failed' });
  } finally {
    client.release();
  }
});




/* ------------------------------ Start ----------------------------- */
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => { console.log(`Server http://localhost:${PORT}`); });
