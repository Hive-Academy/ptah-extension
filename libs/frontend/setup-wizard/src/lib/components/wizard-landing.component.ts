import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  OnInit,
  signal,
} from '@angular/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import { GenerationWorkflowLauncherService } from '@ptah-extension/chat-ui';
import {
  ModelStateService,
  ProvidersSettingsStateService,
} from '@ptah-extension/core';
import type {
  SavedAnalysisMetadata,
  SetupGenerationWorkflow,
} from '@ptah-extension/shared';
import { SetupWizardStateService } from '../services/setup-wizard-state.service';
import { WizardRpcService } from '../services/wizard-rpc.service';
import { WorkflowCardComponent } from './workflow-card.component';

@Component({
  selector: 'ptah-wizard-landing',
  standalone: true,
  imports: [WorkflowCardComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="mx-auto max-w-[720px] space-y-3 px-4 py-6">
      <h1 class="text-xl font-bold">Setup Wizard</h1>
      <h2 class="text-lg font-bold">What do you want to set up?</h2>
      <p class="text-sm text-base-content/70">
        Each workflow runs on its own. Generation uses a current analysis when
        one exists and otherwise reads your workspace.
      </p>
      <ptah-workflow-card
        id="landing-agents"
        title="Generate agents"
        description="Create a team of agents for this workspace."
        action="Generate agents"
        (open)="open('setup-agent-generation')"
      />
      <ptah-workflow-card
        id="landing-guidance"
        title="Generate project guidance"
        description="Create project instructions for your workspace."
        action="Generate guidance"
        (open)="open('setup-project-prompt')"
      />
      <ptah-workflow-card
        id="landing-analysis"
        title="Workspace analysis"
        description="Inspect this workspace before generation, if you want a saved analysis."
        action="Run analysis"
        [optional]="true"
        (open)="state.setCurrentStep('scan')"
      />
      <details class="rounded-lg border border-base-300 p-3">
        <summary class="cursor-pointer text-sm font-medium">
          Provider and model for analysis
        </summary>
        <p class="mt-2 text-xs text-base-content/70">
          Changing the workspace provider affects other tabs in this workspace.
          Agent generation and project guidance use the model selected in their
          tabs.
        </p>
        <label for="landing-analysis-provider" class="mt-2 block text-sm"
          >Workspace provider</label
        >
        <select
          id="landing-analysis-provider"
          class="select select-bordered select-sm w-full"
          [value]="providers.activeProviderId() ?? ''"
          [disabled]="!workspaceProviderAvailable() || providerSaving()"
          (change)="chooseProvider($event)"
        >
          @for (provider of connectedProviders(); track provider.id) {
            <option [value]="provider.id">{{ provider.name }}</option>
          }
        </select>
        @if (!workspaceProviderAvailable()) {
          <p class="text-xs text-base-content/70">
            Global provider fallback is read-only here.
          </p>
        }
        <label for="landing-analysis-model" class="mt-2 block text-sm"
          >Analysis model</label
        >
        <select
          id="landing-analysis-model"
          class="select select-bordered select-sm w-full"
          [value]="models.currentModel()"
          [disabled]="models.isPending() || !models.availableModels().length"
          (change)="chooseAnalysisModel($event)"
        >
          @for (model of models.availableModels(); track model.id) {
            <option
              [value]="model.id"
              [selected]="model.id === models.currentModel()"
            >
              {{ model.name }}
            </option>
          }
        </select>
      </details>
      @if (openError()) {
        <p role="alert" class="alert alert-error">
          This workflow could not be opened. Try again.
        </p>
      }
      <section aria-labelledby="previous-analyses" class="space-y-2">
        <h2
          id="previous-analyses"
          class="text-xs font-semibold uppercase tracking-wider"
        >
          Previous analyses
        </h2>
        @if (loading()) {
          <p role="status">Loading previous analyses...</p>
        }
        @if (listError()) {
          <p role="alert">
            Previous analyses did not load. Generation is not affected.
          </p>
          <button type="button" class="btn btn-outline btn-sm" (click)="load()">
            Retry
          </button>
        }
        @if (!loading() && !listError() && !state.savedAnalyses().length) {
          <p>No saved analyses yet. Generation works without one.</p>
        }
        @for (analysis of state.savedAnalyses(); track analysis.filename) {
          <div
            class="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-base-300 bg-base-200 p-3"
          >
            <div>
              <p class="font-medium">{{ analysis.projectType }}</p>
              <p class="text-xs text-base-content/70">
                {{ analysis.phaseCount }} phases · {{ analysis.savedAt }} ·
                {{ analysis.model }}
              </p>
            </div>
            <div class="flex gap-1">
              <button
                type="button"
                class="btn btn-outline btn-sm"
                [disabled]="using()"
                aria-label="Use this analysis"
                (click)="use(analysis)"
              >
                Use This</button
              ><button
                type="button"
                class="btn btn-ghost btn-sm"
                aria-label="Hide this analysis from the list"
                title="Hide from this list. Files are not deleted."
                (click)="hide(analysis)"
              >
                Hide
              </button>
            </div>
          </div>
        }
        @if (hiddenNotice()) {
          <p role="status">
            Analysis hidden from this list. Its files were not deleted.
          </p>
        }
        @if (useError()) {
          <p role="alert">This analysis could not be loaded.</p>
        }
      </section>
    </main>
  `,
})
export class WizardLandingComponent implements OnInit {
  protected readonly state = inject(SetupWizardStateService);
  private readonly rpc = inject(WizardRpcService);
  private readonly tabs = inject(TabManagerService);
  private readonly launcher = inject(GenerationWorkflowLauncherService);
  protected readonly providers = inject(ProvidersSettingsStateService);
  protected readonly models = inject(ModelStateService);
  protected readonly connectedProviders = computed(() =>
    (this.providers.connections().data ?? []).filter(
      (provider) => provider.configured,
    ),
  );
  protected readonly workspaceProviderAvailable = computed(
    () =>
      this.providers.writeScopes('authMethod').includes('workspace') &&
      !!this.providers.reviewContext(),
  );
  protected readonly providerSaving = signal(false);
  protected readonly loading = signal(false);
  protected readonly listError = signal(false);
  protected readonly openError = signal(false);
  protected readonly useError = signal(false);
  protected readonly using = signal(false);
  protected readonly hiddenNotice = signal(false);

  ngOnInit(): void {
    void this.load();
    void this.providers.open();
  }

  protected async chooseProvider(event: Event): Promise<void> {
    if (!this.workspaceProviderAvailable() || this.providerSaving()) return;
    const context = this.providers.reviewContext();
    const providerId = (event.target as HTMLSelectElement).value;
    if (
      !context ||
      !providerId ||
      providerId === this.providers.activeProviderId()
    )
      return;
    this.providerSaving.set(true);
    try {
      if (
        await this.providers.activateConnection(
          providerId,
          'workspace',
          context,
        )
      ) {
        await Promise.all([
          this.providers.refreshRoute(),
          this.models.refreshModels(),
        ]);
      }
    } finally {
      this.providerSaving.set(false);
    }
  }

  protected chooseAnalysisModel(event: Event): void {
    void this.models.switchModel((event.target as HTMLSelectElement).value);
  }

  protected async load(): Promise<void> {
    this.loading.set(true);
    this.listError.set(false);
    try {
      this.state.setSavedAnalyses(await this.rpc.listAnalyses());
    } catch {
      this.listError.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  protected async open(workflow: SetupGenerationWorkflow): Promise<void> {
    this.openError.set(false);
    const workspacePath = this.tabs.activeWorkspacePath;
    if (
      !workspacePath ||
      (
        await this.launcher.open({
          workspacePath,
          workflow,
          origin: 'wizard-landing',
        })
      ).outcome !== 'landed'
    )
      this.openError.set(true);
  }

  protected async use(analysis: SavedAnalysisMetadata): Promise<void> {
    this.using.set(true);
    this.useError.set(false);
    try {
      const result = await this.rpc.loadAnalysis(analysis.filename);
      this.state.loadSavedAnalysis(result);
      this.state.setRecommendations(await this.rpc.recommendAgents(result));
      this.state.setCurrentStep('analysis');
    } catch {
      this.useError.set(true);
    } finally {
      this.using.set(false);
    }
  }

  protected hide(analysis: SavedAnalysisMetadata): void {
    this.state.setSavedAnalyses(
      this.state
        .savedAnalyses()
        .filter((item) => item.filename !== analysis.filename),
    );
    this.hiddenNotice.set(true);
  }
}
