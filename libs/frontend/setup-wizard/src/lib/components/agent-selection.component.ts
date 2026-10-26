import {
  Component,
  inject,
  ChangeDetectionStrategy,
  computed,
  signal,
} from '@angular/core';
import {
  SetupWizardStateService,
  AgentRecommendation,
  SkillGenerationProgressItem,
} from '../services/setup-wizard-state.service';
import {
  WizardRpcService,
  type BoundAgentDecisions,
} from '../services/wizard-rpc.service';
import { VSCodeService } from '@ptah-extension/core';
import { AgentCategory } from '@ptah-extension/shared';
import { withErrorHandling } from '../utils/error-handling';
import {
  LucideAngularModule,
  XCircle,
  Check,
  Users,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  Globe,
  Zap,
  LayoutDashboard,
  Code,
  Search,
  Settings,
  Palette,
  Package,
} from 'lucide-angular';
import type {
  AgentPackInfoDto,
  FileDecision,
  GenerationTargetChoice,
  GenerationTargetInfo,
  WizardPreviewGenerationResponse,
} from '@ptah-extension/shared';
import type { PreviewRowDecision } from './agent-preview-dialog.component';
import { GenerationPreviewModalComponent } from './generation-preview-modal.component';
import {
  KEPT_PACK_NOTE,
  PackInstallPromptComponent,
  openedFolderNotice,
  packResultCounts,
  type PackFileStatus,
  type PackInstallFinished,
  type PackInstallRequest,
  type PackInstallStart,
} from './pack-install-prompt.component';
import {
  buildWizardRows,
  decisionCounts,
  decisionEntries,
  nextSnapshot,
  setAllDecisions,
  setDecision,
  targetFolder,
  targetsSignature,
  type DecisionSnapshot,
} from './preview-decisions/preview-decisions.state';

/**
 * AgentSelectionComponent - Agent selection with relevance scores and recommendations
 *
 * Purpose:
 * - Display available agents with relevance scores from deep analysis
 * - Show matched criteria as tooltips/badges
 * - Visual indicator for "Recommended" agents (score >= 75)
 * - Auto-select highly recommended agents (score >= 80)
 * - Sort agents by score descending
 * - Group agents by category
 *
 * Features:
 * - DaisyUI card layout with agent cards grouped by category
 * - Relevance score progress bars with percentage
 * - "Recommended" badge for high-scoring agents
 * - Matched criteria tooltips
 * - Select All Recommended / Deselect All buttons
 * - Total selected count display
 * - Signal-based reactive UI
 * - 'Other' fallback category for unknown agent types
 *
 * Usage:
 * ```html
 * <ptah-agent-selection />
 * ```
 */
@Component({
  selector: 'ptah-agent-selection',
  standalone: true,
  imports: [
    LucideAngularModule,
    GenerationPreviewModalComponent,
    PackInstallPromptComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="px-3 py-4">
      <!-- Tab bar -->
      <div class="flex items-center gap-0 border-b border-base-300/30 mb-4">
        <button
          class="px-4 py-2 text-xs font-medium transition-colors relative"
          [class.text-primary]="activeTab() === 'project'"
          [class.text-base-content-muted]="activeTab() !== 'project'"
          (click)="activeTab.set('project')"
        >
          <lucide-angular
            [img]="UsersIcon"
            class="h-3.5 w-3.5 inline-block mr-1 -mt-0.5"
          />
          Project Agents
          @if (activeTab() === 'project') {
            <div
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t"
            ></div>
          }
        </button>
        <button
          class="px-4 py-2 text-xs font-medium transition-colors relative"
          [class.text-primary]="activeTab() === 'community'"
          [class.text-base-content-muted]="activeTab() !== 'community'"
          (click)="onSwitchToCommunityTab()"
        >
          <lucide-angular
            [img]="GlobeIcon"
            class="h-3.5 w-3.5 inline-block mr-1 -mt-0.5"
          />
          Community Packs
          @if (installedCommunityCount() > 0) {
            <span
              class="ml-1 text-[9px] px-1 py-0.5 rounded bg-success/20 text-success"
            >
              {{ installedCommunityCount() }}
            </span>
          }
          @if (activeTab() === 'community') {
            <div
              class="absolute bottom-0 left-0 right-0 h-0.5 bg-primary rounded-t"
            ></div>
          }
        </button>
      </div>

      @if (errorMessage(); as error) {
        <div class="alert alert-error mb-2 py-2 text-xs" role="alert">
          <lucide-angular [img]="XCircleIcon" class="h-4 w-4 shrink-0" />
          <span>{{ error }}</span>
        </div>
      }

      <!-- ═══ PROJECT AGENTS TAB ═══ -->
      @if (activeTab() === 'project') {
        <!-- Selection controls and count -->
        <div class="flex flex-wrap justify-between items-center gap-2 mb-4">
          <div class="flex flex-wrap gap-1.5">
            <button
              class="btn btn-outline btn-xs"
              (click)="onSelectAllRecommended()"
              [disabled]="allRecommendedSelected()"
            >
              <lucide-angular [img]="CheckIcon" class="h-3 w-3" />
              Select Recommended
            </button>
            <button
              class="btn btn-ghost btn-xs"
              (click)="onDeselectAll()"
              [disabled]="noneSelected()"
            >
              Deselect All
            </button>
          </div>
          <div class="flex items-center gap-1.5">
            <div class="badge badge-primary badge-sm gap-1">
              <lucide-angular [img]="CheckIcon" class="h-3 w-3" />
              {{ selectedCount() }} selected
            </div>
            <div class="badge badge-outline badge-sm">
              {{ recommendedCount() }} recommended
            </div>
          </div>
        </div>

        @if (sortedRecommendations().length === 0) {
          <!-- No recommendations available -->
          <div
            class="border border-base-300/30 rounded-md bg-base-200/20 p-6 text-center"
          >
            <lucide-angular
              [img]="UsersIcon"
              class="h-8 w-8 text-base-content-muted mb-2 mx-auto"
            />
            <h3 class="text-sm font-semibold mb-1">No Agent Recommendations</h3>
            <p class="text-xs text-base-content-muted">
              Unable to load agent recommendations. Please go back and restart
              the analysis.
            </p>
          </div>
        } @else {
          <!-- Agent categories -->
          @for (category of categoryOrder; track category) {
            @if (getAgentsByCategory(category).length > 0) {
              <div class="mb-5">
                <!-- Category header matching settings section style -->
                <div class="flex items-center gap-2 mb-2.5">
                  <lucide-angular
                    [img]="getCategoryLucideIcon(category)"
                    class="h-3.5 w-3.5 text-base-content-muted"
                  />
                  <span
                    class="text-[10px] font-medium text-base-content-muted uppercase tracking-wide"
                  >
                    {{ getCategoryLabel(category) }}
                  </span>
                  <span class="text-[10px] text-base-content-muted">
                    {{ getAgentsByCategory(category).length }}
                  </span>
                </div>

                <div
                  class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
                >
                  @for (
                    agent of getAgentsByCategory(category);
                    track agent.agentId
                  ) {
                    <div
                      class="border rounded-md p-2.5 cursor-pointer transition-all"
                      [class.border-primary/50]="isSelected(agent.agentId)"
                      [class.bg-primary/5]="isSelected(agent.agentId)"
                      [class.border-base-300/40]="!isSelected(agent.agentId)"
                      [class.bg-base-200/20]="!isSelected(agent.agentId)"
                      [class.hover:border-primary/30]="
                        !isSelected(agent.agentId)
                      "
                      (click)="onToggleAgent(agent.agentId)"
                      (keydown.enter)="onToggleAgent(agent.agentId)"
                      (keydown.space)="
                        onToggleAgent(agent.agentId); $event.preventDefault()
                      "
                      tabindex="0"
                      role="checkbox"
                      [attr.aria-checked]="isSelected(agent.agentId)"
                      [attr.aria-label]="
                        'Select ' +
                        agent.agentName +
                        ' agent, relevance score ' +
                        agent.relevanceScore +
                        ' percent'
                      "
                    >
                      <!-- Header: checkbox + name -->
                      <div class="flex items-center gap-2 mb-1.5">
                        <input
                          type="checkbox"
                          class="checkbox checkbox-primary checkbox-xs shrink-0"
                          [checked]="isSelected(agent.agentId)"
                          (click)="$event.stopPropagation()"
                          (change)="onToggleAgent(agent.agentId)"
                          [attr.aria-label]="'Select ' + agent.agentName"
                        />
                        <span class="text-xs font-medium flex-1 truncate">{{
                          agent.agentName
                        }}</span>
                        <!-- Score pill -->
                        <span
                          class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full shrink-0"
                          [class.bg-success/20]="agent.relevanceScore >= 80"
                          [class.text-success]="agent.relevanceScore >= 80"
                          [class.bg-warning/20]="
                            agent.relevanceScore >= 60 &&
                            agent.relevanceScore < 80
                          "
                          [class.text-warning]="
                            agent.relevanceScore >= 60 &&
                            agent.relevanceScore < 80
                          "
                          [class.bg-error/20]="agent.relevanceScore < 60"
                          [class.text-error]="agent.relevanceScore < 60"
                        >
                          {{ agent.relevanceScore }}%
                        </span>
                      </div>

                      <!-- Description -->
                      <p
                        class="text-[11px] text-base-content-muted leading-relaxed mb-2 pl-6"
                      >
                        {{ agent.description }}
                      </p>

                      <!-- Matched criteria -->
                      @if (agent.matchedCriteria.length) {
                        <div class="flex flex-wrap gap-1 pl-6">
                          @for (
                            criteria of agent.matchedCriteria;
                            track criteria
                          ) {
                            <span
                              class="text-[9px] px-1.5 py-0.5 rounded bg-base-300/30 text-base-content-muted"
                            >
                              {{ criteria }}
                            </span>
                          }
                        </div>
                      }
                    </div>
                  }
                </div>
              </div>
            }
          }
        }
        <!-- /project agents tab -->

        <!-- ═══ COMMUNITY PACKS TAB ═══ -->
      } @else {
        @if (communityPacksLoading()) {
          <div class="flex items-center gap-2 py-8 justify-center">
            <span
              class="loading loading-spinner loading-sm text-base-content-muted"
            ></span>
            <span class="text-xs text-base-content-muted"
              >Loading community packs...</span
            >
          </div>
        } @else if (communityPacks().length === 0) {
          <div
            class="border border-base-300/30 rounded-md bg-base-200/20 p-6 text-center"
          >
            <lucide-angular
              [img]="GlobeIcon"
              class="h-8 w-8 text-base-content-muted mb-2 mx-auto"
            />
            <h3 class="text-sm font-semibold mb-1">No Community Packs</h3>
            <p class="text-xs text-base-content-muted">
              No community agent packs are available at the moment.
            </p>
          </div>
        } @else {
          <p class="text-xs text-base-content-muted mb-3">
            Browse and install pre-built agent packs from the community.
          </p>
          @for (pack of communityPacks(); track pack.source) {
            <div
              class="border border-base-300/40 bg-base-200/20 rounded-md mb-2"
            >
              <button
                class="flex items-center gap-2 p-2.5 w-full text-left"
                (click)="onTogglePackExpand(pack.source)"
              >
                <lucide-angular
                  [img]="PackageIcon"
                  class="h-3.5 w-3.5 text-base-content-muted shrink-0"
                />
                <div class="flex-1 min-w-0">
                  <div class="text-xs font-medium truncate">
                    {{ pack.name }}
                  </div>
                  <div class="text-[10px] text-base-content-muted">
                    {{ pack.description }}
                  </div>
                </div>
                <span class="text-[10px] text-base-content-muted shrink-0">
                  {{ pack.agents.length }} agents
                </span>
                <lucide-angular
                  [img]="
                    isPackExpanded(pack.source)
                      ? ChevronDownIcon
                      : ChevronRightIcon
                  "
                  class="h-3 w-3 text-base-content-muted shrink-0"
                />
              </button>

              @if (isPackExpanded(pack.source)) {
                <div class="px-2.5 pb-2.5">
                  <div class="flex flex-wrap items-center gap-2 mb-2">
                    <p
                      class="flex flex-1 flex-wrap items-center gap-1 text-[11px]"
                      data-testid="pack-install-to"
                    >
                      <span class="text-base-content-muted">Install to:</span>
                      <code class="font-mono [overflow-wrap:anywhere]">{{
                        installToPath()
                      }}</code>
                      <span class="text-base-content-muted">{{
                        installToSuffix()
                      }}</span>
                      <button
                        type="button"
                        class="btn btn-ghost btn-xs"
                        data-testid="pack-choose-location"
                        [disabled]="
                          allPackAgentsInstalled(pack) || isPackInstalling(pack)
                        "
                        (click)="
                          onInstallAllAgents(pack); $event.stopPropagation()
                        "
                      >
                        Choose location
                      </button>
                    </p>
                    <button
                      class="btn btn-outline btn-xs"
                      data-testid="pack-install-all"
                      [disabled]="
                        allPackAgentsInstalled(pack) || isPackInstalling(pack)
                      "
                      (click)="
                        onInstallAllAgents(pack); $event.stopPropagation()
                      "
                    >
                      @if (isPackInstalling(pack)) {
                        <span class="loading loading-spinner loading-xs"></span>
                      }
                      {{
                        allPackAgentsInstalled(pack)
                          ? 'All Installed'
                          : 'Install All'
                      }}
                    </button>
                  </div>

                  @if (packResults()[pack.source]; as finished) {
                    <div
                      role="status"
                      class="mb-2 rounded border border-base-300/40 bg-base-200/30 px-2 py-1.5 text-[11px]"
                      data-testid="pack-result"
                    >
                      @if (finished.primaryFailure) {
                        <p>Could not install the pack. {{ finished.error }}</p>
                      } @else {
                        <p class="flex flex-wrap gap-x-3">
                          <span
                            >{{
                              resultCounts(finished).installed
                            }}
                            Installed</span
                          >
                          <span
                            >{{ resultCounts(finished).kept }} Kept (your
                            file)</span
                          >
                          <span
                            >{{ resultCounts(finished).failed }} Failed</span
                          >
                        </p>
                        @if (resultCounts(finished).kept > 0) {
                          <p class="text-base-content-muted">
                            Kept files stay as they are and keep the origin
                            "Workspace file". A retry of a failed file never
                            replaces a kept file.
                          </p>
                        }
                      }
                      @if (resultNotice(finished); as notice) {
                        <p data-testid="pack-opened-folder-notice">
                          {{ notice }}
                        </p>
                      }
                    </div>
                  }
                  <div
                    class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2"
                  >
                    @for (agent of pack.agents; track agent.file) {
                      <div
                        class="border rounded-md p-2.5"
                        [class.border-success/30]="
                          getAgentStatus(pack.source, agent.file) ===
                          'installed'
                        "
                        [class.bg-success/5]="
                          getAgentStatus(pack.source, agent.file) ===
                          'installed'
                        "
                        [class.border-base-300/40]="
                          getAgentStatus(pack.source, agent.file) !==
                          'installed'
                        "
                        [class.bg-base-200/20]="
                          getAgentStatus(pack.source, agent.file) !==
                          'installed'
                        "
                      >
                        <div class="flex items-center gap-2 mb-1.5">
                          <span class="text-xs font-medium flex-1 truncate">{{
                            agent.name
                          }}</span>
                          @if (
                            getAgentStatus(pack.source, agent.file) ===
                            'installed'
                          ) {
                            <span
                              class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-success/20 text-success shrink-0"
                            >
                              Installed
                            </span>
                          } @else if (
                            getAgentStatus(pack.source, agent.file) ===
                            'installing'
                          ) {
                            <span
                              class="loading loading-spinner loading-xs text-primary shrink-0"
                            ></span>
                          } @else if (isAgentKept(pack.source, agent.file)) {
                            <span
                              class="text-[10px] font-semibold px-1.5 py-0.5 rounded-full bg-base-300/40 shrink-0"
                              data-testid="pack-agent-kept"
                            >
                              Kept
                            </span>
                          } @else if (
                            getAgentStatus(pack.source, agent.file) === 'error'
                          ) {
                            <button
                              class="btn btn-ghost btn-xs text-error"
                              (click)="
                                onInstallAgent(pack.source, agent.file);
                                $event.stopPropagation()
                              "
                            >
                              Retry
                            </button>
                          } @else {
                            <button
                              class="btn btn-ghost btn-xs"
                              (click)="
                                onInstallAgent(pack.source, agent.file);
                                $event.stopPropagation()
                              "
                            >
                              Install
                            </button>
                          }
                        </div>
                        @if (isAgentKept(pack.source, agent.file)) {
                          <p class="text-[11px] text-base-content-muted mb-1">
                            {{ keptNote }}
                          </p>
                        } @else if (
                          getAgentStatus(pack.source, agent.file) === 'error'
                        ) {
                          <p
                            class="text-[11px] text-error mb-1"
                            data-testid="pack-agent-failure"
                          >
                            Not installed.
                            {{ failureReason(pack.source, agent.file) }}
                          </p>
                        }
                        <p
                          class="text-[11px] text-base-content-muted leading-relaxed mb-1.5"
                        >
                          {{ agent.description }}
                        </p>
                        <span
                          class="text-[9px] px-1.5 py-0.5 rounded bg-base-300/30 text-base-content-muted"
                        >
                          {{ agent.category }}
                        </span>
                      </div>
                    }
                  </div>
                </div>
              }
            </div>
          }
        }
      }

      <!-- Action buttons -->
      <div
        class="flex gap-2 justify-between items-center mt-4 pt-3 border-t border-base-300"
      >
        <button
          class="btn btn-ghost btn-sm"
          [disabled]="isGenerating()"
          (click)="onBack()"
        >
          <lucide-angular [img]="ChevronLeftIcon" class="h-4 w-4" />
          Back
        </button>

        <button
          class="btn btn-primary btn-sm"
          [class.btn-disabled]="
            isGenerating() || previewLoading() || noneSelected()
          "
          [disabled]="isGenerating() || previewLoading() || noneSelected()"
          [attr.aria-busy]="isGenerating()"
          [attr.aria-label]="
            isGenerating()
              ? 'Generating agents...'
              : 'Generate ' + selectedCount() + ' selected agents'
          "
          (click)="onGenerateAgents()"
        >
          @if (isGenerating()) {
            <span class="loading loading-spinner loading-sm"></span>
            Generating...
          } @else {
            <lucide-angular [img]="ZapIcon" class="h-4 w-4" />
            Generate {{ selectedCount() }} Agent{{
              selectedCount() === 1 ? '' : 's'
            }}
          }
        </button>
      </div>
    </div>
    <ptah-generation-preview-modal
      [open]="previewOpen()"
      [loading]="previewLoading()"
      [changed]="targetsChanged()"
      [error]="previewError() !== null"
      [generating]="isGenerating()"
      [preview]="generationPreview()"
      [snapshot]="decisions()"
      [isElectron]="isElectron"
      (dismissed)="cancelPreview()"
      (confirm)="onConfirmPreview()"
      (decisionChange)="setRowDecision($event)"
      (applyAll)="setAllRowDecisions($event)"
      (targetChange)="changeTarget($event)"
    />
    <ptah-pack-install-prompt
      [request]="packRequest()"
      [isElectron]="isElectron"
      (dismissed)="packRequest.set(null)"
      (installStarted)="onPackInstallStarted($event)"
      (installFinished)="onPackInstallFinished($event)"
    />
  `,
})
export class AgentSelectionComponent {
  private readonly wizardState = inject(SetupWizardStateService);
  private readonly wizardRpc = inject(WizardRpcService);
  /** Electron shows Library copy; VS Code has no Library (D3). */
  protected readonly isElectron = inject(VSCodeService).isElectron;
  protected readonly keptNote = KEPT_PACK_NOTE;
  protected readonly XCircleIcon = XCircle;
  protected readonly CheckIcon = Check;
  protected readonly UsersIcon = Users;
  protected readonly ChevronLeftIcon = ChevronLeft;
  protected readonly ZapIcon = Zap;
  protected readonly LayoutDashboardIcon = LayoutDashboard;
  protected readonly CodeIcon = Code;
  protected readonly SearchIcon = Search;
  protected readonly SettingsIcon = Settings;
  protected readonly PaletteIcon = Palette;
  protected readonly PackageIcon = Package;
  protected readonly GlobeIcon = Globe;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;

  /** Local signal controlling the active agent source tab. */
  protected readonly activeTab = signal<'project' | 'community'>('project');

  /** Delegated signals from state service. */
  protected readonly communityPacks = this.wizardState.communityPacks;
  protected readonly communityPacksLoading =
    this.wizardState.communityPacksLoading;
  protected readonly installedCommunityCount =
    this.wizardState.installedCommunityAgentCount;

  /**
   * Known agent categories for filtering.
   */
  private readonly knownCategories: AgentCategory[] = [
    'planning',
    'development',
    'qa',
    'specialist',
    'creative',
  ];

  /**
   * Category display order for agent grouping.
   * Unknown categories are collected in 'other' at the end.
   */
  protected readonly categoryOrder: (AgentCategory | 'other')[] = [
    'planning',
    'development',
    'qa',
    'specialist',
    'creative',
    'other',
  ];
  protected readonly isGenerating = signal(false);
  protected readonly errorMessage = signal<string | null>(null);
  protected readonly previewOpen = signal(false);
  protected readonly previewLoading = signal(false);
  protected readonly generationPreview =
    signal<WizardPreviewGenerationResponse | null>(null);
  protected readonly previewError = signal<string | null>(null);
  protected readonly targetsChanged = signal(false);
  /** Shared keep/replace state of the open preview (every row starts on Keep). */
  protected readonly decisions = signal<DecisionSnapshot | null>(null);
  /** Root the user chose in the preview; null = the server default. */
  private readonly targetChoice = signal<GenerationTargetChoice | null>(null);
  private previewRequest = 0;

  /** The pack install the prompt is open for, or null. */
  protected readonly packRequest = signal<PackInstallRequest | null>(null);
  /** Root of the last confirmed pack install; the next prompt starts there. */
  private readonly packTarget = signal<GenerationTargetChoice | null>(null);
  private readonly packTargetInfo = signal<GenerationTargetInfo | null>(null);
  /** Last install result per pack source, for the results line. */
  protected readonly packResults = signal<
    Readonly<Record<string, PackInstallFinished>>
  >({});
  /** `source::file` keys whose local file was kept (the user's choice). */
  private readonly keptPackFiles = signal<ReadonlySet<string>>(new Set());
  /** `source::file` keys of failed files, with the failure reason. */
  private readonly packFailures = signal<ReadonlyMap<string, string>>(
    new Map(),
  );
  protected readonly installToPath = computed(() => {
    const info = this.packTargetInfo();
    const choice = this.packTarget();
    if (!info || !choice) return '.claude/agents';
    return targetFolder(
      info,
      info.openedIsHarnessRoot ? 'harness-root' : choice,
    );
  });
  protected readonly installToSuffix = computed(() =>
    this.packTarget() === 'opened-folder' &&
    this.packTargetInfo()?.openedIsHarnessRoot !== true
      ? '(opened folder only)'
      : '(project root)',
  );

  /**
   * Agent recommendations from deep analysis.
   * Sorted by relevance score descending.
   */
  protected readonly sortedRecommendations = computed(() => {
    const recommendations = this.wizardState.recommendations();
    return [...recommendations].sort(
      (a, b) => b.relevanceScore - a.relevanceScore,
    );
  });

  /**
   * Selected agents map from state service.
   */
  protected readonly selectedAgentsMap = this.wizardState.selectedAgentsMap;

  /**
   * Count of selected agents.
   */
  protected readonly selectedCount = computed(() => {
    const selected = this.selectedAgentsMap();
    return Object.values(selected).filter(Boolean).length;
  });

  /**
   * Count of recommended agents (score >= 75).
   */
  protected readonly recommendedCount = computed(() => {
    return this.wizardState.recommendedAgents().length;
  });

  /**
   * Check if all recommended agents are selected.
   */
  protected readonly allRecommendedSelected = computed(() => {
    const recommended = this.wizardState.recommendedAgents();
    const selected = this.selectedAgentsMap();
    return (
      recommended.length > 0 &&
      recommended.every((agent) => selected[agent.agentId])
    );
  });

  /**
   * Check if no agents are selected.
   */
  protected readonly noneSelected = computed(() => this.selectedCount() === 0);

  /**
   * Agents grouped by category (memoized).
   * Computed once per signal change instead of per template iteration.
   */
  protected readonly agentsByCategory = computed(() => {
    const agents = this.sortedRecommendations();
    const grouped = new Map<AgentCategory | 'other', AgentRecommendation[]>();

    for (const category of this.categoryOrder) {
      if (category === 'other') {
        const others = agents.filter(
          (agent) =>
            !this.knownCategories.includes(agent.category as AgentCategory),
        );
        if (others.length > 0) grouped.set('other', others);
      } else {
        const matched = agents.filter((agent) => agent.category === category);
        if (matched.length > 0) grouped.set(category, matched);
      }
    }

    return grouped;
  });

  /**
   * Get agents for a category from the memoized map.
   */
  protected getAgentsByCategory(
    category: AgentCategory | 'other',
  ): AgentRecommendation[] {
    return this.agentsByCategory().get(category) ?? [];
  }

  /**
   * Check if an agent is selected.
   */
  protected isSelected(agentId: string): boolean {
    return this.selectedAgentsMap()[agentId] === true;
  }

  /**
   * Get badge class based on relevance score.
   */
  protected getScoreBadgeClass(score: number): string {
    if (score >= 80) return 'badge-success';
    if (score >= 60) return 'badge-warning';
    return 'badge-error';
  }

  /**
   * Get Lucide icon for agent category.
   * Replaces emoji-based category icons with proper Lucide icon components.
   */
  protected getCategoryLucideIcon(category: AgentCategory | 'other') {
    switch (category) {
      case 'planning':
        return this.LayoutDashboardIcon;
      case 'development':
        return this.CodeIcon;
      case 'qa':
        return this.SearchIcon;
      case 'specialist':
        return this.SettingsIcon;
      case 'creative':
        return this.PaletteIcon;
      case 'other':
      default:
        return this.PackageIcon;
    }
  }

  /**
   * Get human-readable category label.
   * Includes fallback for 'other' category.
   */
  protected getCategoryLabel(category: AgentCategory | 'other'): string {
    switch (category) {
      case 'planning':
        return 'Planning & Architecture';
      case 'development':
        return 'Development';
      case 'qa':
        return 'Quality Assurance';
      case 'specialist':
        return 'Specialists';
      case 'creative':
        return 'Creative';
      case 'other':
      default:
        return 'Other';
    }
  }

  /**
   * Toggle individual agent selection.
   */
  protected onToggleAgent(agentId: string): void {
    if (this.previewOpen() || this.isGenerating()) return;
    this.wizardState.toggleAgentRecommendationSelection(agentId);
  }

  /**
   * Select all recommended agents.
   */
  protected onSelectAllRecommended(): void {
    if (this.previewOpen() || this.isGenerating()) return;
    this.wizardState.selectAllRecommended();
  }

  /**
   * Deselect all agents.
   */
  protected onDeselectAll(): void {
    if (this.previewOpen() || this.isGenerating()) return;
    this.wizardState.deselectAllAgents();
  }

  /**
   * Go back to analysis step.
   */
  protected onBack(): void {
    if (this.previewOpen() || this.isGenerating()) return;
    this.wizardState.setCurrentStep('analysis');
  }

  /**
   * Check if a pack is currently expanded.
   */
  protected isPackExpanded(source: string): boolean {
    return this.wizardState.expandedPackSource() === source;
  }

  /**
   * Toggle pack expansion.
   */
  protected onTogglePackExpand(source: string): void {
    this.wizardState.toggleExpandedPack(source);
  }

  /**
   * Toggle community section visibility.
   * Lazy-loads community packs on first expansion.
   */
  protected onSwitchToCommunityTab(): void {
    this.activeTab.set('community');
    if (this.communityPacks().length === 0 && !this.communityPacksLoading()) {
      this.loadCommunityPacks();
    }
  }

  /**
   * Fetch community agent packs from backend.
   */
  private async loadCommunityPacks(): Promise<void> {
    this.wizardState.setCommunityPacksLoading(true);
    this.errorMessage.set(null);
    try {
      const packs = await this.wizardRpc.listAgentPacks();
      this.wizardState.setCommunityPacks(packs);
    } catch {
      this.errorMessage.set(
        'Failed to load community packs. Check your internet connection.',
      );
    } finally {
      this.wizardState.setCommunityPacksLoading(false);
    }
  }

  /**
   * Install or retry one agent from a community pack: opens the install
   * prompt scoped to that file. A retry never replaces a kept file because
   * every choice starts on Keep.
   */
  protected onInstallAgent(source: string, file: string): void {
    if (this.packRequest() || this.isAgentBusy(source, file)) return;
    const pack = this.communityPacks().find((entry) => entry.source === source);
    this.packRequest.set({
      source,
      packName: pack?.name ?? source,
      files: [file],
      scope: 'file',
      target: this.packTarget(),
    });
  }

  /**
   * Install All or Choose location: opens the install prompt scoped to every
   * pack file that is not installed yet.
   */
  protected onInstallAllAgents(pack: AgentPackInfoDto): void {
    if (this.packRequest() || this.isPackInstalling(pack)) return;
    const pendingFiles = pack.agents
      .filter((a) => this.getAgentStatus(pack.source, a.file) !== 'installed')
      .map((a) => a.file);
    if (pendingFiles.length === 0) return;
    this.packRequest.set({
      source: pack.source,
      packName: pack.name,
      files: pendingFiles,
      scope: 'pack',
      target: this.packTarget(),
    });
  }

  protected onPackInstallStarted(start: PackInstallStart): void {
    this.packRequest.set(null);
    for (const file of start.files) {
      this.wizardState.setAgentInstallStatus(
        `${start.source}::${file}`,
        'installing',
      );
    }
  }

  protected onPackInstallFinished(finished: PackInstallFinished): void {
    this.packTarget.set(finished.target.chosen);
    this.packTargetInfo.set(finished.target);
    this.packResults.update((current) => ({
      ...current,
      [finished.source]: finished,
    }));
    const kept = new Set(this.keptPackFiles());
    const failures = new Map(this.packFailures());
    for (const file of finished.files) {
      const key = `${finished.source}::${file}`;
      const status: PackFileStatus = finished.statuses[file] ?? 'failed';
      kept.delete(key);
      failures.delete(key);
      if (status === 'kept') kept.add(key);
      if (status === 'failed') failures.set(key, finished.error ?? '');
      // A kept file is not installed: it stays idle so Install All can offer
      // it again (on Keep), and the row says "Kept".
      this.wizardState.setAgentInstallStatus(
        key,
        status === 'installed'
          ? 'installed'
          : status === 'failed'
            ? 'error'
            : 'idle',
      );
    }
    this.keptPackFiles.set(kept);
    this.packFailures.set(failures);
  }

  protected isAgentKept(source: string, file: string): boolean {
    return (
      this.getAgentStatus(source, file) === 'idle' &&
      this.keptPackFiles().has(`${source}::${file}`)
    );
  }

  protected failureReason(source: string, file: string): string {
    return this.packFailures().get(`${source}::${file}`) ?? '';
  }

  protected resultCounts(
    finished: PackInstallFinished,
  ): Record<PackFileStatus, number> {
    return packResultCounts(finished.statuses);
  }

  protected resultNotice(finished: PackInstallFinished): string | null {
    return openedFolderNotice(finished.target, this.isElectron);
  }

  private isAgentBusy(source: string, file: string): boolean {
    const status = this.getAgentStatus(source, file);
    return status === 'installing' || status === 'installed';
  }

  /**
   * Get the install status for a specific agent in a pack.
   */
  protected getAgentStatus(
    source: string,
    file: string,
  ): 'idle' | 'installing' | 'installed' | 'error' {
    return (
      this.wizardState.agentInstallStatus()[`${source}::${file}`] ?? 'idle'
    );
  }

  /**
   * Check if all agents in a pack are installed.
   */
  protected allPackAgentsInstalled(pack: AgentPackInfoDto): boolean {
    return pack.agents.every(
      (a) => this.getAgentStatus(pack.source, a.file) === 'installed',
    );
  }

  /**
   * Check if any agent in a pack is currently installing.
   */
  protected isPackInstalling(pack: AgentPackInfoDto): boolean {
    return pack.agents.some(
      (a) => this.getAgentStatus(pack.source, a.file) === 'installing',
    );
  }

  /**
   * Build selected agents array from selection map.
   * Converts internal selection state to format expected by RPC.
   */
  private buildSelectedAgents(): Array<{
    id: string;
    name: string;
    selected: boolean;
    score: number;
    reason: string;
    autoInclude: boolean;
  }> {
    const selectedAgentIds = Object.entries(this.selectedAgentsMap())
      .filter(([_, isSelected]) => isSelected)
      .map(([agentId]) => agentId);

    return selectedAgentIds.map((agentId) => {
      const recommendation = this.sortedRecommendations().find(
        (r) => r.agentId === agentId,
      );
      return {
        id: agentId,
        name: recommendation?.agentName ?? agentId,
        selected: true,
        score: recommendation?.relevanceScore ?? 0,
        reason: recommendation?.matchedCriteria?.join(', ') ?? '',
        autoInclude: (recommendation?.relevanceScore ?? 0) >= 80,
      };
    });
  }

  protected async onGenerateAgents(): Promise<void> {
    if (this.isGenerating() || this.previewOpen() || this.noneSelected())
      return;
    await this.openPreview(false);
  }

  /**
   * Open the modal with a fresh comparison; every existing file starts on
   * Keep. `keepTarget` keeps the chosen root when the server asks for another
   * review (preview-required).
   */
  private async openPreview(keepTarget: boolean): Promise<void> {
    this.generationPreview.set(null);
    this.decisions.set(null);
    this.previewError.set(null);
    this.targetsChanged.set(false);
    if (!keepTarget) this.targetChoice.set(null);
    this.previewOpen.set(true);
    await this.loadGenerationPreview(false);
  }

  protected cancelPreview(): void {
    this.previewRequest++;
    this.previewOpen.set(false);
    this.previewLoading.set(false);
  }

  protected async onConfirmPreview(): Promise<void> {
    if (!this.previewOpen() || this.previewLoading() || this.isGenerating())
      return;
    if (this.previewError()) {
      // "Generate without preview": no token, so the server only creates
      // missing files and keeps every existing one.
      this.cancelPreview();
      await this.confirmGenerate();
      return;
    }
    await this.loadGenerationPreview(true);
  }

  protected setRowDecision(change: PreviewRowDecision): void {
    if (this.previewLoading() || this.isGenerating()) return;
    this.decisions.update((current) =>
      current ? setDecision(current, change.id, change.decision) : current,
    );
  }

  protected setAllRowDecisions(decision: FileDecision): void {
    if (this.previewLoading() || this.isGenerating()) return;
    this.decisions.update((current) =>
      current ? setAllDecisions(current, decision) : current,
    );
  }

  /** A different root re-runs the comparison; every choice resets to Keep. */
  protected async changeTarget(choice: GenerationTargetChoice): Promise<void> {
    const current =
      this.decisions()?.target ?? this.generationPreview()?.target?.chosen;
    if (this.previewLoading() || this.isGenerating() || choice === current)
      return;
    this.targetChoice.set(choice);
    this.targetsChanged.set(false);
    await this.loadGenerationPreview(false);
  }

  private async loadGenerationPreview(confirm: boolean): Promise<void> {
    const request = ++this.previewRequest;
    const previous = this.generationPreview();
    const previousDecisions = this.decisions();
    const target = this.targetChoice();
    this.previewLoading.set(true);
    try {
      const preview = await this.wizardRpc.previewGeneration(
        this.buildSelectedAgents().map((agent) => agent.id),
        target ?? undefined,
      );
      if (request !== this.previewRequest) return;
      const next = nextSnapshot(
        previousDecisions,
        buildWizardRows(preview),
        preview.target?.chosen ?? target,
      );
      this.generationPreview.set(preview);
      this.decisions.set(next);
      this.previewError.set(null);
      if (!confirm) return;
      if (
        previous &&
        this.needsReview(previous, preview, previousDecisions, next)
      ) {
        this.targetsChanged.set(true);
        return;
      }
      this.cancelPreview();
      await this.confirmGenerate(this.submitDecisions(preview, next));
    } catch {
      // degradation-audit: reported - the failure is shown via previewError;
      // the early return only drops a reply a newer preview request superseded.
      if (request !== this.previewRequest) return;
      this.generationPreview.set(null);
      this.decisions.set(null);
      this.previewError.set('Preview unavailable');
      this.targetsChanged.set(false);
    } finally {
      if (request === this.previewRequest) this.previewLoading.set(false);
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

  /** Token, Replace entries and target of the confirmed preview. */
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

  /**
   * Submit selected agents and transition to generation step.
   * - Uses standardized error handling utility for consistent error messages
   * - Show loading state during RPC call
   * - Verify backend acknowledgment before step transition
   * - Display user-facing error message on failure
   * - Always reset loading state in finally block
   */
  protected async confirmGenerate(
    decisions?: BoundAgentDecisions,
  ): Promise<void> {
    if (this.isGenerating() || this.noneSelected()) {
      return; // Prevent double-click
    }

    this.isGenerating.set(true);
    this.errorMessage.set(null);

    const result = await withErrorHandling(
      async () => {
        const selectedAgents = this.buildSelectedAgents();
        const multiPhase = this.wizardState.multiPhaseResult();

        if (!multiPhase) {
          throw new Error(
            'No analysis data available. Please re-run the wizard scan.',
          );
        }
        const response = decisions
          ? await this.wizardRpc.submitAgentSelection(
              selectedAgents,
              multiPhase.analysisDir,
              decisions,
            )
          : await this.wizardRpc.submitAgentSelection(
              selectedAgents,
              multiPhase.analysisDir,
            );
        // The server no longer holds the reviewed preview: review again.
        if (response?.rejection?.reason === 'preview-required') return response;
        if (!response?.success) {
          throw new Error(
            response?.error ?? 'Backend did not acknowledge selection',
          );
        }

        return response;
      },
      'Starting agent generation',
      () => {
        this.errorMessage.set(
          'Agent generation could not start. Check your workspace and try again.',
        );
      },
    );

    if (result?.rejection?.reason === 'preview-required') {
      this.isGenerating.set(false);
      await this.openPreview(true);
      this.targetsChanged.set(true);
      return;
    }

    if (result) {
      const selectedAgentIds = Object.entries(
        this.wizardState.selectedAgentsMap(),
      )
        .filter(([_, isSelected]) => isSelected)
        .map(([agentId]) => agentId);

      const progressItems: SkillGenerationProgressItem[] = selectedAgentIds.map(
        (agentId) => {
          const recommendation = this.sortedRecommendations().find(
            (r) => r.agentId === agentId,
          );
          return {
            id: agentId,
            name: recommendation?.agentName ?? agentId,
            type: 'agent' as const,
            status: 'pending' as const,
            progress: 0,
          };
        },
      );

      this.wizardState.setSkillGenerationProgress(progressItems);
      this.wizardState.setCurrentStep('generation');
    }
    this.isGenerating.set(false);
  }
}
