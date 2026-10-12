const fs = require('fs');
const { connect, gotoAnalytics, inject } = require('./lib.cjs');
const OUT = __dirname;
const axeSrc = fs.readFileSync(require.resolve('axe-core/axe.min.js'), 'utf8');
(async () => {
  const { b, p } = await connect();
  await gotoAnalytics(p);
  await inject(p);
  await p.setViewportSize({ width: 1400, height: 2800 });
  const res = { contrast: {}, axe: {}, a11y: null, focus: {} };
  for (const theme of ['anubis', 'anubis-light', 'retro']) {
    await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    await p.waitForTimeout(300);
    res.contrast[theme] = await p.evaluate(() => {
      const cv = document.createElement('canvas'); cv.width = cv.height = 1;
      const cx = cv.getContext('2d', { willReadFrequently: true });
      const parse = (c) => { cx.clearRect(0, 0, 1, 1); cx.fillStyle = '#000'; cx.fillStyle = c; cx.fillRect(0, 0, 1, 1); const d = cx.getImageData(0, 0, 1, 1).data; return [d[0], d[1], d[2], d[3] / 255]; };
      const over = (f, bg) => [0, 1, 2].map((i) => f[i] * f[3] + bg[i] * (1 - f[3]));
      const bgOf = (el) => { const stack = []; for (let e = el; e; e = e.parentElement) { const c = parse(getComputedStyle(e).backgroundColor); if (c[3] > 0) stack.push(c); if (c[3] >= 1) break; } let base = [255, 255, 255]; if (!stack.length || stack[stack.length - 1][3] < 1) base = parse(getComputedStyle(document.body).backgroundColor).slice(0, 3); for (const c of stack.reverse()) base = over(c, base); return base; };
      const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
      const cr = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((m, n) => n - m); return +((x + 0.05) / (y + 0.05)).toFixed(2); };
      const txt = (el) => { const bg = bgOf(el); const f = parse(getComputedStyle(el).color); return cr(over(f, bg), bg); };
      const out = [];
      const add = (label, sel, root = document) => { const el = root.querySelector(sel); if (el) out.push({ label, ratio: txt(el), fs: getComputedStyle(el).fontSize, need: 4.5 }); };
      const fx = document.querySelector('[data-fixture=claude-full]');
      const real = document.querySelector('ul.rows > li');
      add('name h5 (real)', 'h5', real);
      add('subtitle', '.identity span.text-\\[10px\\]', real);
      add('status chip badge (real)', '[data-testid=status-chip]', real);
      add('source chip', '[data-testid=source-chip]', fx);
      add('compact reason (real)', '[data-testid=compact-reason]', real);
      add('compact reason warning box', '[data-testid=compact-reason]', document.querySelector('[data-fixture=long]'));
      add('warn badge Cached data', '[data-testid=status-chip]', document.querySelector('[data-fixture=long]'));
      const wr = [...fx.querySelectorAll('[data-testid=window-row]')];
      add('window name', '.win-top .font-semibold', fx);
      add('window value', '[data-testid=window-value]', fx);
      add('reset text (muted)', '.win > div:last-child span', fx);
      wr.forEach((w) => { const c = w.querySelector('[data-testid=state-chip]'); if (c) out.push({ label: 'state chip ' + c.textContent.trim(), ratio: txt(c), fs: getComputedStyle(c).fontSize, need: 4.5 }); });
      add('local usage label', '.local p', document.querySelector('[data-fixture=opencode-local]'));
      add('local caption', '.local p:last-child', document.querySelector('[data-fixture=opencode-local]'));
      add('refresh button glyph', '.actions button', real);
      // non-text: bar fill vs track-composited and vs section bg
      const sec = fx.querySelector('section'); const secBg = bgOf(sec);
      const bars = [...fx.querySelectorAll('[data-testid=window-progress]')].map((bar) => {
        const fill = bar.firstElementChild; const track = over(parse(getComputedStyle(bar).backgroundColor), secBg);
        const fc = parse(getComputedStyle(fill).backgroundColor).slice(0, 3);
        return { name: bar.getAttribute('aria-label'), fillVsSection: cr(fc, secBg), fillVsTrack: cr(fc, track), trackVsSection: cr(track, secBg), cls: fill.className.replace(/h-full rounded ?/, '') };
      });
      const accent = [...document.querySelectorAll('ul.rows > li section')].map((s) => ({ accent: getComputedStyle(s).borderLeftColor, ratio: cr(parse(getComputedStyle(s).borderLeftColor).slice(0, 3), secBg) }));
      return { text: out, bars, accent };
    });
    // axe on the list block
    await p.evaluate(axeSrc);
    res.axe[theme] = await p.evaluate(async () => {
      const root = document.querySelector('ul.rows').closest('section, div');
      const r = await axe.run(document.querySelector('ul.rows').parentElement, { resultTypes: ['violations'] });
      return r.violations.map((v) => ({ id: v.id, impact: v.impact, n: v.nodes.length, sample: v.nodes[0].target.join(' ').slice(0, 120), real: v.nodes.filter((n) => !n.html.includes('data-fixture') && !n.target.join(' ').includes('fixture')).length }));
    });
  }
  // semantics + focus (retro current theme -> set anubis)
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'anubis'));
  res.a11y = await p.evaluate(() => {
    const ul = document.querySelector('ul.rows');
    const hs = [...document.querySelectorAll('h3,h4,h5')].filter((h) => h.closest('section') || h.textContent.includes('Provider accounts')).map((h) => h.tagName + ':' + h.textContent.trim().slice(0, 30));
    return {
      ulChildrenAreLi: [...ul.children].every((c) => c.tagName === 'LI'), liCount: ul.children.length, ulRole: ul.getAttribute('role'), listStyle: getComputedStyle(ul).listStyleType,
      headings: hs.slice(0, 20),
      sections: [...ul.querySelectorAll('section')].map((s) => s.getAttribute('aria-label')).slice(0, 4),
      progress: [...ul.querySelectorAll('[role=progressbar]')].map((e) => [e.getAttribute('aria-label'), e.getAttribute('aria-valuenow'), e.getAttribute('aria-valuetext')]),
      btn: [...ul.querySelectorAll('button')].map((e) => { const r = e.getBoundingClientRect(); return [e.getAttribute('aria-label').slice(0, 40), Math.round(r.width) + 'x' + Math.round(r.height)]; }),
    };
  });
  // keyboard focus on refresh buttons
  await p.locator('ul.rows li:first-child button').focus();
  await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  res.focus.first = await p.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); return { label: e.getAttribute('aria-label'), outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, shadow: cs.boxShadow.slice(0, 80), matchesFocusVisible: e.matches(':focus-visible') }; });
  const li = p.locator('ul.rows li:first-child');
  await li.screenshot({ path: `${OUT}/focus-refresh-anubis.png` });
  // tab order through refresh buttons
  const order = [];
  for (let i = 0; i < 12; i++) { await p.keyboard.press('Tab'); order.push(await p.evaluate(() => (document.activeElement.getAttribute('aria-label') || document.activeElement.tagName).slice(0, 40))); }
  res.focus.order = order;
  await p.evaluate(() => document.documentElement.setAttribute('data-theme', 'anubis-light'));
  await p.locator('ul.rows li:first-child button').focus(); await p.keyboard.press('Shift+Tab'); await p.keyboard.press('Tab');
  res.focus.lightFirst = await p.evaluate(() => { const cs = getComputedStyle(document.activeElement); return cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor + ' | ' + cs.boxShadow.slice(0, 60); });
  await li.screenshot({ path: `${OUT}/focus-refresh-anubis-light.png` });
  fs.writeFileSync(`${OUT}/a11y.json`, JSON.stringify(res, null, 1));
  // restore: remove fixtures, theme retro, viewport
  await p.evaluate(() => { document.querySelectorAll('[data-fixture]').forEach((e) => e.remove()); document.documentElement.setAttribute('data-theme', 'retro'); });
  const cdp = await p.context().newCDPSession(p); await cdp.send('Emulation.clearDeviceMetricsOverride');
  await b.close();
  console.log(JSON.stringify(res));
})();
