import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  FormsModule,
  ReactiveFormsModule,
  FormBuilder,
  FormGroup,
} from '@angular/forms';
import { VSCodeService } from '@ptah-extension/core';
import type {
  SkillSynthesisCandidateSummary,
  SkillSynthesisInvocationEntry,
  SkillSynthesisRunCuratorResult,
  SkillSynthesisSettingsDto,
} from '@ptah-extension/shared';

import {
  SkillStatusFilter,
  SkillSynthesisStateService,
} from '../services/skill-synthesis-state.service';
import { SkillSynthesisRpcService } from '../services/skill-synthesis-rpc.service';

type ActionKind = 'promote' | 'reject';

interface ActionDialogState {
  readonly kind: ActionKind;
  readonly candidate: SkillSynthesisCandidateSummary;
}

/**
 * SkillSynthesisTabComponent
 *
 * Skills tab inside the Thoth shell. Renders:
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
  imports: [CommonModule, FormsModule, ReactiveFormsModule],
  template: `
    @if (!isElectron()) {
      <div role="alert" class="alert alert-info">
        <span class="text-sm">
          Skill synthesis is only available in the Ptah desktop app.
          <a
            class="link link-primary ml-1"
            href="https://github.com/HiveAcademy/ptah-extension/releases"
            target="_blank"
            rel="noopener noreferrer"
            >Download Ptah desktop</a
          >.
        </span>
      </div>
    } @else {
      <div class="flex h-full w-full flex-col gap-4">
        <!-- Stats card -->
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Skill synthesis stats"
        >
          <div class="card-body p-4">
            <div class="flex items-center justify-between">
              <h2 class="card-title text-sm">Stats</h2>
              <button
                type="button"
                class="btn btn-sm btn-outline"
                [disabled]="curatorRunning() || loading()"
                (click)="onRunCurator()"
              >
                {{ curatorRunning() ? 'Running...' : 'Run Curator' }}
              </button>
            </div>
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
        <section
          class="card bg-base-200 shadow-sm"
          aria-label="Skill candidates"
        >
          <div class="card-body p-0">
            <div class="overflow-x-auto">
              <table class="table table-sm">
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Status</th>
                    <th scope="col">Pinned</th>
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
                      <td>
                        @if (c.pinned) {
                          <span class="badge badge-warning badge-xs"
                            >Pinned</span
                          >
                        }
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
                          @if (c.status === 'promoted') {
                            <button
                              type="button"
                              class="btn btn-xs btn-outline"
                              [disabled]="loading()"
                              (click)="onTogglePin(c, $event)"
                            >
                              {{ c.pinned ? 'Unpin' : 'Pin' }}
                            </button>
                          }
                        </div>
                      </td>
                    </tr>
                  } @empty {
                    <tr>
                      <td
                        colspan="6"
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

        <!-- Toast notification -->
        @if (toast(); as t) {
          <div
            role="alert"
            class="alert py-2 text-sm"
            [class.alert-success]="t.kind === 'success'"
            [class.alert-error]="t.kind === 'error'"
          >
            <span>{{ t.message }}</span>
          </div>
        }

        <!-- Editable Settings form -->
        @if (settingsLoaded()) {
          <section
            class="card bg-base-200 shadow-sm"
            aria-label="Skill synthesis settings"
          >
            <div class="card-body p-4">
              <h2 class="card-title text-sm">Settings</h2>

              <form [formGroup]="settingsForm">
                <!-- Core settings -->
                <fieldset class="fieldset border border-base-300 rounded p-3">
                  <legend class="fieldset-legend text-xs font-semibold">
                    Core
                  </legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="form-control">
                      <span class="label label-text text-xs">Enabled</span>
                      <input
                        type="checkbox"
                        class="checkbox"
                        formControlName="enabled"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Successes to promote</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="successesToPromote"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Dedup cosine threshold</span
                      >
                      <input
                        type="number"
                        step="0.01"
                        class="input input-bordered input-sm"
                        formControlName="dedupCosineThreshold"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Max active skills</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="maxActiveSkills"
                      />
                    </label>
                    <label class="form-control sm:col-span-2">
                      <span class="label label-text text-xs"
                        >Candidates dir</span
                      >
                      <input
                        type="text"
                        class="input input-bordered input-sm"
                        formControlName="candidatesDir"
                      />
                    </label>
                  </div>
                </fieldset>

                <!-- Eligibility and Quality settings -->
                <fieldset
                  class="fieldset border border-base-300 rounded p-3 mt-2"
                >
                  <legend class="fieldset-legend text-xs font-semibold">
                    Eligibility &amp; Quality
                  </legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Eligibility min turns</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="eligibilityMinTurns"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Eviction decay rate (0-1)</span
                      >
                      <input
                        type="number"
                        step="0.01"
                        class="input input-bordered input-sm"
                        formControlName="evictionDecayRate"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Generalization context threshold</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="generalizationContextThreshold"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Min trajectory fidelity ratio (0-1)</span
                      >
                      <input
                        type="number"
                        step="0.01"
                        class="input input-bordered input-sm"
                        formControlName="minTrajectoryFidelityRatio"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Min abstraction edit distance (0-1)</span
                      >
                      <input
                        type="number"
                        step="0.01"
                        class="input input-bordered input-sm"
                        formControlName="minAbstractionEditDistance"
                      />
                    </label>
                  </div>
                </fieldset>

                <!-- Dedup settings -->
                <fieldset
                  class="fieldset border border-base-300 rounded p-3 mt-2"
                >
                  <legend class="fieldset-legend text-xs font-semibold">
                    Cluster Dedup
                  </legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Dedup cluster threshold (0-1)</span
                      >
                      <input
                        type="number"
                        step="0.01"
                        class="input input-bordered input-sm"
                        formControlName="dedupClusterThreshold"
                      />
                    </label>
                  </div>
                </fieldset>

                <!-- LLM Judge settings -->
                <fieldset
                  class="fieldset border border-base-300 rounded p-3 mt-2"
                >
                  <legend class="fieldset-legend text-xs font-semibold">
                    LLM Judge
                  </legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Judge enabled</span
                      >
                      <input
                        type="checkbox"
                        class="checkbox"
                        formControlName="judgeEnabled"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Min judge score (0-10)</span
                      >
                      <input
                        type="number"
                        step="0.1"
                        class="input input-bordered input-sm"
                        formControlName="minJudgeScore"
                      />
                    </label>
                    <label class="form-control sm:col-span-2">
                      <span class="label label-text text-xs"
                        >Judge model ('inherit' = workspace default)</span
                      >
                      <input
                        type="text"
                        class="input input-bordered input-sm"
                        formControlName="judgeModel"
                      />
                    </label>
                  </div>
                </fieldset>

                <!-- Pinning and Curator settings -->
                <fieldset
                  class="fieldset border border-base-300 rounded p-3 mt-2"
                >
                  <legend class="fieldset-legend text-xs font-semibold">
                    Pinning &amp; Curator
                  </legend>
                  <div class="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Max pinned skills</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="maxPinnedSkills"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Curator enabled</span
                      >
                      <input
                        type="checkbox"
                        class="checkbox"
                        formControlName="curatorEnabled"
                      />
                    </label>
                    <label class="form-control">
                      <span class="label label-text text-xs"
                        >Curator interval (hours)</span
                      >
                      <input
                        type="number"
                        class="input input-bordered input-sm"
                        formControlName="curatorIntervalHours"
                      />
                    </label>
                  </div>
                </fieldset>
              </form>

              <div class="mt-3 flex justify-end">
                <button
                  type="button"
                  class="btn btn-primary btn-sm"
                  [disabled]="loading() || settingsForm.invalid"
                  (click)="onSaveSettings()"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </section>
        } @else {
          <section
            class="card bg-base-200 shadow-sm"
            aria-label="Skill synthesis settings"
          >
            <div class="card-body p-4">
              <h2 class="card-title text-sm">Settings</h2>
              <div class="text-xs text-base-content/60">
                Loading settings&hellip;
              </div>
            </div>
          </section>
        }

        <!-- Curator report modal -->
        @if (curatorReport(); as report) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Curator report"
          >
            <div class="modal-box">
              <h3 class="text-base font-semibold">Curator Report</h3>
              <div class="mt-2 text-sm space-y-1">
                <p class="font-mono text-xs break-all">
                  {{ report.reportPath || '(no report path)' }}
                </p>
                <p>
                  <span class="font-semibold">Changes queued:</span>
                  {{ report.changesQueued }}
                </p>
                <p>
                  <span class="font-semibold">Skipped (pinned):</span>
                  {{ report.skippedPinned }}
                </p>
              </div>
              @if (report.overlaps && report.overlaps.length > 0) {
                <div class="mt-3">
                  <p class="text-xs font-semibold mb-1">Overlaps:</p>
                  <ul class="text-xs space-y-1 list-disc list-inside">
                    @for (o of report.overlaps; track o.skillIdA) {
                      <li>
                        {{ o.skillIdA }} ↔ {{ o.skillIdB }}: {{ o.reason }}
                      </li>
                    }
                  </ul>
                </div>
              }
              <div class="modal-action">
                <button
                  type="button"
                  class="btn btn-sm"
                  (click)="onCloseCuratorModal()"
                >
                  Close
                </button>
              </div>
            </div>
          </dialog>
        }
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
    }
  `,
})
export class SkillSynthesisTabComponent implements OnInit {
  private readonly state = inject(SkillSynthesisStateService);
  private readonly rpc = inject(SkillSynthesisRpcService);
  private readonly vscodeService = inject(VSCodeService);
  private readonly fb = inject(FormBuilder);

  /** Whether the webview is running inside the Electron desktop app. */
  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  // Re-export state signals for the template.
  public readonly candidates = this.state.candidates;
  public readonly invocations = this.state.invocations;
  public readonly stats = this.state.stats;
  public readonly statusFilter = this.state.statusFilter;
  public readonly selectedCandidateId = this.state.selectedCandidateId;
  public readonly selectedCandidate = this.state.selectedCandidate;
  public readonly loading = this.state.loading;
  public readonly error = this.state.error;

  /**
   * Reactive form for the 17 skill-synthesis settings fields.
   * Uses FormBuilder so Angular CD properly tracks mutations and validation
   * hooks are available per-field. Replaces the former `signal<SettingsDto>`
   * anti-pattern where `[(ngModel)]` mutated the signal's object in place
   * without triggering re-emission.
   */
  public readonly settingsForm: FormGroup = this.fb.group({
    enabled: [true],
    successesToPromote: [3],
    dedupCosineThreshold: [0.85],
    maxActiveSkills: [50],
    candidatesDir: [''],
    eligibilityMinTurns: [5],
    evictionDecayRate: [0.95],
    generalizationContextThreshold: [3],
    minTrajectoryFidelityRatio: [0.4],
    dedupClusterThreshold: [0.78],
    minAbstractionEditDistance: [0.3],
    judgeEnabled: [true],
    minJudgeScore: [6.0],
    judgeModel: ['inherit'],
    maxPinnedSkills: [10],
    curatorEnabled: [true],
    curatorIntervalHours: [24],
  });

  /** True once settings have been loaded from the backend. */
  public readonly settingsLoaded = signal<boolean>(false);

  /** Toast notification (auto-clears after 3s). */
  public readonly toast = signal<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  /** Curator in-flight state. */
  public readonly curatorRunning = signal<boolean>(false);

  /** Curator report to display in the modal (null = modal closed). */
  public readonly curatorReport = signal<SkillSynthesisRunCuratorResult | null>(
    null,
  );

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

  /** Current action dialog (promote/reject) or `null` when closed. */
  public readonly actionDialog = signal<ActionDialogState | null>(null);

  /** Two-way bound reason text for the action modal. */
  public actionReason = '';

  /** Whether any action button should be disabled while a row is busy. */
  public readonly anyBusy = computed(() => this.loading());

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshCandidates();
    void this.state.loadStats();
    void this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    try {
      // Route through the state service so the shared `settings` signal is populated.
      await this.state.loadSettings();
      const s = this.state.settings();
      if (s) {
        // patchValue replaces all form controls with the loaded values;
        // the FormGroup emits a new value so change detection fires correctly.
        this.settingsForm.patchValue(s);
      }
      this.settingsLoaded.set(true);
    } catch (err: unknown) {
      this.showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  protected async onSaveSettings(): Promise<void> {
    if (!this.settingsForm.valid) return;
    try {
      // Cast is safe: the form controls mirror SkillSynthesisSettingsDto exactly.
      const sf = this.settingsForm.value as SkillSynthesisSettingsDto;
      await this.rpc.updateSettings(sf);
      this.showToast('Settings saved.', 'success');
    } catch (err: unknown) {
      this.showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  protected async onTogglePin(
    c: SkillSynthesisCandidateSummary,
    event: Event,
  ): Promise<void> {
    event.stopPropagation();
    try {
      if (c.pinned) {
        await this.rpc.unpin(c.id);
      } else {
        await this.rpc.pin(c.id);
      }
      await this.state.refreshCandidates();
    } catch (err: unknown) {
      this.showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  protected async onRunCurator(): Promise<void> {
    this.curatorRunning.set(true);
    try {
      const result = await this.rpc.runCurator();
      this.curatorReport.set(result);
    } catch (err: unknown) {
      this.showToast(err instanceof Error ? err.message : String(err), 'error');
    } finally {
      this.curatorRunning.set(false);
    }
  }

  protected onCloseCuratorModal(): void {
    this.curatorReport.set(null);
  }

  private showToast(message: string, kind: 'success' | 'error'): void {
    this.toast.set({ message, kind });
    setTimeout(() => this.toast.set(null), 3000);
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
