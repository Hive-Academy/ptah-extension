import 'reflect-metadata';

import type { SessionHandoverState } from '@ptah-extension/shared';

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
  const runtime: jest.Mocked<SessionHandoverRuntime> = {
    sourceSnapshot: jest.fn().mockReturnValue(SOURCE),
    queueOwnedHandoff: jest.fn().mockResolvedValue(undefined),
    restoreInputs: jest.fn().mockReturnValue(true),
    closeIfTokenMatches: jest.fn().mockResolvedValue(options.close ?? true),
    isOwnedHandoffPendingOrRunning: jest.fn().mockReturnValue(false),
  };
  const history = jest.fn().mockResolvedValue([]);
  const coordinator = new SessionHandoverCoordinator(
    { build } as unknown as SessionHandoffBuilder,
    { write } as unknown as SessionHandoffWriter,
    {
      readHistoryForCuration: history,
    } as unknown as SessionHistoryReaderService,
    () => host,
  );
  coordinator.attachRuntime(runtime);
  return { coordinator, host, runtime, build, write, history };
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

  it('restores held input when the source ends and allows a new operation', () => {
    const { coordinator, runtime } = makeHarness();
    const first = coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'keep me' });

    coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');

    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'keep me' }]);
    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({ phase: 'failed' }));
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

  it('restores once and never delivers when the source ends during successor startup', async () => {
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

    expect(runtime.restoreInputs).toHaveBeenCalledTimes(1);
    expect(runtime.restoreInputs).toHaveBeenCalledWith('source', [{ content: 'keep me' }]);
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

  it('publishes bounded source text when held inputs cannot be restored', () => {
    const { coordinator, runtime } = makeHarness();
    runtime.restoreInputs.mockReturnValue(false);
    coordinator.request('source', 'budget-limit', false);
    coordinator.armAtTerminal('source', true, []);
    coordinator.admitOrHold('source', { content: 'a'.repeat(2_100) });

    coordinator.sourceEnded('source', SOURCE.token, 'stream stopped');

    expect(coordinator.snapshotFor('source')).toEqual(expect.objectContaining({
      phase: 'failed',
      lostInputCount: 1,
      lostInputTexts: ['a'.repeat(2_000)],
    }));
  });
});
