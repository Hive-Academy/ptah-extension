import { EventEmitter } from 'eventemitter3';
import { AgentId, type AgentProcessInfo } from '@ptah-extension/shared';
import { createLogger, laneInfo } from './__fixtures__/agent-message-harness';
import { LaneMessagePolicy, type VerifiedLaneSender } from './lane-message.policy';
import { LaneSenderRateLimiter } from './lane-sender-rate.limiter';

const SENDER = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000001');
const TARGET = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000002');
const WORKSPACE = 'ws-key-1';

function setup(
  senderPatch: Partial<AgentProcessInfo> = {},
  targetPatch: Partial<AgentProcessInfo> = {},
) {
  const lanes = new Map<string, AgentProcessInfo>([
    [SENDER, laneInfo(SENDER, { workingDirectory: '/repo/.worktrees/a', workspaceKey: WORKSPACE, ...senderPatch })],
    [TARGET, laneInfo(TARGET, { workingDirectory: '/repo/packages/b', workspaceKey: WORKSPACE, ...targetPatch })],
  ]);
  const events = new EventEmitter();
  const logger = createLogger();
  let now = 1_000_000;
  const limiter = new LaneSenderRateLimiter();
  const policy = new LaneMessagePolicy({
    findAgentInfo: (id) => lanes.get(id), events, logger, limiter, clock: () => now,
  });
  const target = (): AgentProcessInfo => {
    const info = lanes.get(TARGET);
    if (!info) throw new Error('missing target');
    return info;
  };
  return { lanes, events, logger, limiter, policy, target, tick: (ms: number) => { now += ms; } };
}

const bound = (patch: Partial<VerifiedLaneSender> = {}): VerifiedLaneSender => ({
  agentId: SENDER, workspaceRoot: '/repo/.worktrees/a', ...patch,
});

describe('LaneMessagePolicy', () => {
  it('allows siblings in different worktrees and subdirectories of the same workspace', () => {
    const { policy, target } = setup();
    const decision = policy.authorize(bound(), target(), 10);
    expect(decision).toMatchObject({ allowed: true, senderRecord: { agentId: SENDER } });
  });

  it('matches the binding root after normalization (trailing separator)', () => {
    const { policy, target } = setup();
    expect(policy.authorize(bound({ workspaceRoot: '/repo/.worktrees/a/' }), target(), 1).allowed).toBe(true);
  });

  it('denies a caller with no binding (a revoked token)', () => {
    const { policy, target } = setup();
    expect(policy.authorize(undefined, target(), 1)).toEqual({ allowed: false, reason: 'identity-missing' });
  });

  it('denies an unknown sender record', () => {
    const { policy, target } = setup();
    const ghost = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000009');
    expect(policy.authorize(bound({ agentId: ghost }), target(), 1)).toEqual({ allowed: false, reason: 'sender-unknown' });
  });

  it('denies a self-target', () => {
    const { policy, lanes } = setup();
    const self = lanes.get(SENDER);
    if (!self) throw new Error('missing sender');
    expect(policy.authorize(bound(), self, 1)).toEqual({ allowed: false, reason: 'self-target' });
  });

  it('denies a parentless sender or target', () => {
    const orphan = setup({ parentSessionId: undefined });
    expect(orphan.policy.authorize(bound(), orphan.target(), 1))
      .toEqual({ allowed: false, reason: 'parent-missing' });
    const parentless = setup({}, { parentSessionId: undefined });
    expect(parentless.policy.authorize(bound(), parentless.target(), 1))
      .toEqual({ allowed: false, reason: 'parent-missing' });
  });

  it('denies a different parent', () => {
    const { policy, target } = setup({}, { parentSessionId: 'parent-2' });
    expect(policy.authorize(bound(), target(), 1)).toEqual({ allowed: false, reason: 'different-parent' });
  });

  it('denies a binding without workspaceRoot and never falls back to the working directory', () => {
    const { policy, target } = setup();
    expect(policy.authorize({ agentId: SENDER }, target(), 1)).toEqual({ allowed: false, reason: 'workspace-missing' });
  });

  it('denies a binding root that does not match the sender record', () => {
    const { policy, target } = setup();
    expect(policy.authorize(bound({ workspaceRoot: '/repo/packages/b' }), target(), 1))
      .toEqual({ allowed: false, reason: 'workspace-missing' });
  });

  it('denies when either record lacks a workspaceKey', () => {
    const noSenderKey = setup({ workspaceKey: undefined });
    expect(noSenderKey.policy.authorize(bound(), noSenderKey.target(), 1))
      .toEqual({ allowed: false, reason: 'workspace-missing' });
    const noTargetKey = setup({}, { workspaceKey: undefined });
    expect(noTargetKey.policy.authorize(bound(), noTargetKey.target(), 1))
      .toEqual({ allowed: false, reason: 'workspace-missing' });
  });

  it('denies distinct workspaces even when one path contains the other', () => {
    const { policy, target } = setup(
      { workingDirectory: '/repo', workspaceKey: 'ws-key-1' },
      { workingDirectory: '/repo/nested', workspaceKey: 'ws-key-2' },
    );
    expect(policy.authorize(bound({ workspaceRoot: '/repo' }), target(), 1))
      .toEqual({ allowed: false, reason: 'different-workspace' });
  });

  it('denies the 11th send in 60 s, and a denied send does not count', () => {
    const { policy, target, tick } = setup();
    for (let i = 0; i < 10; i++) expect(policy.authorize(bound(), target(), 1).allowed).toBe(true);
    expect(policy.authorize(bound(), target(), 1)).toEqual({ allowed: false, reason: 'rate-limited' });
    tick(60_000);
    expect(policy.authorize(bound(), target(), 1).allowed).toBe(true);
  });

  it('denies a body over 32,768 chars without consuming the rate window', () => {
    const { policy, target, limiter } = setup();
    expect(policy.authorize(bound(), target(), 32_768).allowed).toBe(true);
    expect(policy.authorize(bound(), target(), 32_769)).toEqual({ allowed: false, reason: 'body-too-large' });
    expect(limiter.isLimited(SENDER, 1_000_000)).toBe(false);
  });

  it('logs denials with ids only', () => {
    const { policy, target, logger } = setup({}, { parentSessionId: 'parent-2' });
    policy.authorize(bound(), target(), 5);
    expect(logger.warn).toHaveBeenCalledWith('[LaneMessagePolicy] Lane-to-lane message denied', {
      reason: 'different-parent', senderAgentId: SENDER, targetAgentId: TARGET,
    });
  });

  it('drops the sender window on agent:expired and detaches on dispose', () => {
    const { policy, target, events, limiter } = setup();
    policy.authorize(bound(), target(), 1);
    expect(limiter.size).toBe(1);
    events.emit('agent:expired', { agentId: SENDER });
    expect(limiter.size).toBe(0);
    policy.dispose();
    expect(events.listenerCount('agent:expired')).toBe(0);
  });
});
