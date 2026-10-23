export {
  GenerationWorkflowLauncherService,
  type GenerationWorkflowOpenRequest,
  type GenerationWorkflowOpenResult,
} from './lib/services/generation-workflow-launcher.service';

/**
 * @ptah-extension/chat-ui — Reusable presentational chat components.
 *
 * Atomic Design layout:
 *   - Atoms: smallest reusable building blocks
 *   - Molecules: composed UI pieces
 */
export { CopyButtonComponent } from './lib/atoms/copy-button.component';
export { ReportResponseButtonComponent } from './lib/atoms/report-response-button.component';
export { extractMessageText } from './lib/atoms/message-text';
export { CostBadgeComponent } from './lib/atoms/cost-badge.component';
export { DurationBadgeComponent } from './lib/atoms/duration-badge.component';
export { ElectronResizeHandleComponent } from './lib/atoms/electron-resize-handle.component';
export { ExpandableContentComponent } from './lib/atoms/expandable-content.component';
export { FilePathLinkComponent } from './lib/atoms/file-path-link.component';
export { SidebarTabComponent } from './lib/atoms/sidebar-tab.component';
export { SkeletonBlockComponent } from './lib/atoms/skeleton-block.component';
export {
  SplitHandleComponent,
  type SplitHandleAppearance,
  type SplitHandleOrientation,
} from './lib/atoms/split-handle.component';
export { StatusBadgeComponent } from './lib/atoms/status-badge.component';
export { StreamingQuotesComponent } from './lib/atoms/streaming-quotes.component';
export { ThemeToggleComponent } from './lib/atoms/theme-toggle.component';
export { TokenBadgeComponent } from './lib/atoms/token-badge.component';
export { ToolIconComponent } from './lib/atoms/tool-icon.component';
export { TypingCursorComponent } from './lib/atoms/typing-cursor.component';
export { RESIZE_HANDLE_STYLES } from './lib/atoms/resize-handle.styles';
export { AgentCardOutputComponent } from './lib/molecules/agent-card/agent-card-output.component';
export { AgentCardPermissionComponent } from './lib/molecules/agent-card/agent-card-permission.component';
export type {
  RenderSegment,
  StderrSegment,
} from './lib/molecules/agent-card/agent-card.types';
export { AgentSummaryComponent } from './lib/molecules/agent-summary.component';
export { LaneResultCardComponent } from './lib/molecules/lane-result/lane-result-card.component';
export {
  parseLaneResult,
  type LaneResult,
  type LaneResultFile,
  type LaneResultFolder,
  type LaneVerdictTone,
} from './lib/utils/lane-result.utils';
export { BootProgressComponent } from './lib/molecules/boot-progress/boot-progress.component';
export {
  BackgroundAgentStripComponent,
  formatAgentElapsed,
  type BackgroundAgentStripEntry,
  type BackgroundAgentStripStatus,
  type BackgroundAgentSteerRequest,
} from './lib/molecules/background-agent-strip.component';
export { AgentSteerInputComponent } from './lib/molecules/agent-steer-input.component';
export {
  AgentLaneStatsComponent,
  type AgentLaneStatsView,
} from './lib/molecules/agent-lane-stats/agent-lane-stats.component';
export { QuestionCardComponent } from './lib/molecules/question-card.component';
export { ThinkingBlockComponent } from './lib/molecules/thinking-block.component';
export { AutopilotPopoverComponent } from './lib/molecules/chat-input/autopilot-popover.component';
export { CompactSessionActivityComponent } from './lib/molecules/compact-session/compact-session-activity.component';
export {
  parseTodoList,
  summarizeTodos,
  sameGitState,
  todoTitle,
  gitTitle,
  type CompactTodoState,
  type CompactGitState,
} from './lib/molecules/compact-session/compact-session-metrics';
export { CompactSessionStatsComponent } from './lib/molecules/compact-session/compact-session-stats.component';
export { CompactRailCardComponent } from './lib/molecules/compact-session/compact-rail-card.component';
export { COMPACT_RAIL_CARD_HEIGHT } from './lib/molecules/compact-session/compact-lane.types';
export type {
  CompactCallout,
  CompactErrorCallout,
  CompactLaneKind,
  CompactLaneRow,
  CompactLaneStatus,
  CompactLaneSummary,
  CompactPermissionCallout,
  CompactQuestionCallout,
  CompactRailDensity,
  CompactRailState,
} from './lib/molecules/compact-session/compact-lane.types';
export {
  summarizeFinalized,
  summarizeLive,
  type CompactSemanticMark,
  type CompactSemanticMarkKind,
  type CompactSessionSummary,
  type CompactSummaryContent,
  type CompactSummaryContext,
  type CompactSummaryMetrics,
  type CompactSummaryStatusTone,
} from './lib/molecules/compact-session/compact-session-summary';
export { CompactionMarkerComponent } from './lib/molecules/notifications/compaction-marker.component';
export { CompactionNotificationComponent } from './lib/molecules/notifications/compaction-notification.component';
export { DenyMessagePopoverComponent } from './lib/molecules/permissions/deny-message-popover.component';
export { PermissionRequestCardComponent } from './lib/molecules/permissions/permission-request-card.component';
export { SessionCostSummaryComponent } from './lib/molecules/session/session-cost-summary.component';
export {
  SessionStatsSummaryComponent,
  type LiveModelStats,
} from './lib/molecules/session/session-stats-summary.component';
export { buildStatsLimitViewModel } from './lib/molecules/session/plan-limits/stats-limit-view-model';
export type {
  StatsLimitLaneRun,
  StatsLimitViewModel,
  StatsLimitViewModelInput,
} from './lib/molecules/session/plan-limits/stats-limit-view-model.types';
export { StatsTileExpansionState } from './lib/molecules/session/plan-limits/stats-tile-expansion.state';
export { McpDirectoryBrowserComponent } from './lib/molecules/setup-plugins/mcp-directory-browser.component';
export {
  groupInstalledServers,
  mcpTargetLabel,
  type InstalledServerGroup,
} from './lib/molecules/setup-plugins/installed-mcp-groups';
export { removeInstalledGroup } from './lib/molecules/setup-plugins/installed-mcp-removal';
export { MARKETPLACE_RPC_TIMEOUTS } from './lib/molecules/setup-plugins/marketplace-rpc-timeouts';
export { PluginCatalogPanelComponent } from './lib/molecules/setup-plugins/plugin-catalog-panel.component';
export { PromptSuggestionsComponent } from './lib/molecules/setup-plugins/prompt-suggestions.component';
export { SetupStatusStore } from './lib/molecules/setup-plugins/setup-status.store';
export { SkillShBrowserComponent } from './lib/molecules/setup-plugins/skill-sh-browser.component';
export { CodeOutputComponent } from './lib/molecules/tool-execution/code-output.component';
export { fenceCodeBlock } from './lib/molecules/tool-execution/code-fence';
export { DiffDisplayComponent } from './lib/molecules/tool-execution/diff-display.component';
export { TodoListDisplayComponent } from './lib/molecules/tool-execution/todo-list-display.component';
export { ToolCallHeaderComponent } from './lib/molecules/tool-execution/tool-call-header.component';
export { ToolInputDisplayComponent } from './lib/molecules/tool-execution/tool-input-display.component';
export { ToolOutputDisplayComponent } from './lib/molecules/tool-execution/tool-output-display.component';
export {
  PtahUiLiveWindow,
  PTAH_UI_LIVE_CAP,
} from './lib/services/ptah-ui-live-window';
export {
  PTAH_UI_HOST_SOURCES,
  type PtahUiHostSources,
} from './lib/services/ptah-ui-host-sources';
// Eager-light dock ports (decisions #59, #60, #73): the file's only runtime
// import is `@angular/core`. The ChatView provides both tokens, the chip reads
// `PTAH_UI_DISPLAY_DOCK` and the lazy display sync writes through
// `PTAH_UI_DISPLAY_DOCK_SYNC`.
export {
  PTAH_UI_DISPLAY_DOCK,
  PTAH_UI_DISPLAY_DOCK_SYNC,
  displayFenceKey,
  type PtahUiDisplayDock,
  type PtahUiDisplayDockSync,
  type PtahUiDisplayFenceState,
  type PtahUiDisplayFenceStatus,
  type PtahUiDisplaySurfacesPublication,
} from './lib/services/ptah-ui-display-dock';
// Type only (erased): the dock store names the surfaces it holds. Never add a
// value export from `organisms/display-panel/` here; that folder is lazy.
export type { DisplaySurface } from './lib/organisms/display-panel/display-surfaces';
// Artifact surfaces (TASK_2026_710): the transcript card is metadata only, so
// it is eager-safe as a value export. The sandboxed viewer and theme bridge
// carry the ptah-artifact iframe and its postMessage channel and stay behind
// the lazy display-panel chunk (like `organisms/display-panel` above, never a
// value export from this barrel). Reach them through the folder barrel.
export { ArtifactCardComponent } from './lib/organisms/artifacts/artifact-card.component';
export {
  generateAgentColor,
  generateAgentColorOklch,
  formatOklch,
  isThemeFallbackColor,
  THEME_FALLBACK_OKLCH,
  type OklchColor,
} from './lib/utils/agent-color.utils';
export { isPtahMcpToolName } from './lib/utils/tool-target.utils';
export {
  toolStatusPresentation,
  type ToolStatusPresentation,
} from './lib/utils/tool-status.utils';
// Agent avatar vocabulary (TASK_2026_677 C1): one identity, one status word
// set and one CLI-mark / role-icon table for the turn chips, the inspector
// AGENTS rows and the agent dock.
export { AgentAvatarComponent } from './lib/atoms/agent-avatar/agent-avatar.component';
export {
  AGENT_KIND_LABEL,
  agentAccessibleLabel,
  type AgentAvatarSize,
  type AgentKind,
  type AgentLabelParts,
  type AgentStatusWord,
} from './lib/atoms/agent-avatar/agent-avatar.types';
export {
  backgroundAgentStatusWord,
  cliLaneStatusWord,
  orchestratorStatusWord,
  subagentStatusWord,
} from './lib/atoms/agent-avatar/agent-status';
export {
  formatAgentDuration,
  agentRunDurationMs,
  agentRunLabel,
} from './lib/atoms/agent-avatar/agent-duration';
export {
  CLI_PROVIDER_MARK_IDS,
  cliMarkFor,
  roleIconFor,
  type CliMark,
} from './lib/atoms/agent-avatar/agent-marks';
// Badge text formatter as a pure fn (TASK_2026_677 A1-1) for the turn
// activity panel. The cost text formatter is `formatUsdCost` in
// `@ptah-extension/shared`, already shared by `ptah-cost-badge`.
export { formatTokenCount } from './lib/atoms/token-badge.component';
export { ContextRingComponent } from './lib/atoms/context-ring.component';
export {
  formatCost,
  formatDuration,
  formatTokens,
} from './lib/molecules/session/session-stats-format';
export {
  agentCountOf,
  durationMsOf,
  knownSubtotalOf,
} from './lib/molecules/session/session-stats-view';
export { InspectorSessionStatsComponent } from './lib/molecules/session/inspector-stats/inspector-session-stats.component';
export { InspectorLimitsLanesComponent } from './lib/molecules/session/inspector-stats/inspector-limits-lanes.component';
export {
  sessionContextCue,
  type SessionStatsInputs,
  type SessionContextCue,
} from './lib/molecules/session/session-stats-view';
export {
  sessionLimitSummary,
  inspectorToggleDescription,
  limitAwareDot,
  type SessionLimitSummary,
} from './lib/molecules/session/plan-limits/session-limit-summary';
export { backgroundAgentPopulation } from './lib/molecules/background-agent-population';
