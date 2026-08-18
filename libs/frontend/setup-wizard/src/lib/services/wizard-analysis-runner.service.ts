import { Injectable, computed, inject, signal } from '@angular/core';

import { SetupWizardStateService } from './setup-wizard-state.service';
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

  private readonly _isRunning = signal(false);
  private readonly _isCanceling = signal(false);
  private readonly _statusText = signal(this.INITIAL_STATUS);
  private readonly _errorMessage = signal<string | null>(null);

  public readonly isRunning = this._isRunning.asReadonly();
  public readonly isCanceling = this._isCanceling.asReadonly();
  public readonly statusText = this._statusText.asReadonly();
  public readonly errorMessage = this._errorMessage.asReadonly();

  /** True once the wizard holds a result — the view can render it directly. */
  public readonly hasResult = computed(
    () => this.wizardState.multiPhaseResult() !== null,
  );

  /**
   * Start the analysis unless one is already running. Safe to call from every
   * `ngOnInit` — a remount during a run joins the existing promise, and a
   * remount after one resolves re-uses the stored result.
   */
  public ensureStarted(): Promise<void> {
    if (this.inFlight) {
      return this.inFlight;
    }
    const run = this.run().finally(() => {
      if (this.inFlight === run) {
        this.inFlight = null;
      }
    });
    this.inFlight = run;
    return run;
  }

  /** Re-run after a failure. Identical to `ensureStarted()` by design. */
  public retry(): Promise<void> {
    return this.ensureStarted();
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

  private async run(): Promise<void> {
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

      this._statusText.set('Analyzing project structure...');
      const multiPhaseResult = await this.wizardRpc.deepAnalyze();
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
