/**
 * E2E: lane model assignment — the shared provider/model picker rendered
 * through the REAL `ptah-extension-webview` Angular bundle — the exact JS
 * artifact both VS Code and Electron load (`apps/ptah-extension-webview/
 * CLAUDE.md`: "Same build artifact is copied into both
 * apps/ptah-extension-vscode and apps/ptah-electron renderer/ directories").
 *
 * WHY THE ASSERTIONS LIVE ON THE PROVIDERS PAGE (TASK_2026_523, plan
 * Decision 9 row 6). The four lane pickers were REMOVED from
 * `SkillSettingsPanelComponent` ("REMOVE the four picker mounts. Unrelated
 * synthesis policy stays."); lane provider/model selection moved to the
 * Providers settings page's "Background models" section
 * (`ProviderConsumerAssignmentsComponent`, which mounts the same
 * `ProviderModelPickerComponent` extracted into `libs/frontend/ui` — the
 * component this scenario always really tested, batches B1.9/B1.10). The
 * skills panel now owns one thing per lane: a "Manage <lane> in Providers"
 * deep-link button (`AppStateManager.requestSettingsTab({ tab: 'providers',
 * section })` + `setCurrentView('settings')`). So the scenario drives the
 * real user path: thoth > Skills > Settings, click "Manage synthesis in
 * Providers", land on the Providers page, and assert the picker there —
 * enumeration over the merged registry, the pinned synthesis lane showing
 * ITS provider/model (the regressed case of commit 9e42f9c81: a lone
 * `[value]` on the `<select>` without `[selected]` on the `@for` options
 * silently renders a pinned lane as "Active provider (default)"), and an
 * untouched lane showing the documented inherit default.
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
 * spec would never reach the skills panel at all — which contradicts
 * `skill-synthesis-ui/CLAUDE.md`'s "VS Code Parity" section ("this tab works
 * in both Electron and VS Code — skills are not desktop-only"). That
 * contradiction is real and pre-existing; fixing it means editing
 * `libs/frontend/thoth-shell/**` and/or `libs/frontend/skill-synthesis-ui/**`
 * — see the batch handoff that shipped this scenario.
 *
 * Given that, `ptahConfig` below is set to the EXACT shape
 * `apps/ptah-electron/src/preload.ts` injects (`isVSCode: false, isElectron:
 * true, ...`). This is not "pretending to be Electron" in any way that
 * matters to what's under test: this harness has no Electron IPC, no native
 * module, no `contextBridge` — it drives the bundle through the same
 * generic `postMessage` transport a VS Code webview also uses (see
 * `installRpcAutoResponder` below). Setting the flag only clears the
 * tab-level gate so the Settings subview can be reached at all.
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
  evictionDecayRate: 0.95,
  generalizationContextThreshold: 3,
  dedupClusterThreshold: 0.78,
  prefilterMinEdits: 1,
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
 * registry provider + model. The other three stay on the documented
 * `''`/`''` inherit default.
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

/** The six `BackgroundConsumerId` rows of the Background models section. */
const CONSUMER_ROW_IDS = [
  'memory-curator',
  'archaeologist',
  'synthesis',
  'judge',
  'replay',
  'judging-enhancement',
] as const;

/**
 * `config:getScopes` result. No per-key provenance entries: the scope rows
 * fall back to the documented `mixed` display (Decision 6), which no
 * assertion here depends on.
 */
const SCOPES_FIXTURE = {
  activePath: 'C:\\ptah-e2e-ws',
  entries: [],
};

/**
 * `auth:getEffectiveRoute` result. The main agent runs through `moonshot`
 * with a successful probe, so `activeProviderId()` resolves and the
 * synthesis picker's readiness strip stays silent for a `connected`
 * provider. `moonshot` also lands in `extraProviders` through
 * `route.providers`.
 */
const ROUTE_FIXTURE = {
  route: 'api-key',
  ready: true,
  blockers: [],
  driverProviderId: 'moonshot',
  resolvedAuthModality: 'api-key',
  resolvedModel: { kind: 'tier', tier: 'sonnet' },
  storedAuthMethodDiagnostic: null,
  storedAuthMethodScope: 'global',
  providers: [{ id: 'moonshot', type: 'apiKey', status: 'connected' }],
  lastSuccessfulProbeAt: '2026-01-01T00:00:00.000Z',
  lastFailedProbeAt: null,
  probedAt: '2026-01-01T00:00:00.000Z',
  fromCache: false,
};

/** `AgentOrchestrationConfig` with every scalar on its documented default. */
const AGENT_CONFIG_FIXTURE = {
  detectedClis: [],
  preferredAgentOrder: [],
  maxConcurrentAgents: 3,
  codexModel: '',
  copilotModel: '',
  cursorModel: '',
  cursorApiKeyConfigured: false,
  codexReasoningEffort: '',
  copilotReasoningEffort: '',
  codexAutoApprove: true,
  copilotAutoApprove: true,
  mcpPort: 51_820,
  disabledClis: [],
  disabledMcpNamespaces: [],
  browserAllowLocalhost: false,
  workflowsDisabled: false,
};

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

/** Connection discovery probes every `isLocal` registry entry for a saved URL. */
const EMPTY_BASE_URL_RESOLVER = `() => ({ baseUrl: null, defaultBaseUrl: null })`;
/** …and every `nativeAuth` registry entry for saved tier mappings. */
const EMPTY_TIERS_RESOLVER = `() => ({ sonnet: null, opus: null, haiku: null })`;

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
  'memory:getTriggers': {
    triggers: {
      preCompact: true,
      idleMs: 300_000,
      turnThreshold: 20,
      bootScan: true,
    },
  },
  // Everything `ProvidersSettingsStateService.refresh()` fans out over when
  // the Providers page opens. A section left unanswered never resolves, so
  // its rows would sit in the not-loaded state and refuse to open an editor
  // (`toggleEdit` bails on `!row.loaded`).
  'auth:getEffectiveRoute': ROUTE_FIXTURE,
  'config:getScopes': SCOPES_FIXTURE,
  'config:model-get': { model: 'kimi-k2' },
  // `undefined` does not survive the JSON round-trip; the page renders a
  // null effort as "Provider default", which is what the fixture wants.
  'config:effort-get': { effort: null },
  'ptahCli:list': { agents: [] },
  'settings:get': { success: true, value: [] },
  'agent:getConfig': AGENT_CONFIG_FIXTURE,
  'auth:getApiKeyStatus': { providers: [] },
  'auth:getAuthStatus': {
    hasApiKey: true,
    hasOpenRouterKey: false,
    hasAnyProviderKey: true,
    authMethod: 'thirdParty',
    anthropicProviderId: 'moonshot',
    availableProviders: [],
  },
  'provider:listCustomEntries': { entries: [] },
  'llm:getProviderBaseUrl': EMPTY_BASE_URL_RESOLVER,
  'provider:getModelTiers': EMPTY_TIERS_RESOLVER,
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
        setState: () => unknown;
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

/**
 * This is the one scenario that needs the REAL Angular bundle rather than the
 * harness's inline placeholder, so it opts the fixture server into serving
 * `dist/apps/ptah-extension-webview/browser`. Worker options must be set at
 * file scope — Playwright gives this file its own worker, which is exactly
 * what keeps the placeholder-scaffolded specs on the placeholder.
 */
test.use({ useAppBuild: true });

test.describe('webview > settings > providers > background model pickers', () => {
  test('lane deep-link opens the Providers page where the shared picker enumerates providers and renders pinned lanes', async ({
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

    // Decision 9 row 6: the pickers are gone from the skills panel. What
    // remains per lane is the deep-link button into the Providers page —
    // assert the panel no longer mounts a picker and still offers the link.
    const panel = page.locator('ptah-skill-settings-panel');
    await expect(
      panel.locator('ptah-provider-model-picker'),
    ).toHaveCount(0);
    const lanesSection = panel.locator('[data-testid="skills-lanes-section"]');
    await expect(lanesSection).toBeVisible();
    const manageSynthesis = lanesSection.getByRole('button', {
      name: 'Manage synthesis in Providers',
    });
    await expect(manageSynthesis).toBeVisible();
    await manageSynthesis.click();

    // The deep-link routes to the settings view; the Providers tab is its
    // default tab. Wait for the Background models section to be LOADED (a
    // row's summary only renders once its section read landed), because
    // `toggleEdit` refuses to open an editor for a not-loaded row.
    const assignments = page.locator('[data-testid="provider-consumer-assignments"]');
    await assignments.waitFor({ state: 'visible' });
    for (const rowId of CONSUMER_ROW_IDS) {
      await expect(
        page.locator(`[data-testid="consumer-row-${rowId}"]`),
      ).toHaveCount(1);
    }
    await expect(
      page.locator('[data-testid="consumer-summary-synthesis"]'),
    ).toBeVisible();

    // The deep-link's auto-open effect is one-shot and races the lanes read
    // (`appliedDeepLinkId` is set even when `toggleEdit` bails), so open the
    // editor explicitly when the deep-link lost that race.
    const synthesisEditor = page.locator('[data-testid="consumer-editor-synthesis"]');
    if (!(await synthesisEditor.isVisible())) {
      await page.locator('[data-testid="consumer-edit-synthesis"]').click();
    }
    await synthesisEditor.waitFor({ state: 'visible' });

    // The shared `ProviderModelPickerComponent` (batches B1.9/B1.10) mounts
    // inside the webview bundle on the Providers page, enumerating the
    // merged registry.
    const synthesisPicker = page.locator(
      '[data-testid="consumer-editor-synthesis"] ptah-provider-model-picker',
    );
    await expect(synthesisEditor.locator('[data-testid="picker-synthesis"]')).toHaveCount(1);
    await expect(
      synthesisPicker
        .locator('[data-testid="provider-model-picker-provider"]')
        .locator('option[value="moonshot"]'),
    ).toHaveText('Moonshot (Kimi)');

    // The regressed case (commit 9e42f9c81): a pinned lane must show ITS
    // provider/model, not the inherit sentinel.
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('moonshot');
    await expect(
      synthesisPicker.locator('[data-testid="provider-model-picker-model"]'),
    ).toHaveValue('kimi-k2');

    // An untouched lane still shows the documented default: inherit.
    await page.locator('[data-testid="consumer-edit-judge"]').click();
    const judgePicker = page.locator(
      '[data-testid="consumer-editor-judge"] ptah-provider-model-picker',
    );
    await expect(
      judgePicker.locator('[data-testid="provider-model-picker-provider"]'),
    ).toHaveValue('');
  });
});