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
import { LucideAngularModule, Sparkles } from 'lucide-angular';
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

type SkillSubView = 'candidates' | 'activity' | 'clones' | 'settings';

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
    LucideAngularModule,
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
      <div
        class="flex flex-col items-center gap-2 px-6 py-16 text-center"
        role="alert"
      >
        <lucide-angular
          [img]="SparklesIcon"
          class="size-8 text-base-content/30"
          aria-hidden="true"
        />
        <p class="text-sm font-medium">
          Skill synthesis is only available in the Ptah desktop app.
        </p>
        <p class="text-xs text-base-content/60">
          Download Ptah desktop to let Thoth synthesize reusable skills from
          your sessions.
        </p>
        <a
          class="link link-primary text-xs"
          href="https://github.com/HiveAcademy/ptah-extension/releases"
          target="_blank"
          rel="noopener noreferrer"
          >Download Ptah desktop</a
        >
      </div>
    } @else {
      <div class="space-y-6">
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="flex items-start gap-3">
            <span
              class="mt-0.5 flex size-10 shrink-0 items-center justify-center rounded-xl border border-base-content/10 bg-base-200/60 text-secondary"
            >
              <lucide-angular
                [img]="SparklesIcon"
                class="w-5 h-5"
                aria-hidden="true"
              />
            </span>
            <div>
              <h1 class="text-xl font-semibold tracking-tight">Skills</h1>
              <p class="mt-0.5 text-sm text-base-content/60">
                Reusable skills Thoth synthesizes from successful sessions.
              </p>
            </div>
          </div>
          <div class="flex items-center gap-2">
            <button
              type="button"
              class="btn btn-primary btn-sm transition-colors duration-150"
              [disabled]="curatorRunning() || loading()"
              (click)="onRunCurator()"
            >
              @if (curatorRunning()) {
                <span class="loading loading-spinner loading-xs"></span>
              }
              Run Curator
            </button>
          </div>
        </header>

        <ptah-skill-stats-strip [stats]="stats()" />

        <div
          role="tablist"
          aria-label="Skills views"
          class="tabs tabs-boxed tabs-sm w-fit bg-base-200 p-1"
        >
          @for (v of subViews; track v.id) {
            <button
              type="button"
              role="tab"
              class="tab transition-colors duration-150"
              [class.tab-active]="subView() === v.id"
              [attr.aria-selected]="subView() === v.id"
              (click)="setSubView(v.id)"
            >
              {{ v.label }}
            </button>
          }
        </div>

        @switch (subView()) {
          @case ('candidates') {
            <div class="space-y-4">
              <nav
                role="tablist"
                aria-label="Status filter"
                class="tabs tabs-boxed tabs-sm w-fit bg-base-200 p-1"
              >
                @for (f of filters; track f.id) {
                  <button
                    type="button"
                    role="tab"
                    class="tab transition-colors duration-150"
                    [attr.data-testid]="'skills-filter-' + f.id"
                    [class.tab-active]="statusFilter() === f.id"
                    [attr.aria-selected]="statusFilter() === f.id"
                    (click)="onFilterChange(f.id)"
                  >
                    {{ f.label }}
                  </button>
                }
              </nav>

              @if (ineligibleHint(); as hint) {
                <p class="text-xs text-base-content/60">{{ hint }}</p>
              }

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
            </div>
          }
          @case ('activity') {
            <div class="space-y-4">
              <ptah-skill-pipeline-status
                [lastAnalyzeRunAt]="lastAnalyzeRunAt()"
                [histogram]="eligibilityHistogram()"
                [recentEvents]="recentEvents()"
              />
              <ptah-skill-diagnostics-accordion />
            </div>
          }
          @case ('clones') {
            <div class="space-y-4">
              <ptah-skill-clones-view />
            </div>
          }
          @case ('settings') {
            <div class="space-y-4">
              <ptah-skill-settings-panel
                [form]="settingsForm"
                [loaded]="settingsLoaded()"
                [saving]="loading()"
                (save)="onSaveSettings()"
              />
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
            </div>
          }
        }

        @if (curatorReport(); as report) {
          <dialog
            class="modal modal-open"
            role="dialog"
            aria-modal="true"
            aria-label="Curator report"
          >
            <div class="modal-box">
              <h3 class="text-base font-semibold">Curator report</h3>
              <div class="mt-2 space-y-1 text-sm">
                <p class="break-all font-mono text-xs">
                  {{ report.reportPath || '(no report path)' }}
                </p>
                <p>
                  <span class="font-medium">Changes queued:</span>
                  {{ report.changesQueued }}
                </p>
                <p>
                  <span class="font-medium">Skipped (pinned):</span>
                  {{ report.skippedPinned }}
                </p>
              </div>
              @if (report.overlaps && report.overlaps.length > 0) {
                <div class="mt-3">
                  <p class="mb-1 text-xs font-medium">Overlaps:</p>
                  <ul class="list-inside list-disc space-y-1 text-xs">
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

            <label class="mt-3 flex flex-col gap-1">
              <span class="text-xs text-base-content/60">
                Reason
                <span class="text-base-content/50">(optional)</span>
              </span>
              <textarea
                class="textarea textarea-bordered textarea-sm w-full"
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
                class="btn btn-sm transition-colors duration-150"
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

  protected readonly SparklesIcon = Sparkles;

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

  public readonly ineligibleHint = computed<string | null>(() => {
    const events = this.recentEvents();
    if (events.length === 0) return null;
    const latest = events[0];
    if (latest.kind === 'ineligible') {
      return 'Recent sessions were marked ineligible — see Activity for the breakdown.';
    }
    if (latest.kind === 'rate-limited') {
      return 'Analysis was rate-limited — see Activity for details.';
    }
    return null;
  });

  public readonly settingsForm: FormGroup = this.fb.group({
    enabled: [true],
    successesToPromote: [3],
    dedupCosineThreshold: [0.85],
    maxActiveSkills: [50],
    candidatesDir: [''],
    eligibilityMinTurns: [5],
    evictionDecayRate: [0.95],
    generalizationContextThreshold: [3],
    dedupClusterThreshold: [0.78],
    prefilterMinEdits: [1],
    prefilterMinChars: [800],
    prefilterMinToolUses: [2],
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

  protected readonly subViews: ReadonlyArray<{
    readonly id: SkillSubView;
    readonly label: string;
  }> = [
    { id: 'candidates', label: 'Candidates' },
    { id: 'activity', label: 'Activity' },
    { id: 'clones', label: 'Clones' },
    { id: 'settings', label: 'Settings' },
  ];

  private readonly _subView = signal<SkillSubView>('candidates');
  protected readonly subView = this._subView.asReadonly();

  public readonly actionDialog = signal<ActionDialogState | null>(null);

  public actionReason = '';

  public ngOnInit(): void {
    if (!this.isElectron()) return;
    void this.state.refreshCandidates();
    void this.state.loadStats();
    void this.diagnostics.refresh();
    void this.loadSettings();
  }

  protected setSubView(view: SkillSubView): void {
    this._subView.set(view);
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
