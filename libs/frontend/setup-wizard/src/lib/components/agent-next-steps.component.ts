import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { AppStateManager, VSCodeService } from '@ptah-extension/core';
import type {
  FileOutcome,
  SetupGenerationResultFacts,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { GradeExpectationComponent } from './completion/grade-expectation.component';
import { LibraryStaleNoticeComponent } from './completion/library-stale-notice.component';
import { OutcomeSummaryComponent } from './completion/outcome-summary.component';
import {
  libraryReachable,
  type OutcomeFileRow,
} from './completion/outcome-rows';

type ResultOutcome = NonNullable<
  SetupGenerationResultFacts['agentOutcomes']
>[number];

/**
 * The five-outcome status of a result row. `rejected` is a failed write
 * (validation rejected its sections); `skipped` was never reached, so it has
 * no file outcome and is not listed.
 */
function fileOutcomeOf(status: ResultOutcome['status']): FileOutcome | null {
  if (status === 'skipped') return null;
  if (status === 'rejected') return 'failed';
  return status;
}

/**
 * Next steps at generation-sidebar width: the verified outcome summary (C9),
 * grade expectation (C11) and stale-Library notice (C10) of the bound run,
 * then the project-guidance handoff.
 */
@Component({
  selector: 'ptah-agent-next-steps',
  standalone: true,
  imports: [
    OutcomeSummaryComponent,
    GradeExpectationComponent,
    LibraryStaleNoticeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      class="rounded-lg border border-base-300 bg-base-200 p-4"
      aria-labelledby="agent-next-title"
    >
      <h2 id="agent-next-title" class="font-semibold">Next steps</h2>
      @if (result(); as facts) {
        <div class="mt-2 mb-3">
          <!-- Lazy chunk: the outcome views stay out of the initial bundle. -->
          @defer (on immediate) {
            <ptah-outcome-summary
              [rows]="outcomeRows()"
              [libraryDiverged]="facts.libraryDiverged ?? []"
              [target]="facts.target"
              [isElectron]="isElectron"
              [compact]="true"
              [outputDirectory]="outputDirectory()"
              (openLibrary)="openLibrary()"
            />
            @if (showsLibrary()) {
              <ptah-grade-expectation [rows]="outcomeRows()" />
              <ptah-library-stale-notice [libraryPass]="facts.libraryPass" />
            }
          }
        </div>
      }
      @if (pending()) {
        <p>Project guidance starts in {{ remainingSeconds() }} seconds.</p>
        <p class="text-xs text-base-content-muted">
          Will use: {{ previewProvider() || 'current workspace provider' }} ·
          {{ previewModel() || 'default model' }}
        </p>
        <button
          type="button"
          class="btn btn-primary btn-sm"
          (click)="startNow.emit()"
        >
          Start now
        </button>
        <button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="skip.emit()"
        >
          Skip guidance
        </button>
      } @else if (started()) {
        <p role="status">Project guidance started.</p>
      } @else {
        <p>
          {{
            skipped()
              ? 'Project guidance skipped. You can start it later.'
              : 'Generate project guidance when you are ready.'
          }}
        </p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="continue.emit()"
        >
          Continue to project guidance
        </button>
        @if (manualRecovery() && !skipped()) {
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            (click)="skip.emit()"
          >
            Skip guidance
          </button>
        }
      }
      <details class="mt-3 text-sm">
        <summary class="cursor-pointer">Quick Start examples</summary>
        <ol class="list-decimal pl-5 space-y-2 pt-2">
          <li>
            Start a development workflow:
            <code>/orchestrate Add user authentication</code>
          </li>
          <li>
            Available workflow types: FEATURE, BUGFIX, REFACTORING, DOCS,
            RESEARCH, DEVOPS.
          </li>
          <li>
            Fix a bug: <code>/orchestrate Fix login form validation</code>
          </li>
          <li>
            Refactor or document:
            <code>/orchestrate Refactor UserService</code> or
            <code>/orchestrate Create API docs</code>
          </li>
          <li>
            Continue an existing task: <code>/orchestrate TASK_2025_XXX</code>
          </li>
        </ol>
        <p>
          Tip: mention <code>@agent-name</code> and keep plans in
          <code>.ptah/specs/</code>.
        </p>
      </details>
    </section>
  `,
})
export class AgentNextStepsComponent {
  private readonly workflow = inject(GenerationWorkflowStore);
  private readonly appState = inject(AppStateManager);
  /** Library copy is Electron-only (D3). */
  protected readonly isElectron = inject(VSCodeService).isElectron === true;

  /** Verified result facts of the bound run; null until it reports outcomes. */
  protected readonly result = computed(() => {
    const result = this.workflow.run()?.result;
    return result?.agentOutcomes ? result : null;
  });

  protected readonly outcomeRows = computed<OutcomeFileRow[]>(() => {
    const rows: OutcomeFileRow[] = [];
    for (const agent of this.result()?.agentOutcomes ?? []) {
      const status = fileOutcomeOf(agent.status);
      if (!status) continue;
      rows.push({
        id: agent.agentId,
        fileName: agent.fileName || `${agent.agentId}.md`,
        status,
        ...(agent.error ? { error: agent.error } : {}),
      });
    }
    return rows;
  });

  /** Directory for the opened-folder notice, from the reported target. */
  protected readonly outputDirectory = computed(() => {
    const target = this.result()?.target;
    if (!target) return null;
    return target.chosen === 'opened-folder'
      ? target.openedFolder
      : target.harnessRoot;
  });

  protected readonly showsLibrary = computed(() =>
    libraryReachable(this.isElectron, this.result()?.target),
  );

  readonly started = input(false);
  readonly pending = input(false);
  readonly remainingSeconds = input(0);
  readonly previewModel = input<string | null>(null);
  readonly previewProvider = input<string | null>(null);
  readonly manualRecovery = input(false);
  readonly skipped = input(false);
  readonly startNow = output<void>();
  readonly continue = output<void>();
  readonly skip = output<void>();

  /** Open the Library filtered to the diverged copies this run named. */
  protected openLibrary(): void {
    this.appState.openSkillsDivergedClones();
  }
}
