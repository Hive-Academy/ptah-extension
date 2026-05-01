import {
  Component,
  inject,
  signal,
  computed,
  input,
  effect,
  TemplateRef,
  viewChild,
  OnInit,
  ChangeDetectionStrategy,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import {
  LucideAngularModule,
  AlertTriangle,
  Check,
  X,
  Search,
  RefreshCw,
  Wrench,
  PenLine,
} from 'lucide-angular';
import { NativeAutocompleteComponent } from '@ptah-extension/ui';
import { ClaudeRpcService, ModelStateService } from '@ptah-extension/core';
import type {
  ProviderModelInfo,
  ProviderModelTier,
  ProviderListModelsResult,
  ProviderGetModelTiersResult,
} from '@ptah-extension/shared';

/**
 * Provider Model Tier Configuration
 * Defines the 3 tiers that can be overridden with alternative models
 */
interface TierConfig {
  tier: ProviderModelTier;
  label: string;
  description: string;
  envVar: string;
}

const TIER_CONFIGS: TierConfig[] = [
  {
    tier: 'sonnet',
    label: 'Sonnet',
    description: 'Best for everyday tasks',
    envVar: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  },
  {
    tier: 'opus',
    label: 'Opus',
    description: 'Most capable for complex work',
    envVar: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
  },
  {
    tier: 'haiku',
    label: 'Haiku',
    description: 'Fast and cost-effective',
    envVar: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  },
];

/**
 * ProviderModelSelectorComponent - Model tier configuration with autocomplete
 *
 * Allows users to override the default Anthropic model aliases (Sonnet, Opus, Haiku)
 * with any model available from the active provider. Uses autocomplete for searching.
 *
 * Features:
 * - 3 tier selectors (Sonnet, Opus, Haiku)
 * - Autocomplete search for models
 * - Custom model ID text input (allows any model not in the dropdown list)
 * - Tool use warning for non-compatible models
 * - Reset to default button per tier
 * - Hides Refresh button for providers with static model lists
 *
 * TASK_2025_091 Phase 2 (OpenRouter), TASK_2025_132 (generalized to all providers)
 */
@Component({
  selector: 'ptah-provider-model-selector',
  standalone: true,
  imports: [FormsModule, LucideAngularModule, NativeAutocompleteComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="space-y-4">
      <!-- Header -->
      <div class="flex items-center justify-between">
        <div>
          <h4 class="text-sm font-medium text-base-content">Model Mapping</h4>
          <p class="text-xs text-base-content/60 mt-0.5">
            Override default Anthropic model aliases with provider models
          </p>
        </div>
        @if (!isStatic()) {
          <button
            type="button"
            (click)="refreshModels()"
            class="btn btn-ghost btn-xs gap-1"
            [class.loading]="isLoading()"
            [disabled]="isLoading()"
          >
            <lucide-angular [img]="RefreshCwIcon" class="w-3 h-3" />
            Refresh
          </button>
        }
      </div>

      <!-- No Key State -->
      @if (!hasKey()) {
        <div class="text-xs text-base-content/50 text-center py-4">
          Configure your provider API key above to see available models.
        </div>
      }

      <!-- Loading State -->
      @if (hasKey() && isLoading() && availableModels().length === 0) {
        <div class="flex items-center justify-center gap-2 py-8">
          <span class="loading loading-spinner loading-sm"></span>
          <span class="text-sm text-base-content/60">Loading models...</span>
        </div>
      }

      <!-- Error State -->
      @if (hasKey() && error()) {
        <div class="alert alert-warning py-2 px-3">
          <lucide-angular [img]="AlertTriangleIcon" class="w-4 h-4" />
          <span class="text-sm">{{ error() }}</span>
        </div>
      }

      <!-- Tier Selectors -->
      @if (hasKey() && (availableModels().length > 0 || !isLoading())) {
        <div class="space-y-3">
          @for (tierConfig of tierConfigs; track tierConfig.tier) {
            <div
              class="bg-base-200/50 rounded-lg p-3 border border-base-300/50"
            >
              <div class="flex items-center justify-between mb-2">
                <div>
                  <span class="text-sm font-medium text-base-content">
                    {{ tierConfig.label }}
                  </span>
                  <span class="text-xs text-base-content/50 ml-2">
                    {{ tierConfig.description }}
                  </span>
                </div>
                @if (getTierValue(tierConfig.tier)) {
                  <button
                    type="button"
                    (click)="clearTier(tierConfig.tier)"
                    class="btn btn-ghost btn-xs text-warning"
                    title="Reset to default"
                  >
                    <lucide-angular [img]="XIcon" class="w-3 h-3" />
                    Clear
                  </button>
                }
              </div>

              <!-- Current Selection -->
              @if (getTierValue(tierConfig.tier); as currentModel) {
                <div class="flex items-center gap-2 mb-2">
                  <span class="badge badge-sm badge-primary font-mono">
                    {{ currentModel }}
                  </span>
                  @if (!isModelToolUseCompatible(currentModel)) {
                    <span
                      class="badge badge-sm badge-warning gap-1"
                      title="This model may not support tool use (required for AI agents)"
                    >
                      <lucide-angular
                        [img]="AlertTriangleIcon"
                        class="w-3 h-3"
                      />
                      No tool use
                    </span>
                  }
                </div>
              } @else {
                <div class="text-xs text-base-content/50 mb-2">
                  Using default Anthropic {{ tierConfig.label }}
                </div>
              }

              <!-- Search Input (from available models list) -->
              <div class="relative">
                <ptah-native-autocomplete
                  [suggestions]="filteredModels()"
                  [isLoading]="isLoading()"
                  [isOpen]="
                    activeTier() === tierConfig.tier && isDropdownOpen()
                  "
                  [suggestionTemplate]="modelSuggestionTemplate"
                  [headerTitle]="
                    'Available Models (' + filteredModels().length + ')'
                  "
                  [emptyMessage]="'No models match your search'"
                  (suggestionSelected)="selectModel(tierConfig.tier, $event)"
                  (closed)="closeDropdown()"
                >
                  <input
                    type="text"
                    autocompleteInput
                    [placeholder]="
                      'Search ' + availableModels().length + ' models...'
                    "
                    [ngModel]="getSearchQuery(tierConfig.tier)"
                    (ngModelChange)="onSearchInput($event, tierConfig.tier)"
                    (focus)="openDropdown(tierConfig.tier)"
                    class="input input-sm input-bordered w-full font-mono text-xs"
                  />
                </ptah-native-autocomplete>
                @if (tierErrors()[tierConfig.tier]; as err) {
                  <div class="text-xs text-error mt-1">{{ err }}</div>
                }
              </div>

              <!-- Custom model ID input (shown when user clicks "Enter custom model ID") -->
              @if (isCustomInputOpen(tierConfig.tier)) {
                <div class="mt-2 flex gap-1.5">
                  <input
                    type="text"
                    [id]="'custom-model-' + tierConfig.tier"
                    class="input input-sm input-bordered flex-1 font-mono text-xs"
                    placeholder="e.g. kimi-k2.6, gpt-5-turbo, ..."
                    [ngModel]="getCustomInput(tierConfig.tier)"
                    (ngModelChange)="setCustomInput(tierConfig.tier, $event)"
                    (keydown.enter)="confirmCustomModel(tierConfig.tier)"
                    (keydown.escape)="closeCustomInput(tierConfig.tier)"
                  />
                  <button
                    type="button"
                    class="btn btn-sm btn-primary btn-square"
                    title="Apply custom model ID"
                    [disabled]="!getCustomInput(tierConfig.tier).trim()"
                    (click)="confirmCustomModel(tierConfig.tier)"
                  >
                    <lucide-angular [img]="CheckIcon" class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    class="btn btn-sm btn-ghost btn-square"
                    title="Cancel"
                    (click)="closeCustomInput(tierConfig.tier)"
                  >
                    <lucide-angular [img]="XIcon" class="w-3.5 h-3.5" />
                  </button>
                </div>
                <div class="text-[10px] text-base-content/50 mt-1 pl-0.5">
                  Enter any model ID supported by this provider
                </div>
              } @else {
                <!-- Toggle to show custom input -->
                <button
                  type="button"
                  class="btn btn-ghost btn-xs gap-1 mt-1.5 text-base-content/40 hover:text-base-content"
                  (click)="openCustomInput(tierConfig.tier)"
                  [attr.aria-label]="
                    'Enter custom model ID for ' + tierConfig.label
                  "
                >
                  <lucide-angular [img]="PenLineIcon" class="w-3 h-3" />
                  <span class="text-[10px]">Enter custom model ID</span>
                </button>
              }
            </div>
          }
        </div>
      }

      <!-- Model count footer -->
      @if (hasKey() && availableModels().length > 0) {
        <div class="text-xs text-base-content/50 text-center">
          {{ availableModels().length }} models available •
          {{ toolUseModelsCount() }} support tool use
        </div>
      }
    </div>

    <!-- Suggestion Template -->
    <ng-template #modelSuggestionTemplate let-model>
      <div class="flex items-center gap-2 py-1">
        <div class="flex-1 min-w-0">
          <div class="text-sm font-medium truncate">{{ model.name }}</div>
          <div class="text-xs text-base-content/60 font-mono truncate">
            {{ model.id }}
          </div>
        </div>
        @if (model.supportsToolUse) {
          <lucide-angular
            [img]="WrenchIcon"
            class="w-4 h-4 text-success flex-shrink-0"
            title="Supports tool use"
          />
        } @else {
          <lucide-angular
            [img]="AlertTriangleIcon"
            class="w-3.5 h-3.5 text-warning flex-shrink-0"
            title="May not support tool use"
          />
        }
      </div>
    </ng-template>
  `,
})
export class ProviderModelSelectorComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly modelState = inject(ModelStateService);

  // Icons
  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckIcon = Check;
  readonly WrenchIcon = Wrench;
  readonly XIcon = X;
  readonly SearchIcon = Search;
  readonly RefreshCwIcon = RefreshCw;
  readonly PenLineIcon = PenLine;

  // Tier configurations
  readonly tierConfigs = TIER_CONFIGS;

  // Input: provider ID (optional, defaults to active provider on backend)
  readonly providerId = input<string | undefined>(undefined);

  // Input: whether the provider has a key configured (guards model loading)
  readonly hasKey = input<boolean>(false);

  // Template ref for autocomplete
  readonly modelSuggestionTemplate = viewChild.required<
    TemplateRef<{ $implicit: ProviderModelInfo }>
  >('modelSuggestionTemplate');

  // State
  readonly availableModels = signal<ProviderModelInfo[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchQueries = signal<Record<ProviderModelTier, string>>({
    sonnet: '',
    opus: '',
    haiku: '',
  });
  readonly activeTier = signal<ProviderModelTier | null>(null);
  readonly isDropdownOpen = signal(false);
  readonly isStatic = signal(false);
  readonly tierErrors = signal<Record<ProviderModelTier, string | null>>({
    sonnet: null,
    opus: null,
    haiku: null,
  });

  // Custom model input state — tracks open/closed and typed value per tier
  readonly customInputOpen = signal<Record<ProviderModelTier, boolean>>({
    sonnet: false,
    opus: false,
    haiku: false,
  });
  readonly customInputValues = signal<Record<ProviderModelTier, string>>({
    sonnet: '',
    opus: '',
    haiku: '',
  });

  // AbortController for cancelling in-flight model/tier loads on provider switch
  private loadAbortController: AbortController | null = null;

  // Current tier mappings
  readonly sonnetModel = signal<string | null>(null);
  readonly opusModel = signal<string | null>(null);
  readonly haikuModel = signal<string | null>(null);

  // Computed: filtered models based on the active tier's search query
  readonly filteredModels = computed(() => {
    const tier = this.activeTier();
    const query = tier ? this.searchQueries()[tier].toLowerCase().trim() : '';
    const models = this.availableModels();

    if (!query) {
      return models.slice(0, 50); // Limit initial display
    }

    return models
      .filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query),
      )
      .slice(0, 50);
  });

  // Computed: count of models with tool use support
  readonly toolUseModelsCount = computed(
    () => this.availableModels().filter((m) => m.supportsToolUse).length,
  );

  // Track previous providerId to detect changes (skip initial load handled by ngOnInit)
  private previousProviderId: string | undefined | null = null;
  private initialized = false;

  constructor() {
    // React to providerId and hasKey input changes after initial load
    effect(() => {
      const currentId = this.providerId();
      const keyAvailable = this.hasKey();

      if (!this.initialized) return;

      if (currentId !== this.previousProviderId) {
        // Provider changed
        this.previousProviderId = currentId;
        if (keyAvailable) {
          this.reloadForProvider();
        } else {
          this.clearModelState();
        }
      } else if (
        keyAvailable &&
        this.availableModels().length === 0 &&
        !this.isLoading()
      ) {
        // Same provider, key just became available, no models loaded yet
        this.reloadForProvider();
      }
    });
  }

  async ngOnInit(): Promise<void> {
    this.previousProviderId = this.providerId();
    if (this.hasKey()) {
      await Promise.all([this.loadModels(), this.loadTierMappings()]);
    }
    this.initialized = true;
  }

  // ============================================================================
  // TIER ACCESSORS
  // ============================================================================

  /**
   * Get current value for a tier
   */
  getTierValue(tier: ProviderModelTier): string | null {
    switch (tier) {
      case 'sonnet':
        return this.sonnetModel();
      case 'opus':
        return this.opusModel();
      case 'haiku':
        return this.haikuModel();
    }
  }

  /**
   * Check if a model ID supports tool use
   */
  isModelToolUseCompatible(modelId: string): boolean {
    const model = this.availableModels().find((m) => m.id === modelId);
    return model?.supportsToolUse ?? false;
  }

  /**
   * Get the search query for a specific tier
   */
  getSearchQuery(tier: ProviderModelTier): string {
    return this.searchQueries()[tier];
  }

  // ============================================================================
  // DROPDOWN INTERACTIONS
  // ============================================================================

  /**
   * Handle search input for a tier (updates only that tier's query)
   */
  onSearchInput(query: string, tier: ProviderModelTier): void {
    this.searchQueries.update((prev) => ({ ...prev, [tier]: query }));
    this.activeTier.set(tier);
    this.isDropdownOpen.set(true);
  }

  /**
   * Open dropdown for a tier
   */
  openDropdown(tier: ProviderModelTier): void {
    this.activeTier.set(tier);
    this.isDropdownOpen.set(true);

    // Load models on first open if needed
    if (this.availableModels().length === 0 && !this.isLoading()) {
      this.loadModels();
    }
  }

  /**
   * Close dropdown and clear only the active tier's search query
   */
  closeDropdown(): void {
    const tier = this.activeTier();
    if (tier) {
      this.searchQueries.update((prev) => ({ ...prev, [tier]: '' }));
    }
    this.isDropdownOpen.set(false);
    this.activeTier.set(null);
  }

  /**
   * Select a model for the active tier
   */
  async selectModel(
    tier: ProviderModelTier,
    model: ProviderModelInfo,
  ): Promise<void> {
    await this.applyModelId(tier, model.id);
    this.closeDropdown();
  }

  /**
   * Clear a tier (reset to default)
   */
  async clearTier(tier: ProviderModelTier): Promise<void> {
    try {
      const result = await this.rpc.call('provider:clearModelTier', {
        tier,
        providerId: this.providerId(),
      });

      if (result.isSuccess() && result.data?.success) {
        // Clear any previous error for this tier
        this.tierErrors.update((prev) => ({ ...prev, [tier]: null }));
        this.setTierValue(tier, null);
        // Refresh model dropdown to remove cleared provider model IDs
        this.modelState.refreshModels();
      } else {
        this.tierErrors.update((prev) => ({
          ...prev,
          [tier]: result.error || 'Failed to clear model',
        }));
      }
    } catch (error) {
      this.tierErrors.update((prev) => ({
        ...prev,
        [tier]:
          error instanceof Error ? error.message : 'Failed to clear model',
      }));
    }
  }

  /**
   * Refresh models from API
   */
  async refreshModels(): Promise<void> {
    await this.loadModels();
  }

  // ============================================================================
  // CUSTOM MODEL INPUT
  // ============================================================================

  isCustomInputOpen(tier: ProviderModelTier): boolean {
    return this.customInputOpen()[tier];
  }

  getCustomInput(tier: ProviderModelTier): string {
    return this.customInputValues()[tier];
  }

  setCustomInput(tier: ProviderModelTier, value: string): void {
    this.customInputValues.update((prev) => ({ ...prev, [tier]: value }));
  }

  openCustomInput(tier: ProviderModelTier): void {
    this.customInputOpen.update((prev) => ({ ...prev, [tier]: true }));
  }

  closeCustomInput(tier: ProviderModelTier): void {
    this.customInputOpen.update((prev) => ({ ...prev, [tier]: false }));
    this.customInputValues.update((prev) => ({ ...prev, [tier]: '' }));
  }

  /**
   * Apply a manually typed model ID as the tier override.
   * Works exactly like selecting from the dropdown — calls provider:setModelTier.
   * The model does NOT need to exist in the static or dynamic model list.
   */
  async confirmCustomModel(tier: ProviderModelTier): Promise<void> {
    const modelId = this.getCustomInput(tier).trim();
    if (!modelId) return;

    await this.applyModelId(tier, modelId);
    if (!this.tierErrors()[tier]) {
      this.closeCustomInput(tier);
    }
  }

  // ============================================================================
  // PRIVATE HELPERS
  // ============================================================================

  /**
   * Core RPC call to persist a model ID for a tier.
   * Shared by selectModel (dropdown) and confirmCustomModel (custom input).
   */
  private async applyModelId(
    tier: ProviderModelTier,
    modelId: string,
  ): Promise<void> {
    try {
      const result = await this.rpc.call('provider:setModelTier', {
        tier,
        modelId,
        providerId: this.providerId(),
      });

      if (result.isSuccess() && result.data?.success) {
        this.tierErrors.update((prev) => ({ ...prev, [tier]: null }));
        this.setTierValue(tier, modelId);
        this.modelState.refreshModels();
      } else {
        this.tierErrors.update((prev) => ({
          ...prev,
          [tier]: result.error || 'Failed to set model',
        }));
      }
    } catch (error) {
      this.tierErrors.update((prev) => ({
        ...prev,
        [tier]: error instanceof Error ? error.message : 'Failed to set model',
      }));
    }
  }

  /**
   * Clear model state without loading (used when no key is configured).
   */
  private clearModelState(): void {
    this.loadAbortController?.abort();
    this.availableModels.set([]);
    this.sonnetModel.set(null);
    this.opusModel.set(null);
    this.haikuModel.set(null);
    this.error.set(null);
    this.tierErrors.set({ sonnet: null, opus: null, haiku: null });
    this.closeDropdown();
  }

  /**
   * Reload models and tier mappings when the provider changes.
   * Cancels any in-flight loads from a previous provider switch.
   */
  private async reloadForProvider(): Promise<void> {
    // Cancel any in-flight loads from a previous provider switch
    this.loadAbortController?.abort();
    this.loadAbortController = new AbortController();
    const abortSignal = this.loadAbortController.signal;

    // Clear stale state from the previous provider
    this.availableModels.set([]);
    this.sonnetModel.set(null);
    this.opusModel.set(null);
    this.haikuModel.set(null);
    this.error.set(null);
    this.tierErrors.set({ sonnet: null, opus: null, haiku: null });
    this.closeDropdown();

    await Promise.all([
      this.loadModels(abortSignal),
      this.loadTierMappings(abortSignal),
    ]);
  }

  /**
   * Load models from provider API (or static list).
   * Accepts an optional AbortSignal to skip state updates if the load was cancelled.
   */
  private async loadModels(abortSignal?: AbortSignal): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const result = await this.rpc.call('provider:listModels', {
        toolUseOnly: false,
        providerId: this.providerId(),
      });

      // If this load was aborted (provider changed mid-flight), discard the result
      if (abortSignal?.aborted) return;

      if (result.isSuccess() && result.data) {
        const data = result.data as ProviderListModelsResult;
        this.availableModels.set(data.models);
        this.isStatic.set(data.isStatic ?? false);
        // Handle soft errors (auth failures returned as successful RPC with error field)
        if (data.error) {
          this.error.set(data.error);
        }
      } else {
        this.error.set(result.error || 'Failed to load models');
      }
    } catch (error) {
      if (abortSignal?.aborted) return;
      this.error.set(
        error instanceof Error ? error.message : 'Failed to load models',
      );
    } finally {
      if (!abortSignal?.aborted) {
        this.isLoading.set(false);
      }
    }
  }

  /**
   * Load current tier mappings.
   * Accepts an optional AbortSignal to skip state updates if the load was cancelled.
   */
  private async loadTierMappings(abortSignal?: AbortSignal): Promise<void> {
    try {
      const result = await this.rpc.call('provider:getModelTiers', {
        providerId: this.providerId(),
      });

      // If this load was aborted (provider changed mid-flight), discard the result
      if (abortSignal?.aborted) return;

      if (result.isSuccess() && result.data) {
        const data = result.data as ProviderGetModelTiersResult;
        this.sonnetModel.set(data.sonnet);
        this.opusModel.set(data.opus);
        this.haikuModel.set(data.haiku);
      }
    } catch (error) {
      if (abortSignal?.aborted) return;
      console.error(
        '[ProviderModelSelector] Error loading tier mappings:',
        error,
      );
    }
  }

  /**
   * Set tier value in local state
   */
  private setTierValue(tier: ProviderModelTier, value: string | null): void {
    switch (tier) {
      case 'sonnet':
        this.sonnetModel.set(value);
        break;
      case 'opus':
        this.opusModel.set(value);
        break;
      case 'haiku':
        this.haikuModel.set(value);
        break;
    }
  }
}
