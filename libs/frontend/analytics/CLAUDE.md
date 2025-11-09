# libs/frontend/analytics - Analytics Dashboard UI

## Purpose

Analytics dashboard UI components displaying usage statistics, system performance metrics, and chat session analytics.

## Components (4 total)

- **AnalyticsComponent** (`containers/analytics/`): Main container orchestrator
- **AnalyticsHeaderComponent**: Page title and description
- **AnalyticsStatsGridComponent**: Statistics cards grid (sessions, messages, tokens)
- **AnalyticsComingSoonComponent**: Placeholder for future features

## Quick Start

```typescript
import { AnalyticsComponent } from '@ptah-extension/analytics';

@Component({
  imports: [AnalyticsComponent],
})
export class AppComponent {}
```

## Statistics Displayed

- **Chat Sessions**: Today's session count
- **Messages Sent**: This week's message count
- **Tokens Used**: Total tokens consumed

## Signal Patterns

```typescript
// Input signals
readonly statsData = input.required<StatsData>();

// Computed
readonly todayStats = computed(() => this.statsData().todayStats);
```

## Dependencies

- `@ptah-extension/core`: AppStateManager, VSCodeService, LoggingService
- `@ptah-extension/shared-ui`: SimpleHeaderComponent
- `lucide-angular`: Icons (BarChart3Icon, ActivityIcon, TrendingUpIcon)

## Responsive Design

- Desktop (≥1024px): 3-column grid
- Tablet (768px-1024px): 3-column grid (smaller cards)
- Mobile (<480px): 1-column stack

## Testing

```bash
nx test analytics
```

## File Locations

- **Container**: `src/lib/containers/analytics/`
- **Components**: `src/lib/components/*/`
- **Entry**: `src/index.ts`
