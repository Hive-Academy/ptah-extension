import { signal } from '@angular/core';
import type { RpcCallResult } from '@ptah-extension/core';
import { GIT_LOCKED_MESSAGE } from '@ptah-extension/shared';
import type { GitMutationFailureCode } from '@ptah-extension/shared';

/** The fields every git mutation result (stage, unstage, discard) shares. */
export interface GitMutationOutcome {
  readonly success: boolean;
  readonly error?: string;
  readonly code?: GitMutationFailureCode;
}

function transportFailureText(detail: string | undefined): string {
  return `Could not reach git: ${detail || 'the request failed'}`;
}

/**
 * Why a mutation failed, or null when git reports success. A transport failure
 * is never read as git success (TASK_2026_576 RC1); a held lock always reads as
 * `GIT_LOCKED_MESSAGE`.
 */
function mutationFailureText(
  result: RpcCallResult<GitMutationOutcome>,
): string | null {
  if (!result.success) return transportFailureText(result.error);
  const data = result.data;
  if (!data) return 'Git returned no result.';
  if (data.success) return null;
  if (data.code === 'LOCKED') return GIT_LOCKED_MESSAGE;
  return data.error || 'The git operation failed.';
}

/**
 * The in-flight and failed git mutations of the changed-file tree, by key (a
 * row or a section, prefixed with its workspace root). RC1, ported from
 * `SourceControlPanelComponent`: every call is awaited and checked, its
 * failure is kept until dismissed or cleared by the next success, and
 * `afterEach` (the status re-read) runs after every call, failed or not.
 */
export class TreeMutationTracker {
  private readonly errors = signal<ReadonlyMap<string, string>>(new Map());
  private readonly pending = signal<ReadonlySet<string>>(new Set());

  constructor(private readonly afterEach: () => void) {}

  isPending(key: string): boolean {
    return this.pending().has(key);
  }

  /** Whether any call whose key starts with `prefix` is in flight. */
  anyPending(prefix: string): boolean {
    for (const key of this.pending()) {
      if (key.startsWith(prefix)) return true;
    }
    return false;
  }

  error(key: string): string | null {
    return this.errors().get(key) ?? null;
  }

  dismiss(key: string): void {
    this.setError(key, null);
  }

  /**
   * Run one mutation, record its failure (or clear an earlier one), then run
   * `afterEach`: a failed call can still have changed the index.
   */
  async run(
    key: string,
    call: () => Promise<RpcCallResult<GitMutationOutcome>>,
  ): Promise<void> {
    if (this.isPending(key)) return;
    this.setPending(key, true);
    let failure: string | null;
    try {
      failure = mutationFailureText(await call());
    } catch (error: unknown) {
      failure = transportFailureText(
        error instanceof Error ? error.message : String(error),
      );
    }
    this.setError(key, failure);
    this.setPending(key, false);
    this.afterEach();
  }

  private setPending(key: string, pending: boolean): void {
    const next = new Set(this.pending());
    if (pending) next.add(key);
    else next.delete(key);
    this.pending.set(next);
  }

  private setError(key: string, message: string | null): void {
    const current = this.errors();
    if (message === null && !current.has(key)) return;
    const next = new Map(current);
    if (message === null) next.delete(key);
    else next.set(key, message);
    this.errors.set(next);
  }
}
