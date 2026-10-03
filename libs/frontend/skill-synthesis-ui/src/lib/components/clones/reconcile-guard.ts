/**
 * Reconcile guard — the one mutation policy for the Agents tab (TASK_2026_609,
 * plan C4, risk PR7).
 *
 * Every caller on this surface that is about to change provider copies (Sync,
 * Restore, Finish restore, and the model save in B-6) awaits
 * {@link ReconcileGuardComponent.confirm} BEFORE it mutates anything:
 *
 * ```ts
 * if (!(await this.guard().confirm({ confirmLabel: 'Sync' }))) return;
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
 *    edited paths. Cancel (button, Escape, backdrop) resolves `false`; the
 *    caller then performs NO mutation. Only Confirm resolves `true`.
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
 * so it says so and resolves `false`. It never lets a mutation through on
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

export interface ReconcileGuardOptions {
  /**
   * Resolve `true` without showing anything when the fresh report lists no
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
      (closed)="settle(false)"
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
                <p
                  class="mt-1 text-warning"
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
          (click)="settle(false)"
        >
          {{ view()?.kind === 'unverified' ? 'Close' : 'Cancel' }}
        </button>
        @if (view()?.kind === 'confirm') {
          <button
            type="button"
            class="btn btn-sm btn-warning"
            data-testid="reconcile-guard-confirm"
            (click)="settle(true)"
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
  private resolver: ((confirmed: boolean) => void) | null = null;

  /**
   * Check, ask, and resolve whether the caller may mutate.
   *
   * @returns `true` only when the user confirmed (or, with `onlyWhenEdits`,
   *   when the fresh report lists no edited path). `false` on Cancel, Escape,
   *   backdrop, destroy, an unverifiable report, or a second call while one is
   *   still open.
   */
  public async confirm(options: ReconcileGuardOptions = {}): Promise<boolean> {
    if (this.inFlight) return false;
    this.inFlight = true;
    try {
      // `refresh` silently returns when a read is already in flight, and a
      // reconcile may be rewriting the tree; either way the answer would not
      // be the fresh one this guard promises.
      if (this.store.busy()) {
        return await this.ask({ kind: 'unverified', reason: BUSY_REASON });
      }
      await this.store.refresh({ refresh: true });
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
        return true;
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
    this.settle(false);
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

  /** Close the modal and answer the pending {@link confirm}. Idempotent. */
  protected settle(confirmed: boolean): void {
    const resolve = this.resolver;
    this.resolver = null;
    this.view.set(null);
    resolve?.(confirmed);
  }

  private ask(view: GuardView): Promise<boolean> {
    this.view.set(view);
    return new Promise<boolean>((resolve) => {
      this.resolver = resolve;
    });
  }
}
