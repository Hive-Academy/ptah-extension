---
trigger: glob
globs: libs/frontend/**/*.ts
---

# ui - Shared UI Components (CDK Overlay)

**Active**: Working in `libs/frontend/ui/**/*.ts`

## Purpose

Reusable, accessible UI components built on Angular CDK Overlay. Solves keyboard navigation via portal rendering (dropdowns/popovers render at body level, outside component DOM).

## Responsibilities

✅ **Overlay Components**: Dropdown, Popover with portal rendering
✅ **Selection**: Option, Autocomplete with keyboard nav (ActiveDescendantKeyManager)
✅ **Accessibility**: WCAG 2.1 Level AA, ARIA patterns, FocusTrap
✅ **Focus Management**: Auto-return to trigger on close

❌ **NOT**: Business logic (→ core), domain components (→ chat/dashboard)

## Components

```
libs/frontend/ui/src/lib/
├── overlays/
│   ├── dropdown/              # Simple trigger-based dropdown
│   ├── popover/               # Modal-like popover with focus trap
│   └── shared/                #Position configs, types
├── selection/
│   ├── option/                # Selectable option (Highlightable)
│   └── autocomplete/          # Input-triggered suggestions
```

## Key Pattern: Portal Rendering

**Problem**: Dropdowns inside component DOM → keyboard events intercepted by parent (textarea)

**Solution**: CDK Overlay renders in portal at `<body>` level → events never touch parent

```
BEFORE:
document → textarea (intercepts Arrow) → dropdown handler ❌

AFTER (CDK Overlay):
document → cdk-overlay-container (at body) → dropdown handler ✅
```

## DropdownComponent

### Basic Usage

```typescript
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-dropdown [isOpen]="isOpen()" [closeOnBackdropClick]="true" (closed)="close()">
      <button trigger (click)="toggle()">Menu</button>

      <div content class="w-80">
        @for (item of items(); track item.id; let i = $index) {
        <ptah-option [optionId]="'item-' + i" [value]="item" (selected)="select($event)">
          {{ item.name }}
        </ptah-option>
        }
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent, OptionComponent],
})
export class MyComponent {
  private readonly _isOpen = signal(false);
  readonly isOpen = this._isOpen.asReadonly();

  toggle(): void {
    this._isOpen.set(!this._isOpen());
  }

  close(): void {
    this._isOpen.set(false);
  }

  select(item: Item): void {
    console.log('Selected:', item);
    this.close();
  }
}
```

### API

**Inputs**:

- `isOpen: Signal<boolean>` (required) - Open/close state
- `positions: ConnectedPosition[]` - Position strategy (default: below, fallback: above)
- `hasBackdrop: boolean` - Show backdrop (default: true)
- `backdropClass: BackdropClass` - Transparent or dark (default: transparent)
- `closeOnBackdropClick: boolean` - Auto-close on backdrop click (default: true)

**Outputs**:

- `opened: void` - Emitted when opened
- `closed: void` - Emitted when closed
- `backdropClicked: void` - Emitted on backdrop click

**Content Projection**:

- `[trigger]` - Element that triggers dropdown
- `[content]` - Dropdown content panel

## PopoverComponent

### Modal-Like Popover

```typescript
import { PopoverComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-popover [isOpen]="isOpen()" [position]="'above'" [hasBackdrop]="true" [backdropClass]="'cdk-overlay-dark-backdrop'" (closed)="close()">
      <button trigger (click)="toggle()">Settings</button>

      <div content class="w-96 p-6">
        <h3 class="text-lg font-bold mb-4">Settings</h3>
        <!-- Settings form -->
        <button (click)="save()">Save</button>
        <button (click)="close()">Cancel</button>
      </div>
    </ptah-popover>
  `,
  imports: [PopoverComponent],
})
export class SettingsComponent {}
```

### Differences from Dropdown

- **FocusTrap**: Focus trapped within popover (can't tab out)
- **Dark Backdrop**: Default dark backdrop for modal feel
- **Escape Key**: Auto-closes on Escape
- **Focus Return**: Returns focus to trigger on close

## OptionComponent

### Highlightable Interface

Implements `Highlightable` from `@angular/cdk/a11y` for ActiveDescendantKeyManager compatibility.

```typescript
import { Highlightable } from '@angular/cdk/a11y';

export class OptionComponent<T> implements Highlightable {
  // Managed by ActiveDescendantKeyManager
  isActive: boolean = false;

  setActiveStyles(): void {
    this.isActive = true;
    this.elementRef.nativeElement.scrollIntoView({
      block: 'nearest',
    });
  }

  setInactiveStyles(): void {
    this.isActive = false;
  }

  @HostBinding('class.active')
  get activeClass(): boolean {
    return this.isActive;
  }
}
```

### Custom Layout

```typescript
<ptah-option [optionId]="'opt-1'" [value]="model">
  <div class="flex items-center gap-3">
    <img [src]="model.icon" class="w-6 h-6" />
    <div class="flex-1">
      <div class="font-semibold">{{ model.name }}</div>
      <div class="text-xs text-base-content/60">
        {{ model.description }}
      </div>
    </div>
    @if (model.isRecommended) {
      <span class="badge badge-primary badge-sm">Recommended</span>
    }
  </div>
</ptah-option>
```

## AutocompleteComponent

### With Custom Template

```typescript
import { AutocompleteComponent, AutocompleteDirective } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-autocomplete [suggestions]="suggestions()" [isLoading]="isLoading()" [isOpen]="isOpen()" [headerTitle]="'Files'" [emptyMessage]="'No files found'" (suggestionSelected)="insert($event)" (closed)="close()">
      <input autocompleteInput type="text" [(ngModel)]="query" (input)="onInput($event)" (keydown)="onKeyDown($event)" />

      <ng-template suggestionTemplate let-file>
        <div class="flex items-center gap-2">
          <span class="text-xl">{{ getFileIcon(file.type) }}</span>
          <div class="flex-1">
            <div class="font-medium">{{ file.name }}</div>
            <div class="text-xs text-base-content/60">
              {{ file.path }}
            </div>
          </div>
        </div>
      </ng-template>
    </ptah-autocomplete>
  `,
  imports: [AutocompleteComponent, AutocompleteDirective, FormsModule],
})
export class FilePickerComponent {
  query = '';
  private readonly _suggestions = signal<FileSuggestion[]>([]);
  private readonly _isOpen = signal(false);

  readonly suggestions = this._suggestions.asReadonly();
  readonly isOpen = this._isOpen.asReadonly();

  onInput(event: Event): void {
    const query = (event.target as HTMLInputElement).value;
    const filtered = this.filterFiles(query);
    this._suggestions.set(filtered);
    this._isOpen.set(filtered.length > 0);
  }

  onKeyDown(event: KeyboardEvent): void {
    // Delegate to AutocompleteComponent
    const handled = this.autocomplete.onKeyDown(event);
    if (handled) {
      event.preventDefault();
    }
  }

  insert(file: FileSuggestion): void {
    this.insertAtCursor(`@${file.path}`);
    this.close();
  }
}
```

### Keyboard Navigation

AutocompleteComponent uses `ActiveDescendantKeyManager` for keyboard nav:

- **ArrowDown**: Move to next option
- **ArrowUp**: Move to previous option
- **Enter**: Select focused option
- **Escape**: Close autocomplete

**CRITICAL**: Focus stays on input element (accessibility pattern). Options highlighted via `aria-activedescendant`.

## Overlay Position Configs

### Pre-defined Positions

```typescript
import { DROPDOWN_POSITIONS, AUTOCOMPLETE_POSITIONS, POPOVER_POSITION_MAP } from '@ptah-extension/ui/overlays';

// Dropdown (8px gap)
const dropdown = DROPDOWN_POSITIONS;
// [
//   { originY: 'bottom', overlayY: 'top', offsetY: 8 },  // Below
//   { originY: 'top', overlayY: 'bottom', offsetY: -8 }  // Above
// ]

// Autocomplete (4px gap)
const autocomplete = AUTOCOMPLETE_POSITIONS;

// Popover (map by direction)
const above = POPOVER_POSITION_MAP.above;
const below = POPOVER_POSITION_MAP.below;
const before = POPOVER_POSITION_MAP.before;
const after = POPOVER_POSITION_MAP.after;
```

### Custom Positions

```typescript
import { ConnectedPosition } from '@angular/cdk/overlay';

const customPositions: ConnectedPosition[] = [
  {
    originX: 'end',
    originY: 'bottom',
    overlayX: 'end',
    overlayY: 'top',
    offsetY: 12
  }
];

<ptah-dropdown [positions]="customPositions">
```

## Migration from DaisyUI

### Before (DaisyUI Dropdown)

```typescript
<div class="dropdown dropdown-end">
  <button tabindex="0">{{ currentModel }}</button>
  <div tabindex="0" class="dropdown-content">
    @for (model of models(); track model.id) {
      <button (click)="select(model)">{{ model.name }}</button>
    }
  </div>
</div>
```

**Problems**:

- ❌ No keyboard navigation
- ❌ Manual blur() to close
- ❌ Accessibility issues

### After (CDK Overlay)

```typescript
<ptah-dropdown [isOpen]="isOpen()" (closed)="close()">
  <button trigger (click)="toggle()">{{ currentModel }}</button>
  <div content>
    @for (model of models(); track model.id; let i = $index) {
      <ptah-option [optionId]="'m-'+i" [value]="model"
        (selected)="select($event)">
        {{ model.name }}
      </ptah-option>
    }
  </div>
</ptah-dropdown>
```

**Benefits**:

- ✅ Keyboard navigation (Arrow keys, Enter)
- ✅ Auto-close on backdrop
- ✅ ARIA compliant
- ✅ No manual blur()

## Testing

### Component Test

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { DropdownComponent } from './dropdown.component';
import { signal } from '@angular/core';

describe('DropdownComponent', () => {
  let component: DropdownComponent;
  let fixture: ComponentFixture<DropdownComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [DropdownComponent],
    }).compileComponents();

    fixture = TestBed.createComponent(DropdownComponent);
    component = fixture.componentInstance;

    // Set required input
    fixture.componentRef.setInput('isOpen', signal(true));
    fixture.detectChanges();
  });

  it('should emit closed when backdrop clicked', () => {
    const spy = jest.fn();
    component.closed.subscribe(spy);

    component.onBackdropClick();

    expect(spy).toHaveBeenCalled();
  });
});
```

## Rules

1. **ALL overlays use CDK** - Portal rendering (not inline DOM)
2. **Signal-based open/close** - `isOpen: Signal<boolean>`
3. **Content projection** - `[trigger]` and `[content]`
4. **Keyboard accessible** - ActiveDescendantKeyManager for lists
5. **DaisyUI styling** - Use utility classes for theming

## Commands

```bash
nx test ui
nx build ui
nx typecheck ui
```
