# Providers Library - Components

**Library**: `@ptah-extension/providers`  
**Purpose**: AI provider management UI components for Ptah extension webview

---

## 📂 Component Organization

All provider components follow Angular 20+ standalone component patterns with signal-based APIs.

### Folder Structure

```text
libs/frontend/providers/src/lib/components/
├── provider-settings/         # Provider configuration settings
│   ├── provider-settings.component.ts
│   ├── provider-settings.component.html
│   ├── provider-settings.component.css
│   └── provider-settings.component.spec.ts
├── provider-selector/         # Provider selection dropdown
│   ├── provider-selector.component.ts
│   ├── provider-selector.component.html
│   ├── provider-selector.component.css
│   └── provider-selector.component.spec.ts
└── README.md (this file)
```

---

## 🎯 Component Inventory

### Container Components

**Managed in** `libs/frontend/providers/src/lib/containers/`

1. **ProviderManagerComponent**
   - **Purpose**: Orchestrates provider settings, selection, and configuration
   - **State**: Active provider, available providers, provider status
   - **Dependencies**: Core ProviderService, VSCodeService
   - **Migration Status**: 🔄 Pending extraction from monolithic app
   - **LOC**: ~70

### Presentational Components

**Managed in this directory**

1. **ProviderSettingsComponent**

   - **Purpose**: Display and edit provider configuration (API keys, models, etc.)
   - **Inputs**: `provider: Signal<AIProvider>`, `config: Signal<ProviderConfig>`, `isEditing: Signal<boolean>`
   - **Outputs**: `configChanged: OutputEmitterRef<ProviderConfig>`, `saveRequested: OutputEmitterRef<void>`, `cancelRequested: OutputEmitterRef<void>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~630

2. **ProviderSelectorComponent**
   - **Purpose**: Dropdown for selecting active AI provider
   - **Inputs**: `providers: Signal<AIProvider[]>`, `activeProviderId: Signal<string>`, `isLoading: Signal<boolean>`
   - **Outputs**: `providerSelected: OutputEmitterRef<string>`
   - **Migration Status**: 🔄 Pending extraction
   - **LOC**: ~430

---

## 🚀 Modern Angular Patterns

### Signal-Based APIs

All components use modern signal APIs:

```typescript
import { Component, input, output, signal, computed } from '@angular/core';

@Component({
  selector: 'app-provider-settings',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // ...
})
export class ProviderSettingsComponent {
  // Modern signal inputs
  readonly provider = input.required<AIProvider>();
  readonly config = input.required<ProviderConfig>();
  readonly isEditing = input<boolean>(false);

  // Modern signal outputs
  readonly configChanged = output<ProviderConfig>();
  readonly saveRequested = output<void>();
  readonly cancelRequested = output<void>();

  // Internal state
  readonly formData = signal<ProviderConfig>(this.config());

  // Computed values
  readonly hasChanges = computed(() => JSON.stringify(this.formData()) !== JSON.stringify(this.config()));
}
```

### Modern Control Flow

All templates use `@if`, `@for`, `@switch`:

```html
<!-- Modern control flow syntax -->
@if (isEditing()) {
<form class="provider-settings-form">
  @for (field of provider().configFields; track field.name) {
  <div class="form-field">
    <label>{{ field.label }}</label>
    @switch (field.type) { @case ('text') {
    <input type="text" [value]="formData()[field.name]" (input)="onFieldChange(field.name, $event)" />
    } @case ('password') {
    <input type="password" [value]="formData()[field.name]" (input)="onFieldChange(field.name, $event)" />
    } @case ('select') {
    <select [value]="formData()[field.name]" (change)="onFieldChange(field.name, $event)">
      @for (option of field.options; track option.value) {
      <option [value]="option.value">{{ option.label }}</option>
      }
    </select>
    } }
  </div>
  }
  <div class="form-actions">
    <button (click)="onSave()" [disabled]="!hasChanges()">Save</button>
    <button (click)="onCancel()">Cancel</button>
  </div>
</form>
} @else {
<div class="provider-settings-view">
  <!-- Read-only view -->
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
- **Examples**: `app-provider-settings`, `app-provider-selector`

### File Naming

- **Component**: `{name}.component.ts`
- **Template**: `{name}.component.html`
- **Styles**: `{name}.component.css`
- **Tests**: `{name}.component.spec.ts`

### Class Naming

- **Format**: `PascalCase` with `Component` suffix
- **Examples**: `ProviderSettingsComponent`, `ProviderSelectorComponent`

---

## 🧪 Testing Strategy

### Unit Tests

Each component has comprehensive unit tests:

```typescript
describe('ProviderSettingsComponent', () => {
  it('should emit configChanged when form field is modified', () => {
    const component = harness.componentInstance;
    const emitSpy = jest.spyOn(component.configChanged, 'emit');

    component.onFieldChange('apiKey', 'new-api-key');

    expect(emitSpy).toHaveBeenCalledWith(expect.objectContaining({ apiKey: 'new-api-key' }));
  });

  it('should detect changes correctly', () => {
    const component = harness.componentInstance;
    component.config.set({ apiKey: 'original' });
    component.formData.set({ apiKey: 'modified' });

    expect(component.hasChanges()).toBe(true);
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
- [ ] Export from `libs/frontend/providers/src/index.ts`
- [ ] Update consuming components to import from `@ptah-extension/providers`
- [ ] Verify `nx build frontend-providers` succeeds
- [ ] Verify all tests pass with ≥80% coverage

---

## 📚 Related Documentation

- **Migration Guide**: `docs/guides/SIGNAL_MIGRATION_GUIDE.md`
- **Modern Angular Guide**: `docs/guides/MODERN_ANGULAR_GUIDE.md`
- **Implementation Plan**: `task-tracking/TASK_FE_001/implementation-plan.md`
- **Shared Types**: `libs/shared/src/lib/types/`

---

**Last Updated**: October 12, 2025  
**Components**: 2 presentational (ProviderSettings, ProviderSelector)  
**Migration Status**: 🔄 Pending extraction from monolithic app
