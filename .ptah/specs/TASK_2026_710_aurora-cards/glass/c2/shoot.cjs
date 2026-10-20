const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const { pathToFileURL } = require('url'); const path = require('path');
const REG = require('./registry.cjs');
(async () => {
  const b = await chromium.launch();
  const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
  const only = process.argv.slice(2);
  for (const t of Object.keys(REG)) {
    if (only.length && !only.includes(t)) continue;
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(url + '?theme=' + t);
    await p.waitForTimeout(400);
    await p.screenshot({ path: path.join(__dirname, 'shots', t + '-shell.png') });
    if (t.startsWith('ptah') || t === 'nord') {
      for (const y of [940, 1850]) { await p.evaluate((y) => scrollTo(0, y), y); await p.waitForTimeout(250); await p.screenshot({ path: path.join(__dirname, 'shots', `${t}-scroll-${y}.png`) }); }
    }
    await p.close();
  }
  await b.close();
})();
