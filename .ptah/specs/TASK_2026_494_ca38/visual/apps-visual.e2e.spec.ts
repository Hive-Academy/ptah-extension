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
import { mkdirSync, createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, type Server } from 'node:http';
import { extname, join, resolve } from 'node:path';
import type { AddressInfo } from 'node:net';
import type { Page } from '@playwright/test';
import { test, expect } from '@playwright/test';
import { installCspStub } from '../../../../libs/frontend/webview-e2e-harness/src/lib/csp-stub';

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

// ---- Fixture content -------------------------------------------------

function dashboardContent(surfaceId: string) {
  const rows = Array.from({ length: 30 }, (_, i) => [
    `deploy-${String(i + 1).padStart(2, '0')}`,
    i % 5 === 0 ? 'failed' : 'succeeded',
    Number((Math.random() * 20 + 1).toFixed(4)),
  ]);
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
        {
          kind: 'line-chart',
          id: 'chart-cost',
          title: { text: 'Cost trend' },
          xLabel: { text: 'Day' },
          yLabel: { text: 'USD' },
          series: [
            {
              name: 'Cost',
              points: [
                { x: 'Mon', y: 12 },
                { x: 'Tue', y: 18 },
                { x: 'Wed', y: 9 },
                { x: 'Thu', y: 22 },
                { x: 'Fri', y: 31 },
                { x: 'Sat', y: 14 },
                { x: 'Sun', y: 22 },
              ],
            },
          ],
        },
        {
          kind: 'table',
          id: 'table-deploys',
          title: { text: 'Recent deploys' },
          columns: [
            { key: 'name', label: { text: 'Name' }, align: 'left' },
            { key: 'status', label: { text: 'Status' }, align: 'left' },
            { key: 'cost', label: { text: 'Cost' }, align: 'right' },
          ],
          rows,
        },
        {
          kind: 'list',
          id: 'list-notes',
          title: { text: 'Notes' },
          ordered: true,
          items: [
            { text: { text: 'Rollback window closes Friday' } },
            { text: { text: 'On-call: Ada' } },
          ],
        },
      ],
    },
    dataModel: {},
  };
}

function formContent(surfaceId: string, reason: string, environment: string | null) {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: 'Rollback Request' },
      description: { text: 'Request a rollback of the last deploy' },
      components: [
        {
          kind: 'card',
          id: 'card-rollback',
          title: { text: 'Rollback Request' },
          description: { text: 'Request a rollback of the last deploy' },
          children: [
            {
              kind: 'text',
              id: 'reason',
              label: 'Reason',
              path: 'form.reason',
              placeholder: 'Why are we rolling back?',
              hints: { required: true, minLength: 1, maxLength: 80 },
            },
            {
              kind: 'select',
              id: 'environment',
              label: 'Environment',
              path: 'form.environment',
              options: [
                { value: 'staging', label: 'Staging' },
                { value: 'production', label: 'Production' },
              ],
              hints: { required: true },
            },
            {
              kind: 'radio-group',
              id: 'strategy',
              label: 'Strategy',
              path: 'form.strategy',
              options: [
                { value: 'immediate', label: 'Immediate' },
                { value: 'gradual', label: 'Gradual' },
              ],
              hints: { required: false },
            },
            {
              kind: 'checkbox',
              id: 'notify',
              label: 'Notify the team',
              path: 'form.notify',
              hints: { required: false },
            },
          ],
          actions: [
            { id: 'submit-rollback', action: 'surface.submit', label: { text: 'Submit rollback request' } },
          ],
        },
      ],
    },
    dataModel: { form: { reason, environment, strategy: null, notify: false } },
  };
}

/** Deliberately invalid: `schemaVersion` outside the accepted literal -> client-side rejected (fail-closed). */
function invalidContent(surfaceId: string) {
  return {
    contract: 'dashboard-spec/2',
    surface: {
      schemaVersion: 'dashboard-spec/2',
      catalogVersion: 'dashboard-catalog/2',
      surfaceId,
      title: { text: 'Broken surface' },
      // `select`/`radio-group` missing `options` -> fails `SurfaceComponent` schema.
      components: [{ kind: 'select', id: 'bad', label: 'Bad', path: 'form.bad' }],
    },
    dataModel: {},
  };
}

// ---- Test -------------------------------------------------------------

test.describe.configure({ mode: 'serial' });

test('R10 visual capture — Apps page', async ({ browser }) => {
  const server = await startLocalFixtureServer();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') console.log('[page console error]', msg.text());
  });

  await installCspStub(page);
  await installAppsElectronHost(page, 'anubis');
  await page.goto(server.url);

  // ---- Boot: workspace present -> tab row renders (ElectronLayoutService.hasWorkspaceFolders()).
  await expect(page.locator('[role="tablist"].electron-tabs')).toBeVisible({ timeout: 10_000 });
  await shot(page, 'shell-chat-dark-1440');

  // ---- Apps tab: click, tabs-lifted row, AppWindow icon, active state.
  const appsTab = page.getByRole('tab', { name: 'Apps' });
  await expect(appsTab).toBeVisible();
  await shot(page, 'apps-tab-unselected-dark-1440');
  await appsTab.click();
  await expect(page.getByTestId('apps-empty')).toBeVisible({ timeout: 10_000 });
  await expect(appsTab).toHaveAttribute('aria-selected', 'true');
  await shot(page, 'empty-dark-1440');

  // ---- Keyboard access to the Apps tab: Tab from the logo through the tab row.
  await page.locator('body').click({ position: { x: 5, y: 5 } }); // defocus
  await page.keyboard.press('Tab'); // -> Chat tab (first focusable after logo/img which is not focusable)
  await page.keyboard.press('Tab'); // -> Apps tab (or lands directly depending on DOM)
  await shot(page, 'focus-tab-row-dark-1440');

  // ---- Start the Apps conversation (mints the routing id / claims it).
  const composer = page.getByTestId('apps-composer');
  await composer.fill('Show me the weekly deploy dashboard');
  await page.getByTestId('apps-send').click();
  await expect(page.getByTestId('apps-user-turn')).toBeVisible();
  const routingId = await lastTabId(page);
  expect(routingId).toBeTruthy();
  const sessionId = `sess-${routingId}`;
  // Binds the surface's conversation to a session and settles the
  // optimistic `pendingTurn` from the send above, so `isProcessing()` drops
  // and surface submit buttons are not permanently disabled (see
  // `settleAppsTurn`'s doc comment).
  await settleAppsTurn(page, routingId, sessionId);

  // ---- Populated dashboard: stats, table + pager, chart + Expand, list.
  await pushSnapshot(page, {
    routingId,
    surfaceId: 'dash-1',
    revision: 1,
    content: dashboardContent('dash-1'),
  });
  await expect(page.getByTestId('apps-surface-body')).toContainText('Weekly Deploy Cost');
  await expect(page.getByText('Page 1 of').first()).toBeVisible();
  await shot(page, 'dashboard-populated-dark-1440');

  // Chart Expand toggle (client-only view-state). Scoped to the surface body
  // and keyed by the stable `data-apps-focus-key` (not accessible name, which
  // flips Expand/Collapse) so it never matches the navbar's own
  // `aria-expanded` config-menu trigger and stays the same locator both clicks.
  const expandBtn = page.locator('[data-apps-focus-key="dash-1:chart-cost:expand"]');
  if (await expandBtn.count()) {
    await expandBtn.click();
    await shot(page, 'dashboard-chart-expanded-dark-1440');
    await expandBtn.click(); // collapse back
  }

  // Pager: go to page 2 (table pager specifically — the list may also paginate).
  const nextBtn = page.locator('[data-apps-focus-key="dash-1:table-deploys:next"]');
  if (await nextBtn.count()) {
    await nextBtn.click();
    await shot(page, 'dashboard-table-page2-dark-1440');
  }

  // ---- Second surface (form, invalid required field) -> switcher appears.
  await pushSnapshot(page, {
    routingId,
    surfaceId: 'form-1',
    revision: 1,
    content: formContent('form-1', '', null),
  });
  await expect(page.getByRole('tablist', { name: 'Open apps' })).toBeVisible();
  await shot(page, 'switcher-two-surfaces-dark-1440');

  await page.getByRole('tab', { name: 'Rollback Request' }).click();
  await expect(page.getByRole('textbox', { name: 'Reason' })).toBeVisible();
  await shot(page, 'form-surface-dark-1440');

  // ---- Validation error: submit with the required Reason field empty.
  await page.getByRole('button', { name: 'Submit rollback request' }).click();
  await shot(page, 'form-validation-error-dark-1440');

  // ---- Interactive commit: type + blur (queues `surface:change`; Rule 4 lets
  // an optimistic overlay show it while pending — see AppsSurfaceLanes).
  await page.getByRole('textbox', { name: 'Reason' }).fill('Elevated error rate after deploy 42');
  await page.getByRole('textbox', { name: 'Reason' }).blur();
  await shot(page, 'form-typed-optimistic-dark-1440');

  // The client-side submit precheck (`checkSubmitValues`) reads the surface's
  // *materialized* `dataModel`, not the pending overlay (see
  // `apps-submit-flow.ts` `preCheckAndSend`) — an interactive commit alone
  // never reaches it without the host's echo. Push that echo (revision 2,
  // both required fields now filled) to simulate it landing, then submit.
  await pushSnapshot(page, {
    routingId,
    surfaceId: 'form-1',
    revision: 2,
    content: formContent('form-1', 'Elevated error rate after deploy 42', 'production'),
  });
  await shot(page, 'form-filled-dark-1440');

  await armOverride(page, 'surface:action', { status: 'applied', surfaceState: { kind: 'updated', revision: 2 } }, 700);
  await page.getByRole('button', { name: 'Submit rollback request' }).click();
  await shot(page, 'form-submit-sending-dark-1440');
  await expect(page.getByText('Sent', { exact: true })).toBeVisible({ timeout: 5_000 });
  await expect(page.getByTestId('apps-user-turn').filter({ hasText: 'Submitted: Submit rollback request' })).toBeVisible();
  await shot(page, 'form-submit-sent-dark-1440');

  // ---- Contrast (WCAG AA): "Sent" (`text-success`) against its tile background.
  // Measured HERE, while the Rollback Request surface (which shows it) is
  // still active — the active surface changes for later steps below.
  const sentContrast = await page.evaluate(() => {
    // The project's daisyUI theme resolves computed colors as `oklch(...)`
    // strings, not `rgb(...)` — a regex on rgb() silently degrades to
    // black-on-black (ratio 1). Convert via a 1x1 canvas: setting `fillStyle`
    // to ANY valid CSS color string (oklch included) and reading back the
    // pixel is the standard browser-side color-space-agnostic conversion.
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
    const sentEl = [...document.querySelectorAll('span[role="status"]')].find(
      (el) => el.textContent?.trim() === 'Sent',
    );
    if (!sentEl) return null;
    const fg = getComputedStyle(sentEl).color;
    const bg = bgOf(sentEl);
    const [fgR, fgG, fgB] = toRgb(fg);
    const [bgR, bgG, bgB] = toRgb(bg);
    return {
      fgCss: fg,
      bgCss: bg,
      fgRgb: `rgb(${fgR},${fgG},${fgB})`,
      bgRgb: `rgb(${bgR},${bgG},${bgB})`,
      ratio: Math.round(ratio(fg, bg) * 100) / 100,
    };
  });
  console.log('[contrast] Sent status text vs its background:', JSON.stringify(sentContrast));

  // ---- Host rejection: push an invalid surface (fails client-side schema validation).
  await pushSnapshot(page, {
    routingId,
    surfaceId: 'broken-1',
    revision: 1,
    content: invalidContent('broken-1'),
  });
  await page.getByRole('tab', { name: 'App not shown' }).click();
  await expect(page.getByTestId('apps-fallback')).toBeVisible();
  await shot(page, 'host-rejection-dark-1440');

  // ---- Two failed surfaces + switcher (no flash between them).
  await pushSnapshot(page, {
    routingId,
    surfaceId: 'broken-2',
    revision: 1,
    content: invalidContent('broken-2'),
  });
  const tabs = page.getByRole('tab');
  const brokenTabs = page.getByRole('tab', { name: 'App not shown' });
  await expect(brokenTabs).toHaveCount(2);
  await shot(page, 'two-failed-switcher-dark-1440');
  // Rapid switch, checking the fallback is present immediately after each click (no blank frame).
  await brokenTabs.nth(0).click();
  await expect(page.getByTestId('apps-fallback')).toBeVisible();
  await brokenTabs.nth(1).click();
  await expect(page.getByTestId('apps-fallback')).toBeVisible();
  void tabs;

  // ---- Eviction notice on the active (dashboard) surface.
  await page.getByRole('tab', { name: 'Weekly Deploy Cost' }).click();
  await pushDeleted(page, { routingId, surfaceId: 'dash-1', revision: 999, reason: 'evicted' });
  await expect(page.getByTestId('apps-notice')).toBeVisible();
  await shot(page, 'eviction-notice-dark-1440');

  // ---- Nested separator accessibility snapshot + splitter drag/keyboard.
  const separator = page.locator('[role="separator"][data-testid="apps-split-handle-slot"]');
  await expect(separator).toHaveAttribute('aria-orientation', 'vertical');
  const ariaBefore = {
    valuenow: await separator.getAttribute('aria-valuenow'),
    valuemin: await separator.getAttribute('aria-valuemin'),
    valuemax: await separator.getAttribute('aria-valuemax'),
    tabindex: await separator.getAttribute('tabindex'),
    controls: await separator.getAttribute('aria-controls'),
    label: await separator.getAttribute('aria-label'),
  };
  console.log('[a11y] separator attrs before drag:', JSON.stringify(ariaBefore));
  // `page.accessibility.snapshot()` (CDP-based) was removed in this
  // Playwright version; `locator.ariaSnapshot()` is the supported
  // replacement and reads the same accessibility-tree role/name/state data.
  const separatorAria = await separator.ariaSnapshot();
  console.log('[a11y] separator ariaSnapshot:', separatorAria);

  await separator.focus();
  await shot(page, 'splitter-focused-dark-1440');
  const beforeKey = await separator.getAttribute('aria-valuenow');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  // The attribute is bound to a zoneless-OnPush computed signal
  // (`splitWidth()`); a keyboard event's DOM commit is not guaranteed
  // synchronous with `page.keyboard.press` resolving, so poll rather than
  // reading immediately (a prior run read a stale, unchanged value this way).
  await expect
    .poll(() => separator.getAttribute('aria-valuenow'), { timeout: 2_000 })
    .not.toBe(beforeKey);
  const afterKey = await separator.getAttribute('aria-valuenow');
  console.log(`[a11y] separator aria-valuenow: before=${beforeKey} after 2x ArrowRight=${afterKey}`);
  await shot(page, 'splitter-keyboard-resized-dark-1440');

  const box = await separator.boundingBox();
  if (box) {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + 120, box.y + box.height / 2, { steps: 8 });
    await page.mouse.up();
    await shot(page, 'splitter-dragged-dark-1440');
  }

  // ---- Viewport sweep: 1440, 1024, then the 481-605 container-width band, then stacked.
  // The `apps-page` container query reads the PAGE's own inline size, not the
  // outer viewport: the Electron shell's left Workspaces sidebar (~240px by
  // default) eats into it. Collapse the sidebar first so an outer viewport
  // width actually lands the container in the band under review, and report
  // the measured container width alongside the viewport width used.
  const sidebarToggle = page.getByRole('button', { name: 'Toggle Workspaces panel' });
  if (await sidebarToggle.count()) await sidebarToggle.click();

  for (const width of [1024, 600, 420]) {
    await page.setViewportSize({ width, height: 800 });
    await shot(page, `dashboard-viewport-dark-${width}`);
  }

  async function measureLayout(): Promise<{
    conversationWidth: number | null;
    surfaceWidth: number | null;
    containerWidth: number | null;
    gridTemplateColumns: string;
    splitterVisible: boolean;
  }> {
    return page.evaluate(() => {
      const host = document.querySelector('.apps-page') as HTMLElement | null;
      const conv = document.getElementById('apps-conversation-column');
      const surface = document.querySelector('.apps-surface');
      const layout = document.querySelector('.apps-layout');
      return {
        conversationWidth: conv?.getBoundingClientRect().width ?? null,
        surfaceWidth: surface?.getBoundingClientRect().width ?? null,
        containerWidth: host?.getBoundingClientRect().width ?? null,
        gridTemplateColumns: layout ? getComputedStyle(layout).gridTemplateColumns : '',
        splitterVisible: document.querySelector('[data-testid="apps-split-handle-slot"]') !== null,
      };
    });
  }

  // Search outer viewport widths for one whose measured `.apps-page`
  // container width actually lands inside 481-605px (the band under review),
  // now that the sidebar is collapsed. Reports every width tried.
  // Sweep the whole band edge to edge (sidebar collapsed) so both the
  // narrowest surviving two-column layout (just above the stacking
  // threshold) and a wider in-band point are on record.
  let firstBandViewport: number | null = null;
  let narrowestBandMetrics: { width: number; metrics: Awaited<ReturnType<typeof measureLayout>> } | null = null;
  for (const width of [500, 520, 540, 560, 580, 600, 620]) {
    await page.setViewportSize({ width, height: 800 });
    const metrics = await measureLayout();
    console.log(`[narrow-band search] viewport=${width} containerWidth=${metrics.containerWidth}`, JSON.stringify(metrics));
    if (metrics.containerWidth !== null && metrics.containerWidth >= 481 && metrics.containerWidth <= 605) {
      if (firstBandViewport === null) firstBandViewport = width;
      if (metrics.splitterVisible && narrowestBandMetrics === null) {
        narrowestBandMetrics = { width, metrics };
      }
    }
  }
  const bandViewport = firstBandViewport;

  // viewport=560 (containerWidth 496, still above the 480px stacking
  // threshold) reproducibly measured `splitterVisible: false` with a
  // 3-track `grid-template-columns` and a 0px middle track — i.e. Angular's
  // `stacked()` signal (fed by a `ResizeObserver` callback, async) and the
  // CSS `@container` query (synchronous with layout) briefly disagree about
  // whether this width is stacked. Re-measure after a short wait to see
  // whether it is a one-frame transient or a settled, persistent mismatch.
  await page.setViewportSize({ width: 560, height: 800 });
  const immediateAt560 = await measureLayout();
  await page.waitForTimeout(300);
  const settledAt560 = await measureLayout();
  console.log('[narrow-band boundary 560px] immediate:', JSON.stringify(immediateAt560));
  console.log('[narrow-band boundary 560px] settled (+300ms):', JSON.stringify(settledAt560));
  await shot(page, 'narrow-band-boundary-560-settled-dark');

  if (narrowestBandMetrics !== null) {
    console.log(
      `[narrow-band 481-605] narrowest two-column sample at outer viewport ${narrowestBandMetrics.width}px:`,
      JSON.stringify(narrowestBandMetrics.metrics),
    );
    await page.setViewportSize({ width: narrowestBandMetrics.width, height: 800 });
    await shot(page, `narrow-band-${narrowestBandMetrics.width}-dark`);
  } else {
    console.log('[narrow-band 481-605] no two-column sample found in the tried viewport widths with the sidebar collapsed.');
  }

  await page.setViewportSize({ width: 420, height: 800 });
  const stackedMetrics = await measureLayout();
  console.log('[stacked 420px]', JSON.stringify(stackedMetrics));
  await shot(page, 'stacked-420-dark');

  // Horizontal-scroll and header-wrap check at 420px (R10: "the five-tab row
  // at narrow widths"; also a standard responsive-integrity check).
  const overflow420 = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
  }));
  console.log('[overflow 420px]', JSON.stringify(overflow420));
  const navbar = page.locator('.tabs.tabs-lifted.electron-tabs').locator('..');
  if (await navbar.count()) {
    await navbar.first().screenshot({ path: join(SHOT_DIR, 'header-420-dark.png') });
  }

  // Directly interrogate the icon cluster's presence/geometry/paint at 420px
  // rather than inferring it from a screenshot alone.
  const iconClusterProbe = await page.evaluate(() => {
    const configBtn = document.querySelector('[data-test="config-menu-trigger"]');
    const themeBtn = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().includes('theme'),
    );
    const notifBtn = [...document.querySelectorAll('button')].find((b) =>
      b.getAttribute('aria-label')?.toLowerCase().startsWith('notifications'),
    );
    const navbarEl = document.querySelector('.tabs.tabs-lifted.electron-tabs')?.parentElement ?? null;
    function describe(el: Element | null): unknown {
      if (!el) return null;
      const rect = el.getBoundingClientRect();
      const style = getComputedStyle(el);
      return {
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        display: style.display,
        visibility: style.visibility,
        opacity: style.opacity,
      };
    }
    return {
      navbar: describe(navbarEl),
      navbarScrollWidth: navbarEl ? (navbarEl as HTMLElement).scrollWidth : null,
      navbarClientWidth: navbarEl ? (navbarEl as HTMLElement).clientWidth : null,
      configBtn: describe(configBtn),
      themeBtn: describe(themeBtn ?? null),
      notifBtn: describe(notifBtn ?? null),
    };
  });
  console.log('[icon cluster probe @420px]', JSON.stringify(iconClusterProbe, null, 2));

  // ---- Light theme pass at wide + narrow.
  await page.setViewportSize({ width: 1440, height: 900 });
  await forceTheme(page, 'anubis-light');
  await shot(page, 'dashboard-populated-light-1440');
  await page.setViewportSize({ width: 420, height: 800 });
  await shot(page, 'stacked-420-light');
  if (bandViewport !== null) {
    await page.setViewportSize({ width: bandViewport, height: 800 });
    await shot(page, `narrow-band-${bandViewport}-light`);
  }

  await context.close();
  await server.close();
});
