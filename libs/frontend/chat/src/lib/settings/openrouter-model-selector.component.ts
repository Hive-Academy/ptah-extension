import {
  Component,
  inject,
  signal,
  computed,
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
} from 'lucide-angular';
import { NativeAutocompleteComponent } from '@ptah-extension/ui';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  OpenRouterModelInfo,
  OpenRouterModelTier,
  OpenRouterListModelsResult,
  OpenRouterGetModelTiersResult,
} from '@ptah-extension/shared';

/**
 * OpenRouter Model Tier Configuration
 * Defines the 3 tiers that can be overridden with alternative models
 */
interface TierConfig {
  tier: OpenRouterModelTier;
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
 * OpenRouterModelSelectorComponent - Model tier configuration with autocomplete
 *
 * Allows users to override the default Anthropic model aliases (Sonnet, Opus, Haiku)
 * with any model available on OpenRouter. Uses autocomplete for searching 200+ models.
 *
 * Features:
 * - 3 tier selectors (Sonnet, Opus, Haiku)
 * - Autocomplete search for models
 * - Tool use warning for non-compatible models
 * - Reset to default button per tier
 *
 * TASK_2025_091 Phase 2
 */
@Component({
  selector: 'ptah-openrouter-model-selector',
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
            Override default Anthropic model aliases with any OpenRouter model
          </p>
        </div>
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
      </div>

      <!-- Loading State -->
      @if (isLoading() && availableModels().length === 0) {
      <div class="flex items-center justify-center gap-2 py-8">
        <span class="loading loading-spinner loading-sm"></span>
        <span class="text-sm text-base-content/60">Loading models...</span>
      </div>
      }

      <!-- Error State -->
      @if (error()) {
      <div class="alert alert-warning py-2 px-3">
        <lucide-angular [img]="AlertTriangleIcon" class="w-4 h-4" />
        <span class="text-sm">{{ error() }}</span>
      </div>
      }

      <!-- Tier Selectors -->
      @if (availableModels().length > 0 || !isLoading()) {
      <div class="space-y-3">
        @for (tierConfig of tierConfigs; track tierConfig.tier) {
        <div class="bg-base-200/50 rounded-lg p-3 border border-base-300/50">
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
              title="This model may not support tool use (required for Claude Code)"
            >
              <lucide-angular [img]="AlertTriangleIcon" class="w-3 h-3" />
              No tool use
            </span>
            }
          </div>
          } @else {
          <div class="text-xs text-base-content/50 mb-2">
            Using default Anthropic {{ tierConfig.label }}
          </div>
          }

          <!-- Search Input -->
          <div class="relative">
            <ptah-native-autocomplete
              [suggestions]="filteredModels()"
              [isLoading]="isLoading()"
              [isOpen]="activeTier() === tierConfig.tier && isDropdownOpen()"
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
                [ngModel]="searchQuery()"
                (ngModelChange)="onSearchInput($event, tierConfig.tier)"
                (focus)="openDropdown(tierConfig.tier)"
                class="input input-sm input-bordered w-full font-mono text-xs"
              />
            </ptah-native-autocomplete>
          </div>
        </div>
        }
      </div>
      }

      <!-- Model count footer -->
      @if (availableModels().length > 0) {
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
          [img]="CheckIcon"
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
export class OpenRouterModelSelectorComponent implements OnInit {
  private readonly rpc = inject(ClaudeRpcService);

  // Icons
  readonly AlertTriangleIcon = AlertTriangle;
  readonly CheckIcon = Check;
  readonly XIcon = X;
  readonly SearchIcon = Search;
  readonly RefreshCwIcon = RefreshCw;

  // Tier configurations
  readonly tierConfigs = TIER_CONFIGS;

  // Template ref for autocomplete
  readonly modelSuggestionTemplate = viewChild.required<
    TemplateRef<{ $implicit: OpenRouterModelInfo }>
  >('modelSuggestionTemplate');

  // State
  readonly availableModels = signal<OpenRouterModelInfo[]>([]);
  readonly isLoading = signal(false);
  readonly error = signal<string | null>(null);
  readonly searchQuery = signal('');
  readonly activeTier = signal<OpenRouterModelTier | null>(null);
  readonly isDropdownOpen = signal(false);

  // Current tier mappings
  readonly sonnetModel = signal<string | null>(null);
  readonly opusModel = signal<string | null>(null);
  readonly haikuModel = signal<string | null>(null);

  // Computed: filtered models based on search
  readonly filteredModels = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const models = this.availableModels();

    if (!query) {
      return models.slice(0, 50); // Limit initial display
    }

    return models
      .filter(
        (m) =>
          m.name.toLowerCase().includes(query) ||
          m.id.toLowerCase().includes(query)
      )
      .slice(0, 50);
  });

  // Computed: count of models with tool use support
  readonly toolUseModelsCount = computed(
    () => this.availableModels().filter((m) => m.supportsToolUse).length
  );

  async ngOnInit(): Promise<void> {
    await Promise.all([this.loadModels(), this.loadTierMappings()]);
  }

  /**
   * Get current value for a tier
   */
  getTierValue(tier: OpenRouterModelTier): string | null {
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
   * Handle search input for a tier
   */
  onSearchInput(query: string, tier: OpenRouterModelTier): void {
    this.searchQuery.set(query);
    this.activeTier.set(tier);
    this.isDropdownOpen.set(true);
  }

  /**
   * Open dropdown for a tier
   */
  openDropdown(tier: OpenRouterModelTier): void {
    this.activeTier.set(tier);
    this.isDropdownOpen.set(true);

    // Load models on first open if needed
    if (this.availableModels().length === 0 && !this.isLoading()) {
      this.loadModels();
    }
  }

  /**
   * Close dropdown
   */
  closeDropdown(): void {
    this.isDropdownOpen.set(false);
    this.activeTier.set(null);
    this.searchQuery.set('');
  }

  /**
   * Select a model for the active tier
   */
  async selectModel(
    tier: OpenRouterModelTier,
    model: OpenRouterModelInfo
  ): Promise<void> {
    try {
      const result = await this.rpc.call('openrouter:setModelTier', {
        tier,
        modelId: model.id,
      });

      if (result.isSuccess() && result.data?.success) {
        // Update local state
        this.setTierValue(tier, model.id);
        this.closeDropdown();
      } else {
        console.error('[OpenRouterModelSelector] Failed to set tier:', result);
      }
    } catch (error) {
      console.error('[OpenRouterModelSelector] Error setting tier:', error);
    }
  }

  /**
   * Clear a tier (reset to default)
   */
  async clearTier(tier: OpenRouterModelTier): Promise<void> {
    try {
      const result = await this.rpc.call('openrouter:clearModelTier', { tier });

      if (result.isSuccess() && result.data?.success) {
        this.setTierValue(tier, null);
      }
    } catch (error) {
      console.error('[OpenRouterModelSelector] Error clearing tier:', error);
    }
  }

  /**
   * Refresh models from API
   */
  async refreshModels(): Promise<void> {
    await this.loadModels();
  }

  /**
   * Load models from OpenRouter API
   */
  private async loadModels(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);

    try {
      const result = await this.rpc.call('openrouter:listModels', {
        toolUseOnly: false,
      });

      if (result.isSuccess() && result.data) {
        const data = result.data as OpenRouterListModelsResult;
        this.availableModels.set(data.models);
      } else {
        this.error.set(result.error || 'Failed to load models');
      }
    } catch (error) {
      this.error.set(
        error instanceof Error ? error.message : 'Failed to load models'
      );
    } finally {
      this.isLoading.set(false);
    }
  }

  /**
   * Load current tier mappings
   */
  private async loadTierMappings(): Promise<void> {
    try {
      const result = await this.rpc.call('openrouter:getModelTiers', {});

      if (result.isSuccess() && result.data) {
        const data = result.data as OpenRouterGetModelTiersResult;
        this.sonnetModel.set(data.sonnet);
        this.opusModel.set(data.opus);
        this.haikuModel.set(data.haiku);
      }
    } catch (error) {
      console.error(
        '[OpenRouterModelSelector] Error loading tier mappings:',
        error
      );
    }
  }

  /**
   * Set tier value in local state
   */
  private setTierValue(tier: OpenRouterModelTier, value: string | null): void {
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
