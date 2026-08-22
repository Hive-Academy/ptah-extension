import 'reflect-metadata';
import * as os from 'os';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SdkInternalQueryCuratorLlm,
  CURATOR_DEFAULT_MODEL_TIER,
} from './sdk-internal-query.curator-llm';
import { CuratorLlmQueryError } from './curator-llm-query.error';
import type { IProviderAuthResolver } from '../auth/provider-auth-resolver.port';
import type { OneShotAuthOverride } from '../helpers/sdk-query-runner.service';
import type { InternalQueryService } from '../internal-query';
import type { AuthEnv } from '@ptah-extension/shared';

class FakeProviderAuthError extends Error {
  readonly providerId: string;
  constructor(providerId: string, message: string) {
    super(message);
    this.name = 'ProviderAuthError';
    this.providerId = providerId;
  }
}

/**
 * The sibling throw the curator must answer DIFFERENTLY. Matched by `name`,
 * like the real one, because `ProviderQuotaError` lives in `auth-providers`.
 */
class FakeProviderQuotaError extends Error {
  readonly providerId: string;
  readonly retryAfterMs: number;
  constructor(providerId: string, retryAfterMs: number, message: string) {
    super(message);
    this.name = 'ProviderQuotaError';
    this.providerId = providerId;
    this.retryAfterMs = retryAfterMs;
  }
}

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

function makeWorkspace(
  curatorModel: string,
  workspaceRoot?: string,
): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => workspaceRoot),
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined => {
        if (key === 'memory.curatorModel') {
          return curatorModel as unknown as T;
        }
        return fallback;
      },
    ),
  } as unknown as IWorkspaceProvider;
}

function makeWorkspaceFromConfig(
  config: Record<string, unknown>,
): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => undefined),
    getConfiguration: jest.fn(
      <T>(_section: string, key: string, fallback?: T): T | undefined => {
        if (key in config) return config[key] as unknown as T;
        return fallback;
      },
    ),
  } as unknown as IWorkspaceProvider;
}

function makeThrowingWorkspace(): IWorkspaceProvider {
  return {
    getWorkspaceRoot: jest.fn(() => undefined),
    getConfiguration: jest.fn(() => {
      throw new Error('settings file unreadable');
    }),
  } as unknown as IWorkspaceProvider;
}

async function* streamFrom(text: string): AsyncIterable<unknown> {
  yield {
    type: 'assistant',
    message: { content: [{ type: 'text', text }] },
  };
  yield { type: 'result' };
}

interface ExecuteCapture {
  model?: string;
  cwd?: string;
  auth?: OneShotAuthOverride;
  authWasPresent?: boolean;
}

function makeInternalQuery(opts: {
  text?: string;
  throwOnExecute?: Error;
  capture?: ExecuteCapture;
}): InternalQueryService {
  return {
    execute: jest.fn(
      async (config: {
        model: string;
        cwd: string;
        auth?: OneShotAuthOverride;
      }) => {
        if (opts.capture) {
          opts.capture.model = config.model;
          opts.capture.cwd = config.cwd;
          opts.capture.auth = config.auth;
          opts.capture.authWasPresent = 'auth' in config;
        }
        if (opts.throwOnExecute) throw opts.throwOnExecute;
        return { stream: streamFrom(opts.text ?? '') };
      },
    ),
  } as unknown as InternalQueryService;
}

function makeResolver(
  impl: (id: string) => Promise<OneShotAuthOverride | null>,
): IProviderAuthResolver & { resolve: jest.Mock } {
  return { resolve: jest.fn(impl) } as unknown as IProviderAuthResolver & {
    resolve: jest.Mock;
  };
}

const EXTRACT_TRANSCRIPT = 'some real transcript content for extraction';

describe('SdkInternalQueryCuratorLlm — resolveCuratorModel', () => {
  it('uses the configured memory.curatorModel when set', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('claude-sonnet-4-5-20250101'),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('sends the bare haiku TIER ALIAS — not a pinned Claude id — when unset', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('haiku');
    expect(CURATOR_DEFAULT_MODEL_TIER).toBe('haiku');
  });

  it('never hands a hardcoded Anthropic model id to a non-Anthropic provider', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': '',
        'memory.curatorProvider': 'ollama-cloud',
        authMethod: 'thirdParty',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).not.toMatch(/^claude-/);
    expect(capture.model).toBe('haiku');
  });

  it('falls back when the configured value is whitespace only', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('   '),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_DEFAULT_MODEL_TIER);
  });

  it('trims the configured value before sending it as the model id', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('  claude-sonnet-4-5-20250101  '),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('falls back to CURATOR_DEFAULT_MODEL_TIER when getConfiguration throws', async () => {
    const capture: { model?: string } = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeThrowingWorkspace(),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe(CURATOR_DEFAULT_MODEL_TIER);
  });
});

describe('SdkInternalQueryCuratorLlm — query cwd', () => {
  it('roots the internal query at the active workspace, not process.cwd()', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace('', '/home/abdo/project'),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.cwd).toBe('/home/abdo/project');
    expect(capture.cwd).not.toBe(process.cwd());
  });

  it('falls back to the user home dir when no workspace folder is open', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.cwd).toBe(os.homedir());
  });
});

describe('SdkInternalQueryCuratorLlm — no cross-provider downgrade', () => {
  it('uses the configured curatorModel verbatim even when curatorProvider differs from the active provider', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const resolver = makeResolver(async () => ({
      env: { ANTHROPIC_BASE_URL: 'https://example.test' } as AuthEnv,
    }));
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('glm-4.6');
  });

  it('uses the configured curatorModel when curatorProvider matches the active provider', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'anthropic',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });
});

describe('SdkInternalQueryCuratorLlm — curator auth routing', () => {
  it('resolves auth and passes the override into execute when the resolver returns one', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const override: OneShotAuthOverride = {
      env: { ANTHROPIC_BASE_URL: 'http://127.0.0.1:51999' } as AuthEnv,
      baseUrl: 'http://127.0.0.1:51999',
    };
    const resolver = makeResolver(async () => override);
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'glm-4.6',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(resolver.resolve).toHaveBeenCalledWith('z-ai');
    expect(capture.auth).toBe(override);
    expect(capture.model).toBe('glm-4.6');
  });

  it('proceeds with auth=undefined and warns when the resolver throws ProviderAuthError', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const logger = makeLogger();
    const resolver = makeResolver(async () => {
      throw new FakeProviderAuthError(
        'github-copilot',
        'curator provider not authenticated',
      );
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      logger,
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'github-copilot',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.auth).toBeUndefined();
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
    expect(logger.warn).toHaveBeenCalledWith(
      '[memory-curator] curator provider auth unavailable; riding active provider',
      expect.objectContaining({ curatorProviderId: 'github-copilot' }),
    );
  });

  it('returns auth=undefined when the resolver yields null (rides active provider)', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const resolver = makeResolver(async () => null);
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': '',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(resolver.resolve).toHaveBeenCalledWith('');
    expect(capture.auth).toBeUndefined();
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('rides active provider (auth=undefined) when no resolver is injected (off-Electron)', async () => {
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
    );
    await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(capture.auth).toBeUndefined();
    expect(capture.authWasPresent).toBe(true);
    expect(capture.model).toBe('claude-sonnet-4-5-20250101');
  });

  it('rethrows non-ProviderAuthError resolver failures', async () => {
    const internalQuery = makeInternalQuery({ text: '{"memories":[]}' });
    const resolver = makeResolver(async () => {
      throw new Error('unexpected resolver crash');
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'z-ai',
        authMethod: 'apiKey',
      }),
      resolver,
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).rejects.toBeInstanceOf(
      CuratorLlmQueryError,
    );
  });
});

/**
 * The quota branch (TASK_2026_306 defect B, decision A2).
 *
 * The curator STOPS while its resolved provider is cooling down. It does not
 * inherit the `ProviderAuthError` fallback, and the reason is not symmetry: an
 * unpinned curator (`''`) resolves TO the active provider, so "fall back to the
 * active provider" would mean "immediately retry the one that just said no",
 * and where a separate curator provider IS pinned the fallback moves an
 * exhausted provider's work onto the user's foreground quota.
 *
 * It also does not THROW. `ICuratorLLM`'s contract grows no failure mode — the
 * curator degrades to the same empty shape every other unusable-reply path
 * here already produces.
 */
describe('SdkInternalQueryCuratorLlm — the quota gate (A2)', () => {
  const quotaResolver = () =>
    makeResolver(async () => {
      throw new FakeProviderQuotaError(
        'openai-codex',
        900_000,
        'Provider quota exhausted; retrying in about 15 min.',
      );
    });

  function makeAdapter(logger: Logger, internalQuery: InternalQueryService) {
    return new SdkInternalQueryCuratorLlm(
      logger,
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': '',
        authMethod: 'apiKey',
      }),
      quotaResolver(),
    );
  }

  it('runs NO query at all while the provider is cooling down', async () => {
    // The point of gating before dispatch: the second and later passes cost
    // zero upstream requests. Falling back would have cost one each.
    const internalQuery = makeInternalQuery({ text: '{"memories":[]}' });
    const adapter = makeAdapter(makeLogger(), internalQuery);

    await adapter.extract(EXTRACT_TRANSCRIPT);

    expect(internalQuery.execute).not.toHaveBeenCalled();
  });

  it('extracts nothing rather than riding the active provider', async () => {
    // The stubbed query would return a PERFECTLY VALID draft. Getting `[]` back
    // therefore proves the query never happened, not that the reply was
    // unparseable — a weaker fixture here would pass either way.
    const adapter = makeAdapter(
      makeLogger(),
      makeInternalQuery({
        text: '{"memories":[{"kind":"fact","content":"the build uses esbuild"}]}',
      }),
    );

    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual([]);
  });

  it('does not throw — ICuratorLLM grows no new failure mode', async () => {
    const adapter = makeAdapter(
      makeLogger(),
      makeInternalQuery({ text: '{"memories":[]}' }),
    );

    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.not.toThrow;
    await expect(
      adapter.resolve(
        [{ content: 'a draft' } as never],
        [{ id: '1', subject: null, content: 'related' }],
      ),
    ).resolves.toEqual([{ content: 'a draft', mergeTargetId: null }]);
  });

  it('warns with a message about the quota, distinct from the auth fallback line', async () => {
    const logger = makeLogger();
    const adapter = makeAdapter(
      logger,
      makeInternalQuery({ text: '{"memories":[]}' }),
    );

    await adapter.extract(EXTRACT_TRANSCRIPT);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('rate-limited'),
      expect.objectContaining({ curatorProviderId: '' }),
    );
    expect(logger.warn).not.toHaveBeenCalledWith(
      '[memory-curator] curator provider auth unavailable; riding active provider',
      expect.anything(),
    );
  });

  it('leaves the ProviderAuthError fallback exactly as it was', async () => {
    // The documented divergence from lanes stays. Only the quota case is new.
    const capture: ExecuteCapture = {};
    const internalQuery = makeInternalQuery({
      text: '{"memories":[]}',
      capture,
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspaceFromConfig({
        'memory.curatorModel': 'claude-sonnet-4-5-20250101',
        'memory.curatorProvider': 'github-copilot',
        authMethod: 'apiKey',
      }),
      makeResolver(async () => {
        throw new FakeProviderAuthError('github-copilot', 'not authenticated');
      }),
    );

    await adapter.extract(EXTRACT_TRANSCRIPT);

    expect(internalQuery.execute).toHaveBeenCalledTimes(1);
    expect(capture.auth).toBeUndefined();
  });
});

describe('SdkInternalQueryCuratorLlm — error vs empty', () => {
  it('re-throws CuratorLlmQueryError on SDK/transport failure', async () => {
    const internalQuery = makeInternalQuery({
      throwOnExecute: new Error('404 model not found'),
    });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).rejects.toBeInstanceOf(
      CuratorLlmQueryError,
    );
  });

  it('returns [] (does not throw) when model output is empty', async () => {
    const internalQuery = makeInternalQuery({ text: '' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual([]);
  });

  it('returns [] when model output is non-JSON garbage', async () => {
    const internalQuery = makeInternalQuery({ text: 'not json at all' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual([]);
  });
});
