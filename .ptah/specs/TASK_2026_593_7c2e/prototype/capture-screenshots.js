const fs = require('fs');
const path = require('path');
const { chromium } = require(require.resolve('playwright', { paths: ['D:/projects/ptah-extension/node_modules'] }));
const writeScreenshot = (file, png) => {
  for (let attempt = 0; attempt < 6; attempt++) {
    try { fs.writeFileSync(file, png); return; }
    catch (error) {
      if (error.code !== 'UNKNOWN' || attempt === 5) throw error;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 200);
    }
  }
};

(async () => {
  const dir = __dirname;
  const out = path.join(dir, 'screenshots');
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ headless: true });
  const cases = [
    ['dark-snackbar-permission', 'dark', 'permission', 1440],
    ['light-snackbar-permission', 'light', 'permission', 1440],
    ['dark-snackbar-question', 'dark', 'question', 1440],
    ['light-snackbar-question', 'light', 'question', 1440],
    ['dark-snackbar-lane', 'dark', 'lane', 1440],
    ['dark-focused', 'dark', 'focused', 1440],
    ['dark-snackbar-stack', 'dark', 'stack', 1440],
    ['light-snackbar-stack', 'light', 'stack', 1440],
    ['dark-snackbar-failure', 'dark', 'failure', 1440],
    ['light-snackbar-failure', 'light', 'failure', 1440],
    ['dark-failed-turn', 'dark', 'failed-turn', 1440],
    ['dark-notice-info', 'dark', 'local-info', 1440],
    ['dark-git-warning', 'dark', 'git-warning', 1440],
    ['light-git-warning', 'light', 'git-warning', 1440],
    ['dark-git-open', 'dark', 'git-open', 1440],
    ['dark-panel', 'dark', 'panel', 1440],
    ['light-panel', 'light', 'panel', 1440],
    ['dark-panel-empty', 'dark', 'empty', 1440],
    ['light-panel-empty', 'light', 'empty', 1440],
    ['dark-bell-badge', 'dark', 'bell-badge', 1440],
    ['dark-os-windows', 'dark', 'os-windows', 1440],
    ['dark-vscode', 'dark', 'vscode', 1440],
    ['light-vscode', 'light', 'vscode', 1440],
    ['dark-800', 'dark', 'stack', 800],
    ['light-800', 'light', 'stack', 800],
    ['dark-sidebar-snackbar', 'dark', 'stack', 400, 800],
    ['dark-sidebar-panel', 'dark', 'panel', 400, 800],
  ];
  for (const [name, theme, state, width, caseHeight = 900] of cases) {
    const page = await browser.newPage({ viewport: { width, height: caseHeight }, deviceScaleFactor: 1, reducedMotion: 'reduce' });
    page.on('pageerror', error => { throw error; });
    await page.goto('file:///' + path.join(dir, 'notifications.html').replace(/\\/g, '/') + `?theme=${theme}&state=${state}`);
    await page.evaluate(() => document.fonts.ready);
    const metrics = await page.evaluate(() => {
      const composer = document.querySelector('.composer').getBoundingClientRect();
      const tabs = document.querySelector('.tabs').getBoundingClientRect();
      const snacks = [...document.querySelectorAll('.snack')].map(n => n.getBoundingClientRect()).filter(n => n.width > 0 && n.height > 0);
      const collision = snacks.some(n => !(n.bottom < composer.top || n.top > composer.bottom) || n.top < tabs.bottom);
      return { overflow: document.documentElement.scrollWidth > innerWidth, collision };
    });
    if (metrics.overflow || metrics.collision) throw new Error(`${name}: ${JSON.stringify(metrics)}`);
    const png = await page.screenshot(name === 'dark-bell-badge' ? { clip: { x: 1200, y: 0, width: 240, height: 110 } } : {});
    writeScreenshot(path.join(out, `${name}.png`), png);
    if (png.readUInt32BE(16) !== (name === 'dark-bell-badge' ? 240 : width) || png.readUInt32BE(20) !== (name === 'dark-bell-badge' ? 110 : caseHeight)) throw new Error(`${name}: wrong dimensions`);
    console.log(`${name}.png OK`);
    await page.close();
  }
  for (const theme of ['dark', 'light']) {
    const page = await browser.newPage();
    await page.goto('file:///' + path.join(dir, 'notifications.html').replace(/\\/g, '/') + `?theme=${theme}&state=panel`);
    const results = await page.evaluate(() => {
      const colors = getComputedStyle(document.documentElement);
      const toRgb = input => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
        const ctx = canvas.getContext('2d'); ctx.fillStyle = input; ctx.fillRect(0, 0, 1, 1);
        return [...ctx.getImageData(0, 0, 1, 1).data].slice(0, 3);
      };
      const L = rgb => rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }).reduce((a, v, i) => a + v * [.2126, .7152, .0722][i], 0);
      const pairs = [['body', '--bc', '--b1'], ['panel', '--bc', '--b3'], ['panel-muted', '--muted', '--b3'], ['row', '--bc', '--b2'], ['row-muted', '--muted', '--b2'], ['primary-button', '--primary-content', '--primary'], ['badge', '--badge-text', '--warning'], ['warning-icon', '--warning', '--b3'], ['error-icon', '--error', '--b3']];
      return pairs.map(([name, fg, bg]) => { const a = L(toRgb(colors.getPropertyValue(fg))), b = L(toRgb(colors.getPropertyValue(bg))); return [name, +((Math.max(a,b)+.05)/(Math.min(a,b)+.05)).toFixed(2)]; });
    });
    console.log(theme, JSON.stringify(results));
    if (results.some(([name, ratio]) => ratio < (name.endsWith('-icon') ? 3 : 4.5))) throw new Error(`${theme}: contrast below 4.5:1`);
    await page.close();
  }
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
