/**
 * Analytics Orchestration Service
 * Business logic layer for analytics and data collection operations
 *
 * Migrated from: apps/ptah-extension-vscode/src/services/webview-message-handlers/analytics-message-handler.ts (255 lines)
 * Extracted business logic: ~155 lines
 *
 * Verification trail:
 * - Source handler analyzed: analytics-message-handler.ts:1-255
 * - Dependency: AnalyticsDataCollector from main app (will use interface pattern)
 * - Pattern: Interface-based DI to avoid circular dependency
 */

import { injectable, inject } from 'tsyringe';
import type { CorrelationId } from '@ptah-extension/shared';

/**
 * DI Token for AnalyticsDataCollector injection
 */
export const ANALYTICS_DATA_COLLECTOR = Symbol.for('AnalyticsDataCollector');

/**
 * Analytics Data interface (from analytics-data-collector.ts)
 */
export interface AnalyticsData {
  timestamp: number;
  sessions: {
    total: number;
    active: number;
    avgDuration: number;
  };
  performance: {
    avgResponseTime: number;
    successRate: number;
    errorRate: number;
  };
  system: {
    memoryUsage: {
      used: number;
      total: number;
      percentage: number;
    };
    cpuUsage: number;
    uptime: number;
    nodeVersion: string;
    vsCodeVersion: string;
  };
  workspace: {
    name: string;
    path: string;
    fileCount: number;
    contextFilesIncluded: number;
    contextTokenEstimate: number;
  };
  commands: {
    topCommands: Array<{ name: string; count: number }>;
    totalExecutions: number;
    avgExecutionTime: number;
  };
  activity: {
    messagesLast24h: number;
    sessionsLast24h: number;
    peakHour: { hour: number; messageCount: number };
    totalActiveTime: number;
  };
}

/**
 * Analytics Data Collector interface
 */
export interface IAnalyticsDataCollector {
  trackMessageActivity(): void;
  trackSessionCreation(): void;
  trackCommandExecution(): void;
  trackResponseTime(responseTime: number, success: boolean): void;
  getAnalyticsData(): Promise<AnalyticsData>;
}

/**
 * Request/Response Types for Analytics Operations
 */

export interface TrackEventRequest {
  requestId: CorrelationId;
  event: string;
  properties?: Record<string, unknown>;
}

export interface TrackEventResult {
  success: boolean;
  tracked?: boolean;
  event?: string;
  error?: {
    code: string;
    message: string;
  };
}

export interface GetAnalyticsDataRequest {
  requestId: CorrelationId;
}

export interface GetAnalyticsDataResult {
  success: boolean;
  data?: AnalyticsData;
  warning?: string;
  error?: {
    code: string;
    message: string;
  };
}

/**
 * Analytics Orchestration Service
 * Handles all analytics and data collection business logic
 *
 * Business Logic Extracted from analytics-message-handler.ts:
 * - Track analytics events (handleTrackEvent)
 * - Get analytics data with fallback (handleGetAnalyticsData)
 */
@injectable()
export class AnalyticsOrchestrationService {
  constructor(
    @inject(ANALYTICS_DATA_COLLECTOR)
    private readonly analyticsDataCollector: IAnalyticsDataCollector
  ) {}

  /**
   * Track an analytics event
   * Extracted from: analytics-message-handler.ts:68-122
   */
  async trackEvent(request: TrackEventRequest): Promise<TrackEventResult> {
    try {
      console.info(
        `Tracking analytics event: ${request.event}`,
        request.properties
      );

      // Track specific events with the data collector
      switch (request.event) {
        case 'message_sent':
          this.analyticsDataCollector.trackMessageActivity();
          break;
        case 'session_created':
          this.analyticsDataCollector.trackSessionCreation();
          break;
        case 'command_executed':
          this.analyticsDataCollector.trackCommandExecution();
          break;
        case 'response_received': {
          const responseTime = request.properties?.['responseTime'] as number;
          const success = request.properties?.['success'] as boolean;
          if (typeof responseTime === 'number') {
            this.analyticsDataCollector.trackResponseTime(
              responseTime,
              success ?? true
            );
          }
          break;
        }
      }

      return {
        success: true,
        tracked: true,
        event: request.event,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to track event';
      console.error('Analytics event tracking failed', error);
      return {
        success: false,
        error: {
          code: 'TRACK_EVENT_ERROR',
          message: errorMessage,
        },
      };
    }
  }

  /**
   * Get analytics data
   * Extracted from: analytics-message-handler.ts:124-212
   *
   * @param fallbackDataProvider - Optional fallback function if analytics collector fails
   */
  async getAnalyticsData(
    request: GetAnalyticsDataRequest,
    fallbackDataProvider?: () => Partial<AnalyticsData>
  ): Promise<GetAnalyticsDataResult> {
    try {
      console.info('Fetching real-time analytics data');
      const analyticsData =
        await this.analyticsDataCollector.getAnalyticsData();

      return {
        success: true,
        data: analyticsData,
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get analytics data';
      console.error('Analytics data collection failed', error);

      // Fallback to basic session statistics if real analytics fail
      if (fallbackDataProvider) {
        try {
          const fallbackData = fallbackDataProvider();

          return {
            success: true,
            data: fallbackData as AnalyticsData,
            warning:
              'Using fallback data - full analytics temporarily unavailable',
          };
        } catch {
          return {
            success: false,
            error: {
              code: 'GET_ANALYTICS_ERROR',
              message: errorMessage,
            },
          };
        }
      }

      return {
        success: false,
        error: {
          code: 'GET_ANALYTICS_ERROR',
          message: errorMessage,
        },
      };
    }
  }
}
