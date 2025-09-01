# Push-Based Architecture in Angular

## Introduction to Push-Based Architecture

Push-based architecture is a modern approach to building reactive applications in Angular that fundamentally changes how we think about state management and UI updates. Instead of components actively requesting (pulling) data, they passively receive (pushed) updates from observable data sources.

## Pull vs. Push Architecture

### Pull-Based Architecture

In the traditional pull-based approach:

- Components actively request data
- The view "pulls" the latest state when it needs to render
- Change detection checks for updates in regular cycles
- Data flow is often imperative and bidirectional

```typescript
// Pull-based example
@Component({
  template: `
    <div>Count: {{ count }}</div>
    <button (click)="increment()">Increment</button>
  `,
})
export class CounterComponent {
  count = 0;

  increment() {
    this.count++;
  }
}
```

### Push-Based Architecture

In a push-based approach:

- State changes are pushed to subscribers
- The view reactively updates when state is pushed to it
- Change detection is optimized and more predictable
- Data flow is unidirectional and declarative

```typescript
// Push-based example with signals
@Component({
  template: `
    <div>Count: {{ count() }}</div>
    <button (click)="increment()">Increment</button>
  `,
})
export class CounterComponent {
  count = signal(0);

  increment() {
    this.count.update((value) => value + 1);
  }
}
```

## Core Benefits of Push-Based Architecture

1. **Performance Improvements**

   - Reduced change detection cycles
   - More predictable rendering
   - Fewer wasted computation cycles

2. **Improved Developer Experience**

   - Clear data flow
   - Easier debugging
   - More declarative code

3. **Better Testability**

   - Decoupled components
   - Observable streams can be easily mocked
   - Pure functions for state transformations

4. **Enhanced Scalability**
   - Better handles complex state requirements
   - More maintainable as app grows
   - Easier team collaboration

## Implementing Push-Based Architecture

### 1. Using Signals for Component State

Signals provide a direct way to implement push-based architecture in components:

```typescript
@Component({
  selector: 'app-user-profile',
  template: `
    @if (loading()) {
    <div class="loading">Loading...</div>
    } @else if (error()) {
    <div class="error">{{ error() }}</div>
    } @else if (user()) {
    <div class="profile">
      <h2>{{ user()?.name }}</h2>
      <p>{{ user()?.email }}</p>
    </div>
    } @else {
    <div>No user data available</div>
    }
  `,
})
export class UserProfileComponent {
  // State signals
  loading = signal(true);
  error = signal<string | null>(null);
  user = signal<User | null>(null);

  // Inject dependencies
  private userService = inject(UserService);

  constructor() {
    this.loadUser();
  }

  async loadUser() {
    try {
      const userData = await this.userService.getCurrentUser();
      this.user.set(userData);
      this.error.set(null);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      this.loading.set(false);
    }
  }
}
```

### 2. RxJS for Complex Push-Based Flows

For more complex scenarios, especially involving async operations, RxJS remains powerful:

```typescript
@Component({
  selector: 'app-search',
  template: `
    <input type="text" [formControl]="searchControl" placeholder="Search users..." />

    @if (loading()) {
    <div class="loading">Searching...</div>
    } @else if (error()) {
    <div class="error">{{ error() }}</div>
    } @else {
    <ul class="results">
      @for (user of users(); track user.id) {
      <li class="user-item">{{ user.name }}</li>
      } @empty {
      <li class="empty">No users found</li>
      }
    </ul>
    }
  `,
})
export class SearchComponent implements OnInit {
  // Form control for the search input
  searchControl = new FormControl('');

  // State as signals
  loading = signal(false);
  error = signal<string | null>(null);
  users = signal<User[]>([]);

  // Inject dependencies
  private userService = inject(UserService);

  ngOnInit() {
    // Create a search stream from the form control
    const search$ = this.searchControl.valueChanges.pipe(
      // Wait for user to stop typing
      debounceTime(300),
      // Skip empty searches
      filter((term) => !!term && term.length > 2),
      // Reset loading and error state
      tap(() => {
        this.loading.set(true);
        this.error.set(null);
      }),
      // Cancel previous searches if still ongoing
      switchMap((term) =>
        this.userService.searchUsers(term).pipe(
          // Handle errors within the stream
          catchError((err) => {
            this.error.set(err instanceof Error ? err.message : 'Search failed');
            this.loading.set(false);
            return EMPTY; // Don't break the stream on error
          })
        )
      )
    );

    // Subscribe to the search results
    search$.subscribe({
      next: (results) => {
        this.users.set(results);
        this.loading.set(false);
      },
    });
  }
}
```

### 3. Using toSignal for RxJS Integration

The `toSignal` function bridges RxJS observables with signals:

```typescript
@Component({
  selector: 'app-product-list',
  template: `
    @if (loading()) {
    <app-loading-spinner />
    } @else if (products().length) {
    <div class="product-grid">
      @for (product of products(); track product.id) {
      <app-product-card [product]="product" />
      }
    </div>
    } @else {
    <div class="empty-state">No products found</div>
    }
  `,
})
export class ProductListComponent {
  private productService = inject(ProductService);

  // Convert observable to signal with loading state
  private productsResponse = toSignal(
    this.productService.getProducts().pipe(
      startWith(null) // Start with loading state
    ),
    { initialValue: null as ProductsResponse | null }
  );

  // Derived signals for state
  loading = computed(() => this.productsResponse() === null);

  products = computed(() => {
    const response = this.productsResponse();
    return response ? response.products : [];
  });
}
```

## Advanced Push-Based Patterns

### 1. Signal-Based Services

Services can be the source of pushed data for the entire application:

```typescript
@Injectable({ providedIn: 'root' })
export class CartService {
  // Private writable signals
  private itemsSignal = signal<CartItem[]>([]);

  // Public readonly signals or computed signals
  public items = this.itemsSignal.asReadonly();
  public itemCount = computed(() => this.itemsSignal().length);
  public totalPrice = computed(() => this.itemsSignal().reduce((sum, item) => sum + item.price * item.quantity, 0));

  // Methods to update state
  addItem(product: Product, quantity = 1) {
    this.itemsSignal.update((items) => {
      const existingItem = items.find((item) => item.productId === product.id);

      if (existingItem) {
        // Update existing item
        return items.map((item) => (item.productId === product.id ? { ...item, quantity: item.quantity + quantity } : item));
      } else {
        // Add new item
        return [
          ...items,
          {
            productId: product.id,
            name: product.name,
            price: product.price,
            quantity,
          },
        ];
      }
    });
  }

  removeItem(productId: string) {
    this.itemsSignal.update((items) => items.filter((item) => item.productId !== productId));
  }

  updateQuantity(productId: string, quantity: number) {
    this.itemsSignal.update((items) => items.map((item) => (item.productId === productId ? { ...item, quantity: Math.max(1, quantity) } : item)));
  }

  clearCart() {
    this.itemsSignal.set([]);
  }
}
```

### 2. Reactive Route Data with Signal-Based Guards and Resolvers

```typescript
// Signal-based route resolver
const productResolver = () => {
  const route = inject(ActivatedRoute);
  const productService = inject(ProductService);

  return toSignal(
    route.paramMap.pipe(
      map((params) => params.get('id')),
      filter((id) => !!id),
      switchMap((id) => productService.getProduct(id!))
    ),
    { initialValue: null }
  );
};

// Routes definition
export const routes: Routes = [
  {
    path: 'products/:id',
    component: ProductDetailComponent,
    providers: [
      // Provide the resolver in the component's injection context
      {
        provide: PRODUCT_RESOLVER,
        useFactory: productResolver,
      },
    ],
  },
];

// Component using the resolver
@Component({
  template: `
    @if (product(); as product) {
    <h1>{{ product.name }}</h1>
    <div class="details">
      <!-- Product details -->
    </div>
    } @else {
    <app-loading-spinner />
    }
  `,
})
export class ProductDetailComponent {
  // Inject the resolved data
  product = inject(PRODUCT_RESOLVER);
}
```

### 3. Combining Push-Based State with Component Communication

```typescript
// Feature state service
@Injectable()
export class UserDashboardState {
  // State
  private selectedTabSignal = signal('overview');
  private isEditModeSignal = signal(false);

  // Public API
  selectedTab = this.selectedTabSignal.asReadonly();
  isEditMode = this.isEditModeSignal.asReadonly();

  // Computed state combining multiple signals
  dashboardState = computed(() => ({
    selectedTab: this.selectedTabSignal(),
    isEditMode: this.isEditModeSignal(),
  }));

  // State updates
  selectTab(tab: string) {
    this.selectedTabSignal.set(tab);
  }

  toggleEditMode() {
    this.isEditModeSignal.update((current) => !current);
  }
}

// Component providing the state
@Component({
  selector: 'app-user-dashboard',
  providers: [UserDashboardState],
  template: `
    <app-dashboard-header [selectedTab]="state.selectedTab()" [isEditMode]="state.isEditMode()" (selectTab)="state.selectTab($event)" (toggleEdit)="state.toggleEditMode()" />

    <div class="dashboard-content">
      @switch (state.selectedTab()) { @case ('overview') {
      <app-overview-tab [isEditMode]="state.isEditMode()" />
      } @case ('activity') {
      <app-activity-tab [isEditMode]="state.isEditMode()" />
      } @case ('settings') {
      <app-settings-tab [isEditMode]="state.isEditMode()" />
      } }
    </div>
  `,
})
export class UserDashboardComponent {
  state = inject(UserDashboardState);
}
```

## Best Practices for Push-Based Architecture

### 1. Signal Organization

Organize signals consistently in components and services:

```typescript
@Component({
  // ...
})
export class UserListComponent {
  // 1. Dependencies
  private userService = inject(UserService);

  // 2. Input signals
  role = input<string>('user');

  // 3. UI state signals
  loading = signal(false);
  error = signal<string | null>(null);
  selectedUserId = signal<string | null>(null);

  // 4. Data state signals
  users = signal<User[]>([]);

  // 5. Computed signals
  filteredUsers = computed(() => {
    return this.users().filter((user) => user.role === this.role());
  });

  selectedUser = computed(() => {
    const id = this.selectedUserId();
    return id ? this.users().find((user) => user.id === id) : null;
  });

  // 6. Effects
  constructor() {
    // Set up derived state or side effects
    effect(() => {
      // Log selection changes
      console.log(`Selected user: ${this.selectedUser()?.name}`);
    });
  }

  // 7. Methods
  async loadUsers() {
    this.loading.set(true);
    try {
      const users = await this.userService.getUsers();
      this.users.set(users);
    } catch (error) {
      this.error.set(error instanceof Error ? error.message : 'Failed to load users');
    } finally {
      this.loading.set(false);
    }
  }

  selectUser(id: string) {
    this.selectedUserId.set(id);
  }
}
```

### 2. Effective RxJS Usage

When RxJS is needed for complex async operations:

```typescript
@Component({
  // ...
})
export class SearchComponent implements OnInit, OnDestroy {
  private destroy$ = new Subject<void>();

  searchInput = signal('');
  searchResults = signal<SearchResult[]>([]);
  loading = signal(false);

  // Inject dependencies
  private searchService = inject(SearchService);

  // Convert signal to observable
  searchInput$ = toObservable(this.searchInput);

  ngOnInit() {
    // Set up search pipeline
    this.searchInput$
      .pipe(
        // Only take values until component destroyed
        takeUntil(this.destroy$),

        // Wait for typing to stop
        debounceTime(300),

        // Ignore empty or short queries
        filter((query) => query.length >= 3),

        // Show loading indicator
        tap(() => this.loading.set(true)),

        // Cancel previous search if new input
        switchMap((query) =>
          this.searchService.search(query).pipe(
            // Handle errors in the inner observable
            catchError((err) => {
              console.error('Search error:', err);
              return of([]) as Observable<SearchResult[]>;
            }),
            // Always turn off loading
            finalize(() => this.loading.set(false))
          )
        )
      )
      .subscribe((results) => {
        this.searchResults.set(results);
      });
  }

  ngOnDestroy() {
    // Clean up subscriptions
    this.destroy$.next();
    this.destroy$.complete();
  }
}
```

### 3. Using OnPush Change Detection

OnPush change detection works perfectly with push-based architecture:

```typescript
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="user-card">
      <h3>{{ user()?.name }}</h3>
      <p>{{ user()?.email }}</p>
      <button (click)="select.emit(user()?.id)">Select</button>
    </div>
  `,
})
export class UserCardComponent {
  user = input<User | null>(null);
  select = output<string>();
}
```

### 4. Proper Unsubscription Patterns

When using RxJS, always ensure proper unsubscription:

```typescript
@Component({
  // ...
})
export class DataComponent implements OnInit, OnDestroy {
  // Method 1: Manual subjects and takeUntil
  private destroy$ = new Subject<void>();

  ngOnInit() {
    this.dataService
      .getData()
      .pipe(takeUntil(this.destroy$))
      .subscribe((data) => {
        // Handle data
      });
  }

  ngOnDestroy() {
    this.destroy$.next();
    this.destroy$.complete();
  }

  // Method 2: Using async pipe in template (recommended)
  // <div>{{ data$ | async }}</div>
  data$ = this.dataService.getData();

  // Method 3: Using toSignal (modern approach)
  data = toSignal(this.dataService.getData(), { initialValue: null });
}
```

## Transitioning to Push-Based Architecture

### 1. Incremental Adoption

You can adopt push-based architecture incrementally:

1. Start with new features
2. Refactor high-impact components
3. Create push-based services for global state
4. Update shared components to be push-based

### 2. Migration Strategy

When migrating existing components:

```typescript
// BEFORE: Pull-based component
@Component({
  template: `
    <div>{{ userData?.name }}</div>
    <button (click)="loadData()">Refresh</button>
  `,
})
export class UserComponent {
  userData: UserData | null = null;

  constructor(private userService: UserService) {}

  ngOnInit() {
    this.loadData();
  }

  loadData() {
    this.userService.getUser().subscribe((data) => {
      this.userData = data;
    });
  }
}

// AFTER: Push-based component
@Component({
  template: `
    <div>{{ userData()?.name }}</div>
    <button (click)="loadData()">Refresh</button>
  `,
})
export class UserComponent {
  userData = signal<UserData | null>(null);

  private userService = inject(UserService);

  constructor() {
    this.loadData();
  }

  loadData() {
    // Option 1: With async/await
    this.fetchUserData();

    // Option 2: With toSignal (alternative approach)
    // this.userData = toSignal(
    //  this.userService.getUser(),
    //  { initialValue: null }
    // );
  }

  private async fetchUserData() {
    try {
      const data = await firstValueFrom(this.userService.getUser());
      this.userData.set(data);
    } catch (error) {
      console.error('Failed to load user data', error);
    }
  }
}
```

## Conclusion

Push-based architecture represents a profound shift in how we build Angular applications. By embracing signals and RxJS for push-based reactivity, we create applications that are:

- More performant with optimized change detection
- Easier to understand with clear data flow
- More maintainable with decoupled components
- More testable with pure functions and injectable dependencies

Whether you're building a new application or migrating an existing one, push-based architecture offers substantial benefits that align perfectly with Angular's vision for reactive, component-based applications.

Key takeaways:

- Use signals for component state management
- Use RxJS for complex async operations
- Combine them with toSignal/toObservable when appropriate
- Follow consistent patterns for state organization
- Leverage OnPush change detection for performance
- Ensure proper cleanup of subscriptions
