/**
 * SessionQueryExecutor — a dead SDK input channel ends the session (TASK_2026_472).
 *
 * On the resumed path `streamInput(userMessageStream)` is the session's only
 * delivery channel: the query is started with an idle iterable that never
 * yields. A rejection there means no message can ever reach the CLI again.
 *
 * That rejection used to be swallowed by a `logger.warn`, so `executeQuery`
 * still returned a query and the RPC layer still reported the session as
 * started. The session then sat inert until the no-activity watchdog aborted it
 * 180 s later — a real failure reported as a timeout, three minutes late.
 *
 * A rejection here is never normal teardown. The SDK's own `streamInput` catch
 * rethrows only NON-abort errors, so an aborted session resolves rather than
 * rejects (`sdk.mjs` 0.3.150). These specs therefore treat any rejection as
 * fatal to the session.
 *
 * No timing is asserted anywhere in this file.
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
  cleanupSpy: jest.Mock;
  logger: Logger;
  /**
   * Whether the session was already stopped at the moment
   * `cleanupPendingPermissions` ran. Sampled inside the spy rather than from an
   * `abort` listener the test attaches afterwards: the rejection is handled in
   * a microtask that can complete before `executeQuery` resolves, and
   * `addEventListener('abort')` on an already-aborted signal never fires.
   */
  abortedAtCleanup: () => boolean | null;
}

/**
 * @param streamInputResult - what the fake SDK query's `streamInput` returns.
 */
function makeHarness(streamInputResult: () => Promise<void>): Harness {
  const logger = makeLogger();
  const registry = new SessionRegistry(logger);
  let controller: AbortController | undefined;
  let abortedAtCleanup: boolean | null = null;

  const messageFactory = {
    createUserMessage: jest.fn().mockResolvedValue({
      type: 'user',
      session_id: 's',
      message: { role: 'user', content: '/context' },
      parent_tool_use_id: null,
    }),
  } as unknown as SdkMessageFactory;

  const streamPump = new SessionStreamPump(logger, registry, messageFactory);

  const cleanupSpy = jest.fn(() => {
    abortedAtCleanup = controller ? controller.signal.aborted : null;
  });
  const permissionHandler = {
    getPermissionLevel: jest.fn().mockReturnValue('yolo'),
    cleanupPendingPermissions: cleanupSpy,
  } as unknown as ISdkPermissionHandler;

  const moduleLoader = {
    getQueryFunction: jest.fn().mockResolvedValue(jest.fn()),
  } as unknown as SdkModuleLoader;

  const queryOptionsBuilder = {
    build: jest
      .fn()
      .mockImplementation(
        async (input: {
          userMessageStream: AsyncIterable<SDKUserMessage>;
          abortController: AbortController;
        }) => {
          // The executor's own controller, captured at the one seam that
          // receives it.
          controller = input.abortController;
          return {
            options: { model: 'test-model', cwd: '/tmp/test' },
            prompt: input.userMessageStream,
          };
        },
      ),
  } as unknown as SdkQueryOptionsBuilder;

  const sdkQuery = {
    streamInput: jest.fn().mockImplementation(streamInputResult),
    interrupt: async () => undefined,
    setPermissionMode: async () => undefined,
    setModel: async () => undefined,
    applyFlagSettings: async () => undefined,
    stopTask: async () => undefined,
    rewindFiles: async () => ({ canRewind: false }),
  } as unknown as Query;

  const queryRunner = {
    invokeWithLoadedQuery: jest.fn().mockReturnValue({ sdkQuery }),
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
    cleanupSpy,
    logger,
    abortedAtCleanup: () => abortedAtCleanup,
  };
}

function resumedConfig(tabId: string): ExecuteQueryConfig {
  return {
    sessionId: tabId as ExecuteQueryConfig['sessionId'],
    resumeSessionId: 'real-session-id',
    sessionConfig: {
      model: 'test-model',
      projectPath: '/tmp/test',
    } as AISessionConfig,
    initialPrompt: { content: '/context', files: [], images: [] },
  };
}

/** Let the rejected `streamInput` promise reach its handler. */
async function settle(): Promise<void> {
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
    await new Promise((resolve) => setImmediate(resolve));
  }
}

describe('SessionQueryExecutor — a dead input channel ends the session (TASK_2026_472)', () => {
  it('a rejected streamInput stops the session instead of reporting it as started', async () => {
    const { executor } = makeHarness(() =>
      Promise.reject(new Error('Cannot write to terminated process')),
    );

    const result = await executor.executeQuery(resumedConfig('tab-dead-input'));
    await settle();

    expect(result.abortController.signal.aborted).toBe(true);
  });

  it('the stop reason surfaces as a real error, not a benign user abort', async () => {
    const { executor } = makeHarness(() =>
      Promise.reject(new Error('Cannot write to terminated process')),
    );

    const result = await executor.executeQuery(resumedConfig('tab-wording'));
    await settle();

    const reason = result.abortController.signal.reason as Error;
    expect(reason).toBeInstanceOf(Error);
    // `StreamTransformer` classifies a reason containing "abort" or "cancel" as
    // a benign user abort and suppresses it at debug level. This one must reach
    // the user.
    const message = reason.message.toLowerCase();
    expect(message).not.toContain('abort');
    expect(message).not.toContain('cancel');
    expect(message).toContain('lost its connection');
  });

  it('the provider error reaches the log but never the stop reason', async () => {
    // A provider message that itself contains "abort" must not be able to
    // silence the failure by being interpolated into the reason.
    const { executor, logger } = makeHarness(() =>
      Promise.reject(new Error('upstream write aborted by transport')),
    );

    const result = await executor.executeQuery(resumedConfig('tab-log-only'));
    await settle();

    const reason = result.abortController.signal.reason as Error;
    expect(reason.message).not.toContain('upstream write aborted');
    expect(result.abortController.signal.aborted).toBe(true);

    const errorCalls = (logger.error as jest.Mock).mock.calls;
    const loggedCause = errorCalls.find(
      (call) =>
        call[1] instanceof Error &&
        call[1].message === 'upstream write aborted by transport',
    );
    expect(loggedCause).toBeDefined();
  });

  it('pending permissions are resolved BEFORE the session is stopped', async () => {
    const { executor, cleanupSpy, abortedAtCleanup } = makeHarness(() =>
      Promise.reject(new Error('Cannot write to terminated process')),
    );

    const result = await executor.executeQuery(resumedConfig('tab-ordering'));
    await settle();

    // An in-flight `can_use_tool` must be resolved before the stream is torn
    // down, or the permission card wedges the UI forever.
    expect(cleanupSpy).toHaveBeenCalledWith('tab-ordering');
    expect(abortedAtCleanup()).toBe(false);
    expect(result.abortController.signal.aborted).toBe(true);
  });

  it('an already-stopped session is left alone', async () => {
    let rejectInput: ((err: Error) => void) | undefined;
    const { executor, cleanupSpy } = makeHarness(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectInput = reject;
        }),
    );

    const result = await executor.executeQuery(resumedConfig('tab-already'));
    // Normal teardown happens first, then the input promise settles.
    result.abortController.abort(new Error('user ended the session'));
    rejectInput?.(new Error('Cannot write to terminated process'));
    await settle();

    // The original reason survives and no second cleanup runs.
    expect((result.abortController.signal.reason as Error).message).toBe(
      'user ended the session',
    );
    expect(cleanupSpy).not.toHaveBeenCalled();
  });

  it('a resolving streamInput leaves the session running', async () => {
    const { executor, cleanupSpy } = makeHarness(() => Promise.resolve());

    const result = await executor.executeQuery(resumedConfig('tab-healthy'));
    await settle();

    expect(result.abortController.signal.aborted).toBe(false);
    expect(cleanupSpy).not.toHaveBeenCalled();
  });
});

/**
 * The non-resumed path has no `streamInput` call at all — the user-message
 * stream IS the query prompt — so there is no rejection to handle there.
 */
describe('SessionQueryExecutor — the initial path has no separate input channel', () => {
  it('does not call streamInput for a new session', async () => {
    const { executor } = makeHarness(() => Promise.reject(new Error('unused')));

    const result = await executor.executeQuery({
      sessionId: 'tab-initial' as ExecuteQueryConfig['sessionId'],
      sessionConfig: {
        model: 'test-model',
        projectPath: '/tmp/test',
      } as AISessionConfig,
      initialPrompt: { content: '/context', files: [], images: [] },
    });
    await settle();

    expect(result.abortController.signal.aborted).toBe(false);
  });
});
