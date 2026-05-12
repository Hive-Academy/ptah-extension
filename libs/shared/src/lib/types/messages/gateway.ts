import type { GatewayStatusResult } from '../rpc.types';

/**
 * Payload for MESSAGE_TYPES.GATEWAY_STATUS_CHANGED ('gateway:statusChanged').
 *
 * Emitted by the backend after any adapter start/stop/error state change.
 * The `origin` field enables frontend self-echo suppression for user-initiated
 * enable/disable actions.
 *
 * Convention:
 *   origin === null   → state change from boot, crash, or external trigger; receiver MUST apply
 *   origin === string → user-initiated (gateway:start / gateway:stop RPC); receiver SHOULD drop if owns token
 */
export interface GatewayStatusChangedPayload {
  status: GatewayStatusResult;
  origin: string | null;
}
