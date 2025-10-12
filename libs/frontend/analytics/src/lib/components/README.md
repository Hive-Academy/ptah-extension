# Analytics Library - Components

**Library**: `@ptah-extension/frontend/analytics`  
**Purpose**: Analytics dashboard UI components for Ptah extension webview

---

## 📂 Component Organization

All analytics components follow Angular 20+ standalone component patterns with signal-based APIs.

### Folder Structure

```text
libs/frontend/analytics/src/lib/components/
├── analytics-header/          # Analytics dashboard header
│   ├── analytics-header.component.ts
│   ├── analytics-header.component.html
│   ├── analytics-header.component.css
│   └── analytics-header.component.spec.ts
├── stats-grid/               # Statistics grid display
│   ├── stats-grid.component.ts
│   ├── stats-grid.component.html
│   ├── stats-grid.component.css
│   └── stats-grid.component.spec.ts
├── coming-soon/              # Coming soon placeholder
│   ├── coming-soon.component.ts
│   ├── coming-soon.component.html
│   ├── coming-soon.component.css
│   └── coming-soon.component.spec.ts
└── README.md (this file)
```

---

## 🎯 Component Inventory

### Container Components

**Managed in** `libs/frontend/analytics/src/lib/containers/`

1. **AnalyticsComponent**
   - **Purpose**: Orchestrates analytics dashboard, fetches metrics, manages state
   - **State**: Analytics data, loading states, time range selection
   - **Dependencies**: Core AnalyticsService, VSCodeService
   - **Migration Status**: 🔄 Pending extraction from monolithic app
   - **LOC**: ~100

### Presentational Components

**Managed in this directory**

1. **AnalyticsHeaderComponent**

   - **Purpose**: Display analytics dashboard title, time range selector, export button
   - **Inputs**: `timeRange: Signal<TimeRange>`, `isLoading: Signal<boolean>`
   - **Outputs**: `timeRangeChanged: OutputEmitterRef<TimeRange>`, `exportRequested: OutputEmitterRef<void>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~100

2. **StatsGridComponent**

   - **Purpose**: Display analytics statistics in grid layout
   - **Inputs**: `stats: Signal<AnalyticsStats>`, `isLoading: Signal<boolean>`
   - **Outputs**: `statClicked: OutputEmitterRef<string>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~270

3. **ComingSoonComponent**
   - **Purpose**: Placeholder for future analytics features
   - **Inputs**: `featureName: Signal<string>`
   - **Outputs**: None
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~180

---

## 🚀 Modern Angular Patterns

### Signal-Based APIs

All components use modern signal APIs:

```typescript
import { Component, ChangeDetectionStrategy, input, output, signal, computed } from '@angular/core';

@Component({
  selector: 'app-stats-grid',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
export class StatsGridComponent {
  // Modern signal inputs
  readonly stats = input.required<AnalyticsStats>();
  readonly isLoading = input<boolean>(false);

  // Modern signal outputs
  readonly statClicked = output<string>();

  // Computed values
  readonly formattedStats = computed(() => this.formatStats(this.stats()));
}
```

### Modern Control Flow

All templates use `@if`, `@for`, `@switch`:

```html
<!-- Modern control flow syntax -->
@if (isLoading()) {
<app-loading-spinner />
} @else {
<div class="stats-grid">
  @for (stat of stats(); track stat.id) {
  <div class="stat-card" (click)="onStatClick(stat.id)">
    <h3>{{ stat.label }}</h3>
    <p>{{ stat.value }}</p>
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
- **Examples**: `app-analytics-header`, `app-stats-grid`, `app-coming-soon`

### File Naming

- **Component**: `{name}.component.ts`
- **Template**: `{name}.component.html`
- **Styles**: `{name}.component.css`
- **Tests**: `{name}.component.spec.ts`

### Class Naming

- **Format**: `PascalCase` with `Component` suffix
- **Examples**: `AnalyticsHeaderComponent`, `StatsGridComponent`, `ComingSoonComponent`

---

## 🧪 Testing Strategy

### Unit Tests

Each component has comprehensive unit tests:

```typescript
describe('StatsGridComponent', () => {
  it('should emit statClicked when stat card is clicked', () => {
    const component = harness.componentInstance;
    const emitSpy = jest.spyOn(component.statClicked, 'emit');

    component.onStatClick('total-sessions');

    expect(emitSpy).toHaveBeenCalledWith('total-sessions');
  });

  it('should compute formatted stats correctly', () => {
    const component = harness.componentInstance;
    component.stats.set({ totalSessions: 42, averageMessageCount: 15 });

    expect(component.formattedStats()).toEqual([
      { id: 'total-sessions', label: 'Total Sessions', value: '42' },
      { id: 'avg-messages', label: 'Avg Messages', value: '15' },
    ]);
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
- [ ] Export from `libs/frontend/analytics/src/index.ts`
- [ ] Update consuming components to import from `@ptah-extension/frontend/analytics`
- [ ] Verify `nx build frontend-analytics` succeeds
- [ ] Verify all tests pass with ≥80% coverage

---

## 📚 Related Documentation

- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`
- **Shared Types**: `libs/shared/src/lib/types/`

---

**Last Updated**: October 12, 2025  
**Components**: 3 presentational (AnalyticsHeader, StatsGrid, ComingSoon)  
**Migration Status**: 🔄 Pending extraction from monolithic app
