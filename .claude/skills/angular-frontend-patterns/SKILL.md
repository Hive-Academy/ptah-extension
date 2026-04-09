---
name: angular-frontend-patterns
description: Modern Angular development patterns with signals and reactive architecture. Use when (1) Building Angular components with signals, (2) Implementing smart/dumb component patterns, (3) State management with signals, (4) RxJS integration patterns, (5) Push-based architecture, (6) Component communication, (7) Angular routing patterns, (8) Form handling with signals.
---

# Modern Angular Frontend Patterns

Signal-first, push-based architecture patterns for Angular 17+.

## Core Principle: Signals Over Observables

Use signals for synchronous state, observables for async streams.

| Use Case          | Pattern                      |
| ----------------- | ---------------------------- |
| Component state   | `signal()`, `computed()`     |
| API responses     | `toSignal()` from observable |
| Form values       | `signal()` for model         |
| Event streams     | Keep as Observable           |
| WebSocket streams | Keep as Observable           |

## Signal Types Quick Reference

```typescript
import { signal, computed, effect, input, output, model } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';

// Writable signal
const count = signal(0);
count.set(5); // Replace value
count.update((v) => v + 1); // Update based on current

// Computed (derived, read-only)
const doubled = computed(() => count() * 2);

// Effect (side effects)
effect(() => console.log(count()));

// Input signals (component inputs)
name = input<string>(); // Optional
userId = input.required<string>(); // Required
size = input(10); // With default
active = input(false, { transform: booleanAttribute });

// Output
clicked = output<MouseEvent>();

// Model (two-way binding)
value = model(0); // Creates input + output
// Usage: <comp [(value)]="parentVal" />
```

## Smart vs Dumb Components

### Smart (Container) Components

```typescript
// libs/[domain]/feature/src/lib/user-list/user-list.component.ts
@Component({
  selector: 'app-user-list',
  standalone: true,
  imports: [UserCardComponent, UserFilterComponent],
  template: `
    <app-user-filter (filterChange)="onFilterChange($event)" />

    @if (loading()) {
      <app-spinner />
    } @else {
      @for (user of filteredUsers(); track user.id) {
        <app-user-card [user]="user" (select)="onSelectUser($event)" />
      }
    }
  `,
})
export class UserListComponent {
  private userService = inject(UserService);
  private router = inject(Router);

  // State
  private filter = signal('');
  loading = signal(false);

  // Data from service
  users = toSignal(this.userService.users$, { initialValue: [] });

  // Derived state
  filteredUsers = computed(() => {
    const filter = this.filter().toLowerCase();
    return this.users().filter((u) => u.name.toLowerCase().includes(filter));
  });

  onFilterChange(value: string) {
    this.filter.set(value);
  }

  onSelectUser(userId: string) {
    this.router.navigate(['/users', userId]);
  }
}
```

### Dumb (Presentational) Components

```typescript
// libs/[domain]/ui/src/lib/user-card/user-card.component.ts
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="card" (click)="select.emit(user().id)">
      <img [src]="user().avatar" [alt]="user().name" />
      <h3>{{ user().name }}</h3>
      <p>{{ user().email }}</p>
    </div>
  `,
})
export class UserCardComponent {
  user = input.required<User>();
  select = output<string>();
}
```

## State Management Pattern

```typescript
// libs/[domain]/data-access/src/lib/user.service.ts
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  // Private writable state
  private _users = signal<User[]>([]);
  private _selectedUserId = signal<string | null>(null);
  private _loading = signal(false);
  private _error = signal<string | null>(null);

  // Public read-only state
  users = this._users.asReadonly();
  loading = this._loading.asReadonly();
  error = this._error.asReadonly();

  // Computed state
  selectedUser = computed(() => {
    const id = this._selectedUserId();
    return this._users().find((u) => u.id === id) ?? null;
  });

  activeUsers = computed(() => this._users().filter((u) => u.isActive));

  // Observable for HTTP (keeps RxJS benefits)
  users$ = this.http.get<User[]>('/api/users');

  // Actions
  loadUsers() {
    this._loading.set(true);
    this._error.set(null);

    this.http
      .get<User[]>('/api/users')
      .pipe(
        tap((users) => {
          this._users.set(users);
          this._loading.set(false);
        }),
        catchError((err) => {
          this._error.set(err.message);
          this._loading.set(false);
          return EMPTY;
        }),
      )
      .subscribe();
  }

  selectUser(id: string | null) {
    this._selectedUserId.set(id);
  }

  addUser(user: User) {
    this._users.update((users) => [...users, user]);
  }

  updateUser(id: string, changes: Partial<User>) {
    this._users.update((users) => users.map((u) => (u.id === id ? { ...u, ...changes } : u)));
  }
}
```

## RxJS Integration

```typescript
import { toSignal, toObservable } from '@angular/core/rxjs-interop';

// Observable → Signal
const users = toSignal(this.http.get<User[]>('/api/users'), {
  initialValue: [],
});

// With loading state
const usersResource = toSignal(
  this.http.get<User[]>('/api/users').pipe(
    map((data) => ({ data, loading: false, error: null })),
    startWith({ data: [], loading: true, error: null }),
    catchError((err) => of({ data: [], loading: false, error: err.message })),
  ),
);

// Signal → Observable (for interop)
const searchTerm = signal('');
const searchTerm$ = toObservable(this.searchTerm);

// Debounced search
const searchResults = toSignal(
  toObservable(this.searchTerm).pipe(
    debounceTime(300),
    distinctUntilChanged(),
    switchMap((term) => this.searchService.search(term)),
  ),
  { initialValue: [] },
);
```

## Decision Matrix

| Need                | Pattern                 | Reference                                                 |
| ------------------- | ----------------------- | --------------------------------------------------------- |
| Component state     | Signals                 | SKILL.md                                                  |
| Component inputs    | `input()` signals       | SKILL.md                                                  |
| Derived/computed    | `computed()`            | SKILL.md                                                  |
| Side effects        | `effect()`              | [effects-patterns.md](references/effects-patterns.md)     |
| Forms               | Signal-based            | [forms-patterns.md](references/forms-patterns.md)         |
| HTTP/async          | RxJS → `toSignal()`     | [rxjs-patterns.md](references/rxjs-patterns.md)           |
| Container component | Smart component pattern | [component-patterns.md](references/component-patterns.md) |
| Reusable UI         | Dumb component pattern  | [component-patterns.md](references/component-patterns.md) |

## References

Load these for detailed implementation guidance:

- [component-patterns.md](references/component-patterns.md) - Smart/dumb patterns, composition
- [rxjs-patterns.md](references/rxjs-patterns.md) - RxJS best practices with signals
- [forms-patterns.md](references/forms-patterns.md) - Reactive forms with signals
- [effects-patterns.md](references/effects-patterns.md) - Effect patterns and pitfalls
