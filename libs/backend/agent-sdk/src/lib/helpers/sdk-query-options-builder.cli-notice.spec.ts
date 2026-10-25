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
import type {
  ClaudeAccountNamedRoute,
  ClaudeCertifiedLaunchContext,
} from '@ptah-extension/auth-providers-tokens';
import {
  CLAUDE_CERTIFIED_ENV_KEYS,
  certifiedEnvDigest,
} from './claude-certified-launch';

const NAMED_ROUTE = {
  kind: 'named',
  provider: 'claude',
  profileId: 'profile-a',
  canonicalConfigDir: '/isolated-account',
  routeFingerprint: 'a'.repeat(64),
  routeRevision: 0,
  authEpoch: 0,
  runId: 'run-a',
} as ClaudeAccountNamedRoute;
const NAMED_ENV: Record<string, string> = {
  [CLAUDE_CERTIFIED_ENV_KEYS[0]]: 'certified-value',
  CLAUDE_CONFIG_DIR: NAMED_ROUTE.canonicalConfigDir,
  CLAUDE_SECURESTORAGE_CONFIG_DIR: NAMED_ROUTE.canonicalConfigDir,
};
const NAMED_LAUNCH: ClaudeCertifiedLaunchContext = {
  executable: {
    command: 'claude-fixture',
    prefixArgs: [],
    sdkExecutablePath: '/certified/claude',
    version: '2.1.310',
    fingerprint: { size: 1, mtimeMs: 1 },
  },
  env: NAMED_ENV,
  envDigest: certifiedEnvDigest(NAMED_ENV),
  cwd: 'D:/tmp/ws',
  settingSources: ['user', 'project', 'local'],
  policy: {
    coverage: 'win32@2.1.310',
    managedFile: 'absent',
    managedDropIn: 'absent',
    registry: 'absent',
    remoteSignals: 'absent',
  },
  accountClass: 'personal',
  identityReference: 'b'.repeat(64),
};

const CLI_NOTICE =
  'claude.ai connectors are disabled because ANTHROPIC_API_KEY or another ' +
  'auth source is set and takes precedence over your claude.ai login';

interface Harness {
  stderr: (data: string) => void;
  events: SessionMcpStatusEvent[];
  trackStderrSession: jest.Mock;
  checkStderrForFailure: jest.Mock;
  /** Every logger call at every level, serialized. */
  allLogCalls: () => string;
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
    /** Build a named-account final run (certified route and launch). */
    named?: boolean;
  } = {},
): Promise<Harness> {
  const error = jest.fn();
  const warn = jest.fn();
  const debug = jest.fn();
  const info = jest.fn();
  const noopHooks = { createHooks: jest.fn().mockReturnValue({}) };
  const events: SessionMcpStatusEvent[] = [];
  const mcpStatus = {
    notifyAll: (event: SessionMcpStatusEvent) => {
      events.push(event);
    },
  } as unknown as SessionMcpStatusCallbackRegistry;
  const trackStderrSession = jest.fn();
  const checkStderrForFailure = jest.fn();
  const mcpBackoff = {
    getBackingOffServers: jest.fn().mockReturnValue([]),
    trackStderrSession,
    checkStderrForFailure,
  };

  const ctor = SdkQueryOptionsBuilder as unknown as new (
    ...args: unknown[]
  ) => SdkQueryOptionsBuilder;

  const builder = new ctor(
    { info, warn, error, debug },
    {
      createCallback: jest.fn().mockReturnValue(() => ({ behavior: 'allow' })),
    },
    noopHooks,
    {
      getConfig: jest
        .fn()
        .mockReturnValue({ enabled: true, contextTokenThreshold: null }),
    },
    noopHooks,
    noopHooks,
    {},
    {
      resolveModelId: jest.fn().mockImplementation((m: string) => m),
      hasCachedModels: jest.fn().mockReturnValue(false),
      getSupportedModels: jest.fn().mockResolvedValue([]),
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
    mcpBackoff,
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
    ...(input.named
      ? { accountRoute: NAMED_ROUTE, accountLaunch: NAMED_LAUNCH }
      : {}),
  });

  const lines = (mock: jest.Mock): string[] =>
    mock.mock.calls.map((call) => String(call[0]));

  return {
    stderr: cfg.options.stderr as (data: string) => void,
    events,
    trackStderrSession,
    checkStderrForFailure,
    allLogCalls: () =>
      JSON.stringify([
        info.mock.calls,
        warn.mock.calls,
        error.mock.calls,
        debug.mock.calls,
      ]),
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
  it('mints a distinct attempt key for each build while preserving the routing id', async () => {
    const first = await makeHarness({ tabId: 'tab-abc' });
    const second = await makeHarness({ tabId: 'tab-abc' });

    const [firstRoutingId, firstAttemptKey] =
      first.trackStderrSession.mock.calls[0];
    const [secondRoutingId, secondAttemptKey] =
      second.trackStderrSession.mock.calls[0];

    expect(firstRoutingId).toBe('tab-abc');
    expect(secondRoutingId).toBe(firstRoutingId);
    expect(secondAttemptKey).not.toBe(firstAttemptKey);
  });

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

describe('SdkQueryOptionsBuilder.build — named account stderr is never echoed', () => {
  const ADVERSARIAL = [
    'C:\\Users\\person\\.claude-account\\.credentials.json',
    'person@example.test',
    'org-0123456789abcdef',
    'sk-ant-oat01-secretsecretsecret',
  ];
  const chunks = [
    `[ERROR] cannot read ${ADVERSARIAL[0]}`,
    `[WARN] logged in as ${ADVERSARIAL[1]} (${ADVERSARIAL[2]})`,
    `[DEBUG] token ${ADVERSARIAL[3]}`,
    `${CLI_NOTICE} ${ADVERSARIAL[1]}`,
    'MCP server "private-server" failed to connect',
  ];

  it('logs only fixed text, publishes no notice and parses nothing', async () => {
    const h = await makeHarness({ tabId: 'tab-abc', named: true });
    // Only what the stderr handler itself writes; build() logs its own setup.
    const warnBefore = h.warnLines().length;
    for (const chunk of chunks) h.stderr(chunk);

    const logged = h.allLogCalls();
    for (const value of [...ADVERSARIAL, 'private-server', CLI_NOTICE]) {
      expect(logged).not.toContain(value);
    }
    expect(h.events).toEqual([]);
    expect(h.checkStderrForFailure).not.toHaveBeenCalled();
    expect(h.warnLines().slice(warnBefore)).toEqual([
      '[SdkQueryOptionsBuilder] Named account child reported an error diagnostic.',
    ]);
    expect(h.errorLines()).toEqual([]);
    expect(h.debugLines().slice(-chunks.length + 1)).toEqual(
      Array(chunks.length - 1).fill(
        '[SdkQueryOptionsBuilder] Named account child diagnostic received.',
      ),
    );
  });

  it('leaves the ambient handler unchanged', async () => {
    const h = await makeHarness({ tabId: 'tab-abc' });
    h.stderr(chunks[0]);
    expect(h.errorLines()).toEqual([
      `[SdkQueryOptionsBuilder] CLI stderr: ${chunks[0]}`,
    ]);
    expect(h.checkStderrForFailure).toHaveBeenCalledTimes(1);
  });
});
