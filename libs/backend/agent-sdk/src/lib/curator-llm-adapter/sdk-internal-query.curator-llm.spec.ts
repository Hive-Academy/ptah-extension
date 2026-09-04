import 'reflect-metadata';
import * as os from 'os';
import type { Logger } from '@ptah-extension/vscode-core';
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SdkInternalQueryCuratorLlm,
  CURATOR_DEFAULT_MODEL_TIER,
  CURATOR_MAX_TURNS,
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

/** An assistant content block as the SDK streams it. */
type AssistantBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string };

/**
 * A stream built from arbitrary assistant blocks, so a run whose whole
 * contribution was tool calls can be replayed. `streamFrom` cannot express
 * that — it only ever yields one text block (TASK_2026_376 F8).
 */
function streamOfBlocks(
  blocks: readonly AssistantBlock[],
  resultSubtype?: string,
): () => AsyncIterable<unknown> {
  return async function* () {
    yield { type: 'assistant', message: { content: blocks } };
    yield resultSubtype
      ? { type: 'result', subtype: resultSubtype }
      : { type: 'result' };
  };
}

/**
 * A MULTI-TURN stream: one assistant message per entry, in order.
 *
 * `streamOfBlocks` cannot express this — it yields exactly one assistant
 * message, which is all `maxTurns: 1` could ever produce. At six turns the run
 * that matters is the one whose early messages are working notes and whose LAST
 * message is the answer (TASK_2026_376 R1).
 */
function streamOfMessages(
  messages: readonly (readonly AssistantBlock[])[],
  resultSubtype?: string,
): () => AsyncIterable<unknown> {
  return async function* () {
    for (const blocks of messages) {
      yield { type: 'assistant', message: { content: blocks } };
    }
    yield resultSubtype
      ? { type: 'result', subtype: resultSubtype }
      : { type: 'result' };
  };
}

interface ExecuteCapture {
  model?: string;
  cwd?: string;
  auth?: OneShotAuthOverride;
  authWasPresent?: boolean;
  maxTurns?: number;
}

function makeInternalQuery(opts: {
  text?: string;
  blocks?: readonly AssistantBlock[];
  messages?: readonly (readonly AssistantBlock[])[];
  resultSubtype?: string;
  throwOnExecute?: Error;
  capture?: ExecuteCapture;
}): InternalQueryService {
  return {
    execute: jest.fn(
      async (config: {
        model: string;
        cwd: string;
        maxTurns?: number;
        auth?: OneShotAuthOverride;
      }) => {
        if (opts.capture) {
          opts.capture.model = config.model;
          opts.capture.cwd = config.cwd;
          opts.capture.maxTurns = config.maxTurns;
          opts.capture.auth = config.auth;
          opts.capture.authWasPresent = 'auth' in config;
        }
        if (opts.throwOnExecute) throw opts.throwOnExecute;
        if (opts.messages) {
          return {
            stream: streamOfMessages(opts.messages, opts.resultSubtype)(),
          };
        }
        if (opts.blocks) {
          return {
            stream: streamOfBlocks(opts.blocks, opts.resultSubtype)(),
          };
        }
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

  it('reports status "stalled" — NOT an empty extraction (TASK_2026_306 F1)', async () => {
    // The stubbed query would return a PERFECTLY VALID draft, so a `[]`-shaped
    // answer proves the query never happened rather than that the reply was
    // unparseable.
    //
    // But `[]` was ALSO the pre-fix answer, and that is the defect: it is what
    // a pass that ran and found nothing produces, so `MemoryTriggerService`
    // marked the drained observations processed and discarded them. This
    // asserts the DISCRIMINATOR, which is the only part that distinguishes the
    // fixed behaviour from the broken one.
    const adapter = makeAdapter(
      makeLogger(),
      makeInternalQuery({
        text: '{"memories":[{"kind":"fact","content":"the build uses esbuild"}]}',
      }),
    );

    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'stalled',
      reason: 'provider-cooling-down',
      providerId: '',
    });
  });

  it('carries no drafts on the stalled arm — the signal does not invent a result', async () => {
    // The stalled arm has no `drafts` property at all. A stalled pass extracted
    // nothing and the type says so; there is no empty array for a future caller
    // to mistake for a real answer.
    const adapter = makeAdapter(
      makeLogger(),
      makeInternalQuery({
        text: '{"memories":[{"kind":"fact","content":"x"}]}',
      }),
    );

    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(result).not.toHaveProperty('drafts');
  });

  it('a pass that RAN and found nothing reports status "extracted" with an empty list', async () => {
    // The inverse. Same zero drafts, opposite status — this is the pair the
    // pre-fix code collapsed into one value.
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({ text: '{"memories":[]}' }),
      makeWorkspace(''),
    );

    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'extracted',
      drafts: [],
    });
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

  it('returns NO-OUTPUT (does not throw) when model output is empty', async () => {
    // A run that produced no text and called no tool is not an empty
    // extraction: nothing came back to extract FROM. `'extracted'` here told
    // the caller to consume the session's observations for a pass that never
    // reported on them (TASK_2026_376 R1).
    const internalQuery = makeInternalQuery({ text: '' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'no-output',
      usedTools: false,
      toolNames: [],
    });
  });

  it('returns an EXTRACTED status with no drafts when model output is non-JSON garbage', async () => {
    const internalQuery = makeInternalQuery({ text: 'not json at all' });
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      internalQuery,
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'extracted',
      drafts: [],
    });
  });
});

describe('SdkInternalQueryCuratorLlm — the turn budget (TASK_2026_376 F8)', () => {
  it('asks for more than one turn, so a tool_result can reach the model', () => {
    // One turn is one API round-trip (`Options.maxTurns`,
    // @anthropic-ai/claude-agent-sdk sdk.d.ts:1527-1530). A tool call needs a
    // second round-trip to carry its result back, so 1 makes the MCP wiring
    // this adapter attaches unreachable. Two is the floor.
    expect(CURATOR_MAX_TURNS).toBeGreaterThanOrEqual(2);
  });

  it('keeps the budget BOUNDED and below the one-shot default of 25', () => {
    // The bound is not decoration. `perLaneLimit` is 1 on the memory-curator
    // lane and the queue budget is 60s, so turns spent here are turns the next
    // curation window waits before it is dropped (TASK_2026_376 F4).
    expect(Number.isInteger(CURATOR_MAX_TURNS)).toBe(true);
    expect(CURATOR_MAX_TURNS).toBeLessThan(25);
  });

  it('sends CURATOR_MAX_TURNS into the internal query, not a hard-coded 1', async () => {
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
    expect(capture.maxTurns).toBe(CURATOR_MAX_TURNS);
    expect(capture.maxTurns).not.toBe(1);
  });
});

describe('SdkInternalQueryCuratorLlm — tool-only runs are not silent runs', () => {
  const toolsOnly: readonly AssistantBlock[] = [
    { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
  ];

  it('records a tool-only extract pass DISTINCTLY from a pass that produced nothing', async () => {
    // The defect: both reach the caller as `extracted: 0`. The contract cannot
    // carry a third arm from inside this batch, so the log is the seam — and
    // the two must not print the same line.
    const toolLogger = makeLogger();
    await new SdkInternalQueryCuratorLlm(
      toolLogger,
      makeInternalQuery({ blocks: toolsOnly }),
      makeWorkspace(''),
    ).extract(EXTRACT_TRANSCRIPT);

    const silentLogger = makeLogger();
    await new SdkInternalQueryCuratorLlm(
      silentLogger,
      makeInternalQuery({ blocks: [] }),
      makeWorkspace(''),
    ).extract(EXTRACT_TRANSCRIPT);

    const toolLines = [
      ...(toolLogger.info as jest.Mock).mock.calls,
      ...(toolLogger.warn as jest.Mock).mock.calls,
    ];
    const silentLines = [
      ...(silentLogger.info as jest.Mock).mock.calls,
      ...(silentLogger.warn as jest.Mock).mock.calls,
    ];
    expect(toolLines.length).toBeGreaterThan(0);
    expect(silentLines.length).toBeGreaterThan(0);
    expect(toolLines[0][0]).not.toEqual(silentLines[0][0]);
  });

  it('names the tools it used, so the pass can be told apart in a log', async () => {
    const logger = makeLogger();
    await new SdkInternalQueryCuratorLlm(
      logger,
      makeInternalQuery({
        blocks: [
          { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
          { type: 'tool_use', name: 'Read' },
        ],
      }),
      makeWorkspace(''),
    ).extract(EXTRACT_TRANSCRIPT);

    const call = (logger.info as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('through tools'),
    );
    expect(call).toBeDefined();
    expect(call?.[1]).toEqual({
      toolUses: 2,
      toolNames: ['mcp__ptah__ptah_memory_search', 'Read'],
    });
  });

  it('resolves NO-OUTPUT, never an empty extraction, after a tool-only pass', async () => {
    // `{ status: 'extracted', drafts: [] }` is what the caller reads as "this
    // pass ran and found nothing", and it consumes the session's queued
    // observations on that reading. A run that spent its turns in tool calls and
    // never wrote its answer has not earned that (TASK_2026_376 R1).
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({ blocks: toolsOnly }),
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'no-output',
      usedTools: true,
      toolNames: ['mcp__ptah__ptah_memory_search'],
    });
  });

  it('resolves NO-OUTPUT with usedTools false when the run said nothing at all', async () => {
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({ blocks: [] }),
      makeWorkspace(''),
    );
    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'no-output',
      usedTools: false,
      toolNames: [],
    });
  });

  it('parses the JSON normally when a run BOTH called tools and answered', async () => {
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({
        blocks: [
          { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
          {
            type: 'text',
            text: '{"memories":[{"kind":"fact","subject":"ptah","content":"lanes exist","salienceHint":0.5}]}',
          },
        ],
      }),
      makeWorkspace(''),
    );
    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(result.status).toBe('extracted');
    expect(result.status === 'extracted' && result.drafts).toHaveLength(1);
  });

  it('warns when the run stopped at the turn ceiling', async () => {
    // `error_max_turns` is a RESULT in this SDK, never a throw
    // (sdk.d.ts:3402), so an exhausted budget is invisible unless it is read.
    const logger = makeLogger();
    await new SdkInternalQueryCuratorLlm(
      logger,
      makeInternalQuery({
        blocks: toolsOnly,
        resultSubtype: 'error_max_turns',
      }),
      makeWorkspace(''),
    ).extract(EXTRACT_TRANSCRIPT);

    const call = (logger.warn as jest.Mock).mock.calls.find((c) =>
      String(c[0]).includes('turn ceiling'),
    );
    expect(call).toBeDefined();
    expect(call?.[1]).toMatchObject({ maxTurns: CURATOR_MAX_TURNS });
  });

  it('stores drafts unmerged after a tool-only RESOLVE pass', async () => {
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({ blocks: toolsOnly }),
      makeWorkspace(''),
    );
    const drafts = [
      {
        kind: 'fact' as const,
        subject: 'ptah',
        content: 'lanes exist',
        salienceHint: 0.5,
      },
    ];
    await expect(
      adapter.resolve(drafts, [
        { id: 'm1', subject: 'ptah', content: 'older note' },
      ]),
    ).resolves.toEqual([{ ...drafts[0], mergeTargetId: null }]);
  });
});

describe('SdkInternalQueryCuratorLlm — a multi-turn run is read from its LAST message', () => {
  // Both prompts tell the model that its FINAL message must contain only the
  // JSON object. `extractJsonObject` reads from index 0 and takes the FIRST
  // balanced `{...}`, so while the collector concatenated every assistant
  // message the parser read the model's working notes instead of its answer
  // (TASK_2026_376 R1, logic finding 1).
  const REAL_ANSWER =
    '{"memories":[{"kind":"fact","subject":"build","content":"nx run-many is the multi-project runner","salienceHint":0.7}]}';

  it('ignores a DECOY json object in an earlier message and parses the last one', async () => {
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({
        messages: [
          [
            {
              type: 'text',
              text: 'Let me check what is already stored. Draft so far: {"memories": []}',
            },
            { type: 'tool_use', name: 'mcp__ptah__ptah_memory_search' },
          ],
          [{ type: 'text', text: REAL_ANSWER }],
        ],
      }),
      makeWorkspace(''),
    );

    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(result.status).toBe('extracted');
    expect(result.status === 'extracted' && result.drafts).toMatchObject([
      {
        kind: 'fact',
        subject: 'build',
        content: 'nx run-many is the multi-project runner',
        salienceHint: 0.7,
      },
    ]);
  });

  it('does not let an unparseable earlier message destroy a valid answer', async () => {
    // Scenario B from the review: `I will search memory for {subject: X}` slices
    // to `{subject: X}`, `JSON.parse` throws, and the whole pass returned zero
    // drafts while reporting success.
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({
        messages: [
          [
            {
              type: 'text',
              text: 'I will search memory for {subject: X} first.',
            },
          ],
          [{ type: 'text', text: REAL_ANSWER }],
        ],
      }),
      makeWorkspace(''),
    );

    const result = await adapter.extract(EXTRACT_TRANSCRIPT);
    expect(result.status === 'extracted' && result.drafts).toHaveLength(1);
  });

  it('reports NO-OUTPUT when a run that answered earlier ends on tool calls', async () => {
    // The last message carries no text, so there is no answer to read. Deferring
    // costs a re-curation next drain; consuming the input would cost the
    // session's memories permanently.
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({
        messages: [
          [{ type: 'text', text: REAL_ANSWER }],
          [{ type: 'tool_use', name: 'Read' }],
        ],
        resultSubtype: 'error_max_turns',
      }),
      makeWorkspace(''),
    );

    await expect(adapter.extract(EXTRACT_TRANSCRIPT)).resolves.toEqual({
      status: 'no-output',
      usedTools: true,
      toolNames: ['Read'],
    });
  });

  it('reads the LAST message on the resolve path too', async () => {
    const drafts = [
      {
        kind: 'fact' as const,
        subject: 'ptah',
        content: 'lanes exist',
        salienceHint: 0.5,
      },
    ];
    const adapter = new SdkInternalQueryCuratorLlm(
      makeLogger(),
      makeInternalQuery({
        messages: [
          [
            {
              type: 'text',
              text: 'Looking at the related notes: {"memories": []}',
            },
          ],
          [
            {
              type: 'text',
              text: '{"memories":[{"kind":"fact","subject":"ptah","content":"lanes exist","salienceHint":0.5,"mergeTargetId":"m1"}]}',
            },
          ],
        ],
      }),
      makeWorkspace(''),
    );

    await expect(
      adapter.resolve(drafts, [
        { id: 'm1', subject: 'ptah', content: 'older note' },
      ]),
    ).resolves.toMatchObject([{ ...drafts[0], mergeTargetId: 'm1' }]);
  });
});
