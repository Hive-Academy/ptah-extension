/**
 * R10 visual RE-CHECK capture script for TASK_2026_494 (Apps page).
 *
 * Targeted follow-up to `apps-visual.e2e.spec.ts` (the original R10 review
 * script). Does not touch that file, its screenshots, or visual-review.md.
 * Reuses the same fixture-server / Electron-host / RPC-stub approach.
 *
 * Checks only:
 *  1. The 560-620px band (widths 560/590/604/605/606/607/620): stacked
 *     below 606, side-by-side at >=606, surface panel >= 360px when
 *     side-by-side, no torn frame (grid vs splitter disagreement).
 *  2. Boundary settle: resize across 605<->606 five times; after each
 *     settle the grid and the splitter visibility must agree.
 *  3. Stat tiles (dark + light): several-across layout, contrast.
 *  4. Splitter accessibility snapshot at >=606px (exactly one separator,
 *     aria-valuenow/min/max, focusable) and <606px (no separator in the
 *     a11y tree, nothing focusable in the hidden slot).
 */
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { installCspStub } from '../../../../libs/frontend/webview-e2e-harness/src/lib/csp-stub';

const SHOT_DIR = join(__dirname, 'screenshots', 'r10-recheck');
mkdirSync(SHOT_DIR, { recursive: true });

const MIME: Readonly<Record<string, string>> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json; charset=utf-8',
};

async function startLocalFixtureServer(): Promise<{ url: string; close: () => Promise<void> }> {
  const rootDir = resolve(__dirname, '../../../../dist/apps/ptah-extension-webview/browser');
  if (!existsSync(rootDir)) {
    throw new Error(`Webview build not found at ${rootDir}. Run "npm run build:webview" first.`);
  }
  const server: Server = createServer((req, res) => {
    const urlPath = req.url ?? '/';
    const requested = urlPath === '/' ? '/index.html' : urlPath.split('?')[0];
    const filePath = join(rootDir, decodeURIComponent(requested));
    let stat;
    try {
      stat = statSync(filePath);
    } catch {
      const indexPath = join(rootDir, 'index.html');
      res.writeHead(200, { 'content-type': MIME['.html'] });
      createReadStream(indexPath).pipe(res);
      return;
    }
    if (stat.isDirectory()) {
      res.writeHead(200, { 'content-type': MIME['.html'] });
      createReadStream(join(filePath, 'index.html')).pipe(res);
      return;
    }
    const contentType = MIME[extname(filePath).toLowerCase()] ?? 'application/octet-stream';
    res.writeHead(200, { 'content-type': contentType, 'cache-control': 'no-store' });
    createReadStream(filePath).pipe(res);
  });
  await new Promise<void>((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', () => resolveListen());
  });
  const address = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () => new Promise<void>((res, rej) => server.close((err) => (err ? rej(err) : res()))),
  };
}

async function shot(page: Page, name: string): Promise<void> {
  await page.screenshot({ path: join(SHOT_DIR, `${name}.png`) });
}

const STATIC_RPC_FIXTURES: Record<string, unknown> = {
  'workspace:getInfo': { folders: ['C:\\ptah-e2e-ws'], activeFolder: 'C:\\ptah-e2e-ws' },
  'workspace:switch': { success: true },
  'chat:continue': { success: true },
  'chat:abort': { success: true },
  'surface:change': { status: 'applied', revision: 1 },
  'surface:select': { status: 'applied', revision: 1 },
};

async function installAppsElectronHost(page: Page, theme: 'anubis' | 'anubis-light'): Promise<void> {
  await page.addInitScript(
    ({ fixtures, theme }: { fixtures: Record<string, unknown>; theme: string }) => {
      const w = window as unknown as {
        acquireVsCodeApi?: () => {
          postMessage: (msg: unknown) => void;
          getState: () => unknown;
          setState: (s: unknown) => void;
        };
        vscode?: unknown;
        ptahConfig?: unknown;
        __ptahTabIds?: string[];
        __ptahOverrides?: Record<string, { data: unknown; delay: number } | undefined>;
        __ptahOverride?: (method: string, data: unknown, delayMs?: number) => void;
      };
      w.__ptahTabIds = [];
      w.__ptahOverrides = {};
      w.__ptahOverride = (method, data, delayMs) => {
        w.__ptahOverrides![method] = { data, delay: delayMs ?? 0 };
      };
      const outboundBuf: unknown[] = [];
      (w as unknown as { acquireVsCodeApi: () => unknown }).acquireVsCodeApi = () => ({
        postMessage: (msg: unknown) => outboundBuf.push(msg),
        getState: () => undefined,
        setState: () => undefined,
      });
      const api = w.acquireVsCodeApi!();
      const originalPostMessage = api.postMessage.bind(api);
      api.postMessage = (msg: unknown): void => {
        originalPostMessage(msg);
        const envelope = msg as {
          type?: string;
          payload?: { method?: string; params?: Record<string, unknown>; correlationId?: string };
        };
        if (envelope?.type !== 'rpc:call' || !envelope.payload?.method) return;
        const { method, correlationId, params } = envelope.payload;
        const reply = (data: unknown): void => {
          window.dispatchEvent(
            new MessageEvent('message', {
              data: { type: 'rpc:response', correlationId, success: true, data },
            }),
          );
        };
        if (method === 'chat:start') {
          const tabId = String(params?.['tabId'] ?? `tab-${Date.now()}`);
          w.__ptahTabIds!.push(tabId);
          queueMicrotask(() => reply({ success: true, sessionId: `sess-${tabId}` }));
          return;
        }
        const override = w.__ptahOverrides?.[method];
        if (override !== undefined) {
          setTimeout(() => reply(override.data), override.delay);
          return;
        }
        if (Object.prototype.hasOwnProperty.call(fixtures, method)) {
          queueMicrotask(() => reply(fixtures[method]));
          return;
        }
      };
      w.vscode = api;
      w.ptahConfig = {
        isVSCode: false,
        isElectron: true,
        theme,
        workspaceRoot: 'C:\\ptah-e2e-ws',
        workspaceName: 'ptah-e2e-ws',
        extensionUri: '',
        baseUri: '',
        iconUri: '',
        userIconUri: '',
        panelId: 'e2e-visual-recheck',
        platform: 'win32',
        initialView: 'chat',
      };
    },
    { fixtures: STATIC_RPC_FIXTURES, theme },
  );
}

async function forceTheme(page: Page, theme: 'anubis' | 'anubis-light'): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function lastTabId(page: Page): Promise<string> {
  return page.evaluate(() => (window as unknown as { __ptahTabIds: string[] }).__ptahTabIds.at(-1) as string);
}

async function pushSnapshot(
  page: Page,
  args: { routingId: string; surfaceId: string; revision: number; content: unknown },
): Promise<void> {
  await page.evaluate((payload) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'surface:updated',
          payload: {
            routingId: payload.routingId,
            surfaceId: payload.surfaceId,
            revision: payload.revision,
            origin: 'agent',
            change: {
              kind: 'snapshot',
              state: {
                surfaceId: payload.surfaceId,
                revision: payload.revision,
                content: payload.content,
                selection: null,
                lastSubmit: null,
              },
            },
          },
        },
      }),
    );
  }, args);
}

async function pushChunk(page: Page, args: { routingId: string; sessionId: string; event: Record<string, unknown> }): Promise<void> {
  await page.evaluate((payload) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'chat:chunk',
          payload: { tabId: payload.routingId, sessionId: payload.sessionId, surfaceMode: true, event: payload.event },
        },
      }),
    );
  }, args);
}

async function settleAppsTurn(page: Page, routingId: string, sessionId: string): Promise<void> {
  await pushChunk(page, {
    routingId,
    sessionId,
    event: { id: `ev-${Date.now()}-start`, eventType: 'message_start', timestamp: Date.now(), sessionId, messageId: `msg-${Date.now()}`, role: 'assistant' },
  });
  await pushChunk(page, {
    routingId,
    sessionId,
    event: {
      id: `ev-${Date.now()}-turn`,
      eventType: 'turn_state',
      timestamp: Date.now(),
      sessionId,
      messageId: `msg-${Date.now()}`,
      phase: 'idle',
      revision: 1,
      backgroundTasks: [],
      sessionCrons: [],
      terminalReason: 'completed',
    },
  });
}

function dashboardContent(surfaceId: string) {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: 'Weekly Deploy Cost' },
      description: { text: 'Deploys, cost and incidents for the last 7 days' },
      components: [
        { kind: 'stat', id: 'stat-deploys', title: { text: 'Deploys this week' }, value: 42, unit: 'deploys', delta: 5 },
        { kind: 'stat', id: 'stat-cost', title: { text: 'Cost' }, value: 128.42, unit: 'USD', delta: -3 },
        { kind: 'stat', id: 'stat-incidents', title: { text: 'Incidents' }, value: 1, unit: 'incidents', delta: 0 },
        { kind: 'stat', id: 'stat-uptime', title: { text: 'Uptime' }, value: 99.95, unit: '%', delta: 0 },
        {
          kind: 'line-chart',
          id: 'chart-cost',
          title: { text: 'Cost trend' },
          xLabel: { text: 'Day' },
          yLabel: { text: 'USD' },
          series: [{ name: 'Cost', points: [{ x: 'Mon', y: 12 }, { x: 'Tue', y: 18 }, { x: 'Wed', y: 9 }] }],
        },
      ],
    },
    dataModel: {},
  };
}

async function measureLayout(page: Page): Promise<{
  conversationWidth: number | null;
  surfaceWidth: number | null;
  containerWidth: number | null;
  gridTemplateColumns: string;
  splitterInDom: boolean;
  splitterDisplay: string | null;
  splitterVisibleToUser: boolean;
}> {
  return page.evaluate(() => {
    const host = document.querySelector('.apps-page') as HTMLElement | null;
    const conv = document.getElementById('apps-conversation-column');
    const surface = document.querySelector('.apps-surface');
    const layout = document.querySelector('.apps-layout');
    const splitterSlot = document.querySelector('[data-testid="apps-split-handle-slot"]') as HTMLElement | null;
    const splitterDisplay = splitterSlot ? getComputedStyle(splitterSlot).display : null;
    const rect = splitterSlot?.getBoundingClientRect();
    return {
      conversationWidth: conv?.getBoundingClientRect().width ?? null,
      surfaceWidth: surface?.getBoundingClientRect().width ?? null,
      containerWidth: host?.getBoundingClientRect().width ?? null,
      gridTemplateColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
      splitterInDom: splitterSlot !== null,
      splitterDisplay,
      splitterVisibleToUser: !!splitterSlot && splitterDisplay !== 'none' && !!rect && rect.width > 0 && rect.height > 0,
    };
  });
}

/** Whether a `role=separator` node exists in the accessibility tree rooted at the layout. */
async function separatorInA11yTree(page: Page): Promise<{ found: boolean; snapshot: string }> {
  const layout = page.locator('.apps-layout');
  const snapshot = await layout.ariaSnapshot();
  return { found: /separator/i.test(snapshot), snapshot };
}

/** Contrast ratio helper (canvas-based, oklch-safe — same approach as the original R10 script). */
async function contrastRatioOf(page: Page, selector: string): Promise<{ fg: string; bg: string; ratio: number } | null> {
  return page.evaluate((sel) => {
    function toRgb(cssColor: string): [number, number, number, number] {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
      ctx.fillStyle = cssColor;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r, g, b, a];
    }
    function luminance([r, g, b]: [number, number, number, number]): number {
      const [rl, gl, bl] = [r, g, b].map((c) => {
        const s = c / 255;
        return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
      });
      return 0.2126 * rl + 0.7152 * gl + 0.0722 * bl;
    }
    function ratio(fg: string, bg: string): number {
      const L1 = luminance(toRgb(fg)) + 0.05;
      const L2 = luminance(toRgb(bg)) + 0.05;
      return L1 > L2 ? L1 / L2 : L2 / L1;
    }
    function bgOf(el: Element | null): string {
      let node = el as HTMLElement | null;
      while (node) {
        const bg = getComputedStyle(node).backgroundColor;
        const [, , , a] = toRgb(bg);
        if (a > 0) return bg;
        node = node.parentElement;
      }
      return 'rgb(255,255,255)';
    }
    const el = document.querySelector(sel);
    if (!el) return null;
    const fg = getComputedStyle(el).color;
    const bg = bgOf(el);
    return { fg, bg, ratio: Math.round(ratio(fg, bg) * 100) / 100 };
  }, selector);
}

test.describe.configure({ mode: 'serial' });

test('R10 RE-CHECK — 560-620 band, boundary settle, stat tiles, splitter a11y', async ({ browser }) => {
  const server = await startLocalFixtureServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  await installCspStub(page);
  await installAppsElectronHost(page, 'anubis');
  await page.goto(server.url);

  await expect(page.locator('[role="tablist"].electron-tabs')).toBeVisible({ timeout: 10_000 });
  const appsTab = page.getByRole('tab', { name: 'Apps' });
  await appsTab.click();
  await expect(page.getByTestId('apps-empty')).toBeVisible({ timeout: 10_000 });

  const composer = page.getByTestId('apps-composer');
  await composer.fill('Show me the weekly deploy dashboard');
  await page.getByTestId('apps-send').click();
  await expect(page.getByTestId('apps-user-turn')).toBeVisible();
  const routingId = await lastTabId(page);
  const sessionId = `sess-${routingId}`;
  await settleAppsTurn(page, routingId, sessionId);

  await pushSnapshot(page, { routingId, surfaceId: 'dash-1', revision: 1, content: dashboardContent('dash-1') });
  await expect(page.getByTestId('apps-surface-body')).toContainText('Weekly Deploy Cost');

  // Collapse the Workspaces sidebar so the outer viewport width maps predictably to the `.apps-page` container width.
  const sidebarToggle = page.getByRole('button', { name: 'Toggle Workspaces panel' });
  if (await sidebarToggle.count()) await sidebarToggle.click();

  // Measure the fixed offset between the outer viewport and the `.apps-page`
  // container width (chrome/logo column etc., even with the sidebar
  // collapsed), so the 560-620px band under review is hit on the CONTAINER
  // width the `@container apps-page (width < 606px)` rule actually reads,
  // not the outer viewport passed to `setViewportSize`.
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(50);
  const calibration = await measureLayout(page);
  const outerToContainerOffset = 900 - (calibration.containerWidth ?? 900);
  console.log('[calibration] outer=900 containerWidth=', calibration.containerWidth, 'offset=', outerToContainerOffset);
  const toOuter = (containerWidth: number) => Math.round(containerWidth + outerToContainerOffset);

  // ---- Check 1: 560-620px CONTAINER-width band sweep --------------------
  const bandContainerTargets = [560, 590, 604, 605, 606, 607, 620];
  const bandWidths = bandContainerTargets.map(toOuter);
  const bandResults: Array<{
    width: number;
    metrics: Awaited<ReturnType<typeof measureLayout>>;
  }> = [];
  for (const width of bandWidths) {
    await page.setViewportSize({ width, height: 800 });
    await page.waitForTimeout(50);
    const metrics = await measureLayout(page);
    bandResults.push({ width, metrics });
    console.log(`[band] outerViewport=${width} targetContainer~${bandContainerTargets[bandWidths.indexOf(width)]}`, JSON.stringify(metrics));
    await shot(page, `band-container${bandContainerTargets[bandWidths.indexOf(width)]}-outer${width}-dark`);
  }

  // ---- Check 2: boundary settle, CONTAINER 605<->606 x5 ------------------
  const boundaryOuter605 = toOuter(605);
  const boundaryOuter606 = toOuter(606);
  const boundaryResults: Array<{ pass: number; width: number; metrics: Awaited<ReturnType<typeof measureLayout>> }> = [];
  for (let pass = 1; pass <= 5; pass++) {
    for (const width of [boundaryOuter605, boundaryOuter606]) {
      await page.setViewportSize({ width, height: 800 });
      await page.waitForTimeout(80);
      const metrics = await measureLayout(page);
      boundaryResults.push({ pass, width, metrics });
      console.log(`[boundary settle] pass=${pass} width=${width}`, JSON.stringify(metrics));
    }
  }
  await page.setViewportSize({ width: boundaryOuter605, height: 800 });
  await page.waitForTimeout(80);
  await shot(page, 'boundary-605-final-dark');
  await page.setViewportSize({ width: boundaryOuter606, height: 800 });
  await page.waitForTimeout(80);
  await shot(page, 'boundary-606-final-dark');

  // ---- Check 4a: splitter a11y snapshot at >=606px (container ~620) -----
  await page.setViewportSize({ width: toOuter(620), height: 800 });
  await page.waitForTimeout(80);
  const a11yWide = await separatorInA11yTree(page);
  console.log('[a11y >=606] snapshot:', a11yWide.snapshot);
  const separatorCountWide = (a11yWide.snapshot.match(/separator/gi) ?? []).length;
  const wideSeparator = page.locator('[role="separator"][data-testid="apps-split-handle-slot"]');
  const wideSeparatorAttrs = {
    exists: (await wideSeparator.count()) > 0,
    valuenow: await wideSeparator.getAttribute('aria-valuenow').catch(() => null),
    valuemin: await wideSeparator.getAttribute('aria-valuemin').catch(() => null),
    valuemax: await wideSeparator.getAttribute('aria-valuemax').catch(() => null),
    tabindex: await wideSeparator.getAttribute('tabindex').catch(() => null),
  };
  await wideSeparator.focus();
  const focusedWide = await page.evaluate(() => document.activeElement?.getAttribute('data-testid'));
  console.log('[a11y >=606] separatorCount(text mentions)=', separatorCountWide, 'attrs=', JSON.stringify(wideSeparatorAttrs), 'focused=', focusedWide);
  await shot(page, 'splitter-a11y-wide-620-dark');

  // ---- Check 4b: splitter a11y snapshot at <606px (container ~600) ------
  await page.setViewportSize({ width: toOuter(600), height: 800 });
  await page.waitForTimeout(80);
  const a11yNarrow = await separatorInA11yTree(page);
  console.log('[a11y <606] snapshot:', a11yNarrow.snapshot);
  const narrowSlot = page.locator('[data-testid="apps-split-handle-slot"]');
  const narrowSlotInfo = await page.evaluate(() => {
    const slot = document.querySelector('[data-testid="apps-split-handle-slot"]') as HTMLElement | null;
    if (!slot) return { exists: false };
    return {
      exists: true,
      display: getComputedStyle(slot).display,
      tabindex: slot.getAttribute('tabindex'),
    };
  });
  // Try to tab-focus anything inside the hidden slot: press Tab from the composer and confirm focus never lands there.
  await composer.focus();
  let landedInHiddenSlot = false;
  for (let i = 0; i < 6; i++) {
    await page.keyboard.press('Tab');
    const inSlot = await page.evaluate(() => {
      const slot = document.querySelector('[data-testid="apps-split-handle-slot"]');
      return !!slot && !!document.activeElement && slot.contains(document.activeElement);
    });
    if (inSlot) {
      landedInHiddenSlot = true;
      break;
    }
  }
  console.log('[a11y <606] slotInfo=', JSON.stringify(narrowSlotInfo), 'landedInHiddenSlot=', landedInHiddenSlot);
  await shot(page, 'splitter-a11y-narrow-600-dark');
  void narrowSlot;

  // ---- Check 3: stat tiles, dark + light --------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-dark-1440');
  const statTilesDark = await page.evaluate(() => {
    const sections = [...document.querySelectorAll('[data-testid="stat-value"]')].map((valueEl) => {
      const tile = valueEl.closest('section');
      const rect = tile?.getBoundingClientRect();
      return { rect: rect ? { x: rect.x, y: rect.y, width: rect.width, height: rect.height } : null };
    });
    return sections;
  });
  console.log('[stat tiles dark] tile rects:', JSON.stringify(statTilesDark));
  const statLabelContrastDark = await contrastRatioOf(page, 'h3');
  const statValueContrastDark = await contrastRatioOf(page, '[data-testid="stat-value"]');
  const statDeltaContrastDark = await contrastRatioOf(page, '[data-testid="stat-delta"]');
  console.log('[contrast dark] label=', JSON.stringify(statLabelContrastDark), 'value=', JSON.stringify(statValueContrastDark), 'delta=', JSON.stringify(statDeltaContrastDark));

  await forceTheme(page, 'anubis-light');
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-light-1440');
  const statLabelContrastLight = await contrastRatioOf(page, 'h3');
  const statValueContrastLight = await contrastRatioOf(page, '[data-testid="stat-value"]');
  const statDeltaContrastLight = await contrastRatioOf(page, '[data-testid="stat-delta"]');
  console.log('[contrast light] label=', JSON.stringify(statLabelContrastLight), 'value=', JSON.stringify(statValueContrastLight), 'delta=', JSON.stringify(statDeltaContrastLight));

  // Narrow-band stat tiles (side-by-side, container ~620; stacked, container ~590) for the "several across" claim.
  await forceTheme(page, 'anubis');
  await page.setViewportSize({ width: toOuter(620), height: 800 });
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-band-container620-dark');
  await page.setViewportSize({ width: toOuter(590), height: 800 });
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-band-container590-dark');

  // Dump the full band + boundary result tables as JSON for the report writer.
  console.log('BAND_RESULTS_JSON=' + JSON.stringify(bandResults));
  console.log('BOUNDARY_RESULTS_JSON=' + JSON.stringify(boundaryResults));

  await context.close();
  await server.close();
});
