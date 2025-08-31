// Dumb Components - Pure Presentation
// No business logic, services, or state management

// Input Components
export { VSCodeInputComponent } from './inputs/vscode-input.component';
export { VSCodeInputIconComponent } from './inputs/input-icon.component';
export { VSCodeActionButtonComponent } from './inputs/action-button.component';
export { VSCodeValidationMessageComponent } from './inputs/validation-message.component';

// Indicator Components
export { VSCodeLoadingSpinnerComponent } from './indicators/loading-spinner.component';

// Status Components
export { VSCodeStatusBarComponent } from './status/status-bar.component';

// Dropdown Components
export { VSCodeDropdownTriggerComponent } from './dropdowns/dropdown-trigger.component';
export { VSCodeDropdownSearchComponent } from './dropdowns/dropdown-search.component';
export { VSCodeDropdownOptionsListComponent } from './dropdowns/dropdown-options-list.component';
export { type DropdownOption } from './dropdowns/dropdown-option.interface';

// Chat Components
export { VSCodeChatEmptyStateComponent } from './chat/chat-empty-state.component';
export { VSCodeChatTokenUsageComponent, type TokenUsage } from './chat/chat-token-usage.component';
export { VSCodeChatInputAreaComponent } from './chat/chat-input-area.component';
export {
  VSCodeChatMessagesListComponent,
  type ChatMessage,
} from './chat/chat-messages-list.component';
export { EnhancedChatMessagesListComponent } from './chat/enhanced-chat-messages-list.component';
export { ClaudeMessageContentComponent } from './chat/claude-message-content.component';
export { VSCodeChatHeaderComponent, type ProviderStatus } from './chat/chat-header.component';
export {
  VSCodeChatStatusBarComponent,
  type ChatStatusMetrics,
} from './chat/chat-status-bar.component';
export { VSCodeChatStreamingStatusComponent } from './chat/chat-streaming-status.component';
export { VSCodeChatMessagesContainerComponent } from './chat/chat-messages-container.component';

// Analytics Components
export { VSCodeAnalyticsHeaderComponent } from './analytics/analytics-header.component';
export {
  VSCodeAnalyticsStatsGridComponent,
  type StatsData,
} from './analytics/analytics-stats-grid.component';
export { VSCodeAnalyticsComingSoonComponent } from './analytics/analytics-coming-soon.component';

// Dashboard Components
export { VSCodeDashboardHeaderComponent } from './dashboard/dashboard-header.component';
export { VSCodeDashboardMetricsGridComponent } from './dashboard/dashboard-metrics-grid.component';
export { VSCodeDashboardPerformanceChartComponent } from './dashboard/dashboard-performance-chart.component';
export { VSCodeDashboardActivityFeedComponent } from './dashboard/dashboard-activity-feed.component';
export {
  type DashboardMetrics,
  type PerformanceData,
  type ActivityItem,
  type HistoricalDataPoint,
} from './dashboard/dashboard.types';

// Session Components
export { SessionSelectorComponent } from './session/session-selector.component';
export { SessionCardComponent, type SessionAction } from './session/session-card.component';

// Overlay Components
export {
  VSCodeCommandBottomSheetComponent,
  type QuickCommand,
} from './overlays/command-bottom-sheet.component';
export {
  VSCodePermissionPopupComponent,
  type PermissionRequest,
  type PermissionResponse,
} from './overlays/permission-popup.component';
