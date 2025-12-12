# libs/frontend/dashboard - Performance Dashboard & Analytics

[Back to Main](../../../CLAUDE.md)

## Purpose

The **dashboard library** provides real-time performance monitoring and analytics visualization for the Ptah Extension. It tracks session metrics, token usage, cost analysis, and agent performance with historical trend analysis.

## Key Responsibilities

- **Real-Time Metrics**: Live session performance monitoring
- **Historical Trends**: Time-series charts for usage patterns
- **Cost Analysis**: Token cost tracking and budget alerts
- **Agent Performance**: Agent execution time and success rate tracking
- **Activity Feed**: Recent activity timeline with filtering
- **Export Reports**: CSV/JSON export for external analysis

## Architecture

```
libs/frontend/dashboard/src/lib/
├── components/
│   ├── dashboard-view.component.ts        # Main dashboard layout
│   ├── metrics-overview.component.ts      # Key metrics cards
│   ├── session-timeline.component.ts      # Session history timeline
│   ├── cost-chart.component.ts            # Cost trend visualization
│   ├── token-usage-chart.component.ts     # Token consumption chart
│   ├── agent-performance-table.component.ts # Agent stats table
│   └── activity-feed.component.ts         # Recent activity list
│
└── services/
    ├── dashboard-state.service.ts         # Dashboard state management
    └── metrics-aggregator.service.ts      # Metric calculation & aggregation
```

## Critical Design Decisions

### 1. Signal-Based Reactive Charts

**All chart data computed from signals for automatic updates.**

```typescript
@Component({
  selector: 'ptah-cost-chart',
  template: `
    <div class="chart-container">
      <canvas #chart></canvas>
    </div>
  `,
})
export class CostChartComponent implements OnInit, AfterViewInit {
  private readonly dashboardState = inject(DashboardStateService);

  @ViewChild('chart') chartCanvas!: ElementRef<HTMLCanvasElement>;

  // Computed signal for chart data
  readonly chartData = computed(() => {
    const sessions = this.dashboardState.sessions();
    return this.aggregateCostData(sessions);
  });

  ngAfterViewInit(): void {
    // Create chart with reactive data
    const chart = new Chart(this.chartCanvas.nativeElement, {
      type: 'line',
      data: this.chartData(),
      options: {
        /* ... */
      },
    });

    // Update chart when data changes
    effect(() => {
      chart.data = this.chartData();
      chart.update();
    });
  }
}
```

### 2. MetricsAggregator: Centralized Calculation

**Single service for all metric computations.**

```typescript
@Injectable({ providedIn: 'root' })
export class MetricsAggregatorService {
  // Aggregate cost metrics
  calculateTotalCost(sessions: Session[]): number {
    return sessions.reduce((sum, session) => {
      return sum + session.messages.reduce((msgSum, msg) => msgSum + (msg.cost || 0), 0);
    }, 0);
  }

  // Calculate token usage
  calculateTokenUsage(sessions: Session[]): TokenMetrics {
    return sessions.reduce(
      (metrics, session) => ({
        inputTokens: metrics.inputTokens + session.totalInputTokens,
        outputTokens: metrics.outputTokens + session.totalOutputTokens,
        totalTokens: metrics.totalTokens + session.totalInputTokens + session.totalOutputTokens,
      }),
      { inputTokens: 0, outputTokens: 0, totalTokens: 0 }
    );
  }

  // Agent performance stats
  calculateAgentPerformance(sessions: Session[]): AgentPerformanceMetrics[] {
    const agentMap = new Map<string, AgentStats>();

    for (const session of sessions) {
      for (const message of session.messages) {
        if (message.type === 'agent-spawn') {
          const agentName = message.agentName;
          const stats = agentMap.get(agentName) || {
            totalExecutions: 0,
            totalDuration: 0,
            totalCost: 0,
            successCount: 0,
          };

          stats.totalExecutions++;
          stats.totalDuration += message.duration || 0;
          stats.totalCost += message.cost || 0;
          if (message.status === 'success') stats.successCount++;

          agentMap.set(agentName, stats);
        }
      }
    }

    return Array.from(agentMap.entries()).map(([name, stats]) => ({
      agentName: name,
      averageDuration: stats.totalDuration / stats.totalExecutions,
      successRate: stats.successCount / stats.totalExecutions,
      totalCost: stats.totalCost,
    }));
  }

  // Time-series aggregation for charts
  aggregateByTimeRange(sessions: Session[], timeRange: TimeRange): TimeSeriesData[] {
    const buckets = this.createTimeBuckets(timeRange);

    for (const session of sessions) {
      const bucket = this.findBucket(session.startTime, buckets);
      bucket.cost += session.totalCost;
      bucket.tokens += session.totalInputTokens + session.totalOutputTokens;
      bucket.sessionCount++;
    }

    return buckets;
  }
}
```

### 3. DashboardStateService: Centralized Dashboard State

**Signal-based state for dashboard metrics.**

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  private readonly chatStore = inject(ChatStore);
  private readonly metricsAggregator = inject(MetricsAggregatorService);

  // Private state
  private readonly _timeRange = signal<TimeRange>('7d');
  private readonly _selectedMetric = signal<MetricType>('cost');

  // Public readonly signals
  readonly timeRange = this._timeRange.asReadonly();
  readonly selectedMetric = this._selectedMetric.asReadonly();

  // Computed metrics (reactive)
  readonly sessions = this.chatStore.allSessions; // From ChatStore

  readonly totalCost = computed(() => {
    return this.metricsAggregator.calculateTotalCost(this.sessions());
  });

  readonly tokenUsage = computed(() => {
    return this.metricsAggregator.calculateTokenUsage(this.sessions());
  });

  readonly agentPerformance = computed(() => {
    return this.metricsAggregator.calculateAgentPerformance(this.sessions());
  });

  readonly timeSeriesData = computed(() => {
    return this.metricsAggregator.aggregateByTimeRange(this.sessions(), this.timeRange());
  });

  // State updates
  setTimeRange(range: TimeRange): void {
    this._timeRange.set(range);
  }

  setSelectedMetric(metric: MetricType): void {
    this._selectedMetric.set(metric);
  }
}
```

### 4. Real-Time Activity Feed

**Live activity stream with signal-based updates.**

```typescript
@Component({
  selector: 'ptah-activity-feed',
  template: `
    <div class="activity-feed">
      <h3>Recent Activity</h3>

      <div class="filters">
        <button [class.active]="filter() === 'all'" (click)="setFilter('all')">All</button>
        <button [class.active]="filter() === 'sessions'" (click)="setFilter('sessions')">Sessions</button>
        <button [class.active]="filter() === 'agents'" (click)="setFilter('agents')">Agents</button>
      </div>

      <div class="activity-list">
        @for (activity of filteredActivities(); track activity.id) {
        <div class="activity-item">
          <span class="activity-icon">{{ activity.icon }}</span>
          <div class="activity-content">
            <div class="activity-title">{{ activity.title }}</div>
            <div class="activity-time">{{ activity.timestamp | relativeTime }}</div>
          </div>
        </div>
        }
      </div>
    </div>
  `,
})
export class ActivityFeedComponent {
  private readonly dashboardState = inject(DashboardStateService);

  readonly filter = signal<ActivityFilter>('all');

  readonly activities = computed(() => {
    return this.dashboardState.recentActivities();
  });

  readonly filteredActivities = computed(() => {
    const activities = this.activities();
    const filterType = this.filter();

    if (filterType === 'all') return activities;

    return activities.filter((activity) => activity.type === filterType);
  });

  setFilter(filter: ActivityFilter): void {
    this.filter.set(filter);
  }
}
```

---

## Key Components API Reference

### DashboardViewComponent

**Purpose**: Main dashboard layout with metrics overview and charts.

```typescript
@Component({
  selector: 'ptah-dashboard-view',
  standalone: true,
  template: `
    <div class="dashboard-container">
      <!-- Metrics Overview Cards -->
      <ptah-metrics-overview [totalCost]="totalCost()" [tokenUsage]="tokenUsage()" [sessionCount]="sessionCount()" />

      <!-- Time Range Selector -->
      <div class="time-range-selector">
        <button *ngFor="let range of timeRanges" [class.active]="timeRange() === range" (click)="setTimeRange(range)">
          {{ range | timeRangeLabel }}
        </button>
      </div>

      <!-- Charts Grid -->
      <div class="charts-grid">
        <ptah-cost-chart [data]="timeSeriesData()" />
        <ptah-token-usage-chart [data]="timeSeriesData()" />
      </div>

      <!-- Agent Performance Table -->
      <ptah-agent-performance-table [agents]="agentPerformance()" />

      <!-- Activity Feed -->
      <ptah-activity-feed />
    </div>
  `,
})
export class DashboardViewComponent {
  private readonly dashboardState = inject(DashboardStateService);

  readonly totalCost = this.dashboardState.totalCost;
  readonly tokenUsage = this.dashboardState.tokenUsage;
  readonly sessionCount = computed(() => this.dashboardState.sessions().length);
  readonly timeRange = this.dashboardState.timeRange;
  readonly timeSeriesData = this.dashboardState.timeSeriesData;
  readonly agentPerformance = this.dashboardState.agentPerformance;

  readonly timeRanges: TimeRange[] = ['24h', '7d', '30d', '90d'];

  setTimeRange(range: TimeRange): void {
    this.dashboardState.setTimeRange(range);
  }
}
```

### MetricsOverviewComponent

**Purpose**: Key metrics cards (cost, tokens, sessions).

```typescript
@Component({
  selector: 'ptah-metrics-overview',
  standalone: true,
  template: `
    <div class="metrics-grid">
      <div class="metric-card">
        <div class="metric-label">Total Cost</div>
        <div class="metric-value">\${{ totalCost() | number : '1.2-2' }}</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Token Usage</div>
        <div class="metric-value">{{ tokenUsage().totalTokens | number }}</div>
        <div class="metric-detail">Input: {{ tokenUsage().inputTokens | number }} | Output: {{ tokenUsage().outputTokens | number }}</div>
      </div>

      <div class="metric-card">
        <div class="metric-label">Sessions</div>
        <div class="metric-value">{{ sessionCount() }}</div>
      </div>
    </div>
  `,
})
export class MetricsOverviewComponent {
  readonly totalCost = input.required<number>();
  readonly tokenUsage = input.required<TokenMetrics>();
  readonly sessionCount = input.required<number>();
}
```

### CostChartComponent

**Purpose**: Cost trend line chart with Chart.js.

```typescript
@Component({
  selector: 'ptah-cost-chart',
  standalone: true,
  template: `
    <div class="chart-container">
      <h4>Cost Trend</h4>
      <canvas #chartCanvas></canvas>
    </div>
  `,
})
export class CostChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;

  readonly data = input.required<TimeSeriesData[]>();

  private chart?: Chart;

  ngAfterViewInit(): void {
    this.initializeChart();

    // Update chart when data changes
    effect(() => {
      if (this.chart) {
        this.chart.data = this.transformData(this.data());
        this.chart.update();
      }
    });
  }

  ngOnDestroy(): void {
    this.chart?.destroy();
  }

  private initializeChart(): void {
    this.chart = new Chart(this.chartCanvas.nativeElement, {
      type: 'line',
      data: this.transformData(this.data()),
      options: {
        responsive: true,
        plugins: {
          legend: { display: true },
          tooltip: { enabled: true },
        },
      },
    });
  }

  private transformData(data: TimeSeriesData[]): ChartData {
    return {
      labels: data.map((d) => d.timestamp),
      datasets: [
        {
          label: 'Cost ($)',
          data: data.map((d) => d.cost),
          borderColor: 'rgb(75, 192, 192)',
          tension: 0.1,
        },
      ],
    };
  }
}
```

### AgentPerformanceTableComponent

**Purpose**: Sortable table of agent performance metrics.

```typescript
@Component({
  selector: 'ptah-agent-performance-table',
  standalone: true,
  template: `
    <div class="table-container">
      <h4>Agent Performance</h4>

      <table class="table">
        <thead>
          <tr>
            <th (click)="sortBy('agentName')">Agent</th>
            <th (click)="sortBy('averageDuration')">Avg Duration</th>
            <th (click)="sortBy('successRate')">Success Rate</th>
            <th (click)="sortBy('totalCost')">Total Cost</th>
          </tr>
        </thead>
        <tbody>
          @for (agent of sortedAgents(); track agent.agentName) {
          <tr>
            <td>{{ agent.agentName }}</td>
            <td>{{ agent.averageDuration | number : '1.2-2' }}s</td>
            <td>{{ agent.successRate | percent }}</td>
            <td>\${{ agent.totalCost | number : '1.2-2' }}</td>
          </tr>
          }
        </tbody>
      </table>
    </div>
  `,
})
export class AgentPerformanceTableComponent {
  readonly agents = input.required<AgentPerformanceMetrics[]>();

  private readonly sortField = signal<keyof AgentPerformanceMetrics>('agentName');
  private readonly sortDirection = signal<'asc' | 'desc'>('asc');

  readonly sortedAgents = computed(() => {
    const agents = [...this.agents()];
    const field = this.sortField();
    const direction = this.sortDirection();

    return agents.sort((a, b) => {
      const aVal = a[field];
      const bVal = b[field];

      if (aVal < bVal) return direction === 'asc' ? -1 : 1;
      if (aVal > bVal) return direction === 'asc' ? 1 : -1;
      return 0;
    });
  });

  sortBy(field: keyof AgentPerformanceMetrics): void {
    if (this.sortField() === field) {
      // Toggle direction
      this.sortDirection.set(this.sortDirection() === 'asc' ? 'desc' : 'asc');
    } else {
      this.sortField.set(field);
      this.sortDirection.set('asc');
    }
  }
}
```

---

## Types & Interfaces

```typescript
export type TimeRange = '24h' | '7d' | '30d' | '90d';
export type MetricType = 'cost' | 'tokens' | 'sessions' | 'agents';
export type ActivityFilter = 'all' | 'sessions' | 'agents';

export interface TokenMetrics {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
}

export interface AgentPerformanceMetrics {
  agentName: string;
  averageDuration: number;
  successRate: number;
  totalCost: number;
}

export interface TimeSeriesData {
  timestamp: string;
  cost: number;
  tokens: number;
  sessionCount: number;
}

export interface ActivityItem {
  id: string;
  type: 'session' | 'agent';
  title: string;
  icon: string;
  timestamp: number;
}
```

---

## Boundaries

**Belongs Here**:

- Dashboard UI components (metrics, charts, tables)
- Performance visualization (cost trends, token usage)
- Activity feed and timeline
- Dashboard-specific state (DashboardStateService)
- Metric aggregation logic (MetricsAggregatorService)

**Does NOT Belong**:

- Chat UI (belongs in `@ptah-extension/chat`)
- Generic UI components (belongs in `@ptah-extension/ui`)
- Session data management (belongs in `@ptah-extension/chat` ChatStore)
- Application-level state (belongs in `@ptah-extension/core`)

---

## Dependencies

**Internal Libraries**:

- `@ptah-extension/shared` - Type contracts (Session, TokenMetrics)
- `@ptah-extension/chat` - ChatStore for session data access

**External Dependencies**:

- `@angular/core` (^20.1.2) - Component framework, signals
- `@angular/common` (^20.1.2) - NgFor, pipes
- `chart.js` (^4.4.7) - Chart rendering
- `date-fns` (^4.1.0) - Date formatting and manipulation

---

## Import Path

```typescript
import { DashboardViewComponent } from '@ptah-extension/dashboard';
import { MetricsOverviewComponent } from '@ptah-extension/dashboard';
import { CostChartComponent } from '@ptah-extension/dashboard';
import { DashboardStateService } from '@ptah-extension/dashboard';
import { MetricsAggregatorService } from '@ptah-extension/dashboard';
```

---

## Commands

```bash
# Test
nx test dashboard

# Typecheck
nx typecheck dashboard

# Lint
nx lint dashboard

# Build to ESM
nx build dashboard
```

---

## Guidelines

1. **Signal-Based Charts**: All chart data MUST be computed signals for automatic updates
2. **Centralized Aggregation**: Use MetricsAggregatorService for all metric calculations
3. **OnPush Change Detection**: All components use ChangeDetectionStrategy.OnPush
4. **DaisyUI Classes**: Use DaisyUI table, card, and stat classes
5. **Responsive Design**: All charts and tables MUST be responsive (mobile-first)
6. **Accessibility**: Proper ARIA labels for charts and interactive elements
7. **Performance**: Lazy-load dashboard view to avoid impacting chat performance
8. **Export Functionality**: Provide CSV/JSON export for all metrics
9. **Real-Time Updates**: Dashboard MUST update automatically when new sessions are created
10. **Error Handling**: Graceful fallbacks for missing or invalid data

---

## File Paths Reference

- **Components**: `src/lib/components/`
  - `dashboard-view.component.ts` - Main layout
  - `metrics-overview.component.ts` - Metric cards
  - `cost-chart.component.ts` - Cost trend chart
  - `token-usage-chart.component.ts` - Token usage chart
  - `agent-performance-table.component.ts` - Agent stats table
  - `activity-feed.component.ts` - Activity timeline
- **Services**: `src/lib/services/`
  - `dashboard-state.service.ts` - Dashboard state
  - `metrics-aggregator.service.ts` - Metric calculations
- **Entry Point**: `src/index.ts`
