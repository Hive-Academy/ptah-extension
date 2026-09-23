/**
 * Agent Monitor Panel Component
 *
 * Sidebar that shows real-time agent monitoring.
 * Supports two modes:
 *   1. **Embedded mode** (preferred): Receives agents + open state via inputs.
 *      Used inside ChatViewComponent for per-session scoping.
 *   2. **Global mode** (legacy fallback): Reads from AgentMonitorStore directly.
 *
 * Uses a tile-based navigation bar at the top: each agent is a compact
 * clickable tile showing status + name + permission badge. Clicking a tile
 * selects that agent and renders its full card + inline permissions below.
 *
 * Auto-selects newly spawned agents and agents with permission requests.
 *
 * Responsive widths:
 *   default: 360px, xl (1280px+): 440px, 2xl (1536px+): 540px
 */

import {
  Component,
  inject,
  input,
  output,
  computed,
  signal,
  effect,
  untracked,
  viewChild,
  ElementRef,
  afterNextRender,
  afterRenderEffect,
  DestroyRef,
  ChangeDetectionStrategy,
} from '@angular/core';
import { NgClass, NgTemplateOutlet } from '@angular/common';
import {
  LucideAngularModule,
  X,
  Trash2,
  ShieldAlert,
  Workflow,
  ChevronDown,
  ChevronRight,
  Columns,
  Square,
} from 'lucide-angular';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  AgentPermissionRequest,
  SubagentTranscriptMessage,
} from '@ptah-extension/shared';
import {
  AgentMonitorStore,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import { SubagentTranscriptViewerComponent } from '@ptah-extension/chat-ui';
import { TabManagerService } from '@ptah-extension/chat-state';
import { PanelResizeService } from '../../services/panel-resize.service';
import { AgentCardComponent } from '../molecules/agent-card/agent-card.component';
import { AgentContinueInputComponent } from '../molecules/agent-continue-input/agent-continue-input.component';
import {
  groupAgentsByWorkflowRun,
  type WorkflowRunGroup,
} from './agent-monitor-panel.grouping';

import { AgentLaneGridComponent } from './agent-monitor/agent-lane-grid.component';
import { laneColumnCount } from './agent-monitor/agent-lane-layout';
import { WorkflowPermissionPresenterService } from './agent-monitor/workflow-permission-presenter.service';

// Re-export the pure grouping API alongside the component for consumers that
// import from the component barrel. The implementation lives in
// `agent-monitor-panel.grouping.ts` so it stays unit-testable without the
// component's heavy import graph.
export { groupAgentsByWorkflowRun, type WorkflowRunGroup };

/**
 * Normalized tile shown in a workflow-run group. Unifies the two sources of
 * workflow agents — CLI `MonitoredAgent`s and SDK `SubagentRecord`s — into one
 * render/selection shape. `key` is the selection key (a MonitoredAgent
 * `agentId` or a SubagentRecord `parentToolUseId`); `kind` drives the detail
 * view (card vs transcript). Satisfies `WorkflowGroupable` structurally, so it
 * feeds `groupAgentsByWorkflowRun` directly.
 */
interface WorkflowTileVM {
  readonly key: string;
  readonly kind: 'agent' | 'subagent';
  readonly name: string;
  readonly status: string;
  /** Normalized status-dot bucket for the tile indicator. */
  readonly dot: 'running' | 'completed' | 'failed' | 'stopped' | 'neutral';
  readonly workflowRunId: string;
  readonly workflowName?: string;
  readonly totalTokens?: number;
  readonly permissionCount: number;
}

/** Map a raw lifecycle status onto the tile's status-dot bucket. */
function statusDot(status: string): WorkflowTileVM['dot'] {
  switch (status) {
    case 'running':
      return 'running';
    case 'completed':
      return 'completed';
    case 'failed':
    case 'timeout':
    case 'killed':
      return 'failed';
    case 'stopped':
      return 'stopped';
    default:
      return 'neutral';
  }
}

/** Build a workflow tile from a CLI MonitoredAgent that carries a run id. */
function agentToTile(a: MonitoredAgent): WorkflowTileVM {
  return {
    key: a.agentId,
    kind: 'agent',
    name: a.displayName || a.cli,
    status: a.status,
    dot: statusDot(a.status),
    // Only agents WITH a run id are mapped, so the assertion is safe.
    workflowRunId: a.workflowRunId as string,
    workflowName: a.workflowName,
    totalTokens: undefined,
    permissionCount: a.permissionQueue.length,
  };
}

/** Build a workflow tile from an SDK workflow SubagentRecord. */
function subagentToTile(r: SubagentRecord): WorkflowTileVM {
  return {
    key: r.parentToolUseId,
    kind: 'subagent',
    name: r.teammateName || r.description || 'Subagent',
    status: r.status,
    dot: statusDot(r.status),
    workflowRunId: r.workflowRunId as string,
    workflowName: r.workflowName,
    totalTokens: r.totalTokens,
    permissionCount: 0,
  };
}

@Component({
  selector: 'ptah-agent-monitor-panel',
  standalone: true,
  // Agent-output surface (agent cards render model markdown). A SCOPED panel
  // also publishes the owning tab, so a relative link written by an agent in a
  // background workspace resolves against THAT workspace rather than against
  // whichever one happens to be active (AC 22 / L-7). The global panel renders
  // the active tab's agents, so its absent marker is already the right answer.
  host: {
    'data-ptah-file-links': '',
    '[attr.data-ptah-tab-id]': 'linkTabId()',
    '[class.absolute]': 'effectiveOpen() && isOverlay()',
    '[class.inset-0]': 'effectiveOpen() && isOverlay()',
    '[class.w-full]': 'effectiveOpen() && isOverlay()',
    '[class.h-full]': 'effectiveOpen() && isOverlay()',
    '[class.z-20]': 'effectiveOpen() && isOverlay()',
    '[class.bg-base-200]': 'effectiveOpen() && isOverlay()',
  },
  providers: [WorkflowPermissionPresenterService],
  imports: [
    NgClass,
    NgTemplateOutlet,
    AgentLaneGridComponent,
    LucideAngularModule,
    AgentCardComponent,
    AgentContinueInputComponent,
    SubagentTranscriptViewerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: `
    .agent-panel-open {
      width: 360px;
      max-width: 100%;
    }
    @media (min-width: 1280px) {
      .agent-panel-open {
        width: 440px;
      }
    }
    @media (min-width: 1536px) {
      .agent-panel-open {
        width: 540px;
      }
    }
  `,
  template: `
    <aside
      class="flex flex-col min-w-0 border-base-content/5 overflow-hidden h-full"
      [class.bg-base-200]="!isOverlay()"
      [class.border-l]="!isOverlay()"
      [class.agent-panel-open]="effectiveOpen() && !isOverlay()"
      [class.w-full]="effectiveOpen() && isOverlay()"
      [class.w-0]="!effectiveOpen()"
      [class.transition-all]="!resizeService.dragging()"
      [class.duration-300]="!resizeService.dragging()"
      [style.width.px]="
        effectiveOpen() && !isOverlay() ? resizeService.customWidth() : null
      "
    >
      <!-- Header -->
      <div
        class="flex flex-wrap min-w-0 items-center justify-between px-2.5 py-1.5 border-b border-base-content/10 flex-shrink-0"
      >
        <div class="flex items-center gap-2">
          <span class="text-sm font-semibold">Agents</span>
          @if (totalCount() > 0) {
            <span class="badge badge-sm badge-neutral">{{ totalCount() }}</span>
          }
        </div>
        <div class="flex items-center gap-1">
          @if (laneCapacity() >= 2 || forceSingle()) {
            <button
              type="button"
              class="btn btn-ghost btn-xs btn-square"
              [title]="
                forceSingle() ? 'Show agents side by side' : 'Show one agent'
              "
              [attr.aria-label]="
                forceSingle() ? 'Show agents side by side' : 'Show one agent'
              "
              [attr.aria-pressed]="forceSingle()"
              (click)="forceSingle.set(!forceSingle())"
            >
              <lucide-angular
                [img]="forceSingle() ? SquareIcon : ColumnsIcon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            </button>
          }
          @if (effectiveAgents().length > 0 && !effectiveHasRunning()) {
            <button
              class="btn btn-ghost btn-xs btn-square"
              title="Clear completed"
              (click)="onClearCompleted()"
            >
              <lucide-angular
                [img]="Trash2Icon"
                class="w-3.5 h-3.5"
                aria-hidden="true"
              />
            </button>
          }
          <button
            #closeButton
            class="btn btn-ghost btn-xs btn-square"
            title="Close panel"
            (click)="onClose()"
          >
            <lucide-angular
              [img]="XIcon"
              class="w-3.5 h-3.5"
              aria-hidden="true"
            />
          </button>
        </div>
      </div>

      <!-- Agent Tiles Bar -->
      @if (totalCount() > 0) {
        <div
          class="flex flex-col min-w-0 overflow-hidden border-b border-base-content/5 flex-shrink-0"
        >
          <!-- Workflow run groups (collapsible), rendered above standalone tiles.
               Tiles come from BOTH sources: CLI MonitoredAgents that carry a run
               id AND SDK workflow SubagentRecords. -->
          @for (group of workflowGroups(); track group.workflowRunId) {
            <div class="border-b border-base-content/5 last:border-b-0">
              <!-- Run header -->
              <button
                type="button"
                class="w-full flex items-center gap-1.5 px-2 py-1.5 hover:bg-base-100/60 transition-colors"
                (click)="toggleRunCollapsed(group.workflowRunId)"
                [attr.aria-expanded]="!isRunCollapsed(group.workflowRunId)"
                [title]="group.workflowName || 'Workflow run'"
              >
                <lucide-angular
                  [img]="
                    isRunCollapsed(group.workflowRunId)
                      ? ChevronRightIcon
                      : ChevronDownIcon
                  "
                  class="w-3.5 h-3.5 shrink-0 text-base-content-muted"
                  aria-hidden="true"
                />
                <lucide-angular
                  [img]="WorkflowIcon"
                  class="w-3.5 h-3.5 shrink-0 text-primary"
                  aria-hidden="true"
                />
                <span class="text-xs font-semibold truncate flex-1 text-left">
                  {{ group.workflowName || 'Workflow' }}
                </span>
                <!-- Aggregate status dot -->
                <span
                  class="w-2 h-2 rounded-full shrink-0"
                  [class.bg-info]="group.status === 'running'"
                  [class.bg-success]="group.status === 'completed'"
                  [class.bg-error]="group.status === 'failed'"
                  [class.bg-warning]="group.status === 'mixed'"
                  [class.animate-pulse]="group.status === 'running'"
                ></span>
                <span class="badge badge-xs badge-neutral shrink-0">
                  {{ group.running }}/{{ group.total }}
                </span>
                @if (group.totalTokens !== undefined) {
                  <span
                    class="text-[10px] text-base-content-muted font-mono shrink-0"
                  >
                    {{ group.totalTokens }} tok
                  </span>
                }
              </button>
              <!-- Run tiles -->
              @if (!isRunCollapsed(group.workflowRunId)) {
                <div class="flex gap-1.5 px-2 pb-1.5 pt-0.5 overflow-x-auto">
                  @for (tile of group.agents; track tile.key) {
                    <button
                      type="button"
                      class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all shrink-0 cursor-pointer"
                      [ngClass]="
                        tile.key === selectedAgentId()
                          ? 'border-primary bg-primary/10 shadow-sm'
                          : 'border-base-300 bg-base-100 hover:border-primary/30 hover:bg-primary/5'
                      "
                      (click)="selectAgent(tile.key)"
                      [title]="tile.name"
                    >
                      <span
                        class="w-2 h-2 rounded-full shrink-0"
                        [class.bg-info]="tile.dot === 'running'"
                        [class.bg-success]="tile.dot === 'completed'"
                        [class.bg-error]="tile.dot === 'failed'"
                        [class.bg-warning]="tile.dot === 'stopped'"
                        [class.bg-base-content]="tile.dot === 'neutral'"
                        [class.opacity-40]="tile.dot === 'neutral'"
                        [class.animate-pulse]="tile.dot === 'running'"
                      ></span>
                      <span class="text-xs font-medium truncate max-w-[120px]">
                        {{ tile.name }}
                      </span>
                      @if (tile.permissionCount > 0) {
                        <span
                          class="badge badge-xs badge-warning animate-pulse"
                          [attr.aria-label]="
                            tile.permissionCount + ' pending permissions'
                          "
                        >
                          {{ tile.permissionCount }}
                        </span>
                      }
                      @if (tile.totalTokens !== undefined) {
                        <span
                          class="text-[10px] text-base-content-muted font-mono"
                        >
                          {{ tile.totalTokens }}
                        </span>
                      }
                    </button>
                  }
                </div>
              }
            </div>
          }

          <!-- Standalone agents (unchanged flat tile bar) -->
          @if (standaloneAgents().length > 0) {
            <div class="flex gap-1.5 px-2 py-1.5 overflow-x-auto">
              @for (agent of standaloneAgents(); track agent.agentId) {
                <button
                  type="button"
                  class="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all shrink-0 cursor-pointer"
                  [ngClass]="
                    (
                      lanesMode()
                        ? laneGrid()?.shownIds()?.includes(agent.agentId)
                        : agent.agentId === selectedAgentId()
                    )
                      ? 'border-primary bg-primary/10 shadow-sm'
                      : 'border-base-300 bg-base-100 hover:border-primary/30 hover:bg-primary/5'
                  "
                  (click)="pickStandalone(agent.agentId)"
                  [attr.aria-pressed]="
                    lanesMode()
                      ? !!laneGrid()?.shownIds()?.includes(agent.agentId)
                      : agent.agentId === selectedAgentId()
                  "
                  [title]="agent.task"
                >
                  <!-- Status dot -->
                  <span
                    class="w-2 h-2 rounded-full shrink-0"
                    [class.bg-info]="agent.status === 'running'"
                    [class.bg-success]="agent.status === 'completed'"
                    [class.bg-error]="
                      agent.status === 'failed' || agent.status === 'timeout'
                    "
                    [class.bg-warning]="agent.status === 'stopped'"
                    [class.animate-pulse]="agent.status === 'running'"
                  ></span>

                  <!-- Agent name -->
                  <span class="text-xs font-medium truncate max-w-[120px]">
                    {{ agent.displayName || agent.cli }}
                  </span>

                  <!-- Permission badge -->
                  @if (agent.permissionQueue.length > 0) {
                    <span class="badge badge-xs badge-warning animate-pulse">
                      {{ agent.permissionQueue.length }}
                    </span>
                  }
                </button>
              }
            </div>
          }
        </div>
      }

      <ng-template #agentDetail let-agent>
        <!-- Permission requests for selected agent -->
        @if (agent.permissionQueue.length > 0) {
          <div class="border-b border-warning/30">
            @for (perm of agent.permissionQueue; track perm.requestId) {
              <div
                class="bg-warning/10 px-2.5 py-1.5 flex flex-col gap-1 border-b border-warning/10 last:border-b-0"
              >
                <div class="flex items-center gap-2">
                  <lucide-angular
                    [img]="ShieldAlertIcon"
                    class="w-3.5 h-3.5 text-warning flex-shrink-0"
                    aria-hidden="true"
                  />
                  <span class="badge badge-xs badge-warning">Permission</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <code
                    class="text-[10px] font-mono text-accent bg-base-200/60 px-1.5 py-0.5 rounded"
                  >
                    {{ perm.toolName }}
                  </code>
                  @if (perm.toolArgs) {
                    <span
                      class="text-[10px] text-base-content-muted font-mono truncate"
                    >
                      {{ perm.toolArgs }}
                    </span>
                  }
                </div>
                <div class="flex gap-2">
                  <button
                    type="button"
                    class="btn btn-xs btn-success"
                    (click)="allowPermission(agent.agentId, perm)"
                  >
                    Allow
                  </button>
                  <button
                    type="button"
                    class="btn btn-xs btn-error btn-outline"
                    (click)="denyPermission(agent.agentId, perm)"
                  >
                    Deny
                  </button>
                </div>
              </div>
            }
          </div>
        }

        <!-- Agent card (auto-expanded on selection) -->
        <div class="p-1.5">
          <ptah-agent-card
            class="block h-full"
            [agent]="agent"
            (toggleExpanded)="store.toggleAgentExpanded(agent.agentId)"
          />
        </div>

        <ptah-agent-continue-input [agent]="agent" />
      </ng-template>
      <div #panelBody class="flex-1 min-h-0 min-w-0 overflow-hidden">
        @if (lanesMode()) {
          <ptah-agent-lane-grid
            [agents]="standaloneAgents()"
            [capacity]="laneCapacity()"
            [width]="bodyWidth()"
            [detailTemplate]="agentDetail"
            [style.display]="showLaneGrid() ? null : 'none'"
            (expandAgent)="expandLaneAgent($event)"
          />
        }
        <!-- Selected Agent Detail -->
        <div
          #agentScroll
          class="h-full overflow-y-auto min-h-0 min-w-0"
          [style.display]="showLaneGrid() ? 'none' : null"
          (scroll)="onScroll()"
        >
          <div #agentScrollContent>
            @if (!showLaneGrid()) {
              @if (selectedWorkflowSubagent(); as sub) {
                <!-- Workflow subagent detail = its saved transcript. A SubagentRecord
                 has no MonitoredAgent shape (no card / permissions / continue),
                 so we render the shared transcript viewer instead. -->
                <div class="p-1.5">
                  <ptah-subagent-transcript-viewer
                    [agentName]="
                      sub.teammateName || sub.description || 'Subagent'
                    "
                    [messages]="transcriptMessages()"
                    [loading]="transcriptLoading()"
                    [error]="transcriptError()"
                    (refresh)="reloadTranscript()"
                    (closed)="deselect()"
                  />
                </div>
              } @else if (effectiveSelectedAgent(); as agent) {
                <ng-container
                  [ngTemplateOutlet]="agentDetail"
                  [ngTemplateOutletContext]="{ $implicit: agent }"
                />
              } @else {
                <div
                  class="flex flex-col items-center justify-center h-32 text-center"
                >
                  <span class="text-sm text-base-content-muted">No agents</span>
                  <span class="text-xs text-base-content-muted mt-1"
                    >Agents will appear here when spawned</span
                  >
                </div>
              }
            }
          </div>
        </div>
      </div>
    </aside>
  `,
})
export class AgentMonitorPanelComponent {
  protected readonly store = inject(AgentMonitorStore);
  protected readonly resizeService = inject(PanelResizeService);
  private readonly vscode = inject(VSCodeService);
  private readonly tabManager = inject(TabManagerService);
  private readonly workflowPermissions = inject(
    WorkflowPermissionPresenterService,
  );

  readonly ColumnsIcon = Columns;
  readonly SquareIcon = Square;
  readonly XIcon = X;
  readonly Trash2Icon = Trash2;
  readonly ShieldAlertIcon = ShieldAlert;
  readonly WorkflowIcon = Workflow;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;

  /** Session-scoped agents. When provided, panel uses these instead of global store. */
  readonly embeddedAgents = input<MonitoredAgent[] | undefined>(undefined);

  /** Panel open state. When provided, panel uses this instead of global store. */
  readonly embeddedOpen = input<boolean | undefined>(undefined);

  /** Whether the panel is rendering as a full-width overlay (narrow host). */
  readonly isOverlay = input<boolean>(false);

  /**
   * Owning session of this panel. `null` means the GLOBAL panel (no scope, act
   * across every session). A string means a scoped surface — and `''` means a
   * scoped surface whose session has not resolved yet, which must act on
   * NOTHING rather than silently widening to global.
   */
  readonly sessionId = input<string | null>(null);

  /** Emits when close button clicked in embedded mode. */
  readonly closed = output<void>();

  /**
   * The tab a clicked file link in this panel belongs to, published as
   * `data-ptah-tab-id` for `FileLinkRouterService.resolveContext`.
   *
   * Resolved from the scoped {@link sessionId} through the cross-workspace
   * lookup, so a background-workspace session still names its own tab. `null`
   * (global panel, unresolved scope, or a session with no tab) removes the
   * attribute and leaves the router on its active-workspace fallback — the same
   * behaviour as before, only now it is the exception rather than the rule.
   */
  protected readonly linkTabId = computed<string | null>(() => {
    const sid = this.sessionId();
    if (!sid) return null;
    return (
      this.tabManager.findTabBySessionIdAcrossWorkspaces(sid)?.tab.id ?? null
    );
  });

  readonly selectedAgentId = signal<string | null>(null);
  readonly forceSingle = signal(false);
  private readonly workflowDetailPicked = signal(false);
  readonly bodyWidth = signal(0);
  readonly laneGrid = viewChild(AgentLaneGridComponent);
  private readonly panelBody = viewChild<ElementRef<HTMLElement>>('panelBody');
  readonly laneCapacity = computed(() =>
    laneColumnCount(this.bodyWidth(), this.standaloneAgents().length),
  );
  readonly lanesMode = computed(
    () => !this.forceSingle() && this.laneCapacity() >= 2,
  );
  readonly showLaneGrid = computed(
    () =>
      this.lanesMode() &&
      !(
        this.workflowDetailPicked() &&
        (this.selectedWorkflowSubagent() ||
          this.explicitSelectedAgent()?.workflowRunId)
      ),
  );
  private prevAgentIds = new Set<string>();
  private seenLanePermissions = new Set<string>();

  private readonly _scroll = viewChild<ElementRef<HTMLElement>>('agentScroll');
  private readonly _scrollContent =
    viewChild<ElementRef<HTMLElement>>('agentScrollContent');
  private readonly _closeButton =
    viewChild<ElementRef<HTMLButtonElement>>('closeButton');
  private readonly destroyRef = inject(DestroyRef);
  /** Auto-follow the streaming agent output unless the user scrolled up. */
  private pinnedToBottom = true;
  private resizeObserver: ResizeObserver | null = null;
  private static readonly NEAR_BOTTOM_PX = 80;

  readonly effectiveAgents = computed(
    () => this.embeddedAgents() ?? this.store.activeTabAgents(),
  );

  readonly effectiveOpen = computed(
    () => this.embeddedOpen() ?? this.store.panelOpen(),
  );

  readonly effectivePermissions = computed(() => {
    const embedded = this.embeddedAgents();
    if (embedded === undefined) return this.store.pendingPermissions();
    const agentIds = new Set(embedded.map((a) => a.agentId));
    return this.store
      .pendingPermissions()
      .filter((a) => agentIds.has(a.agentId));
  });

  readonly effectiveHasRunning = computed(() =>
    this.effectiveAgents().some((a) => a.status === 'running'),
  );

  /**
   * Workflow subagents (SDK `SubagentRecord`s carrying a run id) for the panel's
   * scope. Embedded/canvas panels scope by their `sessionId` input (mirroring
   * `embeddedAgents`); the global panel falls back to the active-tab selector.
   */
  readonly effectiveWorkflowSubagents = computed<SubagentRecord[]>(() => {
    const sid = this.sessionId();
    if (sid === null) return this.store.activeWorkflowSubagents();
    // Scoped tile. `agentVisibleInSession` (via the store) owns both halves of
    // the rule: an unresolved tile renders nothing rather than falling through
    // to the active-tab branch and showing ANOTHER session's run groups, and a
    // resolved tile also shows agents whose owner was never attributed.
    return this.store.workflowSubagentsForSession(sid);
  });

  /**
   * Normalized workflow tiles from BOTH sources — CLI MonitoredAgents that
   * carry a run id AND SDK workflow SubagentRecords — fed to the pure grouping.
   */
  private readonly _workflowTiles = computed<WorkflowTileVM[]>(() => {
    const fromAgents = this.effectiveAgents()
      .filter((a) => !!a.workflowRunId)
      .map(agentToTile);
    const fromSubagents = this.effectiveWorkflowSubagents().map(subagentToTile);
    return [...fromAgents, ...fromSubagents];
  });

  /** Collapsible workflow-run groups, rendered above the standalone tiles. */
  readonly workflowGroups = computed(
    () => groupAgentsByWorkflowRun(this._workflowTiles()).groups,
  );

  /** CLI agents without a workflowRunId — the existing flat tile bar. */
  readonly standaloneAgents = computed(() =>
    this.effectiveAgents().filter((a) => !a.workflowRunId),
  );

  /** Combined count across CLI agents + workflow subagents. */
  readonly totalCount = computed(
    () =>
      this.effectiveAgents().length + this.effectiveWorkflowSubagents().length,
  );

  /** Union of selectable keys (MonitoredAgent ids + workflow subagent ids). */
  private readonly _selectableKeys = computed<string[]>(() => [
    ...this.effectiveAgents().map((a) => a.agentId),
    ...this.effectiveWorkflowSubagents().map((r) => r.parentToolUseId),
  ]);

  /** Run ids the user has collapsed. Runs default to expanded. */
  private readonly _collapsedRuns = signal<ReadonlySet<string>>(new Set());

  isRunCollapsed(runId: string): boolean {
    return this._collapsedRuns().has(runId);
  }

  toggleRunCollapsed(runId: string): void {
    this._collapsedRuns.update((set) => {
      const next = new Set(set);
      if (next.has(runId)) next.delete(runId);
      else next.add(runId);
      return next;
    });
  }

  /**
   * The selected workflow SubagentRecord, when the current selection key points
   * at one. Drives the transcript detail view (vs the MonitoredAgent card).
   */
  readonly selectedWorkflowSubagent = computed<SubagentRecord | null>(() => {
    const key = this.selectedAgentId();
    if (!key) return null;
    return (
      this.effectiveWorkflowSubagents().find(
        (r) => r.parentToolUseId === key,
      ) ?? null
    );
  });

  /** Exact selection only; a removed selection must not open a fallback workflow. */
  private readonly explicitSelectedAgent = computed<MonitoredAgent | null>(
    () =>
      this.effectiveAgents().find(
        (agent) => agent.agentId === this.selectedAgentId(),
      ) ?? null,
  );

  /**
   * The selected CLI MonitoredAgent, falling back to the first agent. Returns
   * null when the selection points at a workflow subagent (so it can't hijack
   * the detail view with an unrelated agent card).
   */
  readonly effectiveSelectedAgent = computed<MonitoredAgent | null>(() => {
    const agents = this.effectiveAgents();
    const id = this.selectedAgentId();
    if (id) {
      const found = agents.find((a) => a.agentId === id);
      if (found) return found;
      if (this.selectedWorkflowSubagent()) return null;
    }
    return agents[0] ?? null;
  });

  // Transcript state for a selected workflow subagent. Loaded on demand via the
  // store's `subagent:transcript` RPC and fed to the presentational viewer. A
  // monotonic token guards against out-of-order responses (rapid selection).
  private readonly _transcriptMessages = signal<
    readonly SubagentTranscriptMessage[]
  >([]);
  private readonly _transcriptLoading = signal(false);
  private readonly _transcriptError = signal<string | null>(null);
  readonly transcriptMessages = this._transcriptMessages.asReadonly();
  readonly transcriptLoading = this._transcriptLoading.asReadonly();
  readonly transcriptError = this._transcriptError.asReadonly();
  private _transcriptToken = 0;
  /** Identity of the last transcript we loaded, so we don't re-fetch on every
   *  progress-driven SubagentRecord reference change. */
  private _lastTranscriptKey: string | null = null;

  constructor() {
    afterNextRender(() => {
      const body = this.panelBody()?.nativeElement;
      if (!body || typeof ResizeObserver === 'undefined') return;
      const observer = new ResizeObserver((entries) => {
        const entry = entries.find((item) => item.target === body);
        if (entry) this.bodyWidth.set(entry.contentRect.width);
      });
      this.bodyWidth.set(body.clientWidth);
      observer.observe(body);
      this.destroyRef.onDestroy(() => observer.disconnect());
    });
    afterRenderEffect(() => {
      const closeButton = this._closeButton();
      if (this.effectiveOpen() && this.isOverlay() && closeButton) {
        closeButton.nativeElement.focus();
      }
    });

    effect(() => {
      const keys = this._selectableKeys();
      const currentIds = new Set(keys);
      const selectedId = untracked(() => this.selectedAgentId());

      if (untracked(() => this.lanesMode())) {
        this.prevAgentIds = currentIds;
        return;
      }

      const newIds = keys.filter((id) => !this.prevAgentIds.has(id));

      if (newIds.length > 0) {
        this.autoSelectAgent(newIds[0]);
      } else if (selectedId && !currentIds.has(selectedId)) {
        if (keys.length > 0) {
          this.autoSelectAgent(keys[0]);
        } else {
          this.selectedAgentId.set(null);
        }
      } else if (!selectedId && keys.length > 0) {
        this.autoSelectAgent(keys[0]);
      }

      this.prevAgentIds = currentIds;
    });
    effect(() => {
      const perms = this.effectivePermissions();
      const lanesMode = this.lanesMode();
      const grid = this.laneGrid();
      const agents = this.effectiveAgents();
      // A parent effect can run before the grid receives this tick's new agents.
      // Track its input so a rejected pick retries after those bindings update.
      const gridAgentIds = new Set(
        grid?.agents().map((agent) => agent.agentId),
      );
      untracked(() => {
        if (!lanesMode) {
          this.seenLanePermissions.clear();
          if (perms.length > 0) this.autoSelectAgent(perms[0].agentId);
          return;
        }
        // Keep shownIds untracked: a previously surfaced request must not undo
        // a user's subsequent column removal or choice of workflow detail.
        const pending = new Set<string>();
        for (const permissionAgent of perms) {
          const agent = agents.find(
            (item) => item.agentId === permissionAgent.agentId,
          );
          if (!agent || agent.workflowRunId) continue;
          for (const request of permissionAgent.permissionQueue) {
            const key = `${agent.agentId}:${request.requestId}`;
            if (this.seenLanePermissions.has(key)) {
              pending.add(key);
              continue;
            }
            if (grid && gridAgentIds.has(agent.agentId)) {
              if (!grid.shownIds().includes(agent.agentId))
                grid.pick(agent.agentId);
              // A pick can be rejected while the child is catching up. Leave it
              // unseen until it is actually present, then deduplicate updates.
              if (grid.shownIds().includes(agent.agentId)) pending.add(key);
            }
          }
        }
        this.seenLanePermissions = pending;
        const nextWorkflow = this.workflowPermissions.nextAgent(
          agents,
          this.showLaneGrid()
            ? null
            : (this.explicitSelectedAgent()?.agentId ?? null),
        );
        if (nextWorkflow) {
          if (
            this.showLaneGrid() ||
            this.explicitSelectedAgent()?.agentId !== nextWorkflow
          ) {
            this.applyAgentSelection(nextWorkflow);
          }
          if (
            !this.showLaneGrid() &&
            this.explicitSelectedAgent()?.agentId === nextWorkflow
          ) {
            this.workflowPermissions.markShown(nextWorkflow);
          }
        }
      });
    });

    // Load the transcript when the selected workflow subagent's identity
    // (session + agentId) changes. Keyed so per-progress record churn doesn't
    // re-fire the RPC.
    effect(() => {
      const sub = this.selectedWorkflowSubagent();
      const key =
        sub && sub.agentId && sub.parentSessionId
          ? `${sub.parentSessionId}::${sub.agentId}`
          : null;
      untracked(() => {
        if (key === this._lastTranscriptKey) return;
        this._lastTranscriptKey = key;
        void this.loadTranscriptFor(sub);
      });
    });

    // Sticky-to-bottom: follow streaming agent output as it grows, the same
    // way the conductor chat tile does. The content wrapper is always present
    // (it brackets both the agent detail and the empty state), so the observer
    // attaches once and fires on every height change.
    afterNextRender(() => {
      const container = this._scroll()?.nativeElement;
      const content = this._scrollContent()?.nativeElement;
      if (!container || !content || typeof ResizeObserver === 'undefined')
        return;
      this.resizeObserver = new ResizeObserver(() => {
        if (this.pinnedToBottom) {
          container.scrollTop = container.scrollHeight;
        }
      });
      this.resizeObserver.observe(content);
      this.destroyRef.onDestroy(() => this.resizeObserver?.disconnect());
    });
  }

  /** Track whether the user is pinned to the bottom (auto-follow) or scrolled up. */
  onScroll(): void {
    const el = this._scroll()?.nativeElement;
    if (!el) return;
    const distance = el.scrollHeight - el.scrollTop - el.clientHeight;
    this.pinnedToBottom = distance < AgentMonitorPanelComponent.NEAR_BOTTOM_PX;
  }

  pickStandalone(agentId: string): void {
    this.selectAgent(agentId);
    if (this.lanesMode()) this.laneGrid()?.pick(agentId);
  }

  expandLaneAgent(agentId: string): void {
    const agent = this.effectiveAgents().find(
      (item) => item.agentId === agentId,
    );
    if (agent && !agent.expanded) this.store.toggleAgentExpanded(agentId);
  }

  selectAgent(agentId: string): void {
    if (this.selectedAgentId() !== agentId)
      this.workflowPermissions.onUserNavigation();
    this.applyAgentSelection(agentId);
  }

  private applyAgentSelection(agentId: string): void {
    this.selectedAgentId.set(agentId);
    this.workflowDetailPicked.set(
      !!this.explicitSelectedAgent()?.workflowRunId ||
        !!this.selectedWorkflowSubagent(),
    );
    // Switching/auto-selecting an agent re-follows its latest output.
    this.pinnedToBottom = true;
    // Expand only applies to CLI MonitoredAgents; workflow subagent keys won't
    // match here and are left untouched (their detail is the transcript view).
    const agent = this.effectiveAgents().find((a) => a.agentId === agentId);
    if (agent && !agent.expanded) {
      this.store.toggleAgentExpanded(agentId);
    }
  }

  private autoSelectAgent(agentId: string): void {
    this.applyAgentSelection(agentId);
    this.workflowDetailPicked.set(false);
  }

  /** Re-fetch the currently selected workflow subagent's transcript. */
  reloadTranscript(): void {
    void this.loadTranscriptFor(this.selectedWorkflowSubagent());
  }

  /** Close the transcript view — land back on a standalone agent or clear. */
  deselect(): void {
    this.workflowPermissions.onUserNavigation();
    this.workflowDetailPicked.set(false);
    const first = this.standaloneAgents()[0];
    this.selectedAgentId.set(first ? first.agentId : null);
  }

  /**
   * Fetch a workflow subagent's saved transcript via the store's
   * `subagent:transcript` RPC. Reuses the existing store method (same path the
   * inline bubble / background-agent tray use). A missing agentId/session (no
   * viewable transcript) clears to the viewer's empty state.
   */
  private async loadTranscriptFor(sub: SubagentRecord | null): Promise<void> {
    if (!sub || !sub.agentId || !sub.parentSessionId) {
      this._transcriptToken++;
      this._transcriptMessages.set([]);
      this._transcriptError.set(null);
      this._transcriptLoading.set(false);
      return;
    }
    const token = ++this._transcriptToken;
    this._transcriptLoading.set(true);
    this._transcriptError.set(null);
    try {
      const messages = await this.store.getSubagentTranscript(
        sub.parentSessionId,
        sub.agentId,
      );
      if (token !== this._transcriptToken) return;
      this._transcriptMessages.set(messages);
    } catch (err: unknown) {
      if (token !== this._transcriptToken) return;
      this._transcriptError.set(
        err instanceof Error ? err.message : 'Failed to load transcript',
      );
    } finally {
      if (token === this._transcriptToken) this._transcriptLoading.set(false);
    }
  }

  onClose(): void {
    if (this.embeddedOpen() !== undefined) {
      this.closed.emit();
    } else {
      this.store.closePanel();
    }
  }

  onClearCompleted(): void {
    const sid = this.sessionId();
    if (sid === null) {
      this.store.clearCompleted();
      return;
    }
    // Scoped surface. With an unresolved session this used to fall through to
    // the global clear and wipe every OTHER session's completed agents, so an
    // empty scope now clears nothing.
    if (sid) this.store.clearCompletedInSession(sid);
  }

  allowPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: { requestId: perm.requestId, decision: 'allow' },
    });
    this.store.clearPermission(agentId, perm.requestId);
  }

  denyPermission(agentId: string, perm: AgentPermissionRequest): void {
    this.vscode.postMessage({
      type: MESSAGE_TYPES.AGENT_MONITOR_PERMISSION_RESPONSE,
      payload: {
        requestId: perm.requestId,
        decision: 'deny',
        reason: 'User denied',
      },
    });
    this.store.clearPermission(agentId, perm.requestId);
  }
}
