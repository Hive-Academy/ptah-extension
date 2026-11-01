/** Electron proposal capture fixtures. All saved state is installed before Angular boots. */
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
import { onboardingAnalyzeFixtures } from './onboarding-analyze.fixtures';
import { FLAG_DONE, type OnboardingTheme } from './onboarding-ready.fixtures';

export const WORKSPACE = 'C:\\ptah-e2e-ws-a';
export const TAB = 'e2e-proposal-tab';
export const SESSION = 'e2e-proposal-session';
export const FIRST_REVISION = 'proposal-revision-1';
export const SECOND_REVISION = 'proposal-revision-2';
const CAPTURED_AT = '2026-10-29T09:00:00.000Z';
const CANONICAL_WORKSPACE = 'c:/ptah-e2e-ws-a';
const INTAKE = {
  what: 'Build an internal incident response workspace for an operations team.',
  audience: 'internal',
  stack: 'recommend',
  constraints: 'Fast search and clear audit history.',
} as const;
const FIRST_UPDATES = {
  name: 'Incident Atlas',
  persona: {
    label: 'Operations lead',
    description:
      'Coordinates incident response and keeps a reliable audit trail.',
    goals: ['Triage incidents', 'Track ownership'],
  },
};
const SECOND_UPDATES = {
  name: 'Incident Atlas Studio',
  prompt: {
    systemPrompt:
      'Help the operations team triage incidents and document every decision.',
    enhancedSections: {},
  },
};
const REVISIONS = [
  {
    id: FIRST_REVISION,
    configUpdates: FIRST_UPDATES,
    isConfigComplete: false,
    updatedAt: CAPTURED_AT,
    turnStartedAt: '2026-10-29T08:59:00.000Z',
  },
  {
    id: SECOND_REVISION,
    configUpdates: SECOND_UPDATES,
    isConfigComplete: true,
    updatedAt: '2026-10-29T09:04:00.000Z',
    turnStartedAt: '2026-10-29T09:03:00.000Z',
  },
] as const;

export type ProposalScene = 'empty' | 'first' | 'second' | 'unavailable';
export interface ProposalBootOptions {
  readonly theme: OnboardingTheme;
  readonly route: string;
  readonly scene: ProposalScene;
}

function proposalFor(scene: ProposalScene): unknown {
  if (scene === 'unavailable' || scene === 'empty') return null;
  const revisions = scene === 'first' ? REVISIONS.slice(0, 1) : REVISIONS;
  return {
    version: 1,
    workspaceRoot: WORKSPACE,
    sessionId: SESSION,
    configUpdates:
      scene === 'first'
        ? FIRST_UPDATES
        : { ...FIRST_UPDATES, ...SECOND_UPDATES },
    isConfigComplete: scene === 'second',
    updatedAt: revisions.at(-1)?.updatedAt ?? CAPTURED_AT,
    revisions,
  };
}

/** RPCs used by the proposal pages, their nested sections, and the apply health refresh. */
export function proposalRpcFixtures(
  scene: ProposalScene,
): Record<string, unknown> {
  return {
    ...onboardingAnalyzeFixtures(),
    // The new-project intake checks the folder before it enables Continue.
    'harness:initialize': {
      workspaceEffectivelyEmpty: true,
      workspaceContext: {
        projectName: 'ptah-e2e-ws-a',
        projectType: 'unknown',
        frameworks: [],
        languages: [],
      },
      availableAgents: [],
      availableSkills: [],
      existingPresets: [],
      workspaceRoot: WORKSPACE,
    },
    'harness:start-new-project': {
      success: true,
      seedPrompt: 'Propose a complete incident response harness.',
      intake: INTAKE,
      plugins: {
        enabledBundled: ['ptah-nx-saas'],
        missingExternal: [{ marketplace: 'official', plugin: 'github' }],
        availableSkillIds: ['incident-triage', 'audit-writing'],
      },
      toolchain: {
        profileId: 'node-ts',
        command: 'node',
        installed: true,
        version: '22.0.0',
        satisfiesMin: true,
        minVersion: '20.0.0',
        installHint: 'Node.js is ready.',
      },
    },
    'harness:workflow-prompt': {
      prompt: 'Propose an AI team for this workspace.',
    },
    'harness:get-proposal': { proposal: proposalFor(scene) },
    'harness:load-presets': { presets: [] },
    'harness:apply': {
      appliedPaths: [
        `${WORKSPACE}\\CLAUDE.md`,
        `${WORKSPACE}\\.claude\\agents\\incident-triage.md`,
      ],
      warnings: ['Review the GitHub plugin before enabling it for the team.'],
    },
    'harness:health': { health: null },
  };
}

/** Seed the logical route and collect outgoing host messages, as in the generate captures. */
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

/** Boot a real Electron shell with a controller-restorable proposal tab when needed. */
export async function bootOnboardingProposal(
  page: Page,
  fixtureUrl: string,
  options: ProposalBootOptions,
): Promise<PostMessageBridge> {
  await installCspStub(page);
  const bridge = await installRouteBridge(page, options.route);
  await installHost(page, 'electron', 'chat');
  await installRpcAutoResponder(page, proposalRpcFixtures(options.scene));
  await page.addInitScript(
    (seed: {
      theme: string;
      flag: string;
      workspace: string;
      canonicalWorkspace: string;
      tab: string;
      session: string;
      capturedAt: string;
      intake: typeof INTAKE;
      hasSession: boolean;
    }) => {
      localStorage.setItem('ptah-theme-v2', seed.theme);
      localStorage.setItem('ptah.onboarding.v1', seed.flag);
      if (!seed.hasSession) return;
      const tab = {
        id: seed.tab,
        workflow: 'harness-new-project',
        name: 'New Project',
        title: 'New Project',
        order: 0,
        status: 'loaded',
        isDirty: false,
        lastActivityAt: 1,
        claudeSessionId: seed.session,
        messages: [],
        streamingState: null,
      };
      const tabsKey = `ptah.tabs.ws.${encodeURIComponent(seed.workspace).replace(/%/g, '_')}.e2e-harness`;
      localStorage.setItem(
        tabsKey,
        JSON.stringify({
          version: 2,
          tabs: [tab],
          activeTabId: seed.tab,
        }),
      );
      const keyPart = (value: string) =>
        encodeURIComponent(value).replace(/\./g, '%2E');
      const prefix = 'ptah.harness.builder.v1';
      const recordKey = (kind: string) =>
        `${prefix}.${kind}.${keyPart(seed.canonicalWorkspace)}.${keyPart(seed.tab)}`;
      localStorage.setItem(
        recordKey('session'),
        JSON.stringify({
          version: 1,
          tabId: seed.tab,
          sessionId: seed.session,
          mode: 'new-project',
          workspacePath: seed.canonicalWorkspace,
          intake: seed.intake,
          intakeHash: 'e2e-intake-hash',
          sendAttempt: { count: 1, ackedAt: seed.capturedAt },
        }),
      );
      localStorage.setItem(
        recordKey('stack'),
        JSON.stringify({
          version: 1,
          workspaceRoot: seed.canonicalWorkspace,
          tabId: seed.tab,
          plugins: {
            enabledBundled: ['ptah-nx-saas'],
            missingExternal: [{ marketplace: 'official', plugin: 'github' }],
            availableSkillIds: ['incident-triage', 'audit-writing'],
          },
          toolchain: {
            profileId: 'node-ts',
            command: 'node',
            installed: true,
            version: '22.0.0',
            satisfiesMin: true,
            minVersion: '20.0.0',
            installHint: 'Node.js is ready.',
          },
          capturedAt: seed.capturedAt,
        }),
      );
    },
    {
      theme: options.theme,
      flag: JSON.stringify(FLAG_DONE),
      workspace: WORKSPACE,
      canonicalWorkspace: CANONICAL_WORKSPACE,
      tab: TAB,
      session: SESSION,
      capturedAt: CAPTURED_AT,
      intake: INTAKE,
      hasSession: options.scene !== 'empty',
    },
  );
  await page.goto(fixtureUrl, { timeout: 30_000 });
  await expect(page.locator('ptah-electron-shell').first()).toBeVisible();
  return bridge;
}
