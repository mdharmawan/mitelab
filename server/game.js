/* Sessions, teams, rounds and views. All game rules live in shared/engine.js; this file decides
 * who may do what, keeps the decisions log, and rebuilds markets by deterministic replay. */
'use strict';
const crypto = require('crypto');
const E = require('../shared/engine.js');

const CODE_ALPHA = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
const TEAM_COLORS = 6;
const LANGS = ['en', 'id'];

function newId() { return crypto.randomBytes(9).toString('base64url'); }
function newCode() { let c = ''; for (let i = 0; i < 6; i++) c += CODE_ALPHA[crypto.randomInt(CODE_ALPHA.length)]; return c; }
const normCode = (c) => String(c || '').toUpperCase().replace(/[^0-9A-Z]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const clone = (x) => JSON.parse(JSON.stringify(x));

class GameError extends Error { constructor(code, msg) { super(msg || code); this.code = code; } }
const fail = (code) => { throw new GameError(code); };

// ---------- settings ----------
function cleanSettings(raw, kind) {
  raw = raw || {};
  const s = E.normalizeSettings({
    preset: ['easy', 'standard', 'hard'].includes(raw.preset) ? raw.preset : 'standard',
    rounds: raw.rounds, seed: raw.seed == null ? crypto.randomInt(65536) : raw.seed,
    hints: raw.hints !== false, unlocks: raw.unlocks !== false, randomness: raw.randomness !== false, failures: raw.failures !== false,
    timerMin: clamp(Math.round(+raw.timerMin || 0), 0, 30),
    startCashM: clamp(+raw.startCashM || 0, 0, 50),
    marketK: (Array.isArray(raw.marketK) ? raw.marketK : [0, 0, 0]).slice(0, 3).map((x) => clamp(Math.round(+x || 0), 0, 20000)),
    p0: clamp(+raw.p0 || 0, 0, 0.1), q0: clamp(+raw.q0 || 0, 0, 0.9),
    competitor: { on: !!(raw.competitor && raw.competitor.on), round: raw.competitor ? +raw.competitor.round : 6, vertical: raw.competitor ? clamp(+raw.competitor.vertical || 0, 0, 2) : 1 },
    regulation: { on: !!(raw.regulation && raw.regulation.on), round: raw.regulation ? +raw.regulation.round : 4 },
    funding: { mode: raw.funding && ['off', 'random', 'boom', 'winter'].includes(raw.funding.mode) ? raw.funding.mode : 'random', round: raw.funding ? +raw.funding.round || 6 : 6 },
  });
  s.lang = LANGS.includes(raw.lang) ? raw.lang : 'en';
  s.teamCount = kind === 'practice' ? 1 : clamp(Math.round(+raw.teamCount || 4), 1, E.MAX_TEAMS);
  s.assign = raw.assign === 'instructor' ? 'instructor' : 'self';
  s.autoRun = raw.autoRun !== false;
  s.runOnTimeout = !!raw.runOnTimeout;
  return s;
}

// ---------- the manager ----------
class Game {
  constructor(store, opts) {
    this.store = store;
    this.superAdmins = (opts.superAdmins || []).map((e) => e.toLowerCase());
    this.sessions = new Map();   // id -> session doc (loaded)
    this.markets = new Map();    // cache key -> market
    this.saveTimers = new Map();
    this.onChange = () => {};
    this.instructorCache = null;
  }

  // ----- roles -----
  async isInstructor(email) {
    if (!email) return false;
    if (this.superAdmins.includes(email)) return true;
    if (!this.instructorCache) this.instructorCache = new Set((await this.store.listInstructors()).map((x) => x.email));
    return this.instructorCache.has(email);
  }
  isSuperAdmin(email) { return this.superAdmins.includes(email); }
  roleIn(s, email) {
    if (s.kind === 'practice') return s.players[email] ? 'player' : null;
    if (s.owner === email) return 'owner';
    if (s.tas && s.tas[email]) return 'ta';
    if (s.players && s.players[email]) return 'player';
    return null;
  }
  canPace(s, email) { const r = this.roleIn(s, email); return r === 'owner' || (r === 'ta' && s.tas[email].canPace); }
  requireOwner(s, email) { if (this.roleIn(s, email) !== 'owner') fail('not_allowed'); }
  requirePace(s, email) { if (!this.canPace(s, email)) fail('not_allowed'); }

  // ----- loading and saving -----
  async load(id) {
    if (this.sessions.has(id)) return this.sessions.get(id);
    const s = await this.store.getSession(id);
    if (!s) fail('not_found');
    this.sessions.set(id, s);
    return s;
  }
  async loadByCode(code) {
    code = normCode(code);
    for (const s of this.sessions.values()) if (s.code === code) return s;
    const s = await this.store.getSessionByCode(code);
    if (!s) fail('bad_code');
    if (this.sessions.has(s.id)) return this.sessions.get(s.id);
    this.sessions.set(s.id, s);
    return s;
  }
  touch(s, quiet) {
    s.updatedAt = Date.now();
    clearTimeout(this.saveTimers.get(s.id));
    this.saveTimers.set(s.id, setTimeout(() => {
      this.saveTimers.delete(s.id);
      this.store.saveSession(s).catch((e) => console.error('save failed', s.id, e.message));
    }, 250));
    if (!quiet) this.onChange(s);
  }
  async flushAll() {
    for (const [id, tm] of this.saveTimers) { clearTimeout(tm); const s = this.sessions.get(id); if (s) await this.store.saveSession(s); }
    this.saveTimers.clear();
  }
  audit(s, actor, type, payload) { this.store.audit(s.id, actor, type, payload).catch((e) => console.error('audit failed', e.message)); }

  // ----- markets (rebuilt by replay, then cached) -----
  run(s) { return s.runs[s.activeRun]; }
  marketFor(s, teamIdx) {
    const run = this.run(s);
    if (s.mode === 'multi') {
      const key = `${s.id}:${s.activeRun}:m:${run.rounds.length}`;
      let m = this.markets.get(key);
      if (!m) {
        m = E.replay(s.settings, s.teams.length, run.rounds);
        this.dropMarkets(s.id, `${s.id}:${s.activeRun}:m:`);
        this.markets.set(key, m);
      }
      return m;
    }
    const rounds = run.teamRounds[teamIdx] || [];
    const key = `${s.id}:${s.activeRun}:t${teamIdx}:${rounds.length}`;
    let m = this.markets.get(key);
    if (!m) {
      m = E.replay(s.settings, 1, rounds.map((d) => [d]));
      this.dropMarkets(s.id, `${s.id}:${s.activeRun}:t${teamIdx}:`);
      this.markets.set(key, m);
    }
    return m;
  }
  teamState(s, t) { const m = this.marketFor(s, t); return s.mode === 'multi' ? m.teams[t] : m.teams[0]; }
  dropMarkets(id, prefix) { for (const k of this.markets.keys()) if (k.startsWith(prefix || id + ':')) this.markets.delete(k); }

  // ----- create -----
  async createSession(user, { name, mode, settings }) {
    if (!(await this.isInstructor(user.email))) fail('not_instructor');
    return this._create(user, { name, mode: mode === 'single' ? 'single' : 'multi', settings, kind: 'class' });
  }
  async createPractice(user, lang) {
    const s = await this._create(user, { name: '', mode: 'single', settings: { preset: 'standard', rounds: 10, seed: 4242, lang, timerMin: 0,
      competitor: { on: true, round: 6, vertical: 1 }, regulation: { on: true, round: 4 }, funding: { mode: 'random' } }, kind: 'practice' });
    this.addPlayer(s, user, s.teams[0].id);
    this.startGame(s, user.email, true);
    return s;
  }
  async _create(user, { name, mode, settings, kind }) {
    const st = cleanSettings(settings, kind);
    let code = newCode();
    for (let i = 0; i < 20 && (await this.store.getSessionByCode(code)); i++) code = newCode();
    const s = {
      id: newId(), code, owner: user.email, ownerName: user.name, name: String(name || '').slice(0, 80), kind, mode,
      createdAt: Date.now(), updatedAt: Date.now(), settings: st, status: 'lobby', phase: 'lobby', paused: false, deadline: null, remainingMs: null,
      teams: [], players: {}, tas: {}, broadcasts: [],
      runs: [{ id: 1, label: 'Run 1', practice: kind === 'practice', createdAt: Date.now(), fromRound: 1, rounds: [], teamRounds: [] }],
      activeRun: 0,
    };
    for (let t = 0; t < st.teamCount; t++) s.teams.push(this.blankTeam(t, kind === 'practice' ? (user.name || 'Practice') : null));
    this.sessions.set(s.id, s);
    await this.store.saveSession(s);
    this.audit(s, user.email, 'create', { mode, kind, settings: st });
    return s;
  }
  blankTeam(t, name) {
    return { id: 't' + (t + 1) + '-' + crypto.randomBytes(2).toString('hex'), name: name || null, n: t + 1, color: t % TEAM_COLORS,
      captain: null, members: [], submitted: false, draft: null, draftRev: 0, phase: 'lobby', deadline: null, reflection: ['', '', ''] };
  }

  // ----- lobby -----
  async join(user, code) {
    const s = await this.loadByCode(code);
    if (s.kind === 'practice') fail('bad_code');
    const role = this.roleIn(s, user.email);
    if (role === 'owner' || role === 'ta') return s;
    if (!s.players[user.email]) {
      s.players[user.email] = { name: user.name, teamId: null, joinedAt: Date.now() };
      this.audit(s, user.email, 'join', {});
    } else s.players[user.email].name = user.name;
    this.touch(s);
    return s;
  }
  addPlayer(s, user, teamId) {
    s.players[user.email] = { name: user.name, teamId: null, joinedAt: Date.now() };
    this.moveToTeam(s, user.email, teamId);
  }
  moveToTeam(s, email, teamId) {
    const p = s.players[email]; if (!p) fail('not_found');
    const to = teamId ? s.teams.find((t) => t.id === teamId) : null;
    if (teamId && !to) fail('not_found');
    for (const t of s.teams) {
      const i = t.members.indexOf(email);
      if (i >= 0) { t.members.splice(i, 1); if (t.captain === email) t.captain = t.members[0] || null; }
    }
    p.teamId = to ? to.id : null;
    if (to) { to.members.push(email); if (!to.captain) to.captain = email; }
  }
  chooseTeam(s, email, teamId) {
    if (this.roleIn(s, email) !== 'player') fail('not_allowed');
    if (s.settings.assign !== 'self') fail('instructor_assigns');
    if (s.status !== 'lobby' && s.players[email].teamId) fail('game_started');
    this.moveToTeam(s, email, teamId);
    this.touch(s);
  }
  assign(s, actor, email, teamId) {
    this.requireOwner(s, actor);
    this.moveToTeam(s, email, teamId || null);
    this.audit(s, actor, 'assign', { email, teamId });
    this.touch(s);
  }
  setCaptain(s, actor, teamId, email) {
    const t = s.teams.find((x) => x.id === teamId); if (!t) fail('not_found');
    if (this.roleIn(s, actor) !== 'owner' && t.captain !== actor) fail('not_allowed');
    if (!t.members.includes(email)) fail('not_found');
    t.captain = email;
    this.touch(s);
  }
  renameTeam(s, actor, teamId, name) {
    const t = s.teams.find((x) => x.id === teamId); if (!t) fail('not_found');
    if (this.roleIn(s, actor) !== 'owner' && t.captain !== actor) fail('not_allowed');
    t.name = String(name || '').trim().slice(0, 40) || null;
    this.touch(s);
  }
  removePlayer(s, actor, email) {
    this.requireOwner(s, actor);
    if (!s.players[email]) fail('not_found');
    this.moveToTeam(s, email, null);
    delete s.players[email];
    this.touch(s);
  }
  updateSettings(s, actor, settings, name) {
    this.requireOwner(s, actor);
    if (s.status !== 'lobby') fail('game_started');
    const st = cleanSettings(settings, s.kind);
    // Grow or shrink the team list; keep teams that already have members
    while (s.teams.length < st.teamCount) s.teams.push(this.blankTeam(s.teams.length));
    while (s.teams.length > st.teamCount) {
      const last = s.teams[s.teams.length - 1];
      if (last.members.length) break;
      s.teams.pop();
    }
    st.teamCount = s.teams.length;
    s.settings = st;
    if (name != null) s.name = String(name).slice(0, 80);
    this.dropMarkets(s.id);
    this.audit(s, actor, 'settings', st);
    this.touch(s);
  }
  addTA(s, actor, email, canPace) {
    this.requireOwner(s, actor);
    email = String(email || '').trim().toLowerCase();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('bad_email');
    if (email === s.owner) fail('bad_email');
    if (s.players[email]) { this.moveToTeam(s, email, null); delete s.players[email]; }
    s.tas[email] = { canPace: !!canPace };
    this.touch(s);
  }
  removeTA(s, actor, email) { this.requireOwner(s, actor); delete s.tas[email]; this.touch(s); }
  broadcast(s, actor, text) {
    this.requirePace(s, actor);
    text = String(text || '').trim().slice(0, 300);
    if (!text) return;
    s.broadcasts.push({ at: Date.now(), text });
    if (s.broadcasts.length > 20) s.broadcasts.shift();
    this.touch(s);
  }

  // ----- rounds -----
  startGame(s, actor, quiet) {
    if (!quiet) this.requireOwner(s, actor);
    if (s.status !== 'lobby') fail('game_started');
    const used = s.teams.filter((t) => t.members.length);
    if (!used.length) fail('no_teams');
    if (s.mode === 'multi' && used.length < 1) fail('no_teams');
    s.teams = used;
    s.teams.forEach((t, i) => { t.n = i + 1; t.color = i % TEAM_COLORS; });
    s.settings.teamCount = s.teams.length;
    s.status = 'running';
    this.dropMarkets(s.id);
    this.run(s).teamRounds = s.teams.map(() => []);
    if (s.mode === 'multi') this.openRound(s);
    else s.teams.forEach((t, i) => this.openTeamRound(s, i));
    this.audit(s, actor, 'start', { teams: s.teams.map((t) => ({ id: t.id, name: t.name, members: t.members })) });
    this.touch(s);
  }
  timerMs(s) { return s.settings.timerMin ? s.settings.timerMin * 60000 : null; }
  initialDraft(s, prev) {
    if (prev) { const d = clone(prev); d.equity = 0; d.debt = 0; d.capacityAdd = 0; d.trial = false; d.responses = {}; return d; }
    const d = E.blankDecision(); d.primary = null; d.price = 6000; return d;
  }
  openRound(s) {
    const m = this.marketFor(s);
    s.phase = m.over ? 'finished' : 'deciding';
    if (m.over) { s.status = 'finished'; s.deadline = null; return; }
    const run = this.run(s);
    const prev = run.rounds[run.rounds.length - 1];
    // Teams in administration cannot act, so they count as submitted
    s.teams.forEach((t, i) => { t.submitted = !!m.teams[i].admin; t.draft = this.initialDraft(s, prev && prev[i]); t.draftRev++; });
    s.paused = false; s.remainingMs = null;
    s.deadline = this.timerMs(s) ? Date.now() + this.timerMs(s) : null;
  }
  openTeamRound(s, i) {
    const t = s.teams[i], m = this.marketFor(s, i);
    if (m.over) { t.phase = 'finished'; t.deadline = null; this.checkAllFinished(s); return; }
    const prev = (this.run(s).teamRounds[i] || []).slice(-1)[0];
    t.phase = 'deciding'; t.submitted = false; t.draft = this.initialDraft(s, prev); t.draftRev++;
    t.deadline = this.timerMs(s) ? Date.now() + this.timerMs(s) : null;
  }
  checkAllFinished(s) { if (s.mode === 'single' && s.teams.every((t) => t.phase === 'finished')) { s.status = 'finished'; s.phase = 'finished'; } }

  teamOf(s, email) { const p = s.players[email]; return p && p.teamId ? s.teams.findIndex((t) => t.id === p.teamId) : -1; }
  deciding(s, i) { return s.mode === 'multi' ? s.phase === 'deciding' : s.teams[i].phase === 'deciding'; }

  setDraft(s, email, path, value) {
    const i = this.teamOf(s, email); if (i < 0) fail('no_team');
    const t = s.teams[i];
    if (s.status !== 'running' || !this.deciding(s, i)) fail('not_deciding');
    if (s.paused) fail('paused');
    if (t.submitted) fail('submitted');
    const d = t.draft || (t.draft = this.initialDraft(s));
    const NUM = E.SPEND_KEYS.concat(['price', 'capacityAdd', 'equity', 'debt']);
    if (NUM.includes(path)) d[path] = clamp(Math.round(+value || 0), 0, 1e8);
    else if (path === 'trial') d.trial = !!value;
    else if (path === 'targets') {
      const v = Array.isArray(value) ? value.map(Number).filter((x) => Number.isInteger(x) && x >= 0 && x < E.NCELL) : [];
      const u = v.filter((x, k) => v.indexOf(x) === k).slice(0, 3);
      d.primary = u.length ? u[0] : null; d.secondary = u.slice(1);
    } else if (path.startsWith('responses.')) {
      const type = path.slice(10);
      if (!E.EVENT_RESPONSES[type]) fail('bad_path');
      d.responses = d.responses || {};
      d.responses[type] = String(value).slice(0, 20);
    } else fail('bad_path');
    t.draftRev++;
    return t;
  }
  setReflection(s, email, k, text) {
    const i = this.teamOf(s, email); if (i < 0) fail('no_team');
    const t = s.teams[i];
    t.reflection[clamp(+k || 0, 0, 2)] = String(text || '').slice(0, 4000);
    this.touch(s);
    return t;
  }
  // Locked levers and sanity limits applied to whatever the team drafted
  finalDecision(s, i, g) {
    const d = E.sanitizeDecision(s.teams[i].draft || {});
    if (d.primary == null) d.primary = E.cellIdx(0, 1);
    if (s.settings.unlocks) for (const k of Object.keys(E.UNLOCK)) if (E.UNLOCK[k] > g.round && k in d) d[k] = k === 'trial' ? false : 0;
    return d;
  }
  submit(s, email, on) {
    const i = this.teamOf(s, email); if (i < 0) fail('no_team');
    const t = s.teams[i];
    if (t.captain !== email) fail('captain_only');
    if (s.status !== 'running' || !this.deciding(s, i)) fail('not_deciding');
    if (s.paused) fail('paused');
    if (on) {
      const g = this.teamState(s, i);
      if (!g.admin) {
        if (!t.draft || t.draft.primary == null) fail('no_target');
        const b = E.budget(g, this.finalDecision(s, i, g)); if (!b.ok) fail('over_budget');
      }
    }
    t.submitted = !!on;
    this.audit(s, email, on ? 'submit' : 'unsubmit', { team: t.id, round: this.teamState(s, i).round, draft: on ? t.draft : undefined });
    if (on && s.mode === 'single') { this.runTeamRound(s, i, email); return; }
    if (on && s.mode === 'multi' && s.settings.autoRun && s.teams.every((x) => x.submitted)) { this.runRound(s, 'auto'); return; }
    this.touch(s);
  }
  runRound(s, actor) {
    if (actor !== 'auto' && actor !== 'timer') this.requirePace(s, actor);
    if (s.mode !== 'multi' || s.phase !== 'deciding') fail('not_deciding');
    const m = this.marketFor(s);
    const decs = s.teams.map((t, i) => this.finalDecision(s, i, m.teams[i]));
    const recs = E.simulateMarketRound(m, decs);
    const run = this.run(s);
    run.rounds.push(decs);
    this.markets.set(`${s.id}:${s.activeRun}:m:${run.rounds.length}`, m);
    this.markets.delete(`${s.id}:${s.activeRun}:m:${run.rounds.length - 1}`);
    s.phase = m.over ? 'finished' : 'results';
    if (m.over) s.status = 'finished';
    s.deadline = null; s.paused = false;
    this.audit(s, actor, 'round', { run: run.id, round: recs[0].round, unsubmitted: s.teams.filter((t) => !t.submitted).map((t) => t.id),
      decisions: decs, outputs: recs.map(auditOut) });
    this.touch(s);
  }
  runTeamRound(s, i, actor) {
    const m = this.marketFor(s, i), g = m.teams[0];
    const dec = this.finalDecision(s, i, g);
    const rec = E.simulateMarketRound(m, [dec])[0];
    const run = this.run(s);
    (run.teamRounds[i] = run.teamRounds[i] || []).push(dec);
    this.markets.set(`${s.id}:${s.activeRun}:t${i}:${run.teamRounds[i].length}`, m);
    this.markets.delete(`${s.id}:${s.activeRun}:t${i}:${run.teamRounds[i].length - 1}`);
    const t = s.teams[i];
    t.phase = m.over ? 'finished' : 'results'; t.deadline = null;
    this.checkAllFinished(s);
    this.audit(s, actor, 'round', { run: run.id, team: t.id, round: rec.round, decision: dec, output: auditOut(rec) });
    this.touch(s);
  }
  nextRound(s, actor) {
    if (s.mode === 'multi') {
      this.requirePace(s, actor);
      if (s.phase !== 'results') fail('not_results');
      this.openRound(s);
    } else {
      const i = this.teamOf(s, actor); if (i < 0) fail('no_team');
      const t = s.teams[i];
      if (t.captain !== actor) fail('captain_only');
      if (t.phase !== 'results') fail('not_results');
      if (s.paused) fail('paused');
      this.openTeamRound(s, i);
    }
    this.touch(s);
  }
  pause(s, actor, on) {
    this.requirePace(s, actor);
    if (on && !s.paused) {
      s.paused = true;
      s.remainingMs = s.deadline ? Math.max(0, s.deadline - Date.now()) : null; s.deadline = null;
      s.teams.forEach((t) => { t.remainingMs = t.deadline ? Math.max(0, t.deadline - Date.now()) : null; t.deadline = null; });
    } else if (!on && s.paused) {
      s.paused = false;
      if (s.remainingMs != null) s.deadline = Date.now() + s.remainingMs; s.remainingMs = null;
      s.teams.forEach((t) => { if (t.remainingMs != null) t.deadline = Date.now() + t.remainingMs; t.remainingMs = null; });
    }
    this.audit(s, actor, on ? 'pause' : 'resume', {});
    this.touch(s);
  }
  extend(s, actor, minutes) {
    this.requirePace(s, actor);
    const ms = clamp(+minutes || 1, 1, 30) * 60000;
    if (s.paused) { if (s.remainingMs != null) s.remainingMs += ms; }
    else if (s.mode === 'multi') s.deadline = (s.deadline && s.deadline > Date.now() ? s.deadline : Date.now()) + ms;
    else s.teams.forEach((t) => { if (t.phase === 'deciding') t.deadline = (t.deadline && t.deadline > Date.now() ? t.deadline : Date.now()) + ms; });
    this.touch(s);
  }
  // Rewind every team to the start of round k. The old run is kept; the new one is practice unless told otherwise.
  rewind(s, actor, k, practice) {
    this.requireOwner(s, actor);
    if (s.status === 'lobby') fail('not_started');
    const old = this.run(s);
    k = clamp(Math.round(+k || 1), 1, s.settings.rounds);
    const nr = { id: s.runs.length + 1, label: 'Run ' + (s.runs.length + 1), practice: practice !== false, createdAt: Date.now(), fromRound: k,
      rounds: old.rounds.slice(0, k - 1), teamRounds: (old.teamRounds || []).map((r) => (r || []).slice(0, k - 1)) };
    s.runs.push(nr);
    s.activeRun = s.runs.length - 1;
    s.status = 'running';
    this.dropMarkets(s.id);
    if (s.mode === 'multi') {
      this.openRound(s);
      const redo = old.rounds[k - 1];
      if (redo) s.teams.forEach((t, i) => { t.draft = clone(redo[i]); t.draftRev++; });
    } else s.teams.forEach((t, i) => this.openTeamRound(s, i));
    this.audit(s, actor, 'rewind', { toRound: k, practice: nr.practice, newRun: nr.id });
    this.touch(s);
  }
  setRunPractice(s, actor, runIdx, practice) {
    this.requireOwner(s, actor);
    const r = s.runs[runIdx]; if (!r) fail('not_found');
    r.practice = !!practice;
    this.touch(s);
  }
  scoredRunIndex(s) { for (let i = s.runs.length - 1; i >= 0; i--) if (!s.runs[i].practice) return i; return s.activeRun; }
  endGame(s, actor) {
    this.requireOwner(s, actor);
    s.status = 'finished'; s.phase = 'finished'; s.deadline = null;
    s.teams.forEach((t) => { t.phase = 'finished'; t.deadline = null; });
    this.audit(s, actor, 'end', {});
    this.touch(s);
  }
  async deleteSession(s, actor) {
    this.requireOwner(s, actor);
    this.sessions.delete(s.id); this.dropMarkets(s.id);
    clearTimeout(this.saveTimers.get(s.id)); this.saveTimers.delete(s.id);
    await this.store.deleteSession(s.id);
  }

  // Timers: run the round when time is up, if the instructor chose that
  tick() {
    const now = Date.now();
    for (const s of this.sessions.values()) {
      if (s.status !== 'running' || s.paused || s.mode !== 'multi' || s.phase !== 'deciding') continue;
      if (s.settings.runOnTimeout && s.deadline && s.deadline <= now) {
        try { this.runRound(s, 'timer'); } catch (e) { console.error('timer run failed', e.message); }
      }
    }
  }

  // ---------- views ----------
  teamPublic(s, t) { return { id: t.id, n: t.n, name: t.name, color: t.color, captain: t.captain, members: t.members.map((e) => ({ email: e, name: (s.players[e] || {}).name || e })) }; }
  sessionPublic(s, role) {
    const o = { id: s.id, code: s.code, name: s.name, kind: s.kind, mode: s.mode, status: s.status, phase: s.phase, paused: s.paused,
      deadline: s.deadline, remainingMs: s.remainingMs, owner: s.owner, ownerName: s.ownerName, updatedAt: s.updatedAt,
      run: { idx: s.activeRun, id: this.run(s).id, label: this.run(s).label, practice: this.run(s).practice, fromRound: this.run(s).fromRound },
      broadcasts: s.broadcasts.slice(-5) };
    const st = Object.assign({}, s.settings);
    if (role !== 'owner' && role !== 'ta') { delete st.seed; delete st.competitor; delete st.regulation; delete st.funding; }
    o.settings = st;
    return o;
  }
  // What the client engine needs to preview budgets and events for this team, without revealing future events
  clientTeamState(g) {
    const sc = g.schedule, r = g.round;
    const schedule = {
      competitor: sc.competitor && r >= sc.competitor.round ? sc.competitor : null,
      regulation: sc.regulation && sc.regulation.round === r ? sc.regulation : null,
      funding: sc.funding && sc.funding.round === r ? sc.funding : null,
    };
    const keys = ['idx', 'round', 'over', 'cash', 'debtBal', 'bridgeBal', 'ownership', 'capacity', 'cumOutput', 'attr', 'eco', 'univHist', 'N', 'backlog',
      'churned', 'lastRevenue', 'lastFill', 'admin', 'primaryStreak', 'lastPrimaryV', 'fx', 'firedEvents', 'pendingFailure', 'chasmRound'];
    const o = {}; keys.forEach((k) => { o[k] = g[k]; });
    o.schedule = schedule;
    return o;
  }
  marketSummary(s) {
    // Each team's active sites after every round, plus market totals per cell (no rival decisions)
    if (s.status === 'lobby') return null;
    if (s.mode === 'multi') {
      const m = this.marketFor(s);
      return { P: m.P, rounds: m.history.length, NT: m.history.map((h) => h.NT), NTnow: sumCells(m.teams.map((g) => g.N)),
        teams: s.teams.map((t, i) => ({ id: t.id, active: m.teams[i].history.map((h) => h.active), adoption: m.teams[i].history.map((h) => h.adoption),
          stage: (m.teams[i].history.slice(-1)[0] || {}).stage || 'introduction', N: m.teams[i].N })) };
    }
    return { P: this.marketFor(s, 0).P, teams: s.teams.map((t, i) => { const g = this.teamState(s, i); return { id: t.id, active: g.history.map((h) => h.active),
      adoption: g.history.map((h) => h.adoption), stage: (g.history.slice(-1)[0] || {}).stage || 'introduction' }; }) };
  }
  viewFor(s, email) {
    const role = this.roleIn(s, email);
    if (!role) fail('not_member');
    const v = { now: Date.now(), role, session: this.sessionPublic(s, role), teams: s.teams.map((t) => this.teamPublic(s, t)),
      players: Object.keys(s.players).map((e) => ({ email: e, name: s.players[e].name, teamId: s.players[e].teamId })) };
    if (s.status !== 'lobby') v.market = this.marketSummary(s);
    if (role === 'player') {
      const i = this.teamOf(s, email);
      if (i >= 0) v.myTeam = this.teamFull(s, i, true);
    } else {
      v.tas = Object.keys(s.tas).map((e) => ({ email: e, canPace: s.tas[e].canPace }));
      v.runs = s.runs.map((r, i) => ({ idx: i, id: r.id, label: r.label, practice: r.practice, fromRound: r.fromRound, createdAt: r.createdAt,
        rounds: s.mode === 'multi' ? r.rounds.length : Math.max(0, ...(r.teamRounds || []).map((x) => (x || []).length)) }));
      v.scoredRun = this.scoredRunIndex(s);
      if (s.status !== 'lobby') v.allTeams = s.teams.map((t, i) => this.teamFull(s, i, false));
      if (role === 'owner') v.settingsFull = s.settings;
    }
    return v;
  }
  teamFull(s, i, forPlayer) {
    const t = s.teams[i];
    const o = Object.assign(this.teamPublic(s, t), { submitted: t.submitted, draft: t.draft, draftRev: t.draftRev, reflection: t.reflection,
      phase: s.mode === 'multi' ? s.phase : t.phase, deadline: s.mode === 'multi' ? s.deadline : t.deadline,
      remainingMs: s.mode === 'multi' ? s.remainingMs : t.remainingMs });
    if (s.status !== 'lobby') {
      const g = this.teamState(s, i);
      o.state = this.clientTeamState(g);
      o.P = g.P;
      o.history = g.history.map(slimRec);
      o.events = (s.mode === 'multi' ? s.phase === 'deciding' : t.phase === 'deciding') ? E.eventsForRound(g) : [];
      o.score = E.score(g);
    }
    return o;
  }

  // ---------- export ----------
  exportRows(s, onlyTeamIdx) {
    const rows = [];
    s.runs.forEach((run, ri) => {
      const markets = s.mode === 'multi' ? [E.replay(s.settings, s.teams.length, run.rounds)] : s.teams.map((t, i) => E.replay(s.settings, 1, (run.teamRounds[i] || []).map((d) => [d])));
      s.teams.forEach((t, i) => {
        if (onlyTeamIdx != null && i !== onlyTeamIdx) return;
        const g = s.mode === 'multi' ? markets[0].teams[i] : markets[i].teams[0];
        g.history.forEach((h) => rows.push({ run: run.id, practice: run.practice, scored: ri === this.scoredRunIndex(s), team: t, rec: h }));
      });
    });
    return rows;
  }
}

function sumCells(arrs) { const out = new Array(E.NCELL).fill(0); arrs.forEach((a) => a.forEach((x, i) => { out[i] += x; })); return out; }
function auditOut(r) {
  return { active: Math.round(r.active), adoption: r.adoption, demand: Math.round(r.demand), sold: Math.round(r.sold), cashEnd: Math.round(r.cashEnd),
    failed: r.failed, stage: r.stage, events: r.events, drivers: r.drivers };
}
function slimRec(r) {
  const o = Object.assign({}, r);
  delete o.cellFit; delete o.cellShare;
  return o;
}

module.exports = { Game, GameError, normCode, cleanSettings };
