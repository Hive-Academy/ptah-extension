# RxJS Patterns with Signals

Best practices for integrating RxJS with Angular signals.

## When to Use What

| Scenario                  | Use             | Why                   |
| ------------------------- | --------------- | --------------------- |
| UI state (selected, open) | Signal          | Synchronous, simple   |
| HTTP response             | toSignal()      | One-time async → sync |
| Form values               | Signal          | Direct binding        |
| WebSocket stream          | Observable      | Continuous stream     |
| Search with debounce      | RxJS → toSignal | Operators needed      |
| Multiple events combined  | RxJS → toSignal | combineLatest, merge  |

## Converting Observables to Signals

### Basic Conversion

```typescript
import { toSignal } from '@angular/core/rxjs-interop';

@Component({...})
export class UserListComponent {
  private http = inject(HttpClient);

  // Simple conversion with initial value
  users = toSignal(
    this.http.get<User[]>('/api/users'),
    { initialValue: [] }
  );

  // With require initial value (undefined initially)
  user = toSignal(this.http.get<User>('/api/user'));
  // user() returns User | undefined
}
```

### With Loading and Error States

```typescript
interface AsyncState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  // Expose as signal with full state
  usersState = toSignal(
    this.http.get<User[]>('/api/users').pipe(
      map((data) => ({ data, loading: false, error: null })),
      startWith({ data: [], loading: true, error: null }),
      catchError((err) =>
        of({
          data: [],
          loading: false,
          error: err.message,
        }),
      ),
    ),
    { initialValue: { data: [], loading: true, error: null } },
  );

  // Derived signals for convenience
  users = computed(() => this.usersState().data);
  loading = computed(() => this.usersState().loading);
  error = computed(() => this.usersState().error);
}
```

### Refresh/Reload Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class ProductService {
  private http = inject(HttpClient);

  // Trigger for reloading
  private reload$ = new BehaviorSubject<void>(undefined);

  products = toSignal(
    this.reload$.pipe(
      switchMap(() =>
        this.http.get<Product[]>('/api/products').pipe(
          map((data) => ({ data, loading: false, error: null })),
          startWith({ data: [], loading: true, error: null }),
          catchError((err) => of({ data: [], loading: false, error: err.message })),
        ),
      ),
    ),
    { initialValue: { data: [], loading: true, error: null } },
  );

  refresh() {
    this.reload$.next();
  }
}
```

## Converting Signals to Observables

```typescript
import { toObservable } from '@angular/core/rxjs-interop';

@Component({...})
export class SearchComponent {
  // Signal for user input
  searchTerm = signal('');

  // Convert to observable for RxJS operators
  private searchTerm$ = toObservable(this.searchTerm);

  // Debounced search
  searchResults = toSignal(
    this.searchTerm$.pipe(
      debounceTime(300),
      distinctUntilChanged(),
      filter(term => term.length >= 2),
      switchMap(term => this.searchService.search(term)),
      catchError(() => of([]))
    ),
    { initialValue: [] }
  );
}
```

## Combining Multiple Signals

### Using computed()

```typescript
@Component({...})
export class DashboardComponent {
  private userService = inject(UserService);
  private orderService = inject(OrderService);

  users = this.userService.users;
  orders = this.orderService.orders;

  // Combine related data
  userOrderStats = computed(() => {
    const users = this.users();
    const orders = this.orders();

    return users.map(user => ({
      ...user,
      orderCount: orders.filter(o => o.userId === user.id).length,
      totalSpent: orders
        .filter(o => o.userId === user.id)
        .reduce((sum, o) => sum + o.total, 0),
    }));
  });
}
```

### Using RxJS combineLatest

```typescript
@Injectable({ providedIn: 'root' })
export class DashboardService {
  private http = inject(HttpClient);

  private users$ = this.http.get<User[]>('/api/users');
  private orders$ = this.http.get<Order[]>('/api/orders');
  private products$ = this.http.get<Product[]>('/api/products');

  // Combine multiple HTTP calls
  dashboardData = toSignal(
    combineLatest({
      users: this.users$,
      orders: this.orders$,
      products: this.products$,
    }).pipe(
      map((data) => ({ data, loading: false, error: null })),
      startWith({ data: null, loading: true, error: null }),
      catchError((err) => of({ data: null, loading: false, error: err.message })),
    ),
    { initialValue: { data: null, loading: true, error: null } },
  );
}
```

## Event Streams

Keep as observables when dealing with continuous events:

```typescript
@Component({...})
export class ChatComponent implements OnInit, OnDestroy {
  private wsService = inject(WebSocketService);
  private destroy$ = new Subject<void>();

  // Keep messages as signal for template
  messages = signal<Message[]>([]);

  ngOnInit() {
    // Stream stays as observable
    this.wsService.messages$
      .pipe(takeUntil(this.destroy$))
      .subscribe(msg => {
        this.messages.update(msgs => [...msgs, msg]);
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

### Using takeUntilDestroyed

```typescript
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({...})
export class ChatComponent {
  private wsService = inject(WebSocketService);
  private destroyRef = inject(DestroyRef);

  messages = signal<Message[]>([]);

  constructor() {
    // Automatically unsubscribes on destroy
    this.wsService.messages$
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe(msg => {
        this.messages.update(msgs => [...msgs, msg]);
      });
  }
}
```

## Auto-Polling Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class NotificationService {
  private http = inject(HttpClient);

  // Poll every 30 seconds
  notifications = toSignal(
    timer(0, 30000).pipe(
      switchMap(() => this.http.get<Notification[]>('/api/notifications')),
      catchError(() => of([])),
    ),
    { initialValue: [] },
  );

  unreadCount = computed(() => this.notifications().filter((n) => !n.read).length);
}
```

## Pagination Pattern

```typescript
@Injectable({ providedIn: 'root' })
export class PaginatedService {
  private http = inject(HttpClient);

  // State signals
  private _page = signal(1);
  private _pageSize = signal(20);
  private _filters = signal<Filters>({});

  // Public read-only
  page = this._page.asReadonly();
  pageSize = this._pageSize.asReadonly();

  // Combine params and fetch
  items = toSignal(
    combineLatest([toObservable(this._page), toObservable(this._pageSize), toObservable(this._filters)]).pipe(
      debounceTime(100), // Batch rapid changes
      switchMap(([page, pageSize, filters]) =>
        this.http.get<PagedResult<Item>>('/api/items', {
          params: { page, pageSize, ...filters },
        }),
      ),
      map((result) => ({ data: result, loading: false, error: null })),
      startWith({ data: null, loading: true, error: null }),
      catchError((err) => of({ data: null, loading: false, error: err.message })),
    ),
  );

  // Actions
  setPage(page: number) {
    this._page.set(page);
  }

  setFilters(filters: Filters) {
    this._filters.set(filters);
    this._page.set(1); // Reset to first page
  }
}
```

## Operators Reference

| Operator               | Use Case                   | Example                 |
| ---------------------- | -------------------------- | ----------------------- |
| `debounceTime`         | Wait for pause in input    | Search input            |
| `distinctUntilChanged` | Skip duplicate values      | Prevent redundant calls |
| `switchMap`            | Cancel previous, start new | Search, navigation      |
| `exhaustMap`           | Ignore until complete      | Form submit             |
| `concatMap`            | Queue in order             | Sequential saves        |
| `mergeMap`             | Parallel execution         | Bulk operations         |
| `catchError`           | Handle errors              | Error recovery          |
| `retry`                | Retry failed requests      | Transient failures      |
| `shareReplay`          | Cache and share            | Expensive computations  |
| `startWith`            | Provide initial value      | Loading states          |
