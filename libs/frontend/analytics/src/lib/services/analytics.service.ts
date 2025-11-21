/**
 * Analytics Service
 * Fetches real-time analytics data from backend via VSCodeService
 *
 * COMPLEXITY LEVEL: 1 (Simple)
 * - Single responsibility: Fetch analytics data
 * - Thin wrapper around VSCodeService
 * - No state management (component handles signals)
 *
 * PATTERN: Request-Response over Message Streams
 * - Send request via vscodeService.getAnalyticsData()
 * - Wait for response via onMessageType('analytics:getData:response')
 * - Convert Observable to Promise using firstValueFrom
 */

import { Injectable, inject } from '@angular/core';
import { VSCodeService } from '@ptah-extension/core';
import { ANALYTICS_RESPONSE_TYPES } from '@ptah-extension/shared';
import { firstValueFrom, timeout } from 'rxjs';

/**
 * Simplified analytics data interface
 * Maps comprehensive backend AnalyticsData to UI-specific metrics
 */
export interface AnalyticsData {
  todaySessions: number;
  weekMessages: number;
  totalTokens: number;
}

/**
 * Analytics Service
 * Provides real-time analytics data for the analytics dashboard
 */
@Injectable({ providedIn: 'root' })
export class AnalyticsService {
  private readonly vscodeService = inject(VSCodeService);

  /**
   * Fetch analytics data from backend.
   *
   * Maps comprehensive backend analytics to simplified UI metrics:
   * - todaySessions: activity.sessionsLast24h
   * - weekMessages: activity.messagesLast24h (approximation)
   * - totalTokens: workspace.contextTokenEstimate (approximation)
   *
   * @returns Promise resolving to analytics data
   * @throws Error if fetch fails, times out, or response invalid
   */
  async fetchAnalyticsData(): Promise<AnalyticsData> {
    try {
      // Send request to backend
      this.vscodeService.getAnalyticsData();

      // Wait for response (with 5 second timeout)
      const response = await firstValueFrom(
        this.vscodeService
          .onMessageType(ANALYTICS_RESPONSE_TYPES.GET_DATA)
          .pipe(timeout(5000))
      );

      // Validate response (MessageResponse with AnalyticsData)
      if (!response.success) {
        throw new Error(response.error?.message || 'Failed to fetch analytics');
      }

      if (!response.data) {
        throw new Error('Analytics data missing from response');
      }

      // Extract and map relevant metrics from comprehensive backend data
      // Backend returns full AnalyticsData structure from analyticsOrchestration.getAnalyticsData()
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const backendData = response.data as any;

      return {
        // Today's sessions from activity metrics
        todaySessions: backendData.activity?.sessionsLast24h || 0,
        // Week messages approximated from last 24h (multiply by 7 for weekly estimate)
        weekMessages: (backendData.activity?.messagesLast24h || 0) * 7,
        // Total tokens from workspace context estimate
        totalTokens: backendData.workspace?.contextTokenEstimate || 0,
      };
    } catch (error) {
      console.error('Analytics fetch error:', error);
      throw error;
    }
  }
}
