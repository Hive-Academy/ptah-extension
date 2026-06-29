import type {
  GatewayBindingDto,
  GatewayPlatformId,
  GatewayStatusResult,
} from '../rpc.types';

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

/**
 * Payload for MESSAGE_TYPES.GATEWAY_SESSION_ATTACHED ('gateway:sessionAttached').
 *
 * Emitted by the backend after `gateway:attachSession` links an existing Ptah
 * SDK session to an approved binding. The renderer uses this to flip the
 * matching session tab to read-only (the bridge becomes the sole driver).
 */
export interface GatewaySessionAttachedPayload {
  bindingId: string;
  sessionUuid: string;
  platform: GatewayPlatformId;
}

/**
 * Payload for MESSAGE_TYPES.GATEWAY_SESSION_DETACHED ('gateway:sessionDetached').
 *
 * Emitted by the backend after `gateway:detachSession` clears a binding's
 * session link. The renderer restores the session tab to a writable state.
 */
export interface GatewaySessionDetachedPayload {
  bindingId: string;
  sessionUuid: string;
}
