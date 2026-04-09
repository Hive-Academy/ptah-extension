# Component Patterns

Smart/dumb component architecture and composition patterns.

## Component Types

### Smart (Container) Components

**Location:** `libs/[domain]/feature/src/lib/`

**Responsibilities:**

- Inject services
- Manage state
- Handle business logic
- Coordinate child components
- Router interactions

```typescript
// Feature: Order management
// libs/orders/feature/src/lib/order-list.component.ts
@Component({
  selector: 'app-order-list',
  standalone: true,
  imports: [OrderTableComponent, OrderFiltersComponent, OrderActionsComponent, AsyncPipe],
  template: `
    <div class="order-list">
      <app-order-filters [filters]="currentFilters()" (filtersChange)="onFiltersChange($event)" />

      @if (loading()) {
        <app-skeleton-table [rows]="5" />
      } @else if (error()) {
        <app-error-state [message]="error()" (retry)="loadOrders()" />
      } @else {
        <app-order-table [orders]="orders()" [selectedIds]="selectedIds()" (select)="onSelect($event)" (sort)="onSort($event)" />

        <app-order-actions [selectedCount]="selectedIds().length" (bulkAction)="onBulkAction($event)" />
      }

      <app-pagination [total]="total()" [page]="page()" [pageSize]="pageSize()" (pageChange)="onPageChange($event)" />
    </div>
  `,
})
export class OrderListComponent implements OnInit {
  private orderService = inject(OrderService);
  private router = inject(Router);
  private route = inject(ActivatedRoute);

  // State
  orders = this.orderService.orders;
  loading = this.orderService.loading;
  error = this.orderService.error;
  total = this.orderService.total;

  // Local state
  selectedIds = signal<string[]>([]);
  currentFilters = signal<OrderFilters>({});
  page = signal(1);
  pageSize = signal(20);
  sort = signal<SortConfig | null>(null);

  ngOnInit() {
    this.loadOrders();
  }

  loadOrders() {
    this.orderService.loadOrders({
      filters: this.currentFilters(),
      page: this.page(),
      pageSize: this.pageSize(),
      sort: this.sort(),
    });
  }

  onFiltersChange(filters: OrderFilters) {
    this.currentFilters.set(filters);
    this.page.set(1);
    this.loadOrders();
  }

  onPageChange(page: number) {
    this.page.set(page);
    this.loadOrders();
  }

  onSort(sort: SortConfig) {
    this.sort.set(sort);
    this.loadOrders();
  }

  onSelect(ids: string[]) {
    this.selectedIds.set(ids);
  }

  onBulkAction(action: BulkActionEvent) {
    const ids = this.selectedIds();
    switch (action.type) {
      case 'delete':
        this.orderService.deleteMany(ids);
        break;
      case 'export':
        this.orderService.exportOrders(ids);
        break;
    }
    this.selectedIds.set([]);
  }
}
```

### Dumb (Presentational) Components

**Location:** `libs/[domain]/ui/src/lib/` or `libs/shared/ui/src/lib/`

**Responsibilities:**

- Render UI based on inputs
- Emit events for user actions
- No direct service injection
- No router knowledge
- Pure and predictable

```typescript
// libs/orders/ui/src/lib/order-table/order-table.component.ts
@Component({
  selector: 'app-order-table',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DatePipe, CurrencyPipe, StatusBadgeComponent],
  template: `
    <table class="table">
      <thead>
        <tr>
          <th class="checkbox">
            <input type="checkbox" [checked]="allSelected()" [indeterminate]="someSelected()" (change)="toggleAll()" />
          </th>
          @for (col of columns; track col.key) {
            <th [class.sortable]="col.sortable" (click)="col.sortable && onSort(col.key)">
              {{ col.label }}
              @if (currentSort()?.key === col.key) {
                <span class="sort-icon">
                  {{ currentSort()?.direction === 'asc' ? '↑' : '↓' }}
                </span>
              }
            </th>
          }
        </tr>
      </thead>
      <tbody>
        @for (order of orders(); track order.id) {
          <tr [class.selected]="isSelected(order.id)" (click)="onRowClick(order)">
            <td class="checkbox">
              <input type="checkbox" [checked]="isSelected(order.id)" (click)="$event.stopPropagation()" (change)="toggleSelect(order.id)" />
            </td>
            <td>{{ order.orderNumber }}</td>
            <td>{{ order.customer.name }}</td>
            <td>{{ order.createdAt | date: 'medium' }}</td>
            <td>{{ order.total | currency }}</td>
            <td>
              <app-status-badge [status]="order.status" />
            </td>
          </tr>
        } @empty {
          <tr>
            <td colspan="6" class="empty">No orders found</td>
          </tr>
        }
      </tbody>
    </table>
  `,
})
export class OrderTableComponent {
  // Inputs
  orders = input.required<Order[]>();
  selectedIds = input<string[]>([]);
  sortConfig = input<SortConfig | null>(null);

  // Outputs
  select = output<string[]>();
  sort = output<SortConfig>();
  rowClick = output<Order>();

  // Column config
  columns: ColumnDef[] = [
    { key: 'orderNumber', label: 'Order #', sortable: true },
    { key: 'customer', label: 'Customer', sortable: true },
    { key: 'createdAt', label: 'Date', sortable: true },
    { key: 'total', label: 'Total', sortable: true },
    { key: 'status', label: 'Status', sortable: false },
  ];

  // Computed state
  currentSort = computed(() => this.sortConfig());

  allSelected = computed(() => {
    const orders = this.orders();
    const selected = this.selectedIds();
    return orders.length > 0 && orders.every((o) => selected.includes(o.id));
  });

  someSelected = computed(() => {
    const orders = this.orders();
    const selected = this.selectedIds();
    return selected.length > 0 && !this.allSelected();
  });

  isSelected(id: string): boolean {
    return this.selectedIds().includes(id);
  }

  toggleSelect(id: string) {
    const current = this.selectedIds();
    const newSelection = this.isSelected(id) ? current.filter((i) => i !== id) : [...current, id];
    this.select.emit(newSelection);
  }

  toggleAll() {
    if (this.allSelected()) {
      this.select.emit([]);
    } else {
      this.select.emit(this.orders().map((o) => o.id));
    }
  }

  onSort(key: string) {
    const current = this.currentSort();
    const newDirection = current?.key === key && current.direction === 'asc' ? 'desc' : 'asc';
    this.sort.emit({ key, direction: newDirection });
  }

  onRowClick(order: Order) {
    this.rowClick.emit(order);
  }
}
```

## Composition Patterns

### Content Projection

```typescript
@Component({
  selector: 'app-card',
  template: `
    <div class="card">
      <header class="card-header">
        <ng-content select="[card-title]" />
        <div class="card-actions">
          <ng-content select="[card-actions]" />
        </div>
      </header>
      <div class="card-body">
        <ng-content />
      </div>
      @if (hasFooter()) {
        <footer class="card-footer">
          <ng-content select="[card-footer]" />
        </footer>
      }
    </div>
  `,
})
export class CardComponent {
  @ContentChild('cardFooter') footerContent?: TemplateRef<any>;
  hasFooter = computed(() => !!this.footerContent);
}

// Usage
<app-card>
  <h2 card-title>Order Details</h2>
  <button card-actions>Edit</button>

  <!-- Default slot -->
  <p>Order content here...</p>

  <div card-footer>
    <button>Save</button>
  </div>
</app-card>
```

### Template Outlets

```typescript
@Component({
  selector: 'app-data-list',
  template: `
    @if (loading()) {
      <ng-container
        [ngTemplateOutlet]="loadingTemplate() || defaultLoading"
      />
    } @else if (error()) {
      <ng-container
        [ngTemplateOutlet]="errorTemplate() || defaultError"
        [ngTemplateOutletContext]="{ $implicit: error() }"
      />
    } @else {
      @for (item of items(); track trackBy()(item)) {
        <ng-container
          [ngTemplateOutlet]="itemTemplate()"
          [ngTemplateOutletContext]="{ $implicit: item, index: $index }"
        />
      } @empty {
        <ng-container
          [ngTemplateOutlet]="emptyTemplate() || defaultEmpty"
        />
      }
    }

    <ng-template #defaultLoading>
      <div class="loading">Loading...</div>
    </ng-template>

    <ng-template #defaultError let-error>
      <div class="error">{{ error }}</div>
    </ng-template>

    <ng-template #defaultEmpty>
      <div class="empty">No items</div>
    </ng-template>
  `,
})
export class DataListComponent<T> {
  items = input.required<T[]>();
  trackBy = input<(item: T) => any>(() => (item: any) => item.id);
  loading = input(false);
  error = input<string | null>(null);

  itemTemplate = input.required<TemplateRef<{ $implicit: T; index: number }>>();
  loadingTemplate = input<TemplateRef<void>>();
  errorTemplate = input<TemplateRef<{ $implicit: string }>>();
  emptyTemplate = input<TemplateRef<void>>();
}

// Usage
<app-data-list
  [items]="users()"
  [loading]="loading()"
  [itemTemplate]="userRow"
  [loadingTemplate]="customLoading"
>
  <ng-template #userRow let-user let-idx="index">
    <div class="user-row">
      {{ idx + 1 }}. {{ user.name }}
    </div>
  </ng-template>

  <ng-template #customLoading>
    <app-skeleton [count]="5" />
  </ng-template>
</app-data-list>
```

### Directive Composition

```typescript
// Shared directive
@Directive({
  selector: '[appTooltip]',
  standalone: true,
})
export class TooltipDirective {
  text = input.required<string>({ alias: 'appTooltip' });
  position = input<'top' | 'bottom' | 'left' | 'right'>('top');
  // Implementation...
}

// Compose in component
@Component({
  selector: 'app-icon-button',
  standalone: true,
  hostDirectives: [
    {
      directive: TooltipDirective,
      inputs: ['appTooltip: tooltip', 'position: tooltipPosition'],
    },
  ],
  template: `
    <button [class]="buttonClass()">
      <app-icon [name]="icon()" />
      <ng-content />
    </button>
  `,
})
export class IconButtonComponent {
  icon = input.required<string>();
  variant = input<'primary' | 'secondary'>('primary');

  buttonClass = computed(() => `btn btn-${this.variant()}`);
}

// Usage - tooltip comes from host directive
<app-icon-button icon="save" tooltip="Save changes" tooltipPosition="bottom">
  Save
</app-icon-button>;
```

## Component Organization

```
libs/
└── [domain]/
    ├── feature/                 # Smart components
    │   └── src/lib/
    │       ├── [feature].component.ts
    │       └── [feature].routes.ts
    │
    ├── ui/                      # Dumb components (domain-specific)
    │   └── src/lib/
    │       ├── [component]/
    │       │   ├── [component].component.ts
    │       │   └── [component].component.spec.ts
    │       └── index.ts
    │
    └── data-access/             # Services, state
        └── src/lib/
            └── [domain].service.ts

libs/
└── shared/
    └── ui/                      # Dumb components (shared across domains)
        └── src/lib/
            ├── button/
            ├── card/
            ├── modal/
            └── data-table/
```
