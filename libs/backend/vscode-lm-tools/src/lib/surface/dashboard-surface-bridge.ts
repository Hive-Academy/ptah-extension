import type { DashboardBroadcast } from '../code-execution/namespace-builders/dashboard-namespace.builder';
import type { SurfaceStateService } from './surface-state.service';

/** Route v1 proposals through the same scoped store and push as v2. */
export function createDashboardSurfaceBridge(
  service: Pick<SurfaceStateService, 'recordV1Proposal'>,
): DashboardBroadcast {
  return async (_type, payload) => {
    if (!payload.sessionId) return { status: 'no-surface' };
    const result = service.recordV1Proposal(
      payload.sessionId,
      payload.spec,
      payload.toolCallId,
    );
    if (result.status === 'applied') return result.delivery;
    // Storage was refused before any delivery; this is not a transport failure.
    return {
      status: 'refused',
      reason: result.detail,
    };
  };
}
