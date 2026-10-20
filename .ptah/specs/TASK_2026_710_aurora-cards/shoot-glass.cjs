// Screenshots glass/<set>/index.html in ptah-glass and ptah-glass-light.
// Usage: node shoot-glass.cjs a b
const path = require('path');
const fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['D:/projects/ptah-extension'] }));

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed ' + r.url()));
  for (const set of process.argv.slice(2)) {
    const file = path.join(__dirname, 'glass', set, 'index.html');
    const out = path.join(__dirname, 'screens', 'glass-' + set);
    fs.mkdirSync(out, { recursive: true });
    await page.goto('file:///' + file.replace(/\\/g, '/'));
    await page.waitForTimeout(1500);
    for (const theme of ['ptah-glass', 'ptah-glass-light']) {
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(500);
      await page.screenshot({ path: path.join(out, `${theme}-top.png`) });
      await page.screenshot({ path: path.join(out, `${theme}-full.png`), fullPage: true });
    }
  }
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
