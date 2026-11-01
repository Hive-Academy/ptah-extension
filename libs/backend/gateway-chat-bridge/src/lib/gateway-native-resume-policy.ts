/**
 * Native Codex resume decisions for a gateway turn.
 *
 * `openStream` and `tryFallbackStart` stay on `GatewayChatBridge`. They share
 * the turn watchdog, the outbound buffer, and `pumpStream`. Moving those calls
 * would drag delivery and cancellation into this file. The predicates below
 * are the decisions those methods already made inline.
 */
import { isCodexChatAdapterError } from '@ptah-extension/agent-sdk';
import { isCodexResumeProfileChangedError } from '@ptah-extension/codex-runtime';
import type { SessionRuntimeIdentity } from '@ptah-extension/shared';

/**
 * Typed D14a refusal: the native error itself, its cause, or the adapter's
 * `resume-profile-changed` code. No name or message matching.
 */
export function isGatewayResumeProfileChanged(error: unknown): boolean {
  if (isCodexResumeProfileChangedError(error)) return true;
  if (error instanceof Error && isCodexResumeProfileChangedError(error.cause)) {
    return true;
  }
  return (
    isCodexChatAdapterError(error) && error.code === 'resume-profile-changed'
  );
}

/** A bound session whose persisted runtime is native Codex app-server. */
export function isNativeCodexBinding(
  identity: SessionRuntimeIdentity | undefined,
): boolean {
  return identity?.runtime === 'codex-app-server';
}

/**
 * D14a: a native binding whose resume was refused because the execution
 * profile changed gets the profile-changed reply and must not start over.
 */
export function isNativeResumeProfileRefusal(
  error: unknown,
  identity: SessionRuntimeIdentity | undefined,
): boolean {
  return (
    isNativeCodexBinding(identity) && isGatewayResumeProfileChanged(error)
  );
}
