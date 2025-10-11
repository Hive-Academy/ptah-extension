# Shared UI Components

**Library**: `@ptah-extension/frontend/shared-ui`  
**Purpose**: Reusable Egyptian-themed Angular components used across feature libraries

---

## Component Organization Strategy

### 📁 Folder Structure

```text
components/
├── forms/              # Form input components
│   ├── input/
│   ├── dropdown/
│   ├── action-button/
│   └── validation-message/
├── ui/                 # UI elements
│   ├── loading-spinner/
│   ├── status-bar/
│   └── button/
├── layout/             # Layout components
│   ├── simple-header/
│   ├── card/
│   └── container/
└── overlays/           # Modal/popup components
    ├── permission-popup/
    └── command-bottom-sheet/
```

---

## Modern Angular Patterns (Angular 20+)

All components in this library follow these standards:

### ✅ Standalone Components

```typescript
@Component({
  selector: 'ptah-button',
  standalone: true,  // REQUIRED
  imports: [CommonModule],
  // ...
})
```

### ✅ Signal-Based APIs

```typescript
export class ButtonComponent {
  // Inputs using signals
  readonly label = input.required<string>();
  readonly variant = input<'primary' | 'secondary'>('primary');

  // Outputs using signals
  readonly clicked = output<void>();
}
```

### ✅ Modern Control Flow

```html
@if (isLoading()) {
<ptah-spinner />
} @else {
<button (click)="handleClick()">{{ label() }}</button>
}
```

### ✅ OnPush Change Detection

```typescript
@Component({
  // ...
  changeDetection: ChangeDetectionStrategy.OnPush,  // REQUIRED
})
```

---

## Component Guidelines

### Single Responsibility

Each component should have ONE clear purpose:

- ✅ `InputComponent` - Text input field with validation
- ✅ `DropdownComponent` - Dropdown selector
- ❌ `FormComponent` - Too broad, should be composed of smaller components

### Size Limits

- **Components**: < 100 lines (TypeScript)
- **Templates**: < 50 lines (HTML)
- **Styles**: < 100 lines (CSS)

If exceeding limits, decompose into smaller components.

### Accessibility (WCAG Compliance)

All components MUST:

- Use semantic HTML (`<button>`, `<input>`, `<select>`)
- Include ARIA labels where needed
- Support keyboard navigation
- Have sufficient color contrast
- Work with screen readers

### Egyptian Theming

Components use VS Code theme tokens for colors:

```css
.button {
  background: var(--vscode-button-background);
  color: var(--vscode-button-foreground);
  border: 1px solid var(--vscode-button-border);
}

.button:hover {
  background: var(--vscode-button-hoverBackground);
}
```

---

## Component API Design

### Input Naming

- Use descriptive names: `label`, `placeholder`, `options`, `isDisabled`
- Avoid abbreviations: `isLoading` not `loading`
- Boolean inputs start with `is`, `has`, `should`: `isVisible`, `hasError`

### Output Naming

- Use past tense for events: `clicked`, `changed`, `submitted`
- Avoid generic names: `itemSelected` not `select`

### Example

```typescript
@Component({
  selector: 'ptah-dropdown',
  // ...
})
export class DropdownComponent {
  // Inputs
  readonly options = input.required<DropdownOption[]>();
  readonly placeholder = input<string>('Select option');
  readonly isDisabled = input<boolean>(false);

  // Outputs
  readonly optionSelected = output<DropdownOption>();
  readonly dropdownOpened = output<void>();
  readonly dropdownClosed = output<void>();
}
```

---

## Testing Strategy

### Unit Tests

Each component must have:

- Snapshot tests for template structure
- Input signal tests (verify reactivity)
- Output signal tests (verify events emitted)
- Accessibility tests (keyboard navigation, ARIA)

### Example Test

```typescript
describe('ButtonComponent', () => {
  it('should emit clicked event when button clicked', () => {
    const fixture = TestBed.createComponent(ButtonComponent);
    const component = fixture.componentInstance;
    const clickedSpy = jasmine.createSpy('clicked');

    component.clicked.subscribe(clickedSpy);
    const button = fixture.nativeElement.querySelector('button');
    button.click();

    expect(clickedSpy).toHaveBeenCalled();
  });
});
```

---

## Performance Considerations

### OnPush + Signals = Optimal Performance

```typescript
@Component({
  changeDetection: ChangeDetectionStrategy.OnPush, // Only check when signals change
})
export class OptimizedComponent {
  readonly data = input.required<Data>(); // Signal input

  // Computed automatically updates when data() changes
  readonly displayText = computed(() => this.data().name.toUpperCase());
}
```

### Avoid

- ❌ Direct DOM manipulation
- ❌ Function calls in templates: `{{ getLabel() }}`
- ❌ Complex expressions in templates
- ❌ Mutable inputs (always use immutable data)

### Prefer

- ✅ Signals for reactive state
- ✅ Computed for derived values
- ✅ OnPush change detection
- ✅ Immutable input data

---

## Importing Shared Components

### In Feature Libraries

```typescript
import { ButtonComponent } from '@ptah-extension/frontend/shared-ui';

@Component({
  imports: [ButtonComponent],  // Import directly
  template: `<ptah-button label="Click Me" (clicked)="handleClick()" />`
})
```

### Barrel Exports

All components are exported via `libs/frontend/shared-ui/src/index.ts`:

```typescript
// Forms
export { InputComponent } from './lib/components/forms/input/input.component';
export { DropdownComponent } from './lib/components/forms/dropdown/dropdown.component';

// UI
export { ButtonComponent } from './lib/components/ui/button/button.component';
export { SpinnerComponent } from './lib/components/ui/loading-spinner/spinner.component';
```

---

## Migration Checklist

When extracting a component from monolithic app:

- [ ] Copy component file to appropriate folder
- [ ] Convert `@Input()` → `input<T>()`
- [ ] Convert `@Output()` → `output<T>()`
- [ ] Convert `@ViewChild()` → `viewChild<T>()`
- [ ] Replace `*ngIf` → `@if`
- [ ] Replace `*ngFor` → `@for`
- [ ] Replace `*ngSwitch` → `@switch`
- [ ] Add `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Add to barrel export in `index.ts`
- [ ] Migrate tests to same folder
- [ ] Update consuming components' imports
- [ ] Verify build passes
- [ ] Verify tests pass

---

**Last Updated**: October 11, 2025  
**Component Count**: 0 (ready for extraction)  
**Status**: Foundation setup complete, awaiting component extraction
