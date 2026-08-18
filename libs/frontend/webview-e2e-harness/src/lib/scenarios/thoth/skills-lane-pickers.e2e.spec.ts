/**
 * E2E: Skills tab settings — the four lane pickers (archaeologist / synthesis
 * / judge / replay) render inside `SkillSettingsPanelComponent`, using the
 * REAL `ptah-extension-webview` Angular bundle — the exact JS artifact both
 * VS Code and Electron load (`apps/ptah-extension-webview/CLAUDE.md`: "Same
 * build artifact is copied into both apps/ptah-extension-vscode and
 * apps/ptah-electron renderer/ directories"). This is the webview half of
 * P1-9 part (c): proving the `ProviderModelPickerComponent` extracted into
 * `libs/frontend/ui` (batches B1.9/B1.10, replacing the deleted
 * `curator-model-picker.component.ts` fork) still mounts and renders
 * correctly when it ships inside this bundle, not just inside the
 * Electron-only harness.
 *
 * HOST CONFIG NOTE — read before changing the `isElectron` flag below.
 * `webview-html-generator.ts` (the real VS Code extension host) never sets
 * `ptahConfig.isElectron` — it stays falsy for a genuine VS Code webview.
 * But `thoth-shell.component.ts`'s own comment states plainly: "Memory and
 * Skill-Synthesis depend on better-sqlite3 (native) + the embedder-worker,
 * so they are Electron-only alongside Cron and Gateway. Each tab component
 * owns its own desktop-only placeholder" — and `skill-synthesis-tab.
 * component.ts:82` gates its ENTIRE template (Settings subview included)
 * behind `isElectron()`. With a faithful `isElectron: false` config this
 * spec would only ever be able to assert the desktop-only placeholder, never
 * the pickers — which contradicts `skill-synthesis-ui/CLAUDE.md`'s "VS Code
 * Parity" section ("this tab works in both Electron and VS Code — skills are
 * not desktop-only"). That contradiction is real and pre-existing; fixing it
 * means editing `libs/frontend/thoth-shell/**` and/or
 * `libs/frontend/skill-synthesis-ui/**`, both outside this batch's file
 * ownership (`apps/ptah-electron-e2e/src/**`,
 * `libs/frontend/webview-e2e-harness/src/**` only) — see the batch handoff.
 *
 * Given that, `ptahConfig` below is set to the EXACT shape
 * `apps/ptah-electron/src/preload.ts` injects (`isVSCode: false, isElectron:
 * true, ...`). This is not "pretending to be Electron" in any way that
 * matters to what's under test: this harness has no Electron IPC, no native
 * module, no `contextBridge` — it drives the bundle through the same
 * generic `postMessage` transport a VS Code webview also uses (see
 * `installRpcAutoResponder` below). Setting the flag only clears the
 * tab-level gate so the Settings subview — and the four lane pickers inside
 * it — can be reached at all; it proves the shared picker survives being
 * bundled into `ptah-extension-webview` and driven with nothing more than
 * that generic transport. It does NOT prove a real, unmodified VS Code user
 * can navigate here today — see the report handed back with this batch.
 */
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

/** Same shape `SkillSynthesisSettingsDto` needs for `skillSettingsDtoToForm`. */
const SETTINGS_FIXTURE = {
  enabled: true,
  successesToPromote: 3,
  dedupCosineThreshold: 0.85,
  maxActiveSkills: 50,
  candidatesDir: '',
  eligibilityMinTurns: 5,
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
  prefilterMinChars: 800,
  prefilterMinToolUses: 2,
  judgeEnabled: true,
  minJudgeScore: 6.0,
  judgeModel: 'inherit',
  maxPinnedSkills: 10,
  curatorEnabled: true,
  curatorIntervalHours: 24,
};

/**
 * All four lanes, matching `SkillLanesDto`. `synthesis` is pinned to a real
 * registry provider + model — the exact shape that regressed under commit
 * 9e42f9c81 (a lone `[value]` on the `<select>` without `[selected]` on the
 * `@for` options silently renders a pinned lane as "Active provider
 * (default)"). The other three stay on the documented `''`/`''` inherit
 * default.
 */
function laneRecord(
  id: string,
  provider: string,
  model: string,
  defaultTier: string,
  toolUse: string,
): Record<string, unknown> {
  return {
    id,
    provider,
    model,
    defaultTier,
    structuredOutput: 'sdk',
    toolUse,
    timeoutMs: 60_000,
    maxInputChars: 20_000,
    maxPasses: 1,
  };
}

const LANES_FIXTURE = {
  archaeologist: laneRecord('archaeologist', '', '', 'haiku', 'required'),
  synthesis: laneRecord('synthesis', 'moonshot', 'kimi-k2', 'sonnet', 'none'),
  judge: laneRecord('judge', '', '', 'sonnet', 'none'),
  replay: laneRecord('replay', '', '', 'haiku', 'none'),
};

const LANE_IDS = ['archaeologist', 'synthesis', 'judge', 'replay'] as const;

/** `providerId` -> models resolver source, evaluated in-page as `new Function`. */
const LIST_MODELS_RESOLVER = `(params) => {
  if (params && params.providerId === 'moonshot') {
    return {
      models: [{
        id: 'kimi-k2', name: 'Kimi K2', description: 'Moonshot Kimi K2',
        contextLength: 200000, supportsToolUse: true
      }],
      totalCount: 1, isStatic: true
    };
  }
  return { models: [], totalCount: 0, isStatic: true };
}`;

const RPC_FIXTURES: Record<string, unknown> = {
  // `ElectronShellComponent` (mounted because `ptahConfig.isElectron` is
  // true — see the file doc comment) gates ALL content behind
  // `ElectronLayoutService.hasWorkspaceFolders()`, which only becomes true
  // once `workspace:getInfo` resolves with a non-empty `folders` array
  // (`electron-layout.service.ts:572-622`). Same fixture shape
  // `apps/ptah-electron-e2e/src/support/fixtures.ts`'s `ui` fixture uses.
  'workspace:getInfo': {
    folders: ['C:\\ptah-e2e-ws'],
    activeFolder: 'C:\\ptah-e2e-ws',
  },
  'workspace:switch': { success: true },
  'skillSynthesis:listCandidates': { candidates: [] },
  'skillSynthesis:stats': {
    totalCandidates: 0,
    totalPromoted: 0,
    totalRejected: 0,
    totalInvocations: 0,
    activeSkills: 0,
  },
  'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
  'skillSynthesis:getLanes': { lanes: LANES_FIXTURE },
  'provider:listModels': LIST_MODELS_RESOLVER,
};

/**
 * Wire `window.vscode` + `window.ptahConfig` (production sets both from a
 * host-generated bootstrap script — see the file doc comment) and an
 * in-page RPC auto-responder, all via `page.addInitScript` so they exist
 * before the Angular bundle's `main.ts` runs. MUST be called after
 * {@link installPostMessageBridge} (so `window.acquireVsCodeApi` already
 * exists) and before `page.goto(...)`.
 *
 * The responder answers `{type:'rpc:call', payload:{method,params,
 * correlationId}}` outbound messages (`ClaudeRpcService.call` —
 * `libs/frontend/core/src/lib/services/claude-rpc.service.ts:201-204`) with
 * a `{type:'rpc:response', correlationId, success:true, data}` MessageEvent
 * (`MessageRouterService` dispatches `event.data` as-is —
 * `message-router.service.ts:54-64` — matching what
 * `ClaudeRpcService.handleResponse` reads directly off the message, not off
 * a nested `payload`). Any method not present in `fixtures` is left
 * unanswered; the caller's own RPC timeout handles it without touching this
 * spec's assertions.
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
      const { method, params, correlationId } = envelope.payload;
      if (!Object.prototype.hasOwnProperty.call(parsedFixtures, method)) {
        return;
      }
      const raw = parsedFixtures[method];
      let data: unknown;
      if (typeof raw === 'string') {
        // Mirrors the Electron e2e's `ui.mockRpc` string-resolver convention
        // (params-aware mocks evaluated in-page).
        const resolver = new Function('params', `return (${raw})(params);`) as (
          p: unknown,
        ) => unknown;
        data = resolver(params);
      } else {
        data = raw;
      }
      queueMicrotask(() => {
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'rpc:response', correlationId, success: true, data },
          }),
        );
      });
    };
    w.vscode = api;
    // Exact shape `apps/ptah-electron/src/preload.ts` injects — see file doc
    // comment for why this bundle (not a real VS Code host) is the honest
    // target of this spec.
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

test.describe('webview > thoth > skills > lane pickers', () => {
  test('four lane pickers render, enumerate providers, and a pinned lane renders pinned', async ({
    page,
    fixtureServer,
  }) => {
    await installCspStub(page);
    const bridge = await installPostMessageBridge(page);
    await installRpcAutoResponder(page, RPC_FIXTURES);
    await page.goto(fixtureServer.url);

    await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });

    const skillsTab = page.locator('#thoth-tab-skills');
    await skillsTab.waitFor({ state: 'visible' });
    await skillsTab.click();
    await page.locator('#thoth-panel-skills').waitFor({ state: 'visible' });

    await page.locator('[data-testid="skills-subview-settings"]').click();

    const pickers = page.locator('[data-testid="skills-lane-picker"]');
    await expect(pickers).toHaveCount(4);

    for (const laneId of LANE_IDS) {
      const picker = page.locator(
        `[data-testid="skills-lane-picker"][data-lane="${laneId}"]`,
      );
      await expect(picker).toHaveCount(1);
      // Enumeration: the registry's provider list is offered on every lane.
      await expect(
        picker
          .locator('[data-testid="provider-model-picker-provider"]')
          .locator('option[value="moonshot"]'),
      ).toHaveText('Moonshot (Kimi)');
    }

    // The regressed case (commit 9e42f9c81): a pinned lane must show ITS
    // provider/model, not the inherit sentinel.
    const synthesisPicker = page.locator(
      '[data-testid="skills-lane-picker"][data-lane="synthesis"]',
    );
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('moonshot');
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-model"]'),
    ).toHaveValue('kimi-k2');

    // An untouched lane still shows the documented default: inherit.
    const judgePicker = page.locator(
      '[data-testid="skills-lane-picker"][data-lane="judge"]',
    );
    await expect(
      judgePicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('');
  });
});
