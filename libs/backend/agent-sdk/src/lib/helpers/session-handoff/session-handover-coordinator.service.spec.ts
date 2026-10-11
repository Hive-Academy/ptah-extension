import 'reflect-metadata';

import type { SessionHandoverState } from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';

import { SessionHandoffBuilder } from '../session-budget/session-handoff-builder';
import { SessionHandoffWriter } from '../session-budget/session-handoff-writer';
import { SessionHistoryReaderService } from '../../session-history-reader.service';
import {
  SessionHandoverCoordinator,
  HANDOFF_REQUEST_PROMPT,
  type HandoverSourceSnapshot,
  type QueuedSessionInput,
  type SessionHandoverRuntime,
  type SessionSuccessorHost,
} from './session-handover-coordinator.service';

const SOURCE: HandoverSourceSnapshot = {
  sessionId: 'source',
  tabId: 'tab-source',
  token: 'token-source',
  workspacePath: '/workspace',
  successorConfig: {
    model: 'claude-sonnet',
    effort: 'medium',
    permissionLevel: 'auto-edit',
    workspacePath: '/workspace',
  },
  resourceLease: {
    worktreePath: '/workspace',
    inheritedParentIds: [],
  },
};

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface Harness {
  readonly coordinator: SessionHandoverCoordinator;
  readonly host: jest.Mocked<SessionSuccessorHost>;
  readonly runtime: jest.Mocked<SessionHandoverRuntime>;
  readonly build: jest.Mock;
  readonly write: jest.Mock;
  readonly history: jest.Mock;
  readonly logger: { readonly info: jest.Mock; readonly warn: jest.Mock };
  readonly subagents: jest.Mock;
}

function makeHarness(
  options: { host?: SessionSuccessorHost | null; close?: boolean } = {},
): Harness {
  const build = jest.fn().mockResolvedValue({
    document: { content: '# handoff', seed: 'seed', truncated: false },
  });
  const write = jest.fn().mockResolvedValue({ path: '/handoff.md' });
  const host = (options.host ?? {
    startSuccessorSession: jest.fn().mockResolvedValue({ started: true }),
    deliverTransferInputs: jest.fn().mockResolvedValue({ delivered: true }),
  }) as jest.Mocked<SessionSuccessorHost>;
  const subagents = jest.fn().mockReturnValue(0);
  const runtime: jest.Mocked<SessionHandoverRuntime> = {
    sourceSnapshot: jest.fn().mockReturnValue(SOURCE),
    queueOwnedHandoff: jest.fn().mockResolvedValue(undefined),
    restoreInputs: jest.fn().mockReturnValue(true),
    closeIfTokenMatches: jest.fn().mockResolvedValue(options.close ?? true),
    isOwnedHandoffPendingOrRunning: jest.fn().mockReturnValue(false),
    subagentsInFlight: subagents,
  };
  const history = jest.fn().mockResolvedValue([]);
  const logger = { info: jest.fn(), warn: jest.fn() };
  const coordinator = new SessionHandoverCoordinator(
    { build } as unknown as SessionHandoffBuilder,
    { write } as unknown as SessionHandoffWriter,
    {
      readHistoryForCuration: history,
    } as unknown as SessionHistoryReaderService,
    () => host,
    logger as unknown as Logger,
  );
  coordinator.attachRuntime(runtime);
  return { coordinator, host, runtime, build, write, history, logger, subagents };
}

describe('SessionHandoverCoordinator', () => {
  it('is single-flight and transfers queued inputs in FIFO order', () => {
    const { coordinator } = makeHarness();
    const first = coordinator.request('source', 'successor', true);
    const duplicate = coordinator.request('source', 'budget-limit', true);
    const queue: QueuedSessionInput[] = [
      { content: 'first' },
      { content: 'second' },
    ];

    coordinator.armAtTerminal('source', false, queue);
    coordinator.admitOrHold('source', { content: 'third' });

    expect(duplicate.operationId).toBe(first.operationId);
    expect(queue).toEqual([]);
    expect(coordinator.transferInputs('source').map((input) => input.content)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('cancels before compaction and restores the FIFO in order exactly once', () => {
    const { coordinator, runtime } = makeHarness();
    const operation = coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'first' });
    coordinator.admitOrHold('source', { content: 'second' });

    expect(coordinator.cancel('source', operation.operationId)).toEqual([
      { content: 'first' },
      { content: 'second' },
    ]);
    expect(runtime.restoreInputs).toHaveBeenCalledTimes(1);
    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [
      { content: 'first' },
      { content: 'second' },
    ]);
  });

  it('keeps every later input held while armed', () => {
    const { coordinator } = makeHarness();
    coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);

    for (const content of [
      'user',
      'lane-completion',
      'agent-report',
      'peer',
      'steer',
      'require-idle',
    ]) {
      expect(
        coordinator.admitOrHold('source', {
          content,
          ...(content === 'require-idle' ? { admission: 'require-idle' as const } : {}),
        }).held,
      ).toBe(true);
    }

    expect(coordinator.transferInputs('source').map((input) => input.content)).toEqual([
      'user',
      'lane-completion',
      'agent-report',
      'peer',
      'steer',
      'require-idle',
    ]);
  });

  it('writes an agent handoff, delivers the detached FIFO once, and closes after host confirmation', async () => {
    const { coordinator, runtime, build, host } = makeHarness();
    const result = coordinator.begin('source', 'successor', false, 'agent notes');

    expect(result.accepted).toBe(true);
    await flush();
    await flush();

    expect(runtime.queueOwnedHandoff).not.toHaveBeenCalled();
    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      agentHandoff: 'agent notes',
    }));
    expect(host.startSuccessorSession).toHaveBeenCalledWith(expect.objectContaining({
      source: SOURCE,
      seed: 'seed',
    }));
    expect(host.deliverTransferInputs).toHaveBeenCalledWith(
      expect.any(String),
      [],
    );
    expect(runtime.closeIfTokenMatches).toHaveBeenCalledWith('source', 'token-source');
    expect(coordinator.snapshotFor('source')?.phase).toBe('closed');
  });

  it('delivers inputs held during a delivery snapshot before closing', async () => {
    const { coordinator, host } = makeHarness();
    host.deliverTransferInputs.mockImplementationOnce(async () => {
      coordinator.admitOrHold('source', { content: 'late arrival' });
      return { delivered: true };
    });
    coordinator.begin('source', 'successor', false);
    coordinator.admitOrHold('source', { content: 'initial arrival' });

    await flush();
    await flush();
    await flush();

    expect(host.deliverTransferInputs).toHaveBeenNthCalledWith(
      1,
      expect.any(String),
      [{ content: 'initial arrival' }],
    );
    expect(host.deliverTransferInputs).toHaveBeenNthCalledWith(
      2,
      expect.any(String),
      [{ content: 'late arrival' }],
    );
    expect(coordinator.snapshotFor('source')?.phase).toBe('closed');
  });

  it('stops the successor and restores every held input when a later delivery fails', async () => {
    const { coordinator, host, runtime } = makeHarness();
    host.stopSuccessorSession = jest.fn().mockResolvedValue(undefined);
    host.deliverTransferInputs
      .mockImplementationOnce(async () => {
        coordinator.admitOrHold('source', { content: 'late arrival' });
        return { delivered: true };
      })
      .mockResolvedValueOnce({ delivered: false, error: 'delivery' });
    coordinator.begin('source', 'successor', false);
    coordinator.admitOrHold('source', { content: 'initial arrival' });

    await flush();
    await flush();
    await flush();

    expect(host.stopSuccessorSession).toHaveBeenCalledTimes(1);
    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [
      { content: 'initial arrival' },
      { content: 'late arrival' },
    ]);
    expect(coordinator.snapshotFor('source')?.phase).toBe('failed');
  });

  it('delivers input held while the source closes to the successor', async () => {
    const { coordinator, host, runtime } = makeHarness();
    runtime.closeIfTokenMatches.mockImplementationOnce(async () => {
      coordinator.admitOrHold('source', { content: 'sent during close' });
      return true;
    });
    coordinator.begin('source', 'successor', false);

    await flush();
    await flush();
    await flush();

    expect(host.deliverTransferInputs).toHaveBeenLastCalledWith(
      expect.any(String),
      [{ content: 'sent during close' }],
    );
    expect(coordinator.transferInputs('source')).toEqual([]);
  });

  it('reports late inputs as lost when their delivery throws after the source closed', async () => {
    const { coordinator, host, runtime } = makeHarness();
    runtime.closeIfTokenMatches.mockImplementationOnce(async () => {
      coordinator.admitOrHold('source', { content: 'sent during close' });
      return true;
    });
    host.deliverTransferInputs
      .mockResolvedValueOnce({ delivered: true })
      .mockRejectedValueOnce(new Error('successor gone'));
    coordinator.begin('source', 'successor', false);

    await flush();
    await flush();
    await flush();

    const state = coordinator.snapshotFor('source');
    expect(state?.phase).toBe('closed');
    expect(state?.lostInputCount).toBe(1);
    expect(state?.lostInputTexts).toEqual(['sent during close']);
    expect(coordinator.transferInputs('source')).toEqual([]);
  });

  it('clears the lost-input error when a cancel retries the restore successfully', async () => {
    const { coordinator, host, runtime } = makeHarness();
    host.startSuccessorSession.mockResolvedValueOnce({ started: false, error: 'start' });
    runtime.restoreInputs.mockReturnValueOnce(false);
    coordinator.begin('source', 'successor', false);
    coordinator.admitOrHold('source', { content: 'held' });

    await flush();
    await flush();

    const failed = coordinator.snapshotFor('source');
    expect(failed?.lostInputCount).toBe(1);
    coordinator.cancel('source', failed?.operationId ?? '');

    const cancelled = coordinator.snapshotFor('source');
    expect(cancelled?.phase).toBe('cancelled');
    expect(cancelled?.lostInputCount ?? 0).toBe(0);
    expect(cancelled?.error).toBeUndefined();
  });

  it('cancels a failed handover so the source can keep working', async () => {
    const { coordinator, host } = makeHarness();
    host.startSuccessorSession.mockResolvedValueOnce({ started: false, error: 'start' });
    coordinator.begin('source', 'successor', false);

    await flush();
    await flush();

    const failed = coordinator.snapshotFor('source');
    expect(failed?.phase).toBe('failed');
    expect(coordinator.cancel('source', failed?.operationId ?? '')).toEqual([]);
    expect(coordinator.snapshotFor('source')?.phase).toBe('cancelled');
  });

  it('passes the source full-auto permission level to the successor unchanged', async () => {
    const { coordinator, host, runtime } = makeHarness();
    runtime.sourceSnapshot.mockReturnValue({
      ...SOURCE,
      successorConfig: { ...SOURCE.successorConfig, permissionLevel: 'yolo' },
    });

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(host.startSuccessorSession).toHaveBeenCalledWith(expect.objectContaining({
      source: expect.objectContaining({
        successorConfig: expect.objectContaining({ permissionLevel: 'yolo' }),
      }),
    }));
  });

  it('merges a child resource lease and publishes its successor tab id before closing', async () => {
    const { coordinator, host } = makeHarness();
    host.startSuccessorSession.mockResolvedValueOnce({
      started: true,
      successorTabId: 'successor-tab',
    });
    coordinator.setResourceLeaseProvider(() => ({
      worktreePath: '/child-worktree',
      mcpRootPath: '/child-worktree',
      inheritedParentIds: ['parent-tab'],
    }));
    const states: SessionHandoverState[] = [];
    coordinator.onStateChange((state) => states.push(state));

    coordinator.begin('source', 'successor', false, 'handoff');
    await flush();
    await flush();

    expect(host.startSuccessorSession).toHaveBeenCalledWith(expect.objectContaining({
      resourceLease: {
        worktreePath: '/child-worktree',
        mcpRootPath: '/child-worktree',
        inheritedParentIds: ['parent-tab'],
      },
    }));
    expect(states).toEqual(expect.arrayContaining([
      expect.objectContaining({ phase: 'successor-confirmed', successorTabId: 'successor-tab' }),
      expect.objectContaining({ phase: 'closing', successorTabId: 'successor-tab' }),
    ]));
  });

  it('restores FIFO and leaves source open when the writer fails', async () => {
    const { coordinator, write, runtime } = makeHarness();
    write.mockResolvedValueOnce({ path: null, writeError: 'disk' });
    const state = coordinator.begin('source', 'successor', false);
    if (state.accepted) coordinator.admitOrHold('source', { content: 'held' });
    await flush();
    await flush();

    expect(runtime.closeIfTokenMatches).not.toHaveBeenCalled();
    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'held' }]);
    expect(coordinator.snapshotFor('source')?.phase).toBe('failed');
  });

  it.each([
    ['successor host', (h: Harness) =>
      h.host.startSuccessorSession.mockResolvedValueOnce({ started: false, error: 'start' })],
    ['successor delivery', (h: Harness) =>
      h.host.deliverTransferInputs.mockResolvedValueOnce({ delivered: false, error: 'delivery' })],
  ])('restores and does not close after %s failure', async (_name, arrange) => {
    const harness = makeHarness();
    arrange(harness);
    harness.coordinator.begin('source', 'successor', false);
    harness.coordinator.admitOrHold('source', { content: 'held' });
    await flush();
    await flush();

    expect(harness.runtime.closeIfTokenMatches).not.toHaveBeenCalled();
    expect(harness.runtime.restoreInputs).toHaveBeenCalledWith('source', [
      { content: 'held' },
    ]);
    expect(harness.coordinator.snapshotFor('source')?.phase).toBe('failed');
  });

  it('does not close a re-registered source when its token is stale', async () => {
    const { coordinator, runtime } = makeHarness({ close: false });
    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(runtime.closeIfTokenMatches).toHaveBeenCalledWith('source', 'token-source');
    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
      phase: 'failed',
      error: 'source token no longer matches',
    }));
  });

  it('returns unavailable without arming or holding when no host is bound', () => {
    const coordinator = new SessionHandoverCoordinator(null, null, null);

    expect(coordinator.begin('source', 'successor', false)).toEqual({
      accepted: false,
      error: 'unavailable',
    });
    expect(coordinator.snapshotFor('source')).toBeUndefined();
    expect(coordinator.admitOrHold('source', { content: 'unchanged' })).toEqual({
      held: false,
    });
  });

  it('publishes revisioned phase snapshots for a Batch B state broadcaster', () => {
    const { coordinator } = makeHarness();
    const changes: SessionHandoverState[] = [];
    const dispose = coordinator.onStateChange((state) => changes.push(state));
    coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    dispose();

    expect(changes.map((state) => state.phase)).toEqual([
      'armed',
      'awaiting-confirmation',
    ]);
    expect(changes[1].revision).toBeGreaterThan(changes[0].revision);
  });

  it('auto-arms at handoff without confirmation but never at normal terminal turns', () => {
    const { coordinator } = makeHarness();

    expect(coordinator.armAtTerminal('normal', false, [], false)).toBeUndefined();
    const state = coordinator.armAtTerminal('source', false, [], true);

    expect(state).toEqual(expect.objectContaining({ reason: 'budget-auto', phase: 'armed' }));
    expect(coordinator.snapshotFor('source')).toEqual(
      expect.objectContaining({ reason: 'budget-auto', phase: 'writing-handoff' }),
    );
  });

  it('does not re-arm a cancelled automatic handoff until the blocking limit', () => {
    const { coordinator } = makeHarness();
    const operation = coordinator.request('source', 'budget-auto', false);

    coordinator.cancel('source', operation.operationId);
    expect(coordinator.armAtTerminal('source', false, [], true)).toEqual(
      expect.objectContaining({ operationId: operation.operationId, phase: 'cancelled' }),
    );
    expect(coordinator.armAtTerminal('source', true, [], true)).toEqual(
      expect.objectContaining({ reason: 'budget-limit', phase: 'awaiting-confirmation' }),
    );
  });

  it('uses the completed owned handoff text in the successor seed and never transfers its prompt', async () => {
    const { coordinator, runtime, history, build, host } = makeHarness();
    history
      .mockResolvedValueOnce([{ role: 'assistant', id: 'before', content: 'old' }])
      .mockResolvedValueOnce([{ role: 'assistant', id: 'after', content: 'agent handoff' }]);

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(runtime.queueOwnedHandoff).toHaveBeenCalledWith('source', HANDOFF_REQUEST_PROMPT);
    expect(build).toHaveBeenCalledWith(expect.objectContaining({ agentHandoff: 'agent handoff' }));
    expect(host.deliverTransferInputs).toHaveBeenCalledWith(expect.any(String), []);
  });

  it('reports held inputs as lost when the source ends and allows a new operation', () => {
    const { coordinator, runtime } = makeHarness();
    const first = coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'keep me' });
    coordinator.admitOrHold('source', { content: 'put me back' });

    coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');

    expect(runtime.restoreInputs).not.toHaveBeenCalled();
    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
      phase: 'failed',
      error: 'source session ended: stream stopped',
      lostInputCount: 2,
      lostInputTexts: ['keep me', 'put me back'],
    }));
    expect(coordinator.request('source', 'successor', false).operationId).not.toBe(first.operationId);
  });

  it('does not re-arm a failed automatic handoff until the blocking limit', async () => {
    const { coordinator, write } = makeHarness();
    write.mockResolvedValueOnce({ path: null, writeError: 'disk' });

    coordinator.armAtTerminal('source', false, [], true);
    await flush();
    await flush();
    await flush();

    const failed = coordinator.snapshotFor('source');
    expect(failed).toEqual(expect.objectContaining({ reason: 'budget-auto', phase: 'failed' }));
    expect(coordinator.armAtTerminal('source', false, [], true)).toEqual(failed);
    expect(coordinator.armAtTerminal('source', true, [], true)).toEqual(
      expect.objectContaining({ reason: 'budget-limit', phase: 'awaiting-confirmation' }),
    );
  });

  it('reports lost inputs and never delivers when the source ends during successor startup', async () => {
    let resolveStart!: (result: { readonly started: boolean }) => void;
    const start = jest.fn().mockImplementation(
      () => new Promise<{ readonly started: boolean }>((resolve) => { resolveStart = resolve; }),
    );
    const deliver = jest.fn().mockResolvedValue({ delivered: true });
    const stop = jest.fn().mockResolvedValue(undefined);
    const { coordinator, runtime } = makeHarness({
      host: {
        startSuccessorSession: start,
        deliverTransferInputs: deliver,
        stopSuccessorSession: stop,
      },
    });

    coordinator.begin('source', 'successor', false, 'provided handoff');
    coordinator.admitOrHold('source', { content: 'keep me' });
    await flush();
    await flush();
    expect(start).toHaveBeenCalledTimes(1);

    coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');
    resolveStart({ started: true });
    await flush();

    expect(runtime.restoreInputs).not.toHaveBeenCalled();
    expect(deliver).not.toHaveBeenCalled();
    expect(stop).toHaveBeenCalledTimes(1);
    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({ phase: 'failed' }));
  });

  it('captures every assistant text after the owned handoff request', async () => {
    const { coordinator, history, build } = makeHarness();
    history
      .mockResolvedValueOnce([{ role: 'assistant', id: 'before', content: 'old' }])
      .mockResolvedValueOnce([
        { role: 'assistant', id: 'handoff-1', content: 'first part' },
        { role: 'assistant', id: 'handoff-2', content: 'second part' },
        { role: 'assistant', id: 'tool', content: '' },
      ]);

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      agentHandoff: 'first part\n\nsecond part',
    }));
  });

  it('publishes bounded source text when the source ends with held inputs', () => {
    const { coordinator, runtime } = makeHarness();
    coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'a'.repeat(2_100) });

    coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');

    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
      phase: 'failed',
      lostInputCount: 1,
      lostInputTexts: ['a'.repeat(2_000)],
    }));
    expect(runtime.restoreInputs).not.toHaveBeenCalled();
  });

  describe('work-in-flight gate', () => {
    it('keeps an automatic handover waiting while a subagent runs and starts once it is done', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      const queue: QueuedSessionInput[] = [{ content: 'lane done' }];

      const waiting = coordinator.armAtTerminal('source', false, queue, true);

      expect(subagents).toHaveBeenCalledWith('source');
      expect(waiting).toEqual(expect.objectContaining({
        reason: 'budget-auto',
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 1, lanes: 0 },
        heldInputCount: 0,
      }));
      expect(queue).toEqual([{ content: 'lane done' }]);
      expect(coordinator.admitOrHold('source', { content: 'user' })).toEqual({ held: false });

      subagents.mockReturnValue(0);
      const armed = coordinator.armAtTerminal('source', false, [], true);

      expect(armed?.operationId).toBe(waiting?.operationId);
      expect(armed?.waitingFor).toBeUndefined();
      expect(coordinator.snapshotFor('source')).toEqual(
        expect.objectContaining({ phase: 'writing-handoff' }),
      );
    });

    it('waits for CLI lanes reported by the lane provider', () => {
      const { coordinator } = makeHarness();
      const provider = jest.fn().mockReturnValue(2);
      coordinator.setLaneWorkProvider(provider);

      expect(coordinator.armAtTerminal('source', false, [], true)).toEqual(
        expect.objectContaining({
          phase: 'waiting-for-turn-end',
          waitingFor: { subagents: 0, lanes: 2 },
        }),
      );
      expect(provider).toHaveBeenCalledWith({ sessionId: 'source', tabId: SOURCE.tabId });
    });

    it('treats a throwing lane provider as no lanes and warns once', () => {
      const { coordinator, logger } = makeHarness();
      coordinator.setLaneWorkProvider(() => {
        throw new Error('lane registry down');
      });

      coordinator.armAtTerminal('source', false, [], true);

      expect(coordinator.snapshotFor('source')).toEqual(
        expect.objectContaining({ phase: 'writing-handoff' }),
      );
      expect(logger.warn).toHaveBeenCalledTimes(1);
    });

    it('stops counting lanes once the provider is disposed', () => {
      const { coordinator } = makeHarness();
      const dispose = coordinator.setLaneWorkProvider(() => 3);
      dispose();

      coordinator.armAtTerminal('source', false, [], true);

      expect(coordinator.snapshotFor('source')).toEqual(
        expect.objectContaining({ phase: 'writing-handoff' }),
      );
    });

    it('does not gate the blocking limit, which the user confirms', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(2);

      expect(coordinator.armAtTerminal('source', true, [], true)).toEqual(
        expect.objectContaining({ reason: 'budget-limit', phase: 'awaiting-confirmation' }),
      );
    });
  });

  describe('one-click confirmation', () => {
    it('starts the handover from awaiting-confirmation on a single begin (R6)', () => {
      const { coordinator } = makeHarness();
      const limit = coordinator.armAtTerminal('source', true, [], false);
      expect(limit?.phase).toBe('awaiting-confirmation');

      expect(coordinator.begin('source', 'successor', false)).toEqual({
        accepted: true,
        state: expect.objectContaining({
          operationId: limit?.operationId,
          reason: 'budget-limit',
          phase: 'writing-handoff',
        }),
      });
    });

    it('starts a waiting automatic handover at once when the user confirms while idle', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      const waiting = coordinator.armAtTerminal('source', false, [], true);

      const result = coordinator.begin('source', 'successor', false);

      expect(result).toEqual({
        accepted: true,
        state: expect.objectContaining({
          operationId: waiting?.operationId,
          phase: 'writing-handoff',
        }),
      });
      expect(result.accepted && result.state.waitingFor).toBeFalsy();
    });

    it('remembers a mid-turn confirmation and starts at the next terminal despite work in flight', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      coordinator.armAtTerminal('source', false, [], true);

      const result = coordinator.begin('source', 'successor', true);
      expect(result).toEqual({
        accepted: true,
        state: expect.objectContaining({ phase: 'waiting-for-turn-end' }),
      });

      coordinator.armAtTerminal('source', false, [], true);

      expect(coordinator.snapshotFor('source')).toEqual(
        expect.objectContaining({ reason: 'budget-auto', phase: 'writing-handoff' }),
      );
    });
  });

  it('refuses begin with source-unavailable and creates nothing when the source is gone (R7)', () => {
    const { coordinator, runtime } = makeHarness();
    runtime.sourceSnapshot.mockReturnValue(undefined);

    expect(coordinator.begin('source', 'successor', false)).toEqual({
      accepted: false,
      error: 'source-unavailable',
    });
    expect(coordinator.snapshotFor('source')).toBeUndefined();
  });

  it('logs one INFO line for every published state', () => {
    const { coordinator, logger } = makeHarness();
    const changes: SessionHandoverState[] = [];
    coordinator.onStateChange((state) => changes.push(state));

    coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);

    expect(changes).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledTimes(changes.length);
    expect(logger.info).toHaveBeenLastCalledWith(
      '[SessionHandover] State published',
      expect.objectContaining({
        operationId: changes[1].operationId,
        reason: 'budget-limit',
        phase: 'awaiting-confirmation',
        heldInputCount: 0,
      }),
    );
  });

  it('asks the agent for the required handoff headings and forbids tools', () => {
    for (const heading of [
      'Goal',
      'Decisions',
      'Task folders',
      'Changed files',
      'Open items',
      'Still running',
      'Next action',
    ]) {
      expect(HANDOFF_REQUEST_PROMPT).toContain(`## ${heading}`);
    }
    expect(HANDOFF_REQUEST_PROMPT).toContain('subagents and CLI agent lanes');
    expect(HANDOFF_REQUEST_PROMPT).toContain('Do not call tools');
  });
});
