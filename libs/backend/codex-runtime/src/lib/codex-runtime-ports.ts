import type { IDisposable } from '@ptah-extension/platform-core';
import type {
  CodexApprovalDecision,
  CodexApprovalRequest,
  CodexThreadIdentity,
} from './codex-runtime.types';
// Reuse the platform boundary; do not introduce a competing spawner interface.
export type { IProcessSpawner } from '@ptah-extension/platform-core';
/** Portable pin identity. Diagnostic developer paths are deliberately excluded. */
export interface CodexExecutableManifestRow {
  readonly platform: string;
  readonly arch: string;
  readonly pinnedVersion: string;
  readonly version: string;
  readonly binarySha256: string;
  readonly schemaSha256: string;
}
/** Composition supplies the bundled executable and the reviewed expected pin. */
export interface CodexExecutableSource {
  readonly resolvedPath: string;
  readonly expectedManifestRow: CodexExecutableManifestRow;
}
export interface ApprovalSink {
  /** Abort removes the presentation; it must never imply authorization. */
  request(
    request: CodexApprovalRequest,
    signal: AbortSignal,
  ): Promise<
    | CodexApprovalDecision
    | { readonly decision: 'decline'; readonly editNotSupported: true }
  >;
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
