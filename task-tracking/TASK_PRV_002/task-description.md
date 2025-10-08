# Task Description - TASK_PRV_002

## User Request

Week 5 Provider Angular UI Integration - Provider selection and health monitoring components

## SMART Requirements

- Specific: Implement a standalone Angular component `ProviderPanelComponent` that lists available providers, shows health/status, and allows selecting a provider (manual override).
- Measurable: Component displays provider list, health badges, and emits `provider:switch` events. Unit tests cover component logic and interactions with a mocked `ProviderManager` service.
- Achievable: Reuse EventBus + ProviderManager observables from `@ptah-extension/backend` and shared types.
- Relevant: Completes Week 5 deliverable and provides UI for provider observability and control.
- Time-bound: Estimated 5 working days.

## Acceptance Criteria (BDD)

### Scenario 1: Provider List Renders

**Given** the provider manager has three providers registered
**When** the webview is opened
**Then** the `ProviderPanelComponent` renders three provider cards with name and health status

### Scenario 2: Provider Switch

**Given** a provider is selected in the UI
**When** the user clicks "Select"
**Then** the component emits `provider:switch` on EventBus and visual highlight updates

### Scenario 3: Health Monitoring

**Given** provider health updates from `ProviderManager.state$`
**When** health changes to `degraded` or `error`
**Then** the UI updates badge color and shows a tooltip with the error message

## Files to Create

- `apps/ptah-extension-webview/src/app/components/provider-panel/provider-panel.component.ts`
- `apps/ptah-extension-webview/src/app/components/provider-panel/provider-panel.component.html`
- `apps/ptah-extension-webview/src/app/components/provider-panel/provider-panel.component.spec.ts`
- `libs/frontend/shared-ui/src/lib/provider-badge` (optional small presentational component)

## Dependencies

- `@ptah-extension/shared` types
- `ProviderManager` backend messages (EventBus)
- Angular 20+ standalone components and Signals

## Out of Scope

- Deep analytics dashboards (deferred)
- Complex styling beyond a minimal, theme-compliant UI
