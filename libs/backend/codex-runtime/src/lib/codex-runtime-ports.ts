import type { IDisposable } from '@ptah-extension/platform-core';
import type { CodexExecutableSelection } from './select-codex-executable';
import type {
  CodexApprovalOutcome,
  CodexApprovalRequest,
  CodexThreadIdentity,
} from './codex-runtime.types';
// Reuse the platform boundary; do not introduce a competing spawner interface.
export type { IProcessSpawner } from '@ptah-extension/platform-core';
/** Active selection supplied by the host-scoped snapshot. */
export type CodexExecutableSource = CodexExecutableSelection;
export interface ApprovalSink {
  /** Abort removes the presentation; it must never imply authorization. */
  request(
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ): Promise<CodexApprovalOutcome>;
}
export interface CodexThreadIdentityStore {
  /** Must commit before the first turn; rejects if persistence fails. */
  persist(identity: CodexThreadIdentity): Promise<void>;
  /** Compare the complete identity before marking inactive, preserving newer generations. */
  markInactive(identity: CodexThreadIdentity): Promise<void>;
  /** Retains inactive identities for explicit resume; active metadata is not liveness proof. */
  read(contextId: string): Promise<CodexThreadIdentity | undefined>;
}
export interface Clock {
  /** Unix epoch milliseconds. */
  now(): number;
  /** Disposing cancels the callback; all lifecycle exits must dispose the handle. */
  setTimeout(callback: () => void, delayMs: number): IDisposable;
}
/** Supply sanitized messages and metadata, never protocol payloads or secrets. */
export interface CodexRuntimeLogger {
  debug(
    message: string,
    metadata?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  info(
    message: string,
    metadata?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  warn(
    message: string,
    metadata?: Readonly<Record<string, string | number | boolean>>,
  ): void;
  error(
    message: string,
    metadata?: Readonly<Record<string, string | number | boolean>>,
  ): void;
}
