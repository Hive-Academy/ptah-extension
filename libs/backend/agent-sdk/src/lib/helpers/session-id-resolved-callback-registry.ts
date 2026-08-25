/**
 * SessionIdResolvedCallbackRegistry — fan-out registry fired the instant a
 * session's canonical SDK UUID becomes known (TASK_2026_296 item 6, Part B).
 *
 * ## Why a twelfth registry and not a wider port
 *
 * `IAgentAdapter.setSessionIdResolvedCallback` (`agent-adapter.types.ts:253`)
 * is a SINGLE-SLOT setter on the shared adapter port, backed by
 * `SdkAdapterCallbackRegistry` and already consumed by `cli-agent-runtime`
 * (`wiring/sdk-callbacks.ts`). Promoting that setter into a fan-out would be a
 * breaking port change for no gain, so this registry is added ALONGSIDE it:
 * `SdkAgentAdapter` notifies both from the same two emit sites, and the setter
 * keeps its exact previous behaviour.
 *
 * ## What subscribers do with it
 *
 * Before the SDK's system `init` message lands there is no UUID, so anything
 * the adapter reports is keyed by the **tabId** — and a tabId is itself a
 * UUID v4 (`TabId.create()`), so no consumer can tell the two apart by
 * inspection. `SdkAgentAdapter` buffers the dominant emitter (Part A), but a
 * hook payload that genuinely lacks `session_id` still falls back to the
 * tabId-bearing hook closure. This registry is the reconciliation signal for
 * that residual: `MemoryTriggerService` and `SkillTriggerService` subscribe and
 * migrate their keyed state from the tabId to the UUID.
 *
 * Subscribers MUST treat the handler as synchronous — see `rekeySession` on
 * both trigger services.
 *
 * Shaped like every other SDK callback registry: `register()` returns a
 * disposer, `size` reports the subscriber count, and `notifyAll` dispatches
 * synchronously with a per-callback try/catch so one bad subscriber cannot
 * break the SDK or another subscriber. That behaviour lives in
 * {@link CallbackRegistryBase}, which is the extracted form of
 * `CompactionCallbackRegistry`'s shape and what the 8–11 registries both
 * trigger services already consume are built on.
 */
import { injectable, inject } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  CallbackRegistryBase,
  type CallbackRegistryCallback,
} from './callback-registry.base';

export interface SessionIdResolvedPayload {
  /**
   * The id state may have been armed under before the resolve — the tabId.
   * `undefined` when the query carried no tabId, in which case there is
   * nothing to reconcile and subscribers must no-op.
   *
   * Mirrors the first argument of
   * `SdkAdapterCallbackRegistry.emitSessionIdResolved`, deliberately: this
   * registry is a fan-out twin of that single-slot call, not a new contract.
   */
  readonly tabId: string | undefined;
  /** The canonical SDK session UUID from the system `init` message. */
  readonly realSessionId: string;
  readonly timestamp: number;
}

export type SessionIdResolvedRegistryCallback =
  CallbackRegistryCallback<SessionIdResolvedPayload>;

@injectable()
export class SessionIdResolvedCallbackRegistry extends CallbackRegistryBase<SessionIdResolvedPayload> {
  constructor(@inject(TOKENS.LOGGER) logger: Logger) {
    super(logger, 'SessionIdResolvedCallbackRegistry');
  }
}
