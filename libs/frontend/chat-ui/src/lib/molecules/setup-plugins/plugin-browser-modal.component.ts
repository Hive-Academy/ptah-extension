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
  ChevronDown,
  ChevronRight,
  Wand2,
} from 'lucide-angular';
import { ClaudeRpcService } from '@ptah-extension/core';
import {
  isOptOutPluginSource,
  type PluginInfo,
  type PluginSkillEntry,
} from '@ptah-extension/shared';
import { NgClass } from '@angular/common';

/**
 * Category display metadata for grouping plugins in the browser.
 */
interface CategoryGroup {
  key: PluginInfo['category'];
  label: string;
  plugins: PluginInfo[];
}

/** Ordered category definitions for display grouping.
 * MUST match categories defined in plugin-loader.service.ts AVAILABLE_PLUGINS
 * plus the dynamic `harness-tools` category the loader assigns to discovered
 * `ptah-harness-*` directories and `external-tools` for plugins installed from
 * a registered external marketplace.
 *
 * The `Record` is exhaustive over `PluginInfo['category']` deliberately: widening
 * that union without adding a label here is a compile error rather than a group
 * that silently renders with no heading. */
const CATEGORY_LABELS: Record<PluginInfo['category'], string> = {
  'core-tools': 'Core Tools',
  'backend-tools': 'Backend Tools',
  'frontend-tools': 'Frontend Tools',
  'creative-tools': 'Creative Tools',
  'harness-tools': 'Your Skills',
  'external-tools': 'From Marketplaces',
};

const CATEGORY_ORDER: PluginInfo['category'][] = [
  'core-tools',
  'backend-tools',
  'frontend-tools',
  'creative-tools',
  'harness-tools',
  'external-tools',
];

/**
 * True when the plugin is OPT-OUT — enabled the moment it exists on disk,
 * disabled only by an explicit entry in `disabledPluginIds`.
 *
 * That is the harness wizard's own skills and, since TASK_2026_288, skills.sh
 * installs: in both cases the user named this exact artifact on purpose.
 * Bundled and external plugins (and any legacy payload with no `source`) are
 * OPT-IN via `enabledPluginIds`.
 *
 * Delegates to the shared rule so this modal, the status widget's count and
 * `PluginLoaderService.resolveCurrentPluginPaths` cannot drift.
 */
function isOptOutPlugin(plugin: PluginInfo): boolean {
  return isOptOutPluginSource(plugin.source);
}

/**
 * PluginBrowserModalComponent - Modal dialog for browsing and configuring plugins
 *
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
  imports: [LucideAngularModule, NgClass],
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
              <span class="block text-sm text-base-content-muted">
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
            <lucide-angular [img]="XIcon" class="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        @if (isLoading()) {
          <!-- Loading state -->
          <div class="flex flex-col gap-3 py-8">
            <div class="flex justify-center">
              <span
                class="loading loading-spinner loading-md text-primary"
              ></span>
            </div>
            <span class="block text-sm text-base-content-muted text-center">
              Loading available plugins...
            </span>
          </div>
        } @else if (error()) {
          <!-- Error state -->
          <div class="flex flex-col items-center gap-3 py-8">
            <span class="text-error text-sm text-center">{{ error() }}</span>
            <button
              class="btn btn-sm btn-ghost"
              (click)="loadPlugins()"
              type="button"
            >
              Try Again
            </button>
          </div>
        } @else {
          <!-- Search input -->
          <div class="relative mb-4">
            <lucide-angular
              [img]="SearchIcon"
              class="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-base-content-muted"
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
                  class="block text-xs font-semibold uppercase tracking-wider text-base-content-muted mb-2"
                >
                  {{ group.label }}
                </span>

                <!-- Plugin cards -->
                <div class="space-y-2">
                  @for (plugin of group.plugins; track plugin.id) {
                    <div
                      class="rounded-lg border transition-all duration-150"
                      [ngClass]="
                        isSelected(plugin.id)
                          ? 'border-primary bg-primary/5'
                          : 'border-base-300 bg-base-200/30 hover:bg-base-200/60'
                      "
                      role="listitem"
                    >
                      <!-- Plugin header row (clickable to toggle plugin) -->
                      <div
                        class="flex items-start gap-3 p-3 cursor-pointer"
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
                            <span class="text-sm font-medium">{{
                              plugin.name
                            }}</span>
                            @if (plugin.isDefault) {
                              <span class="badge badge-xs badge-primary gap-1">
                                <lucide-angular
                                  [img]="StarIcon"
                                  class="w-2.5 h-2.5"
                                  aria-hidden="true"
                                />
                                Recommended
                              </span>
                            }
                            @if (plugin.source === 'harness') {
                              <span
                                class="badge badge-xs badge-secondary gap-1"
                              >
                                <lucide-angular
                                  [img]="WandIcon"
                                  class="w-2.5 h-2.5"
                                  aria-hidden="true"
                                />
                                Yours
                              </span>
                            }
                          </div>
                          <span
                            class="block text-xs text-base-content-muted mt-0.5 leading-relaxed"
                          >
                            {{ plugin.description }}
                          </span>
                          <!-- Badges: skill count, command count, expand chevron -->
                          <div class="flex items-center gap-1.5 mt-1.5">
                            @if (plugin.skillCount > 0) {
                              <span class="badge badge-xs badge-ghost gap-1">
                                <lucide-angular
                                  [img]="PackageIcon"
                                  class="w-2.5 h-2.5"
                                  aria-hidden="true"
                                />
                                {{ plugin.skillCount }}
                                skill{{ plugin.skillCount !== 1 ? 's' : '' }}
                              </span>
                              @if (
                                isSelected(plugin.id) &&
                                pluginSkills().get(plugin.id)?.length
                              ) {
                                <button
                                  class="btn btn-ghost btn-xs px-1 h-5 min-h-0"
                                  (click)="toggleExpand(plugin.id, $event)"
                                  type="button"
                                  [attr.aria-label]="
                                    isPluginExpanded(plugin.id)
                                      ? 'Collapse skill list'
                                      : 'Expand skill list'
                                  "
                                  [attr.aria-expanded]="
                                    isPluginExpanded(plugin.id)
                                  "
                                >
                                  <lucide-angular
                                    [img]="
                                      isPluginExpanded(plugin.id)
                                        ? ChevronDownIcon
                                        : ChevronRightIcon
                                    "
                                    class="w-3 h-3"
                                    aria-hidden="true"
                                  />
                                </button>
                              }
                            }
                            @if (plugin.commandCount > 0) {
                              <span class="badge badge-xs badge-ghost gap-1">
                                {{ plugin.commandCount }}
                                command{{
                                  plugin.commandCount !== 1 ? 's' : ''
                                }}
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

                      <!-- Expandable skill list (only when plugin is selected AND expanded) -->
                      @if (
                        isSelected(plugin.id) &&
                        isPluginExpanded(plugin.id) &&
                        pluginSkills().get(plugin.id)?.length
                      ) {
                        <div class="border-t border-base-300/50 mx-3 pb-3">
                          <div
                            class="pt-2 pl-8"
                            role="group"
                            [attr.aria-label]="'Skills for ' + plugin.name"
                          >
                            @for (
                              skill of pluginSkills().get(plugin.id)!;
                              track skill.skillId
                            ) {
                              <label
                                class="flex items-center gap-2 py-1.5 cursor-pointer hover:bg-base-200/40 rounded px-1 -mx-1"
                                (click)="$event.stopPropagation()"
                              >
                                <input
                                  type="checkbox"
                                  class="checkbox checkbox-xs checkbox-primary"
                                  [checked]="isSkillEnabled(skill.skillId)"
                                  (change)="toggleSkill(skill.skillId, $event)"
                                  [attr.aria-label]="
                                    (isSkillEnabled(skill.skillId)
                                      ? 'Disable '
                                      : 'Enable ') + skill.displayName
                                  "
                                />
                                <span
                                  class="text-xs font-medium whitespace-nowrap"
                                  >{{ skill.displayName }}</span
                                >
                                <span
                                  class="text-xs text-base-content-muted truncate"
                                  >{{ skill.description }}</span
                                >
                              </label>
                            }
                          </div>
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            } @empty {
              <div class="text-center py-6 text-base-content-muted">
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
            <span class="text-xs text-base-content-muted flex-1">
              {{ selectedIds().size }} of
              {{ availablePlugins().length }} selected
              @if (disabledSkillIds().size > 0) {
                <span class="text-base-content-muted">
                  &middot; {{ disabledSkillIds().size }} skill{{
                    disabledSkillIds().size !== 1 ? 's' : ''
                  }}
                  disabled
                </span>
              }
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
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly WandIcon = Wand2;

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

  /** Map of pluginId -> PluginSkillEntry[] for per-skill toggling */
  readonly pluginSkills = signal<Map<string, PluginSkillEntry[]>>(new Map());

  /** Set of disabled skill IDs (skills the user has explicitly turned off) */
  readonly disabledSkillIds = signal<Set<string>>(new Set());

  /** Set of plugin IDs whose skill list is currently expanded */
  readonly expandedPlugins = signal<Set<string>>(new Set());

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
        plugin.keywords.some((kw) => kw.toLowerCase().includes(query)),
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
        (p) => p.category === categoryKey,
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
    effect(() => {
      const open = this.isOpen();
      if (open) {
        this.loadPlugins();
      } else {
        this.searchQuery.set('');
        this.expandedPlugins.set(new Set());
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
   * Toggle expanded state for a plugin's skill list.
   * Uses immutable Set update pattern for signal reactivity.
   */
  toggleExpand(pluginId: string, event: Event): void {
    event.stopPropagation();
    const current = this.expandedPlugins();
    const updated = new Set(current);

    if (updated.has(pluginId)) {
      updated.delete(pluginId);
    } else {
      updated.add(pluginId);
    }

    this.expandedPlugins.set(updated);
  }

  /**
   * Toggle a skill's enabled/disabled state.
   * If in disabledSkillIds -> remove (enable). If not -> add (disable).
   */
  toggleSkill(skillId: string, event: Event): void {
    event.stopPropagation();
    const current = this.disabledSkillIds();
    const updated = new Set(current);

    if (updated.has(skillId)) {
      updated.delete(skillId);
    } else {
      updated.add(skillId);
    }

    this.disabledSkillIds.set(updated);
  }

  /**
   * Check if a skill is enabled (not in disabled set).
   */
  isSkillEnabled(skillId: string): boolean {
    return !this.disabledSkillIds().has(skillId);
  }

  /**
   * Check if a plugin's skill list is currently expanded.
   */
  isPluginExpanded(pluginId: string): boolean {
    return this.expandedPlugins().has(pluginId);
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
   *
   * Harness plugins are opt-out, so an unchecked one cannot be expressed by
   * simply leaving it out of `enabledPluginIds` — the backend would rediscover
   * it and re-enable it. Every unchecked harness plugin is therefore sent
   * explicitly in `disabledPluginIds`.
   *
   * The inverse also holds: a CHECKED harness plugin is deliberately kept OUT
   * of `enabledPluginIds`. That list drives the user-layer mirror, and
   * The harness reconciler's flat skill map lets a mirrored copy win over the
   * live plugin directory — mirroring a harness plugin would freeze its skills
   * at mirror time and hide later wizard edits. Absence from the denylist is
   * the whole "enabled" signal for harness plugins.
   */
  async saveConfiguration(): Promise<void> {
    this.isSaving.set(true);
    this.saveError.set(null);

    try {
      const selected = this.selectedIds();
      const harnessIds = new Set(
        this.availablePlugins()
          .filter(isOptOutPlugin)
          .map((p) => p.id),
      );
      const enabledPluginIds = Array.from(selected).filter(
        (id) => !harnessIds.has(id),
      );
      const disabledSkillIds = Array.from(this.disabledSkillIds());
      const disabledPluginIds = Array.from(harnessIds).filter(
        (id) => !selected.has(id),
      );

      const result = await this.rpcService.call(
        'plugins:save-config',
        { enabledPluginIds, disabledSkillIds, disabledPluginIds },
        { timeout: 10000 },
      );

      if (result.isSuccess()) {
        this.saved.emit(enabledPluginIds);
        this.closed.emit();
      } else {
        console.error(
          '[PluginBrowserModal] Failed to save config:',
          result.error,
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
   * Translate the persisted config into the modal's checkbox state.
   *
   * The two activation models are collapsed into one `selectedIds` set here so
   * the template stays a plain checked/unchecked render:
   * - bundled (opt-in)  → checked when listed in `enabledPluginIds`
   * - harness (opt-out) → checked unless listed in `disabledPluginIds`
   */
  private deriveSelection(
    plugins: PluginInfo[],
    enabledPluginIds: string[],
    disabledPluginIds: string[],
  ): Set<string> {
    const enabled = new Set(enabledPluginIds);
    const disabled = new Set(disabledPluginIds);

    const selection = new Set(
      enabledPluginIds.filter((id) => !disabled.has(id)),
    );

    for (const plugin of plugins) {
      if (!isOptOutPlugin(plugin)) continue;
      if (disabled.has(plugin.id)) {
        selection.delete(plugin.id);
      } else if (!enabled.has(plugin.id)) {
        selection.add(plugin.id);
      }
    }

    return selection;
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
        this.rpcService.call('plugins:list-available', {}, { timeout: 10000 }),
        this.rpcService.call('plugins:get-config', {}, { timeout: 10000 }),
      ]);

      let plugins: PluginInfo[] = [];

      if (listResult.isSuccess() && listResult.data) {
        plugins = listResult.data.plugins;
        this.availablePlugins.set(plugins);
      } else {
        this.availablePlugins.set([]);
      }

      if (configResult.isSuccess() && configResult.data) {
        this.selectedIds.set(
          this.deriveSelection(plugins, configResult.data.enabledPluginIds, [
            ...(configResult.data.disabledPluginIds ?? []),
          ]),
        );
        this.disabledSkillIds.set(
          new Set(configResult.data.disabledSkillIds ?? []),
        );
      } else {
        this.selectedIds.set(new Set());
        this.disabledSkillIds.set(new Set());
      }
      if (plugins.length > 0) {
        try {
          const pluginIds = plugins.map((p) => p.id);
          const skillsResult = await this.rpcService.call(
            'plugins:list-skills',
            { pluginIds },
            { timeout: 10000 },
          );

          if (skillsResult.isSuccess() && skillsResult.data) {
            const skillsMap = new Map<string, PluginSkillEntry[]>();
            for (const skill of skillsResult.data.skills) {
              const existing = skillsMap.get(skill.pluginId) ?? [];
              existing.push(skill);
              skillsMap.set(skill.pluginId, existing);
            }
            this.pluginSkills.set(skillsMap);
          } else {
            this.pluginSkills.set(new Map());
          }
        } catch (skillsErr) {
          console.warn(
            '[PluginBrowserModal] Failed to load skills (non-fatal):',
            skillsErr,
          );
          this.pluginSkills.set(new Map());
        }
      }
    } catch (err) {
      console.error('[PluginBrowserModal] Error loading plugins:', err);
      this.error.set('Failed to load plugins. Please try again.');
      this.availablePlugins.set([]);
      this.selectedIds.set(new Set());
      this.pluginSkills.set(new Map());
      this.disabledSkillIds.set(new Set());
    } finally {
      this.isLoading.set(false);
    }
  }
}
