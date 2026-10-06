/**
 * R10 visual review capture script for TASK_2026_494 (Apps page).
 *
 * Not part of the product test suite: a one-off capture script for the
 * coordinator's visual review, written under the task folder per the R10
 * review brief (never under libs/). Reuses the real webview bundle via the
 * webview-e2e-harness's fixture server / CSP stub (imported by relative
 * path — nothing is added under libs/).
 *
 * Boots the REAL `ptah-extension-webview` Angular bundle as an Electron host
 * (`ptahConfig.isElectron = true`, same shape `apps/ptah-electron/src/preload.ts`
 * injects; see the harness's own `boot-progress.e2e.spec.ts` and
 * `thoth/skills-lane-pickers.e2e.spec.ts` for the precedent and its
 * justification comment), then drives the Apps page purely through the
 * generic postMessage transport: canned `rpc:call` -> `rpc:response` replies
 * for `workspace:getInfo`, `chat:start`, `chat:continue`, `chat:abort` and
 * the `surface:*` RPCs, plus `surface:updated` pushes built to the
 * `SurfaceEnvelope` / `SurfaceChange` shapes in
 * `libs/shared/src/mcp-apps-contracts/surface.types.ts` (confirmed against
 * `libs/shared/src/testing/fixtures/surface.ts` and
 * `.ptah/specs/TASK_2026_538_3ccf/handoff-494.md`).
 */
import { writeFileSync, mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
async function installCspStub(page: Page): Promise<void> {
  await page.route('**/*', async (route) => {
    const url = route.request().url();
    if (url.startsWith('https://fonts.')) { await route.abort('internetdisconnected'); return; }
    if (!url.startsWith('http://127.0.0.1')) { await route.abort('blockedbyclient'); return; }
    const resp = await route.fetch();
    const headers = { ...resp.headers() };
    delete headers['content-security-policy'];
    delete headers['content-security-policy-report-only'];
    await route.fulfill({ response: resp, headers });
  });
}

const SHOT_DIR = join(__dirname, 'screenshots');
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

/**
 * Minimal inline stand-in for the harness's `startFixtureServer({ appBuild:
 * true })`. That helper is not imported directly here because
 * `fixture-server.ts` uses `import.meta.url` (ESM-only) and this standalone
 * config (deliberately outside the harness's own Nx-wired ts-node/SWC
 * pipeline, per the review brief's "do not add files under libs/") runs
 * under CommonJS. Same root resolution: `dist/apps/ptah-extension-webview/browser`.
 */
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

/** Static RPC fixtures answered by method name, keyed exactly as `rpc:call` sends them. */
const STATIC_RPC_FIXTURES: Record<string, unknown> = {
  'workspace:getInfo': {
    folders: ['C:\\ptah-e2e-ws'],
    activeFolder: 'C:\\ptah-e2e-ws',
  },
  'workspace:switch': { success: true },
  'chat:continue': { success: true },
  'chat:abort': { success: true },
  'surface:change': { status: 'applied', revision: 1 },
  'surface:select': { status: 'applied', revision: 1 },
};

/**
 * Installs `window.ptahConfig` + `window.vscode` (electron shape) and a
 * generic RPC auto-responder, all via `page.addInitScript` so they exist
 * before `main.ts` runs (must be called before `page.goto`).
 *
 * The responder answers `chat:start` dynamically (success + a synthesized
 * sessionId, echoing the caller's `tabId`) and exposes
 * `window.__ptahOverride(method, data, delayMs?)` so a test can steer one
 * `surface:action` / `surface:operation` reply per step. It also records
 * every `chat:start` call's `tabId` onto `window.__ptahTabIds` (array, in
 * call order) so the test can read back the routing id the page minted
 * client-side (`AppsSessionService.claimConversation`, `TabId.create()`).
 */
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

      // Vanilla browser has no `acquireVsCodeApi()`; a real VS Code webview
      // host or Electron's preload script provides it. Shim it exactly like
      // `installPostMessageBridge` does, then acquire it ourselves so
      // `window.vscode` (what `VSCodeService.initializeFromGlobals` reads)
      // is populated before Angular's `main.ts` runs.
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
        // Unknown method (e.g. surface:action / surface:operation with no
        // override armed, surface:read, boot:getReadiness): leave unanswered.
        // Every caller in this codebase treats an unanswered RPC as "still
        // pending", never as a crash (see boot-progress.e2e.spec.ts comment).
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
        panelId: 'e2e-visual-review',
        platform: 'win32',
        initialView: 'chat',
      };
    },
    { fixtures: STATIC_RPC_FIXTURES, theme },
  );
}

/** Force `data-theme` directly (ThemeService's effect never re-fires unless its own signal changes, so this sticks). */
async function forceTheme(page: Page, theme: 'anubis' | 'anubis-light'): Promise<void> {
  await page.evaluate((t) => document.documentElement.setAttribute('data-theme', t), theme);
}

async function armOverride(page: Page, method: string, data: unknown, delayMs = 0): Promise<void> {
  await page.evaluate(
    ({ method, data, delayMs }) => {
      (window as unknown as { __ptahOverride: (m: string, d: unknown, ms?: number) => void }).__ptahOverride(
        method,
        data,
        delayMs,
      );
    },
    { method, data, delayMs },
  );
}

async function lastTabId(page: Page): Promise<string> {
  return page.evaluate(
    () => (window as unknown as { __ptahTabIds: string[] }).__ptahTabIds.at(-1) as string,
  );
}

/** Push `surface:updated` (`change.kind = 'snapshot'`) into the page. */
async function pushSnapshot(
  page: Page,
  args: {
    routingId: string;
    surfaceId: string;
    revision: number;
    content: unknown;
    selection?: unknown;
    lastSubmit?: unknown;
    origin?: 'agent' | 'ui' | 'host';
  },
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
            origin: payload.origin ?? 'agent',
            change: {
              kind: 'snapshot',
              state: {
                surfaceId: payload.surfaceId,
                revision: payload.revision,
                content: payload.content,
                selection: payload.selection ?? null,
                lastSubmit: payload.lastSubmit ?? null,
              },
            },
          },
        },
      }),
    );
  }, args);
}

/**
 * Push a `chat:chunk` — the wire message `ChatMessageHandler.handleChatChunk`
 * consumes (`libs/frontend/chat/src/lib/services/chat-message-handler.service.ts`).
 * For a surface-owned tab (claimed via `AppsConversationClaims`, which happens
 * synchronously on `AppsSessionService.start()`), a non-`turn_state` event
 * binds the surface's conversation to `sessionId`
 * (`StreamRouter.routeStreamEventForSurface`); a `turn_state` event marks
 * `SessionLivenessRegistry` for that session id directly (`TurnStateApplier`),
 * which is what clears `AppsSessionService`'s optimistic `pendingTurn` and
 * un-disables the surface's submit button.
 */
async function pushChunk(
  page: Page,
  args: { routingId: string; sessionId: string; event: Record<string, unknown> },
): Promise<void> {
  await page.evaluate((payload) => {
    window.dispatchEvent(
      new MessageEvent('message', {
        data: {
          type: 'chat:chunk',
          payload: {
            tabId: payload.routingId,
            sessionId: payload.sessionId,
            surfaceMode: true,
            event: payload.event,
          },
        },
      }),
    );
  }, args);
}

/** Binds the surface's conversation to `sessionId`, then marks it idle (clears `pendingTurn`, enables submit). */
async function settleAppsTurn(page: Page, routingId: string, sessionId: string): Promise<void> {
  await pushChunk(page, {
    routingId,
    sessionId,
    event: {
      id: `ev-${Date.now()}-start`,
      eventType: 'message_start',
      timestamp: Date.now(),
      sessionId,
      messageId: `msg-${Date.now()}`,
      role: 'assistant',
    },
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

async function pushDeleted(
  page: Page,
  args: { routingId: string; surfaceId: string; revision: number; reason: 'agent-deleted' | 'evicted' },
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
            origin: 'host',
            change: { kind: 'deleted', reason: payload.reason },
          },
        },
      }),
    );
  }, args);
}


const T = (text: string) => ({ text });
function content(surfaceId: string) {
  const tones = ['info', 'success', 'warning', 'error'];
  const stones = ['neutral', 'primary', 'info', 'success', 'warning', 'error'];
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/3',
      surfaceId,
      title: T('Status kinds'),
      components: [
        { kind: 'text-block', id: 'tb-h', role: 'heading', text: T('Heading text-block: Deployment status') },
        { kind: 'text-block', id: 'tb-b', role: 'body', text: T('Body text-block. This paragraph explains the current rollout state in plain prose and should wrap naturally across the available width without any overflow or clipping.') },
        { kind: 'divider', id: 'dv-plain', direction: 'horizontal' },
        { kind: 'divider', id: 'dv-text', direction: 'horizontal', text: T('Alerts') },
        { kind: 'stack', id: 'alerts', direction: 'vertical', gap: 'small', children: [
          ...tones.map((t) => ({ kind: 'alert', id: `al-${t}`, tone: t, text: T(`This is a ${t} inline note without a title`) })),
          ...tones.map((t) => ({ kind: 'alert', id: `alt-${t}`, tone: t, title: T(`${t} title`), text: T(`Body text for the ${t} alert with a title.`) })),
        ] },
        { kind: 'divider', id: 'dv-b', direction: 'horizontal', text: T('Badges') },
        { kind: 'stack', id: 'badges', direction: 'horizontal', gap: 'small', children: [
          ...stones.map((t) => ({ kind: 'badge', id: `bd-${t}`, tone: t, text: T(t) })),
          { kind: 'badge', id: 'bd-sel', tone: 'primary', text: T('selectable'), actions: [{ id: 'sel-act', action: 'dashboard.select', label: T('Select badge') }] },
        ] },
        { kind: 'divider', id: 'dv-p', direction: 'horizontal', text: T('Progress') },
        { kind: 'stack', id: 'progs', direction: 'vertical', gap: 'small', children: [
          { kind: 'progress', id: 'p0', tone: 'neutral', value: 0, label: T('Neutral zero') },
          { kind: 'progress', id: 'p42', tone: 'primary', value: 42.5, label: T('Primary fractional') },
          { kind: 'progress', id: 'p42i', tone: 'info', value: 42.5, label: T('Info') },
          { kind: 'progress', id: 'p100', tone: 'success', value: 100, label: T('Success full') },
          { kind: 'progress', id: 'p60w', tone: 'warning', value: 60, label: T('Warning') },
          { kind: 'progress', id: 'p30e', tone: 'error', value: 30, label: T('Error') },
          { kind: 'progress', id: 'p50n', tone: 'neutral', value: 50, label: T('Neutral half') },
        ] },
        { kind: 'divider', id: 'dv-r', direction: 'horizontal', text: T('Radial') },
        { kind: 'stack', id: 'radials', direction: 'horizontal', gap: 'medium', children: [
          { kind: 'radial-progress', id: 'r0', tone: 'neutral', value: 0, label: T('Zero') },
          { kind: 'radial-progress', id: 'r42', tone: 'primary', value: 42.5, label: T('Fractional') },
          { kind: 'radial-progress', id: 'r100', tone: 'success', value: 100, label: T('Full') },
          { kind: 'radial-progress', id: 'r60', tone: 'warning', value: 60, label: T('Warn') },
          { kind: 'radial-progress', id: 'r30', tone: 'error', value: 30, label: T('Err') },
          { kind: 'radial-progress', id: 'r50i', tone: 'info', value: 50, label: T('Info') },
        ] },
        { kind: 'divider', id: 'dv-v', direction: 'horizontal', text: T('Vertical divider') },
        { kind: 'stack', id: 'vrow', direction: 'horizontal', gap: 'small', children: [
          { kind: 'text-block', id: 'v-a', role: 'body', text: T('Left side') },
          { kind: 'divider', id: 'dv-vert', direction: 'vertical' },
          { kind: 'text-block', id: 'v-b', role: 'body', text: T('Right side') },
          { kind: 'divider', id: 'dv-vert2', direction: 'vertical', text: T('or') },
          { kind: 'text-block', id: 'v-c', role: 'body', text: T('Third') },
        ] },
        { kind: 'divider', id: 'dv-s', direction: 'horizontal', text: T('Regression: stat') },
        { kind: 'stat', id: 'stat-1', title: T('Deploys this week'), value: 42, unit: 'deploys', delta: 5 },
      ],
    },
    dataModel: {},
  };
}

test('status kinds visual', async ({ browser }) => {
  const server = await startLocalFixtureServer();
  const report: Record<string, unknown> = {};
  for (const theme of ['anubis', 'anubis-light'] as const) {
    for (const width of [1440, 400]) {
      const context = await browser.newContext({ viewport: { width, height: width === 400 ? 3400 : 2300 } });
      const page = await context.newPage();
      page.on('console', (m) => { if (m.type() === 'error') console.log('[console error]', m.text()); });
      await installCspStub(page);
      await installAppsElectronHost(page, theme);
      await page.goto(server.url);
      await expect(page.locator('[role="tablist"].electron-tabs')).toBeVisible({ timeout: 10_000 });
      await page.getByRole('tab', { name: 'Apps' }).click();
      await expect(page.getByTestId('apps-empty')).toBeVisible({ timeout: 10_000 });
      await page.getByTestId('apps-composer').fill('status kinds');
      await page.getByTestId('apps-send').click();
      await expect(page.getByTestId('apps-user-turn')).toBeVisible();
      const routingId = await lastTabId(page);
      await settleAppsTurn(page, routingId, `sess-${routingId}`);
      await pushSnapshot(page, { routingId, surfaceId: 's1', revision: 1, content: content('s1') });
      await expect(page.getByTestId('apps-surface-body')).toContainText('Status kinds');
      await forceTheme(page, theme);
      await page.waitForTimeout(500);
      const body = page.getByTestId('apps-surface-body');
      const tag = `${theme}-${width}`;
      await body.screenshot({ path: join(SHOT_DIR, `status-kinds-${tag}-r4.png`) });
      await page.screenshot({ path: join(SHOT_DIR, `page-${tag}-r4.png`) });

      const m = await page.evaluate((th) => {
        const cv = document.createElement('canvas');
        cv.width = 1;
        cv.height = 1;
        const ctx = cv.getContext('2d', { willReadFrequently: true })!;
        const rgb = (c: string): number[] => {
          ctx.clearRect(0, 0, 1, 1);
          ctx.fillStyle = '#000';
          ctx.fillStyle = c;
          ctx.fillRect(0, 0, 1, 1);
          const d = ctx.getImageData(0, 0, 1, 1).data;
          return [d[0], d[1], d[2], d[3]];
        };
        const lum = (c: number[]) => {
          const f = (v: number) => {
            v /= 255;
            return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
          };
          return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
        };
        const ratio = (a: string, b: string) => {
          const l1 = lum(rgb(a));
          const l2 = lum(rgb(b));
          return +((Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05)).toFixed(2);
        };
        const root = document.querySelector('[data-testid="apps-surface-body"]') as HTMLElement;
        const pageBg = getComputedStyle(document.body).backgroundColor;
        const out: Record<string, unknown> = { theme: th, dataTheme: document.documentElement.getAttribute('data-theme'), pageBg };
        out['overflowX'] = { scrollW: root.scrollWidth, clientW: root.clientWidth, docScrollW: document.documentElement.scrollWidth, docClientW: document.documentElement.clientWidth };
        const alerts: unknown[] = [];
        root.querySelectorAll('ptah-dashboard-alert > div').forEach((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          alerts.push({ text: (el.textContent || '').trim().slice(0, 40), cls: el.className, role: el.getAttribute('role'), contrast: ratio(cs.color, cs.backgroundColor), bgVsPage: ratio(cs.backgroundColor, pageBg), h: Math.round(r.height), w: Math.round(r.width), display: cs.display, gap: cs.gap, hasTitle: !!el.querySelector('[data-testid="alert-title"]'), childCount: el.children.length, hasIcon: !!el.querySelector('svg'), iconColorVsPage: el.querySelector('svg') ? ratio(getComputedStyle(el.querySelector('svg') as Element).color, getComputedStyle(el).backgroundColor) : null, label: (el.querySelector('[data-testid="alert-tone"]')?.textContent || '').trim(), labelVisible: (() => { const l = el.querySelector('[data-testid="alert-tone"]') as HTMLElement | null; if (!l) return false; const b = l.getBoundingClientRect(); return b.width > 0 && b.height > 0 && getComputedStyle(l).position !== 'absolute'; })(), borderColor: cs.borderTopColor, borderW: cs.borderTopWidth, borderVsPage: ratio(cs.borderTopColor, pageBg), bg: cs.backgroundColor, order: Array.from(el.children).map((c) => (c.getAttribute('data-testid') || c.tagName)).join('>') + ' | ' + (el.textContent || '').trim().replace(/\s+/g, ' ') });
        });
        out['alerts'] = alerts;
        const badges: unknown[] = [];
        root.querySelectorAll('ptah-dashboard-badge > *').forEach((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          badges.push({ text: (el.textContent || '').trim(), tag: el.tagName, contrast: ratio(cs.color, cs.backgroundColor), bgVsPage: ratio(cs.backgroundColor, pageBg), fs: cs.fontSize, h: Math.round(r.height), w: Math.round(r.width) });
        });
        out['badges'] = badges;
        const progs: unknown[] = [];
        root.querySelectorAll('progress').forEach((el) => {
          const p = el as HTMLProgressElement;
          const cs = getComputedStyle(p);
          const bar = getComputedStyle(p, '::-webkit-progress-bar');
          const val = getComputedStyle(p, '::-webkit-progress-value');
          progs.push({ label: p.getAttribute('aria-label'), value: p.value, cls: p.className, color: cs.color, bg: cs.backgroundColor, trackBg: bar.backgroundColor, fillBg: val.backgroundColor, fillVsPage: ratio(cs.color, pageBg), w: Math.round(p.getBoundingClientRect().width), pct: (p.nextElementSibling?.textContent || '').trim() });
        });
        out['progress'] = progs;
        const rads: unknown[] = [];
        root.querySelectorAll('.radial-progress').forEach((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const r = (el as HTMLElement).getBoundingClientRect();
          rads.push({ label: el.getAttribute('aria-label'), text: (el.textContent || '').trim(), cls: (el as HTMLElement).className, value: (el as HTMLElement).style.getPropertyValue('--value'), color: cs.color, ringVsPage: ratio(cs.color, pageBg), w: Math.round(r.width), h: Math.round(r.height) });
        });
        out['radial'] = rads;
        const divs: unknown[] = [];
        const parseC = (c: string) => { const d = rgb(c); return { r: d[0], g: d[1], b: d[2], a: d[3] / 255 }; };
        root.querySelectorAll('[role="separator"]').forEach((el) => {
          const e = el as HTMLElement;
          const r = e.getBoundingClientRect();
          const cs = getComputedStyle(e);
          const b0 = getComputedStyle(e, '::before');
          const segs = Array.from(e.querySelectorAll(':scope > span[aria-hidden="true"]')).map((sg) => { const sr = (sg as HTMLElement).getBoundingClientRect(); const bg = getComputedStyle(sg as HTMLElement).backgroundColor; const c = parseC(bg); const p = parseC(pageBg); const blend = `rgb(${Math.round(c.r*c.a+p.r*(1-c.a))}, ${Math.round(c.g*c.a+p.g*(1-c.a))}, ${Math.round(c.b*c.a+p.b*(1-c.a))})`; return { w: +sr.width.toFixed(2), h: +sr.height.toFixed(2), top: Math.round(sr.top), bg, blend, ratioVsPage: ratio(blend, pageBg) }; });
          const textSpan = e.querySelector(':scope > span:not([aria-hidden])') as HTMLElement | null;
          const tr = textSpan?.getBoundingClientRect();
          const rowEl = e.parentElement?.parentElement;
          const bBlend = (() => { const c = parseC(b0.backgroundColor); const p = parseC(pageBg); return `rgb(${Math.round(c.r*c.a+p.r*(1-c.a))}, ${Math.round(c.g*c.a+p.g*(1-c.a))}, ${Math.round(c.b*c.a+p.b*(1-c.a))})`; })();
          divs.push({ cls: e.className, orient: e.getAttribute('aria-orientation'), text: (e.textContent || '').trim(), w: Math.round(r.width), h: Math.round(r.height), top: Math.round(r.top), flexDir: cs.flexDirection, segs, textTop: tr ? Math.round(tr.top) : null, textBottom: tr ? Math.round(tr.bottom) : null, beforeW: b0.width, beforeH: b0.height, beforeBg: b0.backgroundColor, beforeVsPage: ratio(bBlend, pageBg), rowScrollW: rowEl?.scrollWidth, rowClientW: rowEl?.clientWidth, rowH: Math.round(rowEl?.getBoundingClientRect().height ?? -1) });
        });
        out['dividers'] = divs;
        out['textBlocks'] = Array.from(root.querySelectorAll('[data-testid^="text-block"]')).map((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          return { tag: el.tagName, fs: cs.fontSize, fw: cs.fontWeight, contrast: ratio(cs.color, pageBg) };
        });
        return out;
      }, theme);
      report[tag] = m;

      if (width === 1440) {
        const sel = page.locator('button[aria-label="Select selectable"]');
        await sel.scrollIntoViewIfNeeded();
        await sel.focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        const focus = await sel.evaluate((el) => {
          const cs = getComputedStyle(el);
          return { focused: document.activeElement === el, outline: cs.outlineStyle + ' ' + cs.outlineWidth + ' ' + cs.outlineColor, offset: cs.outlineOffset, boxShadow: cs.boxShadow, focusVisible: el.matches(':focus-visible') };
        });
        (report[tag] as Record<string, unknown>)['focusBadge'] = focus;
        const box = await sel.boundingBox();
        if (box) await page.screenshot({ path: join(SHOT_DIR, `badge-focus-${tag}-r4.png`), clip: { x: Math.max(0, box.x - 150), y: Math.max(0, box.y - 20), width: 420, height: box.height + 40 } });
      }
      await context.close();
    }
  }
  writeFileSync(join(__dirname, 'measurements-r4.json'), JSON.stringify(report, null, 2));
  await server.close();
});
