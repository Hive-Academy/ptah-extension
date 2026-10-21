// REAL-PIXEL CONTRAST. Renders every scroll step of the prototype with all text made transparent, then
//   (1) for every text run: the WORST pixel behind its glyph box vs the run's real computed colour (4.5:1, large 3:1)
//   (2) UI parts (3:1): checked toggle/checkbox/radio fill, progress fill, focus ring colour, vs the pixels around them.
// usage: node measure.cjs [theme:accent ...]   default = ptah-glass / ptah-glass-light x gold / violet / teal
//        env MODAL=1 opens the modal first (overlay surface).
const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const sharp = require('D:/projects/ptah-extension/node_modules/sharp');
const { pathToFileURL } = require('url');
const path = require('path');
const fs = require('fs');
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;

const lin = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); };
const lum = (c) => 0.2126 * lin(c[0]) + 0.7152 * lin(c[1]) + 0.0722 * lin(c[2]);
const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const over = (fg, a, bg) => [0, 1, 2].map((i) => fg[i] * a + bg[i] * (1 - a));

// ---- runs inside the browser ----
function collect() {
  const cv = document.createElement('canvas'); cv.width = cv.height = 1;
  const cx2 = cv.getContext('2d', { willReadFrequently: true });
  const norm = (c) => { cx2.clearRect(0, 0, 1, 1); cx2.fillStyle = '#000'; cx2.fillStyle = c; cx2.fillRect(0, 0, 1, 1); const d = cx2.getImageData(0, 0, 1, 1).data; return d[0] + ',' + d[1] + ',' + d[2] + ',' + (d[3] / 255).toFixed(3); };
  const runs = [], ui = [];
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let n;
  while ((n = w.nextNode())) {
    const t = n.nodeValue.trim();
    if (!t) continue;
    const el = n.parentElement;
    if (!el || ['SCRIPT', 'STYLE', 'OPTION'].includes(el.tagName) || el.closest(':disabled')) continue; // disabled controls are exempt (WCAG 1.4.3)
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.display === 'none') continue;
    const r = document.createRange(); r.selectNodeContents(n);
    const rects = [...r.getClientRects()].filter((q) => q.width > 1 && q.height > 1);
    let op = 1; for (let e = el; e; e = e.parentElement) op *= parseFloat(getComputedStyle(e).opacity);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const eb = el.getBoundingClientRect();
    const bt = parseFloat(cs.borderTopWidth) + 1, bl = parseFloat(cs.borderLeftWidth) + 1; // own border stays out of the sample
    for (const q0 of rects) {
      const left = Math.max(q0.left, eb.left + bl, 0), right = Math.min(q0.right, eb.right - bl, innerWidth), top = Math.max(q0.top, eb.top + bt, 0), bottom = Math.min(q0.bottom, eb.bottom - bt, innerHeight);
      if (right - left < 1 || bottom - top < 1) continue;
      const cxp = (left + right) / 2, cyp = (top + bottom) / 2;
      const hit = document.elementFromPoint(cxp, cyp);
      if (hit && !(el.contains(hit) || hit.contains(el))) continue; // covered (closed modal, scrolled-under chrome)
      runs.push({ t: t.slice(0, 36), color: norm(cs.color), op, large: size >= 24 || (size >= 18.66 && bold), x: left, y: top, w: right - left, h: bottom - top, tag: el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className ? '.' + el.className.split(' ')[0] : '') });
    }
  }
  // UI parts
  const push = (kind, el, color) => { const q = el.getBoundingClientRect(); if (q.width < 4 || q.top < 14 || q.bottom > innerHeight - 14) return; /* edge items: surround is clipped, re-measured in the next scroll step */ const hit = document.elementFromPoint(q.x + q.width / 2, q.y + q.height / 2); if (hit && !(el.contains(hit) || hit.contains(el))) return; const mi = 'm' + ui.length; el.setAttribute('data-mi', mi); ui.push({ kind, color, mi, x: q.x, y: q.y, w: q.width, h: q.height }); };
  document.querySelectorAll('.toggle:checked, .checkbox:checked, .radio:checked').forEach((el) => {
    const cs = getComputedStyle(el); push('checked control (' + el.className.split(' ').filter((c) => /toggle|checkbox|radio/.test(c)).join(' ') + ')', el, norm(cs.backgroundColor));
  });
  document.querySelectorAll('.input, .textarea, .select').forEach((el) => {
    if (el.closest('.accent-pick')) return;
    el.focus({ preventScroll: true }); const cs = getComputedStyle(el); const c = norm(cs.outlineColor); el.blur();
    push('focus ring (' + el.tagName.toLowerCase() + ')', el, c);
  });
  document.querySelectorAll('.btn-primary').forEach((el) => { el.focus({ preventScroll: true }); const c = norm(getComputedStyle(el).outlineColor); el.blur(); push(el.closest('.join') ? 'focus ring (join btn-primary, inset: sampled on its own fill)' : 'focus ring (btn-primary)', el, c); });
  return { runs, ui };
}

(async () => {
  const jobs = process.argv.slice(2).length ? process.argv.slice(2).map((s) => s.split(':')) : [];
  if (!jobs.length) for (const t of ['ptah-glass', 'ptah-glass-light']) for (const a of ['gold', 'violet', 'teal']) jobs.push([t, a]);
  const b = await chromium.launch();
  const report = {};
  for (const [theme, accent] of jobs) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(url + `?theme=${theme}&accent=${accent || 'gold'}` + (process.env.MODAL ? '&modal=1' : ''));
    await p.waitForTimeout(500);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    const rows = [], uis = [];
    for (let y = 0; y < Math.max(1, H - 900 + 800); y += 800) {
      await p.evaluate((yy) => scrollTo(0, yy), y); await p.waitForTimeout(200);
      const { runs, ui } = await p.evaluate(collect);
      const hide = await p.addStyleTag({ content: '*{color:transparent!important;text-shadow:none!important;caret-color:transparent!important;outline-color:transparent!important} svg{visibility:hidden!important} ::placeholder{color:transparent!important} .checkbox:checked::after,.checkbox:checked{--chkfg:transparent}' });
      await p.waitForTimeout(150);
      const buf = await p.screenshot();
      await p.evaluate((el) => el.remove(), hide);
      const raw = await sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
      const W = raw.info.width, Hh = raw.info.height, D = raw.data;
      const pr = (xx, yy) => { xx = Math.min(Math.max(xx, 0), W - 1); yy = Math.min(Math.max(yy, 0), Hh - 1); const k = (yy * W + xx) * 3; return [D[k], D[k + 1], D[k + 2]]; };
      const sy = await p.evaluate(() => scrollY);
      for (const r of runs) {
        const m = r.color.split(',').map(Number); const a = (m[3] === undefined ? 1 : m[3]) * r.op;
        let worst = 99, wp = null;
        const x0 = Math.floor(r.x), x1 = Math.ceil(r.x + r.w), y0 = Math.floor(r.y + r.h * 0.2), y1 = Math.ceil(r.y + r.h * 0.85);
        for (let yy = y0; yy <= y1; yy++) for (let xx = x0; xx <= x1; xx++) { const bg = pr(xx, yy); const q = ratio(over([m[0], m[1], m[2]], a, bg), bg); if (q < worst) { worst = q; wp = bg; } }
        rows.push({ ...r, worst, need: r.large ? 3 : 4.5, bg: wp, at: Math.round(r.y + sy) });
      }
      for (const u of ui) {
        const m = u.color.split(',').map(Number); const fa = m[3] === undefined ? 1 : m[3];
        let worst = 99, wp = null;
        const isFocus = u.kind.startsWith('focus'); const inset = u.kind.includes('inset');
        let get = pr, ox = 0, oy = 0;
        if (isFocus) {
          await p.evaluate((mi) => document.querySelector('[data-mi="' + mi + '"]').focus({ preventScroll: true }), u.mi);
          const st = await p.addStyleTag({ content: '*{color:transparent!important;text-shadow:none!important;caret-color:transparent!important;outline-color:transparent!important} svg{visibility:hidden!important} ::placeholder{color:transparent!important}' });
          await p.waitForTimeout(80);
          const cx0 = Math.max(0, Math.floor(u.x - 12)), cy0 = Math.max(0, Math.floor(u.y - 12));
          const cb = await p.screenshot({ clip: { x: cx0, y: cy0, width: Math.min(1440 - cx0, Math.ceil(u.w + 24)), height: Math.min(900 - cy0, Math.ceil(u.h + 24)) } });
          await p.evaluate((el) => el.remove(), st); await p.evaluate(() => document.activeElement && document.activeElement.blur());
          const cr = await sharp(cb).removeAlpha().raw().toBuffer({ resolveWithObject: true });
          ox = cx0; oy = cy0; get = (xx, yy) => { xx = Math.min(Math.max(xx - ox, 0), cr.info.width - 1); yy = Math.min(Math.max(yy - oy, 0), cr.info.height - 1); const k = (yy * cr.info.width + xx) * 3; return [cr.data[k], cr.data[k + 1], cr.data[k + 2]]; };
        }
        const ring = []; // annulus 3..6px outside the part
        for (let d = inset ? -5 : isFocus ? 6 : 3; d <= (inset ? -3 : isFocus ? 7 : 6); d++) for (let xx = Math.floor(u.x - d); xx <= Math.ceil(u.x + u.w + d); xx += 2) { ring.push([xx, Math.floor(u.y - d)]); ring.push([xx, Math.ceil(u.y + u.h + d)]); }
        for (let d = inset ? -5 : isFocus ? 6 : 3; d <= (inset ? -3 : isFocus ? 7 : 6); d++) for (let yy = Math.floor(u.y - d); yy <= Math.ceil(u.y + u.h + d); yy += 2) { ring.push([Math.floor(u.x - d), yy]); ring.push([Math.ceil(u.x + u.w + d), yy]); }
        if (inset) { ring.length = 0; for (const f of [0.25, 0.5, 0.75]) ring.push([Math.round(u.x + u.w * f), Math.round(u.y + u.h / 2)]); }
        // 12th percentile of the surround (robust to a neighbouring control or border sitting inside the 6px annulus)
        const qs = ring.map(([xx, yy]) => { const bg = get(xx, yy); return [ratio(over([m[0], m[1], m[2]], fa, bg), bg), bg]; }).sort((a, b3) => a[0] - b3[0]);
        const pick = qs[Math.floor(qs.length * 0.12)]; worst = pick[0]; wp = pick[1];
        rows.push({ t: u.kind, ui: true, worst, need: 3, bg: wp, at: Math.round(u.y + sy), tag: 'UI', x: u.x, y: u.y });
      }
    }
    // progress fill (rendered pixels: fill vs the track/panel pixels above and below the bar)
    rows.sort((a, b2) => a.worst - b2.worst);
    const txt = rows.filter((r) => !r.ui), uis2 = rows.filter((r) => r.ui);
    const dedupUi = {}; for (const u of uis2) { if (!dedupUi[u.t] || u.worst < dedupUi[u.t].worst) dedupUi[u.t] = u; }
    report[`${theme}:${accent}`] = {
      textRuns: txt.length, textMin: +txt[0].worst.toFixed(2), textFails: txt.filter((r) => r.worst < r.need).length,
      textWorst: txt.slice(0, 5).map((r) => `${r.worst.toFixed(2)} (need ${r.need}) "${r.t}" <${r.tag}> y=${r.at} bg=rgb(${r.bg.map(Math.round)})`),
      accentText: ['Manage providers', 'Read the docs', 'Primary', 'New session', 'Create', 'Ptah', 'Run setup'].map((n) => { const f = txt.filter((r) => r.t === n).sort((a, b4) => a.worst - b4.worst)[0]; return f ? `${n}: ${f.worst.toFixed(2)}` : null; }).filter(Boolean),
      ui: Object.values(dedupUi).map((u) => `${u.worst.toFixed(2)} (need 3) ${u.t} y=${u.at} bg=rgb(${u.bg.map(Math.round)})`),
    };
    await p.close();
  }
  await b.close();
  fs.writeFileSync(path.join(__dirname, process.env.MODAL ? '_measure-modal.json' : '_measure.json'), JSON.stringify(report, null, 1));
  for (const [k, v] of Object.entries(report)) console.log(k, 'text runs', v.textRuns, 'min', v.textMin, 'fails', v.textFails, '\n  ' + v.textWorst.slice(0, 3).join('\n  ') + '\n  accent text: ' + v.accentText.join(', ') + '\n  UI: ' + v.ui.join('\n      '));
})();
