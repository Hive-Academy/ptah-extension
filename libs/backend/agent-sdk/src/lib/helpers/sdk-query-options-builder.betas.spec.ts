/**
 * `Options.betas` gating (TASK_2026_349).
 *
 * The 1M-context beta needs TWO things to be true, and only one of them used
 * to be checked. The base URL answers the TRANSPORT question -- would this
 * endpoint understand an Anthropic beta header at all -- and a third-party
 * endpoint 400s on one, which is why that gate exists. The CREDENTIAL answers
 * a second, independent question: the binary accepts custom betas only from an
 * API-key caller.
 *
 * A `claudeCli` session has an EMPTY `AuthEnv` by design. `CliStrategy` writes
 * no auth env vars (the binary reads its own store in `~/.claude/`), and
 * `AuthManager` clears all three vars from `AuthEnv` AND `process.env` before
 * every strategy runs. So `ANTHROPIC_BASE_URL` is absent, the `!baseUrl`
 * branch called it "Anthropic direct", and the beta went out on every launch.
 * Measured in `tmp/logs/log.log`: the strategy logs as Claude CLI at :583, the
 * builder logs "Enabling 1M context beta for Anthropic direct" at :2312/:2349,
 * and the CLI answers on stderr at :2331/:2365 with "Custom betas are only
 * available for API key users. Ignoring provided betas."
 *
 * These specs assert through `build()` rather than the private helper, because
 * the bug was never in the predicate -- it was in which questions the option
 * was gated on. `betas` reaching `Options` is the thing that matters.
 *
 * The INFO log line is asserted alongside the option: it claimed a 1M window
 * the session did not have, on every query launch, which is what made the
 * defect survive in the log for as long as it did.
 */

import 'reflect-metadata';

import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import type { AISessionConfig, AuthEnv } from '@ptah-extension/shared';

const ONE_M_BETA = 'context-1m-2025-08-07';
const ENABLE_LOG = '[SdkQueryOptionsBuilder] Enabling 1M context beta';

interface BuildResult {
  betas: readonly string[] | undefined;
  infoLines: string[];
  debugLines: string[];
}

async function buildWithAuthEnv(authEnv: AuthEnv): Promise<BuildResult> {
  const info = jest.fn();
  const debug = jest.fn();
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;

  const builder = new ctor(
    { info, warn: jest.fn(), error: jest.fn(), debug },
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
    authEnv,
    {
      resolveModelId: jest.fn().mockImplementation((m: string) => m),
      hasCachedModels: jest.fn().mockReturnValue(false),
      getSupportedModels: jest.fn(),
    },
    {
      buildBlock: jest.fn().mockResolvedValue(''),
      buildSessionStartBlock: jest.fn().mockResolvedValue(''),
      buildCorpusBlock: jest.fn().mockResolvedValue(''),
    },
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
    noopHooks,
  );

  const userMessageStream = (async function* () {
    // Intentionally empty -- build() attaches the stream, it does not iterate.
  })();

  const cfg = await builder.build({
    userMessageStream,
    abortController: new AbortController(),
    sessionConfig: {
      model: 'claude-sonnet-4-5',
      projectPath: 'D:/tmp/ws',
      tabId: 'tab-fixture',
    } as AISessionConfig,
  });

  const lines = (mock: jest.Mock): string[] =>
    mock.mock.calls.map((call) => String(call[0]));

  return {
    betas: cfg.options.betas,
    infoLines: lines(info),
    debugLines: lines(debug),
  };
}

describe('SdkQueryOptionsBuilder.build — betas require an API credential', () => {
  it('sends NO beta for a Claude CLI session (empty AuthEnv, no base URL)', async () => {
    const result = await buildWithAuthEnv({});

    expect(result.betas).toBeUndefined();
  });

  it('does not log "Enabling 1M context beta" for a Claude CLI session', async () => {
    const result = await buildWithAuthEnv({});

    // The misleading INFO line is the user-visible half of this defect.
    expect(result.infoLines.some((l) => l.includes(ENABLE_LOG))).toBe(false);
    // ...and the skip is still explained, at debug level.
    expect(
      result.debugLines.some((l) =>
        l.includes('Skipping 1M context beta: no API key or auth token'),
      ),
    ).toBe(true);
  });

  it('sends the beta when ANTHROPIC_API_KEY is set (apiKey auth, direct Anthropic)', async () => {
    const result = await buildWithAuthEnv({
      ANTHROPIC_API_KEY: 'sk-ant-api03-fixture',
    });

    expect(result.betas).toEqual([ONE_M_BETA]);
    expect(result.infoLines.some((l) => l.includes(ENABLE_LOG))).toBe(true);
  });

  it('sends the beta when ANTHROPIC_AUTH_TOKEN is set', async () => {
    const result = await buildWithAuthEnv({
      ANTHROPIC_AUTH_TOKEN: 'bearer-fixture',
    });

    expect(result.betas).toEqual([ONE_M_BETA]);
  });

  it('sends the beta for an explicit api.anthropic.com base URL with a key', async () => {
    const result = await buildWithAuthEnv({
      ANTHROPIC_BASE_URL: 'https://api.anthropic.com',
      ANTHROPIC_API_KEY: 'sk-ant-api03-fixture',
    });

    expect(result.betas).toEqual([ONE_M_BETA]);
  });

  it.each([
    ['empty string', ''],
    ['whitespace only', '   '],
  ])(
    'treats an %s ANTHROPIC_API_KEY as absent (the proxy path clears it by assigning "")',
    async (_label, value) => {
      const result = await buildWithAuthEnv({ ANTHROPIC_API_KEY: value });

      expect(result.betas).toBeUndefined();
    },
  );

  it('treats a whitespace-only ANTHROPIC_AUTH_TOKEN as absent', async () => {
    const result = await buildWithAuthEnv({ ANTHROPIC_AUTH_TOKEN: '  ' });

    expect(result.betas).toBeUndefined();
  });
});

describe('SdkQueryOptionsBuilder.build — the transport gate still stands alone', () => {
  it('sends NO beta to a third-party endpoint even WITH a credential', async () => {
    // Regression guard: the credential gate is an ADDITIONAL condition, not a
    // replacement. An Anthropic beta header on OpenRouter/Moonshot is a 400.
    const result = await buildWithAuthEnv({
      ANTHROPIC_BASE_URL: 'https://openrouter.ai/api/v1',
      ANTHROPIC_AUTH_TOKEN: 'sk-or-fixture',
    });

    expect(result.betas).toBeUndefined();
    expect(
      result.debugLines.some((l) =>
        l.includes('Skipping 1M context beta for third-party provider'),
      ),
    ).toBe(true);
  });

  it('sends NO beta to a local translation proxy even WITH a credential', async () => {
    const result = await buildWithAuthEnv({
      ANTHROPIC_BASE_URL: 'http://127.0.0.1:4000',
      ANTHROPIC_AUTH_TOKEN: 'copilot-proxy-managed',
    });

    expect(result.betas).toBeUndefined();
  });
});
