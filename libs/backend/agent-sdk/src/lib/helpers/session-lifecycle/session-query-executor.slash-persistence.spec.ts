/**
 * SessionQueryExecutor — slash-command input persistence (TASK_2026_472).
 *
 * The defect: a slash command was handed to `query()` as a finite raw string.
 * The SDK derives `isSingleUserTurn` from `typeof prompt === 'string'` and calls
 * `transport.endInput()` on the first `result`, so Claude Code checkpointed the
 * session and aborted every background subagent with reason `background` — which
 * renders as the literal user-denial string although no permission gate ran.
 *
 * The fake SDK below is the mechanism under test, not a stub of the code we
 * wrote. It implements the two installed-SDK rules this task turns on, both read
 * from `node_modules/@anthropic-ai/claude-agent-sdk/sdk.mjs` (0.3.150):
 *
 *   1. `isSingleUserTurn = typeof prompt === 'string'`;
 *   2. on the first `result`, a single-turn query ends its transport input, and
 *      every later write — including one made through `streamInput()` — is
 *      dropped.
 *
 * It also reproduces the live finding from
 * `.ptah/specs/TASK_2026_472_a7e2/experiment-slash-over-streaminput.md`: a
 * command delivered as an `SDKUserMessage` still executes as a command, with
 * `num_turns === 0`.
 *
 * The assertions are on message counts and turn counts only. Nothing here
 * asserts timing, and `streamInput()` resolving is deliberately never treated as
 * proof of liveness — the control case in that experiment resolved after the
 * query had already ended. The proof is a SECOND result in the same session.
 */

import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  AuthEnv,
  ISdkPermissionHandler,
} from '@ptah-extension/shared';

import { SessionQueryExecutor } from './session-query-executor.service';
import { SessionRegistry } from './session-registry.service';
import { SessionStreamPump } from './session-stream-pump.service';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SdkQueryRunner } from '../sdk-query-runner.service';
import type {
  ExecuteQueryConfig,
  Query,
  SDKUserMessage,
} from '../session-lifecycle-manager';

// ---------------------------------------------------------------------------
// The fake SDK
// ---------------------------------------------------------------------------

interface FakeResult {
  /** 0 for a command handled by the CLI, 1 for a model turn. */
  num_turns: number;
  text: string;
}

interface FakeSdk {
  query: Query;
  results: FakeResult[];
  /** Resolves once the fake has stopped accepting and emitting. */
  settled: () => Promise<void>;
}

function textOf(message: SDKUserMessage): string {
  const content = message.message.content;
  return typeof content === 'string' ? content : '<blocks>';
}

/**
 * @param onResult - stands in for `StreamTransformer`'s `onTurnEnd`, which fires
 *   from the `result` branch and reaches `SessionRegistry.markTurnEnded`. The
 *   pump refuses to yield a second message until it does, so leaving it out
 *   would make this fake deadlock for a reason the production code does not
 *   have.
 */
function createFakeSdk(
  prompt: string | AsyncIterable<SDKUserMessage>,
  onResult: () => void,
): FakeSdk {
  const results: FakeResult[] = [];
  const inFlight: Promise<void>[] = [];
  // SDK rule 1.
  const isSingleUserTurn = typeof prompt === 'string';
  let inputClosed = false;

  const deliver = (text: string): void => {
    if (inputClosed) return;
    results.push({ num_turns: text.startsWith('/') ? 0 : 1, text });
    onResult();
    // SDK rule 2.
    if (isSingleUserTurn) inputClosed = true;
  };

  const drain = async (
    iterable: AsyncIterable<SDKUserMessage>,
  ): Promise<void> => {
    for await (const message of iterable) {
      if (inputClosed) return;
      deliver(textOf(message));
    }
  };

  if (typeof prompt === 'string') {
    deliver(prompt);
  } else {
    inFlight.push(drain(prompt));
  }

  const query = {
    streamInput: (iterable: AsyncIterable<SDKUserMessage>): Promise<void> => {
      const task = drain(iterable);
      inFlight.push(task);
      return task;
    },
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    applyFlagSettings: async () => undefined,
    stopTask: async () => undefined,
    rewindFiles: async () => ({ canRewind: false }),
  } as unknown as Query;

  return {
    query,
    results,
    settled: async () => {
      await Promise.all(inFlight);
    },
  };
}

// ---------------------------------------------------------------------------
// Harness
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
}

interface Harness {
  executor: SessionQueryExecutor;
  registry: SessionRegistry;
  streamPump: SessionStreamPump;
  /** Populated by the query runner on the single `query()` call. */
  sdk: () => FakeSdk;
  /** The exact prompt argument the runner handed to `query()`. */
  promptSeen: () => string | AsyncIterable<SDKUserMessage>;
}

function makeHarness(): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);

  const messageFactory = {
    createUserMessage: jest
      .fn()
      .mockImplementation(async (params: { content: string }) => ({
        type: 'user',
        session_id: 's',
        message: { role: 'user', content: params.content },
        parent_tool_use_id: null,
      })),
  } as unknown as SdkMessageFactory;

  const streamPump = new SessionStreamPump(logger, registry, messageFactory);

  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('yolo'),
    cleanupPendingPermissions: jest.fn(),
  } as unknown as ISdkPermissionHandler;

  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(jest.fn()),
  } as unknown as SdkModuleLoader;

  // Mirrors the real builder: `prompt` IS the caller's user-message stream
  // (sdk-query-options-builder.ts:884).
  const queryOptionsBuilder = {
    build: jest
      .fn()
      .mockImplementation(
        async (input: { userMessageStream: AsyncIterable<SDKUserMessage> }) => ({
          options: { model: 'test-model', cwd: '/tmp/test' },
          prompt: input.userMessageStream,
        }),
      ),
  } as unknown as SdkQueryOptionsBuilder;

  let sdk: FakeSdk | undefined;
  let promptSeen: string | AsyncIterable<SDKUserMessage> | undefined;
  const queryRunner = {
    invokeWithLoadedQuery: jest
      .fn()
      .mockImplementation(
        (_queryFn: unknown, prompt: string | AsyncIterable<SDKUserMessage>) => {
          promptSeen = prompt;
          // Exactly one session lives in this harness, so its key is the only
          // entry the registry holds.
          sdk = createFakeSdk(prompt, () => {
            const key = registry.entries().next().value?.[0];
            if (key) registry.markTurnEnded(key);
          });
          return { sdkQuery: sdk.query };
        },
      ),
  } as unknown as SdkQueryRunner;

  const executor = new SessionQueryExecutor(
    logger,
    registry,
    streamPump,
    permissionHandler,
    moduleLoader,
    queryOptionsBuilder,
    messageFactory,
    {} as AuthEnv,
    queryRunner,
  );

  return {
    executor,
    registry,
    streamPump,
    sdk: () => {
      if (!sdk) throw new Error('query() was never invoked');
      return sdk;
    },
    promptSeen: () => {
      if (promptSeen === undefined) {
        throw new Error('query() was never invoked');
      }
      return promptSeen;
    },
  };
}

function makeConfig(
  sessionId: string,
  overrides: Partial<ExecuteQueryConfig> = {},
): ExecuteQueryConfig {
  return {
    sessionId: sessionId as ExecuteQueryConfig['sessionId'],
    sessionConfig: {
      model: 'test-model',
      projectPath: '/tmp/test',
    } as AISessionConfig,
    ...overrides,
  };
}

/** Let the pump's iterator and the fake's drain loop run to quiescence. */
async function settle(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

// ---------------------------------------------------------------------------
// Specs
// ---------------------------------------------------------------------------

describe('SessionQueryExecutor — a slash-command session keeps its input open (TASK_2026_472)', () => {
  it('a resumed slash command executes as a command and the session accepts a second turn', async () => {
    const { executor, streamPump, sdk } = makeHarness();

    const result = await executor.executeQuery(
      makeConfig('tab-slash-resume', {
        resumeSessionId: 'real-session-id',
        initialPrompt: { content: '/context', files: [], images: [] },
      }),
    );
    await settle();

    // The command executed as a command, not as a model prompt.
    expect(sdk().results).toEqual([{ num_turns: 0, text: '/context' }]);

    // The turn a background subagent would have been killed during.
    await streamPump.sendMessage(
      'tab-slash-resume' as ExecuteQueryConfig['sessionId'],
      'follow-up after the command',
    );
    await settle();

    expect(sdk().results).toEqual([
      { num_turns: 0, text: '/context' },
      { num_turns: 1, text: 'follow-up after the command' },
    ]);

    // The moved end of the watchdog accounting. `task.md` names this hazard
    // directly: a persistent slash session must hold the watchdog after its
    // last turn, or 180s of healthy idle time aborts it. Before the fix the
    // slash string never reached the pump, `turnInFlight` stayed false, and
    // `markTurnEnded` skipped the re-hold. Asserting the hold — not a timer —
    // keeps this free of any timing assumption.
    expect(result.activityWatchdog.isHeld).toBe(true);

    result.abortController.abort();
    await sdk().settled();
  });

  it('an initial slash command executes as a command and the session accepts a second turn', async () => {
    const { executor, streamPump, sdk } = makeHarness();

    const result = await executor.executeQuery(
      makeConfig('tab-slash-start', {
        initialPrompt: { content: '/context', files: [], images: [] },
      }),
    );
    await settle();

    expect(sdk().results).toEqual([{ num_turns: 0, text: '/context' }]);

    await streamPump.sendMessage(
      'tab-slash-start' as ExecuteQueryConfig['sessionId'],
      'follow-up after the command',
    );
    await settle();

    expect(sdk().results).toHaveLength(2);
    expect(sdk().results[1]).toEqual({
      num_turns: 1,
      text: 'follow-up after the command',
    });

    result.abortController.abort();
    await sdk().settled();
  });

  it('the SDK is never handed a raw string prompt, whatever the prompt says', async () => {
    const { executor, sdk, promptSeen } = makeHarness();

    const result = await executor.executeQuery(
      makeConfig('tab-slash-shape', {
        resumeSessionId: 'real-session-id',
        initialPrompt: { content: '/compact', files: [], images: [] },
      }),
    );
    await settle();

    // A raw string is what sets `isSingleUserTurn`. Asserting the prompt SHAPE
    // pins the cause; the two specs above pin the consequence.
    expect(typeof promptSeen()).not.toBe('string');

    result.abortController.abort();
    await sdk().settled();
  });
});
