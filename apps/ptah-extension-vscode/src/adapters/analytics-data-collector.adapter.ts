/**
 * Analytics Data Collector Adapter
 *
 * Adapts AnalyticsDataCollector to implement IAnalyticsDataCollector interface
 * from claude-domain library.
 *
 * This adapter bridges the gap between:
 * - AnalyticsDataCollector (main app's full-featured analytics service)
 * - IAnalyticsDataCollector (claude-domain's analytics interface)
 *
 * Pattern: Adapter pattern for cross-library dependency injection
 * Verification: Implements IAnalyticsDataCollector from analytics-orchestration.service.ts:67
 */

import type {
  IAnalyticsDataCollector,
  AnalyticsData as ClaudeAnalyticsData,
} from '@ptah-extension/claude-domain';
import type { AnalyticsDataCollector } from '../services/analytics-data-collector';
import type { AnalyticsData as MainAnalyticsData } from '../services/analytics-data-collector';

/**
 * Analytics Data Collector Adapter
 * Implements IAnalyticsDataCollector by delegating to main app's AnalyticsDataCollector
 */
export class AnalyticsDataCollectorAdapter implements IAnalyticsDataCollector {
  constructor(private readonly analyticsCollector: AnalyticsDataCollector) {}

  /**
   * Track message activity
   * Delegates to AnalyticsDataCollector.trackMessageActivity()
   */
  trackMessageActivity(): void {
    this.analyticsCollector.trackMessageActivity();
  }

  /**
   * Track session creation
   * Delegates to AnalyticsDataCollector.trackSessionCreation()
   */
  trackSessionCreation(): void {
    this.analyticsCollector.trackSessionCreation();
  }

  /**
   * Track command execution
   * Delegates to AnalyticsDataCollector.trackCommandExecution()
   */
  trackCommandExecution(): void {
    this.analyticsCollector.trackCommandExecution();
  }

  /**
   * Track response time
   * Delegates to AnalyticsDataCollector.trackResponseTime()
   */
  trackResponseTime(responseTime: number, success: boolean): void {
    this.analyticsCollector.trackResponseTime(responseTime, success);
  }

  /**
   * Get analytics data
   * Transforms MainAnalyticsData to ClaudeAnalyticsData format
   */
  async getAnalyticsData(): Promise<ClaudeAnalyticsData> {
    const mainData = await this.analyticsCollector.getAnalyticsData();

    // Transform to claude-domain's simpler AnalyticsData format
    return this.transformAnalyticsData(mainData);
  }

  /**
   * Transform analytics data from main app format to claude-domain format
   */
  private transformAnalyticsData(
    mainData: MainAnalyticsData
  ): ClaudeAnalyticsData {
    return {
      timestamp: mainData.timestamp,
      sessions: {
        total: mainData.sessions.total || 0,
        active: mainData.sessions.active || 0,
        avgDuration: 0, // Not tracked in main format
      },
      performance: {
        avgResponseTime: mainData.performance.avgResponseTime || 0,
        successRate: mainData.performance.successRate || 1.0,
        errorRate: mainData.performance.errorRate || 0.0,
      },
      system: {
        memoryUsage: {
          used: mainData.system.memoryUsage.used,
          total: mainData.system.memoryUsage.total,
          percentage: mainData.system.memoryUsage.percentage,
        },
        cpuUsage: mainData.system.cpuUsage,
        uptime: mainData.system.uptime,
        nodeVersion: mainData.system.nodeVersion,
        vsCodeVersion: mainData.system.vsCodeVersion,
      },
      workspace: {
        name: mainData.workspace.name,
        path: mainData.workspace.path,
        fileCount: mainData.workspace.fileCount,
        contextFilesIncluded: mainData.workspace.contextFilesIncluded,
        contextTokenEstimate: mainData.workspace.contextTokenEstimate,
      },
      commands: {
        topCommands: (mainData.commands?.topCommands || []).map((cmd) => ({
          name: cmd.name,
          count: cmd.usageCount || 0,
        })),
        totalExecutions: mainData.commands?.totalExecutions || 0,
        avgExecutionTime: mainData.commands?.avgExecutionTime || 0,
      },
      activity: {
        messagesLast24h: mainData.activity.messagesLast24h,
        sessionsLast24h: mainData.activity.sessionsLast24h,
        peakHour: mainData.activity.peakHour,
        totalActiveTime: mainData.activity.totalActiveTime,
      },
    };
  }
}
