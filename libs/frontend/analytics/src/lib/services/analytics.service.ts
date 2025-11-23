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

import { Injectable } from '@angular/core';

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
  // All functionality removed - will be replaced with RPC pattern in phase 2
}
