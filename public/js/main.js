/* App shell: sign-in, routing, socket connection, home, setup and About screens. */
(function () {
  'use strict';
  const E = window.ChasmEngine;
  const MC = window.MC;
  const t = MC.t, esc = MC.esc;
  const app = document.getElementById('app');
  const LANG_KEY = 'mite-lang';

  // ---------------- state ----------------
  const S = Object.assign(MC.S, {
    cfg: null, me: null, isInstructor: false, isSuperAdmin: false,
    route: { name: 'home' }, view: null, sessions: [], socket: null, connected: false,
    ui: { tab: 'targeting', staffTab: 'live', briefStep: 0, eventAck: {}, debriefTeam: null, compare: [null, null], setup: null, setupFor: null, joinErr: '', admin: null, aboutBack: null, confirm: null },
    clockOffset: 0,
  });
  MC.render = render;

  function storedLang() { try { return localStorage.getItem(LANG_KEY); } catch (e) { return null; } }
  function storeLang(l) { try { localStorage.setItem(LANG_KEY, l); } catch (e) { /* storage off: still works */ } }

  // ---------------- API ----------------
  async function api(path, body) {
    const r = await fetch(path, { method: body ? 'POST' : 'GET', headers: body ? { 'Content-Type': 'application/json' } : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw Object.assign(new Error(j.error || 'error'), { code: j.error });
    return j;
  }
  MC.emit = function (ev, arg) {
    return new Promise((resolve) => {
      if (!S.socket) return resolve({ ok: false, error: 'offline' });
      S.socket.timeout(15000).emit(ev, arg || {}, (err, res) => resolve(err ? { ok: false, error: 'timeout' } : res));
    });
  };
  // Run a socket action and show any error in plain words
  MC.act = async function (ev, arg, okMsg) {
    const r = await MC.emit(ev, arg);
    if (!r.ok) { MC.toast(t('err.' + r.error) !== 'err.' + r.error ? t('err.' + r.error) : t('err.generic')); return r; }
    if (r.view) applyView(r.view);
    if (okMsg) MC.toast(okMsg);
    return r;
  };

  // ---------------- routing ----------------
  function parseHash() {
    const h = location.hash.replace(/^#\/?/, '');
    if (h.startsWith('s/')) return { name: 'session', id: h.slice(2) };
    if (h === 'about') return { name: 'about' };
    if (h === 'new') return { name: 'setup' };
    if (h === 'admin') return { name: 'admin' };
    return { name: 'home' };
  }
  MC.go = function (hash) { if (location.hash !== hash) location.hash = hash; else onRoute(); };
  window.addEventListener('hashchange', onRoute);
  async function onRoute() {
    const r = parseHash();
    if (r.name === 'about' && S.route.name !== 'about') S.ui.aboutBack = location.hash === '#about' ? (S.ui.lastHash || '#/') : null;
    S.route = r;
    MC.resetTerms();
    if (!S.me && r.name !== 'about') return render();
    if (r.name === 'session') {
      if (!S.view || S.view.session.id !== r.id) {
        S.view = null; render();
        const res = await MC.emit('session:open', { id: r.id });
        if (!res.ok) { MC.toast(t('err.' + res.error)); return MC.go('#/'); }
        applyView(res.view, true);
      } else render();
    } else {
      if (S.view && r.name !== 'about') { MC.emit('session:leave'); S.view = null; }
      if (r.name === 'home') loadSessions();
      if (r.name === 'admin') loadAdmin();
      render();
    }
    if (r.name !== 'about') S.ui.lastHash = location.hash || '#/';
    window.scrollTo(0, 0);
  }

  // ---------------- view updates ----------------
  function applyView(v, fresh) {
    const prev = S.view;
    S.view = v;
    if (MC.reapplyPending) MC.reapplyPending();
    S.clockOffset = v.now ? v.now - Date.now() : 0;
    if (fresh || !prev) { S.ui.tab = 'targeting'; S.ui.staffTab = v.role === 'player' ? 'live' : (v.session.status === 'lobby' ? 'lobby' : v.session.status === 'finished' ? 'debrief' : 'live'); }
    if (S.route.name === 'session') MC.renderKeepFocus();
  }
  MC.applyView = applyView;
  MC.renderKeepFocus = function () {
    const a = document.activeElement;
    const id = a && a.id, sel = a && typeof a.selectionStart === 'number' ? [a.selectionStart, a.selectionEnd] : null;
    const y = window.scrollY;
    render();
    if (id) { const el = document.getElementById(id); if (el) { el.focus({ preventScroll: true }); if (sel && el.setSelectionRange) try { el.setSelectionRange(sel[0], sel[1]); } catch (e) { /* not a text field */ } } }
    window.scrollTo(0, y);
  };

  // ---------------- socket ----------------
  function connect() {
    if (S.socket) return;
    const sock = window.io({ withCredentials: true, transports: ['websocket', 'polling'] });
    S.socket = sock;
    sock.on('connect', async () => {
      S.connected = true;
      // Rejoin after a dropped connection with state intact
      if (S.route.name === 'session') {
        const res = await MC.emit('session:open', { id: S.route.id });
        if (res.ok) applyView(res.view); else MC.go('#/');
      } else if (S.route.name === 'home') loadSessions();
      renderStatus();
    });
    sock.on('disconnect', () => { S.connected = false; renderStatus(); });
    sock.on('connect_error', (e) => { if (e && e.message === 'signed_out') { S.me = null; sock.close(); S.socket = null; render(); } });
    sock.on('view', (v) => { if (S.route.name === 'session' && S.route.id === v.session.id) applyView(v); });
    sock.on('kicked', () => { MC.toast(t('err.not_member')); MC.go('#/'); });
    sock.on('draft', (d) => {
      const team = S.view && S.view.myTeam;
      if (!team || team.id !== d.teamId || d.draftRev < (team.draftRev || 0)) return;
      team.draft = d.draft; team.draftRev = d.draftRev;
      if (MC.reapplyPending) MC.reapplyPending();
      MC.renderKeepFocus();
    });
    sock.on('reflection', (d) => {
      const team = S.view && S.view.myTeam; if (!team || team.id !== d.teamId) return;
      team.reflection = d.reflection;
      const a = document.activeElement;
      d.reflection.forEach((txt, k) => { const el = document.getElementById('refl-' + k); if (el && el !== a) el.value = txt; });
    });
    sock.on('staff:draft', (d) => {
      const v = S.view; if (!v || !v.allTeams) return;
      const tm = v.allTeams.find((x) => x.id === d.teamId);
      if (tm) { tm.draft = d.draft; if (S.ui.staffTab === 'live' && !staffTimer) staffTimer = setTimeout(() => { staffTimer = null; if (S.ui.staffTab === 'live') MC.renderKeepFocus(); }, 1000); }
    });
  }
  let staffTimer = null;
  function renderStatus() {
    const el = document.getElementById('conn'); if (!el) return;
    el.hidden = S.connected || !S.me;
  }

  async function loadSessions() {
    if (!S.socket) return;
    const r = await MC.emit('sessions:list');
    if (r.ok) { S.sessions = r.sessions; if (S.route.name === 'home') render(); }
  }
  async function loadAdmin() {
    const r = await MC.emit('admin:instructors');
    if (r.ok) { S.ui.admin = r; render(); } else if (S.route.name === 'admin') MC.go('#/');
  }

  // ---------------- language ----------------
  async function setLang(l) {
    MC.setLang(l); storeLang(l);
    if (S.me) api('/api/me/lang', { lang: l }).catch(() => {});
    if (S.route.name === 'home' && !S.me) renderGoogleButton();
    MC.renderKeepFocus();
  }
  function langSwitch() {
    return `<div class="langsw" role="group" aria-label="${esc(t('lang.switch'))}">
      <button data-act="lang" data-v="en" aria-pressed="${MC.lang === 'en'}" lang="en">EN</button><button data-act="lang" data-v="id" aria-pressed="${MC.lang === 'id'}" lang="id">ID</button></div>`;
  }

  // ---------------- top bar ----------------
  MC.topbar = function (extra) {
    const v = S.view;
    let crumbs = '';
    if (S.route.name === 'session' && v) crumbs = `<span class="pill">${esc(v.session.kind === 'practice' ? t('home.practiceTitle') : (v.session.name || t('session.untitled')))}</span>`;
    return `<header class="topbar no-print"><a class="brand" href="#/" aria-label="${esc(t('nav.home'))}">${MC.logo()}<span>Chasm &amp; Curve</span></a>${crumbs}
      <div class="spacer"></div>${extra || ''}
      <span class="pill danger" id="conn" ${S.connected || !S.me ? 'hidden' : ''}>${esc(t('common.reconnecting'))}</span>
      <a class="btn ghost small" href="#about">${esc(t('nav.about'))}</a>${langSwitch()}
      ${S.me ? `<button class="btn ghost small" data-act="menu" aria-haspopup="true">${esc(t('nav.menu'))}</button>` : ''}</header>
      ${S.ui.menuOpen && S.me ? `<div class="menu no-print" role="menu"><div class="small muted">${esc(S.me.name)} · ${esc(S.me.email)}</div>
        <a class="btn ghost small" href="#/" role="menuitem">${esc(t('nav.home'))}</a>
        ${S.isSuperAdmin ? `<a class="btn ghost small" href="#admin" role="menuitem">${esc(t('nav.admin'))}</a>` : ''}
        <button class="btn ghost small" data-act="signout" role="menuitem">${esc(t('nav.signout'))}</button></div>` : ''}`;
  };

  // ---------------- screens ----------------
  function render() {
    MC.clearCharts(); MC.resetTerms();
    document.title = t('app.title');
    let html;
    if (!S.cfg) html = `<main class="wrap"><p class="muted" style="padding:40px 0">${esc(t('common.loading'))}</p></main>`;
    else if (S.route.name === 'about') html = MC.renderAbout();
    else if (!S.me) html = renderSignIn();
    else if (S.route.name === 'setup') html = renderSetup();
    else if (S.route.name === 'admin') html = renderAdmin();
    else if (S.route.name === 'session') html = S.view ? (S.view.role === 'player' ? MC.renderPlayer() : MC.renderStaff()) : MC.topbar() + `<main class="wrap"><p class="muted">${esc(t('common.loading'))}</p></main>`;
    else html = renderHome();
    app.innerHTML = html;
    if (!S.me && S.route.name !== 'about') renderGoogleButton();
    if (S.route.name === 'home' && !S.me) MC.startHero(document.getElementById('hero'));
    if (MC.afterRender) MC.afterRender();
  }

  function renderSignIn() {
    return `${MC.topbar()}<main class="wrap">
      <section class="hero">
        <div>
          <p class="eyebrow">${esc(t('home.eyebrow'))}</p>
          <h1>${t('home.title')}</h1>
          <p class="lede">${esc(t('home.lede'))}</p>
          <div class="card stack" style="margin-top:24px;max-width:460px">
            <h3>${esc(t('signin.title'))}</h3>
            <p class="small muted">${esc(t('signin.body'))}</p>
            <div id="gbtn" style="min-height:44px"></div>
            ${!S.cfg.googleClientId ? `<p class="note warn small">${esc(t('signin.notConfigured'))}</p>` : ''}
            ${S.cfg.devLogin ? `<form id="dev-form" class="stack" style="border-top:1px dashed var(--line);padding-top:12px">
              <p class="small muted">${esc(t('signin.devNote'))}</p>
              <div class="row"><input class="input" id="dev-name" placeholder="${esc(t('signin.devName'))}" autocomplete="name"><input class="input" id="dev-email" placeholder="email@example.com" autocomplete="email"></div>
              <button class="btn" type="submit">${esc(t('signin.devButton'))}</button></form>` : ''}
          </div>
        </div>
        <canvas class="hero-canvas" id="hero" aria-hidden="true"></canvas>
      </section></main>`;
  }
  function renderGoogleButton() {
    const el = document.getElementById('gbtn');
    if (!el || !S.cfg || !S.cfg.googleClientId) return;
    const draw = () => {
      if (!window.google || !window.google.accounts) return setTimeout(draw, 200);
      window.google.accounts.id.initialize({ client_id: S.cfg.googleClientId, callback: onGoogle, ux_mode: 'popup' });
      el.innerHTML = '';
      window.google.accounts.id.renderButton(el, { theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', locale: MC.lang === 'id' ? 'id' : 'en' });
    };
    draw();
  }
  async function onGoogle(resp) {
    try { await api('/api/auth/google', { credential: resp.credential }); await afterSignIn(); }
    catch (e) { MC.toast(t('signin.failed')); }
  }
  async function afterSignIn() {
    const me = await api('/api/me');
    S.me = me.user; S.isInstructor = me.isInstructor; S.isSuperAdmin = me.isSuperAdmin;
    if (me.lang && !storedLang()) MC.setLang(me.lang);
    else if (S.me) api('/api/me/lang', { lang: MC.lang }).catch(() => {});
    if (S.me) connect();
    onRoute();
  }

  function renderHome() {
    const list = S.sessions || [];
    const mine = list.filter((x) => x.role === 'owner' || x.role === 'ta');
    const played = list.filter((x) => x.role === 'player');
    const statusPill = (st) => `<span class="pill ${st === 'running' ? 'teal' : st === 'finished' ? '' : 'gold'}">${esc(t('status.' + st))}</span>`;
    const row = (x) => `<a class="srow" href="#/s/${esc(x.id)}"><span class="stack" style="gap:2px;min-width:0"><b>${esc(x.kind === 'practice' ? t('home.practiceTitle') : (x.name || t('session.untitled')))}</b>
      <span class="small muted">${esc(x.kind === 'practice' ? t('home.practiceRow') : t('home.sessionRow', { code: fmtCode(x.code), teams: x.teams, players: x.players }))} · ${esc(t('mode.' + x.mode))}</span></span>${statusPill(x.status)}</a>`;
    return `${MC.topbar()}<main class="wrap stack" style="gap:24px">
      <div><p class="eyebrow">${esc(t('home.hello', { name: S.me.name }))}</p><h2>${esc(t('home.what'))}</h2></div>
      <section class="paths">
        <div class="card path">
          <p class="eyebrow">${esc(t('home.studentsEyebrow'))}</p><h3>${esc(t('home.joinTitle'))}</h3>
          <p>${esc(t('home.joinBody'))}</p>
          <form class="stack" id="join-form">
            <div class="field"><label for="join-code">${esc(t('home.code'))}</label><input class="input code" id="join-code" placeholder="ABC-123" autocomplete="off" spellcheck="false" maxlength="9"></div>
            ${S.ui.joinErr ? `<p class="err" role="alert">${esc(S.ui.joinErr)}</p>` : ''}
            <button class="btn primary" type="submit">${esc(t('home.joinButton'))}</button>
          </form>
        </div>
        <div class="card path">
          <p class="eyebrow">${esc(t('home.practiceEyebrow'))}</p><h3>${esc(t('home.practiceTitle'))}</h3>
          <p>${esc(t('home.practiceBody'))}</p>
          <button class="btn" data-act="practice">${esc(t('home.practiceButton'))}</button>
        </div>
        ${S.isInstructor ? `<div class="card path">
          <p class="eyebrow">${esc(t('home.instructorsEyebrow'))}</p><h3>${esc(t('home.createTitle'))}</h3>
          <p>${esc(t('home.createBody'))}</p>
          <a class="btn primary" href="#new">${esc(t('home.createButton'))}</a>
        </div>` : `<div class="card path"><p class="eyebrow">${esc(t('home.instructorsEyebrow'))}</p><h3>${esc(t('home.notInstructorTitle'))}</h3><p>${esc(t('home.notInstructorBody'))}</p></div>`}
      </section>
      ${mine.length ? `<section class="card stack"><h3>${esc(t('home.mySessions'))}</h3><div class="slist">${mine.map(row).join('')}</div></section>` : ''}
      ${played.length ? `<section class="card stack"><h3>${esc(t('home.myGames'))}</h3><div class="slist">${played.map(row).join('')}</div></section>` : ''}
      <section class="small muted row"><span>${esc(t('home.privacy'))}</span><button class="btn ghost small" data-act="delete-me">${esc(S.ui.confirm === 'delete-me' ? t('home.deleteConfirm') : t('home.deleteMe'))}</button></section>
    </main>`;
  }
  const fmtCode = (c) => String(c || '').slice(0, 3) + '-' + String(c || '').slice(3);
  MC.fmtCode = fmtCode;

  // ---------------- instructor setup ----------------
  function setupDefaults() {
    const d = JSON.parse(JSON.stringify(E.DEFAULT_SETTINGS));
    return Object.assign(d, { seed: Math.floor(Math.random() * 65536), lang: MC.lang, teamCount: 4, assign: 'self', autoRun: true, runOnTimeout: false, name: '', mode: 'multi' });
  }
  MC.openSetup = function (fromSession) {
    if (fromSession) { S.ui.setup = Object.assign(JSON.parse(JSON.stringify(S.view.settingsFull)), { name: S.view.session.name, mode: S.view.session.mode }); S.ui.setupFor = S.view.session.id; }
    else { S.ui.setup = setupDefaults(); S.ui.setupFor = null; }
  };
  function renderSetup() {
    if (!S.isInstructor) return MC.topbar() + `<main class="wrap"><p>${esc(t('err.not_instructor'))}</p></main>`;
    if (!S.ui.setup || S.ui.setupFor) MC.openSetup(false);
    return MC.topbar() + `<main class="wrap stack">${MC.setupForm(S.ui.setup, false)}</main>`;
  }
  MC.setupForm = function (s, editing) {
    const R = s.rounds;
    const opt = (vals, cur, lab) => vals.map((v) => `<option value="${v}" ${String(v) === String(cur) ? 'selected' : ''}>${esc(lab ? lab(v) : v)}</option>`).join('');
    const rounds = []; for (let r = 2; r <= R; r++) rounds.push(r);
    const P = E.buildParams(E.normalizeSettings(s));
    const presets = ['easy', 'standard', 'hard'];
    return `<div><p class="eyebrow">${esc(t('setup.eyebrow'))}</p><h2>${esc(editing ? t('setup.editTitle') : t('setup.title'))}</h2><p class="muted" style="margin-top:6px">${esc(t('setup.lede'))}</p></div>
      <div class="setup-grid">
        <div class="card stack">
          <h3>${esc(t('setup.session'))}</h3>
          <div class="field"><label for="st-name">${esc(t('setup.name'))}</label><input class="input" id="st-name" data-set="name" value="${esc(s.name || '')}" maxlength="80" placeholder="${esc(t('setup.namePh'))}"></div>
          <div class="field"><span class="lbl">${esc(t('setup.mode'))}</span><div class="seg" role="group">${['multi', 'single'].map((m) => `<button type="button" data-act="set-seg" data-k="mode" data-v="${m}" aria-pressed="${s.mode === m}" ${editing ? 'disabled' : ''}>${esc(t('mode.' + m))}</button>`).join('')}</div>
            <p class="small muted">${esc(t('mode.' + s.mode + '.desc'))}</p></div>
          <div class="row">
            <div class="field"><label for="st-teams">${esc(t('setup.teams'))}</label><select class="sel" id="st-teams" data-set="teamCount">${opt([1, 2, 3, 4, 5, 6], s.teamCount)}</select></div>
            <div class="field"><label for="st-lang">${esc(t('setup.lang'))}</label><select class="sel" id="st-lang" data-set="lang">${opt(['en', 'id'], s.lang, (v) => t('lang.' + v))}</select></div>
          </div>
          <div class="field"><span class="lbl">${esc(t('setup.assign'))}</span><div class="seg" role="group">${['self', 'instructor'].map((m) => `<button type="button" data-act="set-seg" data-k="assign" data-v="${m}" aria-pressed="${s.assign === m}">${esc(t('assign.' + m))}</button>`).join('')}</div></div>
        </div>
        <div class="card stack">
          <h3>${esc(t('setup.difficulty'))}</h3>
          <div class="field"><span class="lbl">${esc(t('setup.preset'))}</span><div class="seg" role="group">${presets.map((p) => `<button type="button" data-act="set-seg" data-k="preset" data-v="${p}" aria-pressed="${s.preset === p}">${esc(t('preset.' + p))}</button>`).join('')}</div>
            <p class="small muted">${esc(t('preset.' + s.preset + '.desc'))}</p></div>
          <div class="row">
            <div class="field"><label for="st-rounds">${esc(t('setup.rounds'))}</label><select class="sel" id="st-rounds" data-set="rounds">${opt([8, 9, 10, 11, 12], s.rounds)}</select></div>
            <div class="field"><label for="st-timer">${esc(t('setup.timer'))}</label><select class="sel" id="st-timer" data-set="timerMin">${opt([0, 4, 5, 6, 8, 10, 15], s.timerMin, (v) => (v ? t('setup.minutes', { n: v }) : t('common.off')))}</select></div>
            <div class="field"><label for="st-cash">${esc(t('setup.cash'))}</label><select class="sel" id="st-cash" data-set="startCashM">${opt([0, 4, 5, 6, 8, 10], s.startCashM, (v) => (v ? MC.fmtK(v * 1000) : t('setup.presetValue', { v: MC.fmtK(E.buildParams(Object.assign({}, E.normalizeSettings(s), { startCashM: 0 })).startCash) })))}</select></div>
          </div>
          <label class="check"><input type="checkbox" id="st-hints" data-set="hints" ${s.hints ? 'checked' : ''}><span><b>${esc(t('setup.hints'))}</b><br><span class="small muted">${esc(t('setup.hintsDesc'))}</span></span></label>
          <label class="check"><input type="checkbox" id="st-unlocks" data-set="unlocks" ${s.unlocks ? 'checked' : ''}><span><b>${esc(t('setup.unlocks'))}</b><br><span class="small muted">${esc(t('setup.unlocksDesc'))}</span></span></label>
        </div>
        <div class="card stack">
          <h3>${esc(t('setup.events'))}</h3>
          <label class="check"><input type="checkbox" id="st-comp" data-set="competitor.on" ${s.competitor.on ? 'checked' : ''}><span><b>${esc(t('setup.competitor'))}</b></span></label>
          <div class="row"><div class="field"><label for="st-comp-r">${esc(t('setup.round'))}</label><select class="sel" id="st-comp-r" data-set="competitor.round">${opt(rounds, s.competitor.round)}</select></div>
            <div class="field"><label for="st-comp-v">${esc(t('setup.vertical'))}</label><select class="sel" id="st-comp-v" data-set="competitor.vertical">${opt([0, 1, 2], s.competitor.vertical, (v) => MC.vName(v))}</select></div></div>
          <label class="check"><input type="checkbox" id="st-reg" data-set="regulation.on" ${s.regulation.on ? 'checked' : ''}><span><b>${esc(t('setup.regulation'))}</b></span></label>
          <div class="field"><label for="st-reg-r">${esc(t('setup.round'))}</label><select class="sel" id="st-reg-r" data-set="regulation.round">${opt(rounds, s.regulation.round)}</select></div>
          <div class="row"><div class="field"><label for="st-fund">${esc(t('setup.funding'))}</label><select class="sel" id="st-fund" data-set="funding.mode">${opt(['off', 'random', 'boom', 'winter'], s.funding.mode, (v) => t('funding.' + v))}</select></div>
            ${s.funding.mode === 'boom' || s.funding.mode === 'winter' ? `<div class="field"><label for="st-fund-r">${esc(t('setup.round'))}</label><select class="sel" id="st-fund-r" data-set="funding.round">${opt(rounds.slice(0, -1), s.funding.round)}</select></div>` : ''}</div>
          <label class="check"><input type="checkbox" id="st-fail" data-set="failures" ${s.failures ? 'checked' : ''}><span><b>${esc(t('setup.failures'))}</b><br><span class="small muted">${esc(t('setup.failuresDesc'))}</span></span></label>
        </div>
        <div class="card stack">
          <h3>${esc(t('setup.pacing'))}</h3>
          <label class="check"><input type="checkbox" id="st-auto" data-set="autoRun" ${s.autoRun ? 'checked' : ''}><span><b>${esc(t('setup.autoRun'))}</b><br><span class="small muted">${esc(t('setup.autoRunDesc'))}</span></span></label>
          <label class="check"><input type="checkbox" id="st-timeout" data-set="runOnTimeout" ${s.runOnTimeout ? 'checked' : ''}><span><b>${esc(t('setup.runOnTimeout'))}</b><br><span class="small muted">${esc(t('setup.runOnTimeoutDesc'))}</span></span></label>
          <label class="check"><input type="checkbox" id="st-rand" data-set="randomness" ${s.randomness ? 'checked' : ''}><span><b>${esc(t('setup.randomness'))}</b><br><span class="small muted">${esc(t('setup.randomnessDesc'))}</span></span></label>
          <div class="field"><label for="st-seed">${esc(t('setup.seed'))}</label><div class="row"><input class="input mono" id="st-seed" type="number" min="0" max="65535" value="${s.seed}" data-set="seed" style="max-width:140px"><button type="button" class="btn small" data-act="new-seed">${esc(t('setup.newSeed'))}</button></div>
            <p class="small muted">${esc(t('setup.seedDesc'))}</p></div>
        </div>
        <div class="card stack">
          <h3>${esc(t('setup.market'))}</h3>
          <p class="small muted">${esc(t('setup.marketDesc'))}</p>
          <div class="row">${[0, 1, 2].map((v) => `<div class="field"><label for="st-m${v}">${esc(MC.vShort(v))}</label><input class="input mono" id="st-m${v}" type="number" min="0" max="20000" step="10" data-set="marketK.${v}" value="${s.marketK[v] || ''}" placeholder="${E.VERTICALS[v].m / 1000}" style="max-width:120px"></div>`).join('')}</div>
          <div class="row">
            <div class="field"><label for="st-p0">${esc(t('setup.p0'))}</label><input class="input mono" id="st-p0" type="number" min="0" max="0.1" step="0.001" data-set="p0" value="${s.p0 || ''}" placeholder="${P.p0}" style="max-width:120px"></div>
            <div class="field"><label for="st-q0">${esc(t('setup.q0'))}</label><input class="input mono" id="st-q0" type="number" min="0" max="0.9" step="0.01" data-set="q0" value="${s.q0 || ''}" placeholder="${P.q0}" style="max-width:120px"></div>
          </div>
        </div>
      </div>
      <div class="row"><div class="spacer"></div>${editing ? `<button class="btn" data-act="setup-cancel">${esc(t('common.cancel'))}</button>` : `<a class="btn" href="#/">${esc(t('common.cancel'))}</a>`}
        <button class="btn primary" data-act="${editing ? 'setup-save' : 'setup-create'}">${esc(editing ? t('setup.save') : t('setup.create'))}</button></div>`;
  };
  function setPath(obj, p, val) { const ks = p.split('.'); let o = obj; for (let i = 0; i < ks.length - 1; i++) o = o[ks[i]]; o[ks[ks.length - 1]] = val; }

  function renderAdmin() {
    const a = S.ui.admin;
    if (!a) return MC.topbar() + `<main class="wrap"><p class="muted">${esc(t('common.loading'))}</p></main>`;
    return `${MC.topbar()}<main class="wrap stack">
      <div><p class="eyebrow">${esc(t('admin.eyebrow'))}</p><h2>${esc(t('admin.title'))}</h2><p class="muted">${esc(t('admin.lede'))}</p></div>
      <div class="card stack"><h3>${esc(t('admin.fixed'))}</h3><p class="small muted">${esc(t('admin.fixedDesc'))}</p>
        <ul>${a.superAdmins.map((e) => `<li class="mono">${esc(e)}</li>`).join('')}</ul></div>
      <div class="card stack"><h3>${esc(t('admin.added'))}</h3>
        <form class="row" id="admin-add"><input class="input" id="admin-email" type="email" placeholder="name@example.com" style="max-width:320px"><button class="btn primary" type="submit">${esc(t('admin.add'))}</button></form>
        ${a.instructors.length ? `<div class="tbl-wrap"><table class="data"><thead><tr><th>${esc(t('admin.email'))}</th><th>${esc(t('admin.by'))}</th><th></th></tr></thead><tbody>
          ${a.instructors.map((x) => `<tr><td>${esc(x.email)}</td><td>${esc(x.added_by || '')}</td><td><button class="btn ghost small" data-act="admin-remove" data-email="${esc(x.email)}">${esc(t('common.remove'))}</button></td></tr>`).join('')}</tbody></table></div>` : `<p class="muted small">${esc(t('admin.none'))}</p>`}
      </div></main>`;
  }

  // ---------------- events ----------------
  document.addEventListener('click', async (e) => {
    const el = e.target.closest('[data-act]');
    if (!el) { if (S.ui.menuOpen && !e.target.closest('.menu')) { S.ui.menuOpen = false; render(); } return; }
    const a = el.dataset.act;
    if (a !== 'menu' && S.ui.menuOpen) S.ui.menuOpen = false;
    switch (a) {
      case 'lang': setLang(el.dataset.v); return;
      case 'menu': S.ui.menuOpen = !S.ui.menuOpen; render(); return;
      case 'signout': await api('/api/auth/logout', {}); S.me = null; if (S.socket) { S.socket.close(); S.socket = null; } S.view = null; MC.go('#/'); render(); return;
      case 'practice': { el.disabled = true; const r = await MC.emit('practice:create', { lang: MC.lang }); if (r.ok) { S.ui.briefStep = 0; S.view = r.view; MC.go('#/s/' + r.id); } else MC.toast(t('err.' + r.error)); return; }
      case 'delete-me':
        if (S.ui.confirm !== 'delete-me') { S.ui.confirm = 'delete-me'; render(); return; }
        await api('/api/me/delete', {}); S.ui.confirm = null; S.me = null; if (S.socket) { S.socket.close(); S.socket = null; } MC.toast(t('home.deleted')); render(); return;
      case 'set-seg': S.ui.setup[el.dataset.k] = el.dataset.v; MC.renderKeepFocus(); return;
      case 'new-seed': S.ui.setup.seed = Math.floor(Math.random() * 65536); MC.renderKeepFocus(); return;
      case 'setup-create': {
        const s = S.ui.setup; el.disabled = true;
        const r = await MC.emit('session:create', { name: s.name, mode: s.mode, settings: s });
        if (r.ok) { S.ui.setup = null; S.view = r.view; S.ui.staffTab = 'lobby'; MC.go('#/s/' + r.id); } else { el.disabled = false; MC.toast(t('err.' + r.error)); }
        return;
      }
      case 'setup-save': { const s = S.ui.setup; const r = await MC.act('ins:settings', { settings: s, name: s.name }, t('setup.saved')); if (r.ok) { S.ui.setupFor = null; S.ui.setup = null; S.ui.staffTab = 'lobby'; render(); } return; }
      case 'setup-cancel': S.ui.setupFor = null; S.ui.setup = null; S.ui.staffTab = 'lobby'; render(); return;
      case 'admin-remove': { const r = await MC.emit('admin:instructor:remove', { email: el.dataset.email }); if (r.ok) { S.ui.admin.instructors = r.instructors; render(); } return; }
      default: if (MC.onAct) MC.onAct(a, el, e);
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (el.dataset.set && S.ui.setup) {
      let v = el.type === 'checkbox' ? el.checked : el.value;
      const k = el.dataset.set;
      if (el.type !== 'checkbox' && !['name', 'lang', 'funding.mode'].includes(k)) v = +v || 0;
      if (k === 'seed') v = MC.clamp(Math.round(v), 0, 65535);
      setPath(S.ui.setup, k, v);
      const R = S.ui.setup.rounds;
      ['competitor', 'regulation'].forEach((x) => { S.ui.setup[x].round = MC.clamp(S.ui.setup[x].round, 2, R); });
      S.ui.setup.funding.round = MC.clamp(S.ui.setup.funding.round, 2, R - 1);
      MC.renderKeepFocus();
    }
  });
  document.addEventListener('input', (e) => { if (e.target.id === 'st-name' && S.ui.setup) S.ui.setup.name = e.target.value; });
  document.addEventListener('submit', async (e) => {
    const f = e.target;
    if (f.id === 'join-form') {
      e.preventDefault();
      const code = document.getElementById('join-code').value;
      const r = await MC.emit('session:join', { code });
      if (!r.ok) { S.ui.joinErr = t('err.' + r.error); render(); document.getElementById('join-code').value = code; return; }
      S.ui.joinErr = ''; S.ui.briefStep = 0; S.view = r.view; MC.go('#/s/' + r.id);
    } else if (f.id === 'dev-form') {
      e.preventDefault();
      try { await api('/api/auth/dev', { name: document.getElementById('dev-name').value, email: document.getElementById('dev-email').value }); await afterSignIn(); }
      catch (err) { MC.toast(t('signin.failed')); }
    } else if (f.id === 'admin-add') {
      e.preventDefault();
      const r = await MC.emit('admin:instructor:add', { email: document.getElementById('admin-email').value });
      if (r.ok) { S.ui.admin.instructors = r.instructors; render(); MC.toast(t('admin.addedToast')); } else MC.toast(t('err.' + r.error));
    } else if (MC.onSubmit) MC.onSubmit(e);
  });
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && S.ui.menuOpen) { S.ui.menuOpen = false; render(); } });

  // ---------------- boot ----------------
  async function boot() {
    MC.setLang(storedLang() || ((navigator.language || '').toLowerCase().startsWith('id') ? 'id' : 'en'));
    S.route = parseHash();
    try { S.cfg = await api('/api/config'); } catch (e) { S.cfg = { googleClientId: '', devLogin: false }; }
    try {
      const me = await api('/api/me');
      if (me.user) { S.me = me.user; S.isInstructor = me.isInstructor; S.isSuperAdmin = me.isSuperAdmin; if (me.lang && !storedLang()) MC.setLang(me.lang); connect(); }
    } catch (e) { /* signed out */ }
    onRoute();
  }
  setInterval(() => { if (MC.tick) MC.tick(); }, 1000);
  boot();
})();
