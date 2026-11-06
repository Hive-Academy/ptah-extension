import type { AgentMessageDelivery, AgentMessagePreview, AgentProcessInfo, EffectiveLaneCapabilities } from '@ptah-extension/shared';

export interface AgentDeliveryPlanInput {
  readonly agentId: AgentMessagePreview['agentId'];
  readonly delivery: AgentMessageDelivery;
  readonly info?: AgentProcessInfo;
  readonly effectiveCapabilities: EffectiveLaneCapabilities;
  readonly hasLiveHandle: boolean;
}

/** Pure plan used for both preview and the send-time recheck. */
export function planAgentDelivery(input: AgentDeliveryPlanInput): AgentMessagePreview {
  const { agentId, delivery, info, effectiveCapabilities, hasLiveHandle } = input;
  const messaging = effectiveCapabilities.messaging;
  const has = (key: keyof typeof messaging) => messaging[key].state === 'supported';
  const base = { agentId, delivery, effectiveCapabilities };
  const refuse = (reason: string): AgentMessagePreview => ({ ...base, mode: 'unsupported', supported: false, usesResume: false, reason });
  if (!info) return refuse('Agent record is unavailable.');
  const running = info.status === 'running';
  const cold = !hasLiveHandle;
  if (cold) {
    if (!info.cliSessionId || !has('resume')) return refuse('No resumable session is available.');
    if (delivery === 'now') return refuse('This lane has no active turn to steer. Resume it as a new turn.');
    return { ...base, mode: 'start-turn', supported: true, usesResume: true };
  }
  if (delivery === 'queue') {
    if (!has('continuation')) return refuse('The live handle cannot start another turn.');
    return { ...base, mode: running ? 'queue-next-turn' : 'start-turn', supported: true, usesResume: false };
  }
  if (!running) return refuse('There is no active turn to steer.');
  if (has('steer')) return { ...base, mode: 'steer', supported: true, usesResume: false };
  if (has('interrupt') && has('continuation')) return {
    ...base, mode: 'interrupt-resume', supported: true, usesResume: false,
    lossDisclosure: { kind: 'partial-turn-work-lost', confirmationRequired: true, text: 'Interrupting discards unfinished work from the current turn.' },
  };
  return refuse('The live handle cannot steer or interrupt and continue this turn.');
}
