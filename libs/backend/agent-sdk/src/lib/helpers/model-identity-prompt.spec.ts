/**
 * `buildModelIdentityPrompt` — the block MUST name the model the session runs on.
 *
 * The block ends with "This clarification takes precedence over any other
 * identity instructions", so a wrong model here is not a cosmetic slip: the
 * agent authoritatively reports a model it is not running. The previous
 * implementation derived the name as
 * `OPUS || SONNET || HAIKU`, which is the first tier that happens to be
 * DEFINED rather than the tier the session runs on — so every non-opus session
 * on a provider with distinct tier mappings was mislabelled.
 *
 * Moonshot is used throughout because its three tiers are genuinely distinct
 * (`kimi-k2.7-code` / `kimi-k2.6` / `kimi-k2.5`), which is what makes the
 * per-tier assertions meaningful.
 */

import 'reflect-metadata';

import {
  SdkQueryOptionsBuilder,
  buildModelIdentityPrompt,
} from './sdk-query-options-builder';
import { getAnthropicProvider } from '@ptah-extension/shared';
import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';

const MOONSHOT = getAnthropicProvider('moonshot');

/** The provider's own registry mappings — not values invented by this spec. */
const TIERS = MOONSHOT?.defaultTiers as {
  opus: string;
  sonnet: string;
  haiku: string;
};

describe('buildModelIdentityPrompt — names the session model, not the first defined tier', () => {
  it('has a fixture provider whose three tiers really are distinct', () => {
    expect(new Set([TIERS.opus, TIERS.sonnet, TIERS.haiku]).size).toBe(3);
  });

  it.each([
    ['opus', () => TIERS.opus],
    ['sonnet', () => TIERS.sonnet],
    ['haiku', () => TIERS.haiku],
  ])('tier %s yields its own model name', (_tier, model) => {
    const prompt = buildModelIdentityPrompt('moonshot', model());

    expect(prompt).toContain(`running as **${model()}**`);
    expect(prompt).toContain(`you are ${model()} from Moonshot (Kimi)`);
  });

  it('does NOT leak the opus model into a sonnet session (the reported defect)', () => {
    const prompt = buildModelIdentityPrompt('moonshot', TIERS.sonnet);

    expect(prompt).toContain(TIERS.sonnet);
    expect(prompt).not.toContain(TIERS.opus);
    expect(prompt).not.toContain(TIERS.haiku);
  });

  it('returns undefined for a direct-Anthropic session (no provider id)', () => {
    expect(buildModelIdentityPrompt(null, TIERS.opus)).toBeUndefined();
  });

  it('returns undefined for an unknown provider id', () => {
    expect(
      buildModelIdentityPrompt('not-a-real-provider', TIERS.opus),
    ).toBeUndefined();
  });

  // Requirement: a missing clarification is a lesser defect than a false one.
  it.each([undefined, '', '   ', 'default', 'opus', 'sonnet', 'haiku', 'OPUS'])(
    'omits the block entirely rather than announce the unresolved id %p',
    (unresolved) => {
      expect(buildModelIdentityPrompt('moonshot', unresolved)).toBeUndefined();
    },
  );
});

// ---------------------------------------------------------------------------
// End-to-end: build() must thread the SAME value it assigns to options.model.
//
// Mirrors the `makeBuilderForPrepend` harness in
// sdk-query-options-builder.spec.ts — the constructor is driven directly so no
// DI container is needed.
// ---------------------------------------------------------------------------

const MOONSHOT_AUTH_ENV = {
  ANTHROPIC_BASE_URL: 'https://api.moonshot.ai/anthropic/',
  ANTHROPIC_AUTH_TOKEN: 'sk-test',
  ANTHROPIC_DEFAULT_OPUS_MODEL: TIERS.opus,
  ANTHROPIC_DEFAULT_SONNET_MODEL: TIERS.sonnet,
  ANTHROPIC_DEFAULT_HAIKU_MODEL: TIERS.haiku,
} as AuthEnv;

const TIER_TO_ENV: Record<string, string> = {
  opus: TIERS.opus,
  sonnet: TIERS.sonnet,
  haiku: TIERS.haiku,
};

function makeBuilder(): SdkQueryOptionsBuilder {
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const modelService = {
    // Same tier → model mapping ModelResolver performs off the env vars.
    resolveModelId: jest
      .fn()
      .mockImplementation((m: string) => TIER_TO_ENV[m] ?? m),
    hasCachedModels: jest.fn().mockReturnValue(false),
  };
  const injector = {
    buildBlock: jest.fn().mockResolvedValue(''),
    buildSessionStartBlock: jest.fn().mockResolvedValue(''),
    buildCorpusBlock: jest.fn().mockResolvedValue(''),
  };
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;
  return new ctor(
    logger,
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    noopHooks,
    {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: false, contextTokenThreshold: 200_000 }),
    },
    noopHooks,
    noopHooks,
    MOONSHOT_AUTH_ENV,
    modelService,
    injector,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
    noopHooks,
  );
}

async function buildFor(tier: string): Promise<{
  model: string;
  append: string;
}> {
  const cfg = await makeBuilder().build({
    userMessageStream: (async function* () {
      // Intentionally empty.
    })(),
    abortController: new AbortController(),
    sessionConfig: {
      model: tier,
      projectPath: 'D:/tmp/ws',
      // Every real interactive session carries a tabId; it is the routing id
      // the MCP `/session/{id}` segment is built from (TASK_2026_295).
      tabId: 'tab-fixture',
    } as AISessionConfig,
  });
  return {
    model: cfg.options.model as string,
    append: (cfg.options.systemPrompt as { append?: string }).append ?? '',
  };
}

describe('SdkQueryOptionsBuilder.build — identity block matches options.model', () => {
  it.each(['opus', 'sonnet', 'haiku'])(
    'a %s session announces the model it actually runs',
    async (tier) => {
      const { model, append } = await buildFor(tier);

      expect(model).toBe(TIER_TO_ENV[tier]);
      expect(append).toContain(`running as **${model}**`);
    },
  );

  it('a sonnet session never announces the opus model', async () => {
    const { append } = await buildFor('sonnet');

    expect(append).toContain(TIERS.sonnet);
    expect(append).not.toContain(TIERS.opus);
  });
});
