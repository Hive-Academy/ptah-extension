const { chromium } = require('D:/projects/ptah-extension/node_modules/playwright');
const { pathToFileURL } = require('url');
const path = require('path');
(async () => {
  const b = await chromium.launch();
  const url = pathToFileURL(path.join(__dirname, 'index.html')).href;
  for (const t of ['dark', 'light']) {
    const p = await b.newPage({ viewport: { width: 1440, height: 900 } });
    await p.goto(url + (t === 'light' ? '?theme=light' : ''));
    await p.waitForTimeout(500);
    await p.screenshot({ path: path.join(__dirname, `shot-${t}-shell.png`) });
    await p.screenshot({ path: path.join(__dirname, `shot-${t}-full.png`), fullPage: true });
    await p.close();
  }
  await b.close();
})();
