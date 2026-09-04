import { Injectable, computed, inject, signal } from '@angular/core';
import type {
  MultiPhaseAnalysisResponse,
  ResumableGenerationAgent,
  ResumableGenerationRun,
} from '@ptah-extension/shared';

import { SetupWizardStateService } from './setup-wizard-state.service';
import type { SkillGenerationProgressItem } from './setup-wizard-state.types';
import { WizardRpcService } from './wizard-rpc.service';

/**
 * WizardAnalysisRunner — owns the deep-analysis run, not the component that
 * displays it.
 *
 * The wizard is rendered inside the app shell's `@switch`, so navigating to
 * any other view destroys `ScanProgressComponent` mid-run. When the run lived
 * in the component, every `await` was guarded by an `isDestroyed` flag and the
 * resolved `MultiPhaseAnalysisResponse` was dropped on the floor — the backend
 * had done the whole analysis, nothing stored it, and returning to Setup
 * started it again from zero.
 *
 * This service is `providedIn: 'root'`, so the run outlives the view: results
 * always land in `SetupWizardStateService`, and a component that remounts
 * mid-run re-attaches to the same promise instead of launching a second one.
 *
 * Staleness is tracked by a run token rather than component lifetime. Only a
 * cancel or a reset invalidates a run; a destroyed view does not.
 */
/**
 * Map a persisted checkpoint agent onto an item-progress entry. Agents whose
 * file is already terminal (`written`/`unchanged`) show as complete; every
 * other status re-runs on resume and starts as pending.
 */
function toProgressItem(
  agent: ResumableGenerationAgent,
): SkillGenerationProgressItem {
  const done = agent.status === 'written' || agent.status === 'unchanged';
  const fileName = agent.filePath.split(/[\\/]/).pop();
  return {
    id: agent.agentId,
    name: fileName && fileName.length > 0 ? fileName : agent.agentId,
    type: 'agent',
    status: done ? 'complete' : 'pending',
    ...(done ? { progress: 100 } : {}),
  };
}

@Injectable({
  providedIn: 'root',
})
export class WizardAnalysisRunner {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);

  private readonly INITIAL_STATUS = 'Initializing workspace scan...';

  /** The run in progress, so a remounting view joins it instead of forking. */
  private inFlight: Promise<void> | null = null;

  /**
   * Incremented by `cancel()` / `reset()`. A run whose token no longer matches
   * writes nothing — its result belongs to a flow the user has left.
   */
  private runToken = 0;

  /** One-shot guard: `wizard:get-resumable-run` is queried once per session. */
  private discoveryDone = false;

  private readonly _isRunning = signal(false);
  private readonly _isCanceling = signal(false);
  private readonly _statusText = signal(this.INITIAL_STATUS);
  private readonly _errorMessage = signal<string | null>(null);
  private readonly _resumableAnalysis =
    signal<MultiPhaseAnalysisResponse | null>(null);
  private readonly _resumableGeneration = signal<ResumableGenerationRun | null>(
    null,
  );

  public readonly isRunning = this._isRunning.asReadonly();
  public readonly isCanceling = this._isCanceling.asReadonly();
  public readonly statusText = this._statusText.asReadonly();
  public readonly errorMessage = this._errorMessage.asReadonly();
  /** An unfinished persisted analysis the user can resume or discard. */
  public readonly resumableAnalysis = this._resumableAnalysis.asReadonly();
  /** An unfinished persisted generation run the user can resume. */
  public readonly resumableGeneration = this._resumableGeneration.asReadonly();

  /** True once the wizard holds a result — the view can render it directly. */
  public readonly hasResult = computed(
    () => this.wizardState.multiPhaseResult() !== null,
  );

  /**
   * Start the analysis unless one is already running. Safe to call from every
   * `ngOnInit` — a remount during a run joins the existing promise, and a
   * remount after one resolves re-uses the stored result.
   *
   * The first call performs resume discovery. When an unfinished analysis is
   * found, the runner holds instead of starting a fresh run: the prior run is
   * never deleted or restarted automatically — the user chooses through
   * `resumeAnalysis()` or `startFreshAnalysis()`.
   */
  public ensureStarted(): Promise<void> {
    return this.launch(() => this.launchAfterDiscovery());
  }

  /** Re-run after a failure. Identical to `ensureStarted()` by design. */
  public retry(): Promise<void> {
    return this.ensureStarted();
  }

  /** Continue the discovered unfinished analysis on the backend. */
  public resumeAnalysis(): Promise<void> {
    this._resumableAnalysis.set(null);
    return this.launch(() => this.run(true));
  }

  /** Discard the resume offer and run a fresh analysis. */
  public startFreshAnalysis(): Promise<void> {
    this._resumableAnalysis.set(null);
    return this.launch(() => this.run(false));
  }

  /**
   * Resume the discovered generation run.
   *
   * Seeds the item-progress signal from the persisted checkpoint agents
   * (backend state, not frontend memory), moves to the generation step, and
   * asks the backend to continue via `wizard:submit-selection { resume: true }`.
   */
  public async resumeGeneration(): Promise<void> {
    const checkpoint = this._resumableGeneration();
    if (!checkpoint) {
      return;
    }
    this._resumableGeneration.set(null);
    this.wizardState.setSkillGenerationProgress(
      checkpoint.agents.map((agent) => toProgressItem(agent)),
    );
    this.wizardState.setCurrentStep('generation');
    try {
      await this.wizardRpc.resumeGeneration();
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : 'Failed to resume generation.';
      console.error('[WizardAnalysisRunner] Resume generation failed:', error);
      // Nothing ran: mark the still-pending items as failed so the
      // generation view reports the truth instead of hanging.
      this.wizardState.setSkillGenerationProgress(
        this.wizardState
          .skillGenerationProgress()
          .map((item) =>
            item.status === 'pending'
              ? { ...item, status: 'error' as const, errorMessage: message }
              : item,
          ),
      );
    }
  }

  /** Share the in-flight promise so concurrent starts never fork a run. */
  private launch(start: () => Promise<void>): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const run = start().finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
    return run;
  }

  /** First-start path: discover a resumable run, then hold or analyze. */
  private async launchAfterDiscovery(): Promise<void> {
    const token = this.runToken;
    await this.discoverResumableRun();
    if (token !== this.runToken) {
      // A cancel/reset landed while discovery was in flight.
      return;
    }
    if (this._resumableAnalysis()) {
      this._statusText.set('An unfinished analysis was found.');
      return;
    }
    return this.run(false);
  }

  private async discoverResumableRun(): Promise<void> {
    if (this.discoveryDone) {
      return;
    }
    this.discoveryDone = true;

    const resumable = await this.wizardRpc.getResumableRun();
    if (resumable.generation) {
      this._resumableGeneration.set(resumable.generation);
    }
    const analysis = resumable.analysis;
    if (!analysis) {
      return;
    }
    if (analysis.manifest.lifecycle === 'completed') {
      // Not resumable — adopt it as the stored result so the wizard can
      // continue where it stopped (e.g. resume its generation run).
      if (!this.wizardState.multiPhaseResult()) {
        this.wizardState.setMultiPhaseResult(analysis);
      }
      return;
    }
    this._resumableAnalysis.set(analysis);
  }

  /**
   * Cancel the backend analysis and clear the wizard.
   *
   * The token bump lands before the RPC so the in-flight run cannot write its
   * result (or advance the step) after the user has already cancelled.
   */
  public async cancel(): Promise<void> {
    this._isCanceling.set(true);
    this._statusText.set('Canceling analysis...');
    this.runToken++;
    this.inFlight = null;
    try {
      await this.wizardRpc.cancelAnalysis();
    } finally {
      this.reset();
      this.wizardState.reset();
    }
  }

  /** Drop runner-local UI state and invalidate any run still in flight. */
  public reset(): void {
    this.runToken++;
    this.inFlight = null;
    this._isRunning.set(false);
    this._isCanceling.set(false);
    this._errorMessage.set(null);
    this._statusText.set(this.INITIAL_STATUS);
  }

  private async run(resume: boolean): Promise<void> {
    const token = ++this.runToken;
    this._isRunning.set(true);
    this._errorMessage.set(null);

    try {
      const existingMultiPhase = this.wizardState.multiPhaseResult();
      if (existingMultiPhase) {
        if (this.wizardState.recommendations().length === 0) {
          this._statusText.set('Calculating agent recommendations...');
          const recommendations =
            await this.wizardRpc.recommendAgents(existingMultiPhase);
          if (token !== this.runToken) return;
          this.wizardState.setRecommendations(recommendations);
        }
        this.wizardState.setCurrentStep('analysis');
        return;
      }

      this._statusText.set(
        resume
          ? 'Resuming project analysis...'
          : 'Analyzing project structure...',
      );
      const multiPhaseResult = await this.wizardRpc.deepAnalyze({ resume });
      if (token !== this.runToken) return;
      this.wizardState.setMultiPhaseResult(multiPhaseResult);

      this._statusText.set('Calculating agent recommendations...');
      const recommendations =
        await this.wizardRpc.recommendAgents(multiPhaseResult);
      if (token !== this.runToken) return;
      this.wizardState.setRecommendations(recommendations);

      this.wizardState.setCurrentStep('analysis');
    } catch (error: unknown) {
      if (token !== this.runToken) return;
      const message =
        error instanceof Error
          ? error.message
          : 'Analysis failed. Please try again.';
      this._errorMessage.set(message);
      this._statusText.set('Analysis failed');
      console.error('[WizardAnalysisRunner] Analysis failed:', error);
    } finally {
      if (token === this.runToken) {
        this._isRunning.set(false);
      }
    }
  }
}
