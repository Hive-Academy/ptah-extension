import { TribunalRunCoordinator, CONFIRMED_DISCOVERY_ANSWER, type ProposalTransport } from './tribunal-run-coordinator';

const base = { proposalId: 'p1', nonce: 'n1', rootSessionId: 'root', move: 'council', options: ['Decline', 'Confirm'], objective: 'Review', rounds: 1, lanes: [{ laneId: 'codex#1', family: 'codex', displayName: 'Codex', cli: 'codex' }] };
const payload = (value: unknown): string => `<TRIBUNAL_ROSTER_PROPOSAL>${JSON.stringify(value)}</TRIBUNAL_ROSTER_PROPOSAL>`;
const context = { questionId: 'q1', questionKey: 'roster', rootSdkId: 'root', rootTabId: 'tab', workspace: '/repo', nonce: 'n1' };
describe('TribunalRunCoordinator', () => {
  let transport: jest.Mocked<ProposalTransport>;
  let coordinator: TribunalRunCoordinator;
  beforeEach(() => {
    transport = {
      answer: jest.fn<ReturnType<ProposalTransport['answer']>, Parameters<ProposalTransport['answer']>>(() => true),
      discoveryComplete: jest.fn<ReturnType<ProposalTransport['discoveryComplete']>, Parameters<ProposalTransport['discoveryComplete']>>(async () => undefined),
      createTask: jest.fn<ReturnType<ProposalTransport['createTask']>, Parameters<ProposalTransport['createTask']>>(async () => 'TASK_1'),
      writeManifest: jest.fn<ReturnType<ProposalTransport['writeManifest']>, Parameters<ProposalTransport['writeManifest']>>(() => true),
      sendLaunchTurn: jest.fn<ReturnType<ProposalTransport['sendLaunchTurn']>, Parameters<ProposalTransport['sendLaunchTurn']>>(async () => true),
    };
    coordinator = new TribunalRunCoordinator(transport);
  });
  it('delivers only the fixed non affirmative answer and launches once after registration', async () => {
    coordinator.receive(payload(base), context);
    expect(await coordinator.confirm('p1')).toBe(true);
    expect(transport.answer).toHaveBeenCalledWith('q1', 'roster', CONFIRMED_DISCOVERY_ANSWER);
    expect(transport.answer.mock.calls[0][2]).not.toBe('Confirm');
    expect(transport.writeManifest.mock.invocationCallOrder[0]).toBeLessThan(transport.sendLaunchTurn.mock.invocationCallOrder[0]);
    expect(await coordinator.confirm('p1')).toBe(false);
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(1);
  });
  it('declines invalid and timed out proposals', () => {
    expect(coordinator.receive(payload({ ...base, options: ['Confirm', 'Decline'] }), context)).toBeNull();
    coordinator.receive(payload(base), context);
    coordinator.timeout('p1');
    expect(transport.answer).toHaveBeenLastCalledWith('q1', 'roster', 'Decline');
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('does not register a discovery turn spawn, and waits for completion', async () => {
    let release: (() => void) | undefined;
    transport.discoveryComplete.mockReturnValue(new Promise<void>((resolve) => { release = resolve; }));
    coordinator.receive(payload(base), context);
    const launch = coordinator.confirm('p1');
    expect(transport.writeManifest).not.toHaveBeenCalled();
    release?.();
    expect(await launch).toBe(true);
  });
  it('holds launch when registration fails', async () => {
    transport.writeManifest.mockReturnValue(false);
    coordinator.receive(payload(base), context);
    expect(await coordinator.confirm('p1')).toBe(false);
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('declines non-delivery and a replayed proposal', async () => {
    transport.answer.mockReturnValueOnce(false);
    coordinator.receive(payload(base), context);
    expect(await coordinator.confirm('p1')).toBe(false);
    expect(transport.answer).toHaveBeenLastCalledWith('q1', 'roster', 'Decline');
    expect(coordinator.receive(payload(base), context)).toBeNull();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
  it('keeps two proposal IDs independent', async () => {
    coordinator.receive(payload(base), context);
    coordinator.receive(payload({ ...base, proposalId: 'p2' }), { ...context, questionId: 'q2' });
    expect(await coordinator.confirm('p1')).toBe(true);
    expect(await coordinator.confirm('p2')).toBe(true);
    expect(transport.sendLaunchTurn).toHaveBeenCalledTimes(2);
  });
  it('revalidates a copy if the card mutates its returned proposal', async () => {
    const proposal = coordinator.receive(payload(base), context);
    proposal?.lanes.splice(0);
    expect(await coordinator.confirm('p1')).toBe(true);
  });
  it('withholds a role run when the spec folder cannot be allocated', async () => {
    transport.createTask.mockResolvedValue(null);
    const relay = { ...base, move: 'relay', lanes: [
      { ...base.lanes[0], role: 'plan' }, { ...base.lanes[0], laneId: 'codex#2', role: 'architect' },
      { ...base.lanes[0], laneId: 'codex#3', role: 'implement' }, { ...base.lanes[0], laneId: 'copilot#1', family: 'copilot', cli: 'copilot', role: 'review' },
    ] };
    coordinator.receive(payload(relay), context);
    expect(await coordinator.confirm('p1')).toBe(false);
    expect(transport.writeManifest).not.toHaveBeenCalled();
    expect(transport.sendLaunchTurn).not.toHaveBeenCalled();
  });
});
