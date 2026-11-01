import { Injectable, inject, signal } from '@angular/core';
import type {
  FileDecision,
  GenerationTargetChoice,
  WizardPreviewGenerationResponse,
  SetupGenerationTabBinding,
} from '@ptah-extension/shared';
import type { PreviewRowDecision } from '../components/agent-preview-dialog.component';
import {
  buildWizardRows,
  decisionCounts,
  decisionEntries,
  nextSnapshot,
  setAllDecisions,
  setDecision,
  targetsSignature,
  type DecisionSnapshot,
} from '../components/preview-decisions/preview-decisions.state';
import {
  WizardRpcService,
  type BoundAgentDecisions,
} from './wizard-rpc.service';

/** What a confirm settled on: submit with these decisions, or stay open. */
export type PreviewConfirmation =
  | {
      readonly submit: true;
      readonly decisions: BoundAgentDecisions | undefined;
    }
  | { readonly submit: false };

/**
 * Generation preview state of the wizard's agent selection
 * (TASK_2026_701_9e4b S1). Component-scoped: provide it on the component that
 * opens the preview modal. It owns the open comparison, the keep/replace
 * snapshot (every row starts on Keep), the chosen root and the confirm-time
 * re-preview; the component submits whatever `confirm` settles on.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- component-scoped, provided by AgentSelectionComponent so the preview resets with it.
@Injectable()
export class GenerationPreviewStore {
  private readonly rpc = inject(WizardRpcService);

  private readonly openSignal = signal(false);
  private readonly loadingSignal = signal(false);
  private readonly previewSignal =
    signal<WizardPreviewGenerationResponse | null>(null);
  private readonly errorSignal = signal<string | null>(null);
  private readonly changedSignal = signal(false);
  private readonly decisionsSignal = signal<DecisionSnapshot | null>(null);
  /** Root the user chose in the preview; null = the server default. */
  private readonly targetChoice = signal<GenerationTargetChoice | null>(null);
  private request = 0;
  private binding!: SetupGenerationTabBinding;

  readonly isOpen = this.openSignal.asReadonly();
  readonly loading = this.loadingSignal.asReadonly();
  readonly preview = this.previewSignal.asReadonly();
  readonly error = this.errorSignal.asReadonly();
  /** The confirm-time comparison differs from what the user reviewed. */
  readonly changed = this.changedSignal.asReadonly();
  readonly decisions = this.decisionsSignal.asReadonly();

  /**
   * Open the modal with a fresh comparison; every existing file starts on
   * Keep. `keepTarget` keeps the chosen root when the server asks for another
   * review (preview-required), which also flags the change.
   */
  async open(
    agentIds: readonly string[],
    keepTarget: boolean,
    binding: SetupGenerationTabBinding,
  ): Promise<void> {
    this.binding = binding;
    this.previewSignal.set(null);
    this.decisionsSignal.set(null);
    this.errorSignal.set(null);
    this.changedSignal.set(false);
    if (!keepTarget) this.targetChoice.set(null);
    this.openSignal.set(true);
    await this.load(agentIds, false);
    if (keepTarget) this.changedSignal.set(true);
  }

  cancel(): void {
    this.request++;
    this.openSignal.set(false);
    this.loadingSignal.set(false);
  }

  /**
   * Confirm the open preview. A failed comparison is retried before submission;
   * confirmation only succeeds after a bound comparison settles.
   */
  async confirm(agentIds: readonly string[]): Promise<PreviewConfirmation> {
    if (!this.isOpen() || this.loading()) return { submit: false };
    if (this.error()) return this.load(agentIds, false);
    return this.load(agentIds, true);
  }

  setRowDecision(change: PreviewRowDecision): void {
    if (this.loading()) return;
    this.decisionsSignal.update((current) =>
      current ? setDecision(current, change.id, change.decision) : current,
    );
  }

  setAllRowDecisions(decision: FileDecision): void {
    if (this.loading()) return;
    this.decisionsSignal.update((current) =>
      current ? setAllDecisions(current, decision) : current,
    );
  }

  /** A different root re-runs the comparison; every choice resets to Keep. */
  async changeTarget(
    agentIds: readonly string[],
    choice: GenerationTargetChoice,
  ): Promise<void> {
    const current = this.decisions()?.target ?? this.preview()?.target?.chosen;
    if (this.loading() || choice === current) return;
    this.targetChoice.set(choice);
    this.changedSignal.set(false);
    await this.load(agentIds, false);
  }

  private async load(
    agentIds: readonly string[],
    confirm: boolean,
  ): Promise<PreviewConfirmation> {
    const request = ++this.request;
    const previous = this.preview();
    const previousDecisions = this.decisions();
    const target = this.targetChoice();
    this.loadingSignal.set(true);
    try {
      const preview = await this.rpc.previewGeneration(
        [...agentIds],
        target ?? undefined,
        this.binding,
      );
      if (request !== this.request) return { submit: false };
      const next = nextSnapshot(
        previousDecisions,
        buildWizardRows(preview),
        preview.target?.chosen ?? target,
      );
      this.previewSignal.set(preview);
      this.decisionsSignal.set(next);
      this.errorSignal.set(null);
      if (!confirm) return { submit: false };
      if (previous && needsReview(previous, preview, previousDecisions, next)) {
        this.changedSignal.set(true);
        return { submit: false };
      }
      this.cancel();
      return { submit: true, decisions: submitDecisions(preview, next) };
    } catch {
      // degradation-audit: reported - the failure is shown via error; the
      // early return only drops a reply a newer preview request superseded.
      if (request !== this.request) return { submit: false };
      this.previewSignal.set(null);
      this.decisionsSignal.set(null);
      this.errorSignal.set('Preview unavailable');
      this.changedSignal.set(false);
      return { submit: false };
    } finally {
      if (request === this.request) this.loadingSignal.set(false);
    }
  }
}

/**
 * The confirm-time re-preview differs from what the user reviewed: other
 * definite targets, another root, or a Replace that no longer applies
 * because the file changed (its revision moved, so it is back on Keep).
 */
function needsReview(
  previous: WizardPreviewGenerationResponse,
  fresh: WizardPreviewGenerationResponse,
  before: DecisionSnapshot | null,
  after: DecisionSnapshot,
): boolean {
  if (targetsSignature(previous) !== targetsSignature(fresh)) return true;
  if (after.status !== null) return true;
  const replacedBefore = before ? decisionCounts(before.rows).toReplace : 0;
  return decisionCounts(after.rows).toReplace < replacedBefore;
}

/** Token, Replace entries and target of the confirmed preview. */
function submitDecisions(
  fresh: WizardPreviewGenerationResponse,
  snapshot: DecisionSnapshot,
): BoundAgentDecisions {
  return {
    fileDecisions: decisionEntries(snapshot.rows),
    ...(fresh.previewToken !== undefined
      ? { previewToken: fresh.previewToken }
      : {}),
    ...(snapshot.target !== null ? { target: snapshot.target } : {}),
  };
}
