---
trigger: glob
globs: libs/frontend/dashboard/**/*.ts
---

# dashboard - Performance Dashboard & Analytics

**Active**: Working in `libs/frontend/dashboard/**/*.ts`

## Purpose

The **dashboard library** provides real-time performance monitoring and analytics for the Ptah Extension using Chart.js and signal-based reactive UI.

## Responsibilities

✅ **Real-Time Metrics**: Live session performance (cost, tokens, duration)  
✅ **Charts**: Time-series visualization (Chart.js)  
✅ **Agent Performance**: Execution time and success rate tracking  
✅ **Activity Feed**: Recent activity timeline

❌ **NOT**: Chat UI (→ chat), Session storage (→ chat ChatStore)

## Services

```
libs/frontend/dashboard/src/lib/
├── components/
│   ├── dashboard-view.component.ts
│   ├── metrics-overview.component.ts
│   ├── cost-chart.component.ts
│   └── agent-performance-table.component.ts
└── services/
    ├── dashboard-state.service.ts
    └── metrics-aggregator.service.ts
```

## DashboardStateService

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardStateService {
  private readonly chatStore = inject(ChatStore);
  private readonly metricsAggregator = inject(MetricsAggregatorService);

  // Private state
  private readonly _timeRange = signal<TimeRange>('7d');

  // Public readonly signals
  readonly timeRange = this._timeRange.asReadonly();
  readonly sessions = this.chatStore.allSessions;

  // Computed metrics
  readonly totalCost = computed(() => {
    return this.metricsAggregator.calculateTotalCost(this.sessions());
  });

  readonly tokenUsage = computed(() => {
    return this.metricsAggregator.calculateTokenUsage(this.sessions());
  });

  readonly agentPerformance = computed(() => {
    return this.metricsAggregator.calculateAgentPerformance(this.sessions());
  });

  setTimeRange(range: TimeRange): void {
    this._timeRange.set(range);
  }
}
```

## MetricsAggregatorService

```typescript
@Injectable({ providedIn: 'root' })
export class MetricsAggregatorService {
  calculateTotalCost(sessions: Session[]): number {
    return sessions.reduce((sum, session) => {
      return sum + session.messages.reduce((msgSum, msg) => msgSum + (msg.cost || 0), 0);
    }, 0);
  }

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

  calculateAgentPerformance(sessions: Session[]): AgentPerformanceMetrics[] {
    const agentMap = new Map<string, AgentStats>();

    for (const session of sessions) {
      for (const message of session.messages) {
        if (message.type === 'agent-spawn') {
          const stats = agentMap.get(message.agentName) || {
            totalExecutions: 0,
            totalDuration: 0,
            successCount: 0,
          };
          stats.totalExecutions++;
          stats.totalDuration += message.duration || 0;
          if (message.status === 'success') stats.successCount++;
          agentMap.set(message.agentName, stats);
        }
      }
    }

    return Array.from(agentMap.entries()).map(([name, stats]) => ({
      agentName: name,
      averageDuration: stats.totalDuration / stats.totalExecutions,
      successRate: stats.successCount / stats.totalExecutions,
    }));
  }
}
```

## CostChartComponent

```typescript
@Component({
  selector: 'ptah-cost-chart',
  template: `<div class="chart-container"><canvas #chartCanvas></canvas></div>`,
})
export class CostChartComponent implements AfterViewInit, OnDestroy {
  @ViewChild('chartCanvas') chartCanvas!: ElementRef<HTMLCanvasElement>;
  readonly data = input.required<TimeSeriesData[]>();
  private chart?: Chart;

  ngAfterViewInit(): void {
    this.chart = new Chart(this.chartCanvas.nativeElement, {
      type: 'line',
      data: this.transformData(this.data()),
      options: { responsive: true },
    });

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

  private transformData(data: TimeSeriesData[]): ChartData {
    return {
      labels: data.map((d) => d.timestamp),
      datasets: [
        {
          label: 'Cost ($)',
          data: data.map((d) => d.cost),
          borderColor: 'rgb(75, 192, 192)',
        },
      ],
    };
  }
}
```

## Rules

1. **Signal-Based Charts** - Chart data MUST be computed signals
2. **Centralized Aggregation** - Use MetricsAggregatorService for calculations
3. **Chart Cleanup** - Destroy charts in ngOnDestroy
4. **Lazy Loading** - Dashboard MUST be lazy-loaded
5. **DaisyUI Classes** - Use DaisyUI table, card, stat classes

## Commands

```bash
nx test dashboard
nx typecheck dashboard
nx build dashboard
```
