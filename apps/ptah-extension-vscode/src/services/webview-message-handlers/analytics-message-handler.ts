import {
  BaseWebviewMessageHandler,
  StrictPostMessageFunction,
  IWebviewMessageHandler,
} from './base-message-handler';
import {
  StrictMessageType,
  MessagePayloadMap,
  MessageResponse,
  AnalyticsEventPayload,
} from '@ptah-extension/shared';
import { CorrelationId } from '@ptah-extension/shared';
import { SessionManager } from '../session-manager';
import { CommandBuilderService } from '../command-builder.service';
import {
  AnalyticsDataCollector,
  AnalyticsData,
} from '../analytics-data-collector';
import { Logger } from '../../core/logger';

/**
 * Analytics Message Types - Strict type definition
 */
type AnalyticsMessageTypes = 'analytics:trackEvent' | 'analytics:getData';

/**
 * AnalyticsMessageHandler - Single Responsibility: Handle analytics and reporting messages
 */
export class AnalyticsMessageHandler
  extends BaseWebviewMessageHandler<AnalyticsMessageTypes>
  implements IWebviewMessageHandler<AnalyticsMessageTypes>
{
  readonly messageType = 'analytics:';

  constructor(
    postMessage: StrictPostMessageFunction,
    private sessionManager: SessionManager,
    private commandBuilderService: CommandBuilderService,
    private analyticsDataCollector: AnalyticsDataCollector
  ) {
    super(postMessage);
  }

  async handle<K extends AnalyticsMessageTypes>(
    messageType: K,
    payload: MessagePayloadMap[K]
  ): Promise<MessageResponse> {
    try {
      switch (messageType) {
        case 'analytics:trackEvent':
          return await this.handleTrackEvent(payload as AnalyticsEventPayload);
        case 'analytics:getData':
          return await this.handleGetAnalyticsData();
        default:
          throw new Error(`Unknown analytics message type: ${messageType}`);
      }
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Analytics handler error';
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'ANALYTICS_HANDLER_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleTrackEvent(
    payload: AnalyticsEventPayload
  ): Promise<MessageResponse> {
    try {
      Logger.info(
        `Tracking analytics event: ${payload.event}`,
        payload.properties
      );

      // Track specific events with the data collector
      switch (payload.event) {
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
          const responseTime = payload.properties.responseTime as number;
          const success = payload.properties.success as boolean;
          if (typeof responseTime === 'number') {
            this.analyticsDataCollector.trackResponseTime(
              responseTime,
              success
            );
          }
          break;
        }
      }

      const responseData = { tracked: true, event: payload.event };
      this.sendSuccessResponse('analytics:eventTracked', responseData);

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to track event';
      Logger.error('Analytics event tracking failed', error);
      this.sendErrorResponse('analytics:trackEvent', errorMessage);
      return {
        requestId: CorrelationId.create(),
        success: false,
        error: {
          code: 'TRACK_EVENT_ERROR',
          message: errorMessage,
        },
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    }
  }

  private async handleGetAnalyticsData(): Promise<MessageResponse> {
    try {
      Logger.info('Fetching real-time analytics data');
      const analyticsData =
        await this.analyticsDataCollector.getAnalyticsData();
      const responseData = { data: analyticsData };

      this.sendSuccessResponse('analytics:getData', responseData);

      return {
        requestId: CorrelationId.create(),
        success: true,
        data: responseData,
        metadata: {
          timestamp: Date.now(),
          source: 'extension',
          version: '1.0.0',
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to get analytics data';
      Logger.error('Analytics data collection failed', error);

      // Fallback to basic session statistics if real analytics fail
      try {
        const fallbackData = this.getFallbackAnalyticsData();
        const responseData = {
          data: fallbackData,
          warning:
            'Using fallback data - full analytics temporarily unavailable',
        };

        this.sendSuccessResponse('analytics:getData', responseData);

        return {
          requestId: CorrelationId.create(),
          success: true,
          data: responseData,
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      } catch (fallbackError) {
        this.sendErrorResponse('analytics:getData', errorMessage);
        return {
          requestId: CorrelationId.create(),
          success: false,
          error: {
            code: 'GET_ANALYTICS_ERROR',
            message: errorMessage,
          },
          metadata: {
            timestamp: Date.now(),
            source: 'extension',
            version: '1.0.0',
          },
        };
      }
    }
  }

  /**
   * Fallback analytics data when the full analytics collector fails
   * Provides basic session statistics only
   */
  private getFallbackAnalyticsData(): Partial<AnalyticsData> {
    Logger.warn('Using fallback analytics data - reduced functionality');

    const sessionStats = this.sessionManager.getSessionStatistics();

    return {
      timestamp: Date.now(),
      sessions: sessionStats,
      performance: {
        avgResponseTime: 0,
        successRate: 1.0,
        errorRate: 0,
      },
      system: {
        memoryUsage: {
          used: 0,
          total: 0,
          percentage: 0,
        },
        cpuUsage: 0,
        uptime: Math.round(process.uptime()),
        nodeVersion: process.version,
        vsCodeVersion: '(unavailable)',
      },
      workspace: {
        name: 'Unknown',
        path: '',
        fileCount: 0,
        contextFilesIncluded: 0,
        contextTokenEstimate: 0,
      },
      commands: {
        topCommands: [],
        totalExecutions: 0,
        avgExecutionTime: 0,
      },
      activity: {
        messagesLast24h: 0,
        sessionsLast24h: 0,
        peakHour: { hour: 0, messageCount: 0 },
        totalActiveTime: 0,
      },
    };
  }
}
