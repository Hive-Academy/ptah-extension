import { MESSAGE_TYPES, type SurfaceUpdatedPayload } from '@ptah-extension/shared';
import {
  createDashboardBroadcast,
  type DashboardDeliveryOutcome,
  type DashboardSurfaceHost,
} from '../code-execution/namespace-builders/dashboard-namespace.builder';

/** Resolves the host lazily so late registration and host replacement are visible. */
export interface SurfacePushHostProvider {
  getHost(): DashboardSurfaceHost | undefined;
}

/**
 * Delivers an already committed change and reports transport failure without
 * throwing. Delivery has no access to state and never rolls a commit back.
 */
export function pushSurfaceChange(
  provider: SurfacePushHostProvider,
  logger: { debug(msg: string): void },
  payload: SurfaceUpdatedPayload,
): Promise<DashboardDeliveryOutcome> {
  return createDashboardBroadcast(() => provider.getHost(), logger)(
    MESSAGE_TYPES.SURFACE_UPDATED,
    payload,
  );
}
