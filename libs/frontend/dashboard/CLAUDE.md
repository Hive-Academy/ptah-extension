# libs/frontend/dashboard - Performance Dashboard UI

## Purpose

Real-time performance monitoring and analytics visualization with comprehensive metrics display, historical trends, and system activity feed.

## Components (5 total)

- **DashboardComponent** (`containers/dashboard/`): Smart container with analytics integration
- **DashboardHeaderComponent**: Title bar with expand/collapse/refresh actions
- **DashboardMetricsGridComponent**: 4-8 metric cards (response time, memory, throughput, success rate)
- **DashboardPerformanceChartComponent**: Historical performance visualization (20 data points)
- **DashboardActivityFeedComponent**: Recent system events list

## Quick Start

```typescript
import { DashboardComponent } from '@ptah-extension/dashboard';

@Component({
  imports: [DashboardComponent],
})
export class AppComponent {
  config = {
    displayMode: 'panel',
    showSessionCards: true,
    enableQuickActions: true,
    maxVisibleSessions: 12,
  };
}
```

## Metrics Tracked

**Performance**:

- Response Time (ms)
- Memory Usage (MB)
- Throughput (messages/min)
- Success Rate (%)

**Usage** (expanded mode):

- Commands Executed
- Tokens Consumed
- Total Messages
- Sessions Today

## Status Classification

- **Excellent**: Latency <500ms, Memory <50%, Success ≥99%
- **Good**: Latency <1000ms, Memory <70%, Success ≥95%
- **Warning**: Latency <2000ms, Memory <85%, Success ≥85%
- **Critical**: Beyond thresholds

## Dependencies

- `@ptah-extension/core`: ChatService, AnalyticsService, LoggingService
- `@ptah-extension/shared`: Types (DashboardMetrics, PerformanceData, ActivityItem)
- `lucide-angular`: Icons

## Display Modes

- **Inline**: Header + 4 metrics (compact)
- **Expanded**: Header + 8 metrics + chart + activity feed

## Testing

```bash
nx test dashboard
```

## File Locations

- **Container**: `src/lib/containers/dashboard/`
- **Components**: `src/lib/components/*/`
- **Entry**: `src/index.ts`
