/**
 * E2E: the staged boot screen (TASK_2026_380, Task 5.1 — one of the two
 * cases Batch 4 deferred, D-6 in `batch-4-report.md`).
 *
 * This is the only proof that a `boot:readinessChanged` push actually
 * reaches the rendered surface: `BootStatusService`'s unit tests (component
 * 12) and `BootProgressComponent`'s unit tests (component 13) each pin their
 * own half in isolation, but neither proves the wiring in `app.html` — the
 * `@else if (... || bootStatus.isBlockingBoot())` branch ahead of
 * `@else if (isReady())` (`apps/ptah-extension-webview/src/app/app.html:34-58`)
 * — actually hands the screen over when a real push lands on the real
 * bundle.
 *
 * Uses the REAL `ptah-extension-webview` Angular bundle, the same artifact
 * both VS Code and Electron load, following the pattern and the
 * `isElectron: true` `ptahConfig` justification in the sibling scenario
 * `../thoth/skills-lane-pickers.e2e.spec.ts` (read its file doc comment
 * before changing that flag). The Electron shell is reached deliberately:
 * `ElectronShellComponent` is where the activity ticker lives (the sibling
 * spec in this folder), and exercising the same shell here proves the boot
 * screen hands over into the surface Track B5 actually decorates.
 *
 * `BootStatusService` also fires a one-shot `boot:getReadiness` PULL on
 * construction (`isElectron` true here). That RPC is left unmocked
 * deliberately: the pull's every failure path leaves the current snapshot
 * untouched (`boot-status.service.ts` "Why the initial value is `ready`"),
 * so an unanswered pull cannot rewind a push that already landed via
 * `bridge.inject`. It only adds a harmless pending RPC call the test never
 * awaits.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

const RPC_FIXTURES: Record<string, unknown> = {
  // Clears `ElectronLayoutService.hasWorkspaceFolders()`, the gate
  // `ElectronShellComponent` puts ahead of the 3-panel layout — same fixture
  // shape as `apps/ptah-electron-e2e/src/support/fixtures.ts`'s `ui` fixture
  // and the sibling thoth scenario.
  'workspace:getInfo': {
    folders: ['C:\\ptah-e2e-ws'],
    activeFolder: 'C:\\ptah-e2e-ws',
  },
  'workspace:switch': { success: true },
};

/**
 * Wire `window.vscode` + `window.ptahConfig` and an in-page RPC
 * auto-responder, all via `page.addInitScript` so they exist before the
 * Angular bundle's `main.ts` runs. Copied from the sibling thoth scenario —
 * see its file doc comment for the exact wire shapes this answers
 * (`rpc:call` outbound -> `rpc:response` `MessageEvent`, matching
 * `ClaudeRpcService`/`MessageRouterService`).
 */
async function installRpcAutoResponder(
  page: Page,
  fixtures: Record<string, unknown>,
): Promise<void> {
  await page.addInitScript((serializedFixtures: string) => {
    const parsedFixtures = JSON.parse(serializedFixtures) as Record<
      string,
      unknown
    >;
    const w = window as unknown as {
      acquireVsCodeApi?: () => {
        postMessage: (msg: unknown) => void;
        getState: () => unknown;
        setState: (s: unknown) => void;
      };
      vscode?: unknown;
      ptahConfig?: unknown;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    const api = w.acquireVsCodeApi();
    const originalPostMessage = api.postMessage.bind(api);
    api.postMessage = (msg: unknown): void => {
      originalPostMessage(msg);
      const envelope = msg as {
        type?: string;
        payload?: {
          method?: string;
          params?: unknown;
          correlationId?: string;
        };
      };
      if (envelope?.type !== 'rpc:call' || !envelope.payload?.method) {
        return;
      }
      const { method, correlationId } = envelope.payload;
      if (!Object.prototype.hasOwnProperty.call(parsedFixtures, method)) {
        return;
      }
      const data = parsedFixtures[method];
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'rpc:response', correlationId, success: true, data },
          }),
        );
      });
    };
    w.vscode = api;
    // Exact shape `apps/ptah-electron/src/preload.ts` injects — see the
    // sibling thoth scenario's file doc comment for why this bundle (not a
    // real VS Code host) is the honest target of this spec.
    w.ptahConfig = {
      isVSCode: false,
      isElectron: true,
      theme: 'dark',
      workspaceRoot: 'C:\\ptah-e2e-ws',
      workspaceName: 'ptah-e2e-ws',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'chat',
    };
  }, JSON.stringify(fixtures));
}

/** Same worker-scoping rule as the sibling thoth scenario: file-scope opt-in. */
test.use({ useAppBuild: true });

test.describe('webview > boot > staged boot screen', () => {
  test('a warming/database push shows the boot headline, then a harness push hands over to the shell', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await installRpcAutoResponder(page, RPC_FIXTURES);
    await page.goto(fixtureServer.url);

    // Push before the shell would otherwise be ready — `isBlockingBoot()`
    // takes precedence over `isReady()` in `app.html`'s exclusive chain
    // regardless of ordering, so this also covers the boot screen winning
    // races against `handleInitialView()`.
    await bridge.inject({
      type: 'boot:readinessChanged',
      payload: {
        readiness: 'warming',
        phase: 'database',
        startedAt: Date.now(),
      },
    });

    const headline = page.locator('[data-testid="boot-headline"]');
    await expect(headline).toBeVisible();
    await expect(headline).toContainText(/database/i);

    // `harness` clears `isBlockingBoot()` (D-1: PRE_SHELL_PHASES is
    // `['starting', 'database']` only), which hands over to the
    // `isReady()` branch and mounts `ptah-electron-shell`.
    await bridge.inject({
      type: 'boot:readinessChanged',
      payload: {
        readiness: 'warming',
        phase: 'harness',
        startedAt: Date.now(),
      },
    });

    await expect(headline).toHaveCount(0);
    // The shell rendered: the header's `no-drag` group (the same region
    // `ptah-activity-ticker` sits in, immediately before `ptah-theme-toggle`)
    // is on screen. `.first()` because the header has more than one
    // `no-drag` element once mounted.
    await expect(page.locator('.no-drag').first()).toBeVisible();
  });
});
