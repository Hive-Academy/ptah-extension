/**
 * Get ready capture fixtures (TASK_2026_ONBOARDING B1c, implementation-plan.addendum-prereqs.md
 * component 12). Every readiness state is produced from mocked RPC replies, so the captures do not
 * depend on whether Claude Code is installed on the capturing machine.
 *
 * Each {@link READINESS_FIXTURES} entry overrides only the two readiness RPCs on top of
 * `baseSettingsFixtures()`: `agent:detectClis` and `provider:getAmbientClaudeStatus`. A key set to
 * {@link NEVER_ANSWERED} is removed from the fixture map before the responder is installed, and the
 * responder never answers an unfixtured method (`marketplace.fixtures.ts` `installRpcAutoResponder`),
 * which is how `checking` stays in progress. The failed detection of `error-local` must be a resolver:
 * the responder honours `rpcError` only for resolver returns, while a static value is sent as a
 * successful reply.
 *
 * This file imports nothing from `@ptah-extension/onboarding`; state text is asserted by the spec as
 * literals.
 */
import { expect, type Page } from '@playwright/test';
import {
  installPostMessageBridge,
  type PostMessageBridge,
} from '../../postmessage-bridge';
import { installCspStub } from '../../csp-stub';
import { rpcError } from '../marketplace/marketplace.fixtures';
import {
  AGENT_CONFIG_FIXTURE,
  baseSettingsFixtures,
  installHost,
  installRpcAutoResponder,
} from '../settings/settings.fixtures';

/** The four product theme ids (addendum "Visual layer", Themes table). */
export const ONBOARDING_THEMES = [
  'ptah-glass',
  'ptah-glass-light',
  'anubis',
  'anubis-light',
] as const;
export type OnboardingTheme = (typeof ONBOARDING_THEMES)[number];

/** CI keeps dark and light glass coverage at both sizes; local runs include all themes. */
export const ONBOARDING_CAPTURE_THEMES: readonly OnboardingTheme[] = process
  .env['CI']
  ? [ONBOARDING_THEMES[0], ONBOARDING_THEMES[1]]
  : ONBOARDING_THEMES;

/** The two glass themes (reduced-transparency captures and the contrast sweep). */
export const GLASS_THEMES = ['ptah-glass', 'ptah-glass-light'] as const;

export type ReadinessFixtureId =
  | 'checking'
  | 'checking-ambient'
  | 'ready'
  | 'missing'
  | 'signed-out'
  | 'error-timeout'
  | 'error-unreadable'
  | 'error-local';

/** The seven stage-1 readiness ids (every id except `checking-ambient`, which is a stage-2 view). */
export const STAGE_ONE_READINESS_IDS = [
  'checking',
  'ready',
  'missing',
  'signed-out',
  'error-timeout',
  'error-unreadable',
  'error-local',
] as const satisfies readonly ReadinessFixtureId[];

/** Marks a readiness RPC the responder must never answer (the key is removed before install). */
export const NEVER_ANSWERED: unique symbol = Symbol('never-answered');

/** Fixed data, so every capture is the same on every run. */
export const CHECKED_AT = '2026-10-29T09:00:00.000Z';
export const CLAUDE_PATH =
  'C:\\Users\\ptah-e2e\\AppData\\Roaming\\npm\\claude.cmd';
export const CLAUDE_VERSION = '2.1.3 (Claude Code)';

const DETECT_CLIS = 'agent:detectClis';
const AMBIENT_STATUS = 'provider:getAmbientClaudeStatus';

function detectClisReply(claudeInstalled: boolean): Record<string, unknown> {
  const claudeRow = claudeInstalled
    ? {
        cli: 'claude',
        installed: true,
        path: CLAUDE_PATH,
        version: CLAUDE_VERSION,
        messagingMode: 'none',
      }
    : { cli: 'claude', installed: false, messagingMode: 'none' };
  return { clis: [claudeRow, ...AGENT_CONFIG_FIXTURE.detectedClis] };
}

function ambientReply(
  state: 'connected' | 'signed-out' | 'unknown',
  reason?: 'cli-missing' | 'timeout' | 'unreadable',
): Record<string, unknown> {
  return {
    ok: true,
    status: reason
      ? { state, checkedAt: CHECKED_AT, reason }
      : { state, checkedAt: CHECKED_AT },
  };
}

/** The readiness RPC overrides per fixture id (addendum component 12 table). */
export const READINESS_FIXTURES: Record<
  ReadinessFixtureId,
  Record<string, unknown>
> = {
  checking: {
    [DETECT_CLIS]: NEVER_ANSWERED,
    [AMBIENT_STATUS]: NEVER_ANSWERED,
  },
  'checking-ambient': {
    [DETECT_CLIS]: detectClisReply(true),
    [AMBIENT_STATUS]: NEVER_ANSWERED,
  },
  ready: {
    [DETECT_CLIS]: detectClisReply(true),
    [AMBIENT_STATUS]: ambientReply('connected'),
  },
  missing: {
    [DETECT_CLIS]: detectClisReply(false),
    [AMBIENT_STATUS]: ambientReply('unknown', 'cli-missing'),
  },
  'signed-out': {
    [DETECT_CLIS]: detectClisReply(true),
    [AMBIENT_STATUS]: ambientReply('signed-out'),
  },
  'error-timeout': {
    [DETECT_CLIS]: detectClisReply(true),
    [AMBIENT_STATUS]: ambientReply('unknown', 'timeout'),
  },
  'error-unreadable': {
    [DETECT_CLIS]: detectClisReply(true),
    [AMBIENT_STATUS]: ambientReply('unknown', 'unreadable'),
  },
  'error-local': {
    [DETECT_CLIS]: () => rpcError('detect failed'),
    [AMBIENT_STATUS]: ambientReply('connected'),
  },
};

/** `localStorage['ptah.onboarding.v1']` record shape the flag service reads. */
export interface OnboardingFlagSeed {
  readonly shownAt?: string;
  readonly ready?: {
    readonly claudeAt?: string;
    readonly settingsAt?: string;
    readonly skippedAt?: string;
  };
}

/** Home after the pre-steps were skipped: strip item 2 reads "Skipped". */
export const FLAG_SKIPPED: OnboardingFlagSeed = {
  shownAt: CHECKED_AT,
  ready: { skippedAt: CHECKED_AT },
};

/** Home after both pre-steps were finished: strip item 2 reads "Done". */
export const FLAG_DONE: OnboardingFlagSeed = {
  shownAt: CHECKED_AT,
  ready: { claudeAt: CHECKED_AT, settingsAt: CHECKED_AT },
};

export type GlassScene = 'aurora' | 'ember' | 'tide' | 'horizon';
export type GlassAccent = 'gold' | 'rose' | 'moonstone';

export interface BootOnboardingReadyOptions {
  readonly theme: OnboardingTheme;
  readonly readiness: ReadinessFixtureId;
  /** Seeded flag. With one the first-run guard does not fire and Home is entered through `switchView`. */
  readonly flag?: OnboardingFlagSeed;
  /** Scene and accent hint keys (`ptah-scene`, `ptah-accent`), for the contrast sweep only. */
  readonly scene?: GlassScene;
  readonly accent?: GlassAccent;
}

/** The fixture map for one readiness id, with every never-answered key removed. */
export function onboardingReadyFixtures(
  readiness: ReadinessFixtureId,
): Record<string, unknown> {
  const fixtures: Record<string, unknown> = {
    ...baseSettingsFixtures(),
    // A first-run workspace: no agents or analyses yet, so Home shows its path cards instead of
    // the skeleton tiles it keeps until the first status answer.
    'setup-status:get-status': {
      isConfigured: false,
      agentCount: 0,
      ruleCount: 0,
      lastUpdated: null,
      hasClaudeConfig: false,
    },
    'wizard:list-analyses': { analyses: [] },
    ...READINESS_FIXTURES[readiness],
  };
  for (const [method, value] of Object.entries(fixtures)) {
    if (value === NEVER_ANSWERED) delete fixtures[method];
  }
  return fixtures;
}

/**
 * Boots the Electron webview with the readiness fixtures, mirroring `bootSettings`
 * (`settings.fixtures.ts`). Without a flag the first-run guard redirects to stage 1; with one, Home
 * is entered through `switchView`, as `bootSettings` enters Settings. Returns the bridge so a spec
 * can switch views again (the B1b Settings drawer captures).
 */
export async function bootOnboardingReady(
  page: Page,
  fixtureUrl: string,
  options: BootOnboardingReadyOptions,
): Promise<PostMessageBridge> {
  await installCspStub(page);
  const bridge = await installPostMessageBridge(page);
  await installHost(page, 'electron', 'chat');
  await installRpcAutoResponder(
    page,
    onboardingReadyFixtures(options.readiness),
  );
  await page.addInitScript(
    (seed: {
      theme: string;
      flag: string | null;
      scene: string | null;
      accent: string | null;
    }) => {
      localStorage.setItem('ptah-theme-v2', seed.theme);
      if (seed.flag !== null)
        localStorage.setItem('ptah.onboarding.v1', seed.flag);
      if (seed.scene !== null) localStorage.setItem('ptah-scene', seed.scene);
      if (seed.accent !== null)
        localStorage.setItem('ptah-accent', seed.accent);
    },
    {
      theme: options.theme,
      flag: options.flag ? JSON.stringify(options.flag) : null,
      scene: options.scene ?? null,
      accent: options.accent ?? null,
    },
  );
  // Boot is setup, not what these captures measure (`bootSettings` Batch 53.6 note).
  await page.goto(fixtureUrl, { timeout: 30_000 });
  await expect(page.locator('ptah-electron-shell').first()).toBeVisible();
  if (options.flag) {
    await bridge.inject({
      type: 'switchView',
      payload: { view: 'onboarding' },
    });
    await expect(page.locator('[data-testid="onboarding-home"]')).toBeVisible();
  } else {
    await expect(
      page.locator('[data-testid="ready-claude-step"]'),
    ).toBeVisible();
  }
  return bridge;
}
