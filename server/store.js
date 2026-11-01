/* Persistence. Postgres when DATABASE_URL is set (Render); JSON files otherwise (local testing).
 * Sessions are stored as one JSON document each; instructors and the audit log have their own tables. */
'use strict';
const fs = require('fs');
const path = require('path');

function pgStore(url) {
  const { Pool } = require('pg');
  const ssl = /localhost|127\.0\.0\.1/.test(url) ? false : { rejectUnauthorized: false };
  const pool = new Pool({ connectionString: url, ssl, max: 5 });
  return {
    kind: 'postgres',
    async init() {
      await pool.query(`
        CREATE TABLE IF NOT EXISTS sessions (
          id TEXT PRIMARY KEY, code TEXT UNIQUE NOT NULL, owner TEXT NOT NULL,
          data JSONB NOT NULL, created_at TIMESTAMPTZ DEFAULT now(), updated_at TIMESTAMPTZ DEFAULT now());
        CREATE INDEX IF NOT EXISTS sessions_owner ON sessions(owner);
        CREATE TABLE IF NOT EXISTS instructors (
          email TEXT PRIMARY KEY, added_by TEXT, added_at TIMESTAMPTZ DEFAULT now());
        CREATE TABLE IF NOT EXISTS audit (
          id BIGSERIAL PRIMARY KEY, session_id TEXT, at TIMESTAMPTZ DEFAULT now(), actor TEXT, type TEXT, payload JSONB);
        CREATE INDEX IF NOT EXISTS audit_session ON audit(session_id, id);
        CREATE TABLE IF NOT EXISTS players (
          email TEXT PRIMARY KEY, name TEXT, lang TEXT, updated_at TIMESTAMPTZ DEFAULT now());`);
    },
    async getSession(id) { const r = await pool.query('SELECT data FROM sessions WHERE id=$1', [id]); return r.rows[0] ? r.rows[0].data : null; },
    async getSessionByCode(code) { const r = await pool.query('SELECT data FROM sessions WHERE code=$1', [code]); return r.rows[0] ? r.rows[0].data : null; },
    async saveSession(s) {
      await pool.query(`INSERT INTO sessions (id, code, owner, data, updated_at) VALUES ($1,$2,$3,$4, now())
        ON CONFLICT (id) DO UPDATE SET data=EXCLUDED.data, updated_at=now()`, [s.id, s.code, s.owner, s]);
    },
    async deleteSession(id) { await pool.query('DELETE FROM sessions WHERE id=$1', [id]); await pool.query('DELETE FROM audit WHERE session_id=$1', [id]); },
    async listSessionsFor(email) {
      const r = await pool.query(`SELECT data FROM sessions WHERE owner=$1 OR data->'tas' ? $1 OR data->'players' ? $1 ORDER BY updated_at DESC LIMIT 200`, [email]);
      return r.rows.map((x) => x.data);
    },
    async listInstructors() { const r = await pool.query('SELECT email, added_by, added_at FROM instructors ORDER BY email'); return r.rows; },
    async addInstructor(email, by) { await pool.query('INSERT INTO instructors (email, added_by) VALUES ($1,$2) ON CONFLICT DO NOTHING', [email, by]); },
    async removeInstructor(email) { await pool.query('DELETE FROM instructors WHERE email=$1', [email]); },
    async audit(sessionId, actor, type, payload) { await pool.query('INSERT INTO audit (session_id, actor, type, payload) VALUES ($1,$2,$3,$4)', [sessionId, actor, type, payload || {}]); },
    async getAudit(sessionId) { const r = await pool.query('SELECT at, actor, type, payload FROM audit WHERE session_id=$1 ORDER BY id', [sessionId]); return r.rows; },
    async getPlayer(email) { const r = await pool.query('SELECT name, lang FROM players WHERE email=$1', [email]); return r.rows[0] || null; },
    async savePlayer(email, name, lang) {
      await pool.query(`INSERT INTO players (email, name, lang, updated_at) VALUES ($1,$2,$3, now())
        ON CONFLICT (email) DO UPDATE SET name=COALESCE(EXCLUDED.name, players.name), lang=COALESCE(EXCLUDED.lang, players.lang), updated_at=now()`, [email, name, lang]);
    },
    async deletePlayerData(email) { await pool.query('DELETE FROM players WHERE email=$1', [email]); },
  };
}

function fileStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const f = (name) => path.join(dir, name);
  const readJSON = (name, dflt) => { try { return JSON.parse(fs.readFileSync(f(name), 'utf8')); } catch (e) { return dflt; } };
  const writeJSON = (name, v) => { const tmp = f(name + '.tmp'); fs.writeFileSync(tmp, JSON.stringify(v)); fs.renameSync(tmp, f(name)); };
  const sessFile = (id) => 'session-' + id.replace(/[^a-zA-Z0-9-]/g, '') + '.json';
  return {
    kind: 'files',
    async init() {},
    async getSession(id) { return readJSON(sessFile(id), null); },
    async getSessionByCode(code) {
      for (const n of fs.readdirSync(dir)) if (n.startsWith('session-') && n.endsWith('.json')) { const s = readJSON(n, null); if (s && s.code === code) return s; }
      return null;
    },
    async saveSession(s) { s.updatedAt = Date.now(); writeJSON(sessFile(s.id), s); },
    async deleteSession(id) { try { fs.unlinkSync(f(sessFile(id))); } catch (e) { /* gone */ } },
    async listSessionsFor(email) {
      const out = [];
      for (const n of fs.readdirSync(dir)) if (n.startsWith('session-') && n.endsWith('.json')) {
        const s = readJSON(n, null);
        if (s && (s.owner === email || (s.tas || {})[email] || (s.players || {})[email])) out.push(s);
      }
      return out.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    },
    async listInstructors() { return readJSON('instructors.json', []); },
    async addInstructor(email, by) { const l = readJSON('instructors.json', []); if (!l.some((x) => x.email === email)) l.push({ email, added_by: by, added_at: new Date().toISOString() }); writeJSON('instructors.json', l); },
    async removeInstructor(email) { writeJSON('instructors.json', readJSON('instructors.json', []).filter((x) => x.email !== email)); },
    async audit(sessionId, actor, type, payload) { fs.appendFileSync(f('audit.jsonl'), JSON.stringify({ session_id: sessionId, at: new Date().toISOString(), actor, type, payload }) + '\n'); },
    async getAudit(sessionId) {
      try { return fs.readFileSync(f('audit.jsonl'), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((x) => x.session_id === sessionId); } catch (e) { return []; }
    },
    async getPlayer(email) { return readJSON('players.json', {})[email] || null; },
    async savePlayer(email, name, lang) { const p = readJSON('players.json', {}); p[email] = Object.assign(p[email] || {}, name ? { name } : {}, lang ? { lang } : {}); writeJSON('players.json', p); },
    async deletePlayerData(email) { const p = readJSON('players.json', {}); delete p[email]; writeJSON('players.json', p); },
  };
}

module.exports = function makeStore() {
  if (process.env.DATABASE_URL) return pgStore(process.env.DATABASE_URL);
  return fileStore(process.env.DATA_DIR || path.join(__dirname, '..', 'data'));
};
