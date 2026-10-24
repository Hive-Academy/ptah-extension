import type { IDisposable } from '@ptah-extension/platform-core';
import type { CodexUsageEligibility } from './codex-account-usage.types';
/** Credential-free invalidation event, scoped to a normalized home. */
export interface CodexHomeAuthEvent {
  readonly home: string;
  readonly generation: number;
  readonly kind: 'changed' | 'removed' | 'refreshed';
}
/** All home arguments are normalized before entering this port. */
export interface CodexHomeAuthReader {
  isAuthenticated(home: string): Promise<boolean>;
  ensureTokensFresh(home: string, signal?: AbortSignal): Promise<boolean>;
  getUsageEligibility(home: string): Promise<CodexUsageEligibility>;
  /** Final unsubscription releases the underlying home watcher. */
  watch(
    home: string,
    listener: (event: CodexHomeAuthEvent) => void,
  ): IDisposable;
}
