/**
 * Webview UI Types - Dashboard and Dropdown Components
 * These are UI-specific types that are shared across webview components
 */

// Dashboard component types for unified performance and analytics dashboard

export interface DashboardMetrics {
  performance: PerformanceMetrics;
  usage: UsageMetrics;
  status: SystemStatus;
}

export interface PerformanceMetrics {
  currentLatency: number; // Current message processing time in ms
  averageLatency: number; // Average latency over session
  messagesPerMinute: number; // Throughput rate
  memoryUsage: number; // Current memory usage in MB
  successRate: number; // Success percentage
  uptime: number; // System uptime percentage
}

export interface UsageMetrics {
  commandsRun: number; // Total commands executed
  tokensUsed: number; // Total tokens consumed
  sessionsToday: number; // Sessions started today
  totalMessages: number; // Total messages processed
}

export interface SystemStatus {
  systemStatus: 'operational' | 'degraded' | 'critical';
  lastUpdated: Date;
}

export interface PerformanceData {
  historicalData: HistoricalDataPoint[];
  latencyTrend: 'improving' | 'stable' | 'degrading';
  memoryTrend: 'improving' | 'stable' | 'degrading';
  throughputTrend: 'improving' | 'stable' | 'degrading';
}

export interface HistoricalDataPoint {
  timestamp: number;
  latency: number;
  memoryUsage: number;
  throughput: number;
}

export interface ActivityItem {
  id: string;
  type: 'message' | 'error' | 'system' | 'user';
  title: string;
  description: string;
  timestamp: Date;
  status: 'success' | 'warning' | 'error' | 'info';
}

/**
 * VS Code Dropdown Option Interface
 * - Shared type definition for dropdown options
 * - Used across all dropdown components
 */
export interface DropdownOption {
  value: string;
  label: string;
  description?: string;
  icon?: string;
  disabled?: boolean;
  group?: string;
}

/**
 * Processed Claude Message for UI Display
 * Enhanced message format with UI-specific properties
 */
export interface ProcessedClaudeMessage {
  readonly id: string;
  readonly sessionId: string;
  readonly type: 'user' | 'assistant' | 'system';
  readonly content: string;
  readonly timestamp: number;
  readonly streaming?: boolean;
  readonly files?: readonly string[];
  readonly isError?: boolean;
  readonly isComplete?: boolean;
  readonly metadata?: Readonly<Record<string, unknown>>;
  // UI-specific properties
  readonly displayContent?: string;
  readonly formattedTimestamp?: string;
  readonly isStreaming?: boolean;
  readonly hasAttachments?: boolean;
  readonly renderHtml?: boolean;
}

/**
 * Configuration types for webview
 */
export interface ClaudeConfiguration {
  model: string;
  temperature: number;
  maxTokens: number;
}


export interface StreamingConfiguration {
  bufferSize: number;
  chunkSize: number;
  timeoutMs: number;
}

export interface WebviewConfiguration {
  claude: ClaudeConfiguration;
  streaming: StreamingConfiguration;
}