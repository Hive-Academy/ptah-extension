# Angular Signal Migration Guide

**Purpose**: Step-by-step guide for converting Angular components from decorator-based APIs to signal-based APIs  
**Target**: Angular 20+  
**Scope**: TASK_FE_001 - Frontend Library Extraction & Modernization

---

## 🎯 Migration Overview

This guide covers converting legacy Angular patterns to modern Angular 20+ signal-based reactive programming.

### What Changes

| From (Legacy)            | To (Modern)               | Benefit                |
| ------------------------ | ------------------------- | ---------------------- |
| `@Input()` decorator     | `input<T>()` function     | Type-safe, reactive    |
| `@Output()` decorator    | `output<T>()` function    | Type-safe events       |
| `@ViewChild()` decorator | `viewChild<T>()` function | Reactive queries       |
| `*ngIf` directive        | `@if` control flow        | 30% faster rendering   |
| `*ngFor` directive       | `@for` control flow       | Better performance     |
| `*ngSwitch` directive    | `@switch` control flow    | Cleaner syntax         |
| `BehaviorSubject`        | `signal()`                | Simpler reactive state |
| Default change detection | OnPush                    | 60-80% less checks     |

---

## 📋 Step 1: Input Migration

### Before (Decorator-Based)

```typescript
import { Component, Input } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  templateUrl: './chat-header.component.html',
})
export class ChatHeaderComponent {
  @Input() providerStatus!: ProviderStatus;
  @Input() sessionCount: number = 0;
  @Input({ required: true }) currentSession!: Session;
}
```

### After (Signal-Based)

```typescript
import { Component, input, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  standalone: true, // Add standalone
  templateUrl: './chat-header.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, // Add OnPush
})
export class ChatHeaderComponent {
  // Required input (no default)
  readonly providerStatus = input.required<ProviderStatus>();

  // Optional input with default
  readonly sessionCount = input<number>(0);

  // Required input (explicit)
  readonly currentSession = input.required<Session>();
}
```

### Template Changes

```html
<!-- Before -->
<div class="header">
  <h2>Session #{{ sessionCount }}</h2>
  <span>Status: {{ providerStatus.status }}</span>
</div>

<!-- After (add parentheses to call signal) -->
<div class="header">
  <h2>Session #{{ sessionCount() }}</h2>
  <span>Status: {{ providerStatus().status }}</span>
</div>
```

### Key Points

- ✅ Use `input.required<T>()` for required inputs (no default value)
- ✅ Use `input<T>(defaultValue)` for optional inputs with defaults
- ✅ All inputs are `readonly` (immutability by default)
- ✅ Call inputs as functions in templates: `value()` not `value`
- ✅ TypeScript enforces required inputs at compile time

---

## 📋 Step 2: Output Migration

### Before (Decorator-Based)

```typescript
import { Component, Output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  // ...
})
export class ChatHeaderComponent {
  @Output() newSession = new EventEmitter<void>();
  @Output() settingsOpened = new EventEmitter<void>();
  @Output() providerChanged = new EventEmitter<string>();

  onNewSessionClick(): void {
    this.newSession.emit();
  }

  onSettingsClick(): void {
    this.settingsOpened.emit();
  }

  onProviderSelect(providerId: string): void {
    this.providerChanged.emit(providerId);
  }
}
```

### After (Signal-Based)

```typescript
import { Component, output } from '@angular/core';

@Component({
  selector: 'app-chat-header',
  standalone: true,
  // ...
})
export class ChatHeaderComponent {
  // Outputs with signal-based API
  readonly newSession = output<void>();
  readonly settingsOpened = output<void>();
  readonly providerChanged = output<string>();

  onNewSessionClick(): void {
    this.newSession.emit(); // Same emit() method
  }

  onSettingsClick(): void {
    this.settingsOpened.emit();
  }

  onProviderSelect(providerId: string): void {
    this.providerChanged.emit(providerId);
  }
}
```

### Parent Component Usage

```html
<!-- Before -->
<app-chat-header [providerStatus]="status" (newSession)="handleNewSession()" (settingsOpened)="handleSettings()"></app-chat-header>

<!-- After (same template syntax) -->
<app-chat-header [providerStatus]="status" (newSession)="handleNewSession()" (settingsOpened)="handleSettings()" />
```

### Key Points

- ✅ Replace `EventEmitter<T>` with `output<T>()`
- ✅ `emit()` method remains the same
- ✅ Template syntax unchanged for parent components
- ✅ Type-safe event emissions enforced

---

## 📋 Step 3: ViewChild Migration

### Before (Decorator-Based)

```typescript
import { Component, ViewChild, ElementRef, AfterViewInit } from '@angular/core';

@Component({
  selector: 'app-chat-input',
  // ...
})
export class ChatInputComponent implements AfterViewInit {
  @ViewChild('inputField') inputField!: ElementRef<HTMLTextAreaElement>;
  @ViewChild('fileDropZone', { read: ElementRef }) fileDropZone!: ElementRef;

  ngAfterViewInit(): void {
    this.inputField.nativeElement.focus();
  }

  clearInput(): void {
    this.inputField.nativeElement.value = '';
  }
}
```

### After (Signal-Based)

```typescript
import { Component, viewChild, ElementRef, effect } from '@angular/core';

@Component({
  selector: 'app-chat-input',
  standalone: true,
  // ...
})
export class ChatInputComponent {
  // Signal-based view queries
  readonly inputField = viewChild.required<ElementRef<HTMLTextAreaElement>>('inputField');
  readonly fileDropZone = viewChild<ElementRef>('fileDropZone');

  constructor() {
    // Use effect instead of ngAfterViewInit
    effect(() => {
      const input = this.inputField();
      if (input) {
        input.nativeElement.focus();
      }
    });
  }

  clearInput(): void {
    const input = this.inputField();
    if (input) {
      input.nativeElement.value = '';
    }
  }
}
```

### Key Points

- ✅ Replace `@ViewChild()` with `viewChild<T>()`
- ✅ Use `viewChild.required<T>()` for elements that must exist
- ✅ ViewChild returns a signal, call it to get the value: `viewChild()()`
- ✅ Replace `ngAfterViewInit` with `effect()` for initialization
- ✅ Always check if signal value exists before using

---

## 📋 Step 4: Control Flow Migration

### `*ngIf` → `@if`

#### Before

```html
<div *ngIf="isLoading" class="spinner">
  <app-spinner></app-spinner>
</div>

<div *ngIf="error; else noError" class="error">{{ error.message }}</div>
<ng-template #noError>
  <p>All good!</p>
</ng-template>

<div *ngIf="messages.length > 0">
  <app-messages-list [messages]="messages"></app-messages-list>
</div>
```

#### After

```html
@if (isLoading()) {
<div class="spinner">
  <app-spinner />
</div>
} @if (error(); as errorValue) {
<div class="error">{{ errorValue.message }}</div>
} @else {
<p>All good!</p>
} @if (messages().length > 0) {
<app-messages-list [messages]="messages()" />
}
```

### `*ngFor` → `@for`

#### Before

```html
<ul>
  <li *ngFor="let message of messages; trackBy: trackById; let i = index">{{ i + 1 }}. {{ message.content }}</li>
</ul>

<div *ngFor="let item of items; trackBy: trackById">
  <app-item-card [item]="item"></app-item-card>
</div>
```

#### After

```html
<ul>
  @for (message of messages(); track message.id) {
  <li>{{ $index + 1 }}. {{ message.content }}</li>
  }
</ul>

@for (item of items(); track item.id) {
<app-item-card [item]="item" />
} @empty {
<p>No items to display</p>
}
```

### `*ngSwitch` → `@switch`

#### Before

```html
<div [ngSwitch]="status">
  <p *ngSwitchCase="'loading'">Loading...</p>
  <p *ngSwitchCase="'error'">Error occurred</p>
  <p *ngSwitchCase="'success'">Success!</p>
  <p *ngSwitchDefault>Unknown status</p>
</div>
```

#### After

```html
@switch (status()) { @case ('loading') {
<p>Loading...</p>
} @case ('error') {
<p>Error occurred</p>
} @case ('success') {
<p>Success!</p>
} @default {
<p>Unknown status</p>
} }
```

### Key Points

- ✅ `@if`, `@for`, `@switch` are built-in, no imports needed
- ✅ No `ng-template` required for @else
- ✅ `@for` requires `track` expression (use unique id)
- ✅ Use `$index` instead of `let i = index`
- ✅ `@empty` block for empty arrays (no `*ngIf` check needed)
- ✅ Call signal values in control flow: `value()` not `value`

---

## 📋 Step 5: Service Signal Migration

### Before (BehaviorSubject-Based)

```typescript
import { Injectable } from '@angular/core';
import { BehaviorSubject, Observable, combineLatest } from 'rxjs';
import { map } from 'rxjs/operators';

@Injectable({ providedIn: 'root' })
export class ChatStateService {
  private readonly _messages$ = new BehaviorSubject<Message[]>([]);
  private readonly _isLoading$ = new BehaviorSubject<boolean>(false);

  readonly messages$: Observable<Message[]> = this._messages$.asObservable();
  readonly isLoading$: Observable<boolean> = this._isLoading$.asObservable();

  readonly messageCount$: Observable<number> = this._messages$.pipe(map((messages) => messages.length));

  readonly canSend$: Observable<boolean> = combineLatest([this._isLoading$, this._messages$]).pipe(map(([isLoading, messages]) => !isLoading && messages.length < 100));

  addMessage(message: Message): void {
    const current = this._messages$.value;
    this._messages$.next([...current, message]);
  }

  setLoading(loading: boolean): void {
    this._isLoading$.next(loading);
  }
}
```

### After (Signal-Based)

```typescript
import { Injectable, signal, computed } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class ChatStateService {
  // Private writable signals
  private readonly _messages = signal<Message[]>([]);
  private readonly _isLoading = signal<boolean>(false);

  // Public readonly signals
  readonly messages = this._messages.asReadonly();
  readonly isLoading = this._isLoading.asReadonly();

  // Computed signals (automatically update)
  readonly messageCount = computed(() => this.messages().length);

  readonly canSend = computed(() => !this.isLoading() && this.messages().length < 100);

  // Mutations
  addMessage(message: Message): void {
    this._messages.update((current) => [...current, message]);
  }

  setLoading(loading: boolean): void {
    this._isLoading.set(loading);
  }
}
```

### Component Usage

#### Before

```typescript
export class ChatComponent implements OnInit, OnDestroy {
  messages: Message[] = [];
  isLoading = false;
  canSend = false;

  private destroy$ = new Subject<void>();

  constructor(private chatState: ChatStateService) {}

  ngOnInit(): void {
    this.chatState.messages$.pipe(takeUntil(this.destroy$)).subscribe((messages) => {
      this.messages = messages;
    });

    this.chatState.canSend$.pipe(takeUntil(this.destroy$)).subscribe((canSend) => {
      this.canSend = canSend;
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

#### After

```typescript
export class ChatComponent {
  readonly chatState = inject(ChatStateService);

  // Direct signal access (no subscription needed)
  readonly messages = this.chatState.messages;
  readonly canSend = this.chatState.canSend;

  // No ngOnInit, ngOnDestroy needed!
}
```

### Template

```html
<!-- Signal-based (call as functions) -->
@for (message of messages(); track message.id) {
<app-message [content]="message" />
}

<button [disabled]="!canSend()" (click)="sendMessage()">Send</button>
```

### Key Points

- ✅ Replace `BehaviorSubject` with `signal()`
- ✅ Use `computed()` instead of `pipe(map(...))`
- ✅ Use `.set()` for replacing value entirely
- ✅ Use `.update()` for updating based on current value
- ✅ Use `.asReadonly()` to expose read-only signals
- ✅ No subscriptions needed in components!
- ✅ No `ngOnDestroy` cleanup needed!

---

## 📋 Step 6: Effect Migration

### Before (`ngOnInit` + Subscription)

```typescript
export class ChatComponent implements OnInit, OnDestroy {
  @Input() sessionId!: string;

  private destroy$ = new Subject<void>();

  constructor(private chatService: ChatService, private logger: LoggerService) {}

  ngOnInit(): void {
    // Load messages when sessionId changes
    this.chatService.messages$.pipe(takeUntil(this.destroy$)).subscribe((messages) => {
      this.logger.log('Messages updated', messages.length);
    });
  }

  ngOnDestroy(): void {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

### After (Effect-Based)

```typescript
export class ChatComponent {
  readonly sessionId = input.required<string>();

  private readonly chatService = inject(ChatService);
  private readonly logger = inject(LoggerService);

  constructor() {
    // Effect runs when messages signal changes
    effect(() => {
      const messages = this.chatService.messages();
      this.logger.log('Messages updated', messages.length);
    });

    // Effect runs when sessionId input changes
    effect(() => {
      const id = this.sessionId();
      this.chatService.loadMessages(id);
    });
  }
}
```

### Key Points

- ✅ Use `effect()` for side effects that depend on signals
- ✅ Effects automatically track signal dependencies
- ✅ Effects clean up automatically (no manual unsubscribe)
- ✅ Effects run in constructor or class properties
- ✅ Avoid complex logic in effects (keep them simple)

---

## 📋 Step 7: OnPush Change Detection

### Before (Default Change Detection)

```typescript
@Component({
  selector: 'app-chat-messages',
  templateUrl: './chat-messages.component.html',
  // Default change detection (checks every time)
})
export class ChatMessagesComponent {
  @Input() messages: Message[] = [];

  // Component checked on every change detection cycle
}
```

### After (OnPush Change Detection)

```typescript
@Component({
  selector: 'app-chat-messages',
  standalone: true,
  templateUrl: './chat-messages.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush, // Only check when signals change
})
export class ChatMessagesComponent {
  readonly messages = input<Message[]>([]);

  // Component only checked when:
  // 1. Input signal changes
  // 2. Output emits
  // 3. Async pipe receives new value
  // 4. Manual markForCheck() called
}
```

### Key Requirements for OnPush

1. **Immutable Inputs**: Never mutate input objects

```typescript
// ❌ BAD: Mutating array
messages.push(newMessage);

// ✅ GOOD: Creating new array
this.messages.set([...this.messages(), newMessage]);
```

2. **Signal-Based State**: Use signals for reactive updates

```typescript
// Signals automatically trigger change detection
readonly count = signal(0);

increment(): void {
  this.count.update((c) => c + 1);  // Triggers OnPush check
}
```

3. **Event Handlers**: Outputs automatically trigger OnPush

```typescript
readonly messageSelected = output<Message>();

onMessageClick(message: Message): void {
  this.messageSelected.emit(message);  // Triggers change detection
}
```

### Key Points

- ✅ Add `changeDetection: ChangeDetectionStrategy.OnPush` to ALL components
- ✅ Use immutable data structures
- ✅ Use signals for reactive state (automatic change detection)
- ✅ Performance: 60-80% reduction in change detection cycles

---

## 🚀 Migration Workflow (Per Component)

### 1. Preparation (5 min)

- [ ] Read component file and identify:
  - All `@Input()` decorators
  - All `@Output()` decorators
  - All `@ViewChild()` / `@ContentChild()` decorators
  - All `*ngIf`, `*ngFor`, `*ngSwitch` in template
  - All lifecycle hooks (ngOnInit, ngOnDestroy, etc.)

### 2. Update Component Class (15 min)

- [ ] Add `standalone: true` to `@Component` decorator
- [ ] Add `changeDetection: ChangeDetectionStrategy.OnPush`
- [ ] Replace `@Input()` with `input()` or `input.required()`
- [ ] Replace `@Output()` with `output()`
- [ ] Replace `@ViewChild()` with `viewChild()` or `viewChild.required()`
- [ ] Replace lifecycle hooks with `effect()` if needed
- [ ] Update all imports

### 3. Update Template (10 min)

- [ ] Add `()` to all signal calls: `value` → `value()`
- [ ] Replace `*ngIf` with `@if`
- [ ] Replace `*ngFor` with `@for` (add `track`)
- [ ] Replace `*ngSwitch` with `@switch`
- [ ] Update `$index` usage (if applicable)

### 4. Update Tests (10 min)

- [ ] Update test setup for standalone component
- [ ] Update signal input tests (use `ComponentRef.setInput()`)
- [ ] Update output tests (outputs are still emitters)
- [ ] Update ViewChild tests (query results are signals)

### 5. Validation (5 min)

- [ ] TypeScript compiles with zero errors
- [ ] ESLint passes (no decorator warnings)
- [ ] All tests pass
- [ ] Component renders in dev mode
- [ ] Manual functional testing

**Total Time Per Component**: ~45 minutes

---

## 🧪 Testing Signal-Based Components

### Input Testing

```typescript
it('should update display when status input changes', () => {
  const fixture = TestBed.createComponent(ChatHeaderComponent);
  const component = fixture.componentInstance;

  // Set signal input
  fixture.componentRef.setInput('providerStatus', {
    status: 'connected',
    provider: 'claude',
  });

  fixture.detectChanges();

  expect(fixture.nativeElement.textContent).toContain('connected');
});
```

### Output Testing

```typescript
it('should emit newSession when button clicked', () => {
  const fixture = TestBed.createComponent(ChatHeaderComponent);
  const component = fixture.componentInstance;
  const emitSpy = jasmine.createSpy('newSession');

  component.newSession.subscribe(emitSpy);

  const button = fixture.nativeElement.querySelector('[data-test="new-session"]');
  button.click();

  expect(emitSpy).toHaveBeenCalled();
});
```

### ViewChild Testing

```typescript
it('should focus input field on init', () => {
  const fixture = TestBed.createComponent(ChatInputComponent);
  const component = fixture.componentInstance;

  fixture.detectChanges();

  // ViewChild is a signal, call it to get value
  const input = component.inputField();
  expect(input.nativeElement).toBe(document.activeElement);
});
```

---

## 📊 Migration Checklist

Use this checklist to track component migration:

### Component: `___________________`

**Location**: `libs/frontend/_______/src/lib/components/`

- [ ] **Step 1**: Copied from monolithic app
- [ ] **Step 2**: Added `standalone: true`
- [ ] **Step 3**: Added `changeDetection: OnPush`
- [ ] **Step 4**: Converted all `@Input()` → `input()`
- [ ] **Step 5**: Converted all `@Output()` → `output()`
- [ ] **Step 6**: Converted all `@ViewChild()` → `viewChild()`
- [ ] **Step 7**: Replaced `*ngIf` → `@if`
- [ ] **Step 8**: Replaced `*ngFor` → `@for`
- [ ] **Step 9**: Replaced `*ngSwitch` → `@switch`
- [ ] **Step 10**: Replaced lifecycle hooks with `effect()`
- [ ] **Step 11**: Updated template signal calls (`value()`)
- [ ] **Step 12**: Migrated tests
- [ ] **Step 13**: All tests passing
- [ ] **Step 14**: Manual testing completed
- [ ] **Step 15**: Added to barrel export

---

## 🎯 Quick Reference

### Imports

```typescript
// Signal APIs
import { signal, computed, effect } from '@angular/core';

// Input/Output
import { input, output } from '@angular/core';

// ViewChild
import { viewChild } from '@angular/core';

// Change Detection
import { ChangeDetectionStrategy } from '@angular/core';
```

### Signal Patterns

```typescript
// Writable signal
const count = signal(0);
count.set(5); // Replace value
count.update((c) => c + 1); // Update based on current

// Computed signal
const double = computed(() => count() * 2);

// Effect (side effects)
effect(() => {
  console.log('Count is:', count());
});

// Readonly signal
const readonlyCount = count.asReadonly();
```

---

**Last Updated**: October 11, 2025  
**Angular Version**: 20+  
**Status**: Migration guide complete, ready for component extraction
