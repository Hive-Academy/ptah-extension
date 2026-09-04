/**
 * `Options.stderr` publishes the claude.ai connectors notice (TASK_2026_375 B4.2).
 *
 * The CLI writes one line to stderr at session start when a third-party auth
 * source takes precedence over the user's claude.ai login. That line is the
 * whole reason their Gmail / Calendar / Drive / Canva connectors never load,
 * and Ptah logged it at debug level and showed nothing (`context.md` F4).
 *
 * These specs drive the real `stderr` callback `build()` produces, rather than
 * a private helper, because the defect was never in the matcher — it was that
 * nothing downstream of the log site existed.
 *
 * The stderr handler must stay observability-only in every other respect: it
 * aborts nothing, and stuck-session detection remains the no-activity
 * watchdog's job.
 */

import 'reflect-metadata';

import { SdkQueryOptionsBuilder } from './sdk-query-options-builder';
import {
  classifyCliNotice,
  type SessionMcpStatusCallbackRegistry,
  type SessionMcpStatusEvent,
} from './session-mcp-status-callback-registry';
import type { AISessionConfig } from '@ptah-extension/shared';

const CLI_NOTICE =
  'claude.ai connectors are disabled because ANTHROPIC_API_KEY or another ' +
  'auth source is set and takes precedence over your claude.ai login';

interface Harness {
  stderr: (data: string) => void;
  events: SessionMcpStatusEvent[];
  /** Read AFTER the stderr calls — these are getters, not snapshots. */
  errorLines: () => string[];
  warnLines: () => string[];
  debugLines: () => string[];
}

async function makeHarness(
  input: {
    tabId?: string;
    sessionId?: string;
    sessionIdResolver?: () => string | undefined;
  } = {},
): Promise<Harness> {
  const error = jest.fn();
  const warn = jest.fn();
  const debug = jest.fn();
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const events: SessionMcpStatusEvent[] = [];
  const mcpStatus = {
    notifyAll: (event: SessionMcpStatusEvent) => {
      events.push(event);
    },
  } as unknown as SessionMcpStatusCallbackRegistry;

  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;

  const builder = new ctor(
    { info: jest.fn(), warn, error, debug },
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
    {},
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
    // `codeSymbolPromptInjector` — optional, and the registry follows it. That
    // ordering is load-bearing: see the constructor's own comment.
    undefined,
    mcpStatus,
  );

  const userMessageStream = (async function* () {
    // Intentionally empty — build() attaches the stream, it does not iterate.
  })();

  const cfg = await builder.build({
    userMessageStream,
    abortController: new AbortController(),
    sessionConfig: {
      model: 'claude-sonnet-4-5',
      projectPath: 'D:/tmp/ws',
      tabId: input.tabId ?? 'tab-fixture',
    } as AISessionConfig,
    sessionId: input.sessionId,
    sessionIdResolver: input.sessionIdResolver,
  });

  const lines = (mock: jest.Mock): string[] =>
    mock.mock.calls.map((call) => String(call[0]));

  return {
    stderr: cfg.options.stderr as (data: string) => void,
    events,
    errorLines: () => lines(error),
    warnLines: () => lines(warn),
    debugLines: () => lines(debug),
  };
}

describe('classifyCliNotice', () => {
  it('recognizes the connectors notice', () => {
    expect(classifyCliNotice(CLI_NOTICE)).toEqual({
      code: 'claude-ai-connectors-disabled',
      message: CLI_NOTICE,
    });
  });

  it('matches case-insensitively — the CLI owns the wording', () => {
    expect(
      classifyCliNotice('Claude.ai Connectors Are Disabled for this run'),
    ).toEqual({
      code: 'claude-ai-connectors-disabled',
      message: 'Claude.ai Connectors Are Disabled for this run',
    });
  });

  it('trims the chunk but keeps the CLI sentence verbatim', () => {
    const parsed = classifyCliNotice(`\n  ${CLI_NOTICE}  \n`);
    expect(parsed?.message).toBe(CLI_NOTICE);
  });

  it.each([
    ['an ordinary debug line', '[DEBUG] spawning cli'],
    ['an unrelated error', '[ERROR] ENOENT: no such file'],
    ['an empty chunk', ''],
  ])('returns null for %s', (_label, chunk) => {
    expect(classifyCliNotice(chunk)).toBeNull();
  });
});

describe('SdkQueryOptionsBuilder.build — stderr publishes the CLI notice', () => {
  it('publishes the notice under the routing id when no SDK UUID exists yet', async () => {
    const h = await makeHarness({ tabId: 'tab-abc' });
    h.stderr(CLI_NOTICE);

    expect(h.events).toEqual([
      {
        kind: 'notice',
        sessionId: 'tab-abc',
        notice: {
          code: 'claude-ai-connectors-disabled',
          message: CLI_NOTICE,
        },
      },
    ]);
  });

  it('prefers the resolved SDK UUID over the routing id', async () => {
    const h = await makeHarness({
      tabId: 'tab-abc',
      sessionIdResolver: () => 'real-uuid',
    });
    h.stderr(CLI_NOTICE);

    expect(h.events[0]).toMatchObject({ sessionId: 'real-uuid' });
  });

  it('falls back to the routing id when the resolver answers undefined', async () => {
    const h = await makeHarness({
      tabId: 'tab-abc',
      sessionIdResolver: () => undefined,
    });
    h.stderr(CLI_NOTICE);

    expect(h.events[0]).toMatchObject({ sessionId: 'tab-abc' });
  });

  it('publishes nothing for an ordinary stderr chunk', async () => {
    const h = await makeHarness();
    h.stderr('[DEBUG] connecting to mcp server');
    h.stderr('[ERROR] ENOENT: no such file');

    expect(h.events).toEqual([]);
  });

  it('still logs every chunk at its existing level — the notice adds a channel, it does not replace one', async () => {
    const h = await makeHarness();
    h.stderr(CLI_NOTICE);
    h.stderr('[ERROR] boom');
    h.stderr('[WARN] hmm');

    expect(h.errorLines().some((l) => l.includes('[ERROR] boom'))).toBe(true);
    expect(h.warnLines().some((l) => l.includes('[WARN] hmm'))).toBe(true);
    expect(h.debugLines().some((l) => l.includes(CLI_NOTICE))).toBe(true);
  });

  it('publishes once per stderr chunk, so a repeated line is a repeated event', async () => {
    const h = await makeHarness();
    h.stderr(CLI_NOTICE);
    h.stderr(CLI_NOTICE);

    // Deduplication belongs to the consumer, which keeps one record per
    // session and folds notices by code — not to the SDK's transport path.
    expect(h.events).toHaveLength(2);
  });
});
