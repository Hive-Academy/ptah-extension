// Prototype interaction smoke test (not product code): node smoke.mjs <variant> [...]
// Clicks each visible button / clickable row on a fresh page and records which overlay
// (role=dialog, aside, [popover], .drawer, .modal) becomes visible. Saves a screenshot of the
// first three distinct overlays.
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const overlaySel = '[role="dialog"], [role="menu"], [role="listbox"], aside, [popover]';
const visibleOverlays = (sel) =>
  [...document.querySelectorAll(sel)]
    .filter((e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 40 && r.height > 40 && s.visibility !== 'hidden' && s.display !== 'none' && s.opacity !== '0'; })
    .map((e) => e.id || e.getAttribute('aria-label') || e.className.toString().slice(0, 40));

const browser = await chromium.launch();
for (const variant of process.argv.slice(2)) {
  const out = join(root, variant, 'screenshots', 'interactions');
  mkdirSync(out, { recursive: true });
  for (const pageName of ['index', 'orchestration']) {
    const url = pathToFileURL(join(root, variant, `${pageName}.html`)).href;
    const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(url, { waitUntil: 'networkidle' });
    const baseline = await page.evaluate(visibleOverlays, overlaySel);
    const count = await page.locator('main button, main [role="button"], main tr[tabindex], main li[tabindex], main [data-row], body > div button').count();
    const opened = new Map();
    let shots = 0;
    for (let i = 0; i < Math.min(count, 40); i++) {
      await page.goto(url, { waitUntil: 'networkidle' });
      const el = page.locator('main button, main [role="button"], main tr[tabindex], main li[tabindex], main [data-row], body > div button').nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const label = ((await el.innerText().catch(() => '')) || (await el.getAttribute('aria-label')) || '').trim().replace(/\s+/g, ' ').slice(0, 40);
      await el.click({ timeout: 1500 }).catch(() => {});
      await page.waitForTimeout(250);
      const now = (await page.evaluate(visibleOverlays, overlaySel)).filter((o) => !baseline.includes(o));
      for (const o of now) {
        if (!opened.has(o)) {
          opened.set(o, label);
          if (shots < 3) { await page.screenshot({ path: join(out, `${pageName}-${++shots}.png`) }); }
        }
      }
    }
    const opens = [...opened].map(([o, l]) => `${o} <- "${l}"`);
    console.log(`${variant}/${pageName}: baselineOverlays=${baseline.length} clickables=${count} distinctOverlaysOpened=${opened.size}`);
    for (const line of opens.slice(0, 12)) console.log(`   ${line}`);
    if (errors.length) console.log(`   JS errors: ${JSON.stringify(errors.slice(0, 3))}`);
    await page.close();
  }
}
await browser.close();
