/**
 * Visual capture + reachability assertions for TASK_2026_586_2b3e (AFTER run):
 * renders the Thoth shell tiles, Skills > Activity and Skills > Settings
 * through the REAL ptah-extension-webview bundle, in dark + light, at
 * 375/1024/1366, and asserts the fixed behaviour on the real bundle.
 *
 * Run (screenshots land in SHOT_DIR):
 *   SHOT_DIR=<abs dir> npx playwright test --config=playwright.config.ts \
 *     thoth-feed-visual --workers=2
 * (cwd libs/frontend/webview-e2e-harness; needs dist/apps/ptah-extension-webview
 *  built from the tree under review.)
 *
 * The feed fixture keeps the defect shapes of the BEFORE run: the snapshot is
 * OLDEST-FIRST (the webview normalises the order itself), five consecutive
 * `analyze-run` events for one session, two `ineligible` events in the same
 * millisecond for two sessions (distinct ULID-shaped ids), and a long error
 * outcome as the newest event. The Skills tile fixture answers by `scope` and
 * changes between the first shell load and the Skills tab visit, so a tile
 * that does not refresh on tab switch, or that counts other workspaces, fails.
 *
 * `ptahConfig.isElectron: true` clears the Skills tab desktop gate; same
 * justification as `skills-lane-pickers.e2e.spec.ts`.
 */
import { mkdirSync } from 'node:fs';
import type { Page } from '@playwright/test';
import { test, expect } from '../../test-fixtures';
import { installPostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';

const SHOT_DIR = process.env['SHOT_DIR'] ?? 'test-results/thoth-feed-shots';

const VIEWPORTS = [
  { name: '375', width: 375, height: 812 },
  { name: '1024', width: 1024, height: 768 },
  { name: '1366', width: 1366, height: 768 },
] as const;
const THEMES = [
  { name: 'dark', theme: 'anubis' },
  { name: 'light', theme: 'anubis-light' },
] as const;

const WORKSPACE_ROOT = 'C:\\ptah-e2e-ws';
const OTHER_ROOT = 'C:\\other-project';
const MINUTE_MS = 60_000;

/** Pending candidates per root, before and after the backend "moves on". */
const CANDIDATES_AT_SHELL_LOAD = { workspace: 2, other: 1 } as const;
const CANDIDATES_AT_TAB_SWITCH = { workspace: 3, other: 4 } as const;

type EventStats = Readonly<Record<string, string | number | boolean | null>>;

/** Local mirror of `SkillSynthesisEventWire` (the harness does not import libs/shared). */
interface SeedEvent {
  readonly id: string;
  readonly kind: string;
  readonly timestamp: number;
  readonly sessionId?: string;
  readonly stats?: EventStats;
  readonly error?: string;
}

const CROCKFORD_BASE32 = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * A ULID-shaped id: 10 Crockford chars of millisecond time, then 16 chars of
 * a zero-padded sequence instead of randomness, so ids are deterministic,
 * unique, and sort in recording order even inside one millisecond (what
 * `monotonicFactory()` guarantees on the backend).
 */
function ulidLike(timestamp: number, sequence: number): string {
  let time = '';
  let rest = timestamp;
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD_BASE32[rest % 32] + time;
    rest = Math.floor(rest / 32);
  }
  return time + String(sequence).padStart(16, '0');
}

/** The diagnostics feed, OLDEST FIRST, the order the base backend sent. */
function seedEvents(now: number): readonly SeedEvent[] {
  const at = (minutesAgo: number): number =>
    now - Math.round(minutesAgo * MINUTE_MS);
  const sameMs = at(40);
  const shapes: readonly Omit<SeedEvent, 'id'>[] = [
    {
      kind: 'ineligible',
      timestamp: at(360),
      sessionId: 'sess-0a11',
      stats: { reason: 'prefilterTooThin' },
    },
    { kind: 'boot-scan', timestamp: at(355) },
    ...[120, 105, 90, 75, 60].map((minutesAgo) => ({
      kind: 'analyze-run',
      timestamp: at(minutesAgo),
      sessionId: 'sess-1001',
      stats: { accepted: true, edits: 4 },
    })),
    {
      kind: 'ineligible',
      timestamp: sameMs,
      sessionId: 'sess-2001',
      stats: { reason: 'prefilterRejected' },
    },
    {
      kind: 'ineligible',
      timestamp: sameMs,
      sessionId: 'sess-2002',
      stats: { reason: 'prefilterRejected' },
    },
    {
      kind: 'analyze-run',
      timestamp: at(30),
      sessionId: 'sess-3001',
      stats: { accepted: true },
    },
    {
      kind: 'analyze-run',
      timestamp: at(15),
      sessionId: 'sess-3001',
      stats: { accepted: true },
    },
    {
      kind: 'subagent-stop',
      timestamp: at(10),
      sessionId: 'sess-3001',
      stats: { subagent: 'senior-tester' },
    },
    {
      kind: 'analyze-run',
      timestamp: at(5),
      sessionId: 'sess-3001',
      stats: { accepted: true },
    },
    {
      kind: 'curator-pass',
      timestamp: at(2),
      stats: { promoted: 1, rejected: 0 },
    },
    {
      kind: 'error',
      timestamp: at(0.5),
      sessionId: 'sess-3002',
      error:
        'Judge lane timed out after 60000ms while scoring candidate refactor-angular-signal-store-with-very-long-name',
    },
  ];
  return shapes.map((shape, index) => ({
    id: ulidLike(shape.timestamp, index + 1),
    ...shape,
  }));
}

function lastWhere(
  events: readonly SeedEvent[],
  predicate: (event: SeedEvent) => boolean,
): SeedEvent {
  const match = [...events].reverse().find(predicate);
  if (!match) {
    throw new Error('Seed fixture is missing an event the spec asserts on');
  }
  return match;
}

/**
 * Static answers for the RPCs the Electron shell, the Thoth tabs and the
 * settings surfaces fan out over. The Providers/settings group comes from
 * `skills-lane-pickers.e2e.spec.ts`: at base it was missing, so the settings
 * captures sat on "Loading..." (R13).
 */
const STATIC_RPC_FIXTURES: Record<string, unknown> = {
  'workspace:getInfo': {
    folders: [WORKSPACE_ROOT],
    activeFolder: WORKSPACE_ROOT,
  },
  'workspace:switch': { success: true },
  'memory:stats': { core: 12, recall: 5, archival: 40 },
  'memory:getTriggers': {
    triggers: {
      preCompact: true,
      idleMs: 300_000,
      turnThreshold: 20,
      bootScan: true,
    },
  },
  'cron:list': { jobs: [] },
  'gateway:status': { adapters: [] },
  'gateway:listBindings': { bindings: [] },
  'skillSynthesis:stats': {
    totalCandidates: 7,
    totalPromoted: 4,
    totalRejected: 2,
    totalInvocations: 31,
    activeSkills: 4,
  },
  'skillSynthesis:getTriggers': {
    triggers: { sessionEnd: true, idleMs: 300_000, bootScan: true },
  },
  'skillSynthesis:digest': { items: [] },
  'skillSynthesis:listSuggestions': { suggestions: [] },
  'skillSynthesis:listSpecs': { specs: [] },
  'skillSynthesis:listClones': { clones: [] },
  'skillSynthesis:getSettings': {
    settings: {
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
    },
  },
  'skillSynthesis:getLanes': { lanes: {} },
  // Providers / settings group (from skills-lane-pickers.e2e.spec.ts).
  'auth:getEffectiveRoute': {
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
  },
  'config:getScopes': { activePath: WORKSPACE_ROOT, entries: [] },
  'config:model-get': { model: 'kimi-k2' },
  'config:effort-get': { effort: null },
  'ptahCli:list': { agents: [] },
  'settings:get': { success: true, value: [] },
  'agent:getConfig': {
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
  },
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
  'llm:getProviderBaseUrl': { baseUrl: null, defaultBaseUrl: null },
  'provider:getModelTiers': { sonnet: null, opus: null, haiku: null },
  'provider:listModels': { models: [], totalCount: 0, isStatic: true },
};

interface FixtureArgs {
  readonly theme: string;
  readonly now: number;
  readonly events: readonly SeedEvent[];
  readonly staticFixtures: Record<string, unknown>;
  readonly workspaceRoot: string;
  readonly otherRoot: string;
  readonly candidates: { readonly workspace: number; readonly other: number };
}

/** The mutable candidate counts the spec flips between shell load and tab visit. */
interface CandidateKnob {
  workspace: number;
  other: number;
}

async function installFixtures(page: Page, args: FixtureArgs): Promise<void> {
  await page.addInitScript((fx: FixtureArgs) => {
    try {
      localStorage.setItem('ptah-theme', fx.theme);
    } catch {
      // Storage can be unavailable on the initial about:blank document.
    }
    const w = window as unknown as {
      acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void };
      vscode?: unknown;
      ptahConfig?: unknown;
      __candidates?: CandidateKnob;
    };
    if (typeof w.acquireVsCodeApi !== 'function') {
      return;
    }
    const knob: CandidateKnob = { ...fx.candidates };
    w.__candidates = knob;
    const min = 60_000;

    const candidate = (index: number, workspaceRoot: string) => ({
      id: 'cand-' + index,
      name: 'candidate-skill-' + index,
      description: 'Seeded candidate ' + index,
      status: 'candidate',
      successCount: 3,
      failureCount: 0,
      createdAt: fx.now - index * 3_600_000,
      promotedAt: null,
      rejectedAt: null,
      rejectedReason: null,
      pinned: false,
      workspaceRoot,
      displayName: null,
      judgeScore: null,
      judgeStatus: null,
      judgeReason: null,
      judgeCriteria: null,
      replayConfidence: null,
      triggerScore: null,
      judgePanelRationales: null,
    });

    const dynamic: Record<string, (params: unknown) => unknown> = {
      // 'workspace' scope => the current workspace's rows only; any other
      // scope (or none) => every workspace's rows.
      'skillSynthesis:listCandidates': (params) => {
        const scope = (params as { scope?: string } | undefined)?.scope;
        const own = Array.from({ length: knob.workspace }, (_, i) =>
          candidate(i + 1, fx.workspaceRoot),
        );
        if (scope === 'workspace') {
          return { candidates: own };
        }
        const others = Array.from({ length: knob.other }, (_, i) =>
          candidate(knob.workspace + i + 1, fx.otherRoot),
        );
        return { candidates: [...own, ...others] };
      },
      'skillSynthesis:diagnostics': () => ({
        lastAnalyzeRunAt: fx.now - 5 * min,
        lastCuratorPassAt: fx.now - 2 * min,
        totalCandidates: 7,
        totalPromoted: 4,
        totalRejected: 2,
        totalInvocations: 31,
        activeSkills: 4,
        eligibilityHistogram: {
          prefilterTooThin: 5,
          prefilterRejected: 3,
          accepted: 9,
        },
        recentEvents: fx.events,
        triggers: {
          sessionEnd: true,
          idleMs: 300_000,
          bootScan: true,
          subagentStop: { enabled: true },
          turnComplete: { enabled: false },
          postToolUse: { enabled: true, minEditCount: 3 },
          maxAnalyzesPerHour: 12,
        },
      }),
      'skillSynthesis:queue': () => ({
        items: [
          {
            id: 'q1',
            sessionId: 'sess-1001',
            workspaceRoot: fx.workspaceRoot,
            stage: 'judge',
            status: 'queued',
            attemptCount: 0,
            enqueuedAt: fx.now - 5 * min,
            notBefore: 0,
            finishedAt: null,
            lane: 'judge',
            reason: null,
            candidateId: 'cand-1',
          },
          {
            id: 'q2',
            sessionId: 'sess-3001',
            workspaceRoot: fx.workspaceRoot,
            stage: 'synthesis',
            status: 'running',
            attemptCount: 1,
            enqueuedAt: fx.now - 9 * min,
            notBefore: 0,
            finishedAt: null,
            lane: 'synthesis',
            reason: null,
            candidateId: null,
          },
        ],
        recentRuns: [
          {
            id: 'r1',
            jobId: 'skill-drain',
            tier: 'light',
            scheduledFor: fx.now - 15 * min,
            startedAt: fx.now - 15 * min,
            endedAt: fx.now - 14 * min,
            status: 'succeeded',
            durationMs: 52_000,
            summary: 'Analyzed 1 session; 1 accepted.',
          },
        ],
        stageSpend: [
          {
            stage: 'synthesis',
            inputTokens: 41_200,
            outputTokens: 6_800,
            totalTokens: 48_000,
            costUsd: 0.31,
          },
        ],
      }),
    };

    const resolve = (method: string, params: unknown): unknown => {
      const handler = dynamic[method];
      if (handler) {
        return handler(params);
      }
      if (Object.prototype.hasOwnProperty.call(fx.staticFixtures, method)) {
        return fx.staticFixtures[method];
      }
      return undefined;
    };
    const answers = (method: string): boolean =>
      method in dynamic ||
      Object.prototype.hasOwnProperty.call(fx.staticFixtures, method);

    const api = w.acquireVsCodeApi();
    const originalPostMessage = api.postMessage.bind(api);
    api.postMessage = (msg: unknown): void => {
      originalPostMessage(msg);
      const envelope = msg as {
        type?: string;
        payload?: { method?: string; params?: unknown; correlationId?: string };
      };
      if (envelope?.type !== 'rpc:call' || !envelope.payload?.method) {
        return;
      }
      const { method, params, correlationId } = envelope.payload;
      // An unanswered method is left to the caller's own RPC timeout.
      if (!answers(method)) {
        return;
      }
      const data = resolve(method, params);
      queueMicrotask(() =>
        window.dispatchEvent(
          new MessageEvent('message', {
            data: { type: 'rpc:response', correlationId, success: true, data },
          }),
        ),
      );
    };
    w.vscode = api;
    w.ptahConfig = {
      isVSCode: false,
      isElectron: true,
      theme: 'dark',
      workspaceRoot: fx.workspaceRoot,
      workspaceName: 'ptah-e2e-ws',
      extensionUri: '',
      baseUri: '',
      iconUri: '',
      userIconUri: '',
      panelId: 'e2e-harness',
      platform: 'win32',
      initialView: 'chat',
    };
  }, args);
}

test.use({ useAppBuild: true });

test.describe('thoth > skills activity feed (AFTER)', () => {
  for (const vp of VIEWPORTS) {
    for (const th of THEMES) {
      test(`thoth feed after ${vp.name} ${th.name}`, async ({
        page,
        fixtureServer,
      }) => {
        mkdirSync(SHOT_DIR, { recursive: true });
        const sfx = `${vp.name}-${th.name}`;
        const now = Date.now();
        const events = seedEvents(now);
        const newest = events[events.length - 1];
        const newestSess1001 = lastWhere(
          events,
          (e) => e.kind === 'analyze-run' && e.sessionId === 'sess-1001',
        );
        const sameMsA = lastWhere(events, (e) => e.sessionId === 'sess-2001');
        const sameMsB = lastWhere(events, (e) => e.sessionId === 'sess-2002');
        expect(sameMsA.timestamp).toBe(sameMsB.timestamp);
        expect(sameMsA.id).not.toBe(sameMsB.id);

        await page.setViewportSize({ width: vp.width, height: vp.height });
        await installCspStub(page);
        const bridge = await installPostMessageBridge(page);
        await installFixtures(page, {
          theme: th.theme,
          now,
          events,
          staticFixtures: STATIC_RPC_FIXTURES,
          workspaceRoot: WORKSPACE_ROOT,
          otherRoot: OTHER_ROOT,
          candidates: CANDIDATES_AT_SHELL_LOAD,
        });
        await page.goto(fixtureServer.url);

        await bridge.inject({ type: 'switchView', payload: { view: 'thoth' } });
        const skillsTab = page.locator('#thoth-tab-skills');
        await skillsTab.waitFor({ state: 'visible' });
        const skillsTileValue = skillsTab.locator(
          '[data-testid="dashboard-status-card-value"]',
        );
        // First load: the tile counts the current workspace only.
        await expect(skillsTileValue).toHaveText(
          String(CANDIDATES_AT_SHELL_LOAD.workspace),
        );
        await page.waitForTimeout(800);
        // 1. Shell, first load.
        await page.screenshot({
          path: `${SHOT_DIR}/01-shell-tiles-initial-${sfx}.png`,
        });

        // The backend moves on in both workspaces before the user switches tab.
        await page.evaluate((next) => {
          const knob = (window as unknown as { __candidates: CandidateKnob })
            .__candidates;
          knob.workspace = next.workspace;
          knob.other = next.other;
        }, CANDIDATES_AT_TAB_SWITCH);
        await skillsTab.click();
        await page.locator('#thoth-panel-skills').waitFor({ state: 'visible' });
        // Tab switch refreshes the tile, scoped to this workspace (never the
        // all-workspaces total).
        await expect(skillsTileValue).toHaveText(
          String(CANDIDATES_AT_TAB_SWITCH.workspace),
        );

        await page.locator('[data-testid="skills-subview-activity"]').click();
        await page
          .locator('ptah-skill-activity-feed')
          .waitFor({ state: 'visible' });

        // The accordion is gone; triggers do not live on Activity any more.
        await expect(
          page.locator('ptah-skill-diagnostics-accordion'),
        ).toHaveCount(0);
        await expect(page.locator('[data-test="panel-triggers"]')).toHaveCount(
          0,
        );

        // Status card carries Candidates by status and the Refresh action.
        const statusCard = page.locator('ptah-skill-pipeline-status');
        await expect(
          statusCard.locator('[data-testid="skills-pipeline-by-status"]'),
        ).toContainText('Candidates by status');
        await expect(
          statusCard.getByRole('button', { name: 'Refresh', exact: true }),
        ).toBeEnabled();

        // Feed: newest first, grouped, tracked by the real event id.
        const feedRows = page.locator(
          '[data-test="panel-events"] li[data-event-id]',
        );
        await expect(feedRows.first()).toHaveAttribute(
          'data-event-id',
          newest.id,
        );
        await expect(feedRows.first()).toContainText('error');

        const sess1001Rows = feedRows.filter({ hasText: 'sess-1001' });
        await expect(sess1001Rows).toHaveCount(1);
        await expect(sess1001Rows).toHaveAttribute(
          'data-event-id',
          newestSess1001.id,
        );
        await expect(
          sess1001Rows.locator('[data-test="event-count"]'),
        ).toContainText('x5');

        const feedRowById = (id: string) =>
          page.locator(`[data-test="panel-events"] li[data-event-id="${id}"]`);
        const sameMsRowA = feedRowById(sameMsA.id);
        const sameMsRowB = feedRowById(sameMsB.id);
        await expect(sameMsRowA).toHaveCount(1);
        await expect(sameMsRowA).toContainText('sess-2001');
        await expect(sameMsRowB).toHaveCount(1);
        await expect(sameMsRowB).toContainText('sess-2002');

        await page.waitForTimeout(800);
        // 2. Activity, full page (tile already refreshed).
        await page.screenshot({
          path: `${SHOT_DIR}/02-skills-activity-full-${sfx}.png`,
          fullPage: true,
        });
        await page
          .locator('[data-test="panel-events"]')
          .screenshot({ path: `${SHOT_DIR}/03-event-feed-closeup-${sfx}.png` });
        await statusCard.screenshot({
          path: `${SHOT_DIR}/04-pipeline-status-closeup-${sfx}.png`,
        });

        // Skills > Settings: the Triggers card lives here now.
        await page.locator('[data-testid="skills-subview-settings"]').click();
        const triggers = page.locator(
          'ptah-skill-triggers-settings [data-test="panel-triggers"]',
        );
        await triggers.waitFor({ state: 'visible' });
        await expect(page.locator('ptah-skill-activity-feed')).toHaveCount(0);
        await page.waitForTimeout(800);
        await triggers.screenshot({
          path: `${SHOT_DIR}/05-trigger-toggles-closeup-${sfx}.png`,
        });
        // 6. Skills > Settings sub-view, full page.
        await page.screenshot({
          path: `${SHOT_DIR}/06-settings-${sfx}.png`,
          fullPage: true,
        });
      });
    }
  }
});
