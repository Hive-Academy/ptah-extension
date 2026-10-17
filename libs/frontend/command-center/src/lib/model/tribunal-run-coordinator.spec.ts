import { TestBed } from '@angular/core/testing';
import { CommandCenterRecordsService } from '@ptah-extension/chat-state';
import {
  CONFIRMED_DISCOVERY_ANSWER,
  CONFIRM_FAILURE_MESSAGES,
  TribunalRunCoordinator,
  type ProposalTransport,
} from './tribunal-run-coordinator';
import type { ProposalAvailability } from './tribunal-roster-proposal';

const lane = {
  laneId: 'codex#1',
  family: 'codex',
  displayName: 'Codex',
  cli: 'codex',
};
const base = {
  proposalId: 'p1',
  nonce: 'n1',
  rootSessionId: 'root',
  move: 'council',
  options: ['Decline', 'Confirm'],
  objective: 'Review',
  rounds: 1,
  lanes: [lane],
};
const relay = {
  ...base,
  move: 'relay',
  lanes: [
    { ...lane, role: 'plan' },
    { ...lane, laneId: 'codex#2', role: 'architect' },
    { ...lane, laneId: 'codex#3', role: 'implement' },
    {
      ...lane,
      laneId: 'copilot#1',
      family: 'copilot',
      cli: 'copilot',
      role: 'review',
    },
  ],
};
const payload = (value: unknown): string =>
  `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify(value)}</TRIBUNAL_ROSTER_PROPOSAL>`;
const availability: ProposalAvailability = {
  lanes: [
    { laneId: 'codex#1', family: 'codex', cli: 'codex', state: 'READY' },
    { laneId: 'codex#2', family: 'codex', cli: 'codex', state: 'READY' },
    { laneId: 'codex#3', family: 'codex', cli: 'codex', state: 'READY' },
    { laneId: 'copilot#1', family: 'copilot', cli: 'copilot', state: 'READY' },
  ],
  disabledClis: [],
};
const context = {
  questionId: 'q1',
  questionKey: 'roster',
  rootSdkId: 'root',
  rootTabId: 'tab',
  workspace: '/repo',
  nonce: 'n1',
  availability,
};
const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

describe('TribunalRunCoordinator', () => {
  let transport: jest.Mocked<ProposalTransport>;
  let coordinator: TribunalRunCoordinator;
  beforeEach(() => {
    transport = {
      answer: jest.fn(() => true),
      availability: jest.fn(() => availability),
      discoveryComplete: jest.fn(async () => undefined),
      createTask: jest.fn(async () => 'TASK_1'),
      writeManifest: jest.fn(() => true),
      removeManifest: jest.fn(() => true),
      sendLaunchTurn: jest.fn(async () => true),
      reportFailure: jest.fn(),
    };
    coordinator = new TribunalRunCoordinator(transport);
  });
  const receive = (
    coordinator: TribunalRunCoordinator,
    value: unknown = base,
  ) => coordinator.receive(payload(value), context);

  it('answers with fixed text and launches once after the manifest is written', async () => {
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.answer).toHaveBeenCalledWith(
      'q1',
      'roster',
      CONFIRMED_DISCOVERY_ANSWER,
    );
    expect(transport.answer.mock.calls[0][2]).not.toMatch(
      /confirm|yes|approve|proceed/i,
    );
    expect(transport.writeManifest.mock.invocationCallOrder[0]).toBeLessThan(
      transport.sendLaunchTurn.mock.invocationCallOrder[0],
    );
    expect((await coordinator.confirm('p1')).ok).toBe(false);
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
  });
  it('writes a role-less Council manifest through the real records service', async () => {
    const memory = new Map<string, string>();
    const get = jest
      .spyOn(Storage.prototype, 'getItem')
      .mockImplementation((key) => memory.get(key) ?? null);
    const set = jest
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation((key, value) => {
        memory.set(key, value);
      });
    try {
      const records = TestBed.inject(CommandCenterRecordsService);
      transport.writeManifest.mockImplementation((workspace, manifest) =>
        records.writeRunManifest(workspace, manifest),
      );
      receive(coordinator);
      expect(await coordinator.confirm('p1')).toEqual({ ok: true });
      expect(records.readRunManifests('/repo', 'tab')[0].lanes).toEqual([
        { laneId: 'codex#1' },
      ]);
    } finally {
      get.mockRestore();
      set.mockRestore();
    }
  });
  it('keeps a Relay task across a failed manifest write and retry', async () => {
    transport.writeManifest.mockReturnValueOnce(false);
    receive(coordinator, relay);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'manifest-write-failed',
      retryable: true,
    });
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.createTask).toHaveBeenCalledTimes(1);
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
    expect(transport.writeManifest.mock.calls[0][1].runId).toBe(
      transport.writeManifest.mock.calls[1][1].runId,
    );
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('retries launch after discovery without awaiting another terminal pulse', async () => {
    transport.sendLaunchTurn.mockResolvedValueOnce(false);
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'launch-send-failed',
      retryable: true,
    });
    transport.discoveryComplete.mockImplementation(() => {
      throw new Error('No second terminal pulse');
    });
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.discoveryComplete).toHaveBeenCalledTimes(1);
    expect(transport.answer).toHaveBeenCalledTimes(1);
  });
  it('rolls back a failed send and reuses its run ID', async () => {
    transport.sendLaunchTurn.mockResolvedValueOnce(false);
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'launch-send-failed',
      retryable: true,
    });
    expect(transport.removeManifest).toHaveBeenCalledWith(
      '/repo',
      transport.writeManifest.mock.calls[0][1].runId,
    );
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.writeManifest.mock.calls[1][1].runId).toBe(
      transport.writeManifest.mock.calls[0][1].runId,
    );
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('keeps open when neither answer nor Decline is delivered', async () => {
    transport.answer.mockReturnValueOnce(false).mockReturnValueOnce(false);
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'answer-undelivered',
      retryable: true,
    });
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('declines the second question for a duplicate pending ID', async () => {
    receive(coordinator);
    expect(
      coordinator.receive(payload(base), { ...context, questionId: 'q2' }),
    ).toBeNull();
    expect(transport.answer).toHaveBeenCalledWith('q2', 'roster', 'Decline');
    expect(await coordinator.confirm('p1')).toEqual({ ok: true });
    expect(transport.answer).toHaveBeenCalledWith(
      'q1',
      'roster',
      CONFIRMED_DISCOVERY_ANSWER,
    );
  });
  it('declines when a CLI is disabled at confirm time', async () => {
    receive(coordinator);
    transport.availability.mockReturnValue({
      ...availability,
      disabledClis: ['codex'],
    });
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'lanes-unavailable',
      retryable: false,
    });
    expect(transport.answer).toHaveBeenCalledWith('q1', 'roster', 'Decline');
    expect(transport.reportFailure).toHaveBeenCalledWith(
      CONFIRM_FAILURE_MESSAGES['lanes-unavailable'],
    );
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('reports discovery and task failures exactly once per result', async () => {
    transport.discoveryComplete.mockRejectedValueOnce(new Error('secret'));
    receive(coordinator, relay);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'discovery-failed',
      retryable: true,
    });
    transport.createTask.mockResolvedValueOnce(null);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'task-create-failed',
      retryable: true,
    });
    expect(transport.reportFailure.mock.calls).toEqual([
      [CONFIRM_FAILURE_MESSAGES['discovery-failed']],
      [CONFIRM_FAILURE_MESSAGES['task-create-failed']],
    ]);
  });
  it('shares an in-flight confirm and sends only one launch turn', async () => {
    let finish: (() => void) | undefined;
    transport.discoveryComplete.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
    );
    receive(coordinator);
    const first = coordinator.confirm('p1');
    const second = coordinator.confirm('p1');
    expect(second).toBe(first);
    finish?.();
    expect(await first).toEqual({ ok: true });
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
  });
  it('declines after an undelivered answer when fallback is delivered', async () => {
    transport.answer.mockReturnValueOnce(false);
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'answer-undelivered',
      retryable: false,
    });
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('revalidates after discovery and reports a changed roster', async () => {
    receive(coordinator);
    transport.discoveryComplete.mockImplementation(async () => {
      transport.availability.mockReturnValue({
        ...availability,
        disabledClis: ['codex'],
      });
    });
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'not-launchable',
      retryable: false,
    });
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('does not decline an answered proposal on page exit', async () => {
    transport.writeManifest.mockReturnValueOnce(false);
    receive(coordinator);
    await coordinator.confirm('p1');
    coordinator.pageExit();
    expect(transport.answer).toHaveBeenCalledTimes(1);
  });
  it('cancels during discovery without writing or sending', async () => {
    const discovery = deferred<void>();
    transport.discoveryComplete.mockReturnValue(discovery.promise);
    receive(coordinator);
    const result = coordinator.confirm('p1');
    coordinator.pageExit();
    discovery.resolve(undefined);
    expect(await result).toEqual({
      ok: false,
      reason: 'cancelled',
      retryable: false,
    });
    expect(transport.writeManifest).not.toHaveBeenCalled();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
    expect(transport.answer).toHaveBeenCalledTimes(1);
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
    expect(transport.reportFailure).toHaveBeenCalledWith(
      CONFIRM_FAILURE_MESSAGES.cancelled,
    );
  });
  it('reports cancellation when discovery rejects after page exit', async () => {
    const discovery = deferred<void>();
    transport.discoveryComplete.mockReturnValue(discovery.promise);
    receive(coordinator);
    const result = coordinator.confirm('p1');
    coordinator.pageExit();
    discovery.reject(new Error('discovery failed'));
    expect(await result).toEqual({
      ok: false,
      reason: 'cancelled',
      retryable: false,
    });
    expect(transport.writeManifest).not.toHaveBeenCalled();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
  });
  it('cancels a Relay while task creation is pending', async () => {
    const task = deferred<string | null>();
    transport.createTask.mockReturnValue(task.promise);
    receive(coordinator, relay);
    const result = coordinator.confirm('p1');
    await Promise.resolve();
    expect(transport.createTask).toHaveBeenCalledTimes(1);
    coordinator.pageExit();
    task.resolve('TASK_1');
    expect(await result).toEqual({
      ok: false,
      reason: 'cancelled',
      retryable: false,
    });
    expect(transport.writeManifest).not.toHaveBeenCalled();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('removes the earlier run after a retry is cancelled during launch', async () => {
    transport.sendLaunchTurn.mockResolvedValueOnce(false);
    receive(coordinator);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'launch-send-failed',
      retryable: true,
    });
    const runId = transport.writeManifest.mock.calls[0][1].runId;
    const send = deferred<boolean>();
    transport.sendLaunchTurn.mockReturnValue(send.promise);
    const retry = coordinator.confirm('p1');
    await Promise.resolve();
    coordinator.pageExit();
    send.resolve(false);
    expect(await retry).toEqual({
      ok: false,
      reason: 'cancelled',
      retryable: false,
    });
    expect(transport.removeManifest).toHaveBeenCalledTimes(2);
    expect(transport.removeManifest).toHaveBeenNthCalledWith(2, '/repo', runId);
    expect(transport.writeManifest).toHaveBeenCalledTimes(2);
  });
  it('rolls back and consumes a cancelled send that returns false', async () => {
    const send = deferred<boolean>();
    transport.sendLaunchTurn.mockReturnValue(send.promise);
    receive(coordinator);
    const result = coordinator.confirm('p1');
    await Promise.resolve();
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
    const runId = transport.writeManifest.mock.calls[0][1].runId;
    coordinator.pageExit();
    send.resolve(false);
    expect(await result).toEqual({
      ok: false,
      reason: 'cancelled',
      retryable: false,
    });
    expect(transport.removeManifest).toHaveBeenCalledWith('/repo', runId);
    expect(transport.reportFailure).toHaveBeenCalledTimes(1);
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'not-launchable',
      retryable: false,
    });
  });
  it('keeps a successful send launched after page exit', async () => {
    const send = deferred<boolean>();
    transport.sendLaunchTurn.mockReturnValue(send.promise);
    receive(coordinator);
    const result = coordinator.confirm('p1');
    await Promise.resolve();
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
    coordinator.pageExit();
    send.resolve(true);
    expect(await result).toEqual({ ok: true });
    expect(transport.removeManifest).not.toHaveBeenCalled();
    expect(await coordinator.confirm('p1')).toEqual({
      ok: false,
      reason: 'not-launchable',
      retryable: false,
    });
  });
  it('declines invalid and timed-out cards without launching', () => {
    expect(
      receive(coordinator, { ...base, options: ['Confirm', 'Decline'] }),
    ).toBeNull();
    receive(coordinator);
    coordinator.timeout('p1');
    expect(transport.answer).toHaveBeenLastCalledWith(
      'q1',
      'roster',
      'Decline',
    );
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
});
