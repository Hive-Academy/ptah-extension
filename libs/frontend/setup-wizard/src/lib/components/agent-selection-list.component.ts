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
import { ClaudeRpcService } from '@ptah-extension/core';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import type {
  AgentRecommendation,
  SetupGenerationTabBinding,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import { GenerationWorkflowStore } from '../services/generation-workflow.store';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { AgentPreviewDialogComponent } from './agent-preview-dialog.component';
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
      <ptah-agent-preview-dialog
        [open]="previewOpen()"
        [loading]="previewLoading()"
        [preview]="preview()"
        [changed]="targetsChanged()"
        [error]="previewError()"
        [model]="store.model()"
        (dismissed)="closePreview()"
        (confirm)="confirmPreview()"
      />
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

  protected async openPreview(): Promise<void> {
    if (!this.selected().size || this.store.isBound()) return;
    this.previewOpen.set(true);
    this.targetsChanged.set(false);
    this.preview.set(null);
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

  private async loadPreview(submit: boolean): Promise<void> {
    const sequence = ++this.previewSequence;
    const previous = this.preview();
    this.previewLoading.set(true);
    this.previewError.set(false);
    try {
      const result = await this.rpc.call(
        'wizard:preview-generation',
        { selectedAgentIds: [...this.selected()], tabBinding: this.binding() },
        { timeout: 10_000 },
      );
      if (sequence !== this.previewSequence) return;
      if (!result.isSuccess() || !result.data)
        throw new Error('Preview unavailable');
      this.preview.set(result.data);
      if (
        submit &&
        previous &&
        this.definiteTargets(previous) !== this.definiteTargets(result.data)
      ) {
        this.targetsChanged.set(true);
        return;
      }
      if (submit) {
        this.closePreview();
        this.startError.set(false);
        await this.store.startAgents([...this.selected()]);
        if (this.store.rejection()?.reason === 'preview-required')
          await this.openPreview();
        else if (
          this.store.state() === 'idle' &&
          !this.store.chatTurnRejection() &&
          !this.store.rejection()
        )
          this.startError.set(true);
      }
    } catch {
      if (sequence === this.previewSequence) this.previewError.set(true);
    } finally {
      if (sequence === this.previewSequence) this.previewLoading.set(false);
    }
  }

  private definiteTargets(value: WizardPreviewGenerationResponse): string {
    return value.agents
      .flatMap((agent) =>
        agent.files
          .filter((file) => file.certainty === 'definite')
          .map(
            (file) => `${file.target}:${file.relPath}:${file.willOverwrite}`,
          ),
      )
      .sort()
      .join('|');
  }

  protected ownerInWorkspace(): boolean {
    const rejection = this.store.rejection();
    if (rejection?.reason !== 'blocked' || !rejection.ownerTabId) return false;
    return (
      this.tabs.findTabByIdAcrossWorkspaces(rejection.ownerTabId)
        ?.workspacePath === this.binding().workspacePath
    );
  }

  protected ownerLabel(): string {
    const rejection = this.store.rejection();
    if (rejection?.reason !== 'blocked' || !rejection.ownerTabId)
      return 'Another tab';
    const located = this.tabs.findTabByIdAcrossWorkspaces(rejection.ownerTabId);
    return located?.workspacePath === this.binding().workspacePath
      ? located.tab.title || 'Another tab'
      : 'Another tab';
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
