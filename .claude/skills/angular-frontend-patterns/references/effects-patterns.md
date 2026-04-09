# Effect Patterns

Proper use of `effect()` in Angular signals.

## When to Use Effects

| ✅ Use Effects For    | ❌ Avoid Effects For            |
| --------------------- | ------------------------------- |
| Logging/analytics     | Deriving state (use `computed`) |
| localStorage sync     | Triggering HTTP calls           |
| DOM manipulation      | Setting other signals           |
| External integrations | Business logic                  |
| Debugging             | State transformations           |

## Basic Effect Patterns

### Logging / Analytics

```typescript
@Component({...})
export class ProductComponent {
  selectedProduct = input<Product | null>(null);

  constructor() {
    // Log when product changes
    effect(() => {
      const product = this.selectedProduct();
      if (product) {
        console.log('Product viewed:', product.id);
        this.analytics.trackProductView(product.id);
      }
    });
  }
}
```

### Local Storage Sync

```typescript
@Injectable({ providedIn: 'root' })
export class ThemeService {
  private _theme = signal<'light' | 'dark'>((localStorage.getItem('theme') as 'light' | 'dark') ?? 'light');

  theme = this._theme.asReadonly();

  constructor() {
    // Sync to localStorage whenever theme changes
    effect(() => {
      localStorage.setItem('theme', this._theme());
    });
  }

  setTheme(theme: 'light' | 'dark') {
    this._theme.set(theme);
  }
}
```

### DOM Manipulation

```typescript
@Component({
  selector: 'app-chart',
  template: `<canvas #canvas></canvas>`,
})
export class ChartComponent implements AfterViewInit {
  @ViewChild('canvas') canvasRef!: ElementRef<HTMLCanvasElement>;

  data = input.required<ChartData[]>();

  private chart: Chart | null = null;

  ngAfterViewInit() {
    // Initialize chart after view is ready
    this.chart = new Chart(this.canvasRef.nativeElement, {
      type: 'bar',
      data: { datasets: [] },
    });

    // Update chart when data changes
    effect(() => {
      const data = this.data();
      if (this.chart) {
        this.chart.data.datasets = [{ data }];
        this.chart.update();
      }
    });
  }
}
```

## Effect with Cleanup

```typescript
@Component({...})
export class WebSocketComponent {
  private wsService = inject(WebSocketService);

  channel = input.required<string>();
  messages = signal<Message[]>([]);

  constructor() {
    effect((onCleanup) => {
      const channel = this.channel();

      // Subscribe to channel
      const subscription = this.wsService
        .subscribe(channel)
        .subscribe(msg => {
          this.messages.update(m => [...m, msg]);
        });

      // Cleanup when channel changes or component destroys
      onCleanup(() => {
        subscription.unsubscribe();
        this.wsService.unsubscribe(channel);
      });
    });
  }
}
```

## Effect with allowSignalWrites

By default, effects cannot write to signals. Use `allowSignalWrites` sparingly.

```typescript
// ⚠️ Use sparingly - prefer computed() for derived state
@Component({...})
export class SearchComponent {
  searchTerm = signal('');
  debouncedTerm = signal('');

  constructor() {
    // Debounce pattern (one of few valid uses)
    effect((onCleanup) => {
      const term = this.searchTerm();

      const timeout = setTimeout(() => {
        this.debouncedTerm.set(term);
      }, 300);

      onCleanup(() => clearTimeout(timeout));
    }, { allowSignalWrites: true });
  }
}
```

### Better Alternative: RxJS for Debounce

```typescript
@Component({...})
export class SearchComponent {
  searchTerm = signal('');

  // Use RxJS for debounce, convert to signal
  debouncedTerm = toSignal(
    toObservable(this.searchTerm).pipe(
      debounceTime(300),
      distinctUntilChanged()
    ),
    { initialValue: '' }
  );
}
```

## Anti-Patterns to Avoid

### ❌ Setting Signals in Effects

```typescript
// BAD - Don't set signals in effects
effect(() => {
  const items = this.items();
  this.total.set(items.reduce((sum, i) => sum + i.price, 0));
});

// GOOD - Use computed instead
total = computed(() => this.items().reduce((sum, i) => sum + i.price, 0));
```

### ❌ Triggering HTTP Calls

```typescript
// BAD - Don't trigger HTTP in effects
effect(() => {
  const userId = this.userId();
  if (userId) {
    this.loadUser(userId); // This causes HTTP call
  }
});

// GOOD - Use RxJS with toSignal
private userId$ = toObservable(this.userId);

user = toSignal(
  this.userId$.pipe(
    filter(Boolean),
    switchMap(id => this.userService.getUser(id))
  )
);
```

### ❌ Complex Business Logic

```typescript
// BAD - Too much logic in effect
effect(() => {
  const order = this.order();
  const user = this.user();

  if (order.total > 100 && user.isPremium) {
    this.discount.set(order.total * 0.1);
  } else if (order.total > 50) {
    this.discount.set(order.total * 0.05);
  } else {
    this.discount.set(0);
  }
});

// GOOD - Use computed
discount = computed(() => {
  const order = this.order();
  const user = this.user();

  if (order.total > 100 && user.isPremium) {
    return order.total * 0.1;
  } else if (order.total > 50) {
    return order.total * 0.05;
  }
  return 0;
});
```

## Effect Injection Context

Effects must be created in an injection context:

```typescript
@Component({...})
export class MyComponent {
  private injector = inject(Injector);

  // ✅ In constructor - has injection context
  constructor() {
    effect(() => console.log(this.value()));
  }

  // ✅ In field initializer - has injection context
  private logger = effect(() => console.log(this.value()));

  // ❌ In method - no injection context
  ngOnInit() {
    // This will throw an error!
    effect(() => console.log(this.value()));
  }

  // ✅ Use injector if you must create in method
  setupEffect() {
    runInInjectionContext(this.injector, () => {
      effect(() => console.log(this.value()));
    });
  }
}
```

## Debugging with Effects

```typescript
@Component({...})
export class DebugComponent {
  user = signal<User | null>(null);
  permissions = signal<string[]>([]);
  settings = signal<Settings>({ theme: 'light' });

  constructor() {
    // Debug effect - log all state changes
    if (!environment.production) {
      effect(() => {
        console.group('State Update');
        console.log('User:', this.user());
        console.log('Permissions:', this.permissions());
        console.log('Settings:', this.settings());
        console.groupEnd();
      });
    }
  }
}
```

## Effect vs afterRender

| Hook                | When to Use                |
| ------------------- | -------------------------- |
| `effect()`          | React to signal changes    |
| `afterRender()`     | Run after every render     |
| `afterNextRender()` | Run once after next render |

```typescript
@Component({...})
export class CanvasComponent {
  data = input.required<number[]>();

  constructor() {
    // Effect - runs when data signal changes
    effect(() => {
      console.log('Data changed:', this.data());
    });

    // afterNextRender - runs once after first render
    afterNextRender(() => {
      this.initializeCanvas();
    });
  }

  // afterRender - runs after every render
  private renderRef = afterRender(() => {
    this.updateCanvasSize();
  });
}
```

## Summary: Effect Decision Tree

```
Need to derive state?
  → Use computed()

Need to react to async event?
  → Use RxJS operators + toSignal()

Need to sync with external system?
  → Use effect()
    - localStorage
    - DOM APIs
    - Third-party libraries
    - Analytics/logging

Need cleanup on change?
  → Use effect() with onCleanup callback

Need to debounce/throttle?
  → Prefer RxJS + toSignal()
  → Or effect() with allowSignalWrites (sparingly)
```
