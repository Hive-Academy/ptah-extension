# apps/ptah-extension-webview - Angular Webview App

## Purpose

Angular 20+ standalone SPA providing the visual UI for Ptah extension with signal-based navigation and VS Code theming.

## Architecture

**Signal-Based Navigation** (NO Angular Router):

- Pure signal switching via `WebviewNavigationService`
- Direct component rendering with `@switch` control flow
- No URL manipulation (VS Code constraint)

**Zoneless Change Detection**:

- `provideZonelessChangeDetection()` for 30% performance boost
- OnPush strategy on all components
- Signal-based reactivity throughout

## Key Files

- **App Component** (`src/app/app.ts`): Root container with view switching
- **App Config** (`src/app/app.config.ts`): Angular providers, zoneless setup
- **Main** (`src/main.ts`): Bootstrap entry point

## View Components

```
@switch (appState.currentView()) {
  @case ('chat') { <ptah-chat /> }
  @case ('analytics') { <ptah-analytics /> }
}
```

Imports from feature libraries:

- `@ptah-extension/chat`: ChatComponent
- `@ptah-extension/analytics`: AnalyticsComponent
- `@ptah-extension/shared-ui`: LoadingSpinnerComponent

## Dependencies

**Internal**:

- `@ptah-extension/core`: Services (AppStateManager, VSCodeService, etc.)
- `@ptah-extension/chat`: Chat UI
- `@ptah-extension/analytics`: Analytics dashboard
- `@ptah-extension/shared-ui`: Shared components

**External**:

- Angular 20.1.0 (standalone, signals, zoneless)
- lucide-angular (icons)
- RxJS (message streams)

## Development

```bash
npm run dev:webview        # Watch mode
npm run build:webview      # Production build
npm run lint:webview       # Lint
npm run test:webview       # Tests
```

## File Locations

- **App**: `src/app/app.ts`, `src/app/app.html`, `src/app/app.css`
- **Config**: `src/app/app.config.ts`
- **Main**: `src/main.ts`
- **Styles**: `src/styles.css`
