import type {
  AgentMessagePreview,
  AgentMessagePreviewRequest,
} from '@ptah-extension/shared';
import type { AgentProcessManager } from '../agent-process-manager.service';
import type { CliDetectionService } from '../cli-detection.service';
import { resolveEffectiveLaneCapabilities } from './agent-effective-capabilities';
import { planAgentDelivery } from './agent-delivery-planner';

/** Stable refusal code: the agent record exists but has no capability manifest. */
export const CAPABILITY_METADATA_UNAVAILABLE = 'capability_metadata_unavailable';

export type PreviewManager = Pick<AgentProcessManager, 'findAgentInfo' | 'getMessageRoutableAgent'>;

/** Plan one delivery against the lane's current record and live handle. */
export function previewAgentMessage(
  manager: PreviewManager,
  detection: Pick<CliDetectionService, 'getAdapter'>,
  request: AgentMessagePreviewRequest,
): AgentMessagePreview {
  const info = manager.findAgentInfo(request.agentId);
  const tracked = manager.getMessageRoutableAgent(request.agentId);
  const manifest = info?.potentialCapabilities ?? (info && detection.getAdapter(info.cli)?.capabilities());
  if (!manifest || !info) {
    // No record → `not_found`. A record without a capability manifest (e.g. a
    // restored lane whose adapter is not registered) exists, so say so.
    const reason = info ? CAPABILITY_METADATA_UNAVAILABLE : 'not_found';
    const unavailable = { state: 'unsupported' as const, reason };
    const delivery = request.delivery ?? 'queue';
    const effectiveCapabilities = {
      agentId: request.agentId, resolvedAt: Date.now(), source: 'restored-record' as const,
      messaging: { steer: unavailable, interrupt: unavailable, continuation: unavailable, resume: unavailable },
      mcp: unavailable,
    };
    if (info)
      return { agentId: request.agentId, delivery, effectiveCapabilities, mode: 'unsupported', supported: false, usesResume: false, reason };
    return planAgentDelivery({ agentId: request.agentId, delivery, info, hasLiveHandle: false, effectiveCapabilities });
  }
  const live = Boolean(tracked?.sdkHandle && !tracked.subprocessReleased && !tracked.restored);
  return planAgentDelivery({
    agentId: request.agentId, delivery: request.delivery ?? 'queue', info,
    hasLiveHandle: live,
    effectiveCapabilities: resolveEffectiveLaneCapabilities(info, manifest, tracked?.sdkHandle, !live),
  });
}
