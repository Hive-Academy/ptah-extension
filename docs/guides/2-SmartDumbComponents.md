# Smart and Dumb Components in Angular

## Introduction

The smart and dumb component pattern (also known as container and presentational components) is a powerful architectural approach for building maintainable Angular applications. This pattern promotes separation of concerns, reusability, and testability by dividing components into two distinct types with different responsibilities.

## Core Concepts

### Smart Components (Container Components)

Smart components are focused on **how things work**:

- Manage application state and data
- Connect to services and fetch data
- Perform business logic
- Pass data and callbacks to dumb components
- Rarely have their own styles or HTML markup
- Often serve as "orchestrators" of dumb components

### Dumb Components (Presentational Components)

Dumb components are focused on **how things look**:

- Accept data via inputs
- Emit events via outputs
- Don't depend directly on services
- Have minimal or no business logic
- Focused on presentation and UI
- Can be highly reusable across the application
- Usually have substantial HTML and CSS

## Implementation Examples

### Dumb Component: ProductCardComponent

```typescript
import { Component, input, output, EventEmitter } from '@angular/core';

@Component({
  selector: 'app-product-card',
  standalone: true,
  template: `
    <div class="card">
      <img [src]="product()?.imageUrl" [alt]="product()?.name" />
      <h3>{{ product()?.name }}</h3>
      <p>{{ product()?.price | currency }}</p>
      <button (click)="addToCart.emit(product()?.id)">Add to Cart</button>
    </div>
  `,
  styles: [
    `
      .card {
        padding: 16px;
        border: 1px solid #ccc;
        border-radius: 4px;
        max-width: 300px;
      }
      button {
        background-color: var(--primary-color);
        color: white;
        padding: 8px 16px;
        border: none;
        border-radius: 4px;
        cursor: pointer;
      }
    `,
  ],
})
export class ProductCardComponent {
  // Inputs
  product = input<{
    id: string;
    name: string;
    price: number;
    imageUrl: string;
  } | null>(null);

  // Outputs
  addToCart = output<string>();
}
```

### Smart Component: ProductListComponent

```typescript
import { Component, inject, OnInit } from '@angular/core';
import { AsyncPipe, NgFor, NgIf } from '@angular/common';
import { ProductCardComponent } from './product-card.component';
import { ProductService } from '../../services/product.service';
import { CartService } from '../../services/cart.service';
import { signal } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [NgIf, NgFor, AsyncPipe, ProductCardComponent],
  template: `
    @if (loading()) {
    <app-loading-spinner />
    } @else if (error()) {
    <div class="error">
      {{ error()?.message }}
      <button (click)="loadProducts()">Try Again</button>
    </div>
    } @else {
    <div class="product-grid">
      @for (product of products(); track product.id) {
      <app-product-card [product]="product" (addToCart)="addProductToCart($event)" />
      }
    </div>
    }
  `,
  styles: [
    `
      .product-grid {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
        gap: 24px;
      }
      .error {
        color: red;
        padding: 16px;
      }
    `,
  ],
})
export class ProductListComponent implements OnInit {
  // Inject services
  private productService = inject(ProductService);
  private cartService = inject(CartService);

  // State management
  loading = signal(true);
  error = signal<Error | null>(null);
  products = signal<Product[]>([]);

  ngOnInit() {
    this.loadProducts();
  }

  async loadProducts() {
    this.loading.set(true);
    this.error.set(null);

    try {
      const products = await this.productService.getProducts();
      this.products.set(products);
    } catch (err) {
      this.error.set(err as Error);
    } finally {
      this.loading.set(false);
    }
  }

  addProductToCart(productId: string) {
    this.cartService.addToCart(productId);
  }
}
```

## Benefits of the Pattern

### 1. Separation of Concerns

- **Smart components** focus on data and business logic
- **Dumb components** focus on presentation and UI
- Each component has a clear, single responsibility

### 2. Improved Reusability

- Dumb components can be reused across different features
- Smart components can recombine dumb components for different use cases
- Design systems and component libraries consist primarily of dumb components

### 3. Enhanced Testability

- Dumb components are easy to test in isolation
- Smart components can be tested with service mocks
- Clearer boundaries make it easier to write targeted tests

### 4. Better Development Workflow

- UI developers can focus on dumb components
- Logic developers can focus on smart components and services
- Parallel development becomes easier

### 5. Simplified Refactoring

- Changes to business logic don't affect presentation
- UI changes don't impact application logic
- Decoupled components are easier to modify independently

## Best Practices for Smart vs Dumb Components

### 1. Keep Dumb Components Truly Dumb

```typescript
// ❌ WRONG: Dumb component with service dependency
@Component({
  selector: 'app-user-profile',
  template: `<div>{{ user?.name }}</div>`,
})
export class UserProfileComponent {
  user: User | null = null;

  constructor(private userService: UserService) {
    this.user = this.userService.getCurrentUser();
  }
}

// ✅ CORRECT: Truly dumb component
@Component({
  selector: 'app-user-profile',
  template: `<div>{{ user()?.name }}</div>`,
})
export class UserProfileComponent {
  user = input<User | null>(null);
}
```

### 2. Smart Components Should Be Thin Orchestrators

```typescript
// ❌ WRONG: Too much logic in the component
@Component({
  // ...
})
export class ProductListComponent {
  products = signal<Product[]>([]);

  constructor(private http: HttpClient) {}

  ngOnInit() {
    this.http
      .get<Product[]>('/api/products')
      .pipe(
        map((products) => products.filter((p) => p.inStock)),
        catchError(this.handleError)
      )
      .subscribe((data) => this.products.set(data));
  }

  private handleError(error: HttpErrorResponse) {
    // Complex error handling logic
  }
}

// ✅ CORRECT: Logic moved to service, component just orchestrates
@Component({
  // ...
})
export class ProductListComponent {
  productsError = signal<Error | null>(null);

  private productService = inject(ProductService);
  products = toSignal(this.productService.getProducts(), {
    initialValue: [] as Product[],
  });
}
```

### 3. Data Flow Should Be Unidirectional

```typescript
// Smart component template with clear data flow down, events up
@Component({
  template: ` <app-product-form [initialData]="formData()" (save)="saveProduct($event)" (cancel)="navigateBack()"></app-product-form> `,
})
export class ProductEditorComponent {
  // Implementation
}
```

### 4. Component Structure Organization

Organize components by feature, separating smart and dumb components:

```
feature/
├── components/                  # Dumb components
│   ├── product-card.component.ts
│   ├── product-form.component.ts
│   └── rating-stars.component.ts
├── containers/                  # Smart components
│   ├── product-list.component.ts
│   ├── product-details.component.ts
│   └── product-editor.component.ts
├── feature.routes.ts            # Feature routes
└── feature.component.ts         # Feature shell component
```

### 5. Use Signals Effectively in Both Component Types

```typescript
// Dumb component with signal inputs
@Component({
  selector: 'app-pagination',
  template: `
    <div class="pagination">
      <button (click)="prev.emit()" [disabled]="currentPage() <= 1">Previous</button>
      <span>Page {{ currentPage() }} of {{ totalPages() }}</span>
      <button (click)="next.emit()" [disabled]="currentPage() >= totalPages()">Next</button>
    </div>
  `,
})
export class PaginationComponent {
  currentPage = input(1);
  totalPages = input(1);

  prev = output<void>();
  next = output<void>();
}

// Smart component using the dumb component
@Component({
  template: `
    <app-pagination [currentPage]="currentPage()" [totalPages]="totalPages()" (prev)="previousPage()" (next)="nextPage()"></app-pagination>

    <div class="items">
      @for (item of currentItems(); track item.id) {
      <app-item-card [item]="item" />
      }
    </div>
  `,
})
export class ItemListComponent {
  currentPage = signal(1);
  pageSize = signal(10);
  items = signal<Item[]>([]);

  totalPages = computed(() => {
    return Math.ceil(this.items().length / this.pageSize());
  });

  currentItems = computed(() => {
    const start = (this.currentPage() - 1) * this.pageSize();
    const end = start + this.pageSize();
    return this.items().slice(start, end);
  });

  nextPage() {
    if (this.currentPage() < this.totalPages()) {
      this.currentPage.update((page) => page + 1);
    }
  }

  previousPage() {
    if (this.currentPage() > 1) {
      this.currentPage.update((page) => page - 1);
    }
  }
}
```

## Advanced Patterns

### 1. Feature Shell Pattern

The feature shell is a specialized smart component that acts as the top-level coordinator for a feature:

```typescript
@Component({
  template: `
    <app-header [title]="'Product Management'" />

    <div class="content">
      <router-outlet></router-outlet>
    </div>

    <app-footer />
  `,
})
export class ProductFeatureComponent {
  constructor() {
    // Feature initialization logic
  }
}
```

### 2. Smart-to-Smart Communication via Services

For communication between smart components, use a shared service:

```typescript
@Injectable({ providedIn: 'root' })
export class ProductSelectionService {
  private selectedProductIdSignal = signal<string | null>(null);

  // Read-only public API
  public selectedProductId = this.selectedProductIdSignal.asReadonly();

  selectProduct(id: string | null): void {
    this.selectedProductIdSignal.set(id);
  }
}

// Used in multiple smart components
@Component({
  // ...
})
export class ProductDetailsComponent {
  private productService = inject(ProductService);
  private selectionService = inject(ProductSelectionService);

  selectedId = this.selectionService.selectedProductId;

  selectedProduct = computed(() => {
    const id = this.selectedId();
    if (!id) return null;

    return this.productService.getProductById(id);
  });
}
```

### 3. Dynamic Component Composition

Smart components can dynamically compose dumb components based on state:

```typescript
@Component({
  template: `
    <div class="dashboard">
      @for (widget of activeWidgets(); track widget.id) {
      <!-- Dynamic widget loading -->
      @switch (widget.type) { @case ('chart') {
      <app-chart-widget [data]="getWidgetData(widget.id)" [config]="widget.config" (refresh)="refreshWidget(widget.id)" />
      } @case ('list') {
      <app-list-widget [items]="getWidgetData(widget.id)" [config]="widget.config" (refresh)="refreshWidget(widget.id)" />
      } @default {
      <app-unknown-widget />
      } } }
    </div>
  `,
})
export class DashboardComponent {
  // Implementation with signals and data management
}
```

## Conclusion

The smart vs dumb component pattern is a powerful approach to structure Angular applications. By maintaining a clear separation between presentation and business logic, you can create more maintainable, testable, and reusable components. This pattern works especially well with Angular's signals for state management and the modern standalone components approach.

Remember:

- Smart components (containers) handle **what to show and when**
- Dumb components (presentational) handle **how to show it**
- Data flows down as inputs, events flow up as outputs
- Services should contain complex business logic
- Signals enhance both component types in different ways
