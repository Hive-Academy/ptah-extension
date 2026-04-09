# Forms with Signals

Signal-based form patterns for Angular.

## Basic Signal Form

```typescript
@Component({
  selector: 'app-user-form',
  template: `
    <form (ngSubmit)="onSubmit()">
      <div class="field">
        <label for="name">Name</label>
        <input id="name" type="text" [value]="form().name" (input)="updateField('name', $event)" />
        @if (errors().name) {
          <span class="error">{{ errors().name }}</span>
        }
      </div>

      <div class="field">
        <label for="email">Email</label>
        <input id="email" type="email" [value]="form().email" (input)="updateField('email', $event)" />
        @if (errors().email) {
          <span class="error">{{ errors().email }}</span>
        }
      </div>

      <button type="submit" [disabled]="!isValid() || submitting()">
        {{ submitting() ? 'Saving...' : 'Save' }}
      </button>
    </form>
  `,
})
export class UserFormComponent {
  private userService = inject(UserService);

  // Form state
  form = signal<UserForm>({
    name: '',
    email: '',
  });

  touched = signal<Record<string, boolean>>({});
  submitting = signal(false);

  // Validation
  errors = computed(() => {
    const f = this.form();
    const t = this.touched();
    const errors: Record<string, string> = {};

    if (t['name'] && !f.name) {
      errors['name'] = 'Name is required';
    }

    if (t['email']) {
      if (!f.email) {
        errors['email'] = 'Email is required';
      } else if (!this.isValidEmail(f.email)) {
        errors['email'] = 'Invalid email format';
      }
    }

    return errors;
  });

  isValid = computed(() => {
    const f = this.form();
    return f.name.length > 0 && this.isValidEmail(f.email);
  });

  updateField(field: keyof UserForm, event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.form.update((f) => ({ ...f, [field]: value }));
    this.touched.update((t) => ({ ...t, [field]: true }));
  }

  async onSubmit() {
    // Mark all touched
    this.touched.set(Object.keys(this.form()).reduce((acc, key) => ({ ...acc, [key]: true }), {}));

    if (!this.isValid()) return;

    this.submitting.set(true);
    try {
      await this.userService.save(this.form());
    } finally {
      this.submitting.set(false);
    }
  }

  private isValidEmail(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }
}
```

## Reactive Forms with Signal State

```typescript
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { toSignal } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-product-form',
  standalone: true,
  imports: [ReactiveFormsModule],
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div class="field">
        <label for="name">Product Name</label>
        <input id="name" formControlName="name" />
        @if (showError('name')) {
          <span class="error">
            @if (form.controls.name.errors?.['required']) {
              Name is required
            } @else if (form.controls.name.errors?.['minlength']) {
              Name must be at least 3 characters
            }
          </span>
        }
      </div>

      <div class="field">
        <label for="price">Price</label>
        <input id="price" type="number" formControlName="price" />
      </div>

      <div class="field">
        <label for="category">Category</label>
        <select formControlName="category">
          @for (cat of categories(); track cat.id) {
            <option [value]="cat.id">{{ cat.name }}</option>
          }
        </select>
      </div>

      <fieldset formGroupName="dimensions">
        <legend>Dimensions</legend>
        <input formControlName="width" placeholder="Width" type="number" />
        <input formControlName="height" placeholder="Height" type="number" />
        <input formControlName="depth" placeholder="Depth" type="number" />
      </fieldset>

      <p>Total: {{ calculatedPrice() | currency }}</p>

      <button type="submit" [disabled]="form.invalid || submitting()">Save</button>
    </form>
  `,
})
export class ProductFormComponent implements OnInit {
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);
  private categoryService = inject(CategoryService);

  categories = this.categoryService.categories;
  submitting = signal(false);

  form = this.fb.nonNullable.group({
    name: ['', [Validators.required, Validators.minLength(3)]],
    price: [0, [Validators.required, Validators.min(0)]],
    category: [''],
    dimensions: this.fb.nonNullable.group({
      width: [0],
      height: [0],
      depth: [0],
    }),
  });

  // Convert form values to signal for reactive computations
  formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  // Computed from form signal
  calculatedPrice = computed(() => {
    const { price, dimensions } = this.formValue();
    const volume = (dimensions?.width ?? 0) * (dimensions?.height ?? 0) * (dimensions?.depth ?? 0);
    // Price + shipping based on volume
    return (price ?? 0) + (volume > 1000 ? 10 : 5);
  });

  // Input for editing existing product
  product = input<Product | null>(null);

  ngOnInit() {
    // Populate form when product input changes
    effect(() => {
      const product = this.product();
      if (product) {
        this.form.patchValue(product);
      }
    });
  }

  showError(field: string): boolean {
    const control = this.form.get(field);
    return control ? control.invalid && control.touched : false;
  }

  async onSubmit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }

    this.submitting.set(true);
    try {
      await this.productService.save(this.form.getRawValue());
    } finally {
      this.submitting.set(false);
    }
  }
}
```

## Form Array Pattern

```typescript
@Component({
  selector: 'app-order-form',
  template: `
    <form [formGroup]="form" (ngSubmit)="onSubmit()">
      <div formArrayName="items">
        @for (item of itemsArray.controls; track i; let i = $index) {
          <div [formGroupName]="i" class="item-row">
            <select formControlName="productId">
              @for (product of products(); track product.id) {
                <option [value]="product.id">{{ product.name }}</option>
              }
            </select>

            <input type="number" formControlName="quantity" min="1" />

            <span class="subtotal">
              {{ itemSubtotal(i) | currency }}
            </span>

            <button type="button" (click)="removeItem(i)">Remove</button>
          </div>
        }
      </div>

      <button type="button" (click)="addItem()">Add Item</button>

      <div class="totals">
        <p>Subtotal: {{ subtotal() | currency }}</p>
        <p>Tax: {{ tax() | currency }}</p>
        <p>
          <strong>Total: {{ total() | currency }}</strong>
        </p>
      </div>

      <button type="submit">Place Order</button>
    </form>
  `,
})
export class OrderFormComponent {
  private fb = inject(FormBuilder);
  private productService = inject(ProductService);

  products = this.productService.products;

  form = this.fb.nonNullable.group({
    customerId: ['', Validators.required],
    items: this.fb.array<FormGroup<OrderItemForm>>([]),
  });

  get itemsArray() {
    return this.form.controls.items;
  }

  // Convert to signal for computations
  formValue = toSignal(this.form.valueChanges, {
    initialValue: this.form.getRawValue(),
  });

  itemSubtotal(index: number): number {
    const items = this.formValue().items;
    const item = items?.[index];
    if (!item) return 0;

    const product = this.products().find((p) => p.id === item.productId);
    return (product?.price ?? 0) * (item.quantity ?? 0);
  }

  subtotal = computed(() => {
    const items = this.formValue().items ?? [];
    return items.reduce((sum, item, i) => sum + this.itemSubtotal(i), 0);
  });

  tax = computed(() => this.subtotal() * 0.1);
  total = computed(() => this.subtotal() + this.tax());

  addItem() {
    const itemGroup = this.fb.nonNullable.group({
      productId: ['', Validators.required],
      quantity: [1, [Validators.required, Validators.min(1)]],
    });
    this.itemsArray.push(itemGroup);
  }

  removeItem(index: number) {
    this.itemsArray.removeAt(index);
  }
}
```

## Custom Validators with Signals

```typescript
// validators.ts
export function createAsyncValidator(
  checkFn: (value: string) => Observable<boolean>
): AsyncValidatorFn {
  return (control: AbstractControl) => {
    return checkFn(control.value).pipe(
      map(exists => exists ? { exists: true } : null),
      catchError(() => of(null))
    );
  };
}

// Component using async validator
@Component({...})
export class RegisterComponent {
  private userService = inject(UserService);

  form = this.fb.nonNullable.group({
    email: ['',
      [Validators.required, Validators.email],
      [createAsyncValidator(email => this.userService.checkEmailExists(email))]
    ],
    username: ['',
      [Validators.required],
      [createAsyncValidator(name => this.userService.checkUsernameExists(name))]
    ],
    password: ['', [Validators.required, Validators.minLength(8)]],
    confirmPassword: ['', [Validators.required]],
  }, {
    validators: [this.passwordMatchValidator]
  });

  // Pending state as signal
  emailPending = toSignal(
    this.form.controls.email.statusChanges.pipe(
      map(status => status === 'PENDING')
    ),
    { initialValue: false }
  );

  private passwordMatchValidator(group: FormGroup): ValidationErrors | null {
    const password = group.get('password')?.value;
    const confirm = group.get('confirmPassword')?.value;
    return password === confirm ? null : { passwordMismatch: true };
  }
}
```

## Two-Way Binding with model()

```typescript
// Reusable input component
@Component({
  selector: 'app-text-input',
  template: `
    <div class="input-wrapper">
      <label [for]="id()">{{ label() }}</label>
      <input [id]="id()" [type]="type()" [value]="value()" [placeholder]="placeholder()" (input)="onInput($event)" (blur)="onBlur()" />
      @if (error()) {
        <span class="error">{{ error() }}</span>
      }
    </div>
  `,
})
export class TextInputComponent {
  // Two-way binding via model
  value = model('');

  // Regular inputs
  label = input.required<string>();
  id = input.required<string>();
  type = input<'text' | 'email' | 'password'>('text');
  placeholder = input('');
  error = input<string | null>(null);

  onInput(event: Event) {
    const value = (event.target as HTMLInputElement).value;
    this.value.set(value);
  }

  blur = output<void>();

  onBlur() {
    this.blur.emit();
  }
}

// Usage
@Component({
  template: `
    <app-text-input id="email" label="Email" type="email" [(value)]="email" [error]="emailError()" />

    <p>Current email: {{ email() }}</p>
  `,
})
export class ParentComponent {
  email = signal('');

  emailError = computed(() => {
    const email = this.email();
    if (!email) return 'Required';
    if (!email.includes('@')) return 'Invalid email';
    return null;
  });
}
```

## Form State Management Service

```typescript
@Injectable()
export class FormStateService<T extends object> {
  private _form = signal<T>({} as T);
  private _touched = signal<Set<keyof T>>(new Set());
  private _submitting = signal(false);
  private _errors = signal<Partial<Record<keyof T, string>>>({});

  form = this._form.asReadonly();
  touched = this._touched.asReadonly();
  submitting = this._submitting.asReadonly();
  errors = this._errors.asReadonly();

  isDirty = computed(() => {
    // Compare with initial
    return JSON.stringify(this._form()) !== JSON.stringify(this.initialValue);
  });

  private initialValue: T = {} as T;

  initialize(value: T) {
    this.initialValue = structuredClone(value);
    this._form.set(value);
    this._touched.set(new Set());
    this._errors.set({});
  }

  updateField<K extends keyof T>(field: K, value: T[K]) {
    this._form.update((f) => ({ ...f, [field]: value }));
    this._touched.update((t) => new Set(t).add(field));
  }

  setError(field: keyof T, error: string | null) {
    this._errors.update((e) => {
      if (error) {
        return { ...e, [field]: error };
      } else {
        const { [field]: _, ...rest } = e;
        return rest as Partial<Record<keyof T, string>>;
      }
    });
  }

  async submit(handler: (value: T) => Promise<void>) {
    this._submitting.set(true);
    try {
      await handler(this._form());
    } finally {
      this._submitting.set(false);
    }
  }

  reset() {
    this._form.set(structuredClone(this.initialValue));
    this._touched.set(new Set());
    this._errors.set({});
  }
}

// Usage
@Component({
  providers: [FormStateService],
})
export class EditUserComponent implements OnInit {
  formState = inject(FormStateService<UserForm>);

  ngOnInit() {
    this.formState.initialize({
      name: '',
      email: '',
    });
  }
}
```
