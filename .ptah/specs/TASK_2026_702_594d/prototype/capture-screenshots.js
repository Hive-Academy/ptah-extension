const { chromium } = require('playwright');
const path = require('path');
const { pathToFileURL } = require('url');

const root = __dirname;
const target = pathToFileURL(path.join(root, 'start-screen.html')).href;
const shots = [
  ['dark-empty', 'dark', 'first-run', 1440],
  ['light-empty', 'light', 'first-run', 1440],
  ['dark-partly', 'dark', 'partly-ready', 1440],
  ['light-partly', 'light', 'partly-ready', 1440],
  ['dark-ready-recent', 'dark', 'all-ready', 1440],
  ['light-ready-recent', 'light', 'all-ready', 1440],
  ['dark-cap', 'dark', 'running-cap', 1440],
  ['dark-popover', 'dark', 'name-popover', 1440],
  ['dark-layout-warning', 'dark', 'layout-warning', 1440],
  ['dark-layout-warning-tiles', 'dark', 'layout-warning-tiles', 1440],
  ['dark-reduced', 'dark', 'reduced-motion', 1440],
  ['dark-800', 'dark', 'first-run', 800],
  ['dark-single-chat', 'dark', 'single-chat', 900],
  ['dark-single-chat-280', 'dark', 'single-chat', 280],
  ['dark-single-chat-ready-280', 'dark', 'single-chat-ready', 280],
  ['light-single-chat', 'light', 'single-chat-ready', 900],
];

(async () => {
  const browser = await chromium.launch({ headless: true });
  for (const [name, theme, state, width] of shots.filter(([name]) => process.argv.length <= 2 || process.argv.slice(2).includes(name))) {
    const page = await browser.newPage({ viewport: { width, height: 900 }, deviceScaleFactor: 1 });
    page.on('pageerror', error => console.error(`${name}: ${error.message}`));
    await page.goto(`${target}?theme=${theme}&state=${state}`);
    if (name === 'dark-single-chat-280') await page.setViewportSize({width:280,height:900});
    await page.waitForTimeout(450);
    await page.screenshot({ path: path.join(root, 'screenshots', `${name}.png`) });
    console.log(name);
    await page.close();
  }
  await browser.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
