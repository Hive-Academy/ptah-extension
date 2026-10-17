import { randomUUID } from 'crypto';
import { injectable } from 'tsyringe';
import type {
  EnhancedPromptsCancelResponse,
  EnhancedPromptsGetRunStateResponse,
  GenerationContextSource,
  SetupGenerationRunBinding,
  SetupGenerationRunState,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';

/** Tracks the tab identity of the service-owned guidance slot. */
@injectable()
export class GuidanceGenerationRunSupervisor {
  private current: {
    binding: SetupGenerationRunBinding;
    controller: AbortController;
    state: SetupGenerationRunState;
    committing: boolean;
    timedOut: boolean;
  } | null = null;
  private settled: SetupGenerationRunState | null = null;

  get activeBinding(): SetupGenerationRunBinding | null {
    return this.current?.binding ?? null;
  }

  start(
    tab: SetupGenerationTabBinding,
    source: GenerationContextSource,
    provider: string,
    model: string,
  ): { binding: SetupGenerationRunBinding; controller: AbortController } {
    const binding = { ...tab, runId: randomUUID() };
    const controller = new AbortController();
    this.current = {
      binding,
      controller,
      committing: false,
      timedOut: false,
      state: {
        binding,
        status: 'starting',
        source,
        effectiveProvider: provider,
        effectiveModel: model,
      },
    };
    return { binding, controller };
  }

  beginCommit(binding: SetupGenerationRunBinding): boolean {
    if (
      !this.matches(binding) ||
      !this.current ||
      this.current.controller.signal.aborted
    )
      return false;
    this.current.committing = true;
    return true;
  }

  running(binding: SetupGenerationRunBinding): void {
    if (this.matches(binding) && this.current?.state.status === 'starting') {
      this.current.state.status = 'running';
    }
  }

  finish(
    binding: SetupGenerationRunBinding,
    status: 'completed' | 'cancelled' | 'failed' | 'timed-out',
    committedState?: 'unknown',
  ): boolean {
    if (!this.matches(binding) || !this.current) return false;
    const state = this.current.state;
    state.status = this.current.timedOut
      ? 'timed-out'
      : this.current.controller.signal.aborted
        ? 'cancelled'
        : status;
    state.committedState =
      state.status === 'completed'
        ? 'committed'
        : (committedState ??
          (this.current.committing ? 'unknown' : 'unchanged'));
    state.result = {
      status: state.status,
      success: state.status === 'completed',
      source: state.source,
      effectiveProvider: state.effectiveProvider,
      effectiveModel: state.effectiveModel,
      committedState: state.committedState,
    };
    this.settled = state;
    this.current = null;
    return true;
  }

  timeout(binding: SetupGenerationRunBinding): void {
    if (
      !this.matches(binding) ||
      !this.current ||
      this.current.controller.signal.aborted
    )
      return;
    this.current.timedOut = true;
    this.current.controller.abort();
  }

  forceRelease(binding: SetupGenerationRunBinding): boolean {
    if (!this.matches(binding) || !this.current) return false;
    this.current.timedOut = true;
    this.current.controller.abort();
    return this.finish(binding, 'timed-out', 'unknown');
  }

  cancel(binding: SetupGenerationRunBinding): EnhancedPromptsCancelResponse {
    if (this.matches(binding) && this.current) {
      if (this.current.committing)
        return { cancelled: false, outcome: 'refused' };
      this.current.controller.abort();
      this.current.state.status = 'cancelling';
      return { cancelled: true, outcome: 'cancelled' };
    }
    if (this.exact(this.settled?.binding, binding)) {
      return { cancelled: false, outcome: 'already-finalized' };
    }
    const sameOwnerTab =
      !!this.current && this.sameTab(this.current.binding, binding);
    return {
      cancelled: false,
      outcome: this.current && !sameOwnerTab ? 'refused' : 'not-running',
      rejection: {
        reason:
          this.current && !sameOwnerTab ? 'workspace-mismatch' : 'not-running',
      },
    };
  }

  lookup(
    tab: SetupGenerationTabBinding,
    runId?: string,
    serviceBusy = false,
  ): EnhancedPromptsGetRunStateResponse {
    const current = this.current;
    if (
      current &&
      this.sameTab(current.binding, tab) &&
      (!runId || current.binding.runId === runId)
    ) {
      return { run: current.state };
    }
    if (
      runId &&
      this.settled &&
      this.sameTab(this.settled.binding, tab) &&
      this.settled.binding.runId === runId
    ) {
      return { run: this.settled };
    }
    if (current || serviceBusy) {
      return {
        run: null,
        rejection: {
          reason: 'blocked',
          ...(current?.binding.workspacePath === tab.workspacePath
            ? { ownerTabId: current.binding.tabId }
            : {}),
        },
      };
    }
    if (
      this.settled &&
      this.sameTab(this.settled.binding, tab) &&
      (!runId || this.settled.binding.runId === runId)
    ) {
      return { run: this.settled };
    }
    return { run: null, rejection: { reason: 'not-running' } };
  }

  private matches(binding: SetupGenerationRunBinding): boolean {
    return this.exact(this.current?.binding, binding);
  }

  private exact(
    a: SetupGenerationRunBinding | undefined,
    b: SetupGenerationRunBinding,
  ): boolean {
    return !!a && this.sameTab(a, b) && a.runId === b.runId;
  }

  private sameTab(
    a: SetupGenerationTabBinding,
    b: SetupGenerationTabBinding,
  ): boolean {
    return (
      a.tabId === b.tabId &&
      a.workflow === b.workflow &&
      a.workspacePath === b.workspacePath
    );
  }
}
