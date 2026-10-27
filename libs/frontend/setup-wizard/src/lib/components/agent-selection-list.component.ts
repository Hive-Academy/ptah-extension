import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
  untracked,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import type {
  AgentRecommendation,
  FileDecision,
  GenerationTargetChoice,
  SetupGenerationTabBinding,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { findBoundGenerationTab } from '../services/bound-generation-tab';
import type { BoundAgentDecisions } from '../services/wizard-rpc.service';
import { AgentPreviewDialogComponent } from './agent-preview-dialog.component';
import type { PreviewRowDecision } from './agent-preview-dialog.component';
import {
  buildWizardRows,
  decisionCounts,
  decisionEntries,
  nextSnapshot,
  setAllDecisions,
  setDecision,
  targetsSignature,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';
import { CommunityPacksPanelComponent } from './community-packs-panel.component';
import { GenerationModelPickerComponent } from './generation-model-picker.component';
import { GenerationSourceStatusComponent } from './generation-source-status.component';

@Component({
  selector: 'ptah-agent-selection-list',
  standalone: true,
  imports: [
    AgentPreviewDialogComponent,
    CommunityPacksPanelComponent,
    GenerationModelPickerComponent,
    GenerationSourceStatusComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="space-y-3" aria-labelledby="agent-selection-title">
      <h2 id="agent-selection-title" class="text-lg font-bold">
        Select agents
      </h2>
      <ptah-generation-source-status
        [source]="store.run()?.source ?? null"
        [recorded]="!!store.run()"
      />
      <ptah-generation-model-picker
        [tabId]="binding().tabId"
        [locked]="store.isBound()"
        [effectiveProvider]="store.provider()"
        [effectiveModel]="store.model()"
      />
      @if (catalogMode()) {
        <p class="text-sm text-base-content-muted">
          Catalog list. Every agent is shown without a workspace score.
        </p>
      }
      @if (loading()) {
        <p role="status">Loading agents...</p>
      }
      @if (error()) {
        <p role="alert" class="text-error">Agents could not be loaded.</p>
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="loadCatalog()"
        >
          Retry
        </button>
      }
      <div class="flex flex-wrap gap-2">
        <button
          type="button"
          class="btn btn-outline btn-sm"
          (click)="selectRecommended()"
        >
          Select Recommended</button
        ><button
          type="button"
          class="btn btn-ghost btn-sm"
          (click)="clearSelection()"
        >
          Deselect All
        </button>
      </div>
      @for (category of categories; track category.key) {
        @if (agentsIn(category.key).length) {
          <h3 class="font-semibold">{{ category.label }}</h3>
          @for (agent of agentsIn(category.key); track agent.agentId) {
            <label
              class="flex cursor-pointer gap-2 rounded-lg border border-base-300 bg-base-200 p-2"
              [class.border-primary]="selected().has(agent.agentId)"
            >
              <input
                type="checkbox"
                class="checkbox checkbox-sm"
                [checked]="selected().has(agent.agentId)"
                [attr.aria-label]="'Select ' + agent.agentName"
                (change)="toggle(agent.agentId)"
              />
              <span class="min-w-0"
                ><span class="font-medium">{{ agent.agentName }}</span>
                @if (!catalogMode()) {
                  <span
                    class="badge badge-sm ml-2"
                    [attr.aria-label]="
                      'Relevance ' + agent.relevanceScore + ' percent'
                    "
                    >{{ agent.relevanceScore }}%</span
                  >
                }
                <span class="block text-xs text-base-content-muted">{{
                  agent.description
                }}</span>
                @if (!catalogMode() && agent.matchedCriteria.length) {
                  <details class="text-xs">
                    <summary>Why recommended</summary>
                    {{ agent.matchedCriteria.join(', ') }}
                  </details>
                }
              </span>
            </label>
          }
        }
      }
      <ptah-community-packs-panel />
      @if (store.chatTurnRejection()) {
        <p role="alert" class="alert alert-warning">
          {{ store.chatTurnRejection() }}
        </p>
      }
      @if (store.rejection()?.reason === 'blocked') {
        <p role="alert" class="alert alert-warning">
          {{ ownerLabel() }} owns this run.
        </p>
        @if (ownerInWorkspace()) {
          <button
            type="button"
            class="btn btn-outline btn-sm"
            (click)="openOwner()"
          >
            Open running tab
          </button>
        }
      }
      @if (store.rejection()?.reason === 'preview-required') {
        <p role="alert">Targets need another review.</p>
      }
      @if (startError()) {
        <p role="alert" class="text-error">
          Generation could not be started. Check the workspace and try again.
        </p>
      }
      <button
        type="button"
        class="btn btn-sm w-full"
        [class.btn-primary]="primary()"
        [class.btn-outline]="!primary()"
        [disabled]="
          !selected().size || store.isBound() || loading() || previewOpen()
        "
        (click)="openPreview()"
      >
        Generate {{ selected().size }} agents
      </button>
      <!-- Lazy chunk: the dialog loads on first open, outside the initial bundle. -->
      @defer (when previewOpen()) {
        <ptah-agent-preview-dialog
          [open]="previewOpen()"
          [loading]="previewLoading()"
          [preview]="preview()"
          [snapshot]="decisions()"
          [changed]="targetsChanged()"
          [error]="previewError()"
          [model]="store.model()"
          [isElectron]="isElectron"
          (dismissed)="closePreview()"
          (confirm)="confirmPreview()"
          (decisionChange)="setRowDecision($event)"
          (applyAll)="setAllRowDecisions($event)"
          (targetChange)="changeTarget($event)"
        />
      }
    </section>
  `,
})
export class AgentSelectionListComponent {
  readonly binding = input.required<SetupGenerationTabBinding>();
  readonly primary = input(true);
  protected readonly store = inject(GenerationWorkflowStore);
  private readonly state = inject(SetupWizardStateService);
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  protected readonly isElectron = inject(VSCodeService).isElectron;
  protected readonly catalogMode = computed(
    () => !this.state.multiPhaseResult(),
  );
  protected readonly agents = signal<AgentRecommendation[]>([]);
  protected readonly selected = signal(new Set<string>());
  protected readonly loading = signal(false);
  protected readonly error = signal(false);
  protected readonly previewOpen = signal(false);
  protected readonly previewLoading = signal(false);
  protected readonly previewError = signal(false);
  protected readonly preview = signal<WizardPreviewGenerationResponse | null>(
    null,
  );
  /** Keep/replace state of the open preview (shared helper, F1). */
  protected readonly decisions = signal<DecisionSnapshot | null>(null);
  /** Root the user picked in the dialog; null = the host's default. */
  private readonly targetChoice = signal<GenerationTargetChoice | null>(null);
  protected readonly targetsChanged = signal(false);
  protected readonly startError = signal(false);
  protected readonly categories = [
    { key: 'planning', label: 'Planning & Architecture' },
    { key: 'development', label: 'Development' },
    { key: 'qa', label: 'Quality Assurance' },
    { key: 'specialist', label: 'Specialists' },
    { key: 'creative', label: 'Creative' },
    { key: 'other', label: 'Other' },
  ] as const;
  private previewSequence = 0;
  private readonly bindingKey = computed(() => {
    const { tabId, workflow, workspacePath } = this.binding();
    return `${tabId}\u0000${workflow}\u0000${workspacePath}`;
  });

  constructor() {
    effect(() => {
      this.bindingKey();
      const binding = untracked(this.binding);
      if (binding.workflow !== 'setup-agent-generation') return;
      if (this.catalogMode()) void this.loadCatalog(binding);
      else {
        this.agents.set(this.state.recommendations());
        this.selected.set(
          new Set(
            Object.entries(this.state.selectedAgentsMap())
              .filter(([, selected]) => selected)
              .map(([id]) => id),
          ),
        );
      }
    });
  }

  protected agentsIn(category: string): AgentRecommendation[] {
    return this.agents().filter((agent) =>
      category === 'other'
        ? !this.categories.some(
            (item) => item.key !== 'other' && item.key === agent.category,
          )
        : agent.category === category,
    );
  }

  protected async loadCatalog(
    binding: SetupGenerationTabBinding = this.binding(),
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(false);
    try {
      const result = await this.rpc.call(
        'wizard:recommend-agents',
        { mode: 'workspace-catalog', tabBinding: binding },
        { timeout: 60_000 },
      );
      if (!result.isSuccess() || !result.data)
        throw new Error('Catalog unavailable');
      this.agents.set(result.data);
    } catch {
      this.error.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected toggle(id: string): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  protected clearSelection(): void {
    this.selected.set(new Set<string>());
  }

  protected selectRecommended(): void {
    this.selected.set(
      new Set(
        this.agents()
          .filter((agent) => this.catalogMode() || agent.relevanceScore >= 75)
          .map((agent) => agent.agentId),
      ),
    );
  }

  /**
   * Open the dialog with a fresh comparison; every existing file starts on
   * Keep. `keepTarget` preserves the chosen root when the server asks for
   * another review (preview-required).
   */
  protected async openPreview(keepTarget = false): Promise<void> {
    if (!this.selected().size || this.store.isBound()) return;
    this.previewOpen.set(true);
    this.targetsChanged.set(false);
    this.preview.set(null);
    this.decisions.set(null);
    if (!keepTarget) this.targetChoice.set(null);
    await this.loadPreview(false);
  }

  protected closePreview(): void {
    this.previewSequence++;
    this.previewOpen.set(false);
    this.previewLoading.set(false);
  }

  protected async confirmPreview(): Promise<void> {
    if (this.previewLoading()) return;
    await this.loadPreview(true);
  }

  protected setRowDecision(change: PreviewRowDecision): void {
    if (this.previewLoading()) return;
    this.decisions.update((current) =>
      current ? setDecision(current, change.id, change.decision) : current,
    );
  }

  protected setAllRowDecisions(decision: FileDecision): void {
    if (this.previewLoading()) return;
    this.decisions.update((current) =>
      current ? setAllDecisions(current, decision) : current,
    );
  }

  /** A different root re-runs the comparison; every choice resets to Keep. */
  protected async changeTarget(choice: GenerationTargetChoice): Promise<void> {
    if (this.previewLoading() || choice === this.targetChoice()) return;
    this.targetChoice.set(choice);
    this.targetsChanged.set(false);
    await this.loadPreview(false);
  }

  private async loadPreview(submit: boolean): Promise<void> {
    const sequence = ++this.previewSequence;
    const previous = this.preview();
    const previousDecisions = this.decisions();
    const target = this.targetChoice();
    this.previewLoading.set(true);
    this.previewError.set(false);
    try {
      const result = await this.rpc.call(
        'wizard:preview-generation',
        {
          selectedAgentIds: [...this.selected()],
          tabBinding: this.binding(),
          ...(target ? { target } : {}),
        },
        { timeout: 10_000 },
      );
      if (sequence !== this.previewSequence) return;
      if (!result.isSuccess() || !result.data)
        throw new Error('Preview unavailable');
      const fresh = result.data;
      const next = nextSnapshot(
        previousDecisions,
        buildWizardRows(fresh),
        fresh.target?.chosen ?? target,
      );
      this.preview.set(fresh);
      this.decisions.set(next);
      if (!submit) return;
      if (previous && this.needsReview(previous, fresh, previousDecisions, next)) {
        this.targetsChanged.set(true);
        return;
      }
      this.closePreview();
      this.startError.set(false);
      await this.store.startAgents(
        [...this.selected()],
        this.submitDecisions(fresh, next),
      );
      if (this.store.rejection()?.reason === 'preview-required')
        await this.openPreview(true);
      else if (
        this.store.state() === 'idle' &&
        !this.store.chatTurnRejection() &&
        !this.store.rejection()
      )
        this.startError.set(true);
    } catch {
      if (sequence === this.previewSequence) this.previewError.set(true);
    } finally {
      if (sequence === this.previewSequence) this.previewLoading.set(false);
    }
  }

  /**
   * The confirm-time re-preview differs from what the user reviewed: other
   * definite targets, another root, or a Replace that no longer applies
   * because the file changed (its revision moved, so it is back on Keep).
   */
  private needsReview(
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

  private submitDecisions(
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

  protected ownerInWorkspace(): boolean {
    const rejection = this.store.rejection();
    if (rejection?.reason !== 'blocked' || !rejection.ownerTabId) return false;
    return !!findBoundGenerationTab(this.tabs, {
      tabId: rejection.ownerTabId,
      workspacePath: this.binding().workspacePath,
    });
  }

  protected ownerLabel(): string {
    const rejection = this.store.rejection();
    if (rejection?.reason !== 'blocked' || !rejection.ownerTabId)
      return 'Another tab';
    const tab = findBoundGenerationTab(this.tabs, {
      tabId: rejection.ownerTabId,
      workspacePath: this.binding().workspacePath,
    });
    return tab?.title || 'Another tab';
  }

  protected async openOwner(): Promise<void> {
    if (!this.ownerInWorkspace()) return;
    await this.launcher.open({
      workspacePath: this.binding().workspacePath,
      workflow: 'setup-agent-generation',
      origin: 'blocked-run',
    });
  }
}
