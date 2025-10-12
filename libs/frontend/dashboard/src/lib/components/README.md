# Dashboard Library - Components

**Library**: `@ptah-extension/frontend/dashboard`  
**Purpose**: Main dashboard UI components for Ptah extension webview

---

## 📂 Component Organization

All dashboard components follow Angular 20+ standalone component patterns with signal-based APIs.

### Folder Structure

```text
libs/frontend/dashboard/src/lib/components/
├── header/                    # Dashboard header
│   ├── header.component.ts
│   ├── header.component.html
│   ├── header.component.css
│   └── header.component.spec.ts
├── metrics-grid/             # Metrics grid display
│   ├── metrics-grid.component.ts
│   ├── metrics-grid.component.html
│   ├── metrics-grid.component.css
│   └── metrics-grid.component.spec.ts
├── activity-feed/            # Activity feed display
│   ├── activity-feed.component.ts
│   ├── activity-feed.component.html
│   ├── activity-feed.component.css
│   └── activity-feed.component.spec.ts
├── performance-chart/        # Performance chart display
│   ├── performance-chart.component.ts
│   ├── performance-chart.component.html
│   ├── performance-chart.component.css
│   └── performance-chart.component.spec.ts
└── README.md (this file)
```

---

## 🎯 Component Inventory

### Container Components

**Managed in** `libs/frontend/dashboard/src/lib/containers/`

1. **DashboardComponent**
   - **Purpose**: Orchestrates dashboard layout, fetches data, manages refresh
   - **State**: Dashboard metrics, activity feed, performance data
   - **Dependencies**: Core DashboardService, AnalyticsService, VSCodeService
   - **Migration Status**: 🔄 Pending extraction from monolithic app
   - **LOC**: ~120

### Presentational Components

**Managed in this directory**

1. **HeaderComponent**

   - **Purpose**: Display dashboard title, refresh button, settings link
   - **Inputs**: `lastUpdated: Signal<Date>`, `isRefreshing: Signal<boolean>`
   - **Outputs**: `refreshRequested: OutputEmitterRef<void>`, `settingsClicked: OutputEmitterRef<void>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~250

2. **MetricsGridComponent**

   - **Purpose**: Display key metrics in card grid layout
   - **Inputs**: `metrics: Signal<DashboardMetrics>`, `isLoading: Signal<boolean>`
   - **Outputs**: `metricClicked: OutputEmitterRef<string>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~300

3. **ActivityFeedComponent**

   - **Purpose**: Display recent activity timeline
   - **Inputs**: `activities: Signal<Activity[]>`, `isLoading: Signal<boolean>`
   - **Outputs**: `activityClicked: OutputEmitterRef<string>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~320

4. **PerformanceChartComponent**
   - **Purpose**: Display performance metrics chart
   - **Inputs**: `performanceData: Signal<PerformanceData>`, `chartType: Signal<ChartType>`
   - **Outputs**: `chartInteraction: OutputEmitterRef<ChartInteractionEvent>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~230

---

## 🚀 Modern Angular Patterns

### Signal-Based APIs

All components use modern signal APIs:

```typescript
import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';

@Component({
  selector: 'app-metrics-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
export class MetricsGridComponent {
  // Modern signal inputs
  readonly metrics = input.required<DashboardMetrics>();
  readonly isLoading = input<boolean>(false);

  // Modern signal outputs
  readonly metricClicked = output<string>();

  // Computed values
  readonly gridColumns = computed(() => this.calculateColumns(this.metrics()));
}
```

### Modern Control Flow

All templates use `@if`, `@for`, `@switch`:

```html
<!-- Modern control flow syntax -->
@if (isLoading()) {
<app-loading-spinner />
} @else {
<div class="metrics-grid" [style.grid-template-columns]="gridColumns()">
  @for (metric of metrics().items; track metric.id) {
  <div class="metric-card" (click)="onMetricClick(metric.id)">
    <h3>{{ metric.label }}</h3>
    <p class="value">{{ metric.value }}</p>
    <p class="change">{{ metric.change }}</p>
  </div>
  }
</div>
}
```

### OnPush Change Detection

All components require OnPush for performance:

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush, // MANDATORY
})
```

---

## 📝 Naming Conventions

### Component Selectors

- **Prefix**: `app-` (standard Angular convention)
- **Format**: `kebab-case`
- **Examples**: `app-header`, `app-metrics-grid`, `app-activity-feed`, `app-performance-chart`

### File Naming

- **Component**: `{name}.component.ts`
- **Template**: `{name}.component.html`
- **Styles**: `{name}.component.css`
- **Tests**: `{name}.component.spec.ts`

### Class Naming

- **Format**: `PascalCase` with `Component` suffix
- **Examples**: `HeaderComponent`, `MetricsGridComponent`, `ActivityFeedComponent`, `PerformanceChartComponent`

---

## 🧪 Testing Strategy

### Unit Tests

Each component has comprehensive unit tests:

```typescript
describe('MetricsGridComponent', () => {
  it('should emit metricClicked when metric card is clicked', () => {
    const component = harness.componentInstance;
    const emitSpy = jest.spyOn(component.metricClicked, 'emit');

    component.onMetricClick('total-sessions');

    expect(emitSpy).toHaveBeenCalledWith('total-sessions');
  });

  it('should calculate grid columns based on metric count', () => {
    const component = harness.componentInstance;
    component.metrics.set({ items: [{ id: '1' }, { id: '2' }, { id: '3' }] });

    expect(component.gridColumns()).toBe('repeat(3, 1fr)');
  });
});
```

### Coverage Requirements

- **Lines**: ≥80%
- **Branches**: ≥80%
- **Functions**: ≥80%
- **Statements**: ≥80%

---

## 🔄 Migration Checklist

When extracting components from monolithic app:

- [ ] Copy component files to appropriate library folder
- [ ] Convert `@Input()` → `input<T>()`
- [ ] Convert `@Output()` → `output<T>()`
- [ ] Convert `@ViewChild()` → `viewChild<T>()`
- [ ] Replace `*ngIf` → `@if`
- [ ] Replace `*ngFor` → `@for`
- [ ] Replace `*ngSwitch` → `@switch`
- [ ] Add `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Update imports to use `@ptah-extension/shared` types
- [ ] Migrate component tests
- [ ] Export from `libs/frontend/dashboard/src/index.ts`
- [ ] Update consuming components to import from `@ptah-extension/frontend/dashboard`
- [ ] Verify `nx build frontend-dashboard` succeeds
- [ ] Verify all tests pass with ≥80% coverage

---

## 📚 Related Documentation

- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`
- **Shared Types**: `libs/shared/src/lib/types/`

---

**Last Updated**: October 12, 2025  
**Components**: 4 presentational (Header, MetricsGrid, ActivityFeed, PerformanceChart)  
**Migration Status**: 🔄 Pending extraction from monolithic app
