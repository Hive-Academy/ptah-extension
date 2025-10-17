# libs/frontend/shared-ui - Reusable UI Component Library

## Purpose

Reusable Angular 20+ UI component library with VS Code theming, accessibility compliance, and signal-based reactivity.

## Components (12 total)

**Forms**:

- `InputComponent`: Text input/textarea with search, clear, send actions
- `InputIconComponent`: Clickable/static icons
- `ActionButtonComponent`: Icon-only buttons with gradients
- `ValidationMessageComponent`: Error/helper text
- `DropdownComponent`: Full dropdown with search and options
- `DropdownTriggerComponent`: Dropdown button
- `DropdownSearchComponent`: Search input
- `DropdownOptionsListComponent`: Scrollable options

**UI Presentation**:

- `LoadingSpinnerComponent`: Loading indicator with optional message
- `StatusBarComponent`: Footer with connection/workspace info

**Layout**:

- `SimpleHeaderComponent`: App header with logo and actions

**Overlays**:

- `PermissionPopupComponent`: Modal dialog for permissions
- `CommandBottomSheetComponent`: Quick command cards

## Quick Start

```typescript
import { InputComponent, DropdownComponent, LoadingSpinnerComponent } from '@ptah-extension/shared-ui';

@Component({
  imports: [InputComponent, DropdownComponent],
})
export class MyComponent {}
```

## Design System

**VS Code Native Styling**:

- 100% CSS custom properties (`--vscode-*`)
- Auto-adapts to dark/light/high-contrast themes
- No Tailwind or custom color palette

**Accessibility**:

- WCAG 2.1 AA compliant
- Semantic HTML5
- ARIA labels and roles
- Keyboard navigation
- Screen reader support

## Form Integration

Components implementing `ControlValueAccessor`:

- `InputComponent` (ngModel compatible)
- `DropdownComponent` (ngModel compatible)

## Signal Patterns

```typescript
// Input signals
readonly placeholder = input<string>('');
readonly disabled = input<boolean>(false);

// Output signals
readonly focused = output<void>();
readonly sendClick = output<void>();

// Computed
readonly hasError = computed(() => this.errorMessage().length > 0);
```

## Dependencies

- `@ptah-extension/shared`: DropdownOption, WorkspaceInfo types
- Angular 20 (CommonModule, FormsModule)
- lucide-angular (icons)

## Testing

```bash
nx test shared-ui
```

## File Locations

- **Forms**: `src/lib/forms/*/`
- **UI**: `src/lib/ui/*/`
- **Layout**: `src/lib/layout/*/`
- **Overlays**: `src/lib/overlays/*/`
- **Entry**: `src/index.ts`
