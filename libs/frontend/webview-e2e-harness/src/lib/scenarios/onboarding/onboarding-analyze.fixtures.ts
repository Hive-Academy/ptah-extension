/**
 * Analyze workspace (A1) and Choose agents (A2) capture fixtures
 * (TASK_2026_ONBOARDING B3a). Wizard RPCs are mocked so captures do not depend
 * on a live analysis run. This file imports nothing from
 * `@ptah-extension/onboarding`; state text is asserted by the spec as literals.
 *
 * `wizard:deep-analyze` set to {@link NEVER_ANSWERED} keeps
 * `WizardAnalysisRunner.isRunning` true after Start analysis. Scan progress
 * and analysis-stream events are injected over the postMessage bridge.
 */
import { expect, type Page } from '@playwright/test';
import { installPostMessageBridge, type PostMessageBridge } from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { rpcError } from '../marketplace/marketplace.fixtures';
import { installHost, installRpcAutoResponder } from '../settings/settings.fixtures';
import {
  CHECKED_AT,
  FLAG_DONE,
  NEVER_ANSWERED,
  onboardingReadyFixtures,
  type GlassAccent,
  type GlassScene,
  type OnboardingTheme,
} from './onboarding-ready.fixtures';

export { NEVER_ANSWERED, rpcError };

export const ANALYZE_SAVED_FILENAME = 'nest-api-2026-10-29';

export const ANALYZE_SAVED_METADATA = {
  filename: ANALYZE_SAVED_FILENAME,
  savedAt: CHECKED_AT,
  projectType: 'NestJS API',
  phaseCount: 4,
  model: 'claude-sonnet',
  durationMs: 42_000,
} as const;

const PHASES_COMPLETED = {
  'project-profile': { status: 'completed', file: '1-project-profile.md', durationMs: 10_000 },
  'architecture-assessment': {
    status: 'completed',
    file: '2-architecture-assessment.md',
    durationMs: 10_000,
  },
  'quality-audit': { status: 'completed', file: '3-quality-audit.md', durationMs: 10_000 },
  'elevation-plan': { status: 'completed', file: '4-elevation-plan.md', durationMs: 12_000 },
} as const;

const PHASE_CONTENTS = {
  'project-profile': 'NestJS API. TypeScript workspace.',
  'architecture-assessment': 'Modular Nest architecture.',
  'quality-audit': 'Unit tests present.',
  'elevation-plan': 'Raise coverage on the API layer.',
} as const;

function analysisResponse(
  lifecycle: 'running' | 'paused' | 'completed' | 'failed',
): Record<string, unknown> {
  return {
    isMultiPhase: true,
    analysisDir: `C:\\ptah-e2e-ws-a\\.ptah\\analysis\\${ANALYZE_SAVED_FILENAME}`,
    phaseContents: { ...PHASE_CONTENTS },
    manifest: {
      version: 3,
      runId: 'run-e2e-analyze-1',
      slug: ANALYZE_SAVED_FILENAME,
      analyzedAt: CHECKED_AT,
      updatedAt: CHECKED_AT,
      lifecycle,
      model: 'claude-sonnet',
      totalDurationMs: 42_000,
      phases: { ...PHASES_COMPLETED },
    },
  };
}

export const COMPLETED_ANALYSIS = analysisResponse('completed');
export const INTERRUPTED_ANALYSIS = analysisResponse('paused');

/** Backend 0–100 scores; the 92% row is the visual reference. */
export const ANALYZE_RECOMMENDATIONS = [
  {
    agentId: 'backend-developer',
    agentName: 'Backend Developer',
    relevanceScore: 92,
    matchedCriteria: ['NestJS framework detected', 'REST API routes detected'],
    category: 'development',
    recommended: true,
    description: 'Implements APIs, database logic, and server-side code',
  },
  {
    agentId: 'software-architect',
    agentName: 'Software Architect',
    relevanceScore: 40,
    matchedCriteria: [],
    category: 'planning',
    recommended: false,
    description: 'Shapes the system',
  },
] as const;

export const PHASE_TWO_SCAN_PROGRESS = {
  filesScanned: 80,
  totalFiles: 160,
  detections: ['NestJS', 'TypeScript'],
  currentPhase: 'architecture-assessment',
  phaseLabel: 'Architecture assessment',
  currentPhaseNumber: 2,
  totalPhaseCount: 4,
  phaseStatuses: [
    { id: 'project-profile', status: 'completed' },
    { id: 'architecture-assessment', status: 'running' },
    { id: 'quality-audit', status: 'pending' },
    { id: 'elevation-plan', status: 'pending' },
  ],
} as const;

export const RUNNING_STREAM_EVENTS = [
  { kind: 'text', content: 'Reading nest-cli.json', timestamp: 1 },
  { kind: 'thinking', content: 'Mapping modules', timestamp: 2 },
  { kind: 'tool_start', content: 'Read', toolName: 'Read', timestamp: 3 },
  { kind: 'error', content: 'Optional file missing', timestamp: 4 },
] as const;

export interface BootOnboardingAnalyzeOptions {
  readonly theme: OnboardingTheme;
  readonly rpc?: Record<string, unknown>;
  readonly scene?: GlassScene;
  readonly accent?: GlassAccent;
}

/** Ready-home fixtures plus wizard RPC answers. Never-answered keys are stripped. */
export function onboardingAnalyzeFixtures(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  const fixtures: Record<string, unknown> = {
    ...onboardingReadyFixtures('ready'),
    'wizard:list-analyses': { analyses: [] },
    'wizard:get-resumable-run': { analysis: null, generation: null },
    'wizard:get-generation-run-state': { run: null },
    'wizard:recommend-agents': [...ANALYZE_RECOMMENDATIONS],
    'wizard:list-agent-packs': { packs: [] },
    'wizard:preview-generation': {
      agents: [{ agentId: 'backend-developer', files: [] }],
      previewToken: 'preview-e2e-analyze',
    },
    'wizard:submit-selection': {
      success: false,
      rejection: { reason: 'blocked', ownerTabId: 'other-generation-tab' },
    },
    ...overrides,
  };
  for (const [method, value] of Object.entries(fixtures)) {
    if (value === NEVER_ANSWERED) delete fixtures[method];
  }
  return fixtures;
}

/**
 * Boots Electron onboarding Home (flag done, Claude ready, workspace open)
 * with analyze RPC overrides. Returns the bridge for scan-progress injects.
 */
export async function bootOnboardingAnalyze(
  page: Page,
  fixtureUrl: string,
  options: BootOnboardingAnalyzeOptions,
): Promise<PostMessageBridge> {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installHost(page, 'electron', 'chat');
  await installRpcAutoResponder(page, onboardingAnalyzeFixtures(options.rpc ?? {}));
  await page.addInitScript(
    (seed: { theme: string; flag: string; scene: string | null; accent: string | null }) => {
      localStorage.setItem('ptah-theme-v2', seed.theme);
      localStorage.setItem('ptah.onboarding.v1', seed.flag);
      if (seed.scene !== null) localStorage.setItem('ptah-scene', seed.scene);
      if (seed.accent !== null) localStorage.setItem('ptah-accent', seed.accent);
    },
    {
      theme: options.theme,
      flag: JSON.stringify(FLAG_DONE),
      scene: options.scene ?? null,
      accent: options.accent ?? null,
    },
  );
  await page.goto(fixtureUrl, { timeout: 30_000 });
  await expect(page.locator('ptah-electron-shell').first()).toBeVisible();
  await bridge.inject({ type: 'switchView', payload: { view: 'onboarding' } });
  await expect(page.locator('[data-testid="onboarding-home"]')).toBeVisible();
  return bridge;
}

export async function injectScanProgress(bridge: PostMessageBridge): Promise<void> {
  await bridge.inject({
    type: 'setup-wizard:scan-progress',
    payload: { ...PHASE_TWO_SCAN_PROGRESS },
  });
}

export async function injectRunningStream(bridge: PostMessageBridge): Promise<void> {
  for (const payload of RUNNING_STREAM_EVENTS) {
    await bridge.inject({ type: 'setup-wizard:analysis-stream', payload: { ...payload } });
  }
}
