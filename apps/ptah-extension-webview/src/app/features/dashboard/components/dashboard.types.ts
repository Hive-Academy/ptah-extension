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
