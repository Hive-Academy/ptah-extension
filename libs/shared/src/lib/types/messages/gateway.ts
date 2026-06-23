import type { GatewayBindingDto, GatewayStatusResult } from '../rpc.types';

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

/**
 * Payload for MESSAGE_TYPES.GATEWAY_BINDINGS_CHANGED ('gateway:bindingsChanged').
 *
 * Emitted by the backend whenever the bindings list changes — most importantly
 * when an inbound message creates a new pending binding (pairing request), but
 * also on approve / reject / revoke. Carries the full public binding list
 * (pairing codes stripped) so the renderer can replace its signal without an
 * extra round-trip.
 */
export interface GatewayBindingsChangedPayload {
  bindings: GatewayBindingDto[];
}
