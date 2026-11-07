/**
 * Lane-to-lane messaging through the coordinator (Component 15, P3-J): the
 * policy runs only for lane senders, a denial persists nothing, the recorded
 * sender comes from the verified binding, and status is scoped per viewer.
 */
import { AgentId, type AgentMessageSender } from '@ptah-extension/shared';
import { AgentMessageError } from '../agent-message-router.service';
import { AgentMessageCoordinator } from './agent-message-coordinator.service';
import { LaneMessagePolicy, type VerifiedLaneSender } from './lane-message.policy';
import { harness, idOf } from './__fixtures__/agent-message-harness';

const WS = 'ws-key-1';

function setup(withPolicy = true) {
  const h = harness();
  h.coordinator.dispose();
  h.setInfo({ workingDirectory: '/repo/packages/target', workspaceKey: WS });
  const senderId = AgentId.create();
  h.addLane(senderId, { workingDirectory: '/repo/.worktrees/sender', workspaceKey: WS, ptahCliName: 'Builder' });
  const policy = new LaneMessagePolicy({
    findAgentInfo: (id) => h.manager.findAgentInfo(id), events: h.events, logger: h.logger,
  });
  const authorize = jest.spyOn(policy, 'authorize');
  const coordinator = new AgentMessageCoordinator({
    manager: h.manager, detection: h.detection, store: h.store, aliases: h.aliases, resume: h.resume,
    scheduler: h.scheduler, ack: h.ack, logger: h.logger, ...(withPolicy ? { lanePolicy: policy } : {}),
  });
  const laneSender = (id: AgentId = senderId): AgentMessageSender => ({ kind: 'lane', agentId: id, verified: true });
  const binding = (patch: Partial<VerifiedLaneSender> = {}): VerifiedLaneSender => ({
    agentId: senderId, workspaceRoot: '/repo/.worktrees/sender', ...patch,
  });
  const persisted = (): number => h.storage.states().size;
  return { h, senderId, coordinator, authorize, laneSender, binding, persisted };
}

describe('AgentMessageCoordinator — lane to lane', () => {
  it('delivers a sibling message attributed to the verified sender lane', async () => {
    const { h, senderId, coordinator, laneSender, binding } = setup();
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'hello sibling' }, laneSender(), binding());
    expect(outcome.mode).toBe('queue-next-turn');
    expect(outcome.receipt).toMatchObject({ sender: 'lane', senderAgentId: senderId, senderVerified: true });
    const text = h.sendToAgent.mock.calls[0][1];
    expect(text.split('\n')[0]).toBe(`[Ptah message ${idOf(outcome)} from lane "Builder" (agent ${senderId})]`);
  });

  it.each([
    ['an unverified lane sender', (s: ReturnType<typeof setup>) =>
      [{ kind: 'lane', agentId: s.senderId, verified: false } as const, s.binding()] as const],
    ['a lane sender without a binding (revoked token)', (s: ReturnType<typeof setup>) =>
      [s.laneSender(), undefined] as const],
    ['a sender field that names another lane than the binding (spoofed)', (s: ReturnType<typeof setup>) =>
      [s.laneSender(AgentId.create()), s.binding()] as const],
  ])('refuses %s as identity-missing and persists nothing', async (_label, args) => {
    const s = setup();
    const [sender, laneBinding] = args(s);
    const outcome = await s.coordinator.send({ agentId: s.h.agentId, message: 'x' }, sender, laneBinding);
    expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'identity-missing' });
    expect(outcome.messageId).toBeUndefined();
    expect(s.persisted()).toBe(0);
    expect(s.authorize).not.toHaveBeenCalled();
    expect(s.h.sendToAgent).not.toHaveBeenCalled();
  });

  it.each([
    ['different-parent', { parentSessionId: 'parent-2' }],
    ['different-workspace', { workspaceKey: 'ws-key-2' }],
    ['workspace-missing', { workspaceKey: undefined }],
  ] as const)('denies %s with no body-bearing envelope', async (reason, targetPatch) => {
    const { h, coordinator, laneSender, binding, persisted } = setup();
    h.setInfo(targetPatch);
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'x' }, laneSender(), binding());
    expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: reason });
    expect(persisted()).toBe(0);
    expect(h.sendToAgent).not.toHaveBeenCalled();
  });

  it('denies a lane body over 32,768 chars', async () => {
    const { h, coordinator, laneSender, binding, persisted } = setup();
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'a'.repeat(32_769) }, laneSender(), binding());
    expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'body-too-large' });
    expect(persisted()).toBe(0);
  });

  it('rate-limits the 11th lane send in a minute', async () => {
    const { h, coordinator, laneSender, binding } = setup();
    for (let i = 0; i < 10; i++) {
      expect((await coordinator.send({ agentId: h.agentId, message: `m${i}` }, laneSender(), binding())).mode)
        .toBe('queue-next-turn');
    }
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'm10' }, laneSender(), binding());
    expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'rate-limited' });
  });

  it('refuses every lane send when no policy is wired', async () => {
    const { h, coordinator, laneSender, binding, persisted } = setup(false);
    const outcome = await coordinator.send({ agentId: h.agentId, message: 'x' }, laneSender(), binding());
    expect(outcome).toMatchObject({ mode: 'unsupported', reasonCode: 'delivery-refused' });
    expect(persisted()).toBe(0);
  });

  it('leaves parent and user sends to the existing path', async () => {
    const { h, coordinator, authorize } = setup();
    expect((await coordinator.send({ agentId: h.agentId, message: 'p' }, { kind: 'parent', sessionId: 'parent-1' })).mode)
      .toBe('queue-next-turn');
    expect((await coordinator.send({ agentId: h.agentId, message: 'u' }, { kind: 'user' })).mode)
      .toBe('queue-next-turn');
    expect(authorize).not.toHaveBeenCalled();
  });

  describe('status scoping', () => {
    it('shows the message to the sender and the target, and not_found to a third lane', async () => {
      const { h, senderId, coordinator, laneSender, binding } = setup();
      const id = idOf(await coordinator.send({ agentId: h.agentId, message: 'hi' }, laneSender(), binding()));
      await expect(coordinator.getReceipt(h.agentId, id, laneSender(senderId))).resolves.toMatchObject({ id });
      await expect(coordinator.getReceipt(h.agentId, id, laneSender(h.agentId))).resolves.toMatchObject({ id });
      const third = AgentId.create();
      h.addLane(third, { workspaceKey: WS });
      const denied = coordinator.getReceipt(h.agentId, id, laneSender(third));
      await expect(denied).rejects.toBeInstanceOf(AgentMessageError);
      await expect(denied).rejects.toMatchObject({ code: 'not_found' });
    });

    it('does not widen an unverified lane viewer', async () => {
      const { h, coordinator, laneSender, binding } = setup();
      const id = idOf(await coordinator.send({ agentId: h.agentId, message: 'hi' }, laneSender(), binding()));
      await expect(coordinator.getReceipt(h.agentId, id, { kind: 'lane', agentId: h.agentId, verified: false }))
        .rejects.toMatchObject({ code: 'not_found' });
    });
  });
});
