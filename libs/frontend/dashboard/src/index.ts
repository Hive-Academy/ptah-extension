// Quality Dashboard Components (TASK_2025_144 - Phase G Frontend)
export { QualityDashboardViewComponent } from './lib/components/quality/quality-dashboard-view.component';
export { QualityScoreCardComponent } from './lib/components/quality/quality-score-card.component';
export { QualityTrendChartComponent } from './lib/components/quality/quality-trend-chart.component';
export { AntiPatternDistributionComponent } from './lib/components/quality/anti-pattern-distribution.component';
export { QualityGapsTableComponent } from './lib/components/quality/quality-gaps-table.component';
export { QualityRecommendationsComponent } from './lib/components/quality/quality-recommendations.component';
export { QualityExportButtonComponent } from './lib/components/quality/quality-export-button.component';

// Quality Dashboard Services (TASK_2025_144 - Phase G Frontend)
export { QualityDashboardStateService } from './lib/services/quality-dashboard-state.service';

// Session Analytics Components (TASK_2025_206 v2)
export { SessionAnalyticsDashboardViewComponent } from './lib/components/session-analytics/session-analytics-dashboard-view.component';
export { MetricsCardsComponent } from './lib/components/session-analytics/metrics-cards.component';
export { SessionStatsCardComponent } from './lib/components/session-analytics/session-stats-card.component';

// Session Analytics Services (TASK_2025_206 v2)
export {
  SessionAnalyticsStateService,
  type DashboardSessionEntry,
  type AggregateTotals,
} from './lib/services/session-analytics-state.service';
