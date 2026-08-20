/**
 * Command-plane contracts (TASK_2026_156). Control commands terminate inside
 * messaging-gateway: they never emit an `inbound` event, never persist a
 * gateway message, and never queue an agent turn (AC-1.3, Data-6).
 *
 * `pick` values are UNTRUSTED strings — every handler re-derives the closed
 * candidate set server-side at execution time and resolves the pick by
 * membership only (SEC-1).
 */
import type { GatewayPlatform } from '../types';

export type GatewayCommand =
  | { kind: 'sessions' }
  | { kind: 'session-use'; pick: string }
  | { kind: 'new' }
  | { kind: 'workspace-list' }
  | { kind: 'workspace-use'; pick: string };

export interface GatewayCommandInvocation {
  platform: GatewayPlatform;
  /** Parent channel id (thread case) or channel id. */
  externalChatId: string;
  /** Present iff invoked inside a thread. */
  threadId?: string;
  /** Guild id — rate-limiting key (SEC-7). */
  allowListId?: string;
  command: GatewayCommand;
}

export interface GatewayCommandOutcome {
  /** Always set: list / error / confirmation echo (ephemeral, SEC-6). */
  ephemeralText: string;
  /** Set on successful mutation — adapter posts it to the thread (NFR-3). */
  publicText?: string;
}

export interface GatewayAutocompleteRequest {
  /** Needed to re-derive the binding server-side (SEC-5 gate on autocomplete). */
  platform: GatewayPlatform;
  externalChatId: string;
  threadId?: string;
  allowListId?: string;
  target: 'session-pick' | 'workspace-pick';
  /** Current focused text — untrusted, used only to filter the closed set. */
  query: string;
}

export interface IGatewayCommandHandler {
  handleCommand(inv: GatewayCommandInvocation): Promise<GatewayCommandOutcome>;
  handleAutocomplete(
    req: GatewayAutocompleteRequest,
  ): Promise<ReadonlyArray<{ name: string; value: string }>>;
}
