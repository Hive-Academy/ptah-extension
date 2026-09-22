import { test, expect } from '../../support/fixtures';

interface CandidateFixture {
  id: string;
  name: string;
  description: string;
  status: 'candidate' | 'promoted' | 'rejected';
  successCount: number;
  failureCount: number;
  createdAt: number;
  promotedAt: number | null;
  rejectedAt: number | null;
  rejectedReason: string | null;
  pinned: boolean;
}

function makeCandidate(
  id: string,
  status: CandidateFixture['status'],
): CandidateFixture {
  return {
    id,
    name: 'skill ' + id,
    description: 'does ' + id,
    status,
    successCount: 3,
    failureCount: 0,
    createdAt: 1_700_000_000_000,
    promotedAt: status === 'promoted' ? 1_700_000_100_000 : null,
    rejectedAt: status === 'rejected' ? 1_700_000_100_000 : null,
    rejectedReason: null,
    pinned: false,
  };
}

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
 * All four lanes, matching `SkillLanesDto` (`libs/shared/.../rpc-curator-diagnostics.types.ts`).
 * `synthesis` is pinned to a real registry provider + model — the exact shape
 * that regressed under commit 9e42f9c81 (a lone `[value]` on the `<select>`
 * without `[selected]` on the `@for` options silently renders a pinned lane
 * as "Active provider (default)"). The other three stay on the `''`/`''`
 * inherit sentinel, which is the documented default for every lane
 * (tasks.md B1.8.1: "Every lane default is `provider: ''`, `model: ''`").
 */
const LANES_FIXTURE = {
  archaeologist: {
    id: 'archaeologist',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'required',
    timeoutMs: 60_000,
    maxInputChars: 20_000,
    maxPasses: 3,
  },
  synthesis: {
    id: 'synthesis',
    provider: 'moonshot',
    model: 'kimi-k2',
    defaultTier: 'sonnet',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 60_000,
    maxInputChars: 20_000,
    maxPasses: 1,
  },
  judge: {
    id: 'judge',
    provider: '',
    model: '',
    defaultTier: 'sonnet',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 30_000,
    maxInputChars: 10_000,
    maxPasses: 1,
  },
  replay: {
    id: 'replay',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 30_000,
    maxInputChars: 10_000,
    maxPasses: 1,
  },
};

/**
 * The six `BackgroundConsumerId` rows of the Providers page's Background
 * models section (`provider-consumer-assignments.component.ts`).
 */
const CONSUMER_ROW_IDS = [
  'memory-curator',
  'archaeologist',
  'synthesis',
  'judge',
  'replay',
  'judging-enhancement',
] as const;

/** `auth:getEffectiveRoute` result — the Providers page's first eager read. */
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

/**
 * `config:getScopes` result. No per-key provenance entries: the scope rows
 * fall back to the documented `mixed` display, which no assertion here
 * depends on.
 */
const SCOPES_FIXTURE = {
  activePath: 'C:\\ptah-e2e-ws',
  entries: [],
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

/** `providerId` -> models resolver, evaluated in the main process as `new Function`. */
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

test.describe('Thoth — Skills tab', () => {
  test('candidate table + stats render', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': {
        candidates: [
          makeCandidate('s1', 'candidate'),
          makeCandidate('s2', 'candidate'),
        ],
      },
      'skillSynthesis:stats': {
        totalCandidates: 2,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
    });

    await ui.openTab('skills');

    const page = ui.page;

    await page.locator('[data-testid="skills-subview-candidates"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(2);
    await expect(
      page.locator('[data-testid="skills-stat-candidates"]'),
    ).toHaveText('2');
  });

  test('filter switches candidate set', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': `(params) => {
        if (params && params.status === 'promoted') {
          return { candidates: [{
            id: 's-prom', name: 'skill s-prom', description: 'does s-prom',
            status: 'promoted', successCount: 4, failureCount: 0,
            createdAt: 1700000000000, promotedAt: 1700000100000,
            rejectedAt: null, rejectedReason: null, pinned: false
          }] };
        }
        return { candidates: [
          { id: 's1', name: 'skill s1', description: 'does s1',
            status: 'candidate', successCount: 3, failureCount: 0,
            createdAt: 1700000000000, promotedAt: null,
            rejectedAt: null, rejectedReason: null, pinned: false },
          { id: 's2', name: 'skill s2', description: 'does s2',
            status: 'candidate', successCount: 3, failureCount: 0,
            createdAt: 1700000000000, promotedAt: null,
            rejectedAt: null, rejectedReason: null, pinned: false }
        ] };
      }`,
      'skillSynthesis:stats': {
        totalCandidates: 2,
        totalPromoted: 1,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 1,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
    });

    await ui.openTab('skills');

    const page = ui.page;

    await page.locator('[data-testid="skills-subview-candidates"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(2);

    await page.locator('[data-testid="skills-filter-promoted"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('promoted');
  });

  test('promote opens modal and confirms', async ({ ui }) => {
    await ui.mockRpc({
      'skillSynthesis:listCandidates': `(params) => {
        const g = globalThis;
        const promoted = g.__skillsPromoted === true;
        return { candidates: [{
          id: 's1', name: 'skill s1', description: 'does s1',
          status: promoted ? 'promoted' : 'candidate',
          successCount: 3, failureCount: 0,
          createdAt: 1700000000000,
          promotedAt: promoted ? 1700000100000 : null,
          rejectedAt: null, rejectedReason: null, pinned: false
        }] };
      }`,
      'skillSynthesis:stats': {
        totalCandidates: 1,
        totalPromoted: 0,
        totalRejected: 0,
        totalInvocations: 0,
        activeSkills: 0,
      },
      'skillSynthesis:getSettings': { settings: SETTINGS_FIXTURE },
      'skillSynthesis:promote': `(params) => {
        globalThis.__skillsPromoted = true;
        return { promoted: true, reason: null, filePath: 'SKILL.md' };
      }`,
    });

    await ui.openTab('skills');

    const page = ui.page;

    await page.locator('[data-testid="skills-subview-candidates"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-row"]'),
    ).toHaveCount(1);
    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('candidate');

    await page.locator('[data-testid="skills-promote-btn"]').click();
    await expect(
      page.locator('[data-testid="skills-action-confirm"]'),
    ).toBeVisible();
    await page.locator('[data-testid="skills-action-confirm"]').click();

    await expect(
      page.locator('[data-testid="skills-candidate-status"]'),
    ).toHaveText('promoted');
  });

  /**
   * P1-9 part (c) — Electron half, MOVED to the Providers page (TASK_2026_523,
   * plan Decision 9 row 6). The four lane pickers were REMOVED from
   * `SkillSettingsPanelComponent` ("REMOVE the four picker mounts. Unrelated
   * synthesis policy stays."); lane provider/model selection moved to the
   * Providers settings page's "Background models" section
   * (`ProviderConsumerAssignmentsComponent`, which mounts the same
   * `ProviderModelPickerComponent` extracted into `libs/frontend/ui` — the
   * component this test always really tested, batches B1.9/B1.10). The
   * skills panel now owns one thing per lane: a "Manage <lane> in Providers"
   * deep-link button (`AppStateManager.requestSettingsTab({ tab: 'providers',
   * section })` + `setCurrentView('settings')`, `skill-settings-panel.
   * component.ts:421-424`). So this test drives the real user path:
   * thoth > Skills > Settings, click "Manage synthesis in Providers", land on
   * the Providers page, and assert the picker there — enumeration over the
   * merged registry, the pinned synthesis lane showing ITS provider/model
   * (the exact defect commit 9e42f9c81 fixed: a lone `[value]` on the
   * `<select>` without `[selected]` on the `@for` options silently renders a
   * pinned lane as "Active provider (default)"), and an untouched lane showing
   * the documented inherit default. Mirrors the committed webview version
   * (`libs/frontend/webview-e2e-harness/src/lib/scenarios/thoth/
   * skills-lane-pickers.e2e.spec.ts`), adapted to this harness's
   * `ui.openTab` / `ui.mockRpc` driver.
   */
  test('Skills deep-link opens the Providers page where the shared picker enumerates providers and a pinned lane renders pinned', async ({
    ui,
  }) => {
    await ui.mockRpc({
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
      // Everything `ProvidersSettingsStateService.refresh()` fans out over
      // when the Providers page opens. A section left unanswered still gets
      // the fake listener's namespace default (empty arrays), which does not
      // satisfy shapes like `settings:get` — so every read is mocked here and
      // the rows render loaded. `toggleEdit` refuses to open an editor for a
      // not-loaded row.
      'auth:getEffectiveRoute': ROUTE_FIXTURE,
      'config:getScopes': SCOPES_FIXTURE,
      'config:model-get': { model: 'kimi-k2' },
      // `undefined` does not survive the JSON round-trip; a null effort
      // renders as "Provider default", which is what the fixture wants.
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
    });

    await ui.openTab('skills');
    const page = ui.page;

    await page.locator('[data-testid="skills-subview-settings"]').click();

    // Decision 9 row 6: the pickers are gone from the skills panel. What
    // remains per lane is the deep-link button into the Providers page —
    // assert the panel no longer mounts a picker and still offers the link.
    const panel = page.locator('ptah-skill-settings-panel');
    await expect(panel.locator('ptah-provider-model-picker')).toHaveCount(0);
    const lanesSection = page.locator('[data-testid="skills-lanes-section"]');
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
    const assignments = page.locator(
      '[data-testid="provider-consumer-assignments"]',
    );
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
    const synthesisEditor = page.locator(
      '[data-testid="consumer-editor-synthesis"]',
    );
    if (!(await synthesisEditor.isVisible())) {
      await page.locator('[data-testid="consumer-edit-synthesis"]').click();
    }
    await synthesisEditor.waitFor({ state: 'visible' });

    // The shared `ProviderModelPickerComponent` (batches B1.9/B1.10) mounts
    // inside the Electron renderer on the Providers page, enumerating the
    // merged registry.
    const synthesisPicker = page.locator(
      '[data-testid="consumer-editor-synthesis"] ptah-provider-model-picker',
    );
    await expect(
      synthesisEditor.locator('[data-testid="picker-synthesis"]'),
    ).toHaveCount(1);
    await expect(
      synthesisPicker
        .locator('[data-testid="provider-model-picker-provider"]')
        .locator('option[value="moonshot"]'),
    ).toHaveText('Moonshot (Kimi)');

    // The regressed case: a pinned lane must show ITS provider/model, not the
    // inherit sentinel.
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
