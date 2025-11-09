# Angular Signals: Comprehensive Guide

## Introduction to Signals

Angular Signals are a system for fine-grained reactivity in Angular applications. Introduced in Angular 16 and fully embraced in Angular 17+, signals provide a way to explicitly track and respond to state changes in your application.

## Core Signal Types

### 1. Writable Signals

Writable signals are the foundation of the signals architecture. They represent values that can be changed directly.

```typescript
import { signal } from '@angular/core';

// Create a writable signal with an initial value
const count = signal(0);

// Read the current value
console.log(count()); // 0

// Update methods
count.set(5); // Direct replacement
count.update((value) => value + 1); // Update based on current value
```

### 2. Computed Signals

Computed signals derive their value from other signals.

```typescript
import { signal, computed } from '@angular/core';

const price = signal(100);
const quantity = signal(2);

// Computed values automatically update when dependencies change
const total = computed(() => price() * quantity());
console.log(total()); // 200

price.set(150);
console.log(total()); // 300
```

Key characteristics:

- **Memoized**: Values are calculated only when needed and cached until dependencies change
- **Read-only**: Cannot be directly modified (no `set` or `update` methods)
- **Auto-tracking**: Automatically tracks signal dependencies
- **Synchronous**: Always provides a value immediately

### 3. Effects

Effects allow you to perform side effects when signals change.

```typescript
import { signal, effect } from '@angular/core';

const userData = signal({ name: 'Alice', role: 'Admin' });

// Effects run initially and then whenever dependencies change
effect(() => {
  console.log(`User changed: ${userData().name}, ${userData().role}`);

  // Call APIs, update DOM, or perform other side effects
  saveToLocalStorage('userData', userData());
});
```

Key characteristics:

- **Automatic cleanup**: Effects created in components are destroyed when the component is destroyed
- **Asynchronous by default**: Run after render to prevent ExpressionChangedAfterItHasBeenChecked errors
- **Not for state propagation**: Use computed signals instead of effects for derived state

## Signal Inputs

Angular 17+ introduced signal-based inputs that are more efficient and provide better type safety:

```typescript
import { Component, input } from '@angular/core';

@Component({
  selector: 'app-user-profile',
  standalone: true,
  template: `
    <div>{{ name() }}</div>
    <div>{{ isActive() ? 'Active' : 'Inactive' }}</div>
    <div>Count: {{ count() }}</div>
  `,
})
export class UserProfileComponent {
  // Basic input
  name = input<string>('Guest');

  // Required input
  userId = input.required<string>();

  // With transform
  isActive = input(false, { transform: booleanAttribute });
  count = input(0, { transform: numberAttribute });

  // With alias
  apiUrl = input('https://api.example.com', { alias: 'serviceUrl' });
}
```

## Model Inputs (Two-way Binding)

For two-way binding scenarios, Angular 17+ provides model inputs:

```typescript
import { Component, model } from '@angular/core';

@Component({
  selector: 'app-counter',
  standalone: true,
  template: `
    <button (click)="decrement()">-</button>
    <span>{{ value() }}</span>
    <button (click)="increment()">+</button>
  `,
})
export class CounterComponent {
  // Creates an input with change propagation
  value = model(0);

  increment() {
    this.value.update((v) => v + 1);
  }

  decrement() {
    this.value.update((v) => v - 1);
  }
}

// Usage in parent:
// <app-counter [(value)]="parentValue" />
```

## RxJS Integration

Angular provides tools to bridge between signals and RxJS:

```typescript
import { Component, signal } from '@angular/core';
import { toSignal, toObservable } from '@angular/core/rxjs-interop';
import { map } from 'rxjs/operators';

@Component({
  // ...
})
export class WeatherComponent {
  // Convert observable to signal
  private weatherService = inject(WeatherService);
  weather = toSignal(this.weatherService.getWeather().pipe(map((data) => data.current)), { initialValue: null });

  // Convert signal to observable
  location = signal('New York');
  location$ = toObservable(this.location);

  // Use the observable
  ngOnInit() {
    this.location$.subscribe((loc) => {
      console.log(`Location changed to ${loc}`);
    });
  }
}
```

## Best Practices for Using Signals

### 1. Signal Organization

```typescript
// Component state organization
@Component({
  // ...
})
export class ProductListComponent {
  // 1. Input signals
  category = input<string>('all');

  // 2. Inject dependencies
  private productService = inject(ProductService);

  // 3. Internal state signals
  loading = signal(false);
  error = signal<Error | null>(null);
  products = signal<Product[]>([]);

  // 4. Computed signals
  filteredProducts = computed(() => {
    const currentCategory = this.category();
    if (currentCategory === 'all') {
      return this.products();
    }
    return this.products().filter((p) => p.category === currentCategory);
  });

  totalValue = computed(() => {
    return this.filteredProducts().reduce((sum, p) => sum + p.price, 0);
  });

  // 5. Methods for state updates
  async loadProducts() {
    this.loading.set(true);
    try {
      const data = await this.productService.getProducts();
      this.products.set(data);
      this.error.set(null);
    } catch (err) {
      this.error.set(err as Error);
    } finally {
      this.loading.set(false);
    }
  }
}
```

### 2. When to Use Signals vs. RxJS

| Scenario                                            | Recommended Approach                      |
| --------------------------------------------------- | ----------------------------------------- |
| Simple component state                              | Signals                                   |
| Form state                                          | Signals + model inputs                    |
| HTTP requests with simple transformations           | Signals + toSignal                        |
| Complex async workflows (debounce, switchMap, etc.) | RxJS → toSignal at component boundary     |
| Complex event streams                               | RxJS                                      |
| Global state/services                               | Signals or RxJS (depending on complexity) |

### 3. Common Anti-Patterns to Avoid

1. **Using effects for state propagation**

   ```typescript
   // ❌ WRONG: Using effect to update another signal
   effect(() => {
     displayName.set(user().firstName + ' ' + user().lastName);
   });

   // ✅ CORRECT: Use computed signal instead
   const displayName = computed(() => user().firstName + ' ' + user().lastName);
   ```

2. **Creating circular dependencies**

   ```typescript
   // ❌ WRONG: Creating circular dependency
   const a = signal(0);
   const b = computed(() => a() + 1);

   effect(() => {
     a.set(b()); // Circular dependency!
   });

   // ✅ CORRECT: Avoid circular updates
   ```

3. **Overusing effects**

   ```typescript
   // ❌ WRONG: Effect for simple derived data
   effect(() => {
     this.fullName = `${this.firstName()} ${this.lastName()}`;
   });

   // ✅ CORRECT: Use computed
   this.fullName = computed(() => `${this.firstName()} ${this.lastName()}`);
   ```

4. **Not considering signal equality**

   ```typescript
   // ❌ WRONG: Creates new object reference each time
   const user = signal({ name: 'Alice' });
   user.update((u) => ({ ...u, lastSeen: new Date() })); // New object each time

   // ✅ CORRECT: Use the equals option to customize comparison if needed
   const user = signal(
     { name: 'Alice' },
     {
       equal: (a, b) => a.name === b.name,
     }
   );
   ```

### 4. Performance Optimization

1. **Minimize signal reads in templates**

   ```html
   <!-- ❌ WRONG: Multiple reads of the same signal -->
   <div>{{ user().name }}'s profile ({{ user().role }})</div>

   <!-- ✅ CORRECT: Single read with computed or local variable -->
   <div>{{ userInfo() }}</div>
   ```

   ```typescript
   userInfo = computed(() => `${this.user().name}'s profile (${this.user().role})`);
   ```

2. **Granular signals instead of large objects**

   ```typescript
   // ❌ WRONG: Single large state object
   const formState = signal({
     name: '',
     email: '',
     address: '',
     // many more fields
   });

   // ✅ CORRECT: Granular signals for frequently changing values
   const name = signal('');
   const email = signal('');
   const address = signal('');
   ```

## Advanced Signal Patterns

### 1. Signal-Based Services

```typescript
@Injectable({ providedIn: 'root' })
export class UserService {
  private userSignal = signal<User | null>(null);

  // Public read-only API (prevents external mutation)
  public user = this.userSignal.asReadonly();

  // Computed properties
  public isLoggedIn = computed(() => this.userSignal() !== null);
  public userRoles = computed(() => this.userSignal()?.roles || []);

  async login(credentials: Credentials): Promise<void> {
    try {
      const user = await this.authApi.login(credentials);
      this.userSignal.set(user);
    } catch (error) {
      throw new Error('Login failed');
    }
  }

  logout(): void {
    this.userSignal.set(null);
  }
}
```

### 2. Signal Collections with Key-Based Updates

```typescript
@Component({
  // ...
})
export class TaskListComponent {
  tasks = signal<Map<string, Task>>(new Map());

  // Add or update a task
  upsertTask(task: Task) {
    this.tasks.update((tasks) => {
      const updated = new Map(tasks);
      updated.set(task.id, task);
      return updated;
    });
  }

  // Delete a task
  removeTask(id: string) {
    this.tasks.update((tasks) => {
      const updated = new Map(tasks);
      updated.delete(id);
      return updated;
    });
  }

  // Update a task property
  updateTaskStatus(id: string, completed: boolean) {
    this.tasks.update((tasks) => {
      const updated = new Map(tasks);
      const task = updated.get(id);
      if (task) {
        updated.set(id, { ...task, completed });
      }
      return updated;
    });
  }

  // Convert Map to array for display
  taskList = computed(() => Array.from(this.tasks().values()));
}
```

### 3. Combining Signals with NgOnChanges

```typescript
@Component({
  selector: 'app-legacy-adapter',
  standalone: false, // Using legacy component approach
  // ...
})
export class LegacyAdapterComponent implements OnChanges {
  @Input() userId: string;
  @Input() showDetails: boolean;

  // Internal signals
  private userIdSignal = signal<string>('');
  private showDetailsSignal = signal(false);

  // Computed based on inputs
  userData = computed(() => {
    const id = this.userIdSignal();
    return id ? this.fetchUserData(id) : null;
  });

  ngOnChanges(changes: SimpleChanges): void {
    if (changes['userId']) {
      this.userIdSignal.set(this.userId);
    }
    if (changes['showDetails']) {
      this.showDetailsSignal.set(this.showDetails);
    }
  }

  private fetchUserData(id: string) {
    // Implementation
  }
}
```

## Conclusion

Angular Signals provide a powerful, fine-grained reactivity system that complements RxJS in Angular applications. By following the best practices outlined in this guide, you can build more maintainable and performant applications with clearer data flow and better developer experience.

Remember:

- Use writable signals for mutable state
- Use computed signals for derived state
- Use effects sparingly and only for side effects
- Leverage the integration with RxJS when needed
- Follow consistent patterns for signal organization
