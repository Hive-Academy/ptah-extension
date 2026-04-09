# Library Types Deep Dive

## Overview

Libraries are the building blocks of an Nx monorepo. Each type has specific responsibilities and constraints.

## 1. Feature Libraries

### Angular Feature Libraries

Container/smart components that implement business use cases.

```typescript
// libs/user-management/feature/src/lib/user-profile.component.ts
@Component({
  selector: 'app-user-profile',
  standalone: true,
  imports: [UserCardComponent, AsyncPipe],
  template: ` <app-user-card [user]="user()" (onEdit)="handleEdit($event)" /> `,
})
export class UserProfileComponent {
  private userService = inject(UserService);

  user = toSignal(this.userService.currentUser$);

  handleEdit(userId: string) {
    // Navigate or trigger edit flow
  }
}
```

**Characteristics:**

- Connects to services and state
- Contains routing configuration
- Can be lazy-loaded
- Imports UI components

### NestJS Feature-API Libraries

API controllers and endpoint logic.

```typescript
// libs/user-management/feature-api/src/lib/users.controller.ts
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get(':id')
  async findOne(@Param('id') id: string): Promise<UserDto> {
    return this.usersService.findById(id);
  }

  @Post()
  async create(@Body() dto: CreateUserDto): Promise<UserDto> {
    return this.usersService.create(dto);
  }
}
```

---

## 2. UI Libraries (Angular Only)

Presentational/dumb components that receive data via inputs.

```typescript
// libs/shared/ui/src/lib/user-card/user-card.component.ts
@Component({
  selector: 'app-user-card',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="user-card">
      <img [src]="user().avatarUrl" />
      <h3>{{ user().name }}</h3>
      <button (click)="onEdit.emit(user().id)">Edit</button>
    </div>
  `,
})
export class UserCardComponent {
  user = input.required<User>();
  onEdit = output<string>();
}
```

**Characteristics:**

- No service injection (only inject design tokens, etc.)
- Data via `input()`, events via `output()`
- `OnPush` change detection
- Highly reusable
- Easy to test

---

## 3. Data-Access Libraries

### Angular Data-Access

State management, API clients, and facades.

```typescript
// libs/user-management/data-access/src/lib/user.service.ts
@Injectable({ providedIn: 'root' })
export class UserService {
  private http = inject(HttpClient);

  // State
  private _users = signal<User[]>([]);
  users = this._users.asReadonly();

  // Derived state
  activeUsers = computed(() => this._users().filter((u) => u.isActive));

  // API calls
  loadUsers() {
    return this.http.get<User[]>('/api/users').pipe(tap((users) => this._users.set(users)));
  }

  createUser(dto: CreateUserDto) {
    return this.http.post<User>('/api/users', dto).pipe(tap((user) => this._users.update((users) => [...users, user])));
  }
}
```

### NestJS Data-Access

Repositories and database access.

```typescript
// libs/user-management/data-access/src/lib/user.repository.ts
@Injectable()
export class UserRepository {
  constructor(private prisma: PrismaService) {}

  async findById(id: string): Promise<User | null> {
    return this.prisma.user.findUnique({ where: { id } });
  }

  async findAll(): Promise<User[]> {
    return this.prisma.user.findMany();
  }

  async create(data: CreateUserData): Promise<User> {
    return this.prisma.user.create({ data });
  }
}
```

---

## 4. Util Libraries

Pure functions with no side effects.

```typescript
// libs/shared/util/src/lib/format.ts
export function formatCurrency(amount: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
  }).format(amount);
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .trim();
}

// libs/shared/util/src/lib/validation.ts
export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
```

**Characteristics:**

- No framework dependencies
- Pure functions
- Easily testable
- Can be used by any library type

---

## 5. API-Interfaces Libraries

Shared types, DTOs, and contracts.

```typescript
// libs/shared/api-interfaces/src/lib/user.dto.ts
export interface User {
  id: string;
  email: string;
  name: string;
  role: UserRole;
  createdAt: Date;
}

export interface CreateUserDto {
  email: string;
  name: string;
  password: string;
}

export interface UpdateUserDto {
  name?: string;
  email?: string;
}

export enum UserRole {
  ADMIN = 'ADMIN',
  USER = 'USER',
  GUEST = 'GUEST',
}

// libs/shared/api-interfaces/src/lib/api-response.ts
export interface ApiResponse<T> {
  data: T;
  message?: string;
}

export interface PaginatedResponse<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
}
```

**Benefits:**

- Type safety across frontend and backend
- Single source of truth for contracts
- Import in both Angular and NestJS

---

## 6. Domain Libraries (DDD)

Domain models, value objects, and business rules.

```typescript
// libs/user-management/domain/src/lib/user.entity.ts
export class UserEntity {
  private constructor(
    public readonly id: UserId,
    public readonly email: Email,
    private _name: string,
    private _role: UserRole,
  ) {}

  get name(): string {
    return this._name;
  }
  get role(): UserRole {
    return this._role;
  }

  static create(props: CreateUserProps): UserEntity {
    return new UserEntity(UserId.generate(), Email.create(props.email), props.name, UserRole.USER);
  }

  promote(): void {
    if (this._role === UserRole.ADMIN) {
      throw new DomainError('User is already admin');
    }
    this._role = UserRole.ADMIN;
  }
}

// libs/user-management/domain/src/lib/email.value-object.ts
export class Email {
  private constructor(private readonly value: string) {}

  static create(email: string): Email {
    if (!this.isValid(email)) {
      throw new DomainError('Invalid email format');
    }
    return new Email(email.toLowerCase());
  }

  static isValid(email: string): boolean {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  }

  toString(): string {
    return this.value;
  }
  equals(other: Email): boolean {
    return this.value === other.value;
  }
}
```

---

## Library Type Selection Matrix

| Need                  | Library Type   | Platform |
| --------------------- | -------------- | -------- |
| Page/route component  | feature        | Angular  |
| API endpoint          | feature-api    | NestJS   |
| Button/card component | ui             | Angular  |
| State management      | data-access    | Angular  |
| Database repository   | data-access    | NestJS   |
| Helper functions      | util           | Both     |
| DTOs, interfaces      | api-interfaces | Both     |
| Business entities     | domain         | Both     |

## Dependency Flow

```
feature ──────┬──► ui
              │
              ├──► data-access ──► api-interfaces
              │                         │
              │                         ▼
              └──► util           domain (optional)
```

**Rules:**

- `feature` can import anything except other `feature`
- `ui` can only import `ui`, `util`, `api-interfaces`
- `data-access` can import `data-access`, `util`, `api-interfaces`, `domain`
- `util` can only import `util`
- `api-interfaces` can only import `api-interfaces`
- `domain` can only import `domain`, `util`
