import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from '@playwright/test';
import { startServer } from './serve.mjs';

const spike = dirname(fileURLToPath(import.meta.url));
const evidence = join(spike, 'evidence');
await mkdir(evidence, { recursive: true });
const run = { requests: [], misses: [], rpcCalls: [], outboundTypes: [], consoleErrors: [], blockedExternal: [], timings: {}, sizes: null, page: {} };
let service;
let browser;
let page;
try {
  service = await startServer(Number(process.env.PORT || 0));
  run.sizes = service.size;
  browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'dark' });
  page = await context.newPage();
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (new URL(url).origin !== new URL(service.url).origin) {
      run.blockedExternal.push(url);
      await route.abort('internetdisconnected');
      return;
    }
    await route.continue();
  });
  const t0 = performance.now();
  page.on('request', (request) => run.requests.push({ url: request.url(), method: request.method(), resourceType: request.resourceType(), bytes: null }));
  page.on('response', async (response) => {
    const row = run.requests.find((r) => r.url === response.url() && r.bytes === null);
    if (row) {
      row.status = response.status();
      const headers = await response.allHeaders().catch(() => ({}));
      row.bytes = Number(headers['content-length']) || 0;
    }
  });
  page.on('console', (message) => { if (message.type() === 'error') run.consoleErrors.push(message.text()); });
  page.on('pageerror', (error) => run.consoleErrors.push('pageerror: ' + error.message));
  await page.goto(service.url + '?autoplay=0', { waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => window.__ptahReplay?.state?.ready, undefined, { timeout: 20000 });
  await page.waitForTimeout(700);
  run.page.bootStorage = await page.evaluate(() => Object.fromEntries(Object.entries(localStorage).filter(([key]) => key.startsWith('ptah.tabs')).map(([key,value]) => [key, value.slice(0, 1800)])));
  run.page.bootButtons = await page.locator('button').allTextContents();
  run.timings.shellReadyMs = Math.round(performance.now() - t0);
  run.timings.firstContentfulPaintMs = await page.evaluate(() => performance.getEntriesByType('paint').find((p) => p.name === 'first-contentful-paint')?.startTime ?? null);
  await page.screenshot({ path: join(evidence, 'boot.png'), fullPage: false });
  await page.evaluate(() => window.__ptahReplay.play());
  await page.waitForFunction(() => window.__ptahReplay?.state?.index >= 6, undefined, { timeout: 12000 });
  await page.screenshot({ path: join(evidence, 'mid-stream.png'), fullPage: false });
  await page.waitForFunction(() => window.__ptahReplay?.state?.complete, undefined, { timeout: 12000 });
  await page.waitForTimeout(300);
  await page.getByText('Worked', { exact: true }).click();
  await page.getByText('Read', { exact: true }).waitFor({ timeout: 3000 });
  await page.waitForTimeout(350);
  run.timings.playbackEndMs = Math.round(performance.now() - t0);
  await page.screenshot({ path: join(evidence, 'complete.png'), fullPage: false });
  const data = await page.evaluate(() => ({
    misses: window.__ptahReplay.misses,
    rpcCalls: window.__ptahReplay.rpcCalls,
    outboundTypes: window.__ptahReplay.outbound.map((m) => m?.type ?? null),
    state: window.__ptahReplay.state,
    url: location.href,
    text: document.body.innerText.slice(0, 12000),
    appRootHtmlLength: document.querySelector('app-root')?.innerHTML.length ?? 0,
  }));
  Object.assign(run, { misses: data.misses, rpcCalls: data.rpcCalls, outboundTypes: data.outboundTypes });
  run.rendered = { userPrompt: data.text.includes('Can you find where the app starts?'), assistantFinal: data.text.includes('The app starts in src/main.ts'), toolCall: data.text.includes('Read') };
  if (!Object.values(run.rendered).every(Boolean)) throw new Error('Replay content was not fully rendered: ' + JSON.stringify(run.rendered));
  run.page = { ...run.page, url: data.url, text: data.text, appRootHtmlLength: data.appRootHtmlLength, state: data.state };
  const requestedPaths = new Set(run.requests.filter((r) => r.status === 200).map((r) => new URL(r.url).pathname));
  run.sizes.initialLoad = service.size.files.filter((f) => requestedPaths.has(f.path)).reduce((sum, f) => ({ raw: sum.raw + f.raw, gzip: sum.gzip + f.gzip, brotli: sum.brotli + f.brotli }), { raw: 0, gzip: 0, brotli: 0 });
  console.log(JSON.stringify({ timings: run.timings, rpcCalls: run.rpcCalls, misses: run.misses, consoleErrors: run.consoleErrors, initialLoad: run.sizes.initialLoad, text: run.page.text.slice(0, 1000) }, null, 2));
} catch (error) {
  run.error = String(error?.stack || error);
  if (page) {
    try {
      run.page = await page.evaluate(() => ({ url: location.href, text: document.body?.innerText?.slice(0, 12000), state: window.__ptahReplay?.state, bridgePresent: !!window.__ptahReplay }));
      run.misses = await page.evaluate(() => window.__ptahReplay?.misses ?? []);
      run.rpcCalls = await page.evaluate(() => window.__ptahReplay?.rpcCalls ?? []);
      run.outboundTypes = await page.evaluate(() => window.__ptahReplay?.outbound?.map((m) => m?.type) ?? []);
      await page.screenshot({ path: join(evidence, 'failure.png'), fullPage: false });
    } catch (inspectionError) { run.inspectionError = String(inspectionError); }
  }
  console.error(run.error);
  process.exitCode = 1;
} finally {
  await writeFile(join(evidence, 'run.json'), JSON.stringify(run, null, 2) + '\n');
  await browser?.close();
  await service?.close();
}
