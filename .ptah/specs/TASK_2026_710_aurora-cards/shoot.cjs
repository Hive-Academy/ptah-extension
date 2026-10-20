// Screenshots every prototype page in dark and light at 1280x800.
// Usage: node shoot.cjs a=anubis,anubis-light [b=dark,light ...]
const path = require('path');
const fs = require('fs');
const { chromium } = require(require.resolve('playwright', { paths: ['D:/projects/ptah-extension'] }));

const root = __dirname;
const pages = ['setup-card', 'welcome', 'empty-state', 'boot'];

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  page.on('requestfailed', (r) => errors.push('requestfailed ' + r.url()));
  // Each arg: <set>=<darkThemeValue>,<lightThemeValue>
  for (const arg of process.argv.slice(2)) {
    const [set, themeList] = arg.split('=');
    const [darkValue, lightValue] = themeList.split(',');
    const out = path.join(root, 'screens', set);
    fs.mkdirSync(out, { recursive: true });
    const dir = path.join(root, 'prototype', set);
    const names = fs.readdirSync(dir)
      .filter((f) => f.endsWith('.html') && pages.some((p) => f.startsWith(p)))
      .map((f) => f.replace(/\.html$/, ''));
    if (names.length === 0) errors.push('no pages in ' + dir);
    for (const name of names) {
      const file = path.join(dir, name + '.html');
      await page.goto('file:///' + file.replace(/\\/g, '/'));
      await page.waitForTimeout(1200);
      for (const [theme, value] of [['dark', darkValue], ['light', lightValue]]) {
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), value);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, `${name}-${theme}.png`), fullPage: true });
      }
      // Chat-column fit check: the setup card and empty state live in a ~600px column.
      if (name.startsWith('setup-card') || name.startsWith('empty-state')) {
        await page.setViewportSize({ width: 640, height: 800 });
        await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), darkValue);
        await page.waitForTimeout(400);
        await page.screenshot({ path: path.join(out, `${name}-narrow.png`), fullPage: true });
        await page.setViewportSize({ width: 1280, height: 800 });
      }
    }
  }
  console.log(errors.length ? errors.join('\n') : 'no errors');
  await browser.close();
})();
