/**
 * Generate agents (A3), Project guidance (A4), and Done (A5) visual fixtures.
 * The real Electron shell boots from a saved logical route. Bound tabs and
 * wizard RPCs are seeded before Angular starts; no live generator is needed.
 */
import { expect, type Page } from '@playwright/test';
import type {
  PostMessageBridge,
  WebviewToExtensionMessage,
} from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import {
  installHost,
  installRpcAutoResponder,
} from '../settings/settings.fixtures';
import {
  onboardingAnalyzeFixtures,
  rpcError,
} from './onboarding-analyze.fixtures';
import { FLAG_DONE, type OnboardingTheme } from './onboarding-ready.fixtures';

export { rpcError };

export const WORKSPACE = 'C:\\ptah-e2e-ws-a';
export const AGENT_TAB = 'e2e-agent-tab';
export const GUIDANCE_TAB = 'e2e-guidance-tab';
export const AGENT_RUN_ID = 'e2e-agent-run';
export const GUIDANCE_RUN_ID = 'e2e-guidance-run';

const SOURCE = { kind: 'workspace-discovery', reason: 'missing' } as const;
const PROVIDER = 'anthropic';
const MODEL = 'claude-sonnet-4-5';

export const AGENT_BINDING = {
  tabId: AGENT_TAB,
  workspacePath: WORKSPACE,
  workflow: 'setup-agent-generation',
  runId: AGENT_RUN_ID,
} as const;
export const GUIDANCE_BINDING = {
  tabId: GUIDANCE_TAB,
  workspacePath: WORKSPACE,
  workflow: 'setup-project-prompt',
  runId: GUIDANCE_RUN_ID,
} as const;

export const AGENT_CHECKPOINT = {
  runId: AGENT_RUN_ID,
  analysisDirectory: null,
  outputDirectory: `${WORKSPACE}\\.claude\\agents`,
  lifecycle: 'running',
  selectedAgentIds: [
    'backend-developer',
    'software-architect',
    'test-engineer',
  ],
  agents: [
    {
      agentId: 'backend-developer',
      filePath: 'backend-developer.md',
      status: 'written',
      rejectedSections: 0,
      tailoredSections: 4,
    },
    {
      agentId: 'software-architect',
      filePath: 'software-architect.md',
      status: 'running',
      rejectedSections: 0,
      tailoredSections: 2,
    },
    {
      agentId: 'test-engineer',
      filePath: 'test-engineer.md',
      status: 'pending',
      rejectedSections: 0,
      tailoredSections: 0,
    },
  ],
} as const;

export const AGENT_RESULT = {
  status: 'completed',
  success: true,
  source: SOURCE,
  effectiveProvider: PROVIDER,
  effectiveModel: MODEL,
  agentOutcomes: [
    {
      agentId: 'backend-developer',
      status: 'written',
      fileName: 'backend-developer.md',
      rejectedSections: 0,
      tailoredSections: 4,
    },
    {
      agentId: 'software-architect',
      status: 'unchanged',
      fileName: 'software-architect.md',
      rejectedSections: 0,
      tailoredSections: 2,
    },
    {
      agentId: 'test-engineer',
      status: 'failed',
      fileName: 'test-engineer.md',
      rejectedSections: 0,
      tailoredSections: 0,
    },
  ],
  counts: {
    total: 3,
    written: 1,
    unchanged: 1,
    failed: 1,
    skipped: 0,
    rejected: 0,
  },
  rejectedSections: 0,
  tailoredSections: 6,
  propagation: { consent: 'not-granted', status: 'not-attempted' },
} as const;

export function agentRun(
  status: 'running' | 'completed' | 'failed' = 'running',
) {
  return {
    binding: AGENT_BINDING,
    status,
    source: SOURCE,
    effectiveProvider: PROVIDER,
    effectiveModel: MODEL,
    ...(status === 'completed' ? { result: AGENT_RESULT } : {}),
  };
}

/** A5 capture: a mixed terminal result with a failed Library refresh. */
export function doneAgentRun() {
  return {
    ...agentRun('completed'),
    result: {
      ...AGENT_RESULT,
      agentOutcomes: [
        AGENT_RESULT.agentOutcomes[0],
        { ...AGENT_RESULT.agentOutcomes[1], status: 'kept' as const },
        {
          ...AGENT_RESULT.agentOutcomes[2],
          error: 'EACCES: private host path',
        },
        {
          agentId: 'platform-engineer',
          status: 'changed-since-preview' as const,
          fileName: 'platform-engineer.md',
          rejectedSections: 0,
          tailoredSections: 0,
        },
      ],
      counts: {
        ...AGENT_RESULT.counts,
        total: 4,
        unchanged: 0,
        kept: 1,
        changedSincePreview: 1,
      },
      target: {
        harnessRoot: `${WORKSPACE}/project`,
        openedFolder: WORKSPACE,
        chosen: 'opened-folder' as const,
        openedIsHarnessRoot: false,
      },
      libraryPass: 'failed' as const,
      libraryDiverged: ['backend-developer'],
    },
  };
}

export function guidanceRun(status: 'running' | 'completed' = 'running') {
  return {
    binding: GUIDANCE_BINDING,
    status,
    source: SOURCE,
    effectiveProvider: PROVIDER,
    effectiveModel: MODEL,
    ...(status === 'completed'
      ? {
          committedState: 'committed',
          result: {
            status: 'completed',
            success: true,
            committedState: 'committed',
            source: SOURCE,
            effectiveProvider: PROVIDER,
            effectiveModel: MODEL,
          },
        }
      : {}),
  };
}

export const GUIDANCE_STATUS = {
  enabled: true,
  hasGeneratedPrompt: true,
  generatedAt: '2026-10-29T09:00:00.000Z',
  cacheValid: true,
  detectedStack: {
    projectType: 'NestJS API',
    languages: ['TypeScript'],
    frameworks: ['NestJS'],
    buildTools: ['Nx'],
    testingFrameworks: ['Jest'],
  },
} as const;

export const GUIDANCE_CONTENT = [
  '## Project-Specific Guidance',
  '### Project Context',
  'A TypeScript API in an Nx workspace.',
  '### Framework Guidelines',
  'Use NestJS modules and dependency injection.',
  '### Coding Standards',
  'Keep services focused and test behavior.',
  '### Architecture Notes',
  'Separate API contracts from host integrations.',
].join('\n');

export interface GenerateBootOptions {
  readonly theme: OnboardingTheme;
  readonly route: string;
  readonly rpc?: Record<string, unknown>;
}

/** A seeded form of the shared postMessage bridge, with the same wire contract. */
async function installRouteBridge(
  page: Page,
  route: string,
): Promise<PostMessageBridge> {
  await page.addInitScript((logicalRoute: string) => {
    const state = {
      outbound: [] as WebviewToExtensionMessage[],
      nextStateValue: {
        ptahRoute: {
          v: 1,
          route: logicalRoute,
          seed: 'chat',
          panelId: 'electron-main',
        },
      } as unknown,
    };
    (window as unknown as Record<string, unknown>)['__ptahE2EBridge__'] = state;
    let acquired = false;
    (
      window as unknown as { acquireVsCodeApi?: () => unknown }
    ).acquireVsCodeApi = () => {
      if (acquired)
        throw new Error('acquireVsCodeApi() can only be called once');
      acquired = true;
      return {
        postMessage(message: unknown): void {
          state.outbound.push(message as WebviewToExtensionMessage);
        },
        getState(): unknown {
          return state.nextStateValue;
        },
        setState(value: unknown): void {
          state.nextStateValue = value;
        },
      };
    };
  }, route);
  const outbound = () =>
    page.evaluate(() => [
      ...(
        window as unknown as {
          __ptahE2EBridge__: { outbound: WebviewToExtensionMessage[] };
        }
      ).__ptahE2EBridge__.outbound,
    ]);
  return {
    outbound,
    async waitForOutbound(predicate, options) {
      const deadline = Date.now() + (options?.timeoutMs ?? 5_000);
      while (Date.now() < deadline) {
        const message = (await outbound()).find(predicate);
        if (message) return message;
        await page.waitForTimeout(50);
      }
      throw new Error('waitForOutbound timed out');
    },
    inject: (message) =>
      page.evaluate((value) => {
        window.dispatchEvent(new MessageEvent('message', { data: value }));
      }, message),
    reset: () =>
      page.evaluate(() => {
        (
          window as unknown as {
            __ptahE2EBridge__: { outbound: WebviewToExtensionMessage[] };
          }
        ).__ptahE2EBridge__.outbound.length = 0;
      }),
  };
}

/** Start the Electron host on a logical onboarding route with two real bound tabs. */
export async function bootOnboardingGenerate(
  page: Page,
  fixtureUrl: string,
  options: GenerateBootOptions,
): Promise<PostMessageBridge> {
  await installCspStub(page);
  const bridge = await installRouteBridge(page, options.route);
  await installHost(page, 'electron', 'chat');
  await installRpcAutoResponder(page, {
    ...onboardingAnalyzeFixtures(),
    'wizard:get-generation-run-state': { run: null },
    'enhancedPrompts:getRunState': { run: null },
    'enhancedPrompts:getStatus': {
      enabled: false,
      hasGeneratedPrompt: false,
      generatedAt: null,
      cacheValid: false,
      detectedStack: null,
    },
    ...options.rpc,
  });
  await page.addInitScript(
    (seed: {
      theme: string;
      flag: string;
      workspace: string;
      agentTab: string;
      guidanceTab: string;
      activeTab: string;
    }) => {
      localStorage.setItem('ptah-theme-v2', seed.theme);
      localStorage.setItem('ptah.onboarding.v1', seed.flag);
      const tabs = [
        {
          id: seed.agentTab,
          workflow: 'setup-agent-generation',
          name: 'Generate agents',
          title: 'Generate agents',
          order: 0,
          status: 'loaded',
          isDirty: false,
          lastActivityAt: 1,
          messages: [],
          streamingState: null,
        },
        {
          id: seed.guidanceTab,
          workflow: 'setup-project-prompt',
          name: 'Project guidance',
          title: 'Project guidance',
          order: 1,
          status: 'loaded',
          isDirty: false,
          lastActivityAt: 1,
          messages: [],
          streamingState: null,
        },
      ];
      const key = `ptah.tabs.ws.${encodeURIComponent(seed.workspace).replace(/%/g, '_')}.e2e-harness`;
      localStorage.setItem(
        key,
        JSON.stringify({ version: 2, tabs, activeTabId: seed.activeTab }),
      );
    },
    {
      theme: options.theme,
      flag: JSON.stringify(FLAG_DONE),
      workspace: WORKSPACE,
      agentTab: AGENT_TAB,
      guidanceTab: GUIDANCE_TAB,
      activeTab: options.route.includes('/guidance') ? GUIDANCE_TAB : AGENT_TAB,
    },
  );
  await page.goto(fixtureUrl, { timeout: 30_000 });
  await expect(page.locator('ptah-electron-shell').first()).toBeVisible();
  return bridge;
}
