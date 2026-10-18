import 'reflect-metadata';

import type { Logger } from '@ptah-extension/vscode-core';
import type {
  AISessionConfig,
  AuthEnv,
  ISdkPermissionHandler,
} from '@ptah-extension/shared';
import type { SDKMessage } from '../../types/sdk-types/claude-sdk.types';
import type { IdleCompactionSignals } from '../compaction/idle/idle-compaction.types';
import type { IContextUsagePort } from '../compaction/context-usage.port';
import type { SdkModuleLoader } from '../sdk-module-loader';
import type { SdkQueryOptionsBuilder } from '../sdk-query-options-builder';
import type { SdkMessageFactory } from '../sdk-message-factory';
import type { SdkQueryRunner } from '../sdk-query-runner.service';
import type { ExecuteQueryConfig, Query } from '../session-lifecycle-manager';
import { SessionRegistry } from './session-registry.service';
import { SessionStreamPump } from './session-stream-pump.service';
import { SessionQueryExecutor } from './session-query-executor.service';

const message = (frame: Record<string, unknown>): SDKMessage =>
  frame as unknown as SDKMessage;

function signals(): jest.Mocked<IdleCompactionSignals> {
  return {
    sessionBound: jest.fn(),
    requestStarted: jest.fn(),
    turnEnded: jest.fn(),
    turnContext: jest.fn(),
    input: jest.fn(),
    promptPrefixChanged: jest.fn(),
    rateLimit: jest.fn(),
    compactBoundary: jest.fn(),
    sessionReleased: jest.fn(),
    rekey: jest.fn(),
  };
}

function harness(port: IContextUsagePort | null = null) {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  } as unknown as Logger;
  const registry = new SessionRegistry(logger);
  const idle = signals();
  const sdkQuery = {
    [Symbol.asyncIterator]: async function* () {
      yield* [];
    },
    streamInput: async () => undefined,
  } as unknown as Query;
  const executor = new SessionQueryExecutor(
    logger,
    registry,
    new SessionStreamPump(logger, registry, {} as SdkMessageFactory),
    { getPermissionLevel: () => 'ask' } as unknown as ISdkPermissionHandler,
    {
      getQueryFunction: jest.fn().mockResolvedValue(jest.fn()),
    } as unknown as SdkModuleLoader,
    {
      build: jest.fn().mockResolvedValue({
        options: { model: 'test-model', cwd: '/tmp/test' },
        prompt: {
          [Symbol.asyncIterator]: async function* () {
            yield* [];
          },
        },
      }),
    } as unknown as SdkQueryOptionsBuilder,
    {} as SdkMessageFactory,
    {} as AuthEnv,
    {
      invokeWithLoadedQuery: jest.fn().mockReturnValue({ sdkQuery }),
    } as unknown as SdkQueryRunner,
    null,
    null,
    null,
    port,
    null,
    idle,
  );
  const config: ExecuteQueryConfig = {
    sessionId: 'tab' as ExecuteQueryConfig['sessionId'],
    sessionConfig: {
      model: 'test-model',
      projectPath: '/tmp/test',
    } as AISessionConfig,
  };
  return { executor, config, idle, logger };
}

const init = (id = 'sdk') =>
  message({ type: 'system', subtype: 'init', session_id: id });
const boundary = (id = 'sdk') =>
  message({
    type: 'system',
    subtype: 'compact_boundary',
    session_id: id,
    compact_metadata: {
      trigger: 'auto',
      pre_tokens: 210_000,
      post_tokens: 25_000,
    },
  });
const result = (id = 'sdk') =>
  message({ type: 'result', subtype: 'success', session_id: id });
const assistant = (id: string, sessionId = 'sdk') =>
  message({
    type: 'assistant',
    session_id: sessionId,
    parent_tool_use_id: null,
    message: {
      id,
      usage: {
        input_tokens: 10,
        output_tokens: 2,
        cache_read_input_tokens: 0,
        cache_creation_input_tokens: 20,
        cache_creation: {
          ephemeral_1h_input_tokens: 20,
          ephemeral_5m_input_tokens: 0,
        },
      },
    },
  });

describe('SessionQueryExecutor idle signal producers', () => {
  it('binds once, tracks main requests and usage, and ignores same-id init and user echoes', async () => {
    const h = harness();
    const run = await h.executor.executeQuery(h.config);
    run.onMessage(init());
    const [[sessionId, runToken, codexProxy]] = h.idle.sessionBound.mock.calls;
    expect([sessionId, codexProxy]).toEqual(['sdk', false]);
    expect(runToken).toBeTruthy();

    run.onMessage(
      message({
        type: 'stream_event',
        session_id: 'sdk',
        parent_tool_use_id: null,
        event: { type: 'message_start', message: { id: 'request-1' } },
      }),
    );
    run.onMessage(assistant('request-1'));
    run.onMessage(
      message({
        type: 'assistant',
        session_id: 'sdk',
        parent_tool_use_id: 'subagent-tool',
        message: { id: 'sub-request' },
      }),
    );
    expect(h.idle.requestStarted).toHaveBeenCalledTimes(1);

    run.onMessage(boundary());
    expect(h.idle.compactBoundary).toHaveBeenCalledWith('sdk', 210_000);
    run.onMessage(init());
    run.onMessage(
      message({
        type: 'user',
        session_id: 'sdk',
        message: { content: 'echo 1' },
      }),
    );
    run.onMessage(
      message({
        type: 'user',
        session_id: 'sdk',
        message: { content: 'echo 2' },
      }),
    );
    expect(h.idle.sessionBound).toHaveBeenCalledTimes(1);
    expect(h.idle.requestStarted).toHaveBeenCalledTimes(1);
    expect(h.idle.input).not.toHaveBeenCalled();

    run.onMessage(result());
    expect(h.idle.turnEnded).toHaveBeenCalledWith(
      'sdk',
      `${runToken}:1`,
      expect.objectContaining({ requestKey: 'request-1', ttl: '1h' }),
    );
    run.onMessage(result());
    expect(h.idle.turnEnded).toHaveBeenLastCalledWith(
      'sdk',
      `${runToken}:2`,
      null,
    );
    run.onStreamEnd();
    expect(h.idle.sessionReleased).toHaveBeenCalledWith('sdk');
    expect(h.idle.sessionReleased).toHaveBeenCalledTimes(1);
  });

  it('forwards rate limits and null context when the read has no value', async () => {
    const port = {
      readAtTurnEnd: jest.fn().mockResolvedValue(undefined),
      getLast: jest.fn(),
      release: jest.fn(),
      rekey: jest.fn(),
    } satisfies IContextUsagePort;
    const h = harness(port);
    const run = await h.executor.executeQuery(h.config);
    run.onMessage(init());
    run.onMessage(
      message({
        type: 'rate_limit_event',
        session_id: 'sdk',
        rate_limit_info: { status: 'allowed_warning' },
      }),
    );
    run.onMessage(
      message({
        type: 'rate_limit_event',
        session_id: 'sdk',
        rate_limit_info: { status: 'unknown' },
      }),
    );
    run.onMessage(result());
    await new Promise((resolve) => setImmediate(resolve));
    const turnId = h.idle.turnEnded.mock.calls[0][1];
    expect(h.idle.rateLimit).toHaveBeenCalledWith('sdk', 'allowed_warning');
    expect(h.idle.rateLimit).toHaveBeenCalledTimes(1);
    expect(port.readAtTurnEnd).toHaveBeenCalledWith(
      'sdk',
      turnId,
      expect.anything(),
    );
    expect(h.idle.turnContext).toHaveBeenCalledWith('sdk', turnId, null);
    run.onStreamEnd();
  });

  it('uses the current session id for a successful context read and releases every bound id', async () => {
    const port = {
      readAtTurnEnd: jest.fn().mockResolvedValue({
        totalTokens: 123_000,
        maxTokens: 200_000,
        source: 'sdk-getContextUsage' as const,
      }),
      getLast: jest.fn(),
      release: jest.fn(),
      rekey: jest.fn(),
    } satisfies IContextUsagePort;
    const h = harness(port);
    const run = await h.executor.executeQuery(h.config);
    run.onMessage(init());
    run.onMessage(result());
    run.onMessage(init('sdk-new'));
    await new Promise((resolve) => setImmediate(resolve));
    expect(h.idle.turnContext).toHaveBeenCalledWith(
      'sdk-new',
      expect.any(String),
      123_000,
    );
    run.onStreamEnd();
    expect(h.idle.sessionReleased.mock.calls.map(([id]) => id).sort()).toEqual([
      'sdk',
      'sdk-new',
    ]);
  });

  it('keeps the stream going when an idle consumer throws', async () => {
    const h = harness();
    h.idle.sessionBound.mockImplementation(() => {
      throw new Error('failure');
    });
    h.idle.compactBoundary.mockImplementation(() => {
      throw new Error('failure');
    });
    const run = await h.executor.executeQuery(h.config);
    expect(() => {
      run.onMessage(init());
      run.onMessage(boundary());
      run.onMessage(result());
      run.onStreamEnd();
    }).not.toThrow();
    expect(h.idle.turnEnded).toHaveBeenCalledTimes(1);
    expect(h.logger.warn).toHaveBeenCalled();
  });
});
