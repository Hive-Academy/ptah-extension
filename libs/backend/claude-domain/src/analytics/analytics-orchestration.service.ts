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
import { TOKENS } from '@ptah-extension/vscode-core';

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
 *
 * Performance Optimization:
 * - Async event tracking with queue batching to prevent blocking extension host
 * - Debounced console logging to reduce overhead during initialization
 */
@injectable()
export class AnalyticsOrchestrationService {
  private eventQueue: Array<TrackEventRequest> = [];
  private processingQueue = false;
  private logDebounceTimer?: NodeJS.Timeout;

  constructor(
    @inject(TOKENS.ANALYTICS_DATA_COLLECTOR)
    private readonly analyticsDataCollector: IAnalyticsDataCollector
  ) {
    // Start background queue processor
    this.startQueueProcessor();
  }

  /**
   * Track an analytics event (async, non-blocking)
   * Extracted from: analytics-message-handler.ts:68-122
   *
   * Performance: Uses async queue to prevent blocking extension host during initialization
   */
  async trackEvent(request: TrackEventRequest): Promise<TrackEventResult> {
    // Add to queue for async processing
    this.eventQueue.push(request);

    // Log asynchronously using setImmediate to prevent blocking
    setImmediate(() => {
      this.debouncedLog(
        `Tracking analytics event: ${request.event}`,
        request.properties
      );
    });

    return {
      success: true,
      tracked: true,
      event: request.event,
    };
  }

  /**
   * Process analytics event queue in background
   * Batches events to reduce overhead
   */
  private startQueueProcessor(): void {
    // Process queue every 100ms
    setInterval(() => {
      if (this.eventQueue.length > 0 && !this.processingQueue) {
        this.processEventQueue();
      }
    }, 100);
  }

  /**
   * Process queued analytics events
   */
  private async processEventQueue(): Promise<void> {
    if (this.processingQueue || this.eventQueue.length === 0) return;

    this.processingQueue = true;

    try {
      // Process all queued events
      const eventsToProcess = [...this.eventQueue];
      this.eventQueue = [];

      for (const request of eventsToProcess) {
        try {
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
              const responseTime = request.properties?.[
                'responseTime'
              ] as number;
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
        } catch (error) {
          // Log errors asynchronously
          setImmediate(() => {
            console.error('Analytics event tracking failed', error);
          });
        }
      }
    } finally {
      this.processingQueue = false;
    }
  }

  /**
   * Debounced logging to reduce console overhead
   */
  private debouncedLog(
    message: string,
    properties?: Record<string, unknown>
  ): void {
    // Clear existing timer
    if (this.logDebounceTimer) {
      clearTimeout(this.logDebounceTimer);
    }

    // Schedule log for next tick
    this.logDebounceTimer = setTimeout(() => {
      console.info(message, properties);
      this.logDebounceTimer = undefined;
    }, 50);
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
      // Log asynchronously to prevent blocking
      setImmediate(() => {
        console.info('Fetching real-time analytics data');
      });

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
