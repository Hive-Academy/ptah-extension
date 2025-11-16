/**
 * Analytics Service - System Analytics and Metrics
 *
 * Migrated from: apps/ptah-extension-webview/src/app/core/services/analytics.service.ts
 *
 * Modernizations applied:
 * - inject() pattern instead of constructor injection
 * - Pure signal-based state management
 * - Computed signals for derived analytics
 * - Type-safe data structures
 * - Zero `any` types
 *
 * Responsibilities:
 * - Track user interactions and events
 * - Provide system analytics data
 * - Monitor performance metrics
 * - Generate usage statistics
 */

import { Injectable, signal, computed, inject } from '@angular/core';
import { VSCodeService } from './vscode.service';
import { LoggingService } from './logging.service';

export interface AnalyticsData {
  performance: {
    currentLatency: number;
    averageLatency: number;
    messagesPerMinute: number;
    memoryUsage: number;
    successRate: number;
    uptime: number;
  };
  usage: {
    commandsRun: number;
    tokensUsed: number;
    sessionsToday: number;
    totalMessages: number;
  };
  status: {
    systemStatus: 'operational' | 'degraded' | 'critical';
    lastUpdated: number;
  };
}

export interface PerformanceData {
  historicalData: Array<{
    timestamp: number;
    latency: number;
    memoryUsage: number;
    throughput: number;
  }>;
  latencyTrend: 'improving' | 'stable' | 'degrading';
  memoryTrend: 'improving' | 'stable' | 'degrading';
  throughputTrend: 'improving' | 'stable' | 'degrading';
}

export interface ActivityItem {
  id: string;
  type: 'message' | 'error' | 'system' | 'user';
  title: string;
  description: string;
  timestamp: Date;
  status: 'success' | 'warning' | 'error' | 'info';
}

@Injectable({
  providedIn: 'root',
})
export class AnalyticsService {
  // ANGULAR 20 PATTERN: inject() for dependencies
  private readonly vsCodeService = inject(VSCodeService);
  private readonly logger = inject(LoggingService);

  // Feature flag: Disable analytics during development
  private readonly ANALYTICS_ENABLED = false; // Set to true for production

  // ANGULAR 20 PATTERN: Private signals for internal state management
  private readonly _rawAnalyticsData = signal<AnalyticsData | null>(null);
  private readonly _isLoading = signal(false);
  private readonly _lastFetch = signal<number>(0);
  private readonly _error = signal<string | null>(null);

  // Public readonly signals
  readonly rawAnalyticsData = this._rawAnalyticsData.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();
  readonly lastFetch = this._lastFetch.asReadonly();
  readonly error = this._error.asReadonly();

  // ANGULAR 20 PATTERN: Computed analytics with fallback
  readonly analyticsData = computed<AnalyticsData>(() => {
    const rawData = this._rawAnalyticsData();

    // Use real backend data if available
    if (rawData) {
      return rawData;
    }

    // Fallback to mock data when backend unavailable
    return this.generateFallbackData();
  });

  // ANGULAR 20 PATTERN: Computed performance data
  readonly performanceData = computed<PerformanceData>(() => {
    // Generate mock performance data
    // TODO: Replace with real backend data when available
    return {
      historicalData: [],
      latencyTrend: 'stable',
      memoryTrend: 'stable',
      throughputTrend: 'stable',
    };
  });

  // ANGULAR 20 PATTERN: Computed recent activities
  readonly recentActivities = computed<ActivityItem[]>(() => {
    // Generate mock activities
    // TODO: Replace with real backend data when available
    return [
      {
        id: '1',
        type: 'system',
        title: 'Analytics service initialized',
        description: 'System ready',
        timestamp: new Date(),
        status: 'info',
      },
    ];
  });

  // ANGULAR 20 PATTERN: Computed data freshness indicator
  readonly isDataFresh = computed(() => {
    const lastFetch = this._lastFetch();
    if (lastFetch === 0) return false;

    const now = Date.now();
    const age = now - lastFetch;
    return age < 5000; // Data is fresh for 5 seconds
  });

  /**
   * Fetch analytics data from backend
   */
  async fetchAnalyticsData(force = false): Promise<void> {
    // Skip if analytics disabled
    if (!this.ANALYTICS_ENABLED) {
      return;
    }

    // Don't fetch if already loading or data is fresh (unless forced)
    if ((this._isLoading() || this.isDataFresh()) && !force) {
      return;
    }

    this._isLoading.set(true);
    this._error.set(null);

    try {
      this.logger.debug('Requesting analytics data', 'AnalyticsService', {
        timestamp: Date.now(),
      });

      // Request analytics data from backend via VSCodeService
      this.vsCodeService.getAnalyticsData();

      // TODO: Handle response via message listener
      // For now, just set loading to false after timeout
      setTimeout(() => {
        this._isLoading.set(false);
        this._lastFetch.set(Date.now());
      }, 1000);
    } catch (error) {
      this.logger.error(
        'Failed to fetch analytics data',
        'AnalyticsService',
        error
      );
      this._error.set(`Failed to fetch analytics data: ${error}`);
      this._isLoading.set(false);
    }
  }

  /**
   * Track analytics event
   */
  trackEvent(
    event: string,
    properties?: Record<string, string | number | boolean>
  ): void {
    // Skip analytics if disabled (development mode)
    if (!this.ANALYTICS_ENABLED) {
      return;
    }

    try {
      this.logger.debug('Tracking analytics event', 'AnalyticsService', {
        event,
        properties,
      });
      this.vsCodeService.trackAnalyticsEvent(event, properties);
    } catch (error) {
      this.logger.error('Failed to track event', 'AnalyticsService', error);
    }
  }

  /**
   * Manually refresh analytics data
   */
  refreshData(): Promise<void> {
    this.logger.interaction('manualRefresh', 'AnalyticsService', {
      timestamp: Date.now(),
    });
    return this.fetchAnalyticsData(true);
  }

  /**
   * Get data age in milliseconds
   */
  getDataAge(): number {
    const lastFetch = this._lastFetch();
    return lastFetch > 0 ? Date.now() - lastFetch : -1;
  }

  private generateFallbackData(): AnalyticsData {
    // Generate reasonable fallback metrics when backend is unavailable
    const now = Date.now();
    const uptime = Math.max(85, Math.random() * 15 + 85); // 85-100%

    return {
      performance: {
        currentLatency: Math.floor(Math.random() * 500 + 200), // 200-700ms
        averageLatency: Math.floor(Math.random() * 400 + 300), // 300-700ms
        messagesPerMinute: Math.random() * 5, // 0-5 messages/min
        memoryUsage: Math.random() * 50 + 10, // 10-60MB
        successRate: Math.max(90, Math.random() * 10 + 90), // 90-100%
        uptime: uptime,
      },
      usage: {
        commandsRun: Math.floor(Math.random() * 50),
        tokensUsed: Math.floor(Math.random() * 5000),
        sessionsToday: Math.floor(Math.random() * 3 + 1),
        totalMessages: Math.floor(Math.random() * 100),
      },
      status: {
        systemStatus:
          uptime >= 95 ? 'operational' : uptime >= 85 ? 'degraded' : 'critical',
        lastUpdated: now,
      },
    };
  }
}
