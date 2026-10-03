/**
 * Reconcile guard — the one mutation policy for the Agents tab (TASK_2026_609,
 * plan C4, risk PR7).
 *
 * Every caller on this surface that is about to change provider copies (Sync,
 * Restore, Finish restore, and the model save in B-6) awaits
 * {@link ReconcileGuardComponent.check} BEFORE it mutates anything:
 *
 * ```ts
 * if ((await this.guard().check({ confirmLabel: 'Sync' })) !== 'approved') return;
 * await this.store.reconcile();
 * ```
 *
 * 1. It runs a FRESH `harness:health { refresh: true }` through
 *    `HarnessHealthStore` — never the cached report — so an edit made after the
 *    tab loaded is still listed.
 * 2. It collects `localEdit` across every target and every facet of that fresh
 *    report, not only the agent the user clicked: a reconcile is
 *    whole-workspace.
 * 3. It shows a `NativeModalComponent` with the whole-workspace notice and the
 *    edited paths. Cancel (button, Escape, backdrop) resolves `'cancelled'`;
 *    the caller then performs NO mutation. Only Confirm resolves `'approved'`.
 *
 * ### One outcome per call
 *
 * {@link ReconcileGuardOutcome} is decided by the call itself, not read back
 * from `HarnessHealthStore` afterwards: a `harness:healthChanged` push or a
 * later refresh can change the store while the modal is open, and must not
 * turn a failed check into a Cancel (or the reverse).
 *
 * ### Destruction
 *
 * The guard lives on the Agents tab and is destroyed when the user leaves it,
 * possibly while the fresh read is still pending. Every step after an `await`
 * re-checks destruction and resolves `'cancelled'` before it would auto-approve
 * (`onlyWhenEdits`) or open a modal on a destroyed view. A destroyed guard
 * never approves.
 *
 * ### Snapshot wording is per target (FU-1)
 *
 * Only `WorkspaceHarnessTarget` (every non-Claude CLI target) saves a
 * hand-edited copy to `.ptah/harness/.history/` before overwriting it
 * (TASK_2026_609 B-1, `9d31e981d`). The Claude target and the MCP facet
 * planner overwrite without a snapshot today, so their paths get the plain
 * overwrite warning and no snapshot promise. When FU-1 lands, widen the
 * snapshot sentence to every group and drop the split.
 *
 * ### When the check cannot run
 *
 * If another harness call is in flight, the fresh read fails, or there is no
 * report for this workspace, the guard cannot show what would be overwritten,
 * so it says so and resolves `'unverified'`. It never lets a mutation through on
 * stale or missing data, including with `onlyWhenEdits`.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  inject,
  signal,
} from '@angular/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type { HarnessHealth, HarnessTargetId } from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';

/** Verbatim from implementation-plan.md C4 step 3. */
export const RECONCILE_WHOLE_WORKSPACE_NOTICE =
  'This updates every Ptah-managed file in this workspace (agents, skills, commands, MCP config) for all detected providers.';

/** Shown under the paths that ARE snapshotted before they are overwritten. */
export const RECONCILE_HISTORY_NOTE =
  'Each edited copy is saved to .ptah/harness/.history/ before it is overwritten.';

/** Shown under Claude and MCP config paths, which are NOT snapshotted (FU-1). */
export const RECONCILE_OVERWRITE_NOTE = 'These hand edits will be overwritten.';

const BUSY_REASON =
  'Another harness check or sync is still running. Try again when it finishes.';
const NO_REPORT_REASON =
  'No harness report is available for this workspace, so hand-edited files cannot be listed.';

/** One hand-edited, Ptah-owned path on one target. */
export interface LocalEditEntry {
  readonly target: HarnessTargetId;
  /** Workspace-relative path; an MCP entry is `<configRelPath>#<serverKey>`. */
  readonly path: string;
}

/** Hand-edited paths split by whether the overwrite is preceded by a snapshot. */
export interface LocalEditGroups {
  /** Non-Claude CLI copies: saved to `.ptah/harness/.history/` first. */
  readonly snapshotted: readonly LocalEditEntry[];
  /** Claude-target paths and MCP config entries: overwritten, no snapshot. */
  readonly overwriteOnly: readonly LocalEditEntry[];
}

/**
 * How one {@link ReconcileGuardComponent.check} call ended.
 *
 * - `approved`   — the user confirmed, or `onlyWhenEdits` found no edited path.
 * - `cancelled`  — the user declined (Cancel, Escape, backdrop) after a fresh,
 *   successful read, or the guard was destroyed before it could answer.
 * - `unverified` — the fresh read could not run or failed, so nothing could be
 *   listed; also a second call while one is still open.
 *
 * Only `approved` lets a caller mutate.
 */
export type ReconcileGuardOutcome = 'approved' | 'cancelled' | 'unverified';

export interface ReconcileGuardOptions {
  /**
   * Resolve `'approved'` without showing anything when the fresh report lists no
   * hand-edited path. For the model save (B-6), whose row already carries the
   * whole-workspace line. Sync and Restore leave it off and always ask.
   */
  readonly onlyWhenEdits?: boolean;
  /** Text of the confirm button, e.g. `Sync`. @default 'Continue' */
  readonly confirmLabel?: string;
}

/**
 * Group every `localEdit` path of a report, across all targets and facets.
 *
 * A path is snapshotted only when a `WorkspaceHarnessTarget` writes it: any
 * target but Claude, and not an MCP fragment key (`#`). Misreading a path as
 * MCP can only drop a snapshot promise, never invent one.
 */
export function groupLocalEdits(health: HarnessHealth): LocalEditGroups {
  const snapshotted: LocalEditEntry[] = [];
  const overwriteOnly: LocalEditEntry[] = [];
  const seen = new Set<string>();
  for (const report of health.targets) {
    for (const path of report.localEdit ?? []) {
      const key = `${report.target}\u0000${path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const entry: LocalEditEntry = { target: report.target, path };
      if (report.target === 'claude' || path.includes('#')) {
        overwriteOnly.push(entry);
      } else {
        snapshotted.push(entry);
      }
    }
  }
  return { snapshotted, overwriteOnly };
}

type GuardView =
  | {
      readonly kind: 'confirm';
      readonly edits: LocalEditGroups;
      readonly confirmLabel: string;
    }
  | { readonly kind: 'unverified'; readonly reason: string };

let nextTitleId = 0;

@Component({
  selector: 'ptah-reconcile-guard',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeModalComponent],
  template: `
    <ptah-native-modal
      [isOpen]="view() !== null"
      [ariaLabelledby]="titleId"
      size="lg"
      (closed)="dismiss()"
    >
      <h3 modal-header class="text-base font-semibold" [id]="titleId">
        @if (view()?.kind === 'unverified') {
          Could not check for hand-edited files
        } @else {
          Update provider copies in this workspace?
        }
      </h3>
      <div class="mt-2 space-y-3 text-sm" data-testid="reconcile-guard-body">
        @switch (view()?.kind) {
          @case ('unverified') {
            <p data-testid="reconcile-guard-unverified">{{ reason() }}</p>
            <p class="text-base-content-muted">Nothing was changed.</p>
          }
          @case ('confirm') {
            <p data-testid="reconcile-guard-scope">
              {{ wholeWorkspaceNotice }}
            </p>
            @if (snapshotted().length === 0 && overwriteOnly().length === 0) {
              <p
                class="text-base-content-muted"
                data-testid="reconcile-guard-no-edits"
              >
                No hand-edited Ptah-managed files were found.
              </p>
            }
            @if (snapshotted().length > 0) {
              <section data-testid="reconcile-guard-snapshotted">
                <h4 class="font-medium">Hand-edited provider copies</h4>
                <ul class="mt-1 space-y-1">
                  @for (
                    entry of snapshotted();
                    track entry.target + entry.path
                  ) {
                    <li data-testid="reconcile-guard-path">
                      <span class="badge badge-ghost badge-sm">{{
                        entry.target
                      }}</span>
                      <code class="ml-1 break-all text-xs">{{
                        entry.path
                      }}</code>
                    </li>
                  }
                </ul>
                <p class="mt-1" data-testid="reconcile-guard-history-note">
                  {{ historyNote }}
                </p>
              </section>
            }
            @if (overwriteOnly().length > 0) {
              <section data-testid="reconcile-guard-overwrite-only">
                <h4 class="font-medium">
                  Hand-edited Claude files and MCP config entries
                </h4>
                <ul class="mt-1 space-y-1">
                  @for (
                    entry of overwriteOnly();
                    track entry.target + entry.path
                  ) {
                    <li data-testid="reconcile-guard-path">
                      <span class="badge badge-ghost badge-sm">{{
                        entry.target
                      }}</span>
                      <code class="ml-1 break-all text-xs">{{
                        entry.path
                      }}</code>
                    </li>
                  }
                </ul>
                <!-- Solid warning fill + warning-content (5.67:1 light,
                     6.61:1 dark); bare text-warning on base-100 is 2.46:1
                     in the light theme. -->
                <p
                  class="mt-1 rounded bg-warning px-2 py-1 text-warning-content"
                  data-testid="reconcile-guard-overwrite-note"
                >
                  {{ overwriteNote }}
                </p>
              </section>
            }
          }
        }
      </div>
      <div modal-footer class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="reconcile-guard-cancel"
          (click)="dismiss()"
        >
          {{ view()?.kind === 'unverified' ? 'Close' : 'Cancel' }}
        </button>
        @if (view()?.kind === 'confirm') {
          <button
            type="button"
            class="btn btn-sm btn-warning"
            data-testid="reconcile-guard-confirm"
            (click)="approve()"
          >
            {{ confirmLabel() }}
          </button>
        }
      </div>
    </ptah-native-modal>
  `,
})
export class ReconcileGuardComponent implements OnDestroy {
  private readonly store = inject(HarnessHealthStore);

  protected readonly titleId = `ptah-reconcile-guard-title-${++nextTitleId}`;
  protected readonly wholeWorkspaceNotice = RECONCILE_WHOLE_WORKSPACE_NOTICE;
  protected readonly historyNote = RECONCILE_HISTORY_NOTE;
  protected readonly overwriteNote = RECONCILE_OVERWRITE_NOTE;

  /** What the open modal shows; `null` while closed. */
  protected readonly view = signal<GuardView | null>(null);

  private inFlight = false;
  private destroyed = false;
  private resolver: ((outcome: ReconcileGuardOutcome) => void) | null = null;

  /**
   * Check, ask, and resolve whether the caller may mutate.
   *
   * @returns `'approved'` only when the user confirmed (or, with
   *   `onlyWhenEdits`, when the fresh report lists no edited path); see
   *   {@link ReconcileGuardOutcome} for the rest.
   */
  public async check(
    options: ReconcileGuardOptions = {},
  ): Promise<ReconcileGuardOutcome> {
    if (this.destroyed) return 'cancelled';
    if (this.inFlight) return 'unverified';
    this.inFlight = true;
    try {
      // `refresh` silently returns when a read is already in flight, and a
      // reconcile may be rewriting the tree; either way the answer would not
      // be the fresh one this guard promises.
      if (this.store.busy()) {
        return await this.ask({ kind: 'unverified', reason: BUSY_REASON });
      }
      await this.store.refresh({ refresh: true });
      // Left the tab while the read was pending: no auto-approval, no modal.
      if (this.destroyed) return 'cancelled';
      const error = this.store.error();
      if (error !== null) {
        return await this.ask({ kind: 'unverified', reason: error });
      }
      const health = this.store.health();
      if (health === null) {
        return await this.ask({ kind: 'unverified', reason: NO_REPORT_REASON });
      }
      const edits = groupLocalEdits(health);
      const editCount = edits.snapshotted.length + edits.overwriteOnly.length;
      if (options.onlyWhenEdits === true && editCount === 0) {
        return 'approved';
      }
      return await this.ask({
        kind: 'confirm',
        edits,
        confirmLabel: options.confirmLabel ?? 'Continue',
      });
    } finally {
      this.inFlight = false;
    }
  }

  public ngOnDestroy(): void {
    this.destroyed = true;
    this.finish('cancelled');
  }

  protected reason(): string {
    const view = this.view();
    return view?.kind === 'unverified' ? view.reason : '';
  }

  protected confirmLabel(): string {
    const view = this.view();
    return view?.kind === 'confirm' ? view.confirmLabel : '';
  }

  protected snapshotted(): readonly LocalEditEntry[] {
    const view = this.view();
    return view?.kind === 'confirm' ? view.edits.snapshotted : [];
  }

  protected overwriteOnly(): readonly LocalEditEntry[] {
    const view = this.view();
    return view?.kind === 'confirm' ? view.edits.overwriteOnly : [];
  }

  /** Confirm button. */
  protected approve(): void {
    this.finish('approved');
  }

  /**
   * Cancel/Close button, Escape, backdrop. The outcome follows what this call
   * showed: a failed check stays `unverified`, a declined confirmation is
   * `cancelled`.
   */
  protected dismiss(): void {
    this.finish(
      this.view()?.kind === 'unverified' ? 'unverified' : 'cancelled',
    );
  }

  /** Close the modal and answer the pending {@link check}. Idempotent. */
  private finish(outcome: ReconcileGuardOutcome): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.view.set(null);
    resolve?.(outcome);
  }

  private ask(view: GuardView): Promise<ReconcileGuardOutcome> {
    if (this.destroyed) return Promise.resolve('cancelled');
    this.view.set(view);
    return new Promise<ReconcileGuardOutcome>((resolve) => {
      this.resolver = resolve;
    });
  }
}
