import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
} from '@ptah-extension/shared';

import {
  SkillStatusFilter,
  SkillSynthesisStateService,
} from '../services/skill-synthesis-state.service';

type ActionKind = 'promote' | 'reject';

interface ActionDialogState {
  readonly kind: ActionKind;
  readonly candidate: SkillSynthesisCandidateSummary;
}

/**
 * SkillSynthesisTabComponent
 *
 * Skills tab inside the Hermes shell. Renders:
 * - a candidate table filtered by `pending | promoted | rejected | all`
 * - per-row Promote / Reject buttons (each opens a small DaisyUI modal
 *   for an optional reason)
 * - a drill-down panel showing invocation history of the selected
 *   candidate
 * - an aggregate stats card (counts by status + invocations)
 * - a read-only settings panel listing `skillSynthesis.*` keys
 *
 * VS Code parity: works in BOTH Electron and VS Code — skills are not
 * Electron-only. The backend writes SKILL.md to disk on promote.
 */
@Component({
  selector: 'ptah-skill-synthesis-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [CommonModule, FormsModule],
  template: `
    <div class="flex h-full w-full flex-col gap-4">
      <!-- Stats card -->
      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Skill synthesis stats"
      >
        <div class="card-body p-4">
          <h2 class="card-title text-sm">Stats</h2>
          @if (stats(); as s) {
            <div class="stats stats-horizontal w-full bg-base-100">
              <div class="stat px-3 py-2">
                <div class="stat-title text-xs">Candidates</div>
                <div class="stat-value text-lg">{{ s.totalCandidates }}</div>
              </div>
              <div class="stat px-3 py-2">
                <div class="stat-title text-xs">Promoted</div>
                <div class="stat-value text-lg">{{ s.totalPromoted }}</div>
              </div>
              <div class="stat px-3 py-2">
                <div class="stat-title text-xs">Rejected</div>
                <div class="stat-value text-lg">{{ s.totalRejected }}</div>
              </div>
              <div class="stat px-3 py-2">
                <div class="stat-title text-xs">Active skills</div>
                <div class="stat-value text-lg">{{ s.activeSkills }}</div>
              </div>
              <div class="stat px-3 py-2">
                <div class="stat-title text-xs">Invocations</div>
                <div class="stat-value text-lg">{{ s.totalInvocations }}</div>
              </div>
            </div>
          } @else {
            <div class="text-xs text-base-content/60">
              Loading stats&hellip;
            </div>
          }
        </div>
      </section>

      <!-- Filter chips -->
      <div
        role="tablist"
        aria-label="Status filter"
        class="tabs tabs-boxed self-start"
      >
        @for (f of filters; track f.id) {
          <button
            type="button"
            role="tab"
            class="tab tab-sm"
            [class.tab-active]="statusFilter() === f.id"
            [attr.aria-selected]="statusFilter() === f.id"
            (click)="onFilterChange(f.id)"
          >
            {{ f.label }}
          </button>
        }
      </div>

      <!-- Error banner -->
      @if (error(); as msg) {
        <div role="alert" class="alert alert-error py-2 text-sm">
          <span>{{ msg }}</span>
        </div>
      }

      <!-- Candidates table -->
      <section class="card bg-base-200 shadow-sm" aria-label="Skill candidates">
        <div class="card-body p-0">
          <div class="overflow-x-auto">
            <table class="table table-sm">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Status</th>
                  <th scope="col" class="text-right">Successes</th>
                  <th scope="col" class="text-right">Failures</th>
                  <th scope="col" class="w-1">Actions</th>
                </tr>
              </thead>
              <tbody>
                @for (c of candidates(); track c.id) {
                  <tr
                    class="hover cursor-pointer"
                    [class.bg-base-300]="selectedCandidateId() === c.id"
                    (click)="onSelectRow(c.id)"
                  >
                    <td>
                      <div class="flex flex-col">
                        <span class="font-medium">{{ c.name }}</span>
                        <span class="text-xs text-base-content/60">
                          {{ c.description }}
                        </span>
                      </div>
                    </td>
                    <td>
                      <span class="badge badge-sm" [class]="statusClass(c)">
                        {{ c.status }}
                      </span>
                    </td>
                    <td class="text-right tabular-nums">
                      {{ c.successCount }}
                    </td>
                    <td class="text-right tabular-nums">
                      {{ c.failureCount }}
                    </td>
                    <td>
                      <div class="flex justify-end gap-1">
                        <button
                          type="button"
                          class="btn btn-xs btn-success"
                          [disabled]="c.status === 'promoted' || loading()"
                          (click)="onOpenAction('promote', c, $event)"
                        >
                          Promote
                        </button>
                        <button
                          type="button"
                          class="btn btn-xs btn-error btn-outline"
                          [disabled]="c.status === 'rejected' || loading()"
                          (click)="onOpenAction('reject', c, $event)"
                        >
                          Reject
                        </button>
                      </div>
                    </td>
                  </tr>
                } @empty {
                  <tr>
                    <td
                      colspan="5"
                      class="text-center text-sm text-base-content/60"
                    >
                      @if (loading()) {
                        <span>Loading candidates&hellip;</span>
                      } @else {
                        <span>No candidates for this filter.</span>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <!-- Drill-down: invocations for the selected candidate -->
      @if (selectedCandidate(); as sc) {
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Invocation history"
        >
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-sm">
                Invocations &mdash;
                <span class="font-mono text-xs">{{ sc.name }}</span>
              </h2>
              <button
                type="button"
                class="btn btn-ghost btn-xs"
                (click)="onClearSelection()"
              >
                Close
              </button>
            </div>

            @if (invocations().length === 0) {
              <div class="text-xs text-base-content/60">
                No invocations recorded for this candidate yet.
              </div>
            } @else {
              <div class="overflow-x-auto">
                <table class="table table-xs">
                  <thead>
                    <tr>
                      <th scope="col">When</th>
                      <th scope="col">Session</th>
                      <th scope="col">Outcome</th>
                      <th scope="col">Notes</th>
                    </tr>
                  </thead>
                  <tbody>
                    @for (inv of invocations(); track inv.id) {
                      <tr>
                        <td class="font-mono text-xs">
                          {{ formatTime(inv.invokedAt) }}
                        </td>
                        <td class="font-mono text-xs">{{ inv.sessionId }}</td>
                        <td>
                          <span
                            class="badge badge-xs"
                            [class.badge-success]="inv.succeeded"
                            [class.badge-error]="!inv.succeeded"
                          >
                            {{ inv.succeeded ? 'success' : 'failure' }}
                          </span>
                        </td>
                        <td class="text-xs">{{ inv.notes ?? '—' }}</td>
                      </tr>
                    }
                  </tbody>
                </table>
              </div>
            }
          </div>
        </section>
      }

      <!-- Settings panel (read-only) -->
      <section
        class="card bg-base-200 shadow-sm"
        aria-label="Skill synthesis settings"
      >
        <div class="card-body p-4">
          <h2 class="card-title text-sm">Settings (read-only)</h2>
          <p class="text-xs text-base-content/60">
            Configure these in your settings file.
          </p>
          <ul class="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
            @for (key of settingsKeys; track key) {
              <li class="font-mono">
                <span class="text-base-content/70">{{ key }}</span>
              </li>
            }
          </ul>
        </div>
      </section>
    </div>

    <!-- Action modal (Promote / Reject with optional reason) -->
    @if (actionDialog(); as dlg) {
      <dialog
        class="modal modal-open"
        role="dialog"
        aria-modal="true"
        [attr.aria-label]="dlg.kind + ' candidate'"
      >
        <div class="modal-box">
          <h3 class="text-base font-semibold">
            {{ dlg.kind === 'promote' ? 'Promote' : 'Reject' }} candidate
          </h3>
          <p class="mt-1 text-sm text-base-content/70">
            <span class="font-mono">{{ dlg.candidate.name }}</span>
          </p>

          <label class="form-control mt-3 w-full">
            <span class="label-text text-xs">
              Reason
              <span class="text-base-content/50">(optional)</span>
            </span>
            <textarea
              class="textarea textarea-bordered textarea-sm mt-1 w-full"
              rows="3"
              [(ngModel)]="actionReason"
              [attr.aria-label]="dlg.kind + ' reason'"
            ></textarea>
          </label>

          <div class="modal-action">
            <button
              type="button"
              class="btn btn-ghost btn-sm"
              [disabled]="loading()"
              (click)="onCloseDialog()"
            >
              Cancel
            </button>
            <button
              type="button"
              class="btn btn-sm"
              [class.btn-success]="dlg.kind === 'promote'"
              [class.btn-error]="dlg.kind === 'reject'"
              [disabled]="loading()"
              (click)="onConfirmDialog()"
            >
              {{ dlg.kind === 'promote' ? 'Promote' : 'Reject' }}
            </button>
          </div>
        </div>
      </dialog>
    }
  `,
})
export class SkillSynthesisTabComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);

  // Re-export state signals for the template.
  public readonly candidates = this.state.candidates;
  public readonly invocations = this.state.invocations;
  public readonly stats = this.state.stats;
  public readonly statusFilter = this.state.statusFilter;
  public readonly selectedCandidateId = this.state.selectedCandidateId;
  public readonly selectedCandidate = this.state.selectedCandidate;
  public readonly loading = this.state.loading;
  public readonly error = this.state.error;

  /** Filter chip definitions, ordered for the tablist. */
  protected readonly filters: ReadonlyArray<{
    readonly id: SkillStatusFilter;
    readonly label: string;
  }> = [
    { id: 'pending', label: 'Pending' },
    { id: 'promoted', label: 'Promoted' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'all', label: 'All' },
  ];

  /**
   * Read-only settings keys surfaced in the settings panel. These are
   * file-based settings (`~/.ptah/settings.json`) consumed by the
   * `skill-synthesis` backend service.
   */
  protected readonly settingsKeys: readonly string[] = [
    'skillSynthesis.enabled',
    'skillSynthesis.successesToPromote',
    'skillSynthesis.dedupCosineThreshold',
    'skillSynthesis.maxActiveSkills',
    'skillSynthesis.candidatesDir',
  ];

  /** Current action dialog (promote/reject) or `null` when closed. */
  public readonly actionDialog = signal<ActionDialogState | null>(null);

  /** Two-way bound reason text for the action modal. */
  public actionReason = '';

  /** Whether any action button should be disabled while a row is busy. */
  public readonly anyBusy = computed(() => this.loading());

  public ngOnInit(): void {
    void this.state.refreshCandidates();
    void this.state.loadStats();
  }

  protected onFilterChange(filter: SkillStatusFilter): void {
    void this.state.setStatusFilter(filter);
  }

  protected onSelectRow(id: string): void {
    if (this.selectedCandidateId() === id) {
      void this.state.selectCandidate(null);
      return;
    }
    void this.state.selectCandidate(id);
  }

  protected onClearSelection(): void {
    void this.state.selectCandidate(null);
  }

  protected onOpenAction(
    kind: ActionKind,
    candidate: SkillSynthesisCandidateSummary,
    event: Event,
  ): void {
    event.stopPropagation();
    this.actionReason = '';
    this.actionDialog.set({ kind, candidate });
  }

  protected onCloseDialog(): void {
    this.actionDialog.set(null);
    this.actionReason = '';
  }

  protected async onConfirmDialog(): Promise<void> {
    const dlg = this.actionDialog();
    if (!dlg) return;
    const reason = this.actionReason.trim() || undefined;
    if (dlg.kind === 'promote') {
      await this.state.promote(dlg.candidate.id, reason);
    } else {
      await this.state.reject(dlg.candidate.id, reason);
    }
    await this.state.loadStats();
    this.actionDialog.set(null);
    this.actionReason = '';
  }

  protected statusClass(c: SkillSynthesisCandidateSummary): string {
    switch (c.status) {
      case 'promoted':
        return 'badge-success';
      case 'rejected':
        return 'badge-error';
      default:
        return 'badge-ghost';
    }
  }

  protected formatTime(epochMs: number): string {
    if (!Number.isFinite(epochMs)) return '—';
    return new Date(epochMs).toLocaleString();
  }

  protected trackInvocation(
    _index: number,
    item: SkillSynthesisInvocationEntry,
  ): string {
    return item.id;
  }
}
