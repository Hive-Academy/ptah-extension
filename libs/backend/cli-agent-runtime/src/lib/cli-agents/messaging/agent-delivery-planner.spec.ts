import { AgentId, type AgentProcessInfo, type EffectiveLaneCapabilities } from '@ptah-extension/shared';
import { planAgentDelivery } from './agent-delivery-planner';

const agentId = AgentId.create();
const yes = { state: 'supported' } as const;
const no = { state: 'unsupported' } as const;
const info = { agentId, cli: 'codex', status: 'running', cliSessionId: 'session', task: 'work', workingDirectory: '.', startedAt: new Date().toISOString() } as AgentProcessInfo;
const caps: EffectiveLaneCapabilities = {
  agentId, resolvedAt: 1, source: 'live-handle', mcp: yes,
  messaging: { steer: yes, interrupt: yes, continuation: yes, resume: yes },
};

describe('planAgentDelivery', () => {
  it('queues a running turn without interrupting', () => {
    expect(planAgentDelivery({ agentId, info, delivery: 'queue', effectiveCapabilities: caps, hasLiveHandle: true }).mode)
      .toBe('queue-next-turn');
  });

  it('selects live steer regardless of CLI name', () => {
    const pi = { ...info, cli: 'pi' } as AgentProcessInfo;
    expect(planAgentDelivery({ agentId, info: pi, delivery: 'now', effectiveCapabilities: caps, hasLiveHandle: true }).mode)
      .toBe('steer');
  });

  it('discloses partial turn loss for interrupt fallback', () => {
    const preview = planAgentDelivery({ agentId, info, delivery: 'now', effectiveCapabilities: { ...caps, messaging: { ...caps.messaging, steer: no } }, hasLiveHandle: true });
    expect(preview.mode).toBe('interrupt-resume');
    expect(preview.lossDisclosure?.confirmationRequired).toBe(true);
  });

  it('resumes an idle released session for queue', () => {
    const preview = planAgentDelivery({ agentId, info: { ...info, status: 'completed' }, delivery: 'queue', effectiveCapabilities: caps, hasLiveHandle: false });
    expect(preview).toMatchObject({ mode: 'start-turn', usesResume: true });
  });

  it('releases an idle live handle without continuation before cold resume', () => {
    const preview = planAgentDelivery({ agentId, info: { ...info, status: 'completed' },
      delivery: 'queue', hasLiveHandle: true,
      effectiveCapabilities: { ...caps, messaging: { ...caps.messaging, continuation: no } },
    });
    expect(preview).toMatchObject({ mode: 'start-turn', usesResume: true, supported: true });
  });

});
