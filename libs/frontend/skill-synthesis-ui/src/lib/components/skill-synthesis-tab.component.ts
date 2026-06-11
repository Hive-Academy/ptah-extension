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
  SkillSynthesisSettingsDto,
  SkillSynthesisRunCuratorResult,
} from '@ptah-extension/shared';

import {
  SkillStatusFilter,
  SkillSynthesisStateService,
} from '../services/skill-synthesis-state.service';
import { SkillSynthesisRpcService } from '../services/skill-synthesis-rpc.service';
import { SkillDiagnosticsStateService } from '../services/skill-diagnostics-state.service';
import { SkillDiagnosticsAccordionComponent } from './diagnostics/skill-diagnostics-accordion.component';
import { SkillClonesViewComponent } from './clones/skill-clones-view.component';
import { SkillStatsStripComponent } from './skill-stats-strip.component';
import { SkillPipelineStatusComponent } from './skill-pipeline-status.component';
import {
  SkillCandidatesTableComponent,
  type SkillCandidateAction,
} from './skill-candidates-table.component';
import { SkillInvocationsPanelComponent } from './skill-invocations-panel.component';
import { SkillSettingsPanelComponent } from './skill-settings-panel.component';

type ActionKind = 'promote' | 'reject';

interface ActionDialogState {
  readonly kind: ActionKind;
  readonly candidate: SkillSynthesisCandidateSummary;
}

@Component({
  selector: 'ptah-skill-synthesis-tab',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    CommonModule,
    FormsModule,
    ReactiveFormsModule,
    SkillDiagnosticsAccordionComponent,
    SkillClonesViewComponent,
    SkillStatsStripComponent,
    SkillPipelineStatusComponent,
    SkillCandidatesTableComponent,
    SkillInvocationsPanelComponent,
    SkillSettingsPanelComponent,
  ],
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
      <div class="flex h-full w-full flex-col gap-3">
        <div class="flex flex-wrap items-center gap-2">
          <nav role="tablist" aria-label="Status filter" class="join">
            @for (f of filters; track f.id) {
              <button
                type="button"
                role="tab"
                class="join-item btn btn-sm"
                [attr.data-testid]="'skills-filter-' + f.id"
                [class.btn-primary]="statusFilter() === f.id"
                [attr.aria-selected]="statusFilter() === f.id"
                (click)="onFilterChange(f.id)"
              >
                {{ f.label }}
              </button>
            }
          </nav>
          <div class="ml-auto flex gap-1">
            <button
              type="button"
              class="btn btn-sm btn-outline"
              [disabled]="curatorRunning() || loading()"
              (click)="onRunCurator()"
            >
              @if (curatorRunning()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Run Curator
            </button>
          </div>
        </div>

        <ptah-skill-stats-strip [stats]="stats()" />

        <ptah-skill-pipeline-status
          [lastAnalyzeRunAt]="lastAnalyzeRunAt()"
          [histogram]="eligibilityHistogram()"
          [recentEvents]="recentEvents()"
        />

        @if (error(); as msg) {
          <div role="alert" class="alert alert-error py-2 text-sm">
            <span>{{ msg }}</span>
          </div>
        }

        <ptah-skill-candidates-table
          [candidates]="candidates()"
          [selectedCandidateId]="selectedCandidateId()"
          [loading]="loading()"
          (selectRow)="onSelectRow($event)"
          (promote)="onOpenAction('promote', $event)"
          (reject)="onOpenAction('reject', $event)"
          (togglePin)="onTogglePin($event)"
        />

        @if (selectedCandidate(); as sc) {
          <ptah-skill-invocations-panel
            [candidate]="sc"
            [invocations]="invocations()"
            (closed)="onClearSelection()"
          />
        }

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

        <ptah-skill-settings-panel
          [form]="settingsForm"
          [loaded]="settingsLoaded()"
          [saving]="loading()"
          (save)="onSaveSettings()"
        />

        <details
          class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-100"
          data-test="clones-accordion"
          [open]="clonesOpen()"
          (toggle)="onClonesToggle($event)"
        >
          <summary
            class="collapse-title min-h-0 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-base-content/70"
          >
            Clones
          </summary>
          <div class="collapse-content">
            @if (clonesOpen()) {
              <ptah-skill-clones-view />
            }
          </div>
        </details>

        <details
          class="collapse collapse-arrow rounded-lg border border-base-300 bg-base-100"
          data-test="diagnostics-accordion"
          [open]="diagnosticsOpen()"
          (toggle)="onDiagnosticsToggle($event)"
        >
          <summary
            class="collapse-title min-h-0 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-base-content/70"
          >
            Diagnostics
          </summary>
          <div class="collapse-content">
            @if (diagnosticsOpen()) {
              <ptah-skill-diagnostics-accordion />
            }
          </div>
        </details>

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
                data-testid="skills-action-confirm"
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
  private readonly diagnostics = inject(SkillDiagnosticsStateService);
  private readonly fb = inject(FormBuilder);

  public readonly isElectron = computed(
    () => this.vscodeService.config()?.isElectron === true,
  );

  public readonly candidates = this.state.candidates;
  public readonly invocations = this.state.invocations;
  public readonly stats = this.state.stats;
  public readonly statusFilter = this.state.statusFilter;
  public readonly selectedCandidateId = this.state.selectedCandidateId;
  public readonly selectedCandidate = this.state.selectedCandidate;
  public readonly loading = this.state.loading;
  public readonly error = this.state.error;

  public readonly lastAnalyzeRunAt = this.diagnostics.lastAnalyzeRunAt;
  public readonly eligibilityHistogram = this.diagnostics.eligibilityHistogram;
  public readonly recentEvents = this.diagnostics.recentEvents;

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

  public readonly settingsLoaded = signal<boolean>(false);

  public readonly toast = signal<{
    message: string;
    kind: 'success' | 'error';
  } | null>(null);

  public readonly curatorRunning = signal<boolean>(false);

  public readonly curatorReport = signal<SkillSynthesisRunCuratorResult | null>(
    null,
  );

  protected readonly filters: ReadonlyArray<{
    readonly id: SkillStatusFilter;
    readonly label: string;
  }> = [
    { id: 'pending', label: 'Pending' },
    { id: 'promoted', label: 'Promoted' },
    { id: 'rejected', label: 'Rejected' },
    { id: 'all', label: 'All' },
  ];

  public readonly actionDialog = signal<ActionDialogState | null>(null);

  public actionReason = '';

  private readonly _clonesOpen = signal<boolean>(false);
  protected readonly clonesOpen = this._clonesOpen.asReadonly();
  private readonly _diagnosticsOpen = signal<boolean>(false);
  protected readonly diagnosticsOpen = this._diagnosticsOpen.asReadonly();

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshCandidates();
    void this.state.loadStats();
    void this.diagnostics.refresh();
    void this.loadSettings();
  }

  private async loadSettings(): Promise<void> {
    try {
      await this.state.loadSettings();
      const s = this.state.settings();
      if (s) {
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
      const sf = this.settingsForm.value as SkillSynthesisSettingsDto;
      await this.rpc.updateSettings(sf);
      this.showToast('Settings saved.', 'success');
    } catch (err: unknown) {
      this.showToast(err instanceof Error ? err.message : String(err), 'error');
    }
  }

  protected async onTogglePin(action: SkillCandidateAction): Promise<void> {
    action.event.stopPropagation();
    const c = action.candidate;
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

  protected onClonesToggle(event: Event): void {
    const target = event.target as HTMLDetailsElement | null;
    if (target) {
      this._clonesOpen.set(target.open);
    }
  }

  protected onDiagnosticsToggle(event: Event): void {
    const target = event.target as HTMLDetailsElement | null;
    if (target) {
      this._diagnosticsOpen.set(target.open);
    }
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

  protected onOpenAction(kind: ActionKind, action: SkillCandidateAction): void {
    action.event.stopPropagation();
    this.actionReason = '';
    this.actionDialog.set({ kind, candidate: action.candidate });
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
}
