/* About page (PRD section 14) and the animated hero. */
(function () {
  'use strict';
  const E = window.ChasmEngine;
  const MC = window.MC;
  const t = MC.t, esc = MC.esc, S = MC.S;

  MC.renderAbout = function () {
    const A = window.ABOUT || { profiles: [] };
    const L = MC.lang;
    const P = E.buildParams(E.normalizeSettings({}));
    const back = S.ui.aboutBack || (S.me ? '#/' : '#/');
    const objectives = [1, 2, 3, 4, 5, 6].map((k) => `<li>${esc(t('about.obj.' + k))}</li>`).join('');
    const params = [
      ['about.param.p', P.p0 + ' → ' + P.pMax], ['about.param.q', P.q0 + ' → ' + P.qMax], ['about.param.chasm', MC.fmtPct(P.crossWOM, 0)],
      ['about.param.wp', P.wpThreshold + ' / 100'], ['about.param.learning', MC.fmtPct(P.learning, 0)], ['about.param.lost', MC.fmtPct(P.lostDemand, 0)],
      ['about.param.cash', MC.fmtK(P.startCash)], ['about.param.capacity', MC.fmtN(P.startCapacity)], ['about.param.market', [0, 1, 2].map((v) => MC.vShort(v) + ' ' + MC.fmtN(P.mV[v])).join(' · ')],
    ];
    const profile = (p) => `<article class="card profile">
      ${p.photo ? `<img class="avatar" src="${esc(p.photo)}" alt="${esc(p.name)}" width="96" height="96">` : `<div class="avatar initials" aria-hidden="true">${esc(MC.initials(p.name))}</div>`}
      <div class="stack" style="gap:6px;min-width:0">
        <p class="eyebrow">${esc(p.role[L] || p.role.en)}</p>
        <h3>${esc(p.name)}</h3>
        <p class="small muted">${esc(p.position[L] || p.position.en)}</p>
        <p>${esc(p.bio[L] || p.bio.en)}</p>
        ${(p.links || []).length ? `<p class="small">${p.links.map((l) => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`).join(' · ')}</p>` : ''}
      </div></article>`;
    return `${MC.topbar()}<main class="wrap stack about" style="gap:28px">
      <div class="row no-print"><a class="btn ghost small" href="${esc(back)}">← ${esc(t('common.back'))}</a></div>
      <section class="about-hero">
        <div><p class="eyebrow">${esc(t('about.eyebrow'))}</p><h1>${esc(t('about.title'))}</h1>
          <p class="lede">${esc(t('about.intro'))}</p></div>
        <div class="mite card"><p class="eyebrow">MITE</p>
          <p class="mite-line"><b>M</b>anagement of <b>I</b>nnovation, <b>T</b>echnology, and <b>E</b>ntrepreneurship</p>
          ${L === 'id' ? `<p class="small muted">${esc(t('about.miteId'))}</p>` : ''}</div>
      </section>
      <section class="about-grid">
        <div class="card stack"><h3>${esc(t('about.theoriesTitle'))}</h3>
          <dl class="theories"><dt>Rogers</dt><dd>${esc(t('about.rogers'))}</dd><dt>Bass</dt><dd>${esc(t('about.bass'))}</dd><dt>Moore</dt><dd>${esc(t('about.moore'))}</dd></dl></div>
        <div class="card stack"><h3>${esc(t('about.objTitle'))}</h3><ol class="guide">${objectives}</ol></div>
      </section>
      <section class="stack"><div><p class="eyebrow">${esc(t('about.teamEyebrow'))}</p><h2>${esc(t('about.teamTitle'))}</h2></div>
        <div class="profiles">${(A.profiles || []).map(profile).join('')}</div></section>
      <section class="card stack" id="about-model"><h3>${esc(t('about.modelTitle'))}</h3><p class="small muted">${esc(t('about.modelBody'))}</p>
        <div class="tbl-wrap"><table class="data wrap"><thead><tr><th>${esc(t('about.param'))}</th><th>${esc(t('about.value'))}</th></tr></thead><tbody>
        ${params.map((r) => `<tr><td>${esc(t(r[0]))}</td><td>${esc(r[1])}</td></tr>`).join('')}</tbody></table></div>
        <p class="small muted">${esc(t('about.modelNote'))}</p></section>
      <footer class="small muted row"><span>${esc(t('about.version', { v: (S.cfg && S.cfg.version) || A.version }))}</span>${S.cfg && S.cfg.contact ? `<span>· ${esc(t('about.contact'))} <span class="mono">${esc(S.cfg.contact)}</span></span>` : ''}</footer>
    </main>`;
  };

  // Animated city of mesh nodes lighting up along an S-curve, with the chasm as a dark gap
  let stopHero = null;
  MC.startHero = function (cv) {
    if (stopHero) { stopHero(); stopHero = null; }
    if (!cv || !cv.getContext) return;
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let W = 0, H = 0, nodes = [], raf = 0;
    const t0 = performance.now() - 4200;
    function layout() {
      const r = cv.getBoundingClientRect(), dpr = Math.min(2, window.devicePixelRatio || 1);
      W = Math.max(200, r.width); H = Math.max(160, r.height);
      cv.width = W * dpr; cv.height = H * dpr; ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      nodes = [];
      const shares = [0.11, 0.17, 0.27, 0.27, 0.18], gap = W * 0.06, usable = W * 0.9 - gap;
      let x = W * 0.05;
      shares.forEach((sh, c) => {
        if (c === 2) x += gap;
        const w = usable * sh, sp = Math.max(11, W / 46);
        for (let yy = H * 0.12; yy < H * 0.84; yy += sp) for (let xx = x + sp / 2; xx < x + w - 2; xx += sp) {
          nodes.push({ x: xx + (MC.hash(nodes.length) % 5) - 2, y: yy + (MC.hash(nodes.length + 999) % 5) - 2, c, r: MC.hash(nodes.length + 77) / 4294967296 });
        }
        x += w;
      });
    }
    function frame(now) {
      if (!cv.isConnected) return;
      const T = 9000, ph = reduce ? 0.62 : ((now - t0) % T) / T, prog = ph < 0.85 ? ph / 0.85 : 1;
      ctx.fillStyle = '#0B111E'; ctx.fillRect(0, 0, W, H);
      const cx = W * 0.05 + (W * 0.9 - W * 0.06) * 0.28;
      ctx.fillStyle = '#04070E'; ctx.fillRect(cx, H * 0.08, W * 0.06, H * 0.8);
      ctx.strokeStyle = 'rgba(240,122,102,.55)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (let i = 0; i <= 12; i++) { const yy = H * 0.08 + H * 0.8 * i / 12; const xx = cx + W * 0.015 + (MC.hash(i) % 100) / 100 * W * 0.03; if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy); }
      ctx.stroke();
      const start = [0.0, 0.12, 0.42, 0.62, 0.8];
      for (const n of nodes) {
        const local = MC.clamp((prog - start[n.c]) / 0.35, 0, 1), s = local * local * (3 - 2 * local);
        if (n.r < s * (n.c >= 3 ? 0.75 : 0.95)) {
          ctx.fillStyle = 'rgba(246,188,72,.18)'; ctx.beginPath(); ctx.arc(n.x, n.y, 5.5, 0, 6.283); ctx.fill();
          ctx.fillStyle = '#F6BC48'; ctx.beginPath(); ctx.arc(n.x, n.y, 2.6, 0, 6.283); ctx.fill();
        } else { ctx.fillStyle = '#26324A'; ctx.beginPath(); ctx.arc(n.x, n.y, 1.7, 0, 6.283); ctx.fill(); }
      }
      ctx.strokeStyle = 'rgba(76,195,190,.9)'; ctx.lineWidth = 2; ctx.beginPath();
      for (let i = 0; i <= 80 * prog; i++) {
        const u = i / 80, e = Math.exp(-0.53 * u * 12), F = (1 - e) / (1 + (0.5 / 0.03) * e);
        const xx = W * 0.05 + u * W * 0.9, yy = H * 0.94 - F * H * 0.14;
        if (i) ctx.lineTo(xx, yy); else ctx.moveTo(xx, yy);
      }
      ctx.stroke();
      ctx.fillStyle = '#8691A6'; ctx.font = '12px "Atkinson Hyperlegible", sans-serif'; ctx.textAlign = 'center';
      ctx.fillText(t('map.chasm').toUpperCase(), cx + W * 0.03, H * 0.07);
      if (!reduce) raf = requestAnimationFrame(frame);
    }
    layout(); frame(performance.now());
    const ro = window.ResizeObserver ? new ResizeObserver(() => { layout(); if (reduce) frame(performance.now()); }) : null;
    if (ro) ro.observe(cv);
    stopHero = () => { cancelAnimationFrame(raf); if (ro) ro.disconnect(); };
  };
})();
