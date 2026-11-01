/* Sign-in: Google ID tokens verified on the server, then a signed session cookie.
 * DEV_LOGIN=1 (never in production) adds a name/email form for local testing. */
'use strict';
const crypto = require('crypto');
const { OAuth2Client } = require('google-auth-library');

const COOKIE = 'mite_sess';
const MAX_AGE_S = 60 * 60 * 24 * 14; // two weeks
const SECRET = process.env.SESSION_SECRET || (process.env.NODE_ENV === 'production' ? null : 'dev-secret-change-me');
if (!SECRET) throw new Error('SESSION_SECRET must be set in production');
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const DEV_LOGIN = process.env.DEV_LOGIN === '1' && process.env.NODE_ENV !== 'production';
const google = GOOGLE_CLIENT_ID ? new OAuth2Client(GOOGLE_CLIENT_ID) : null;

const b64 = (buf) => Buffer.from(buf).toString('base64url');
function sign(payload) {
  const body = b64(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  return body + '.' + mac;
}
function verify(token) {
  if (!token || typeof token !== 'string' || token.indexOf('.') < 0) return null;
  const [body, mac] = token.split('.');
  const want = crypto.createHmac('sha256', SECRET).update(body).digest('base64url');
  if (mac.length !== want.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!p.exp || p.exp < Date.now() / 1000) return null;
    return p;
  } catch (e) { return null; }
}
function parseCookies(header) {
  const out = {};
  String(header || '').split(';').forEach((part) => {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}
function userFromHeader(cookieHeader) { return verify(parseCookies(cookieHeader)[COOKIE]); }

function setCookie(res, user) {
  const token = sign({ email: user.email, name: user.name, pic: user.pic || '', exp: Math.floor(Date.now() / 1000) + MAX_AGE_S });
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_AGE_S}${secure}`);
}
function clearCookie(res) { res.setHeader('Set-Cookie', `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`); }

async function verifyGoogle(credential) {
  if (!google) throw Object.assign(new Error('Google sign-in is not configured'), { status: 503 });
  const ticket = await google.verifyIdToken({ idToken: credential, audience: GOOGLE_CLIENT_ID });
  const p = ticket.getPayload();
  if (!p || !p.email || !p.email_verified) throw Object.assign(new Error('Google account email is not verified'), { status: 401 });
  return { email: p.email.toLowerCase(), name: p.name || p.email.split('@')[0], pic: p.picture || '' };
}

module.exports = { COOKIE, GOOGLE_CLIENT_ID, DEV_LOGIN, setCookie, clearCookie, userFromHeader, verifyGoogle };
