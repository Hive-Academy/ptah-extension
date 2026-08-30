/**
 * persistCliSessionReference — the parentless drop (TASK_2026_295).
 *
 * A CLI agent whose `parentSessionId` is falsy has nowhere to be persisted:
 * `addCliSession` is keyed by the parent session. That was a bare `return`, so
 * the agent simply never appeared under any session and nothing said why — and
 * the retry pass in `sdk-callbacks.ts` cannot recover it either, because it
 * filters on `parentSessionId === realSessionId`, which a blank id never
 * matches. The drop is now named out loud, at both call sites.
 *
 * Source-under-test:
 *   libs/backend/cli-agent-runtime/src/lib/wiring/agent-events.ts
 */

import 'reflect-metadata';

import { EventEmitter } from 'eventemitter3';
import { createMockLogger } from '@ptah-extension/shared/testing';
import type { Logger } from '@ptah-extension/vscode-core';
import { TOKENS } from '@ptah-extension/vscode-core';
import { SDK_TOKENS } from '@ptah-extension/agent-sdk';
import type { AgentId, AgentProcessInfo } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
import {
  persistCliSessionReference,
  wireAgentEventListeners,
} from './agent-events';

const PARENT_SESSION = '11111111-2222-4333-8444-555555555555';

function buildInfo(overrides: Partial<AgentProcessInfo>): AgentProcessInfo {
  return {
    agentId: 'agent-42',
    cli: 'ptah-cli',
    task: 'do work',
    workingDirectory: '/repo',
    status: 'exited',
    startedAt: new Date(0).toISOString(),
    ...overrides,
  } as AgentProcessInfo;
}

function buildContainer(
  entries: Array<[symbol, unknown]>,
): DependencyContainer {
  const registry = new Map<symbol, unknown>(entries);
  return {
    isRegistered: (token: symbol) => registry.has(token),
    resolve: (token: symbol) => registry.get(token),
  } as unknown as DependencyContainer;
}

describe('persistCliSessionReference — missing parent session', () => {
  it('warns and names the agent instead of dropping it silently', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession, markChildSession: jest.fn() },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({ parentSessionId: undefined }),
      undefined,
    );

    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('agent-42'),
      expect.anything(),
    );
  });

  it('treats an empty-string parent the same as an absent one', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession, markChildSession: jest.fn() },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({ parentSessionId: '' }),
      undefined,
    );

    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no parent session id'),
      expect.anything(),
    );
  });

  it('still persists normally when a parent session is present', () => {
    const logger = createMockLogger();
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
      }),
      undefined,
    );

    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ cliSessionId: 'cli-sess-1' }),
    );
  });
});

/**
 * TASK_2026_323 blocker B5 — the persisted reference must stay small.
 *
 * `persistCliSessionReference` runs on EVERY spawn and EVERY exit, and each
 * reference lands inside the single all-sessions metadata blob. Copying an
 * agent's accumulated stream events (up to 50 000) into it made the cost of a
 * burst quadratic in the number of agents.
 */
describe('persistCliSessionReference — bulk output stays out of the blob', () => {
  const AGENT_ID = 'agent-42' as AgentId;

  function buildOutput(): {
    stdout: string;
    segments: Array<{ type: string; content: string }>;
    streamEvents: Array<{ id: string; eventType: string }>;
  } {
    return {
      stdout: 'tail of stdout',
      segments: Array.from({ length: 3 }, (_unused, i) => ({
        type: 'text',
        content: `segment-${i}`,
      })),
      streamEvents: Array.from({ length: 25 }, (_unused, i) => ({
        id: `evt-${i}`,
        eventType: 'text_delta',
      })),
    };
  }

  function harness(readOutput: jest.Mock): {
    container: DependencyContainer;
    addCliSession: jest.Mock;
    saveAgentOutput: jest.Mock;
    readOutput: jest.Mock;
  } {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const saveAgentOutput = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput }],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          saveAgentOutput,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);
    return { container, addCliSession, saveAgentOutput, readOutput };
  }

  it('does not read accumulated output at all for a running agent', () => {
    const readOutput = jest.fn().mockReturnValue(buildOutput());
    const { container, addCliSession, saveAgentOutput } = harness(readOutput);

    persistCliSessionReference(
      container,
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        agentId: AGENT_ID,
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        status: 'running',
      }),
      undefined,
    );

    // A just-spawned agent has produced nothing — this was half the cost.
    expect(readOutput).not.toHaveBeenCalled();
    expect(saveAgentOutput).not.toHaveBeenCalled();
    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ cliSessionId: 'cli-sess-1' }),
    );
  });

  it('omits streamEvents from the reference and stores them per agent on exit', async () => {
    const readOutput = jest.fn().mockReturnValue(buildOutput());
    const { container, addCliSession, saveAgentOutput } = harness(readOutput);

    persistCliSessionReference(
      container,
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        agentId: AGENT_ID,
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        status: 'completed',
      }),
      undefined,
    );

    // The reference write now WAITS for the bulk write (TASK_2026_324
    // finding 2), so it lands a microtask later rather than synchronously.
    await Promise.resolve();

    const ref = addCliSession.mock.calls[0][1];
    expect(ref.streamEvents).toBeUndefined();
    expect(ref.segments).toHaveLength(3);
    expect(ref.stdout).toBe('tail of stdout');

    expect(saveAgentOutput).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        streamEvents: expect.arrayContaining([
          expect.objectContaining({ id: 'evt-0' }),
        ]),
      }),
    );
    expect(saveAgentOutput.mock.calls[0][1].streamEvents).toHaveLength(25);
  });

  it('still persists the reference when the store predates saveAgentOutput', () => {
    const readOutput = jest.fn().mockReturnValue(buildOutput());
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput }],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    persistCliSessionReference(
      container,
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        agentId: AGENT_ID,
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        status: 'completed',
      }),
      undefined,
    );

    expect(addCliSession).toHaveBeenCalledTimes(1);
  });
});

/**
 * TASK_2026_324 finding 2 — the two writes are sequenced, and share one retry.
 *
 * `ref.agentId` is the ONLY route to `ptah.agentOutput:<agentId>`: the restore
 * path reads the key the reference names and nothing enumerates the rest. The
 * bulk write used to be fired off unretried while the reference got three
 * attempts, so one transient storage failure on the bulk left a durable
 * reference pointing at a key that was never written — the agent's execution
 * tree gone, with a `warn` as the only trace.
 */
describe('persistCliSessionReference — bulk write gates the reference', () => {
  const AGENT_ID = 'agent-42' as AgentId;

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('does not write the reference until the bulk write succeeds', async () => {
    const readOutput = jest.fn().mockReturnValue({
      stdout: 'tail',
      segments: [{ type: 'text', content: 'segment-0' }],
      streamEvents: [{ id: 'evt-0', eventType: 'text_delta' }],
    });
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const saveAgentOutput = jest
      .fn()
      .mockRejectedValueOnce(new Error('storage busy'))
      .mockResolvedValue(undefined);
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput }],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          saveAgentOutput,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    persistCliSessionReference(
      container,
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        agentId: AGENT_ID,
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        status: 'completed',
      }),
      undefined,
    );

    // First attempt: the bulk rejected, so the reference must not exist yet.
    await jest.advanceTimersByTimeAsync(0);
    expect(saveAgentOutput).toHaveBeenCalledTimes(1);
    expect(addCliSession).not.toHaveBeenCalled();

    // The retry covers BOTH writes — the bulk is a whole-record overwrite, so
    // re-running it is idempotent.
    await jest.advanceTimersByTimeAsync(5_000);
    expect(saveAgentOutput).toHaveBeenCalledTimes(2);
    expect(addCliSession).toHaveBeenCalledTimes(1);
    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ cliSessionId: 'cli-sess-1' }),
    );
  });

  it('never writes the reference when the bulk write keeps failing', async () => {
    const readOutput = jest.fn().mockReturnValue({
      stdout: 'tail',
      segments: [{ type: 'text', content: 'segment-0' }],
      streamEvents: [{ id: 'evt-0', eventType: 'text_delta' }],
    });
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const saveAgentOutput = jest
      .fn()
      .mockRejectedValue(new Error('storage busy'));
    const logger = createMockLogger();
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput }],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          saveAgentOutput,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);

    persistCliSessionReference(
      container,
      logger as unknown as Logger,
      '[test]',
      buildInfo({
        agentId: AGENT_ID,
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        status: 'completed',
      }),
      undefined,
    );

    await jest.advanceTimersByTimeAsync(60_000);

    expect(saveAgentOutput).toHaveBeenCalledTimes(4); // 1 + 3 retries
    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});

describe('wireAgentEventListeners — the drop reaches the log', () => {
  it('warns when an exited agent has no parent session', () => {
    const logger = createMockLogger();
    const events = new EventEmitter();
    const agentProcessManager = {
      events,
      readOutputForPersistence: jest.fn().mockReturnValue(undefined),
    };
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, agentProcessManager],
      [
        TOKENS.WEBVIEW_MANAGER,
        { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      ],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        { addCliSession: jest.fn(), markChildSession: jest.fn() },
      ],
    ]);

    wireAgentEventListeners(container, {
      logger: logger as unknown as Logger,
      platform: 'electron',
      options: { persistCliSession: true },
    });

    events.emit('agent:exited', buildInfo({ parentSessionId: undefined }));

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no parent session id'),
      expect.anything(),
    );
  });
});
