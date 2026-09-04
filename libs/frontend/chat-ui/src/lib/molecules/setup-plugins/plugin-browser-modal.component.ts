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
import { ClaudeRpcService, PluginCatalogService } from '@ptah-extension/core';
import {
  isOptOutPluginSource,
  type HarnessSetSkillSelectionParams,
  type HarnessSkillCandidate,
  type HarnessSkillSyncMode,
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
 * Timeout for `harness:set-skill-selection`.
 *
 * Far longer than the 10s the plugin calls get, because this one is not a
 * config write: recording the selection runs a propagation pass that copies
 * skills across up to six harness targets and retries on Windows lock
 * contention. `HarnessHealthStore` gives `harness:reconcile` the same budget.
 */
const SKILL_SELECTION_SAVE_TIMEOUT_MS = 90_000;

/**
 * A comparable key for a selection, so "the user changed nothing" is decidable.
 *
 * Slugs are sorted because the backend normalizes them (trimmed, deduplicated,
 * sorted) before recording, and tick-order is not a change. Under `'all'` the
 * allowlist is meaningless and is deliberately excluded from the key — a stale
 * set left over from a previous `'selected'` session must not read as an edit.
 */
function skillSelectionKey(
  mode: HarnessSkillSyncMode,
  slugs: Iterable<string>,
): string {
  if (mode === 'all') {
    return 'all';
  }
  return `selected|${[...slugs].sort().join(',')}`;
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
 * - Per-workspace skill selection: all-vs-allowlist for what this project
 *   propagates into its AI tools' harness directories (TASK_2026_316)
 *
 * ### Two axes, one modal
 *
 * This is the only surface that speaks for both, which is why the selection
 * lives here rather than in a second picker. The plugin checkboxes decide what
 * loads into a SESSION; the section above them decides what this WORKSPACE
 * copies onto disk for Claude, Codex, Copilot and Cursor. They are saved by
 * two different RPCs and neither derives the other — most of the selectable
 * slugs have no plugin above them at all.
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

        <!--
          Which of the user's skills THIS project gets (TASK_2026_316).

          OUTSIDE the loading/error chain below, deliberately. This section
          answers a per-workspace question that has nothing to do with the
          plugin catalogue, and the dashboard's skill-selection card opens
          this modal for it and nothing else. While it lived inside that
          chain's else-branch, a plugin read that was slow — or that belonged
          to another component, since the catalogue is shared — hid the one
          control the user came for, and a plugin read that FAILED hid it for
          good (TASK_2026_345 gate regression).

          No backticks in this comment: the whole template is a template
          literal, so one would end it mid-file.
        -->
        @if (skillSelectionAvailable()) {
          <section
            class="rounded-lg border border-base-300 bg-base-200/30 p-3 mb-4"
            data-testid="skill-selection"
            aria-label="Skills for this project"
          >
            <div class="flex items-start gap-3">
              <div class="flex-1 min-w-0">
                <span class="block text-sm font-medium"
                  >Skills for this project</span
                >
                <span
                  class="block text-xs text-base-content-muted mt-0.5 leading-relaxed"
                >
                  Which of your skills Ptah copies into this project's AI tools.
                  Every project keeps its own answer.
                </span>
              </div>
              <div
                class="join shrink-0"
                role="radiogroup"
                aria-label="Skill selection mode"
              >
                <button
                  class="btn btn-xs join-item"
                  [ngClass]="
                    skillMode() === 'all' ? 'btn-primary' : 'btn-ghost'
                  "
                  type="button"
                  role="radio"
                  [attr.aria-checked]="skillMode() === 'all'"
                  data-testid="skill-mode-all"
                  (click)="setSkillMode('all')"
                >
                  All of them
                </button>
                <button
                  class="btn btn-xs join-item"
                  [ngClass]="
                    skillMode() === 'selected' ? 'btn-primary' : 'btn-ghost'
                  "
                  type="button"
                  role="radio"
                  [attr.aria-checked]="skillMode() === 'selected'"
                  data-testid="skill-mode-selected"
                  (click)="setSkillMode('selected')"
                >
                  Only the ones I pick
                </button>
              </div>
            </div>

            @if (skillMode() === 'all') {
              @if (skillModeDerived()) {
                <span
                  class="block text-xs text-base-content-muted mt-2"
                  data-testid="skill-mode-derived"
                >
                  This project was already receiving skills before it could be
                  asked, so Ptah kept them all flowing. Narrow it whenever you
                  like.
                </span>
              }
            } @else {
              <div
                class="mt-2 max-h-40 overflow-y-auto pr-1"
                role="group"
                aria-label="Selectable skills"
              >
                @for (candidate of skillCandidates(); track candidate.slug) {
                  <label
                    class="flex items-start gap-2 py-1 px-1 -mx-1 rounded cursor-pointer hover:bg-base-200/60"
                  >
                    <input
                      type="checkbox"
                      class="checkbox checkbox-xs checkbox-primary mt-0.5"
                      [checked]="isSkillSlugSelected(candidate.slug)"
                      (change)="toggleSkillSlug(candidate.slug)"
                      [attr.aria-label]="
                        (isSkillSlugSelected(candidate.slug)
                          ? 'Deselect '
                          : 'Select ') + candidate.name
                      "
                    />
                    <span class="min-w-0 flex-1">
                      <span class="block text-xs font-medium">{{
                        candidate.name
                      }}</span>
                      @if (candidate.description) {
                        <span
                          class="block text-xs text-base-content-muted leading-relaxed"
                          >{{ candidate.description }}</span
                        >
                      }
                    </span>
                    @if (candidate.pluginId) {
                      <span class="badge badge-xs badge-ghost shrink-0">{{
                        candidate.pluginId
                      }}</span>
                    }
                  </label>
                } @empty {
                  <span class="block text-xs text-base-content-muted py-2">
                    No skills on this machine yet. Anything you add with the
                    harness wizard, a marketplace or skills.sh shows up here.
                  </span>
                }
              </div>
              <span
                class="block text-xs text-base-content-muted mt-1"
                data-testid="skill-selection-count"
              >
                {{ selectedSkillSlugs().size }} of
                {{ skillCandidates().length }} skills selected
              </span>
            }
          </section>
        }

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
  /**
   * The shared plugin list + config. See `loadPlugins`; the modal keeps its own
   * per-workspace skill selection and its own skill listing, which nothing else
   * reads.
   */
  private readonly catalog = inject(PluginCatalogService);

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

  // -------------------------------------------------------------------------
  // The per-workspace skill selection (TASK_2026_316)
  //
  // A SECOND axis, not a second copy of the first. `selectedIds` above decides
  // which plugins load into a session; the four signals below decide which of
  // the user's skills this WORKSPACE has copied into its AI tools' harness
  // directories, and the two answers are independent — a plugin can be off in
  // chat while its skills still reach Codex, and a hand-authored SKILL.md with
  // no plugin above it has no checkbox on the first axis at all.
  //
  // Which is why the list below is keyed on `available` from
  // `harness:get-skill-selection` rather than on `availablePlugins`. A promoted
  // synth skill, a hand-authored SKILL.md and a `skills.sh` install all arrive
  // with `pluginId: null`, and that is the normal case, not an error. Omitting
  // them would let the first `'selected'` save reap them with no control
  // anywhere able to bring them back.
  // -------------------------------------------------------------------------

  /** Everything this workspace COULD propagate, sorted by slug, as the backend reported it. */
  readonly skillCandidates = signal<HarnessSkillCandidate[]>([]);

  /** The allowlist being edited. Meaningless (and unsent) under `'all'`. */
  readonly selectedSkillSlugs = signal<Set<string>>(new Set());

  /** Whether this workspace propagates everything or only {@link selectedSkillSlugs}. */
  readonly skillMode = signal<HarnessSkillSyncMode>('all');

  /**
   * The `'all'` on screen was inferred by the migration, not chosen by anyone.
   *
   * Surfaced quietly rather than acted on: a user who chose everything and a
   * workspace that predates the gate look identical without it, and only the
   * second deserves a sentence explaining why it is set that way.
   */
  readonly skillModeDerived = signal(false);

  /**
   * Whether the selection section renders at all.
   *
   * False when `harness:get-skill-selection` did not answer — no workspace is
   * open, or the host predates Batch 3. A control that cannot be saved is worse
   * than no control, so the whole section is withheld rather than shown inert.
   */
  readonly skillSelectionAvailable = signal(false);

  /**
   * The selection as loaded, for deciding whether the user actually changed it.
   *
   * Load-bearing, not an optimization. `harness:get-skill-selection` is
   * READ-ONLY on purpose — asking must not record — and saving an untouched
   * derived `'all'` would quietly convert "this workspace predates the gate"
   * into "the user chose everything", destroying the one distinction `derived`
   * exists to carry. It would also spend a full propagation pass every time
   * someone toggles an unrelated plugin.
   */
  private skillSelectionBaseline = skillSelectionKey('all', []);

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
   * Switch between propagating every skill and propagating an allowlist.
   *
   * Switching to `'all'` KEEPS the ticked slugs in memory rather than clearing
   * them, so a user who flips the control to look at the other option and flips
   * back has not lost their work. Nothing stale is ever sent: the save path
   * omits `slugs` entirely under `'all'`, and the backend clears the recorded
   * allowlist itself.
   */
  setSkillMode(mode: HarnessSkillSyncMode): void {
    this.skillMode.set(mode);
  }

  /** Whether a slug is in the allowlist being edited. */
  isSkillSlugSelected(slug: string): boolean {
    return this.selectedSkillSlugs().has(slug);
  }

  /** Add or remove one slug, immutably so the signal actually fires. */
  toggleSkillSlug(slug: string): void {
    const updated = new Set(this.selectedSkillSlugs());
    if (updated.has(slug)) {
      updated.delete(slug);
    } else {
      updated.add(slug);
    }
    this.selectedSkillSlugs.set(updated);
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
        // The shared catalog now holds the PREVIOUS config. Re-read it before
        // anything renders from it — the status widget beside this modal reads
        // the same signals, and leaving it stale would show the old count until
        // the window reloaded. Awaited rather than fired: `saved` below is what
        // parents act on, and a parent that re-reads must not race this.
        await this.catalog.refresh();
        // Second write, and only if the user moved this control. It runs after
        // the plugin save rather than beside it because both propagate, and
        // the selection is the narrower filter — letting it land last means the
        // harness ends the save reflecting the answer the user just gave.
        if (!(await this.saveSkillSelection())) {
          this.saveError.set(
            'Your plugin choices were saved, but Ptah could not record which skills this project gets.',
          );
          return;
        }
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
   * Record the skill selection, if and only if the user changed it.
   *
   * Returns `true` for "nothing to do" as well as for a successful write —
   * both mean the recorded selection now matches what is on screen. A `saved:
   * false` reply is a real failure: the previous selection stays in force and
   * no pass ran, so reporting success would show the user a selection the next
   * reconcile does not honour.
   *
   * The reply's NORMALIZED slugs are adopted rather than the ones sent, so the
   * baseline matches what is actually on disk (trimmed, deduplicated, sorted)
   * and a re-save cannot fire on a difference that only exists locally.
   */
  private async saveSkillSelection(): Promise<boolean> {
    if (!this.skillSelectionAvailable()) {
      return true;
    }

    const mode = this.skillMode();
    const slugs = this.selectedSkillSlugs();
    if (skillSelectionKey(mode, slugs) === this.skillSelectionBaseline) {
      return true;
    }

    const params: HarnessSetSkillSelectionParams =
      mode === 'all' ? { mode } : { mode, slugs: Array.from(slugs) };

    try {
      const result = await this.rpcService.call(
        'harness:set-skill-selection',
        params,
        { timeout: SKILL_SELECTION_SAVE_TIMEOUT_MS },
      );

      if (result.isSuccess() && result.data?.saved) {
        this.applySkillSelection({
          mode: result.data.mode,
          slugs: result.data.slugs,
          // The user just answered, so nothing here is inferred any more.
          derived: false,
        });
        return true;
      }

      console.error(
        '[PluginBrowserModal] Failed to record the skill selection:',
        result.error,
      );
      return false;
    } catch (err: unknown) {
      console.error(
        '[PluginBrowserModal] Error recording the skill selection:',
        err,
      );
      return false;
    }
  }

  /**
   * Adopt a selection the backend reported, and take it as the new baseline.
   *
   * `available` is optional because the save reply does not carry it: recording
   * a selection cannot change what the user layer OFFERS, only which of it this
   * workspace takes, so the loaded candidate list stays as it is.
   */
  private applySkillSelection(selection: {
    mode: HarnessSkillSyncMode;
    slugs: string[];
    derived: boolean;
    available?: HarnessSkillCandidate[];
  }): void {
    if (selection.available !== undefined) {
      this.skillCandidates.set(selection.available);
    }
    this.skillMode.set(selection.mode);
    this.selectedSkillSlugs.set(new Set(selection.slugs));
    this.skillModeDerived.set(selection.derived);
    this.skillSelectionBaseline = skillSelectionKey(
      selection.mode,
      selection.slugs,
    );
    this.skillSelectionAvailable.set(true);
  }

  /**
   * Withdraw the selection section entirely.
   *
   * For no workspace, a host that predates Batch 3, or a failed read — in every
   * case the modal does not know the current selection, and a control seeded
   * with a guess would let a Save write that guess to disk.
   */
  private clearSkillSelection(): void {
    this.skillSelectionAvailable.set(false);
    this.skillCandidates.set([]);
    this.selectedSkillSlugs.set(new Set());
    this.skillMode.set('all');
    this.skillModeDerived.set(false);
    this.skillSelectionBaseline = skillSelectionKey('all', []);
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

    // Two reads, started together and applied INDEPENDENTLY.
    //
    // The catalog is SHARED (TASK_2026_345). This modal is mounted beside a
    // `PluginStatusWidgetComponent` in every view that hosts it, and both used
    // to issue their own `plugins:list-available` + `plugins:get-config` pair —
    // visibly, as duplicate pairs in `tmp/logs/log.log:1907-1924`.
    // `ensureLoaded` is the first read or a no-op; `saveConfiguration` below is
    // what makes it stale again.
    const catalogLoad = this.catalog.ensureLoaded();
    // NOT part of the shared catalog: the skill selection is per-WORKSPACE, it
    // has its own failure semantics, and only this modal reads it. It swallows
    // its own rejection rather than failing the load — a host without this
    // handler, or with no workspace open, must still be able to configure
    // plugins, and the section it feeds simply does not render.
    const selectionRead = this.rpcService
      .call('harness:get-skill-selection', {}, { timeout: 10000 })
      .catch(() => null);

    // Applied BEFORE the catalog is awaited, and never inside its try. These
    // two answers have nothing to do with each other: the selection is the only
    // thing the dashboard's skill-selection card opens this modal for, and
    // `ensureLoaded()` can hand back a read that a DIFFERENT component started,
    // so sequencing the selection behind it made the one control the user came
    // for wait on a request this modal did not even issue.
    const selectionResult = await selectionRead;
    if (selectionResult?.isSuccess() && selectionResult.data) {
      this.applySkillSelection(selectionResult.data);
    } else {
      this.clearSkillSelection();
    }

    try {
      await catalogLoad;

      const plugins: PluginInfo[] = [...this.catalog.plugins()];
      this.availablePlugins.set(plugins);

      const config = this.catalog.config();
      if (config !== null) {
        this.selectedIds.set(
          this.deriveSelection(plugins, config.enabledPluginIds, [
            ...(config.disabledPluginIds ?? []),
          ]),
        );
        this.disabledSkillIds.set(new Set(config.disabledSkillIds ?? []));
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
      // Deliberately NOT `clearSkillSelection()`. The selection was read and
      // applied above, by a request that succeeded; a failure on the plugin
      // side has nothing to say about which skills this project gets, and
      // discarding a good answer because an unrelated read failed is how the
      // dashboard's card could open this modal and offer no control at all.
    } finally {
      this.isLoading.set(false);
    }
  }
}
