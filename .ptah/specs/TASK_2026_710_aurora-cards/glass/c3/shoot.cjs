// usage: node shoot.cjs            -> all C3 screenshots into shots/
//        node shoot.cjs quick      -> ptah-glass gold + violet only (fast iteration)
const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const { pathToFileURL } = require('url');
const path = require('path');
const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
const out = (n) => path.join(__dirname, 'shots', n + '.png');

const JOBS = [];
for (const t of ['ptah-glass', 'ptah-glass-light']) for (const a of ['gold', 'violet', 'teal']) JOBS.push({ name: `${t}-${a}-shell`, q: `theme=${t}&accent=${a}` });
for (const t of ['dracula', 'nord', 'cupcake', 'lofi']) JOBS.push({ name: `${t}-shell`, q: `theme=${t}&accent=violet` }); // violet set on purpose: must not leak
JOBS.push({ name: 'ptah-glass-gold-modal', q: 'theme=ptah-glass&modal=1' });
JOBS.push({ name: 'ptah-glass-violet-modal', q: 'theme=ptah-glass&accent=violet&modal=1' });

(async () => {
  const quick = process.argv[2] === 'quick';
  const b = await chromium.launch();
  for (const j of JOBS) {
    if (quick && !/^ptah-glass-(gold|violet)-shell$/.test(j.name)) continue;
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(url + '?' + j.q);
    await p.waitForTimeout(500);
    await p.screenshot({ path: out(j.name) });
    if (j.name === 'ptah-glass-gold-shell') {
      await p.evaluate(() => scrollTo(0, 940));
      await p.waitForTimeout(300);
      await p.screenshot({ path: out('ptah-glass-gold-scrolled') });
    }
    await p.close();
  }
  await b.close();
})();
