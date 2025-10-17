# libs/frontend/providers - AI Provider Management UI

## Purpose

AI provider management UI components for configuring, selecting, and monitoring AI providers (Claude CLI, VS Code LM API) with real-time health status.

## Components (3 total)

- **ProviderManagerComponent** (`containers/`): Smart container managing provider state
- **ProviderSettingsComponent** (`components/`): Settings panel with capabilities, health, fallback config
- **ProviderSelectorDropdownComponent** (`components/`): Dropdown with status indicators

## Quick Start

```typescript
import { ProviderManagerComponent } from '@ptah-extension/providers';

@Component({
  imports: [ProviderManagerComponent],
})
export class AppComponent {}
```

## Provider Features

**Settings Panel**:

- Provider selection dropdown
- Health status (response time, uptime, last check)
- Capabilities display (streaming, file attachments, code generation, etc.)
- Fallback configuration (auto-switch on errors)
- Error display with recovery suggestions

**Provider Selector**:

- Status indicators (available/unavailable/error/initializing)
- Current provider highlighting
- Keyboard navigation
- Search/filter support

## Signal Patterns

```typescript
// Inputs
readonly availableProviders = input.required<ProviderInfo[]>();
readonly currentProvider = input<ProviderInfo | null>(null);
readonly providerHealth = input<Record<string, ProviderHealth>>({});

// Outputs
readonly providerSelected = output<string>();
readonly fallbackEnabledChange = output<boolean>();

// Computed
readonly isCurrentProviderHealthy = computed(() =>
  this.currentProvider()?.health.status === 'available'
);
```

## Dependencies

- `@ptah-extension/core`: ProviderService, LoggingService
- Angular 20 (CommonModule, FormsModule)

## Testing

```bash
nx test providers
```

## File Locations

- **Container**: `src/lib/containers/provider-manager.component.ts`
- **Components**: `src/lib/components/*.component.ts`
- **Entry**: `src/index.ts`
