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
import { CLI_AGENT_RUNTIME_TOKENS } from '../di/tokens';
import { CopilotPermissionBridge } from '../cli-agents/cli-adapters/copilot-permission-bridge';
import { PLATFORM_TOKENS } from '@ptah-extension/platform-core';
import type {
  AgentId,
  AgentDeliveryReceipt,
  AgentProcessInfo,
  CliSessionReference,
} from '@ptah-extension/shared';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type { DependencyContainer } from 'tsyringe';
import type { ParentDeliveryEnvelope } from '../cli-agents/parent-delivery/parent-envelope-store.service';
import {
  persistCliSessionReference,
  wireAgentEventListeners,
} from './agent-events';

const PARENT_SESSION = '11111111-2222-4333-8444-555555555555';

describe('Copilot lane host attention resolution', () => {
  it.each(['response', 'cleanup'] as const)('resolves %s once with the request timestamp', async (settlement) => {
    const bridge = new CopilotPermissionBridge();
    bridge.setAutoApprove(false);
    const hostAttention = { resolve: jest.fn() };
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    wireAgentEventListeners(buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { events: new EventEmitter(), findAgentInfo: () => undefined }],
      [TOKENS.WEBVIEW_MANAGER, { broadcastMessage }],
      [TOKENS.CLI_DETECTION_SERVICE, { getAdapter: () => ({ permissionBridge: bridge }) }],
      [SDK_TOKENS.HOST_ATTENTION_COORDINATOR, hostAttention],
    ]), {
      logger: Object.assign(Object.create(null) as Logger, createMockLogger()),
      platform: 'vscode',
      options: { copilotPermission: true },
    });
    const pending = bridge.requestToolPermission({ agentId: 'agent-1', toolName: 'Write', toolArgs: {} });
    await Promise.resolve();
    const request = broadcastMessage.mock.calls[0]?.[1] as { requestId: string; timestamp: number };
    expect(request).toBeDefined();
    if (settlement === 'response') bridge.resolvePermission(request.requestId, { requestId: request.requestId, decision: 'allow' });
    else bridge.cleanup();
    await pending;
    expect(hostAttention.resolve).toHaveBeenCalledTimes(1);
    expect(hostAttention.resolve).toHaveBeenCalledWith(`lane-permission:${request.requestId}`, request.timestamp);
  });
});

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
    registerInstance: (token: symbol, instance: unknown) => {
      registry.set(token, instance);
    },
  } as unknown as DependencyContainer;
}

describe('agent delivery push sinks', () => {
  it('broadcasts receipt and parent-delivery changes on the monitor channel', async () => {
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { events: new EventEmitter(), findAgentInfo: () => undefined }],
      [TOKENS.WEBVIEW_MANAGER, { broadcastMessage }],
    ]);
    wireAgentEventListeners(container, {
      logger: Object.assign(Object.create(null) as Logger, createMockLogger()),
      platform: 'electron',
    });
    const receipt: AgentDeliveryReceipt = {
      id: 'message-1', agentId: 'agent-1' as AgentId, state: 'accepted',
      mode: 'queue-next-turn', delivery: 'queue', createdAt: 1, updatedAt: 1,
    };
    const envelope: ParentDeliveryEnvelope = {
      id: 'lane-delivery:completion-1', parentSessionId: PARENT_SESSION,
      agentId: 'agent-1', kind: 'completion', dedupeKey: 'completion-1',
      body: 'Done', createdAt: 1, updatedAt: 2, state: 'delivered', attempts: 1,
      bodyBytes: 4, verdict: 'no-deliverable', stopReason: 'auth',
    };
    container.resolve<{ changed(receipt: AgentDeliveryReceipt): void }>(
      CLI_AGENT_RUNTIME_TOKENS.AGENT_DELIVERY_RECEIPT_EVENT_SINK,
    ).changed(receipt);
    container.resolve<{ emit(envelope: ParentDeliveryEnvelope): void }>(
      CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK,
    ).emit(envelope);
    expect(broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.AGENT_MONITOR_MESSAGE_RECEIPT, { receipt },
    );
    expect(broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY,
      expect.objectContaining({ agentId: 'agent-1', kind: 'completion', state: 'delivered',
        deliveryId: envelope.id, verdict: 'no-deliverable', stopReason: 'auth' }),
    );
    container.resolve<{ emit(envelope: ParentDeliveryEnvelope): void }>(
      CLI_AGENT_RUNTIME_TOKENS.PARENT_DELIVERY_EVENT_SINK,
    ).emit({ ...envelope, state: 'blocked-retryable', attempts: 2, lastError: 'busy',
      nextRetryAt: 30_000, waitingReason: undefined });
    expect(broadcastMessage).toHaveBeenCalledWith(
      MESSAGE_TYPES.AGENT_MONITOR_PARENT_DELIVERY,
      expect.objectContaining({ deliveryId: envelope.id, state: 'blocked-retryable',
        parentSessionId: PARENT_SESSION, createdAt: 1, updatedAt: 2, attempts: 2,
        lastError: 'busy', nextRetryAt: 30_000 }),
    );
  });
});

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

describe('persistCliSessionReference — completion time', () => {
  const completedAt = '2026-10-17T12:34:56.000Z';

  function persist(info: AgentProcessInfo, addCliSession: jest.Mock): void {
    const logger = createMockLogger();
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
      info,
      undefined,
    );
  }

  it('persists abandoned CLI IDs with the current thread reference', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    persist(buildInfo({
      parentSessionId: PARENT_SESSION,
      cliSessionId: 'bundled-thread',
      replacesCliSessionIds: ['installed-thread'],
      status: 'completed',
    }), addCliSession);

    expect(addCliSession).toHaveBeenCalledWith(PARENT_SESSION,
      expect.objectContaining({
        cliSessionId: 'bundled-thread',
        replacesCliSessionIds: ['installed-thread'],
      }));
  });

  it('writes the exit completion time on the reference', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const info = buildInfo({
      parentSessionId: PARENT_SESSION,
      cliSessionId: 'cli-sess-1',
      status: 'completed',
      completedAt,
    });

    persist(info, addCliSession);

    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ completedAt }),
    );
  });

  it('adds completion time when a terminal write replaces an older reference', () => {
    const references: CliSessionReference[] = [];
    const addCliSession = jest
      .fn()
      .mockImplementation((_sessionId: string, ref: CliSessionReference) => {
        references.push(ref);
        return Promise.resolve();
      });
    const base = {
      parentSessionId: PARENT_SESSION,
      cliSessionId: 'cli-sess-1',
      ptahCliId: 'ptah-agent-1',
      modelScope: 'model-1',
    };

    persist(buildInfo({ ...base, status: 'running' }), addCliSession);
    const olderReference = references[0];
    expect(olderReference).not.toHaveProperty('completedAt');

    persist(
      buildInfo({ ...base, status: 'completed', completedAt }),
      addCliSession,
    );

    expect(references[1]).toEqual({
      ...olderReference,
      status: 'completed',
      completedAt,
    });
  });

  it('omits completion time when the process has none', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const info = buildInfo({
      parentSessionId: PARENT_SESSION,
      cliSessionId: 'cli-sess-1',
      status: 'completed',
    });

    persist(info, addCliSession);
    expect(addCliSession.mock.calls[0][1]).not.toHaveProperty('completedAt');
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
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput, findAgentInfo: () => undefined }],
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

  it('keeps stdout, segments and streamEvents off the reference and stores them per agent on exit', async () => {
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
    expect(ref).not.toHaveProperty('streamEvents');
    expect(ref).not.toHaveProperty('segments');
    expect(ref).not.toHaveProperty('stdout');

    expect(saveAgentOutput).toHaveBeenCalledWith(
      AGENT_ID,
      expect.objectContaining({
        stdout: 'tail of stdout',
        streamEvents: expect.arrayContaining([
          expect.objectContaining({ id: 'evt-0' }),
        ]),
      }),
      PARENT_SESSION,
    );
    expect(saveAgentOutput.mock.calls[0][1].segments).toHaveLength(3);
    expect(saveAgentOutput.mock.calls[0][1].streamEvents).toHaveLength(25);
  });

  it('yields no own keys on the object passed to saveAgentOutput when optional fields are absent', async () => {
    const readOutput = jest.fn().mockReturnValue({
      stdout: 'tail of stdout',
    });
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

    await Promise.resolve();

    expect(saveAgentOutput).toHaveBeenCalledTimes(1);
    const passedPayload = saveAgentOutput.mock.calls[0][1];
    expect(Object.prototype.hasOwnProperty.call(passedPayload, 'stdout')).toBe(
      true,
    );
    expect(
      Object.prototype.hasOwnProperty.call(passedPayload, 'segments'),
    ).toBe(false);
    expect(
      Object.prototype.hasOwnProperty.call(passedPayload, 'streamEvents'),
    ).toBe(false);
    expect(Object.keys(passedPayload)).toEqual(['stdout']);
  });

  it('still persists the reference when the store predates saveAgentOutput', () => {
    const readOutput = jest.fn().mockReturnValue(buildOutput());
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput, findAgentInfo: () => undefined }],
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
    const ref = addCliSession.mock.calls[0][1];
    expect(ref.stdout).toBe('tail of stdout');
    expect(ref.segments).toHaveLength(3);
    expect(ref).not.toHaveProperty('streamEvents');
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
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput, findAgentInfo: () => undefined }],
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
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput, findAgentInfo: () => undefined }],
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

  it('does not retry when the bulk write fails with a deterministic serialisation error', async () => {
    const readOutput = jest.fn().mockReturnValue({
      stdout: 'tail',
      segments: [{ type: 'text', content: 'segment-0' }],
      streamEvents: [{ id: 'evt-0', eventType: 'text_delta' }],
    });
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const serializationError = new Error(
      'Worker message contains a non-JSON-compatible value',
    );
    serializationError.name = 'ElectronStateWorkerProtocolError';
    const saveAgentOutput = jest.fn().mockRejectedValue(serializationError);
    const logger = createMockLogger();
    const container = buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { readOutputForPersistence: readOutput, findAgentInfo: () => undefined }],
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

    expect(saveAgentOutput).toHaveBeenCalledTimes(1); // not retried
    expect(addCliSession).not.toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining(
        'Failed to persist CLI session reference after retries',
      ),
      serializationError,
    );
  });
});

/**
 * TASK_2026_596 Gate 2 G3 — a run persists its full owner reference, and an
 * owner that becomes known while the run is live is persisted at once.
 */
describe('quota owner persistence (TASK_2026_596 G3)', () => {
  const owner = {
    key: 'openai-codex#account:0123456789abcdef',
    providerId: 'openai-codex',
    identityKind: 'account' as const,
    label: 'Codex account',
  };

  function wire(addCliSession: jest.Mock): EventEmitter {
    const events = new EventEmitter();
    const container = buildContainer([
      [
        TOKENS.AGENT_PROCESS_MANAGER,
        {
          events,
          readOutputForPersistence: jest.fn().mockReturnValue({}),
          findAgentInfo: () => undefined,
        },
      ],
      [
        TOKENS.WEBVIEW_MANAGER,
        { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
      ],
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ]);
    wireAgentEventListeners(container, {
      logger: createMockLogger() as unknown as Logger,
      platform: 'electron',
      options: { persistCliSession: true },
    });
    return events;
  }

  it('copies the full owner reference onto the persisted reference', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);

    persistCliSessionReference(
      buildContainer([
        [
          SDK_TOKENS.SDK_SESSION_METADATA_STORE,
          { addCliSession, markChildSession: jest.fn() },
        ],
      ]),
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        cli: 'codex',
        status: 'running',
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        quotaOwner: owner,
      }),
      undefined,
    );

    const ref = addCliSession.mock.calls[0][1];
    expect(ref.quotaOwner).toEqual(owner);
    expect(ref).not.toHaveProperty('quotaOwnerKey');
  });

  it('omits the owner when the run has none', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);

    persistCliSessionReference(
      buildContainer([
        [
          SDK_TOKENS.SDK_SESSION_METADATA_STORE,
          { addCliSession, markChildSession: jest.fn() },
        ],
      ]),
      createMockLogger() as unknown as Logger,
      '[test]',
      buildInfo({
        status: 'running',
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
      }),
      undefined,
    );

    expect(addCliSession.mock.calls[0][1]).not.toHaveProperty('quotaOwner');
  });

  it("persists immediately when a running lane's owner becomes known", () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const events = wire(addCliSession);

    events.emit(
      'agent:quota-owner',
      buildInfo({
        cli: 'codex',
        status: 'running',
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        quotaOwner: owner,
      }),
    );

    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({
        cliSessionId: 'cli-sess-1',
        status: 'running',
        quotaOwner: owner,
      }),
    );
  });

  it('waits for the exit persist when a running lane has no CLI session id yet', () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const events = wire(addCliSession);

    events.emit(
      'agent:quota-owner',
      buildInfo({
        cli: 'codex',
        status: 'running',
        parentSessionId: PARENT_SESSION,
        quotaOwner: owner,
      }),
    );

    expect(addCliSession).not.toHaveBeenCalled();
  });

  it('persists an owner that arrives after the run finished', async () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const events = wire(addCliSession);

    events.emit(
      'agent:quota-owner',
      buildInfo({
        cli: 'codex',
        status: 'completed',
        parentSessionId: PARENT_SESSION,
        quotaOwner: owner,
      }),
    );
    await Promise.resolve();
    await Promise.resolve();

    expect(addCliSession).toHaveBeenCalledWith(
      PARENT_SESSION,
      expect.objectContaining({ quotaOwner: owner }),
    );
  });
});

/**
 * Records each `addCliSession` attempt and lets a test await an exact attempt
 * count instead of guessing how many microtask turns the lane queue needs.
 */
function createWriteLog(
  fails: (ref: CliSessionReference, attempt: number) => boolean = () => false,
) {
  const durable: CliSessionReference[] = [];
  const waiters = new Set<{ count: number; resolve: () => void }>();
  let attempts = 0;
  const addCliSession = jest.fn(
    (_parent: string, ref: CliSessionReference): Promise<void> => {
      attempts += 1;
      const failed = fails(ref, attempts);
      if (!failed) durable.push(ref);
      for (const waiter of [...waiters]) {
        if (attempts >= waiter.count) {
          waiters.delete(waiter);
          waiter.resolve();
        }
      }
      return failed
        ? Promise.reject(new Error('transient checkpoint failure'))
        : Promise.resolve();
    },
  );
  const attemptsReached = (count: number): Promise<void> =>
    attempts >= count
      ? Promise.resolve()
      : new Promise<void>((resolve) => waiters.add({ count, resolve }));
  return { addCliSession, durable, attemptsReached };
}

/** Every remaining queue stage is a microtask, so one macrotask drains it. */
const drainMicrotasks = (): Promise<void> =>
  new Promise<void>((resolve) => setImmediate(resolve));

function wireCheckpointLane(
  addCliSession: ReturnType<typeof createWriteLog>['addCliSession'],
  currentInfo: () => AgentProcessInfo,
): EventEmitter {
  const events = new EventEmitter();
  const container = buildContainer([
    [
      TOKENS.AGENT_PROCESS_MANAGER,
      {
        events,
        findAgentInfo: currentInfo,
        readOutputForPersistence: jest.fn().mockReturnValue(undefined),
      },
    ],
    [
      TOKENS.WEBVIEW_MANAGER,
      { broadcastMessage: jest.fn().mockResolvedValue(undefined) },
    ],
    [
      SDK_TOKENS.SDK_SESSION_METADATA_STORE,
      { addCliSession, markChildSession: jest.fn() },
    ],
  ]);
  wireAgentEventListeners(container, {
    logger: createMockLogger() as unknown as Logger,
    platform: 'electron',
    options: { persistCliSession: true },
  });
  return events;
}

describe('wireAgentEventListeners — running activity checkpoints', () => {
  it('persists throttled activity without output and resets on exit', async () => {
    const { addCliSession, durable, attemptsReached } = createWriteLog();
    let current = buildInfo({
      cli: 'codex',
      status: 'running',
      parentSessionId: PARENT_SESSION,
      cliSessionId: 'cli-sess-1',
      lastActivityAt: '2026-10-17T12:00:00.000Z',
    });
    const events = wireCheckpointLane(addCliSession, () => current);

    events.emit('agent:output', { agentId: current.agentId });
    current = {
      ...current,
      lastActivityAt: '2026-10-17T12:00:01.000Z',
    };
    events.emit('agent:output', { agentId: current.agentId });
    await attemptsReached(1);
    await drainMicrotasks();

    expect(addCliSession).toHaveBeenCalledTimes(1);
    expect(durable[0]).toMatchObject({
      lastActivityAt: '2026-10-17T12:00:00.000Z',
      status: 'running',
    });
    expect(durable[0]).not.toHaveProperty('stdout');

    current = {
      ...current,
      lastActivityAt: '2026-10-17T12:00:30.000Z',
    };
    events.emit('agent:output', { agentId: current.agentId });
    await attemptsReached(2);

    expect(durable[1]).toMatchObject({
      lastActivityAt: '2026-10-17T12:00:30.000Z',
      status: 'running',
    });

    current = {
      ...current,
      status: 'completed',
      completedAt: '2026-10-17T12:00:31.000Z',
    };
    events.emit('agent:exited', current);
    await attemptsReached(3);
    events.emit('agent:output', { agentId: current.agentId });
    await drainMicrotasks();

    expect(addCliSession).toHaveBeenCalledTimes(3);
    expect(durable.map((ref) => ref.status)).toEqual([
      'running',
      'running',
      'completed',
    ]);
    expect(durable.at(-1)).toMatchObject({
      status: 'completed',
      completedAt: '2026-10-17T12:00:31.000Z',
    });
  });

  it('serializes a failed checkpoint retry before the terminal write', async () => {
    jest.useFakeTimers();
    try {
      const { addCliSession, durable, attemptsReached } = createWriteLog(
        (ref, attempt) => ref.status === 'running' && attempt === 1,
      );
      let current = buildInfo({
        cli: 'codex',
        status: 'running',
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        lastActivityAt: '2026-10-17T12:00:00.000Z',
      });
      const events = wireCheckpointLane(addCliSession, () => current);

      events.emit('agent:output', { agentId: current.agentId });
      await attemptsReached(1);

      current = {
        ...current,
        status: 'completed',
        completedAt: '2026-10-17T12:00:01.000Z',
      };
      events.emit('agent:exited', current);
      // The exit write waits behind the checkpoint's retry backoff.
      await jest.advanceTimersByTimeAsync(0);
      expect(addCliSession).toHaveBeenCalledTimes(1);

      // retryWithBackoff waits initialDelay * [0.8, 1.2); 1 200 ms covers it.
      await jest.advanceTimersByTimeAsync(1_200);
      await attemptsReached(3);
      // Any further retry would need another backoff timer.
      await jest.advanceTimersByTimeAsync(10_000);

      expect(addCliSession).toHaveBeenCalledTimes(3);
      expect(addCliSession.mock.calls.map(([, ref]) => ref.status)).toEqual([
        'running',
        'running',
        'completed',
      ]);
      expect(durable.map((ref) => ref.status)).toEqual([
        'running',
        'completed',
      ]);
      expect(durable.at(-1)).toMatchObject({
        status: 'completed',
        completedAt: '2026-10-17T12:00:01.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });

  it('releases the throttle when a checkpoint is skipped for a missing parent', async () => {
    const { addCliSession, durable, attemptsReached } = createWriteLog();
    let current = buildInfo({
      cli: 'codex',
      status: 'running',
      parentSessionId: undefined,
      cliSessionId: 'cli-sess-1',
      lastActivityAt: '2026-10-17T12:00:00.000Z',
    });
    const events = wireCheckpointLane(addCliSession, () => current);

    events.emit('agent:output', { agentId: current.agentId });
    await drainMicrotasks();
    expect(addCliSession).not.toHaveBeenCalled();

    // The parent resolves one second later, inside the throttle window.
    current = {
      ...current,
      parentSessionId: PARENT_SESSION,
      lastActivityAt: '2026-10-17T12:00:01.000Z',
    };
    events.emit('agent:output', { agentId: current.agentId });
    await attemptsReached(1);

    expect(durable[0]).toMatchObject({
      status: 'running',
      lastActivityAt: '2026-10-17T12:00:01.000Z',
    });
  });

  it('lets later output retry a checkpoint that failed after its retries', async () => {
    jest.useFakeTimers();
    try {
      const firstActivity = '2026-10-17T12:00:00.000Z';
      const { addCliSession, durable, attemptsReached } = createWriteLog(
        (ref) => ref.lastActivityAt === firstActivity,
      );
      let current = buildInfo({
        cli: 'codex',
        status: 'running',
        parentSessionId: PARENT_SESSION,
        cliSessionId: 'cli-sess-1',
        lastActivityAt: firstActivity,
      });
      const events = wireCheckpointLane(addCliSession, () => current);

      events.emit('agent:output', { agentId: current.agentId });
      // One attempt plus three retries, every backoff elapsed.
      await jest.advanceTimersByTimeAsync(20_000);
      await attemptsReached(4);
      expect(addCliSession).toHaveBeenCalledTimes(4);
      expect(durable).toEqual([]);

      // One second later: inside the throttle window of the failed stamp.
      current = { ...current, lastActivityAt: '2026-10-17T12:00:01.000Z' };
      events.emit('agent:output', { agentId: current.agentId });
      await attemptsReached(5);

      expect(durable).toHaveLength(1);
      expect(durable[0]).toMatchObject({
        status: 'running',
        lastActivityAt: '2026-10-17T12:00:01.000Z',
      });
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('wireAgentEventListeners — the drop reaches the log', () => {
  it('does not broadcast a stale turn exit', () => {
    const events = new EventEmitter();
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    const current = buildInfo({ status: 'completed', turnSeq: 2 });
    wireAgentEventListeners(buildContainer([
      [TOKENS.AGENT_PROCESS_MANAGER, { events, findAgentInfo: () => current }],
      [TOKENS.WEBVIEW_MANAGER, { broadcastMessage }],
    ]), {
      logger: Object.assign(Object.create(null) as Logger, createMockLogger()),
      platform: 'electron',
    });
    events.emit('agent:exited', buildInfo({ status: 'completed', turnSeq: 1 }));
    expect(broadcastMessage).not.toHaveBeenCalled();
  });
  it('warns when an exited agent has no parent session', () => {
    const logger = createMockLogger();
    const events = new EventEmitter();
    const agentProcessManager = {
      events,
      readOutputForPersistence: jest.fn().mockReturnValue(undefined),
      findAgentInfo: () => undefined,
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

/**
 * TASK_2026_580 (D13) — a ptah-cli child's lineage is recorded only once
 * `addCliSession` accepted the reference, which proves the parent id is a real
 * SDK session UUID rather than a tab id.
 */
describe('persistCliSessionReference — child lineage capture (TASK_2026_580)', () => {
  const CHILD_SESSION = '99999999-8888-4777-8666-555555555555';

  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  function persistWith(
    addCliSession: jest.Mock,
    recorder: { recordLineage: jest.Mock } | undefined,
    overrides: Partial<AgentProcessInfo> = {},
  ): ReturnType<typeof createMockLogger> {
    const logger = createMockLogger();
    const entries: Array<[symbol, unknown]> = [
      [
        SDK_TOKENS.SDK_SESSION_METADATA_STORE,
        {
          addCliSession,
          markChildSession: jest.fn().mockResolvedValue(undefined),
        },
      ],
    ];
    if (recorder) {
      entries.push([PLATFORM_TOKENS.SESSION_ORGANIZATION_RECORDER, recorder]);
    }
    persistCliSessionReference(
      buildContainer(entries),
      logger as unknown as Logger,
      '[test]',
      buildInfo({
        parentSessionId: PARENT_SESSION,
        cliSessionId: CHILD_SESSION,
        // The `agent:spawned` shape: no output to persist, so no output warning.
        status: 'running',
        ...overrides,
      }),
      undefined,
    );
    return logger;
  }

  it('records lineage with the parent and startedBy agent after a resolved add', async () => {
    const recordLineage = jest.fn();
    persistWith(jest.fn().mockResolvedValue(undefined), { recordLineage });

    await jest.advanceTimersByTimeAsync(0);

    expect(recordLineage).toHaveBeenCalledTimes(1);
    expect(recordLineage).toHaveBeenCalledWith({
      sessionId: CHILD_SESSION,
      parentSessionId: PARENT_SESSION,
      startedBy: 'agent',
      workspaceRootHint: '/repo',
    });
  });

  it('does not record when the add is rejected with "Parent session not found"', async () => {
    const recordLineage = jest.fn();
    persistWith(
      jest.fn().mockRejectedValue(new Error('Parent session not found: x')),
      { recordLineage },
    );

    await jest.advanceTimersByTimeAsync(60_000);

    expect(recordLineage).not.toHaveBeenCalled();
  });

  it('does not record when the child session id equals the parent', async () => {
    const recordLineage = jest.fn();
    persistWith(
      jest.fn().mockResolvedValue(undefined),
      { recordLineage },
      { cliSessionId: PARENT_SESSION },
    );

    await jest.advanceTimersByTimeAsync(0);

    expect(recordLineage).not.toHaveBeenCalled();
  });

  it('is a no-op when no recorder is registered', async () => {
    const addCliSession = jest.fn().mockResolvedValue(undefined);
    const logger = persistWith(addCliSession, undefined);

    await jest.advanceTimersByTimeAsync(0);

    expect(addCliSession).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalled();
    expect(logger.error).not.toHaveBeenCalled();
  });

  it('logs a faulty recorder throw instead of reporting a failed persist', async () => {
    const recordLineage = jest.fn(() => {
      throw new Error('recorder broke');
    });
    const logger = persistWith(jest.fn().mockResolvedValue(undefined), {
      recordLineage,
    });

    await jest.advanceTimersByTimeAsync(0);

    expect(logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('Could not record child session lineage'),
      expect.any(Error),
    );
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe('wireAgentEventListeners handoff chain and reparent (TASK_2026_876)', () => {
  const token = CLI_AGENT_RUNTIME_TOKENS.SESSION_HANDOFF_CHAIN;

  it('broadcasts agent-monitor:reparented and sessionHandoff:linked', async () => {
    const events = new EventEmitter();
    const broadcastMessage = jest.fn().mockResolvedValue(undefined);
    let listener: ((link: { fromSessionId: string; toSessionId: string }) => void) | undefined;
    const chain = {
      onLinkWritten: jest.fn(
        (cb: (link: { fromSessionId: string; toSessionId: string }) => void) => {
          listener = cb;
          return () => undefined;
        },
      ),
    };
    const logger = Object.assign(Object.create(null) as Logger, createMockLogger());
    wireAgentEventListeners(
      buildContainer([
        [TOKENS.AGENT_PROCESS_MANAGER, { events, findAgentInfo: () => undefined }],
        [TOKENS.WEBVIEW_MANAGER, { broadcastMessage }],
        [token, chain],
      ]),
      { logger, platform: 'electron' },
    );

    events.emit('agent:reparented', {
      agentIds: ['lane-a'],
      parentSessionId: 'tab-next',
    });
    listener?.({ fromSessionId: 'from-sdk', toSessionId: 'to-sdk' });
    await Promise.resolve();

    expect(broadcastMessage).toHaveBeenCalledWith('agent-monitor:reparented', {
      agentIds: ['lane-a'],
      parentSessionId: 'tab-next',
    });
    expect(broadcastMessage).toHaveBeenCalledWith('sessionHandoff:linked', {
      fromSessionId: 'from-sdk',
      toSessionId: 'to-sdk',
    });
  });

  it('logs a rejected linked broadcast and skips a missing chain token', async () => {
    const events = new EventEmitter();
    const broadcastMessage = jest.fn().mockRejectedValue(new Error('no webview'));
    let listener: (() => void) | undefined;
    const chain = {
      onLinkWritten: jest.fn((cb: () => void) => {
        listener = cb;
        return () => undefined;
      }),
    };
    const logger = Object.assign(Object.create(null) as Logger, createMockLogger());
    wireAgentEventListeners(
      buildContainer([
        [TOKENS.AGENT_PROCESS_MANAGER, { events, findAgentInfo: () => undefined }],
        [TOKENS.WEBVIEW_MANAGER, { broadcastMessage }],
        [token, chain],
      ]),
      { logger, platform: 'cli' },
    );
    listener?.();
    await Promise.resolve();
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('sessionHandoff:linked'),
      expect.any(Error),
    );

    const quiet = Object.assign(Object.create(null) as Logger, createMockLogger());
    wireAgentEventListeners(
      buildContainer([
        [TOKENS.AGENT_PROCESS_MANAGER, { events: new EventEmitter(), findAgentInfo: () => undefined }],
        [TOKENS.WEBVIEW_MANAGER, { broadcastMessage: jest.fn() }],
      ]),
      { logger: quiet, platform: 'cli' },
    );
    expect(quiet.error).not.toHaveBeenCalled();
  });
});
