/* Chasm & Curve web server: static client, sign-in, CSV export, and the live game over Socket.IO. */
'use strict';
const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');
const auth = require('./auth');
const makeStore = require('./store');
const { Game, GameError } = require('./game');
const { buildCSV } = require('./export');
const pkg = require('../package.json');

const PORT = +process.env.PORT || 3000;
const SUPER_ADMINS = String(process.env.INSTRUCTOR_EMAILS || '').split(',').map((x) => x.trim().toLowerCase()).filter(Boolean);
const CONTACT = process.env.CONTACT_EMAIL || SUPER_ADMINS[0] || '';

const store = makeStore();
const game = new Game(store, { superAdmins: SUPER_ADMINS });
const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 1e5, cors: { origin: false } });

app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  // Google Identity Services needs this so its sign-in popup can report back
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
});

const ROOT = path.join(__dirname, '..');
app.use('/shared', express.static(path.join(ROOT, 'shared'), { maxAge: '5m' }));
app.use('/vendor/socket.io', express.static(path.join(ROOT, 'node_modules/socket.io/client-dist'), { maxAge: '1d' }));
app.use(express.static(path.join(ROOT, 'public'), { maxAge: '5m', index: 'index.html' }));

const userOf = (req) => auth.userFromHeader(req.headers.cookie);
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  const status = e.status || (e instanceof GameError ? 400 : 500);
  if (status >= 500) console.error(e);
  res.status(status).json({ error: e.code || e.message || 'error' });
});

// ---------- auth ----------
app.get('/api/config', (req, res) => res.json({ googleClientId: auth.GOOGLE_CLIENT_ID, devLogin: auth.DEV_LOGIN, version: pkg.version, contact: CONTACT }));
app.post('/api/auth/google', wrap(async (req, res) => {
  const u = await auth.verifyGoogle(String(req.body.credential || ''));
  auth.setCookie(res, u);
  res.json({ ok: true });
}));
app.post('/api/auth/dev', wrap(async (req, res) => {
  if (!auth.DEV_LOGIN) return res.status(404).json({ error: 'not_found' });
  const email = String(req.body.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) return res.status(400).json({ error: 'bad_email' });
  auth.setCookie(res, { email, name: String(req.body.name || email.split('@')[0]).slice(0, 60) });
  res.json({ ok: true });
}));
app.post('/api/auth/logout', (req, res) => { auth.clearCookie(res); res.json({ ok: true }); });
app.get('/api/me', wrap(async (req, res) => {
  const u = userOf(req);
  if (!u) return res.json({ user: null });
  const pref = await store.getPlayer(u.email);
  res.json({ user: { email: u.email, name: u.name, pic: u.pic }, lang: pref && pref.lang, isInstructor: await game.isInstructor(u.email), isSuperAdmin: game.isSuperAdmin(u.email) });
}));
app.post('/api/me/lang', wrap(async (req, res) => {
  const u = userOf(req); if (!u) return res.status(401).json({ error: 'signed_out' });
  const lang = req.body.lang === 'id' ? 'id' : 'en';
  await store.savePlayer(u.email, u.name, lang);
  res.json({ ok: true });
}));
app.post('/api/me/delete', wrap(async (req, res) => {
  const u = userOf(req); if (!u) return res.status(401).json({ error: 'signed_out' });
  await store.deletePlayerData(u.email);
  for (const s of await store.listSessionsFor(u.email)) {
    const live = await game.load(s.id);
    if (live.owner !== u.email && live.players[u.email]) { game.moveToTeam(live, u.email, null); delete live.players[u.email]; game.touch(live); }
  }
  auth.clearCookie(res);
  res.json({ ok: true });
}));

// ---------- export ----------
app.get('/api/sessions/:id/export.csv', wrap(async (req, res) => {
  const u = userOf(req); if (!u) return res.status(401).json({ error: 'signed_out' });
  const s = await game.load(req.params.id);
  const role = game.roleIn(s, u.email);
  if (!role) return res.status(403).json({ error: 'not_member' });
  const lang = req.query.lang === 'id' ? 'id' : 'en';
  let teamIdx = null;
  if (role === 'player') { teamIdx = game.teamOf(s, u.email); if (teamIdx < 0) return res.status(403).json({ error: 'no_team' }); }
  const csv = buildCSV(game, s, lang, teamIdx);
  const base = (s.name || 'session').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'session';
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="chasm-curve-${base}-${s.code}${teamIdx != null ? '-team' + (teamIdx + 1) : ''}.csv"`);
  res.send('﻿' + csv);
}));
app.get('/api/sessions/:id/audit.json', wrap(async (req, res) => {
  const u = userOf(req); if (!u) return res.status(401).json({ error: 'signed_out' });
  const s = await game.load(req.params.id);
  if (game.roleIn(s, u.email) !== 'owner') return res.status(403).json({ error: 'not_allowed' });
  res.json(await store.getAudit(s.id));
}));
app.get('/healthz', (req, res) => res.json({ ok: true, store: store.kind }));

// Single-page app: unknown paths serve the client
app.get(/^\/(?!api\/|socket\.io\/).*/, (req, res) => res.sendFile(path.join(ROOT, 'public', 'index.html')));

// ---------- live game ----------
io.use((socket, next) => {
  const u = auth.userFromHeader(socket.handshake.headers.cookie);
  if (!u) return next(new Error('signed_out'));
  socket.data.user = { email: u.email, name: u.name };
  next();
});

const pending = new Map();
function scheduleBroadcast(id, delay) {
  if (pending.has(id)) return;
  pending.set(id, setTimeout(() => { pending.delete(id); broadcastNow(id); }, delay == null ? 80 : delay));
}
function broadcastNow(id) {
  const s = game.sessions.get(id); if (!s) return;
  const room = io.sockets.adapter.rooms.get('s:' + id); if (!room) return;
  for (const sid of room) {
    const sock = io.sockets.sockets.get(sid); if (!sock) continue;
    try { syncRooms(sock, s); sock.emit('view', game.viewFor(s, sock.data.user.email)); } catch (e) { sock.leave('s:' + id); sock.emit('kicked', { id }); }
  }
}
// Keep each socket in the right team and staff rooms as players move between teams
function syncRooms(sock, s) {
  const email = sock.data.user.email, role = game.roleIn(s, email);
  const ti = game.teamOf(s, email);
  const want = ti >= 0 ? 'team:' + s.id + ':' + s.teams[ti].id : null;
  for (const r of sock.rooms) if (r.startsWith('team:' + s.id + ':') && r !== want) sock.leave(r);
  if (want) sock.join(want);
  if (role === 'owner' || role === 'ta') sock.join('staff:' + s.id); else sock.leave('staff:' + s.id);
}
game.onChange = (s) => scheduleBroadcast(s.id);
setInterval(() => game.tick(), 1000);

async function sessionList(email) {
  const list = await store.listSessionsFor(email);
  return list.map((x) => {
    const s = game.sessions.get(x.id) || x;
    return { id: s.id, code: s.code, name: s.name, kind: s.kind, mode: s.mode, status: s.status, role: game.roleIn(s, email),
      updatedAt: s.updatedAt, teams: s.teams.length, players: Object.keys(s.players).length, rounds: s.settings.rounds };
  });
}

io.on('connection', (socket) => {
  const me = socket.data.user;
  const on = (ev, fn) => socket.on(ev, async (arg, ack) => {
    if (typeof ack !== 'function') ack = () => {};
    try { ack(Object.assign({ ok: true }, (await fn(arg || {})) || {})); } catch (e) {
      if (!(e instanceof GameError)) console.error(ev, e);
      ack({ ok: false, error: e.code || 'server_error' });
    }
  });
  const open = async (id) => {
    const s = await game.load(id);
    if (!game.roleIn(s, me.email)) throw new GameError('not_member');
    for (const r of socket.rooms) if (r !== socket.id) socket.leave(r);
    socket.join('s:' + s.id);
    const role = game.roleIn(s, me.email);
    if (role !== 'player') socket.join('staff:' + s.id);
    const ti = game.teamOf(s, me.email);
    if (ti >= 0) socket.join('team:' + s.id + ':' + s.teams[ti].id);
    socket.data.sessionId = s.id;
    return s;
  };
  const cur = async () => { if (!socket.data.sessionId) throw new GameError('no_session'); return game.load(socket.data.sessionId); };

  on('sessions:list', async () => ({ sessions: await sessionList(me.email) }));
  on('session:create', async ({ name, mode, settings }) => { const s = await game.createSession(me, { name, mode, settings }); await open(s.id); return { id: s.id, view: game.viewFor(s, me.email) }; });
  on('practice:create', async ({ lang }) => { const s = await game.createPractice(me, lang); await open(s.id); return { id: s.id, view: game.viewFor(s, me.email) }; });
  on('session:join', async ({ code }) => { const s = await game.join(me, code); await open(s.id); return { id: s.id, view: game.viewFor(s, me.email) }; });
  on('session:open', async ({ id }) => { const s = await open(id); return { view: game.viewFor(s, me.email) }; });
  on('session:leave', async () => { for (const r of socket.rooms) if (r !== socket.id) socket.leave(r); socket.data.sessionId = null; });

  const act = (ev, fn, reopen) => on(ev, async (arg) => {
    const s = await cur();
    await fn(s, arg);
    if (reopen) await open(s.id);
    return { view: game.viewFor(s, me.email) };
  });
  act('team:choose', (s, { teamId }) => game.chooseTeam(s, me.email, teamId), true);
  act('team:rename', (s, { teamId, name }) => game.renameTeam(s, me.email, teamId, name));
  act('team:captain', (s, { teamId, email }) => game.setCaptain(s, me.email, teamId, email));
  act('round:submit', (s, { on: v }) => game.submit(s, me.email, v !== false));
  act('round:next', (s) => game.nextRound(s, me.email));
  on('draft:set', async ({ path: p, value }) => {
    const s = await cur();
    const t = game.setDraft(s, me.email, String(p || ''), value);
    socket.to('team:' + s.id + ':' + t.id).emit('draft', { teamId: t.id, draft: t.draft, draftRev: t.draftRev, by: me.name });
    game.touch(s, true);
    io.to('staff:' + s.id).emit('staff:draft', { teamId: t.id, draft: t.draft });
    return { draftRev: t.draftRev };
  });
  on('reflection:set', async ({ k, text }) => {
    const s = await cur();
    const t = game.setReflection(s, me.email, k, text);
    socket.to('team:' + s.id + ':' + t.id).emit('reflection', { teamId: t.id, reflection: t.reflection });
    return {};
  });

  // instructor and assistants (permission checks inside Game)
  act('ins:settings', (s, { settings, name }) => game.updateSettings(s, me.email, settings, name));
  act('ins:assign', (s, { email, teamId }) => game.assign(s, me.email, email, teamId), false);
  act('ins:remove', (s, { email }) => game.removePlayer(s, me.email, email));
  act('ins:start', (s) => game.startGame(s, me.email));
  act('ins:pause', (s, { on: v }) => game.pause(s, me.email, !!v));
  act('ins:extend', (s, { minutes }) => game.extend(s, me.email, minutes));
  act('ins:run', (s) => game.runRound(s, me.email));
  act('ins:next', (s) => game.nextRound(s, me.email));
  act('ins:rewind', (s, { round, practice }) => game.rewind(s, me.email, round, practice));
  act('ins:runPractice', (s, { idx, practice }) => game.setRunPractice(s, me.email, idx, practice));
  act('ins:end', (s) => game.endGame(s, me.email));
  act('ins:ta:add', (s, { email, canPace }) => game.addTA(s, me.email, email, canPace));
  act('ins:ta:remove', (s, { email }) => game.removeTA(s, me.email, email));
  act('ins:broadcast', (s, { text }) => game.broadcast(s, me.email, text));
  on('ins:delete', async () => { const s = await cur(); await game.deleteSession(s, me.email); socket.data.sessionId = null; return {}; });

  // super-admins manage the instructor allowlist
  on('admin:instructors', async () => {
    if (!game.isSuperAdmin(me.email)) throw new GameError('not_allowed');
    return { superAdmins: SUPER_ADMINS, instructors: await store.listInstructors() };
  });
  on('admin:instructor:add', async ({ email }) => {
    if (!game.isSuperAdmin(me.email)) throw new GameError('not_allowed');
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new GameError('bad_email');
    await store.addInstructor(email, me.email); game.instructorCache = null;
    return { instructors: await store.listInstructors() };
  });
  on('admin:instructor:remove', async ({ email }) => {
    if (!game.isSuperAdmin(me.email)) throw new GameError('not_allowed');
    await store.removeInstructor(String(email || '').toLowerCase()); game.instructorCache = null;
    return { instructors: await store.listInstructors() };
  });
});

async function main() {
  await store.init();
  server.listen(PORT, () => console.log(`Chasm & Curve listening on :${PORT} (store: ${store.kind}, google: ${auth.GOOGLE_CLIENT_ID ? 'on' : 'off'}, dev login: ${auth.DEV_LOGIN ? 'on' : 'off'})`));
}
async function shutdown() { try { await game.flushAll(); } finally { process.exit(0); } }
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
main().catch((e) => { console.error(e); process.exit(1); });
