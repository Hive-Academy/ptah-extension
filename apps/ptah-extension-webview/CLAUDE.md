# Ptah Extension - Angular Webview Application

↩️ [Back to Main](../../CLAUDE.md)

## Purpose

The **ptah-extension-webview** is the Angular 20+ single-page application (SPA) that provides the visual interface for the Ptah Extension inside VS Code webview panels. It delivers a rich, interactive GUI for AI-assisted development.

## Boundaries

**Belongs here**:

- Angular components and templates
- Webview-specific UI logic
- RPC service for extension communication
- Signal-based state management
- Routing and navigation (signal-based, no Angular Router)

**Does NOT belong**:

- VS Code extension logic (belongs in ptah-extension-vscode)
- Business logic (belongs in backend libraries)
- Type definitions (belongs in @ptah-extension/shared)
- Backend services (belongs in backend libraries)

## Key Files

### Entry Points

- `src/main.ts` - Angular bootstrap (zoneless configuration)
- `src/index.html` - HTML shell

### App Structure

- `src/app/app.component.ts` - Root component with navigation
- `src/app/app.config.ts` - Angular providers configuration

### Styles

- `src/styles.css` - Global styles (Tailwind + DaisyUI)
- `tailwind.config.js` - Tailwind configuration

### Configuration

- `project.json` - Nx Angular build configuration
- `tsconfig.app.json` - TypeScript configuration

## Architecture

```
┌──────────────────────────────────────────────────┐
│  Angular 20 Webview (Zoneless + Signals)         │
├──────────────────────────────────────────────────┤
│  app.component.ts (Root)                          │
│    ↓                                              │
│  Signal-Based Navigation (activeView$)            │
│    ↓                                              │
│  ┌────────────┬────────────┬──────────────────┐ │
│  │ Chat View  │ Dashboard  │ Setup Wizard ... │ │
│  └────────────┴────────────┴──────────────────┘ │
│    ↓            ↓            ↓                   │
│  Feature Library Components                      │
│  (@ptah-extension/chat, dashboard, setup-wizard) │
│    ↓                                              │
│  Core Services (@ptah-extension/core)            │
│  (AppStateManager, VSCodeService, ChatService)   │
│    ↓                                              │
│  RPC Layer ↔ Extension Host                      │
└──────────────────────────────────────────────────┘
```

## Dependencies

### Internal Frontend Libraries

- `@ptah-extension/core` - Core services and state management
- `@ptah-extension/chat` - Chat UI components
- `@ptah-extension/dashboard` - Performance dashboard
- `@ptah-extension/setup-wizard` - Agent setup wizard
- `@ptah-extension/ui` - Shared UI components
- `@ptah-extension/shared` - Type system (types only)

### External NPM Packages

- `@angular/core` v20.1 - Angular framework (zoneless)
- `@angular/common` - Common directives and pipes
- `@angular/forms` - Reactive forms
- `lucide-angular` - Icon library
- `daisyui` - UI component library (Tailwind-based)
- `tailwindcss` - Utility-first CSS framework
- `ngx-markdown` - Markdown rendering
- `marked` - Markdown parser
- `rxjs` - Reactive programming (limited use)

### Development Dependencies

- `@angular/cli` - Angular CLI
- `@nx/angular` - Nx Angular plugin
- `jest-preset-angular` - Jest testing

## Commands

```bash
# Development
npm run dev:webview              # Watch mode
nx serve ptah-extension-webview  # Dev server (port 4200)

# Build
npm run build:webview            # Production build
npm run build:webview:dev        # Development build
nx build ptah-extension-webview

# Quality Gates
npm run lint:webview             # Lint code
nx run ptah-extension-webview:typecheck
nx test ptah-extension-webview   # Run tests

# Serve Standalone (for development)
nx serve ptah-extension-webview --open
```

## Build Configuration

**Production Build**:

- Output: `dist/apps/ptah-extension-webview/browser/`
- Optimizations: Minification, tree-shaking, dead code elimination
- Source maps: Disabled
- Budget limits enforced

**Development Build**:

- Output: `dist/apps/ptah-extension-webview/browser/`
- Optimizations: Disabled
- Source maps: Enabled
- Fast rebuild

## Angular 20 Features

### Zoneless Change Detection

The app runs in **zoneless mode** for 30% performance improvement:

```typescript
// main.ts
bootstrapApplication(AppComponent, {
  providers: [
    provideExperimentalZonelessChangeDetection(), // No Zone.js!
    // ...
  ],
});
```

**Implications**:

- Use signals for reactive state
- Avoid manual `ChangeDetectorRef.detectChanges()`
- Components update automatically when signals change

### Signal-Based State

All state management uses Angular signals:

```typescript
// ✅ Correct - signals
readonly count = signal(0);
readonly items = signal<Item[]>([]);

// ❌ Wrong - avoid RxJS BehaviorSubject
// private count$ = new BehaviorSubject(0);
```

### No Angular Router

The app uses **signal-based navigation** instead of Angular Router (webview constraints):

```typescript
// app.component.ts
readonly activeView = signal<ViewType>('chat');

navigateToChat() {
  this.activeView.set('chat');
}
```

## Styling System

### Tailwind CSS + DaisyUI

```html
<!-- Use Tailwind utility classes -->
<div class="flex items-center gap-2 p-4">
  <!-- Use DaisyUI components -->
  <button class="btn btn-primary">Click Me</button>
</div>
```

### Theme Support

DaisyUI themes configured in `tailwind.config.js`:

- Light theme (default)
- Dark theme
- VS Code theme integration (via CSS variables)

## RPC Communication

### Sending Messages to Extension

```typescript
import { VSCodeService } from '@ptah-extension/core';

constructor(private vscode: VSCodeService) {}

async sendChat(message: string) {
  const response = await this.vscode.invoke('chat:send', { message });
  return response;
}
```

### Receiving Messages from Extension

```typescript
this.vscode.onMessage('chat:response', (payload) => {
  // Handle message from extension
  this.messages.update((msgs) => [...msgs, payload]);
});
```

## Development Workflow

### Standalone Development (Without Extension)

```bash
# Start dev server
nx serve ptah-extension-webview --open

# Mock VS Code API
# Use mock RPC service in development mode
```

### Integrated Development (With Extension)

```bash
# Terminal 1: Watch webview
npm run dev:webview

# Terminal 2: Watch extension
npm run dev:extension

# Press F5 to launch extension
```

## Guidelines

### Component Best Practices

```typescript
import { Component, signal } from '@angular/core';
import { CommonModule } from '@angular/common';

@Component({
  selector: 'ptah-my-component',
  standalone: true,
  imports: [CommonModule],
  templateUrl: './my-component.component.html',
  styleUrls: ['./my-component.component.css'],
})
export class MyComponent {
  // ✅ Use signals
  readonly count = signal(0);

  // ✅ Computed values
  readonly doubled = computed(() => this.count() * 2);

  // ✅ Effects for side effects
  constructor() {
    effect(() => {
      console.log('Count changed:', this.count());
    });
  }
}
```

### State Management

```typescript
// ✅ Local component state
readonly localState = signal({ ... });

// ✅ Shared state via services
constructor(
  private appState: AppStateManager,
  private chatService: ChatService
) {}

// ✅ Access signals from services
readonly messages = this.chatService.messages;
```

### Performance Optimization

1. **OnPush Strategy**: All components use OnPush (default in zoneless)
2. **TrackBy Functions**: Use trackBy in \*ngFor loops
3. **Lazy Loading**: Load features on demand
4. **Virtual Scrolling**: Use CDK virtual scroll for long lists

### Accessibility

1. **Semantic HTML**: Use proper HTML5 elements
2. **ARIA Labels**: Add aria-label where needed
3. **Keyboard Navigation**: Support Tab/Enter/Escape
4. **Focus Management**: Manage focus for modals/dropdowns

## Testing

```bash
# Unit tests
nx test ptah-extension-webview

# Watch mode
nx test ptah-extension-webview --watch

# Coverage
nx test ptah-extension-webview --coverage
```

### Testing Patterns

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';

describe('MyComponent', () => {
  let component: MyComponent;
  let fixture: ComponentFixture<MyComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [MyComponent], // Standalone component
    }).compileComponents();

    fixture = TestBed.createComponent(MyComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should update signal', () => {
    component.count.set(5);
    expect(component.doubled()).toBe(10);
  });
});
```

## Troubleshooting

**Signals not updating UI**:

- Ensure zoneless change detection enabled
- Use `.set()` or `.update()` to modify signals
- Check signal is readonly

**Styles not applying**:

- Verify Tailwind directives in styles.css
- Check component styleUrls path
- Rebuild after changing tailwind.config.js

**RPC not working**:

- Verify VS Code API mock in development
- Check message types match extension handlers
- Enable RPC debug logging

**Build errors**:

- Clear Nx cache: `nx reset`
- Delete node_modules/.cache
- Rebuild: `nx build ptah-extension-webview --skip-nx-cache`

## Related Documentation

- [VS Code Extension App](../ptah-extension-vscode/CLAUDE.md)
- [Core Library](../../libs/frontend/core/CLAUDE.md)
- [Chat Library](../../libs/frontend/chat/CLAUDE.md)
- [Shared Types](../../libs/shared/CLAUDE.md)
