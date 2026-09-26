/**
 * R10 Check-3-only re-run: stat tile contrast, after the stat-value color
 * fix (dashboard-stat.component.ts:30, `text-primary` -> `text-base-content`).
 * Not part of the product test suite; a one-off capture script under the
 * task folder, per the same brief as `apps-visual-r10-recheck.e2e.spec.ts`.
 * Reuses the same fixture-server / Electron-host approach, trimmed to just
 * what Check 3 needs: dashboard populated, dark + light theme, contrast
 * measurement of the stat label/value/delta.
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
        panelId: 'e2e-visual-recheck-check3-fix',
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
      ],
    },
    dataModel: {},
  };
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

test('R10 Check-3 re-run — stat tile contrast after text-base-content fix', async ({ browser }) => {
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

  // Sanity: confirm the built bundle actually carries the fix (no `text-primary`
  // class on the stat value node) before trusting the contrast numbers below.
  const valueClassList = await page.locator('[data-testid="stat-value"]').first().getAttribute('class');
  console.log('[sanity] stat-value class list:', valueClassList);
  expect(valueClassList).not.toContain('text-primary');
  expect(valueClassList).toContain('text-base-content');

  // ---- Dark theme -------------------------------------------------------
  await shot(page, 'stat-tiles-dark-1440-fix');
  const labelDark = await contrastRatioOf(page, 'h3');
  const valueDark = await contrastRatioOf(page, '[data-testid="stat-value"]');
  const deltaDark = await contrastRatioOf(page, '[data-testid="stat-delta"]');
  console.log('[contrast dark FIX] label=', JSON.stringify(labelDark), 'value=', JSON.stringify(valueDark), 'delta=', JSON.stringify(deltaDark));

  // ---- Light theme --------------------------------------------------------
  await forceTheme(page, 'anubis-light');
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-light-1440-fix');
  const labelLight = await contrastRatioOf(page, 'h3');
  const valueLight = await contrastRatioOf(page, '[data-testid="stat-value"]');
  const deltaLight = await contrastRatioOf(page, '[data-testid="stat-delta"]');
  console.log('[contrast light FIX] label=', JSON.stringify(labelLight), 'value=', JSON.stringify(valueLight), 'delta=', JSON.stringify(deltaLight));

  // ---- Band width (container ~620, several-across layout still holds) -----
  await forceTheme(page, 'anubis');
  const sidebarToggle = page.getByRole('button', { name: 'Toggle Workspaces panel' });
  if (await sidebarToggle.count()) await sidebarToggle.click();
  await page.setViewportSize({ width: 900, height: 800 });
  await page.waitForTimeout(50);
  const containerWidth = await page.evaluate(() => document.querySelector('.apps-page')?.getBoundingClientRect().width ?? null);
  const offset = 900 - (containerWidth ?? 900);
  await page.setViewportSize({ width: Math.round(620 + offset), height: 800 });
  await page.waitForTimeout(80);
  await shot(page, 'stat-tiles-band-container620-dark-fix');

  console.log(
    'CONTRAST_RESULTS_JSON=' +
      JSON.stringify({ labelDark, valueDark, deltaDark, labelLight, valueLight, deltaLight }),
  );

  await context.close();
  await server.close();
});
