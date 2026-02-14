import {
  Component,
  input,
  signal,
  computed,
  inject,
  output,
  effect,
  ChangeDetectionStrategy,
} from '@angular/core';
import {
  LucideAngularModule,
  Puzzle,
  Check,
  X,
  Search,
  Package,
  Star,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import type { PluginInfo } from '@ptah-extension/shared';

/**
 * Category display metadata for grouping plugins in the browser.
 */
interface CategoryGroup {
  key: PluginInfo['category'];
  label: string;
  plugins: PluginInfo[];
}

/** Ordered category definitions for display grouping.
 * MUST match categories defined in plugin-loader.service.ts AVAILABLE_PLUGINS */
const CATEGORY_LABELS: Record<PluginInfo['category'], string> = {
  'core-tools': 'Core Tools',
  'backend-tools': 'Backend Tools',
  'frontend-tools': 'Frontend Tools',
};

const CATEGORY_ORDER: PluginInfo['category'][] = [
  'core-tools',
  'backend-tools',
  'frontend-tools',
];

/**
 * PluginBrowserModalComponent - Modal dialog for browsing and configuring plugins
 *
 * TASK_2025_153: Phase 6 - Frontend Components
 *
 * Complexity Level: 2 (Medium - RPC communication + modal state + filtering)
 * Patterns: Signal-based state, DaisyUI modal, computed filtering, effect for open trigger
 *
 * Features:
 * - Loads available plugins and current config when opened
 * - Groups plugins by category (Core, Backend, Frontend)
 * - Search/filter plugins by name, description, keywords
 * - Checkbox selection with immutable Set signal updates
 * - Saves configuration via RPC on confirm
 * - Recommended badge for default plugins
 *
 * SOLID Principles:
 * - Single Responsibility: Browse and configure plugin selection
 * - Open/Closed: Inputs/outputs for parent control, closed for modification
 * - Dependency Inversion: Depends on ClaudeRpcService abstraction
 */
@Component({
  selector: 'ptah-plugin-browser-modal',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <dialog class="modal" [class.modal-open]="isOpen()">
      <div class="modal-box max-w-2xl">
        <!-- Header -->
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-3">
            <div
              class="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center"
            >
              <lucide-angular
                [img]="PuzzleIcon"
                class="w-5 h-5 text-primary"
                aria-hidden="true"
              />
            </div>
            <div>
              <span class="block font-bold text-lg">Configure Ptah Skills</span>
              <span class="block text-sm text-base-content/60">
                Select plugins to enhance your AI sessions
              </span>
            </div>
          </div>
          <button
            class="btn btn-sm btn-circle btn-ghost"
            (click)="handleClose()"
            type="button"
            aria-label="Close plugin browser"
          >
            <lucide-angular
              [img]="XIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
          </button>
        </div>

        @if (isLoading()) {
        <!-- Loading state -->
        <div class="flex flex-col gap-3 py-8">
          <div class="flex justify-center">
            <span class="loading loading-spinner loading-md text-primary"></span>
          </div>
          <span class="block text-sm text-base-content/60 text-center">
            Loading available plugins...
          </span>
        </div>
        } @else if (error()) {
        <!-- Error state -->
        <div class="flex flex-col items-center gap-3 py-8">
          <span class="text-error text-sm text-center">{{ error() }}</span>
          <button class="btn btn-sm btn-ghost" (click)="loadPlugins()" type="button">
            Try Again
          </button>
        </div>
        } @else {
        <!-- Search input -->
        <div class="relative mb-4">
          <lucide-angular
            [img]="SearchIcon"
            class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content/40"
            aria-hidden="true"
          />
          <input
            type="text"
            class="input input-bordered input-sm w-full pl-9"
            placeholder="Search plugins..."
            [value]="searchQuery()"
            (input)="onSearchInput($event)"
            aria-label="Search plugins"
          />
        </div>

        <!-- Plugin list grouped by category -->
        <div
          class="max-h-[50vh] overflow-y-auto space-y-4 pr-1"
          role="list"
          aria-label="Available plugins"
        >
          @for (group of groupedPlugins(); track group.key) {
          <div>
            <!-- Category header -->
            <span
              class="block text-xs font-semibold uppercase tracking-wider text-base-content/50 mb-2"
            >
              {{ group.label }}
            </span>

            <!-- Plugin cards -->
            <div class="space-y-2">
              @for (plugin of group.plugins; track plugin.id) {
              <div
                class="flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-all duration-150"
                [class]="isSelected(plugin.id) ? 'border-primary bg-primary/5' : 'border-base-300 bg-base-200/30 hover:bg-base-200/60'"
                role="listitem"
                (click)="togglePlugin(plugin.id)"
              >
                <!-- Checkbox -->
                <input
                  type="checkbox"
                  class="checkbox checkbox-primary checkbox-sm mt-0.5"
                  [checked]="isSelected(plugin.id)"
                  [attr.aria-label]="'Enable ' + plugin.name"
                />

                <!-- Plugin info -->
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2 flex-wrap">
                    <span class="text-sm font-medium">{{ plugin.name }}</span>
                    @if (plugin.isDefault) {
                    <span
                      class="badge badge-xs badge-primary gap-1"
                    >
                      <lucide-angular
                        [img]="StarIcon"
                        class="w-2.5 h-2.5"
                        aria-hidden="true"
                      />
                      Recommended
                    </span>
                    }
                  </div>
                  <span
                    class="block text-xs text-base-content/60 mt-0.5 leading-relaxed"
                  >
                    {{ plugin.description }}
                  </span>
                  <!-- Badges: skill count, command count -->
                  <div class="flex gap-1.5 mt-1.5">
                    @if (plugin.skillCount > 0) {
                    <span
                      class="badge badge-xs badge-ghost gap-1"
                    >
                      <lucide-angular
                        [img]="PackageIcon"
                        class="w-2.5 h-2.5"
                        aria-hidden="true"
                      />
                      {{ plugin.skillCount }}
                      skill{{ plugin.skillCount !== 1 ? 's' : '' }}
                    </span>
                    } @if (plugin.commandCount > 0) {
                    <span
                      class="badge badge-xs badge-ghost gap-1"
                    >
                      {{ plugin.commandCount }}
                      command{{ plugin.commandCount !== 1 ? 's' : '' }}
                    </span>
                    }
                  </div>
                </div>

                <!-- Selected indicator -->
                @if (isSelected(plugin.id)) {
                <lucide-angular
                  [img]="CheckIcon"
                  class="w-4 h-4 text-primary shrink-0 mt-1"
                  aria-hidden="true"
                />
                }
              </div>
              }
            </div>
          </div>
          } @empty {
          <div class="text-center py-6 text-base-content/50">
            <span class="block text-sm">
              @if (searchQuery()) {
                No plugins match your search.
              } @else {
                No plugins available.
              }
            </span>
          </div>
          }
        </div>

        <!-- Footer -->
        <div class="modal-action mt-4 pt-3 border-t border-base-300">
          <span class="text-xs text-base-content/50 flex-1">
            {{ selectedIds().size }} of {{ availablePlugins().length }} selected
          </span>
          @if (saveError()) {
          <span class="text-error text-xs">{{ saveError() }}</span>
          }
          <button
            class="btn btn-ghost btn-sm"
            (click)="handleClose()"
            type="button"
          >
            Cancel
          </button>
          <button
            class="btn btn-primary btn-sm"
            [disabled]="isSaving()"
            (click)="saveConfiguration()"
            type="button"
          >
            @if (isSaving()) {
            <span class="loading loading-spinner loading-xs"></span>
            Saving...
            } @else {
            <lucide-angular
              [img]="CheckIcon"
              class="w-4 h-4"
              aria-hidden="true"
            />
            Save Configuration
            }
          </button>
        </div>
        }
      </div>

      <!-- Backdrop - click outside to close -->
      <div class="modal-backdrop" (click)="handleClose()"></div>
    </dialog>
  `,
  styles: [
    `
      :host {
        display: contents;
      }
    `,
  ],
})
export class PluginBrowserModalComponent {
  private readonly rpcService = inject(ClaudeRpcService);

  /** Lucide icon references */
  protected readonly PuzzleIcon = Puzzle;
  protected readonly CheckIcon = Check;
  protected readonly XIcon = X;
  protected readonly SearchIcon = Search;
  protected readonly PackageIcon = Package;
  protected readonly StarIcon = Star;

  /** Controls modal visibility (from parent) */
  readonly isOpen = input(false);

  /** Emitted when modal is closed */
  readonly closed = output<void>();

  /** Emitted when configuration is saved (emits enabled plugin IDs) */
  readonly saved = output<string[]>();

  /** List of all available plugins from backend */
  readonly availablePlugins = signal<PluginInfo[]>([]);

  /** Set of currently selected plugin IDs */
  readonly selectedIds = signal<Set<string>>(new Set());

  /** User's search filter text */
  readonly searchQuery = signal('');

  /** Whether plugins are being loaded */
  readonly isLoading = signal(true);

  /** Whether save is in progress */
  readonly isSaving = signal(false);

  /** Error message from loading plugins */
  readonly error = signal<string | null>(null);

  /** Error message from saving configuration */
  readonly saveError = signal<string | null>(null);

  /**
   * Filtered plugins based on search query.
   * Matches against name, description, and keywords.
   */
  readonly filteredPlugins = computed(() => {
    const query = this.searchQuery().toLowerCase().trim();
    const plugins = this.availablePlugins();

    if (!query) {
      return plugins;
    }

    return plugins.filter(
      (plugin) =>
        plugin.name.toLowerCase().includes(query) ||
        plugin.description.toLowerCase().includes(query) ||
        plugin.keywords.some((kw) => kw.toLowerCase().includes(query))
    );
  });

  /**
   * Plugins grouped by category for organized display.
   * Only includes categories that have matching plugins.
   */
  readonly groupedPlugins = computed<CategoryGroup[]>(() => {
    const filtered = this.filteredPlugins();
    const groups: CategoryGroup[] = [];

    for (const categoryKey of CATEGORY_ORDER) {
      const categoryPlugins = filtered.filter(
        (p) => p.category === categoryKey
      );
      if (categoryPlugins.length > 0) {
        groups.push({
          key: categoryKey,
          label: CATEGORY_LABELS[categoryKey],
          plugins: categoryPlugins,
        });
      }
    }

    return groups;
  });

  constructor() {
    // Watch for isOpen changes to load plugins when modal opens
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.loadPlugins();
      } else {
        // Reset search when modal closes
        this.searchQuery.set('');
      }
    });
  }

  /**
   * Check if a plugin ID is in the selected set.
   * Used by template for checkbox state and visual indicators.
   */
  isSelected(pluginId: string): boolean {
    return this.selectedIds().has(pluginId);
  }

  /**
   * Toggle a plugin's selection state.
   * Uses immutable Set update pattern for signal reactivity.
   */
  togglePlugin(pluginId: string): void {
    const current = this.selectedIds();
    const updated = new Set(current);

    if (updated.has(pluginId)) {
      updated.delete(pluginId);
    } else {
      updated.add(pluginId);
    }

    this.selectedIds.set(updated);
  }

  /**
   * Handle search input changes.
   */
  onSearchInput(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
  }

  /**
   * Close modal and emit closed event.
   */
  handleClose(): void {
    this.closed.emit();
  }

  /**
   * Save the current plugin configuration via RPC.
   * Emits saved with enabled IDs, then closes modal.
   */
  async saveConfiguration(): Promise<void> {
    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      const enabledPluginIds = Array.from(this.selectedIds());

      const result = await this.rpcService.call(
        'plugins:save-config',
        { enabledPluginIds },
        { timeout: 10000 }
      );

      if (result.isSuccess()) {
        this.saved.emit(enabledPluginIds);
        this.closed.emit();
      } else {
        console.error(
          '[PluginBrowserModal] Failed to save config:',
          result.error
        );
        this.saveError.set('Failed to save configuration.');
      }
    } catch (err) {
      console.error('[PluginBrowserModal] Error saving config:', err);
      this.saveError.set('Failed to save configuration.');
    } finally {
      this.isSaving.set(false);
    }
  }

  /**
   * Load available plugins and current configuration from backend.
   * Called via effect when isOpen becomes true, and by error retry button.
   */
  async loadPlugins(): Promise<void> {
    this.isLoading.set(true);
    this.error.set(null);
    this.saveError.set(null);

    try {
      const [listResult, configResult] = await Promise.all([
        this.rpcService.call(
          'plugins:list-available',
          {},
          { timeout: 10000 }
        ),
        this.rpcService.call('plugins:get-config', {}, { timeout: 10000 }),
      ]);

      if (listResult.isSuccess() && listResult.data) {
        this.availablePlugins.set(listResult.data.plugins);
      } else {
        this.availablePlugins.set([]);
      }

      if (configResult.isSuccess() && configResult.data) {
        this.selectedIds.set(
          new Set(configResult.data.enabledPluginIds)
        );
      } else {
        this.selectedIds.set(new Set());
      }
    } catch (err) {
      console.error('[PluginBrowserModal] Error loading plugins:', err);
      this.error.set('Failed to load plugins. Please try again.');
      this.availablePlugins.set([]);
      this.selectedIds.set(new Set());
    } finally {
      this.isLoading.set(false);
    }
  }
}
