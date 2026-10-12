import 'reflect-metadata';

import type { BeginSessionHandoverResult, SessionHandoverState } from '@ptah-extension/shared';
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
  readonly logger: { readonly info: jest.Mock; readonly warn: jest.Mock; readonly debug: jest.Mock };
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
  const logger = { info: jest.fn(), warn: jest.fn(), debug: jest.fn() };
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

function stateOf(result: BeginSessionHandoverResult): SessionHandoverState {
  if (!result.accepted) throw new Error(`begin refused: ${result.error}`);
  return result.state;
}

describe('SessionHandoverCoordinator', () => {
  it('is single-flight and transfers queued inputs in FIFO order', () => {
    const { coordinator } = makeHarness();
    const queue: QueuedSessionInput[] = [
      { content: 'first' },
      { content: 'second' },
    ];
    const first = coordinator.armAtTerminal('source', true, queue);
    const duplicate = coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'third' });

    expect(duplicate?.operationId).toBe(first?.operationId);
    expect(queue).toEqual([]);
    expect(coordinator.transferInputs('source').map((input) => input.content)).toEqual([
      'first',
      'second',
      'third',
    ]);
  });

  it('cancels before compaction and restores the FIFO in order exactly once', () => {
    const { coordinator, runtime } = makeHarness();
    const operation = coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'first' });
    coordinator.admitOrHold('source', { content: 'second' });

    expect(coordinator.cancel('source', operation?.operationId ?? '')).toEqual([
      { content: 'first' },
      { content: 'second' },
    ]);
    expect(runtime.restoreInputs).toHaveBeenCalledTimes(1);
    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [
      { content: 'first' },
      { content: 'second' },
    ]);
  });

  it('keeps every later input held while the limit is parked', () => {
    const { coordinator } = makeHarness();
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
    coordinator.begin('source', 'successor', true);
    coordinator.armAtTerminal('source', false, []);
    dispose();

    expect(changes.map((state) => state.phase)).toEqual([
      'waiting-for-turn-end',
      'writing-handoff',
    ]);
    expect(changes[1].revision).toBeGreaterThan(changes[0].revision);
  });

  it('creates, publishes and starts nothing at an idle terminal below the blocking limit (S1, S2)', async () => {
    const { coordinator, host, build, runtime } = makeHarness();
    const states: SessionHandoverState[] = [];
    coordinator.onStateChange((state) => states.push(state));
    const queue: QueuedSessionInput[] = [{ content: 'next' }];

    // The coordinator takes no stage: a live or authoritative handoff and a
    // non-blocking limit all reach it as a plain non-blocking terminal.
    expect(coordinator.armAtTerminal('source', false, queue)).toBeUndefined();
    await flush();

    expect(coordinator.snapshotFor('source')).toBeUndefined();
    expect(states).toEqual([]);
    expect(queue).toEqual([{ content: 'next' }]);
    expect(runtime.queueOwnedHandoff).not.toHaveBeenCalled();
    expect(build).not.toHaveBeenCalled();
    expect(host.startSuccessorSession).not.toHaveBeenCalled();
  });

  it('parks a fresh limit after a cancelled user handover only at the blocking limit', () => {
    const { coordinator, subagents } = makeHarness();
    subagents.mockReturnValue(1);
    const begun = coordinator.begin('source', 'successor', false);
    const operationId = begun.accepted ? begun.state.operationId : '';
    coordinator.cancel('source', operationId);

    expect(coordinator.armAtTerminal('source', false, [])).toBeUndefined();
    expect(coordinator.snapshotFor('source')?.phase).toBe('cancelled');
    const limit = coordinator.armAtTerminal('source', true, []);
    expect(limit).toEqual(
      expect.objectContaining({ reason: 'budget-limit', phase: 'awaiting-confirmation' }),
    );
    expect(limit?.operationId).not.toBe(operationId);
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
    const first = coordinator.armAtTerminal('source', true, []);
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
    const next = coordinator.begin('source', 'successor', false);
    expect(next.accepted && next.state.operationId).not.toBe(first?.operationId);
  });

  it('never restarts a failed user handover at a terminal', async () => {
    const { coordinator, write, host } = makeHarness();
    write.mockResolvedValueOnce({ path: null, writeError: 'disk' });

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();
    await flush();

    const failed = coordinator.snapshotFor('source');
    expect(failed).toEqual(expect.objectContaining({ reason: 'successor', phase: 'failed' }));
    expect(coordinator.armAtTerminal('source', false, [])).toBeUndefined();
    expect(coordinator.snapshotFor('source')).toEqual(failed);
    expect(host.startSuccessorSession).not.toHaveBeenCalled();
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
        { role: 'assistant', id: 'before', content: 'old' },
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

  it('uses only the last assistant message when a compaction trimmed the request anchor (M3)', async () => {
    const { coordinator, history, build, logger } = makeHarness();
    history
      .mockResolvedValueOnce([{ role: 'assistant', id: 'before', content: 'old' }])
      .mockResolvedValueOnce([
        { role: 'assistant', id: 'summary', content: 'stale pre-request text' },
        { role: 'assistant', id: 'handoff', content: 'real handoff' },
        { role: 'assistant', id: 'tool', content: '' },
      ]);

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      agentHandoff: 'real handoff',
    }));
    expect(logger.debug).toHaveBeenCalledTimes(1);
  });

  it('uses every assistant message when none preceded the request', async () => {
    const { coordinator, history, build, logger } = makeHarness();
    history
      .mockResolvedValueOnce([{ role: 'user', id: 'u1', content: 'hi' }])
      .mockResolvedValueOnce([
        { role: 'assistant', id: 'handoff-1', content: 'first part' },
        { role: 'assistant', id: 'handoff-2', content: 'second part' },
      ]);

    coordinator.begin('source', 'successor', false);
    await flush();
    await flush();

    expect(build).toHaveBeenCalledWith(expect.objectContaining({
      agentHandoff: 'first part\n\nsecond part',
    }));
    expect(logger.debug).not.toHaveBeenCalled();
  });

  it('publishes bounded source text when the source ends with held inputs', () => {
    const { coordinator, runtime } = makeHarness();
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

  describe('user-started work-in-flight gate', () => {
    it('waits with counts, keeps waiting while work runs, and starts at a terminal with none (S7)', () => {
      const { coordinator, subagents, host } = makeHarness();
      subagents.mockReturnValue(1);
      const provider = jest.fn().mockReturnValue(1);
      coordinator.setLaneWorkProvider(provider);

      const waiting = stateOf(coordinator.begin('source', 'successor', false));

      expect(waiting).toEqual(expect.objectContaining({
        reason: 'successor',
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 1, lanes: 1 },
        heldInputCount: 0,
      }));
      expect(provider).toHaveBeenCalledWith({ sessionId: 'source', tabId: SOURCE.tabId });

      const queue: QueuedSessionInput[] = [{ content: 'lane done' }];
      const still = coordinator.armAtTerminal('source', false, queue);
      expect(still).toEqual(expect.objectContaining({
        operationId: waiting.operationId,
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 1, lanes: 1 },
      }));
      // A waiting op holds nothing: completion turns reach the source.
      expect(queue).toEqual([{ content: 'lane done' }]);

      subagents.mockReturnValue(0);
      provider.mockReturnValue(0);
      coordinator.armAtTerminal('source', false, []);

      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        operationId: waiting.operationId,
        phase: 'writing-handoff',
      }));
      expect(coordinator.snapshotFor('source')?.waitingFor).toBeUndefined();
      expect(host.startSuccessorSession).not.toHaveBeenCalled();
    });

    it('returns a waiting op unchanged on a repeat begin (double-click, S7)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      const first = stateOf(coordinator.begin('source', 'successor', true));
      const states: SessionHandoverState[] = [];
      coordinator.onStateChange((state) => states.push(state));

      const repeat = stateOf(coordinator.begin('source', 'successor', true));

      expect(repeat).toEqual(first);
      expect(states).toEqual([]);
    });

    it('refreshes only the counts on a repeat begin while work changes (S7)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(2);
      const first = stateOf(coordinator.begin('source', 'successor', true));
      subagents.mockReturnValue(1);

      const repeat = stateOf(coordinator.begin('source', 'successor', true));

      expect(repeat).toEqual(expect.objectContaining({
        operationId: first.operationId,
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 1, lanes: 0 },
      }));
    });

    it('waits across terminals without a bound or escalation (D6 removed)', () => {
      const { coordinator, subagents, logger, host } = makeHarness();
      subagents.mockReturnValue(1);
      const waiting = stateOf(coordinator.begin('source', 'successor', false));

      for (let terminal = 0; terminal < 5; terminal += 1) {
        coordinator.armAtTerminal('source', false, []);
      }

      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        operationId: waiting.operationId,
        phase: 'waiting-for-turn-end',
      }));
      expect(logger.warn).not.toHaveBeenCalled();
      expect(host.startSuccessorSession).not.toHaveBeenCalled();
    });

    it('starts at once with continueNow while idle despite work (S8)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);

      expect(stateOf(coordinator.begin('source', 'successor', false, undefined, { continueNow: true })))
        .toEqual(expect.objectContaining({ phase: 'writing-handoff' }));
    });

    it('forces a mid-turn continueNow so the next terminal starts despite work (S8)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      const waiting = stateOf(coordinator.begin('source', 'successor', true));

      const forced = stateOf(coordinator.begin('source', 'successor', true, undefined, { continueNow: true }));
      expect(forced).toEqual(expect.objectContaining({
        operationId: waiting.operationId,
        phase: 'waiting-for-turn-end',
      }));

      coordinator.armAtTerminal('source', false, []);

      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        operationId: waiting.operationId,
        phase: 'writing-handoff',
      }));
    });

    it('keeps waiting on unknown lanes, warns once, and starts on a readable zero (S22)', () => {
      const { coordinator, logger } = makeHarness();
      let lanesDown = true;
      coordinator.setLaneWorkProvider(() => {
        if (lanesDown) throw new Error('lane registry down');
        return 0;
      });

      const waiting = stateOf(coordinator.begin('source', 'successor', false));
      expect(waiting).toEqual(expect.objectContaining({
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 0, lanes: null },
      }));

      coordinator.armAtTerminal('source', false, []);
      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 0, lanes: null },
      }));
      expect(logger.warn).toHaveBeenCalledTimes(1);
      expect(logger.warn).toHaveBeenCalledWith(
        '[SessionHandover] Lane work provider failed; lane status unknown',
        expect.objectContaining({ operationId: waiting.operationId, error: 'lane registry down' }),
      );

      lanesDown = false;
      coordinator.armAtTerminal('source', false, []);
      expect(coordinator.snapshotFor('source')?.phase).toBe('writing-handoff');
    });

    it('starts with continueNow while lane status is unknown (S22)', () => {
      const { coordinator } = makeHarness();
      coordinator.setLaneWorkProvider(() => {
        throw new Error('lane registry down');
      });
      coordinator.begin('source', 'successor', false);

      expect(stateOf(coordinator.begin('source', 'successor', false, undefined, { continueNow: true })))
        .toEqual(expect.objectContaining({ phase: 'writing-handoff' }));
    });

    it('stops counting lanes once the provider is disposed', () => {
      const { coordinator } = makeHarness();
      const dispose = coordinator.setLaneWorkProvider(() => 3);
      dispose();

      expect(stateOf(coordinator.begin('source', 'successor', false)).phase).toBe('writing-handoff');
    });

    it('gates a begin on the parked limit and keeps its held inputs (S11)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(2);
      const limit = coordinator.armAtTerminal('source', true, [{ content: 'held' }]);
      expect(limit).toEqual(expect.objectContaining({ reason: 'budget-limit', phase: 'awaiting-confirmation' }));

      expect(stateOf(coordinator.begin('source', 'successor', false))).toEqual(expect.objectContaining({
        operationId: limit?.operationId,
        reason: 'budget-limit',
        phase: 'waiting-for-turn-end',
        heldInputCount: 1,
        waitingFor: { subagents: 2, lanes: 0 },
      }));
    });

    it('starts the parked limit on a single begin while idle with no work (R6)', () => {
      const { coordinator } = makeHarness();
      const limit = coordinator.armAtTerminal('source', true, []);

      expect(coordinator.begin('source', 'successor', false)).toEqual({
        accepted: true,
        state: expect.objectContaining({
          operationId: limit?.operationId,
          reason: 'budget-limit',
          phase: 'writing-handoff',
        }),
      });
    });

    it('returns an op in progress unchanged on a repeat begin', () => {
      const { coordinator, build } = makeHarness();
      build.mockReturnValueOnce(new Promise(() => undefined));
      const started = stateOf(coordinator.begin('source', 'successor', false));

      expect(stateOf(coordinator.begin('source', 'successor', false))).toEqual(started);
    });
  });

  describe('holding the source (Decision 6)', () => {
    it('does not hold sends or Stop during a user-started wait (S10, S23)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      coordinator.begin('source', 'successor', true);

      expect(coordinator.admitOrHold('source', { content: 'user' })).toEqual({ held: false });
      expect(coordinator.admitInterrupt('source')).toEqual({ held: false });
      expect(coordinator.transferInputs('source')).toEqual([]);
    });

    it('does not hold sends or Stop during an agent request (S10, S15)', () => {
      const { coordinator } = makeHarness();
      coordinator.requestFromAgent('source');

      expect(coordinator.admitOrHold('source', { content: 'user' })).toEqual({ held: false });
      expect(coordinator.admitInterrupt('source')).toEqual({ held: false });
    });

    it('holds Stop while the limit is parked or the handover runs', () => {
      const { coordinator } = makeHarness();
      const limit = coordinator.armAtTerminal('source', true, []);

      expect(coordinator.admitInterrupt('source')).toEqual({
        held: true,
        operationId: limit?.operationId,
      });
    });
  });

  describe('agent-requested successor (D23)', () => {
    it('parks a successor for the user and never confirms, gates or starts it (S15)', async () => {
      const { coordinator, host, build, runtime, subagents, logger } = makeHarness();
      subagents.mockReturnValue(1);

      const requested = stateOf(coordinator.requestFromAgent('source', 'agent notes'));
      await flush();

      expect(requested).toEqual(expect.objectContaining({
        reason: 'successor',
        phase: 'awaiting-confirmation',
        requestedBy: 'agent',
        heldInputCount: 0,
      }));
      expect(requested.waitingFor).toBeUndefined();
      expect(subagents).not.toHaveBeenCalled();
      expect(runtime.queueOwnedHandoff).not.toHaveBeenCalled();
      expect(build).not.toHaveBeenCalled();
      expect(host.startSuccessorSession).not.toHaveBeenCalled();
      expect(logger.info).toHaveBeenCalledWith(
        '[SessionHandover] Agent requested a successor for source',
        expect.objectContaining({ operationId: requested.operationId }),
      );
    });

    it('leaves the request parked at a non-blocking terminal and holds nothing (S15)', () => {
      const { coordinator } = makeHarness();
      const requested = stateOf(coordinator.requestFromAgent('source'));
      const states: SessionHandoverState[] = [];
      coordinator.onStateChange((state) => states.push(state));
      const queue: QueuedSessionInput[] = [{ content: 'user' }];

      expect(coordinator.armAtTerminal('source', false, queue)).toEqual(requested);
      expect(queue).toEqual([{ content: 'user' }]);
      expect(states).toEqual([]);
    });

    it('returns a live op unchanged and creates nothing (S15)', () => {
      const { coordinator, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      const user = stateOf(coordinator.begin('source', 'successor', true));

      expect(stateOf(coordinator.requestFromAgent('source', 'agent notes'))).toEqual(user);
      expect(coordinator.snapshotFor('source')?.requestedBy).toBeUndefined();
    });

    it('applies the begin guards (S15)', () => {
      const noHost = new SessionHandoverCoordinator(null, null, null);
      expect(noHost.requestFromAgent('source')).toEqual({ accepted: false, error: 'unavailable' });
      expect(noHost.snapshotFor('source')).toBeUndefined();

      const { coordinator, runtime } = makeHarness();
      runtime.sourceSnapshot.mockReturnValue(undefined);
      expect(coordinator.requestFromAgent('source')).toEqual({
        accepted: false,
        error: 'source-unavailable',
      });
      expect(coordinator.snapshotFor('source')).toBeUndefined();
    });

    it('waits on approval with work, then starts with the agent handoff (S16)', async () => {
      const { coordinator, subagents, build, runtime } = makeHarness();
      const requested = stateOf(coordinator.requestFromAgent('source', 'agent notes'));
      subagents.mockReturnValue(1);

      const approved = stateOf(coordinator.begin('source', 'successor', false));
      expect(approved).toEqual(expect.objectContaining({
        operationId: requested.operationId,
        reason: 'successor',
        phase: 'waiting-for-turn-end',
        waitingFor: { subagents: 1, lanes: 0 },
      }));
      expect(approved.requestedBy).toBeUndefined();

      subagents.mockReturnValue(0);
      coordinator.armAtTerminal('source', false, []);
      await flush();
      await flush();

      expect(runtime.queueOwnedHandoff).not.toHaveBeenCalled();
      expect(build).toHaveBeenCalledWith(expect.objectContaining({ agentHandoff: 'agent notes' }));
    });

    it('starts an approved request at once while idle with no work (S16)', () => {
      const { coordinator } = makeHarness();
      const requested = stateOf(coordinator.requestFromAgent('source'));

      expect(stateOf(coordinator.begin('source', 'successor', false))).toEqual(expect.objectContaining({
        operationId: requested.operationId,
        phase: 'writing-handoff',
      }));
    });

    it('turns the request into the holding limit park at a blocking terminal (S16)', async () => {
      const { coordinator, host, build } = makeHarness();
      const requested = stateOf(coordinator.requestFromAgent('source', 'agent notes'));
      const queue: QueuedSessionInput[] = [{ content: 'user' }];

      const parked = coordinator.armAtTerminal('source', true, queue);
      await flush();

      expect(parked).toEqual(expect.objectContaining({
        operationId: requested.operationId,
        reason: 'budget-limit',
        phase: 'awaiting-confirmation',
        heldInputCount: 1,
      }));
      expect(parked?.requestedBy).toBeUndefined();
      expect(queue).toEqual([]);
      expect(coordinator.admitOrHold('source', { content: 'later' }).held).toBe(true);
      expect(host.startSuccessorSession).not.toHaveBeenCalled();

      coordinator.begin('source', 'successor', false);
      await flush();
      await flush();
      expect(build).toHaveBeenCalledWith(expect.objectContaining({ agentHandoff: 'agent notes' }));
    });
  });

  describe('captured composer text is a draft (D24)', () => {
    function expectDraftNeverRestored(runtime: Harness['runtime'], draft: string): void {
      for (const [, inputs] of runtime.restoreInputs.mock.calls) {
        expect(inputs.map((input) => input.content)).not.toContain(draft);
      }
    }

    it('returns the draft on a cancel before the turn ends and never holds it (S19)', () => {
      const { coordinator, runtime } = makeHarness();
      const waiting = stateOf(coordinator.begin('source', 'successor', true, undefined, { queuedInput: 'my draft' }));
      expect(waiting.heldInputCount).toBe(0);
      expect(waiting.draftText).toBeUndefined();

      expect(coordinator.cancel('source', waiting.operationId)).toEqual([]);

      const cancelled = coordinator.snapshotFor('source');
      expect(cancelled).toEqual(expect.objectContaining({
        phase: 'cancelled',
        heldInputCount: 0,
        draftText: 'my draft',
      }));
      expect(cancelled?.waitingFor).toBeUndefined();
      expect(runtime.restoreInputs).not.toHaveBeenCalled();
    });

    it('appends a second capture after a blank line', () => {
      const { coordinator, runtime } = makeHarness();
      const waiting = stateOf(coordinator.begin('source', 'successor', true, undefined, { queuedInput: 'one' }));
      coordinator.begin('source', 'successor', true, undefined, { queuedInput: 'two' });

      coordinator.cancel('source', waiting.operationId);

      expect(coordinator.snapshotFor('source')?.draftText).toBe('one\n\ntwo');
      expect(runtime.restoreInputs).not.toHaveBeenCalled();
    });

    it('returns the draft on a cancel while writing the handoff (S19)', () => {
      const { coordinator, runtime, build } = makeHarness();
      build.mockReturnValueOnce(new Promise(() => undefined));
      const waiting = stateOf(coordinator.begin('source', 'successor', true, undefined, { queuedInput: 'my draft' }));
      coordinator.armAtTerminal('source', false, [{ content: 'queued' }]);
      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        phase: 'writing-handoff',
        heldInputCount: 1,
      }));

      coordinator.cancel('source', waiting.operationId);

      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        phase: 'cancelled',
        draftText: 'my draft',
      }));
      expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'queued' }]);
      expectDraftNeverRestored(runtime, 'my draft');
    });

    it('restores the parked limit inputs and returns the draft separately (S9, S19)', () => {
      const { coordinator, runtime, subagents } = makeHarness();
      const limit = coordinator.armAtTerminal('source', true, [{ content: 'held' }]);
      subagents.mockReturnValue(1);
      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'my draft' });

      expect(coordinator.cancel('source', limit?.operationId ?? '')).toEqual([{ content: 'held' }]);

      expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'held' }]);
      expectDraftNeverRestored(runtime, 'my draft');
      const cancelled = coordinator.snapshotFor('source');
      expect(cancelled).toEqual(expect.objectContaining({ phase: 'cancelled', draftText: 'my draft' }));
      expect(cancelled?.waitingFor).toBeUndefined();
    });

    it('returns the draft when the handover fails (S19)', async () => {
      const { coordinator, runtime, write } = makeHarness();
      write.mockResolvedValueOnce({ path: null, writeError: 'disk' });
      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'my draft' });
      coordinator.admitOrHold('source', { content: 'held' });
      await flush();
      await flush();

      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        phase: 'failed',
        draftText: 'my draft',
      }));
      expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'held' }]);
      expectDraftNeverRestored(runtime, 'my draft');
    });

    it('returns the draft when delivery fails after the draft batch (S19)', async () => {
      const { coordinator, runtime, host } = makeHarness();
      host.stopSuccessorSession = jest.fn().mockResolvedValue(undefined);
      host.deliverTransferInputs.mockResolvedValueOnce({ delivered: false, error: 'delivery' });
      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'my draft' });
      coordinator.admitOrHold('source', { content: 'held' });
      await flush();
      await flush();
      await flush();

      expect(host.deliverTransferInputs).toHaveBeenCalledWith(expect.any(String), [
        { content: 'held' },
        { content: 'my draft', admission: 'require-idle' },
      ]);
      expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
        phase: 'failed',
        draftText: 'my draft',
      }));
      expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'held' }]);
      expectDraftNeverRestored(runtime, 'my draft');
    });

    it('returns the draft when the source ends (S19)', () => {
      const { coordinator, runtime, subagents } = makeHarness();
      subagents.mockReturnValue(1);
      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'my draft' });

      coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');

      const failed = coordinator.snapshotFor('source');
      expect(failed).toEqual(expect.objectContaining({ phase: 'failed', draftText: 'my draft' }));
      expect(failed?.waitingFor).toBeUndefined();
      expect(runtime.restoreInputs).not.toHaveBeenCalled();
    });

    it('delivers the draft last in the first batch and drops it at closing (S19)', async () => {
      const { coordinator, runtime, host } = makeHarness();
      const states: SessionHandoverState[] = [];
      coordinator.onStateChange((state) => states.push(state));
      coordinator.armAtTerminal('source', true, [{ content: 'held' }]);

      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'my draft' });
      await flush();
      await flush();
      await flush();

      expect(host.deliverTransferInputs).toHaveBeenCalledTimes(1);
      expect(host.deliverTransferInputs).toHaveBeenCalledWith(expect.any(String), [
        { content: 'held' },
        { content: 'my draft', admission: 'require-idle' },
      ]);
      expect(coordinator.snapshotFor('source')?.phase).toBe('closed');
      expect(states.every((state) => state.draftText === undefined)).toBe(true);
      expect(runtime.restoreInputs).not.toHaveBeenCalled();
    });

    it('delivers a draft captured during delivery in the next batch', async () => {
      const { coordinator, host } = makeHarness();
      host.deliverTransferInputs.mockImplementationOnce(async () => {
        coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'late' });
        return { delivered: true };
      });
      coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'first' });
      await flush();
      await flush();
      await flush();

      expect(host.deliverTransferInputs).toHaveBeenNthCalledWith(1, expect.any(String), [
        { content: 'first', admission: 'require-idle' },
      ]);
      expect(host.deliverTransferInputs).toHaveBeenNthCalledWith(2, expect.any(String), [
        { content: 'late', admission: 'require-idle' },
      ]);
      expect(coordinator.snapshotFor('source')?.phase).toBe('closed');
    });

    it('reports draftCaptured only when the op took the composer text', async () => {
      const { coordinator, host } = makeHarness();
      host.startSuccessorSession.mockReturnValueOnce(new Promise(() => undefined));

      expect(coordinator.begin('source', 'successor', true)).not.toHaveProperty('draftCaptured');
      const waiting = coordinator.begin('source', 'successor', true, undefined, { queuedInput: 'one' });
      expect(waiting).toEqual(expect.objectContaining({ accepted: true, draftCaptured: true }));

      coordinator.armAtTerminal('source', false, []);
      await flush();
      await flush();
      expect(coordinator.snapshotFor('source')?.phase).toBe('starting-successor');

      const starting = coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'two' });
      expect(starting).toEqual(expect.objectContaining({ accepted: true, draftCaptured: true }));
    });

    it('never takes or claims the composer text at closing (Finding 2)', async () => {
      const { coordinator, runtime, host, logger } = makeHarness();
      runtime.closeIfTokenMatches.mockReturnValue(new Promise(() => undefined));
      coordinator.begin('source', 'successor', false);
      await flush();
      await flush();
      await flush();
      expect(coordinator.snapshotFor('source')?.phase).toBe('closing');

      const result = coordinator.begin('source', 'successor', false, undefined, { queuedInput: 'late' });

      expect(result.accepted).toBe(true);
      expect(result.accepted && result.draftCaptured).toBeFalsy();
      expect(coordinator.snapshotFor('source')?.draftText).toBeUndefined();
      expect(logger.warn).toHaveBeenCalledWith(
        expect.stringContaining('Draft not captured'),
        expect.any(Object),
      );
      expect(host.deliverTransferInputs).toHaveBeenCalledTimes(1);
      expect(host.deliverTransferInputs.mock.calls[0][1]).not.toContainEqual(
        expect.objectContaining({ content: 'late' }),
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
    const { coordinator, logger, subagents } = makeHarness();
    subagents.mockReturnValue(1);
    const changes: SessionHandoverState[] = [];
    coordinator.onStateChange((state) => changes.push(state));

    coordinator.armAtTerminal('source', true, []);
    coordinator.begin('source', 'successor', false);

    expect(changes).toHaveLength(2);
    expect(logger.info).toHaveBeenCalledTimes(changes.length);
    expect(logger.info).toHaveBeenLastCalledWith(
      '[SessionHandover] State published',
      expect.objectContaining({
        operationId: changes[1].operationId,
        reason: 'budget-limit',
        phase: 'waiting-for-turn-end',
        heldInputCount: 0,
        waitingFor: { subagents: 1, lanes: 0 },
      }),
    );
  });

  it('asks the agent for the required handoff headings and forbids tools', () => {
    let previous = -1;
    for (const heading of [
      'Goal',
      'Decisions',
      'Task folders',
      'Changed files',
      'Open items',
      'Still running',
      'Next action',
    ]) {
      const at = HANDOFF_REQUEST_PROMPT.indexOf(`## ${heading}`);
      expect(at).toBeGreaterThan(previous);
      previous = at;
    }
    expect(HANDOFF_REQUEST_PROMPT).toContain('subagents and CLI agent lanes');
    const lengthLine = HANDOFF_REQUEST_PROMPT.indexOf('Keep the whole handoff under 5,000 characters.');
    expect(lengthLine).toBeGreaterThan(previous);
    expect(lengthLine).toBeLessThan(HANDOFF_REQUEST_PROMPT.indexOf('Do not call tools'));
  });
});
