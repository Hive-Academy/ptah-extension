const fs = require('fs');
const { connect, gotoAnalytics, inject } = require('./lib.cjs');
const OUT = __dirname;
(async () => {
  const { b, p } = await connect();
  await gotoAnalytics(p);
  await inject(p);
  const results = {};
  for (const theme of ['anubis', 'anubis-light', 'retro']) {
    await p.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
    for (const w of [1800, 1000, 420]) {
      await p.setViewportSize({ width: w, height: 2800 });
      await p.waitForTimeout(500);
      const sec = p.locator('h4:has-text("Provider accounts")').locator('xpath=..');
      await sec.scrollIntoViewIfNeeded(); await p.evaluate(()=>{const u=document.querySelector('h4');});
      await p.waitForTimeout(150);
      const m = await p.evaluate(() => {
        const h4 = [...document.querySelectorAll('h4')].find((h) => /Provider accounts/.test(h.textContent));
        const block = h4.parentElement;
        const de = document.documentElement;
        const scrollers = [...document.querySelectorAll('*')].filter((e) => e.scrollWidth > e.clientWidth + 1 && getComputedStyle(e).overflowX === 'visible' && e.closest('ul.rows'));
        const rows = [...document.querySelectorAll('ul.rows > li')].map((li) => {
          const s = li.querySelector('section');
          const lr = li.getBoundingClientRect();
          const h5 = s.querySelector('h5');
          const h5r = h5.getBoundingClientRect();
          const lh = parseFloat(getComputedStyle(h5).lineHeight);
          const loc = s.querySelector('.local');
          const ident = s.querySelector('.identity').getBoundingClientRect();
          const mid = s.querySelector('.mid');
          const act = s.querySelector('.actions').getBoundingClientRect();
          const overflowing = [...s.querySelectorAll('*')].filter((e) => e.getBoundingClientRect().right > lr.right + 0.5 || e.getBoundingClientRect().left < lr.left - 0.5).map((e) => e.tagName + '.' + (e.className?.toString().slice(0, 30) || ''));
          return {
            id: li.dataset.fixture || 'real:' + h5.textContent.trim().slice(0, 25),
            liW: Math.round(lr.width),
            h5W: Math.round(h5r.width), h5Lines: Math.round(h5r.height / lh),
            liScrollOverflow: li.scrollWidth - li.clientWidth,
            secScrollOverflow: s.scrollWidth - s.clientWidth,
            localBelowIdentity: loc ? Math.round(loc.getBoundingClientRect().top - ident.bottom) : null,
            localLeft: loc ? Math.round(loc.getBoundingClientRect().left - lr.left) : null,
            midTopVsIdentBottom: mid ? Math.round(mid.getBoundingClientRect().top - ident.bottom) : null,
            midOnSameLineAsIdentity: mid ? mid.getBoundingClientRect().top < ident.bottom : null,
            actionsRightGap: Math.round(lr.right - act.right),
            overflowing,
          };
        });
        return { docOverflow: de.scrollWidth - de.clientWidth, bodyOverflow: document.body.scrollWidth - innerWidth, iw: innerWidth, rows, scrollers: scrollers.length, culprit: (()=>{const cw=de.clientWidth;return [...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>cw+2&&e.getBoundingClientRect().width>0).slice(0,6).map(e=>e.tagName+'.'+String(e.className).slice(0,40)+' r='+Math.round(e.getBoundingClientRect().right));})() };
      });
      results[`${theme}@${w}`] = m;
      const name = `${theme}-${w}`;
      const box = await p.evaluate(() => { const h=[...document.querySelectorAll('h4')].find(x=>/Provider accounts/.test(x.textContent)).getBoundingClientRect(); const u=document.querySelector('ul.rows').getBoundingClientRect(); const sy=scrollY,sx=scrollX; return {x:Math.max(0,Math.min(h.left,u.left)-8)+sx,y:h.top+sy-8,width:Math.min(innerWidth,u.right-Math.min(h.left,u.left)+16),height:u.bottom-h.top+16}; });
      await p.screenshot({ path: `${OUT}/${name}.png`, clip: box });
    }
  }
  fs.writeFileSync(`${OUT}/metrics.json`, JSON.stringify(results, null, 1));
  await p.setViewportSize({ width: 1184, height: 735 });
  await b.close();
  for (const [k, v] of Object.entries(results)) {
    console.log(k, 'doc', v.docOverflow, 'body', v.bodyOverflow, JSON.stringify(v.culprit)); continue;
    for (const r of v.rows) console.log('  ', JSON.stringify(r));
  }
})();
