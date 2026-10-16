// Delta 2 capture + checks (prototype tool, not product code). Needs Playwright from the main checkout.
//   node capture-delta2.mjs shots   -> ../screenshots/delta2-*.png (dark + light per option, tiles)
//   node capture-delta2.mjs checks  -> target-size audit, keyboard model checks, console errors
// Serves the prototype folder on 127.0.0.1 (random port) and stops it when done.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');
const pw = process.env.PLAYWRIGHT_ENTRY || 'D:/projects/ptah-extension/node_modules/playwright/index.mjs';
const { chromium } = await import(pathToFileURL(pw).href);
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!p.startsWith(root) || !fs.existsSync(p) || fs.statSync(p).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' });
  fs.createReadStream(p).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const url = `http://127.0.0.1:${server.address().port}/options-delta-2.html`;
const mode = process.argv[2] || 'shots';
const browser = await chromium.launch();
const out = path.join(root, 'screenshots');
try {
  const ctx = await browser.newContext({ viewport: { width: 1700, height: 1000 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(url);
  await page.waitForSelector('html[data-ready="1"]');
  await page.waitForTimeout(600);
  if (mode === 'shots') {
    const ids = ['tiles', 'A', 'B', 'C'];
    for (const id of ids) for (const th of ['dark', 'light']) {
      const el = page.locator(`#box-${id}-${th}`);
      await el.screenshot({ path: path.join(out, `delta2-${id === 'tiles' ? 'tiles' : 'option-' + id}-${th}.png`) });
      console.log('wrote', `delta2-${id === 'tiles' ? 'tiles' : 'option-' + id}-${th}.png`);
    }
  } else {
    // target-size audit: every interactive element in each live (first, 4th) frame of each option >= 24x24
    const bad = await page.evaluate(() => {
      const res = [];
      document.querySelectorAll('.themebox button, .themebox [role="option"]').forEach((b) => {
        if (b.closest('[hidden]') || b.closest('.pop[hidden]')) return;
        const r = b.getBoundingClientRect();
        if (r.width === 0) return;
        if (r.width < 24 || r.height < 24) res.push((b.className || b.tagName) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
      });
      return res;
    });
    console.log('targets below 24x24:', bad.length ? bad.slice(0, 20) : 'none');
    // keyboard model: option A arrows, option C listbox
    const a = page.locator('#box-A-dark .inst').first();
    await a.locator('[role=tab][aria-selected=true]').focus();
    await page.keyboard.press('ArrowRight');
    console.log('A selected after ArrowRight:', await a.locator('[role=tab][aria-selected=true]').getAttribute('data-k'));
    const c = page.locator('#box-C-dark .inst').first();
    await c.locator('[data-trig]').focus();
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    console.log('C trigger text after Down,Down,Enter:', (await c.locator('[data-trig] b').innerText()));
    // overflow counts
    console.log('A narrow visible tabs:', await page.locator('#box-A-dark .inst--narrow').first().locator('.a-tab:not([hidden])').count(), ' more label:', await page.locator('#box-A-dark .inst--narrow .a-more__t').first().innerText());
    console.log('B narrow visible chips:', await page.locator('#box-B-dark .inst--narrow').first().locator('.b-item:not([hidden])').count());
  }
  console.log('console/page errors:', errors.length ? errors : 'none');
} finally {
  await browser.close();
  server.close();
}
