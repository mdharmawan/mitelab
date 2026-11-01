/* Player screens: lobby, briefing, events, decisions, results, team debrief. */
(function () {
  'use strict';
  const E = window.ChasmEngine;
  const MC = window.MC;
  const t = MC.t, esc = MC.esc, S = MC.S;
  const { VERTICALS, CATEGORIES, NCELL, cellV, cellC, cellIdx } = E;
  const fmtN = (n) => MC.fmtN(n), fmtK = (k) => MC.fmtK(k), fmtUSD = (d) => MC.fmtUSD(d), fmtPct = (x, d) => MC.fmtPct(x, d);

  const BRIEF_KEY = (id) => 'mite-brief-' + id;
  const briefSeen = (id) => { try { return localStorage.getItem(BRIEF_KEY(id)) === '1'; } catch (e) { return !!S.ui['brief' + id]; } };
  const setBriefSeen = (id) => { S.ui['brief' + id] = true; try { localStorage.setItem(BRIEF_KEY(id), '1'); } catch (e) { /* ok */ } };

  const GROUPS = [
    { id: 'targeting', advisor: 'sol', levers: [] },
    { id: 'prod', advisor: 'kiri', levers: ['price', 'rdPerf', 'rdCompat', 'rdEase', 'rdRel', 'trial'] },
    { id: 'mkt', advisor: 'dev', levers: ['ads', 'sales', 'refs', 'channels'] },
    { id: 'ops', advisor: 'ines', levers: ['capacityAdd', 'qa', 'equity', 'debt'] },
    { id: 'eco', advisor: 'ama', levers: ['community', 'univ', 'tp', 'os'] },
  ];
  MC.GROUPS = GROUPS;
  const LEVERS = {
    price: { kind: 'price', theory: 'relAdv', lag: 'now' }, rdPerf: { kind: 'k', theory: 'relAdv', lag: 'next' },
    rdCompat: { kind: 'k', theory: 'compat', lag: 'next' }, rdEase: { kind: 'k', theory: 'complexity', lag: 'next' },
    rdRel: { kind: 'k', theory: 'quality', lag: 'next' }, trial: { kind: 'toggle', theory: 'trial', lag: 'now' },
    ads: { kind: 'k', theory: 'bassP', lag: 'now' }, sales: { kind: 'k', theory: 'bassP', lag: 'now' },
    refs: { kind: 'k', theory: 'bassQ', lag: 'now' }, channels: { kind: 'k', theory: 'reach', lag: 'next' },
    capacityAdd: { kind: 'sites', theory: 'tornado', lag: 'next' }, qa: { kind: 'k', theory: 'quality', lag: 'now' },
    equity: { kind: 'cap', theory: 'runway', lag: 'now' }, debt: { kind: 'cap', theory: 'runway', lag: 'now' },
    community: { kind: 'k', theory: 'communityQ', lag: 'next' }, univ: { kind: 'k', theory: 'wholeProduct', lag: 'two' },
    tp: { kind: 'k', theory: 'wholeProduct', lag: 'next' }, os: { kind: 'k', theory: 'complexity', lag: 'next' },
  };
  MC.LEVERS = LEVERS;

  const ADVISORS = {
    sol: { init: 'SA', color: 'var(--s1)' }, kiri: { init: 'KT', color: 'var(--s3)' }, dev: { init: 'DR', color: 'var(--s2)' },
    ines: { init: 'IH', color: 'var(--s5)' }, ama: { init: 'AB', color: 'var(--s4)' },
  };
  function face(id, size) {
    const a = ADVISORS[id]; size = size || 44;
    return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="21" fill="${a.color}" opacity=".18"/><circle cx="22" cy="22" r="21" fill="none" stroke="${a.color}" stroke-width="2"/>
      <circle cx="35" cy="9" r="4" fill="var(--glow)"/><text x="22" y="27" text-anchor="middle" font-family="IBM Plex Mono, monospace" font-size="13" font-weight="600" fill="var(--ink)">${a.init}</text></svg>`;
  }
  function advisorBlock(id, line, hints) {
    return `<div class="advisor">${face(id)}<div><div class="who">${esc(t('advisor.' + id + '.name'))} <span class="role">· ${esc(t('advisor.' + id + '.role'))}</span></div>
      <p class="says">${line.fact}</p>${hints && line.tip ? `<p class="tip">${line.tip}</p>` : ''}</div></div>`;
  }

  // ---------------- helpers ----------------
  const ctx = () => {
    const v = S.view, team = v.myTeam, session = v.session;
    return { v, team, session, g: team ? MC.teamG(team, session) : null };
  };
  const isCaptain = () => S.view.myTeam && S.view.myTeam.captain === S.me.email;
  function isLocked(key, g) { return !!(S.view.session.settings.unlocks && (E.UNLOCK[key] || 1) > g.round); }
  function decisionPreview(team, g) {
    const d = JSON.parse(JSON.stringify(team.draft || E.blankDecision()));
    for (const k of Object.keys(E.UNLOCK)) if (isLocked(k, g) && k in d && k !== 'price') d[k] = k === 'trial' ? false : 0;
    if (d.primary == null) d.primary = cellIdx(0, 1);
    d.secondary = (d.secondary || []).filter((x) => x != null);
    return d;
  }
  function remaining(deadline, remainingMs) {
    if (remainingMs != null) return remainingMs;
    if (!deadline) return null;
    return deadline - (Date.now() + S.clockOffset);
  }
  function timerText(ms) {
    if (ms == null) return '';
    if (ms <= 0) return t('timer.up');
    const m = Math.floor(ms / 60000), s = Math.floor(ms / 1000) % 60;
    return t('timer.left', { t: `${m}:${String(s).padStart(2, '0')}` });
  }
  MC.timerText = timerText; MC.remaining = remaining;

  function playerTopbar() {
    const { team, session, g } = ctx();
    let extra = '';
    if (team && g) {
      const last = team.history[team.history.length - 1];
      const R = session.settings.rounds;
      const yr = team.phase === 'results' || team.phase === 'finished' ? (last ? last.round : 1) : Math.min(g.round, R);
      const st = last ? last.stage : 'introduction';
      const ms = team.phase === 'deciding' ? remaining(team.deadline, team.remainingMs) : null;
      extra = `<div class="kpis">
        <div class="kpi"><span class="k">${esc(t('kpi.year'))}</span><span class="v">${yr}/${R}</span></div>
        <div class="kpi"><span class="k">${esc(t('kpi.cash'))}</span><span class="v ${g.cash < 0 ? 'neg' : ''}">${fmtK(g.cash)}</span></div>
        <div class="kpi"><span class="k">${esc(t('kpi.sites'))}</span><span class="v">${fmtN(last ? last.active : 0)}</span></div>
        <div class="kpi"><span class="k">${esc(t('kpi.adoption'))}</span><span class="v">${fmtPct(last ? last.adoption : 0, 2)}</span></div>
        <span class="pill ${MC.stageClass(st)}">${esc(MC.stageName(st))}</span>
        ${ms != null ? `<span class="pill ${ms < 60000 ? 'danger' : ''}" id="timer">${esc(session.paused ? t('timer.paused') : timerText(ms))}</span>` : ''}
        <span class="pill" style="background:transparent;border:2px solid ${MC.teamColor(team)}">${esc(MC.teamName(team))}</span>
      </div>`;
    }
    return MC.topbar(extra);
  }
  MC.tick = function () {
    const el = document.getElementById('timer'); if (!el || !S.view) return;
    if (S.view.role === 'player') {
      const team = S.view.myTeam; if (!team) return;
      if (S.view.session.paused) { el.textContent = t('timer.paused'); return; }
      const ms = remaining(team.deadline, team.remainingMs);
      el.textContent = timerText(ms); el.className = 'pill' + (ms != null && ms < 60000 ? ' danger' : '');
    } else if (MC.staffTick) MC.staffTick(el);
  };
  function banners() {
    const v = S.view, b = v.session.broadcasts || [];
    const last = b[b.length - 1];
    let out = '';
    if (v.session.paused) out += `<div class="banner warn" role="status">${esc(t('banner.paused'))}</div>`;
    if (last && Date.now() + S.clockOffset - last.at < 10 * 60000) out += `<div class="banner" role="status"><b>${esc(t('banner.fromInstructor'))}</b> ${esc(last.text)}</div>`;
    if (v.session.run && v.session.run.practice && v.session.kind !== 'practice') out += `<div class="banner" role="status">${esc(t('banner.practiceRun', { round: v.session.run.fromRound }))}</div>`;
    return out;
  }
  MC.banners = banners;

  // ---------------- main router ----------------
  MC.renderPlayer = function () {
    const { v, team, session } = ctx();
    if (!team) return playerTopbar() + `<main class="wrap stack">${banners()}${renderLobby()}</main>`;
    if (session.status === 'lobby') return playerTopbar() + `<main class="wrap stack">${banners()}${renderLobby()}</main>`;
    if (!briefSeen(session.id) && !(team.history || []).length) return playerTopbar() + renderBrief();
    const phase = team.phase;
    if (phase === 'finished' || session.status === 'finished') return playerTopbar() + renderTeamDebrief();
    if (phase === 'results') return playerTopbar() + renderResults();
    if (phase === 'deciding') {
      const g = MC.teamG(team, session);
      if (g.admin) return playerTopbar() + renderAdmin();
      const ackKey = session.id + ':' + session.run.id + ':' + g.round;
      if (team.events && team.events.length && !S.ui.eventAck[ackKey] && !team.submitted) return playerTopbar() + renderEvents(ackKey);
      if (team.submitted && session.mode === 'multi') return playerTopbar() + renderWaiting();
      return playerTopbar() + renderDecide();
    }
    return playerTopbar() + `<main class="wrap"><p class="muted">${esc(t('common.loading'))}</p></main>`;
  };

  // ---------------- lobby ----------------
  function renderLobby() {
    const v = S.view, s = v.session, mine = v.myTeam;
    const self = s.settings.assign === 'self' && s.status === 'lobby';
    const teamCard = (tm) => {
      const isMine = mine && mine.id === tm.id;
      return `<div class="card team-card ${isMine ? 'mine' : ''}" style="border-top:4px solid ${MC.teamColor(tm)}">
        <div class="row"><h3>${esc(MC.teamName(tm))}</h3><div class="spacer"></div>${isMine ? `<span class="pill teal">${esc(t('lobby.yourTeam'))}</span>` : ''}</div>
        <ul class="members">${tm.members.map((m) => `<li>${esc(m.name)}${tm.captain === m.email ? ` <span class="tag">${esc(t('lobby.captain'))}</span>` : ''}</li>`).join('') || `<li class="muted">${esc(t('lobby.empty'))}</li>`}</ul>
        ${self && !isMine ? `<button class="btn small" data-act="choose-team" data-team="${esc(tm.id)}">${esc(t('lobby.join'))}</button>` : ''}
        ${isMine && mine.captain === S.me.email ? `<form class="row rename-form" data-team="${esc(tm.id)}"><input class="input" id="team-name" maxlength="40" placeholder="${esc(t('lobby.namePh'))}" value="${esc(tm.name || '')}" style="max-width:220px"><button class="btn small" type="submit">${esc(t('lobby.rename'))}</button></form>` : ''}
      </div>`;
    };
    const msg = s.status !== 'lobby' && !mine ? t('lobby.startedNoTeam') : !mine ? (self ? t('lobby.chooseTeam') : t('lobby.waitAssign')) : t('lobby.waitStart');
    return `<div><p class="eyebrow">${esc(t('lobby.eyebrow', { code: MC.fmtCode(s.code) }))}</p><h2>${esc(s.name || t('session.untitled'))}</h2>
      <p class="muted" style="margin-top:6px">${esc(msg)}</p></div>
      <div class="note">${esc(t('mode.' + s.mode + '.desc'))} ${esc(t('lobby.rules', { rounds: s.settings.rounds }))}</div>
      <div class="team-grid">${v.teams.map(teamCard).join('')}</div>`;
  }

  // ---------------- briefing ----------------
  function briefArt(kind, P) {
    if (kind === 'map') { const N = new Array(NCELL).fill(0); N[0] = 6000; N[1] = 14000; N[5] = 3000; N[6] = 9000; N[2] = 4000; return MC.mapSVG({ P, N }); }
    if (kind === 'chasm') { const N = new Array(NCELL).fill(0); N[0] = 9000; N[1] = 40000; N[2] = 52000; N[3] = 8000; N[7] = 6000; N[5] = 4000; N[6] = 20000; return MC.mapSVG({ P, N, primary: 2, secondary: [1] }); }
    if (kind === 'node') return `<svg viewBox="0 0 400 260" style="width:100%;height:auto;display:block" aria-hidden="true">
      ${[0, 1, 2, 3].map((k) => `<circle cx="200" cy="130" r="${30 + k * 26}" fill="none" stroke="#F6BC48" stroke-opacity="${0.5 - k * 0.11}" stroke-width="2"/>`).join('')}
      <circle cx="200" cy="130" r="16" fill="#F6BC48"/>
      ${[[70, 60], [330, 70], [90, 210], [320, 200], [200, 30], [200, 235]].map(([x, y]) => `<line x1="200" y1="130" x2="${x}" y2="${y}" stroke="#F6BC48" stroke-opacity=".35" stroke-dasharray="3 5"/><rect x="${x - 12}" y="${y - 8}" width="24" height="16" rx="4" fill="#24304A" stroke="#4CC3BE"/>`).join('')}</svg>`;
    if (kind === 'loop') return `<svg viewBox="0 0 400 260" style="width:100%;height:auto;display:block" aria-hidden="true">
      ${['brief.loop1', 'brief.loop2', 'brief.loop3', 'brief.loop4'].map((k, i) => { const a = -Math.PI / 2 + i * Math.PI / 2; const x = 200 + Math.cos(a) * 95, y = 130 + Math.sin(a) * 88; return `<rect x="${x - 76}" y="${y - 18}" width="152" height="36" rx="18" fill="#1C263B" stroke="#F6BC48"/><text x="${x}" y="${y + 5}" text-anchor="middle" font-size="13" fill="#E8ECF4" font-family="Atkinson Hyperlegible, sans-serif">${esc(t(k))}</text>`; }).join('')}
      <circle cx="200" cy="130" r="40" fill="none" stroke="#4CC3BE" stroke-dasharray="4 6"/><text x="200" y="135" text-anchor="middle" font-size="13" fill="#A9B3C6" font-family="IBM Plex Mono, monospace">${esc(t('brief.oneYear'))}</text></svg>`;
    return `<svg viewBox="0 0 400 260" style="width:100%;height:auto;display:block" aria-hidden="true">
      <path d="M30 220 C 140 220, 170 60, 370 40" stroke="#F6BC48" stroke-width="3" fill="none"/>
      <line x1="30" y1="220" x2="380" y2="220" stroke="#4A5A7A"/><line x1="30" y1="30" x2="30" y2="220" stroke="#4A5A7A"/>
      <text x="200" y="250" text-anchor="middle" fill="#A9B3C6" font-size="13" font-family="Atkinson Hyperlegible, sans-serif">${esc(t('brief.years'))}</text>
      <text x="44" y="46" fill="#E8ECF4" font-size="15" font-family="Gloock, serif">${esc(t('brief.scoreFormula', { m: fmtN(P.totalM) }))}</text>
      <circle cx="370" cy="40" r="6" fill="#F6BC48"/></svg>`;
  }
  const BRIEF = ['node', 'map', 'chasm', 'loop', 'score'];
  function renderBrief() {
    const { team, session } = ctx();
    const k = MC.clamp(S.ui.briefStep || 0, 0, BRIEF.length - 1);
    const vars = { m: fmtN(team.P.totalM), rounds: session.settings.rounds, cash: fmtK(team.P.startCash), cap: fmtN(team.P.startCapacity) };
    const body = t('brief.' + (k + 1) + '.body', vars) + (k === 3 && session.mode === 'multi' ? ' ' + t('brief.multi') : '');
    return `<main class="brief stack">
      <div class="row"><p class="eyebrow">${esc(t('brief.eyebrow', { n: k + 1, total: BRIEF.length }))}</p><div class="spacer"></div><button class="btn ghost small" data-act="brief-skip">${esc(t('brief.skip'))}</button></div>
      <div class="card brief-card"><div><h2>${esc(t('brief.' + (k + 1) + '.title'))}</h2><p>${esc(body)}</p></div><div class="art">${briefArt(BRIEF[k], team.P)}</div></div>
      <div class="row"><div class="dots-nav">${BRIEF.map((_, i) => `<span class="${i === k ? 'on' : ''}"></span>`).join('')}</div><div class="spacer"></div>
        ${k > 0 ? `<button class="btn" data-act="brief-prev">${esc(t('common.back'))}</button>` : ''}
        <button class="btn primary" data-act="brief-next">${esc(k === BRIEF.length - 1 ? t('brief.start') : t('common.next'))}</button></div>
    </main>`;
  }

  // ---------------- events ----------------
  function eventCopy(ev) {
    const vars = { vertical: ev.vertical != null ? MC.vName(ev.vertical) : '', verticalShort: ev.vertical != null ? MC.vShort(ev.vertical) : '', compat: ev.compat != null ? Math.round(ev.compat) : '' };
    return { kicker: t('event.' + ev.type + '.kicker'), h: t('event.' + ev.type + '.head', vars), d: t('event.' + ev.type + '.brief', vars) };
  }
  MC.eventCopy = eventCopy;
  function renderEvents(ackKey) {
    const { team, g, session } = ctx();
    const resp = (team.draft && team.draft.responses) || {};
    const evs = team.events;
    const allChosen = evs.every((ev) => resp[ev.type]);
    return `<main class="stack">${banners()}
      <article class="ledger">
        <div class="masthead"><span class="title">${esc(t('ledger.title'))}</span><span class="mono small muted">${esc(t('ledger.stories', { year: g.round, n: evs.length }))}</span></div>
        <div class="stack" style="gap:32px">
        ${evs.map((ev) => {
          const c = eventCopy(ev);
          return `<section><p class="eyebrow">${esc(c.kicker)}</p><h2 class="headline">${esc(c.h)}</h2><p class="dek">${esc(c.d)}</p>
            <div class="choices" role="radiogroup" aria-label="${esc(t('event.response'))}">${ev.responses.map((o) => `<button class="choice" role="radio" data-act="respond" data-ev="${ev.type}" data-id="${o.id}" aria-checked="${resp[ev.type] === o.id}" aria-pressed="${resp[ev.type] === o.id}">
              <span class="t">${esc(t('event.' + ev.type + '.' + o.id))}</span><span class="c">${esc(o.cost ? t('event.costs', { k: fmtK(o.cost) }) : t('event.noCost'))}</span><span class="dd">${esc(t('event.' + ev.type + '.' + o.id + '.desc'))}</span></button>`).join('')}</div></section>`;
        }).join('')}</div>
        <div class="row" style="margin-top:24px"><p class="small muted">${esc(t('event.costNote'))}</p><div class="spacer"></div>
          <button class="btn primary" data-act="events-done" data-key="${esc(ackKey)}" ${allChosen ? '' : 'disabled'}>${esc(allChosen ? t('event.toDecisions') : t('event.chooseEach'))}</button></div>
      </article></main>`;
  }

  // ---------------- advisors ----------------
  function advisorLine(group, team, g) {
    const d = team.draft || {}, last = team.history[team.history.length - 1];
    const dv = E.derived(g, d);
    if (group === 'targeting') {
      if (d.primary == null) return { fact: esc(t('adv.target.none')), tip: esc(t('adv.target.noneTip')) };
      const vs = new Set([d.primary].concat(d.secondary || []).map(cellV));
      const pv = cellV(d.primary);
      if (vs.size >= 3) return { fact: esc(t('adv.target.all')), tip: esc(t('adv.target.allTip')) };
      const streak = g.lastPrimaryV === pv ? g.primaryStreak + 1 : 1;
      if (vs.size === 1) return { fact: esc(t('adv.target.beachhead', { v: MC.vName(pv), n: streak })), tip: esc(last && last.chasmRound != null ? t('adv.target.crossedTip') : t('adv.target.beachheadTip')) };
      return { fact: esc(t('adv.target.two', { n: vs.size })), tip: esc(t('adv.target.twoTip')) };
    }
    if (group === 'prod') {
      const uc = E.unitCost(g);
      const pv = d.primary == null ? 0 : cellV(d.primary);
      const wtpEM = CATEGORIES[2].wtp * VERTICALS[pv].wtp * (1 - g.P.osWtpCut * g.eco.os / 100);
      return { fact: esc(t('adv.prod.fact', { uc: fmtUSD(uc), v: MC.vShort(pv), em: fmtUSD(wtpEM), ea: fmtUSD(CATEGORIES[1].wtp * VERTICALS[pv].wtp) })),
        tip: esc(dv.compatV[pv] < 50 ? t('adv.prod.compatTip', { v: MC.vShort(pv), c: Math.round(dv.compatV[pv]), r: Math.round(dv.rel) }) : t('adv.prod.priceTip')) };
    }
    if (group === 'mkt') {
      const fact = last && !last.admin ? t('adv.mkt.fact', { p: fmtN(last.newFromP), q: fmtN(last.newFromQ) }) : t('adv.mkt.none');
      const tip = d.primary != null && cellC(d.primary) >= 2 && !d.refs ? t('adv.mkt.refsTip') : t('adv.mkt.pqTip');
      return { fact: esc(fact), tip: esc(tip) };
    }
    if (group === 'ops') {
      const caps = E.fundingCaps(g);
      const fact = last ? t('adv.ops.fact', { cap: fmtN(g.capacity), dem: fmtN(last.demand), eq: fmtK(caps.equity) }) : t('adv.ops.start', { cap: fmtN(g.capacity), cash: fmtK(g.cash) });
      const tip = last && last.demand > g.capacity ? t('adv.ops.shortTip') : t('adv.ops.tip');
      return { fact: esc(fact), tip: esc(tip) };
    }
    const wp = dv.wpV.map((x, v) => `${MC.vShort(v)} ${Math.round(x)}`).join(' · ');
    return { fact: esc(t('adv.eco.fact', { wp, thr: E.wpThresholdFor(g.P, 0), home: E.wpThresholdFor(g.P, 2) })), tip: esc(t('adv.eco.tip')) };
  }

  // ---------------- decide ----------------
  function groupSpend(gid, d, P) {
    const gr = GROUPS.find((x) => x.id === gid);
    let k = 0;
    for (const key of gr.levers) {
      if (key === 'price' || key === 'equity' || key === 'debt') continue;
      if (key === 'trial') { if (d.trial) k += P.trialCost; continue; }
      if (key === 'capacityAdd') { k += (d.capacityAdd || 0) * P.capCost / 1000; continue; }
      k += d[key] || 0;
    }
    return k ? fmtK(k) : '';
  }
  MC.groupSpend = groupSpend;
  function leverRow(key, team, g, canEdit) {
    const L = LEVERS[key], d = team.draft || {}, locked = isLocked(key, g);
    const hints = S.view.session.settings.hints;
    const b = E.budget(g, decisionPreview(team, g));
    const dis = locked || !canEdit ? 'disabled' : '';
    const meta = `<div class="meta">${hints ? `<span class="tag theory">${esc(MC.term(L.theory))}</span>` : ''}<span class="tag lag">${esc(t('lag.' + L.lag))}</span>${locked ? `<span class="tag">${esc(t('lever.unlocks', { n: E.UNLOCK[key] }))}</span>` : ''}</div>`;
    const name = t('lever.' + key), desc = t('lever.' + key + '.desc');
    if (L.kind === 'toggle') {
      return `<div class="lever ${locked ? 'locked' : ''}"><div class="name">${esc(name)}</div>
        <label class="switch"><input type="checkbox" id="lv-${key}" data-lever="${key}" ${d[key] ? 'checked' : ''} ${dis}>${esc(t('common.on'))}</label>
        <p class="desc">${esc(desc)}</p>${meta}</div>`;
    }
    let max, unit, val = d[key] || 0, extra = '';
    const P = g.P;
    if (L.kind === 'price') { max = 12000; unit = MC.lang === 'id' ? 'US$' : '$'; const uc = E.unitCost(g); extra = `<p class="desc">${esc(t('lever.price.cost', { uc: fmtUSD(uc) }))} ${val < uc ? `<b>${esc(t('lever.price.below', { uc: fmtUSD(uc) }))}</b>` : ''}</p>`; }
    else if (L.kind === 'sites') { max = Math.max(5000, MC.niceCeil((b.available - b.spend + val * P.capCost / 1000) * 1000 / P.capCost)); unit = t('unit.sites'); extra = `<p class="desc">${esc(t('lever.capacity.extra', { cost: fmtK(val * P.capCost / 1000), next: fmtN(g.capacity + val) }))}</p>`; }
    else if (L.kind === 'cap') { const cap = key === 'equity' ? b.caps.equity : b.caps.debt; max = Math.max(1, cap); unit = MC.lang === 'id' ? 'rb' : '$K';
      extra = `<p class="desc">${esc(t('lever.limit', { k: fmtK(cap) }))}${key === 'equity' ? ' ' + esc(t('lever.ownership', { p: fmtPct(g.ownership, 0) })) : g.debtBal ? ' ' + esc(t('lever.balance', { k: fmtK(g.debtBal) })) : ''}</p>`; }
    else { max = Math.max(1000, MC.niceCeil(Math.max(b.available, val))); unit = MC.lang === 'id' ? 'rb' : '$K'; }
    const pos = L.kind === 'price' ? val / max * 1000 : Math.sqrt(MC.clamp(val / max, 0, 1)) * 1000;
    return `<div class="lever ${locked ? 'locked' : ''}"><div class="name"><label for="lv-${key}">${esc(name)}</label></div>
      <div class="numin"><span>${esc(unit)}</span><input id="lv-${key}" inputmode="numeric" data-lever="${key}" value="${Math.round(val)}" ${dis} aria-describedby="ds-${key}"></div>
      <input class="slider" type="range" min="0" max="1000" step="1" value="${Math.round(pos)}" data-slider="${key}" data-max="${max}" data-kind="${L.kind}" ${dis} aria-label="${esc(name)}">
      <p class="desc" id="ds-${key}">${esc(desc)}</p>${extra}${meta}</div>`;
  }
  function lastYearStrip(team, g) {
    const last = team.history[team.history.length - 1];
    if (!last) return `<div class="card"><p class="eyebrow">${esc(t('decide.start'))}</p><div class="lastyear" style="margin-top:8px">
      <div class="stat"><span class="k">${esc(t('stat.seed'))}</span><span class="v">${fmtK(g.cash)}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.capacity'))}</span><span class="v">${fmtN(g.capacity)}</span><span class="d">${esc(t('stat.perYear'))}</span></div>
      <div class="stat"><span class="k">${esc(t('attr.perf'))}</span><span class="v">${Math.round(g.attr.perf)}</span><span class="d">${esc(t('stat.strong'))}</span></div>
      <div class="stat"><span class="k">${esc(t('attr.rel'))}</span><span class="v">${Math.round(g.attr.rel)}</span><span class="d">${esc(t('stat.fragile'))}</span></div>
      <div class="stat"><span class="k">${esc(t('attr.compat'))}</span><span class="v">${Math.round(g.attr.compat)}</span><span class="d">${esc(t('stat.low'))}</span></div></div></div>`;
    const prev = team.history[team.history.length - 2];
    const delta = (a, b) => (a - b >= 0 ? '+' : '−') + fmtN(Math.abs(a - b));
    return `<div class="card"><p class="eyebrow">${esc(t('decide.lastYear', { n: last.round }))}</p><div class="lastyear" style="margin-top:8px">
      <div class="stat"><span class="k">${esc(t('stat.sites'))}</span><span class="v">${fmtN(last.active)}</span><span class="d">${delta(last.active, prev ? prev.active : 0)}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.demand'))}</span><span class="v">${fmtN(last.demand)}</span><span class="d">${esc(t('stat.sold', { n: fmtN(last.sold) }))}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.capacityNow'))}</span><span class="v">${fmtN(g.capacity)}</span><span class="d">${esc(t('stat.was', { n: fmtN(last.capacity) }))}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.revenue'))}</span><span class="v">${fmtK(last.revenue)}</span><span class="d">${esc(t('stat.price', { p: fmtUSD(last.price || 0) }))}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.unitCost'))}</span><span class="v">${fmtUSD(E.unitCost(g))}</span><span class="d">${esc(MC.term('learning'))}</span></div>
      <div class="stat"><span class="k">${esc(t('stat.risk'))}</span><span class="v">${fmtPct(last.risk || 0, 0)}</span><span class="d">${esc(last.failed ? t('stat.failed') : t('stat.noFail'))}</span></div></div></div>`;
  }
  function actFor(round, R) {
    const a1 = Math.ceil(R * 0.3), a2 = Math.ceil(R * 0.6);
    return round <= a1 ? 1 : round <= a2 ? 2 : 3;
  }
  function rivalsN(v, team) {
    if (!v.market || !v.market.NTnow || v.session.mode !== 'multi') return null;
    return v.market.NTnow.map((x, i) => Math.max(0, x - team.state.N[i]));
  }
  function renderDecide() {
    const { v, team, session, g } = ctx();
    const d = team.draft || {};
    const R = session.settings.rounds, act = actFor(g.round, R);
    const canEdit = !team.submitted && !session.paused;
    const tab = S.ui.tab, gr = GROUPS.find((x) => x.id === tab);
    const sc = g.schedule.competitor;
    const rivalV = sc && g.round >= sc.round ? sc.vertical : null;
    let panel;
    if (tab === 'targeting') {
      const chips = [];
      if (d.primary != null) chips.push(`<span class="tchip primary">${esc(t('target.primary'))} · ${esc(MC.cellName(d.primary))}${canEdit ? `<button data-act="untarget" data-cell="${d.primary}" aria-label="${esc(t('target.remove'))}">✕</button>` : ''}</span>`);
      (d.secondary || []).forEach((c) => chips.push(`<span class="tchip">${esc(t('target.secondary'))} · ${esc(MC.cellName(c))}${canEdit ? `<button data-act="make-primary" data-cell="${c}" aria-label="${esc(t('target.makePrimary'))}">★</button><button data-act="untarget" data-cell="${c}" aria-label="${esc(t('target.remove'))}">✕</button>` : ''}</span>`));
      panel = `<p class="muted small">${esc(t('target.help'))}</p><div class="targets">${chips.join('') || `<span class="note">${esc(t('target.none'))}</span>`}</div>`;
    } else panel = gr.levers.map((k) => leverRow(k, team, g, canEdit)).join('');
    const evs = team.events || [];
    const captain = (team.members.find((m) => m.email === team.captain) || {}).name || '—';
    const NR = rivalsN(v, team);
    return `<main class="wrap stack">${banners()}
      <div class="act"><span class="eyebrow">${esc(t('decide.actYear', { act: ['I', 'II', 'III'][act - 1], n: g.round, R }))}</span><h2>${esc(t('act.' + act))}</h2></div>
      <div class="game">
        <div class="col">
          <div class="card stack"><div class="row"><h3>${esc(t('map.title'))}</h3><div class="spacer"></div>${MC.mapLegend(!!NR)}</div>
            ${MC.mapSVG({ P: g.P, N: g.N, NR, primary: d.primary, secondary: d.secondary, interactive: canEdit, rivalV })}
            <p class="small muted">${esc(t('map.help'))}</p></div>
          ${lastYearStrip(team, g)}
          ${evs.length ? `<div class="note">${esc(t('decide.news'))} ${evs.map((ev) => esc(eventCopy(ev).h) + '. ' + esc(t('decide.youChose', { r: t('event.' + ev.type + '.' + E.chosenResponse(ev, d.responses).id) }))).join(' ')}</div>` : ''}
          ${session.mode === 'multi' ? scoreboard() : ''}
        </div>
        <div class="col">
          <div class="tabs" role="tablist" aria-label="${esc(t('decide.groups'))}">${GROUPS.map((x) => `<button class="tab" role="tab" data-act="tab" data-tab="${x.id}" aria-selected="${x.id === tab}">${esc(t('group.' + x.id))}<span class="amt" data-gspend="${x.id}">${groupSpend(x.id, d, g.P)}</span></button>`).join('')}</div>
          <div class="card stack">
            ${advisorBlock(gr.advisor, advisorLine(tab, team, g), session.settings.hints)}
            <div role="tabpanel" aria-label="${esc(t('group.' + tab))}">${panel}</div>
          </div>
          ${team.members.length > 1 ? `<p class="small muted">${esc(t('decide.shared', { captain }))}</p>` : ''}
        </div>
      </div></main>
      <div class="budgetbar no-print"><div class="inner">
        <div class="meter" id="meter"></div>
        ${isCaptain() ? `<button class="btn primary" data-act="submit" id="submit-btn">${esc(t('decide.submit', { n: g.round }))}</button>`
          : `<span class="small muted" style="max-width:260px">${esc(team.submitted ? t('decide.submittedBy', { captain }) : t('decide.captainOnly', { captain }))}</span>`}
      </div></div>`;
  }
  function scoreboard() {
    const v = S.view, m = v.market; if (!m || !m.teams) return '';
    const rows = v.teams.map((tm) => { const mt = m.teams.find((x) => x.id === tm.id) || { active: [] }; return { tm, active: mt.active[mt.active.length - 1] || 0 }; })
      .sort((a, b) => b.active - a.active);
    const total = rows.reduce((s, r) => s + r.active, 0) || 1;
    return `<div class="card"><p class="eyebrow">${esc(t('score.title'))}</p><div class="stack" style="gap:8px;margin-top:8px">${rows.map((r) => `<div class="share-row">
      <span class="sw" style="background:${MC.teamColor(r.tm)}"></span><span class="nm">${esc(MC.teamName(r.tm))}${v.myTeam && v.myTeam.id === r.tm.id ? ' · ' + esc(t('score.you')) : ''}</span>
      <span class="bar"><i style="width:${(r.active / total * 100).toFixed(1)}%;background:${MC.teamColor(r.tm)}"></i></span><span class="num">${fmtN(r.active)}</span></div>`).join('')}</div>
      <p class="small muted" style="margin-top:8px">${esc(t('score.note'))}</p></div>`;
  }
  MC.updateBudget = function () {
    const { team, g } = ctx(); if (!team || !g) return;
    const m = document.getElementById('meter'); if (!m) return;
    const d = decisionPreview(team, g), b = E.budget(g, d);
    const over = !b.ok;
    const pct = b.available > 0 ? MC.clamp(b.spend / b.available, 0, 1) * 100 : 100;
    const fixed = g.P.fixedOverhead + g.capacity * g.P.capUpkeep / 1000 + g.debtBal * g.P.debtRate + g.bridgeBal * 0.2;
    m.className = 'meter' + (over ? ' over' : '');
    let warn = '';
    if (!over && b.left + (g.lastRevenue || 0) * 0.4 < fixed) warn = `<p class="note warn small" style="margin-top:6px">${esc(t('budget.warn', { left: fmtK(b.left), fixed: fmtK(fixed) }))}</p>`;
    m.innerHTML = `<div class="lbls"><span>${esc(t('budget.available'))} <b>${fmtK(b.available)}</b></span><span>${esc(t('budget.allocated'))} <b>${fmtK(b.spend)}</b></span>
      <span>${esc(over ? t('budget.over') : t('budget.left'))} <b>${fmtK(Math.abs(b.left))}</b></span><span>${esc(t('budget.fixed'))} <b>${fmtK(fixed)}</b></span></div>
      <div class="bar" role="progressbar" aria-label="${esc(t('budget.allocated'))}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.round(pct)}"><div class="fill" style="width:${pct}%"></div></div>${warn}`;
    const btn = document.getElementById('submit-btn');
    const noTarget = team.draft == null || team.draft.primary == null;
    if (btn) {
      if (team.submitted) { btn.disabled = false; btn.textContent = t('decide.unsubmit'); btn.dataset.act = 'unsubmit'; }
      else { btn.disabled = over || noTarget || S.view.session.paused; btn.textContent = noTarget ? t('decide.pickTarget') : over ? t('decide.overBudget') : t('decide.submit', { n: g.round }); btn.dataset.act = 'submit'; }
    }
    document.querySelectorAll('[data-gspend]').forEach((el) => { el.textContent = groupSpend(el.dataset.gspend, team.draft || {}, g.P); });
  };

  function renderWaiting() {
    const { v, team, g } = ctx();
    const waitingOn = v.teams.length;
    return `<main class="wrap stack">${banners()}
      <div class="card stack" style="max-width:720px;margin:0 auto;text-align:center;align-items:center">
        <p class="eyebrow">${esc(t('wait.eyebrow', { n: g.round }))}</p><h2>${esc(t('wait.title'))}</h2>
        <p class="muted">${esc(t('wait.body', { n: waitingOn }))}</p>
        ${isCaptain() ? `<button class="btn" data-act="unsubmit">${esc(t('decide.unsubmit'))}</button>` : ''}
      </div>
      ${scoreboard()}</main>`;
  }
  function renderAdmin() {
    const { team, session, g } = ctx();
    return `<main class="wrap stack">${banners()}<div class="act"><span class="eyebrow">${esc(t('kpi.year'))} ${g.round}</span><h2>${esc(t('admin.inTitle'))}</h2></div>
      <div class="card stack"><p>${esc(t('admin.inBody'))}</p>${MC.mapSVG({ P: g.P, N: g.N })}
      ${isCaptain() && session.mode === 'single' ? `<div class="row"><div class="spacer"></div><button class="btn primary" data-act="submit-admin">${esc(t('admin.advance'))}</button></div>` : `<p class="small muted">${esc(t('admin.waitInstructor'))}</p>`}</div></main>`;
  }

  // ---------------- results ----------------
  const DRIVER_TERM = { p: 'bassP', q: 'bassQ', backlog: 'leadTime', gate: 'wholeProduct', chasm: 'chasm', price: 'relAdv', capacity: 'tornado', churn: 'retention', competitor: 'wpDefence', admin: 'runway' };
  function driverCopy(dr, r) {
    const vars = { n: fmtN(dr.value), p: fmtN(r.newFromP), q: fmtN(r.newFromQ), demand: fmtN(r.demand), capacity: fmtN(r.capacity), price: fmtUSD(r.price || 0) };
    const why = dr.key === 'churn' && r.churnRate > 0.05 ? t('driver.churn.whyFail', vars) : t('driver.' + dr.key + '.why', vars);
    return { what: t('driver.' + dr.key, vars), why, concept: MC.term(DRIVER_TERM[dr.key] || 'chasm') };
  }
  MC.driverCopy = driverCopy;
  function headlineFor(r) {
    const top = r.drivers[0] ? r.drivers[0].key : null;
    const vMax = r.emPen.indexOf(Math.max.apply(null, r.emPen));
    let k = 'default';
    if (r.admin) k = 'admin'; else if (r.adminNext) k = 'broke'; else if (r.chasmRound === r.round) k = 'crossed';
    else if (r.failed) k = 'failed'; else if (['capacity', 'q', 'chasm', 'gate', 'price', 'competitor', 'p'].includes(top)) k = top === 'gate' ? 'chasm' : top;
    return t('head.' + k, { v: MC.vName(vMax).toLowerCase(), n: fmtN(r.active), p: fmtN(r.newFromP), year: r.round });
  }
  MC.headlineFor = headlineFor;
  function renderResults() {
    const { v, team, session, g } = ctx();
    const r = team.history[team.history.length - 1], prev = team.history[team.history.length - 2];
    const drivers = r.drivers.map((dr) => { const c = driverCopy(dr, r); return `<div class="driver ${dr.dir > 0 ? 'up' : 'down'}"><span class="ic" aria-hidden="true">${dr.dir > 0 ? '↑' : '↓'}</span>
      <div><p class="what">${esc(c.what)}</p><p class="why">${esc(c.why)}</p><span class="tag theory" style="margin-top:6px;display:inline-block">${esc(c.concept)}</span></div></div>`; }).join('') || `<p class="muted">${esc(t('results.quiet'))}</p>`;
    const xs = [t('common.start')].concat(team.history.map((h) => t('common.yShort', { n: h.round })));
    const cur = MC.chart('res-s', { title: t('results.curve'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), height: 200,
      lines: [{ name: t('chart.adoption'), short: fmtPct(r.adoption, 2), color: 'var(--s4)', values: [0].concat(team.history.map((h) => h.adoption)) }] });
    const notes = [];
    if (r.adminNext && !r.admin) notes.push(`<p class="note warn">${esc(t('results.broke'))}</p>`);
    if (r.pendingFailure) notes.push(`<p class="note warn">${esc(t('results.failure'))}</p>`);
    if (r.trimmed) notes.push(`<p class="note warn">${esc(t('results.trimmed'))}</p>`);
    if (r.events.length) notes.push(`<p class="note">${esc(t('results.events'))} ${r.events.map((e) => esc(t('event.' + e.type + '.' + e.response))).join(' · ')}</p>`);
    const over = team.phase === 'finished';
    let next;
    if (session.mode === 'single') next = isCaptain() ? `<button class="btn glow" data-act="next">${esc(over ? t('results.debrief') : t('results.continue', { n: r.round + 1 }))}</button>` : `<span class="small muted">${esc(t('results.captainContinues'))}</span>`;
    else next = `<span class="small muted">${esc(over ? t('results.finalWait') : t('results.waitInstructor', { n: r.round + 1 }))}</span>`;
    const NR = rivalsN(v, team);
    const sc = g.schedule.competitor;
    return `<main class="wrap stack">${banners()}
      <article class="ledger" style="max-width:none">
        <div class="masthead"><span class="title">${esc(t('ledger.title'))}</span><span class="mono small muted">${esc(t('ledger.report', { n: r.round, team: MC.teamName(team) }))}</span></div>
        <p class="eyebrow">${esc(MC.stageName(r.stage))}${r.chasmRound ? ' · ' + esc(t('results.crossedIn', { n: r.chasmRound })) : ''}</p>
        <h2 class="headline">${esc(headlineFor(r))}</h2>
        <p class="dek">${esc(t('results.dek', { pct: fmtPct(r.adoption, 2), n: fmtN(r.active) }))}${prev ? ' ' + esc(t(r.active >= prev.active ? 'results.up' : 'results.down', { n: fmtN(Math.abs(r.active - prev.active)) })) : ''}</p>
      </article>
      <div class="results">
        <div class="col">
          <div class="card stack"><h3>${esc(t('results.why'))}</h3><div class="drivers">${drivers}</div>${notes.join('')}</div>
          <div class="card stack"><div class="row"><h3>${esc(t('map.title'))}</h3><div class="spacer"></div>${MC.mapLegend(!!NR)}</div>${MC.mapSVG({ P: g.P, N: r.N, NR, rivalV: sc && r.round >= sc.round ? sc.vertical : null })}</div>
        </div>
        <div class="col">
          <div class="card"><h3>${esc(t('results.curve'))}</h3>${cur}</div>
          <div class="card"><h3>${esc(t('results.numbers', { n: r.round }))}</h3><div class="lastyear" style="margin-top:10px">
            <div class="stat"><span class="k">${esc(t('stat.demand'))}</span><span class="v">${fmtN(r.demand)}</span></div>
            <div class="stat"><span class="k">${esc(t('stat.soldK'))}</span><span class="v">${fmtN(r.sold)}</span><span class="d">${esc(t('stat.capacityIs', { n: fmtN(r.capacity) }))}</span></div>
            <div class="stat"><span class="k">${esc(t('stat.revenue'))}</span><span class="v">${fmtK(r.revenue)}</span></div>
            <div class="stat"><span class="k">${esc(t('stat.cashEnd'))}</span><span class="v" style="${r.cashEnd < 0 ? 'color:var(--danger)' : ''}">${fmtK(r.cashEnd)}</span></div>
            <div class="stat"><span class="k">${esc(t('stat.unitCost'))}</span><span class="v">${fmtUSD(r.unitCost)}</span></div>
            <div class="stat"><span class="k">${esc(MC.term('wholeProduct'))}</span><span class="v">${r.wpV.map((x) => Math.round(x)).join(' · ')}</span><span class="d">${esc([0, 1, 2].map(MC.vShort).join(' · '))}</span></div>
          </div></div>
          ${session.mode === 'multi' ? scoreboard() : ''}
          <div class="row"><div class="spacer"></div>${next}</div>
        </div>
      </div></main>`;
  }

  // ---------------- team debrief ----------------
  MC.debriefCharts = function (team, opts) {
    opts = opts || {};
    const H = team.history, P = team.P, R = opts.rounds || H.length;
    const id = (k) => (opts.prefix || 'd') + k;
    const xs = [t('common.start')].concat(H.map((h) => t('common.yShort', { n: h.round })));
    const xsY = H.map((h) => t('common.yShort', { n: h.round }));
    const evLabel = (type) => t('mark.' + type);
    const evMarks = (offset) => {
      const m = [];
      (team.state.firedEvents || []).forEach((e) => {
        if (e.round > H.length) return;
        if (!m.some((x) => x.i === e.round - 1 + offset && x.label === evLabel(e.type))) m.push({ i: e.round - 1 + offset, label: evLabel(e.type), color: ['failure', 'competitor', 'winter'].includes(e.type) ? 'var(--danger)' : 'var(--ink-3)' });
      });
      const cr = H.length ? H[H.length - 1].chasmRound : null;
      if (cr) m.push({ i: cr - 1 + offset, label: t('mark.crossed'), color: 'var(--teal)' });
      return m;
    };
    const pctFmt = (x) => fmtPct(x, x !== 0 && Math.abs(x) < 0.1 ? 1 : 0);
    const bass = E.bassCurve(0.03, 0.38, 1, R);
    const share = opts.shareOfMarket || 1;
    return [
      { id: 'DEB-1', t: t('deb.1.title'), c: MC.term('sCurve') + ' · ' + MC.term('bass'), q: t('deb.1.q'),
        html: MC.chart(id('1'), { title: t('deb.1.title'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), marks: evMarks(1), lines: [
          { name: t('deb.1.you'), short: t('deb.1.youShort'), color: 'var(--s4)', width: 2.5, values: [0].concat(H.map((h) => h.adoption)) },
          { name: t('deb.1.bass'), short: 'Bass', color: 'var(--s1)', dash: true, values: bass.map((x) => x * share) }] }) },
      { id: 'DEB-2', t: t('deb.2.title'), c: t('deb.2.concept'), q: t('deb.2.q'),
        html: MC.chart(id('2'), { title: t('deb.2.title'), xs: xsY, yFmt: fmtN, marks: evMarks(0), barMode: 'stack', bars: [
          { name: t('deb.2.p'), color: 'var(--s1)', values: H.map((h) => h.newFromP || 0) },
          { name: t('deb.2.q2'), color: 'var(--s2)', values: H.map((h) => h.newFromQ || 0) },
          { name: t('deb.2.backlog'), color: 'var(--s3)', values: H.map((h) => h.fromBacklog || 0) }] }) },
      { id: 'DEB-3', t: t('deb.3.title'), c: t('deb.3.concept'), q: t('deb.3.q'),
        html: MC.chart(id('3'), { title: t('deb.3.title'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), marks: evMarks(1).filter((m) => m.label === t('mark.crossed')), lines: CATEGORIES.map((C, ci) => ({
          name: MC.cName(ci), short: t('cat.' + C.id + '.short'), color: `var(--s${ci + 1})`, values: [0].concat(H.map((h) => h.penCat[ci])) })) }) },
      { id: 'DEB-4', t: t('deb.4.title'), c: MC.term('wholeProduct'), q: t('deb.4.q'),
        html: MC.chart(id('4'), { title: t('deb.4.title'), xs: xsY, yFmt: (x) => Math.round(x), yMax: 100, marks: evMarks(0),
          refs: [{ y: P.wpThreshold, label: t('deb.4.thr', { n: P.wpThreshold }) }, { y: E.wpThresholdFor(P, 2), label: t('deb.4.thrHome', { n: E.wpThresholdFor(P, 2) }), color: 'var(--ink-3)' }],
          lines: VERTICALS.map((V, v) => ({ name: MC.vShort(v), color: `var(--s${v + 1})`, values: H.map((h) => (h.d && h.d.wpV ? h.d.wpV[v] : h.wpV[v])) })) }) },
      { id: 'DEB-5', t: t('deb.5.title'), c: t('deb.5.concept'), q: t('deb.5.q'),
        html: MC.chart(id('5'), { title: t('deb.5.title'), xs: xsY, yFmt: fmtN, barMode: 'group', marks: evMarks(0).concat(H.filter((h) => h.failed).map((h) => ({ i: h.round - 1, label: t('mark.failure'), color: 'var(--danger)' }))), bars: [
          { name: t('stat.demand'), color: 'var(--s2)', values: H.map((h) => h.demand) }, { name: t('stat.capacity'), color: 'var(--s1)', values: H.map((h) => h.capacity) }] }) +
          `<p class="small muted" style="margin-top:12px">${esc(t('deb.5.unit'))}</p>` +
          MC.chart(id('5b'), { title: t('stat.unitCost'), xs: xsY, yFmt: fmtUSD, height: 170, endLabels: false, lines: [{ name: t('stat.unitCost'), color: 'var(--s3)', values: H.map((h) => h.unitCost) }] }) },
      { id: 'DEB-6', t: t('deb.6.title'), c: t('deb.6.concept'), q: t('deb.6.q'),
        html: MC.chart(id('6'), { title: t('deb.6.title'), xs: xsY, yFmt: fmtK, marks: evMarks(0).filter((m) => m.label === t('mark.boom') || m.label === t('mark.winter')), barMode: 'stack', bars: [
          { name: t('deb.6.equity'), color: 'var(--s1)', values: H.map((h) => (h.equity || 0) + (h.events.some((e) => e.response === 'raise') ? 3000 : 0)) },
          { name: t('deb.6.debt'), color: 'var(--s5)', values: H.map((h) => (h.debt || 0) + (h.events.some((e) => e.response === 'bridge') ? 2000 : 0)) }],
          lines: [{ name: t('deb.6.cash'), short: t('kpi.cash'), color: 'var(--s4)', values: H.map((h) => h.cashEnd) }] }) },
    ];
  };
  function renderTeamDebrief() {
    const { v, team, session } = ctx();
    const H = team.history, last = H[H.length - 1];
    if (!last) return `<main class="wrap"><p class="muted">${esc(t('debrief.none'))}</p></main>`;
    const charts = MC.debriefCharts(team, { rounds: session.settings.rounds });
    const vertPen = last.penVert.map((p, x) => `<div class="stat"><span class="k">${esc(MC.vShort(x))}</span><span class="v">${fmtPct(p, 1)}</span></div>`).join('');
    const catPen = last.penCat.map((p, c) => `<div class="stat"><span class="k">${esc(MC.cName(c))}</span><span class="v">${fmtPct(p, 1)}</span></div>`).join('');
    const rank = session.mode === 'multi' && v.market ? v.market.teams.map((x) => x.adoption[x.adoption.length - 1] || 0).filter((x) => x > last.adoption).length + 1 : null;
    let classChart = '';
    if (session.mode === 'multi' && v.market) {
      const xs = [t('common.start')].concat(H.map((h) => t('common.yShort', { n: h.round })));
      classChart = `<section class="card chart-card"><h3>${esc(t('deb.class.title'))}</h3><span class="tag theory concept">${esc(t('deb.class.concept'))}</span>
        ${MC.chart('dclass', { title: t('deb.class.title'), xs, yPct: true, yFmt: (x) => fmtPct(x, 2), lines: v.teams.map((tm) => { const mt = v.market.teams.find((x) => x.id === tm.id); return { name: MC.teamName(tm), short: MC.teamName(tm), color: MC.teamColor(tm), width: tm.id === team.id ? 3 : 1.5, values: [0].concat(mt ? mt.adoption : []) }; }) })}</section>`;
    }
    const reflQ = [1, 2, 3].map((k) => t('refl.' + k));
    return `<main class="wrap stack">${banners()}
      <div class="card" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,280px),1fr));gap:24px;align-items:center">
        <div><p class="eyebrow">${esc(t('debrief.final', { team: MC.teamName(team) }))}</p><div class="bigscore">${fmtPct(last.adoption, 2)}</div>
          <p class="muted">${esc(t('debrief.reached', { n: fmtN(last.active), m: fmtN(team.P.totalM) }))}</p>${rank ? `<p class="pill gold" style="margin-top:8px">${esc(t('debrief.rank', { r: rank, n: v.teams.length }))}</p>` : ''}</div>
        <div class="lastyear">
          <div class="stat"><span class="k">${esc(t('debrief.stage'))}</span><span class="v">${esc(MC.stageName(last.stage))}</span></div>
          <div class="stat"><span class="k">${esc(t('debrief.chasm'))}</span><span class="v">${esc(last.chasmRound ? t('debrief.chasmYear', { n: last.chasmRound }) : t('debrief.notCrossed'))}</span></div>
          <div class="stat"><span class="k">${esc(t('stat.cashEnd'))}</span><span class="v">${fmtK(last.cashEnd)}</span></div>
          <div class="stat"><span class="k">${esc(t('debrief.ownership'))}</span><span class="v">${fmtPct(team.state.ownership, 0)}</span></div>
        </div>
      </div>
      <div class="debrief-grid">
        <div class="card"><h3>${esc(t('debrief.byVertical'))}</h3><div class="lastyear" style="margin-top:10px">${vertPen}</div></div>
        <div class="card"><h3>${esc(t('debrief.byCategory'))}</h3><div class="lastyear" style="margin-top:10px">${catPen}</div></div>
      </div>
      <div class="card stack"><h3>${esc(t('debrief.finalMap'))}</h3>${MC.mapSVG({ P: team.P, N: last.N, NR: rivalsN(v, team) })}</div>
      <div><p class="eyebrow">${esc(t('debrief.eyebrow'))}</p><h2>${esc(t('debrief.title'))}</h2></div>
      <div class="debrief-grid">${classChart}${charts.map((c) => `<section class="card chart-card"><p class="eyebrow">${esc(c.id)}</p><h3>${esc(c.t)}</h3><span class="tag theory concept">${esc(c.c)}</span>${c.html}<p class="question"><b>${esc(t('debrief.discuss'))}</b> ${esc(c.q)}</p></section>`).join('')}</div>
      <section class="card stack"><h3>${esc(t('refl.title'))}</h3><p class="muted small">${esc(t('refl.note'))}</p>
        ${reflQ.map((q, i) => `<div class="field"><label for="refl-${i}">${i + 1}. ${esc(q)}</label><textarea class="input" id="refl-${i}" data-refl="${i}">${esc((team.reflection || [])[i] || '')}</textarea></div>`).join('')}
      </section>
      <section class="card stack"><h3>${esc(t('debrief.log'))}</h3><div class="tbl-wrap">${MC.decisionTable(team)}</div></section>
      <section class="card stack no-print"><h3>${esc(t('export.title'))}</h3><p class="muted small">${esc(t('export.teamBody'))}</p>
        <div class="row"><a class="btn glow" href="/api/sessions/${esc(session.id)}/export.csv?lang=${MC.lang}">${esc(t('export.csv'))}</a><button class="btn" data-act="print">${esc(t('export.pdf'))}</button>
        ${session.kind === 'practice' ? `<button class="btn ghost" data-act="practice">${esc(t('debrief.again'))}</button>` : ''}</div></section>
    </main>`;
  }
  MC.decisionTable = function (team) {
    const H = team.history;
    const cols = [['common.year', (h) => h.round], ['log.primary', (h) => (h.admin ? '–' : MC.cellName(h.decision.primary))], ['log.price', (h) => (h.admin ? '–' : fmtUSD(h.price))],
      ['log.rd', (h) => fmtK(h.decision.rdPerf + h.decision.rdCompat + h.decision.rdEase + h.decision.rdRel)], ['log.adsSales', (h) => fmtK(h.decision.ads + h.decision.sales)],
      ['log.refs', (h) => fmtK(h.decision.refs)], ['log.eco', (h) => fmtK(h.decision.community + h.decision.univ + h.decision.tp + h.decision.os)],
      ['log.capacity', (h) => fmtN(h.decision.capacityAdd)], ['log.raised', (h) => fmtK((h.equity || 0) + (h.debt || 0))], ['stat.sites', (h) => fmtN(h.active)], ['log.stage', (h) => MC.stageName(h.stage)]];
    return `<table class="data"><thead><tr>${cols.map((c) => `<th>${esc(t(c[0]))}</th>`).join('')}</tr></thead><tbody>${H.map((h) => `<tr>${cols.map((c) => `<td>${esc(c[1](h))}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
  };

  // ---------------- interactions ----------------
  // Edits not yet confirmed by the server survive any view refresh that arrives meanwhile
  const sendTimers = {};
  const pending = new Map(); // path -> { value, seq }
  let seq = 0;
  function sendDraft(path, value, delay) {
    const mySeq = ++seq;
    pending.set(path, { value, seq: mySeq });
    clearTimeout(sendTimers[path]);
    sendTimers[path] = setTimeout(async () => {
      const r = await MC.emit('draft:set', { path, value });
      const p = pending.get(path);
      if (p && p.seq === mySeq) pending.delete(path);
      if (r.ok) { const team = S.view && S.view.myTeam; if (team && r.draftRev > team.draftRev) team.draftRev = r.draftRev; }
      else if (r.error !== 'timeout') { MC.toast(t('err.' + r.error)); }
    }, delay || 0);
  }
  MC.reapplyPending = function () {
    const team = S.view && S.view.myTeam;
    if (!team || !team.draft || !pending.size || team.submitted) return;
    for (const [path, p] of pending) applyLocal(team, path, p.value);
  };
  MC.flushDrafts = function () {
    // send every waiting edit now (used before submitting)
    for (const path of Object.keys(sendTimers)) { /* timers fire on their own; this waits for them */ }
    return new Promise((resolve) => { const check = () => (pending.size ? setTimeout(check, 60) : resolve()); check(); });
  };
  function applyLocal(team, path, value) {
    team.draft = team.draft || E.blankDecision();
    if (path === 'targets') { team.draft.primary = value.length ? value[0] : null; team.draft.secondary = value.slice(1); }
    else if (path.startsWith('responses.')) { team.draft.responses = team.draft.responses || {}; team.draft.responses[path.slice(10)] = value; }
    else team.draft[path] = value;
  }
  function setLocal(path, value) {
    const team = S.view.myTeam; if (!team) return;
    team.draft = team.draft || E.blankDecision();
    if (path === 'targets') { team.draft.primary = value.length ? value[0] : null; team.draft.secondary = value.slice(1); }
    else if (path.startsWith('responses.')) { team.draft.responses = team.draft.responses || {}; team.draft.responses[path.slice(10)] = value; }
    else team.draft[path] = value;
    team.draftRev = (team.draftRev || 0) + 1;
  }
  function targets() { const d = S.view.myTeam.draft || {}; return d.primary == null ? [] : [d.primary].concat(d.secondary || []); }
  function setTargets(list) { setLocal('targets', list); sendDraft('targets', list); MC.renderKeepFocus(); }
  function toggleTarget(c) {
    const list = targets();
    const k = list.indexOf(c);
    if (k >= 0) list.splice(k, 1);
    else if (list.length < 3) list.push(c);
    else { MC.toast(t('target.full')); return; }
    setTargets(list);
    const el = document.querySelector(`.map .cell[data-cell="${c}"]`); if (el) el.focus({ preventScroll: true });
  }
  let reflTimer = {};

  MC.onAct = async function (a, el) {
    const v = S.view;
    if (!v) return;
    if (v.role !== 'player') { if (MC.onStaffAct) MC.onStaffAct(a, el); return; }
    switch (a) {
      case 'choose-team': MC.act('team:choose', { teamId: el.dataset.team }); break;
      case 'brief-next': if ((S.ui.briefStep || 0) < 4) { S.ui.briefStep = (S.ui.briefStep || 0) + 1; MC.render(); } else { setBriefSeen(v.session.id); MC.render(); window.scrollTo(0, 0); } break;
      case 'brief-prev': S.ui.briefStep = Math.max(0, (S.ui.briefStep || 0) - 1); MC.render(); break;
      case 'brief-skip': setBriefSeen(v.session.id); MC.render(); break;
      case 'respond': setLocal('responses.' + el.dataset.ev, el.dataset.id); sendDraft('responses.' + el.dataset.ev, el.dataset.id); MC.renderKeepFocus(); break;
      case 'events-done': S.ui.eventAck[el.dataset.key] = true; MC.render(); window.scrollTo(0, 0); break;
      case 'tab': S.ui.tab = el.dataset.tab; MC.renderKeepFocus(); break;
      case 'untarget': { const c = +el.dataset.cell; setTargets(targets().filter((x) => x !== c)); break; }
      case 'make-primary': { const c = +el.dataset.cell; setTargets([c].concat(targets().filter((x) => x !== c))); break; }
      case 'submit': {
        el.disabled = true;
        await MC.flushDrafts(); // let every edit reach the server first
        const r = await MC.act('round:submit', { on: true });
        if (r.ok) { MC.toast(t('decide.submitted')); window.scrollTo(0, 0); } else el.disabled = false;
        break;
      }
      case 'submit-admin': MC.act('round:submit', { on: true }); break;
      case 'unsubmit': MC.act('round:submit', { on: false }); break;
      case 'next': { const r = await MC.act('round:next'); if (r.ok) window.scrollTo(0, 0); break; }
      case 'print': window.print(); break;
      default: break;
    }
  };
  MC.onSubmit = function (e) {
    const f = e.target;
    if (f.classList.contains('rename-form')) {
      e.preventDefault();
      MC.act('team:rename', { teamId: f.dataset.team, name: document.getElementById('team-name').value }, t('lobby.renamed'));
    } else if (MC.onStaffSubmit) MC.onStaffSubmit(e);
  };
  document.addEventListener('click', (e) => {
    const cell = e.target.closest('.map .cell[role="button"]');
    if (cell && S.view && S.view.role === 'player') toggleTarget(+cell.dataset.cell);
  });
  document.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.matches && e.target.matches('.map .cell[role="button"]') && S.view && S.view.role === 'player') { e.preventDefault(); toggleTarget(+e.target.dataset.cell); }
  });
  function leverValue(el) { let x = parseFloat(String(el.value).replace(/[^0-9.]/g, '')); if (!isFinite(x) || x < 0) x = 0; return Math.round(x); }
  document.addEventListener('input', (e) => {
    const el = e.target;
    if (!S.view || S.view.role !== 'player') return;
    if (el.dataset.slider) {
      const key = el.dataset.slider, max = +el.dataset.max, pos = +el.value / 1000;
      let val = el.dataset.kind === 'price' ? Math.round(pos * max / 50) * 50 : Math.round(max * pos * pos);
      if (el.dataset.kind === 'k' || el.dataset.kind === 'cap') val = val >= 1000 ? Math.round(val / 50) * 50 : Math.round(val / 10) * 10;
      if (el.dataset.kind === 'sites') val = Math.round(val / 100) * 100;
      setLocal(key, val);
      const num = document.getElementById('lv-' + key); if (num) num.value = val;
      sendDraft(key, val, 150);
      MC.updateBudget();
    } else if (el.dataset.lever && el.type !== 'checkbox') {
      const key = el.dataset.lever, val = leverValue(el);
      setLocal(key, val);
      const sl = document.querySelector(`[data-slider="${key}"]`);
      if (sl) { const max = +sl.dataset.max; sl.value = sl.dataset.kind === 'price' ? Math.round(MC.clamp(val / max, 0, 1) * 1000) : Math.round(Math.sqrt(MC.clamp(val / max, 0, 1)) * 1000); }
      sendDraft(key, val, 300);
      MC.updateBudget();
    } else if (el.dataset.refl != null) {
      const k = +el.dataset.refl;
      const team = S.view.myTeam; if (team) team.reflection[k] = el.value;
      clearTimeout(reflTimer[k]); reflTimer[k] = setTimeout(() => MC.emit('reflection:set', { k, text: el.value }), 500);
    }
  });
  document.addEventListener('change', (e) => {
    const el = e.target;
    if (!S.view || S.view.role !== 'player') return;
    if (el.dataset.lever && el.type === 'checkbox') { setLocal(el.dataset.lever, el.checked); sendDraft(el.dataset.lever, el.checked); MC.updateBudget(); MC.renderKeepFocus(); }
    else if (el.dataset.lever || el.dataset.slider) MC.renderKeepFocus();
  });
  MC.afterRender = function () {
    if (S.view && S.view.role === 'player' && document.getElementById('meter')) MC.updateBudget();
    if (S.view && S.view.role !== 'player' && MC.staffAfterRender) MC.staffAfterRender();
  };
})();
