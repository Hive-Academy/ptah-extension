/**
 * QuarantinedAgentsPanelComponent — the Agents tab's list of agents the
 * one-time seed quarantine moved out of this workspace, with Restore
 * (TASK_2026_609, plan C4).
 *
 * The list is derived from files on every read (`listQuarantinedAgents`), never
 * stored, so the panel re-lists after every action instead of patching a row.
 *
 * ### Mutation order
 *
 * Restore always opens this panel's own confirmation first, which names the
 * file it writes: `.claude/agents/<slug>.md`, a source the workspace owns and
 * git sees (user-approved Restore option 1). Then:
 *
 * - agent sync `disabled`: restore only. No whole-workspace guard and no
 *   reconcile, because nothing beyond the source file is written and Ptah must
 *   not turn sync on (PR5).
 * - otherwise: the shared {@link ReconcileGuardComponent} (PR7) → restore →
 *   `HarnessHealthStore.reconcile()`. Cancel at the guard writes nothing.
 *
 * `source-restored` rows offer "Finish restore" (guard → reconcile) only; the
 * source is already back, so there is nothing for the restore RPC to do.
 *
 * ### No folder vs nothing quarantined
 *
 * The handler answers `workspaceRoot: null` when no folder is open. That is a
 * distinct state with no Restore, never the "nothing quarantined" copy. A
 * thrown list or restore error is shown as an error with its message; it is
 * never read as an empty list or as success, and its text is never parsed.
 */
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { HarnessHealthStore } from '@ptah-extension/marketplace/services';
import type {
  QuarantinedAgentEntry,
  SkillSynthesisListQuarantinedAgentsResult,
  SkillSynthesisRestoreQuarantinedAgentResult,
} from '@ptah-extension/shared';
import { NativeModalComponent } from '@ptah-extension/ui';

import { SkillSynthesisRpcService } from '../../services/skill-synthesis-rpc.service';
import { SkillClonesStateService } from '../../services/skill-clones-state.service';
import { ReconcileGuardComponent } from './reconcile-guard';

/** A message the host view shows in its toast. */
export interface QuarantineNotice {
  readonly message: string;
  readonly kind: 'success' | 'error' | 'info' | 'warning';
}

/** Verbatim from implementation-plan.md C4 (agent sync off). */
export const QUARANTINE_SYNC_OFF_COPY =
  'Agent sync is off here: only Claude will see it until agent sync is enabled by the setup wizard. Ptah will not turn sync on.';

/** Where Restore writes, relative to the workspace (Decision 1). */
export function quarantineRestoreRelPath(slug: string): string {
  return `.claude/agents/${slug}.md`;
}

/** Restore disclosure, verbatim from implementation-plan.md C4 (Decision 1). */
export function quarantineRestoreDisclosure(slug: string): string {
  return `Adds ${quarantineRestoreRelPath(slug)} to this workspace as a source file it owns (visible to git); the quarantine snapshot is kept.`;
}

/** `quarantinedAt` as a readable date, or `null` when absent or unparseable. */
function formatQuarantineDate(iso: string | null): string | null {
  if (iso === null) return null;
  const ms = Date.parse(iso);
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

interface QuarantineRow {
  readonly entry: QuarantinedAgentEntry;
  readonly date: string | null;
}

let nextInstanceId = 0;

@Component({
  selector: 'ptah-quarantined-agents-panel',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NativeModalComponent],
  template: `
    <section
      class="mt-4 space-y-2 rounded-lg border border-base-300 p-3"
      [attr.aria-labelledby]="headingId"
      data-testid="quarantine-panel"
    >
      <h3
        [id]="headingId"
        class="flex items-center gap-2 text-sm font-semibold"
      >
        Quarantined agents
        @if (listing(); as l) {
          @if (l.workspaceRoot !== null) {
            <span
              class="badge badge-ghost badge-sm tabular-nums"
              data-testid="quarantine-count"
              >{{ l.quarantined.length }}</span
            >
          }
        }
      </h3>

      @if (loadError(); as msg) {
        <div
          role="alert"
          class="alert alert-error py-2 text-sm"
          data-testid="quarantine-error"
        >
          <span>Could not list quarantined agents: {{ msg }}</span>
        </div>
      } @else if (listing(); as l) {
        @if (l.workspaceRoot === null) {
          <p
            class="text-sm text-base-content-muted"
            data-testid="quarantine-no-folder"
          >
            Open a workspace folder to see and restore quarantined agents.
          </p>
        } @else {
          @if (l.recordUnreadable) {
            <p
              class="text-xs text-base-content-muted"
              data-testid="quarantine-record-unreadable"
            >
              The quarantine record for this workspace could not be read, so
              agents it lists may be missing here.
            </p>
          }
          @if (l.agentSync === 'disabled') {
            <p
              class="text-xs text-base-content-muted"
              data-testid="quarantine-sync-off"
            >
              {{ syncOffCopy }}
            </p>
          }
          @if (rows().length === 0) {
            <p
              class="text-sm text-base-content-muted"
              data-testid="quarantine-empty"
            >
              No agents are quarantined in this workspace.
            </p>
          } @else {
            <ul class="space-y-2" data-testid="quarantine-list">
              @for (row of rows(); track row.entry.slug) {
                <li
                  class="flex flex-wrap items-center justify-between gap-2 text-sm"
                  data-testid="quarantine-item"
                >
                  <div class="min-w-0">
                    <p class="truncate font-mono">{{ row.entry.slug }}</p>
                    <p class="text-xs text-base-content-muted">
                      @if (row.date; as d) {
                        <time
                          [attr.datetime]="row.entry.quarantinedAt"
                          data-testid="quarantine-date"
                          >{{ d }}</time
                        >
                      } @else {
                        <span data-testid="quarantine-date">date unknown</span>
                      }
                      <span aria-hidden="true"> · </span>
                      <span data-testid="quarantine-state">{{
                        row.entry.state === 'source-restored'
                          ? 'restored, not yet synced'
                          : 'quarantined'
                      }}</span>
                    </p>
                  </div>

                  @if (row.entry.state === 'source-restored') {
                    @if (l.agentSync !== 'disabled') {
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs transition-colors duration-150"
                        data-testid="quarantine-finish-btn"
                        [disabled]="controlsLocked()"
                        (click)="onFinishRestore(row.entry)"
                      >
                        Finish restore
                      </button>
                    }
                  } @else if (row.entry.hasSnapshot) {
                    <button
                      type="button"
                      class="btn btn-ghost btn-xs transition-colors duration-150"
                      data-testid="quarantine-restore-btn"
                      [disabled]="controlsLocked()"
                      (click)="pendingRestore.set(row.entry)"
                    >
                      Restore
                    </button>
                  } @else {
                    <span class="inline-flex items-center gap-2">
                      <span
                        class="text-xs text-base-content-muted"
                        data-testid="quarantine-no-snapshot"
                        >no snapshot found</span
                      >
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        data-testid="quarantine-restore-btn"
                        disabled
                        title="No quarantine snapshot was found for this agent."
                      >
                        Restore
                      </button>
                    </span>
                  }
                </li>
              }
            </ul>
          }
        }
      } @else {
        <p
          class="text-sm text-base-content-muted"
          data-testid="quarantine-loading"
        >
          Checking for quarantined agents…
        </p>
      }
    </section>

    <ptah-native-modal
      [isOpen]="pendingRestore() !== null"
      [ariaLabelledby]="restoreTitleId"
      (closed)="pendingRestore.set(null)"
    >
      <h3 modal-header class="text-base font-semibold" [id]="restoreTitleId">
        Restore
        <span class="font-mono text-sm">{{ pendingRestore()?.slug }}</span>
      </h3>
      @if (pendingRestore(); as entry) {
        <div class="mt-2 space-y-2 text-sm">
          <p data-testid="quarantine-restore-disclosure">
            {{ disclosure(entry.slug) }}
          </p>
          @if (syncOff()) {
            <p
              class="text-base-content-muted"
              data-testid="quarantine-restore-sync-off"
            >
              {{ syncOffCopy }}
            </p>
          }
        </div>
      }
      <div modal-footer class="modal-action">
        <button
          type="button"
          class="btn btn-sm btn-ghost"
          data-testid="quarantine-restore-cancel"
          (click)="pendingRestore.set(null)"
        >
          Cancel
        </button>
        <button
          type="button"
          class="btn btn-sm btn-primary"
          data-testid="quarantine-restore-confirm"
          [disabled]="controlsLocked()"
          (click)="onConfirmRestore()"
        >
          Restore
        </button>
      </div>
    </ptah-native-modal>
  `,
})
export class QuarantinedAgentsPanelComponent implements OnInit {
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly clonesState = inject(SkillClonesStateService);
  private readonly store = inject(HarnessHealthStore);

  /** The one guard the host view places; every reconcile goes through it. */
  public readonly guard = input.required<ReconcileGuardComponent>();
  /** The host's write lock (clone writes, list reloads, harness calls). */
  public readonly locked = input<boolean>(false);

  /** A message for the host's toast. */
  public readonly notice = output<QuarantineNotice>();
  /** Kept foreign agent slugs still in the scoped root, after every list. */
  public readonly notOwnedChange = output<readonly string[]>();

  protected readonly syncOffCopy = QUARANTINE_SYNC_OFF_COPY;
  private readonly instanceId = ++nextInstanceId;
  protected readonly headingId = `ptah-quarantine-heading-${this.instanceId}`;
  protected readonly restoreTitleId = `ptah-quarantine-restore-title-${this.instanceId}`;

  protected readonly listing =
    signal<SkillSynthesisListQuarantinedAgentsResult | null>(null);
  protected readonly loadError = signal<string | null>(null);
  protected readonly loading = signal<boolean>(false);
  /** The slug a restore or finish is running for. */
  protected readonly busySlug = signal<string | null>(null);
  /** The entry whose Restore confirmation is open. */
  protected readonly pendingRestore = signal<QuarantinedAgentEntry | null>(
    null,
  );

  protected readonly rows = computed<QuarantineRow[]>(() =>
    (this.listing()?.quarantined ?? []).map((entry) => ({
      entry,
      date: formatQuarantineDate(entry.quarantinedAt),
    })),
  );

  protected readonly syncOff = computed(
    () => this.listing()?.agentSync === 'disabled',
  );

  protected readonly controlsLocked = computed(
    () =>
      this.locked() ||
      this.loading() ||
      this.busySlug() !== null ||
      this.store.busy(),
  );

  /** Increments per list call; an older reply never overwrites a newer one. */
  private loadSeq = 0;

  public ngOnInit(): void {
    void this.load();
  }

  /** Re-read the quarantine list. Called on tab entry, Refresh and after actions. */
  public async load(): Promise<void> {
    const seq = ++this.loadSeq;
    this.loading.set(true);
    try {
      const result = await this.rpc.listQuarantinedAgents();
      if (seq !== this.loadSeq) return;
      this.listing.set(result);
      this.loadError.set(null);
      this.notOwnedChange.emit(
        result.workspaceRoot === null ? [] : result.notOwned,
      );
    } catch (err: unknown) {
      if (seq !== this.loadSeq) return;
      this.listing.set(null);
      this.loadError.set(toMessage(err));
      this.notOwnedChange.emit([]);
    } finally {
      if (seq === this.loadSeq) this.loading.set(false);
    }
  }

  protected disclosure(slug: string): string {
    return quarantineRestoreDisclosure(slug);
  }

  /**
   * After the destination disclosure: agent sync off → restore only;
   * otherwise guard → restore → reconcile.
   */
  protected async onConfirmRestore(): Promise<void> {
    const entry = this.pendingRestore();
    const listing = this.listing();
    this.pendingRestore.set(null);
    if (entry === null || listing === null || listing.workspaceRoot === null) {
      return;
    }
    const syncOff = listing.agentSync === 'disabled';
    if (
      !syncOff &&
      !(await this.guard().confirm({ confirmLabel: 'Restore' }))
    ) {
      return;
    }

    this.busySlug.set(entry.slug);
    try {
      const result = await this.rpc.restoreQuarantinedAgent(entry.slug);
      await this.reportRestore(entry.slug, result, syncOff);
    } catch (err: unknown) {
      this.notice.emit({
        message: `Could not restore "${entry.slug}": ${toMessage(err)}`,
        kind: 'error',
      });
    } finally {
      this.busySlug.set(null);
    }
    await this.reloadAfterWrite();
  }

  /** `source-restored`: the source is back; only the reconcile is left. */
  protected async onFinishRestore(entry: QuarantinedAgentEntry): Promise<void> {
    if (!(await this.guard().confirm({ confirmLabel: 'Finish restore' }))) {
      return;
    }
    this.busySlug.set(entry.slug);
    try {
      await this.store.reconcile();
      const error = this.store.error();
      this.notice.emit(
        error === null
          ? {
              message: `Updated provider copies for "${entry.slug}".`,
              kind: 'success',
            }
          : {
              message: `Could not update provider copies for "${entry.slug}": ${error}`,
              kind: 'error',
            },
      );
    } finally {
      this.busySlug.set(null);
    }
    await this.reloadAfterWrite();
  }

  private async reportRestore(
    slug: string,
    result: SkillSynthesisRestoreQuarantinedAgentResult,
    syncOffAtConfirm: boolean,
  ): Promise<void> {
    const reason = result.reason ? ` (${result.reason})` : '';
    switch (result.outcome) {
      case 'restored':
      case 'already-restored': {
        const dest = quarantineRestoreRelPath(slug);
        if (syncOffAtConfirm || result.agentSync === 'disabled') {
          this.notice.emit({
            message: `Restored "${slug}" to ${dest}. ${QUARANTINE_SYNC_OFF_COPY}`,
            kind: 'success',
          });
          return;
        }
        await this.store.reconcile();
        const error = this.store.error();
        this.notice.emit(
          error === null
            ? { message: `Restored "${slug}" to ${dest}.`, kind: 'success' }
            : {
                message: `Restored "${slug}" to ${dest}, but provider copies were not updated: ${error}`,
                kind: 'warning',
              },
        );
        return;
      }
      case 'conflict':
        this.notice.emit({
          message: `Could not restore "${slug}": a different file already exists at ${result.path}${reason}.`,
          kind: 'error',
        });
        return;
      case 'copy-failed':
        this.notice.emit({
          message: `Could not restore "${slug}": copying to ${result.path} failed${reason}.`,
          kind: 'error',
        });
        return;
      case 'no-snapshot':
        this.notice.emit({
          message: `Could not restore "${slug}": no quarantine snapshot was found${reason}.`,
          kind: 'error',
        });
        return;
      case 'not-quarantined':
        this.notice.emit({
          message: `"${slug}" is no longer quarantined; nothing was restored.`,
          kind: 'info',
        });
        return;
    }
  }

  /** The list is derived from files; re-read it and the clone list. */
  private async reloadAfterWrite(): Promise<void> {
    await this.load();
    await this.clonesState.refreshClones();
  }
}

function toMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
