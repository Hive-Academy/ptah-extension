/**
 * Host-owned surface state (plan Component 10). `SurfaceStateService` is the
 * only public entry; the store, ledger, reader, commit pipeline and mutation
 * planners stay internal to this folder (facade rule).
 */
export {
  SurfaceStateService,
  SURFACE_STATE_SERVICE_OPTIONS,
  type SurfaceStateServiceOptions,
  type SurfaceSubmitBegin,
  type SurfaceActionResolution,
} from './surface-state.service';
export type { SurfaceOperationStatusResult } from './surface-operation-gate';
export type {
  SurfaceAgentOperation,
  SurfaceAgentRejectReason,
  SurfaceAgentUpdateResult,
} from './surface-agent-mutations';
export type {
  SurfaceChangeRequest,
  SurfaceSelectRequest,
  SurfaceSubmitRequest,
  SurfaceMutationOutcome,
  SurfaceSubmitTicket,
  SurfaceSubmitDispatchOutcome,
} from './surface-ui-mutations';
export type {
  SurfaceStoreReadResult,
  SurfaceAgentReadResult,
} from './surface-state-reader';
export type { SurfacePushHostProvider } from './surface-push';
export { createDashboardSurfaceBridge } from './dashboard-surface-bridge';
