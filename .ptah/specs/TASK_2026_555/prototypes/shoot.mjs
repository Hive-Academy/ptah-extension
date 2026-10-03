// Prototype screenshot helper (not product code): node shoot.mjs <variant> [<variant> ...]
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const variants = process.argv.slice(2);
const browser = await chromium.launch();
for (const variant of variants) {
  const out = join(root, variant, 'screenshots');
  mkdirSync(out, { recursive: true });
  for (const pageName of ['index', 'orchestration']) {
    for (const theme of ['anubis', 'anubis-light']) {
      const page = await browser.newPage({ viewport: { width: 1024, height: 768 } });
      const errors = [];
      page.on('pageerror', (e) => errors.push(e.message));
      page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
      await page.goto(pathToFileURL(join(root, variant, `${pageName}.html`)).href, { waitUntil: 'networkidle' });
      await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
      await page.waitForTimeout(400);
      const h = await page.evaluate(() => document.documentElement.scrollHeight);
      const base = `${pageName}-${theme}`;
      await page.screenshot({ path: join(out, `${base}-1024x768.png`) });
      await page.screenshot({ path: join(out, `${base}-full.png`), fullPage: true });
      console.log(`${variant} ${base}: scrollHeight=${h}${errors.length ? ` errors=${JSON.stringify(errors.slice(0, 3))}` : ''}`);
      await page.close();
    }
  }
}
await browser.close();
