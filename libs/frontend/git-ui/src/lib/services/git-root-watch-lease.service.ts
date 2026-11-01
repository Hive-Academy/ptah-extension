import { DestroyRef, Injectable, inject } from '@angular/core';
import { VSCodeService, rpcCall } from '@ptah-extension/core';
import {
  normalizeWorkspaceRoot,
  type GitWatchRootsResult,
} from '@ptah-extension/shared';

/**
 * Keeps the backend's secondary git watchers on the roots the dock cares
 * about (TASK_2026_855), through the declarative `git:watchRoots` lease.
 *
 * Each call states this renderer's whole set; the backend validates every
 * root, caps the number of extra watchers and expires a lease that is not
 * renewed. So this client only has to:
 *
 * - collapse bursts of scope changes into one call (300 ms debounce, one
 *   timer);
 * - renew the lease every 60 s while the set is non-empty (one interval,
 *   stopped when the set empties), without the roots the backend reported
 *   `rejected` — a removed worktree is not re-leased every minute; the next
 *   {@link update} asks for it again;
 * - release everything on destroy.
 *
 * Electron only (`gitRootWatch` capability): in other hosts every call is a
 * no-op and the dock behaves as before. A failed call is logged and retried
 * on the next update or renewal; the dock's fetch on switch still works
 * without live pushes.
 */
@Injectable({ providedIn: 'root' })
export class GitRootWatchLeaseService {
  static readonly DEBOUNCE_MS = 300;
  static readonly RENEW_INTERVAL_MS = 60_000;
  /** The renderer asks for at most this many roots; the backend caps too. */
  static readonly MAX_ROOTS = 4;

  private readonly vscode = inject(VSCodeService);
  /** One lease per renderer instance. */
  private readonly leaseId = globalThis.crypto.randomUUID();

  /** The set to lease, highest priority first, de-duplicated and capped. */
  private roots: readonly string[] = [];
  /**
   * Key of the set the backend last accepted. Starts as the empty set: the
   * backend holds nothing for a fresh lease id, so an empty update sends
   * nothing. Null after a failure, so the next flush sends again.
   */
  private sentKey: string | null = '';
  /** Keys of the roots the backend rejected for the current set. */
  private rejected = new Set<string>();
  private debounceTimer: ReturnType<typeof setTimeout> | null = null;
  private renewTimer: ReturnType<typeof setInterval> | null = null;
  private destroyed = false;

  constructor() {
    inject(DestroyRef).onDestroy(() => this.dispose());
  }

  /**
   * State the roots this renderer wants live pushes for, highest priority
   * first. Empty or null entries are skipped; spellings of one directory
   * count once; at most {@link MAX_ROOTS} are kept.
   */
  update(roots: readonly (string | null)[]): void {
    if (this.destroyed || this.vscode.config().isElectron !== true) return;
    this.roots = leaseRoots(roots);
    this.rejected = new Set();
    if (this.debounceTimer !== null) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.flush();
    }, GitRootWatchLeaseService.DEBOUNCE_MS);
  }

  private flush(): void {
    const roots = this.roots;
    if (roots.length === 0) {
      this.stopRenewal();
    } else if (this.renewTimer === null) {
      this.renewTimer = setInterval(
        () => this.renew(),
        GitRootWatchLeaseService.RENEW_INTERVAL_MS,
      );
    }
    void this.send(roots, false);
  }

  /** Renew the set minus the rejected roots; nothing left releases it. */
  private renew(): void {
    const live = this.roots.filter(
      (root) => !this.rejected.has(normalizeWorkspaceRoot(root)),
    );
    if (live.length === 0) this.stopRenewal();
    void this.send(live, true);
  }

  /**
   * Send the set. A flush skips a set the backend already holds; a renewal
   * always sends, because renewing is what keeps the lease alive.
   */
  private async send(roots: readonly string[], renew: boolean): Promise<void> {
    const key = roots.map((root) => normalizeWorkspaceRoot(root)).join('\n');
    if (!renew && key === this.sentKey) return;
    try {
      const result = await rpcCall<GitWatchRootsResult>(
        this.vscode,
        'git:watchRoots',
        {
          leaseId: this.leaseId,
          roots: [...roots],
        },
      );
      if (this.destroyed) return;
      if (result.success) {
        this.sentKey = key;
        this.rejected = new Set(
          (result.data?.rejected ?? []).map((root) =>
            normalizeWorkspaceRoot(root),
          ),
        );
        return;
      }
      console.warn('[GitRootWatchLeaseService] git:watchRoots failed', {
        error: result.error,
      });
      this.sentKey = null;
    } catch (error: unknown) {
      // degradation-audit: reported - logged; the next update or renewal
      // retries, and the dock still reads git state on every scope switch.
      console.warn('[GitRootWatchLeaseService] git:watchRoots threw', error);
      this.sentKey = null;
    }
  }

  private stopRenewal(): void {
    if (this.renewTimer !== null) {
      clearInterval(this.renewTimer);
      this.renewTimer = null;
    }
  }

  private dispose(): void {
    this.destroyed = true;
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.stopRenewal();
  }
}

/** De-duplicate by normalized key (first spelling wins) and cap. */
function leaseRoots(roots: readonly (string | null)[]): readonly string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of roots) {
    const root = raw?.trim() ?? '';
    if (root === '') continue;
    const key = normalizeWorkspaceRoot(root);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(root);
    if (out.length === GitRootWatchLeaseService.MAX_ROOTS) break;
  }
  return out;
}
