// auth.js (ESM)
import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import ms from 'ms';
import pool from './db.js';
import { v4 as uuidv4 } from 'uuid';

const ACCESS_SECRET  = process.env.JWT_SECRET;
const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET;
const ACCESS_TTL  = process.env.JWT_EXPIRES_IN  || '15m';
const REFRESH_TTL = process.env.JWT_REFRESH_EXPIRES_IN || '7d';

const ACCESS_MS  = ms(ACCESS_TTL);
const REFRESH_MS = ms(REFRESH_TTL);

const hash = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const uaHashOf = (req) => hash(req.get('user-agent') || '');

function rawFpFromReq(req) {
  return (
    req.get('x-client-fingerprint') ||
    req.get('x-fp') ||
    req.get('x-device-fingerprint') ||
    req.cookies?.fp ||
    null
  );
}
function getFingerprint(req) {
  const raw = rawFpFromReq(req);
  return raw ? hash(raw) : null;
}
function setFpCookieFromReq(req, res) {
  const raw = rawFpFromReq(req);
  if (!raw) return;
  const isProd = process.env.NODE_ENV === 'production';
  res.cookie('fp', raw, { httpOnly: false, sameSite: 'Strict', path: '/', secure: isProd, maxAge: REFRESH_MS });
}

function setAuthCookies(res, access, refresh, sid) {
  const isProd = process.env.NODE_ENV === 'production';
  const common = { httpOnly: true, sameSite: 'Strict', path: '/', secure: isProd };
  res.cookie('access_token',  access,  { ...common, maxAge: ACCESS_MS });
  res.cookie('refresh_token', refresh, { ...common, maxAge: REFRESH_MS });
  res.cookie('sid',           sid,     { ...common, maxAge: REFRESH_MS });
}
function clearAuthCookies(res) {
  res.clearCookie('access_token',  { path: '/' });
  res.clearCookie('refresh_token', { path: '/' });
  res.clearCookie('sid',           { path: '/' });
}

function signAccess(user, sid, uaH, fpH) {
  return jwt.sign({ sub: user.id, email: user.email, sid, ua: uaH, fp: fpH }, ACCESS_SECRET, { expiresIn: ACCESS_TTL });
}
function signRefresh(user, sid, uaH, fpH) {
  return jwt.sign({ sub: user.id, sid, ua: uaH, fp: fpH }, REFRESH_SECRET, { expiresIn: REFRESH_TTL });
}

/* ------------------------- Issue Tokens -------------------------- */
export async function issueTokens(res, user, req) {
  const sid = uuidv4();
  const uaH = uaHashOf(req);
  const fpH = getFingerprint(req);
  if (!fpH) return res.status(400).json({ error: 'Missing device fingerprint' });

  const access  = signAccess(user, sid, uaH, fpH);
  const refresh = signRefresh(user, sid, uaH, fpH);

  await pool.query(
    `INSERT INTO refresh_tokens (user_id, token, session_id, ua_hash, fp_hash, created_at)
     VALUES ($1,$2,$3,$4,$5,now())`,
    [user.id, hash(refresh), sid, uaH, fpH]
  );

  setAuthCookies(res, access, refresh, sid);
  setFpCookieFromReq(req, res);
  return { access, refresh, sid };
}

/* ------------------------- Require Auth -------------------------- */
export function requireAuth(req, res, next) {
  const token = req.cookies?.access_token || (req.headers.authorization || '').replace('Bearer ', '');
  if (!token) { clearAuthCookies(res); return res.status(401).json({ error: 'No token' }); }

  try {
    const payload = jwt.verify(token, ACCESS_SECRET);
    const sidCookie = req.cookies?.sid;
    const uaH = uaHashOf(req);
    const fpH = getFingerprint(req);
    if (!sidCookie || !fpH) { clearAuthCookies(res); return res.status(401).json({ error: 'Missing device fingerprint' }); }
    if (sidCookie !== payload.sid || uaH !== payload.ua || fpH !== payload.fp) {
      clearAuthCookies(res); return res.status(401).json({ error: 'Token context mismatch' });
    }
    req.user = payload;
    next();
  } catch {
    clearAuthCookies(res);
    res.status(401).json({ error: 'Invalid or expired access token' });
  }
}

/* ------------------------- Refresh Tokens ------------------------ */
export async function refreshTokens(req, res) {
  const rt = req.cookies?.refresh_token;
  const sidCookie = req.cookies?.sid;
  if (!rt || !sidCookie) { clearAuthCookies(res); return res.status(401).json({ error: 'No refresh token' }); }

  let payload;
  try { payload = jwt.verify(rt, REFRESH_SECRET); }
  catch {
    try {
      const dec = jwt.decode(rt);
      if (dec?.sub) {
        await pool.query(
          `UPDATE refresh_tokens SET revoked_at = now()
           WHERE user_id=$1 AND token=$2 AND revoked_at IS NULL`,
          [dec.sub, hash(rt)]
        );
      }
    } catch {}
    clearAuthCookies(res);
    return res.status(401).json({ error: 'Expired/invalid refresh token' });
  }

  const uaH = uaHashOf(req);
  const fpH = getFingerprint(req);
  if (!fpH) { clearAuthCookies(res); return res.status(401).json({ error: 'Missing device fingerprint' }); }
  if (payload.sid !== sidCookie || payload.ua !== uaH || payload.fp !== fpH) {
    clearAuthCookies(res); return res.status(401).json({ error: 'Refresh context mismatch' });
  }

  const ok = await pool.query(
    `SELECT 1 FROM refresh_tokens
      WHERE user_id=$1 AND token=$2 AND session_id=$3 AND revoked_at IS NULL`,
    [payload.sub, hash(rt), payload.sid]
  );
  if (!ok.rowCount) { clearAuthCookies(res); return res.status(401).json({ error: 'Refresh not found' }); }

  const user = { id: payload.sub, email: null };
  const access = signAccess(user, payload.sid, uaH, fpH);
  setAuthCookies(res, access, rt, payload.sid);
  setFpCookieFromReq(req, res);
  return { access };
}


export async function optionalAuth(req, _res, next) {
  try {
    const token = req.cookies?.access_token || req.get('authorization')?.split(' ')[1];
    if (token) {
      // reuse your token verification logic (synchronous or async)
      const payload = verifyAccessToken(token); // implement or import
      req.user = { sub: payload.sub, ...payload };
    }
  } catch (e) { /* ignore invalid token */ }
  next();
}


/* ------------------------------ Logout --------------------------- */
export function logout(_req, res) { clearAuthCookies(res); res.json({ ok: true }); }
