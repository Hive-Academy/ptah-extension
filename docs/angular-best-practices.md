# Angular Best Practices Guide 2025

Comprehensive guide to Angular best practices for building modern, performant, and maintainable applications in 2025.

## Table of Contents

1. [State Management](#state-management)
2. [Component Architecture](#component-architecture)
3. [Project Structure](#project-structure)
4. [Performance Optimization](#performance-optimization)
5. [Zoneless Change Detection](#zoneless-change-detection)
6. [Testing Strategies](#testing-strategies)
7. [Dependency Injection](#dependency-injection)
8. [Component Design Patterns](#component-design-patterns)
9. [Code Quality and Tooling](#code-quality-and-tooling)
10. [TypeScript Best Practices](#typescript-best-practices)

---

## State Management

### Angular Signals - The Modern Approach

Angular Signals, introduced experimentally in Angular 16, have now reached full stability in Angular 20. They provide reactive state management without RxJS boilerplate. For simple cases, there's no need for BehaviorSubject or NgRx.

**Key Benefits:**

- Reactive state management with less boilerplate
- Automatic UI updates when signal values change
- Better performance in zoneless applications
- Type-safe state tracking

### State Management Options

#### 1. Angular Signals (for small to medium apps)

```typescript
import { signal, computed } from '@angular/core';

export class UserService {
  private userSignal = signal<User | null>(null);

  // Read-only access
  readonly user = this.userSignal.asReadonly();

  // Computed values
  readonly isAuthenticated = computed(() => this.user() !== null);

  setUser(user: User) {
    this.userSignal.set(user);
  }

  updateUser(updates: Partial<User>) {
    this.userSignal.update((current) => ({ ...current, ...updates }));
  }
}
```

#### 2. NgRx Signal Store (for larger apps)

Signal Store is the more robust solution from NgRx. It's still based on Signals, keeping the structure that most larger teams would want for state solutions.

Signal State is a lightweight API meant to be used in smaller, more isolated scenarios, where a full redux-like API isn't needed. This could be in small to medium sized apps, and in the component itself or extracted to a service.

#### 3. Services with RxJS (traditional approach)

Using Angular services allows for centralized state handling. Combined with RxJS, these services can efficiently manage asynchronous data streams, making them ideal for applications requiring real-time updates or shared data across multiple components.

#### 4. Traditional NgRx (enterprise apps)

NgRx is based on the Redux pattern and is ideal for large-scale apps. NgRx is especially useful in large-scale Angular applications where you need consistent data handling across components. It helps reduce the complexity by enabling centralized control and reducing the risk of state inconsistencies.

### State Management Best Practices

**1. Separation of Concerns**

If you follow the 3 rules of "No Services, No Logic, No State" in components, and if you maintain the state separately from the view, completely separating the logic and data services from the view, you end up with a truly Reactive Component.

Keep state logic inside services, not in components. Services should handle business logic and state management, while components focus on presentation and interaction. This separation of concerns enhances testability and reusability.

**Benefits:**

- Maintenance of large-scale apps is far faster and easier
- Code can be independently developed and tested
- Changes to the view do not impact the logic
- Changes to the logic do not impact the view
- View components can be swapped out quickly and easily for marketing testing or upgrades

**2. Immutability**

Treat state as immutable. This helps keep your app predictable and reduces the potential for side effects.

**3. Modular State**

Break up your state into smaller, focused stores or services that manage different parts of your app. This modular approach helps you manage and scale your application as it grows.

---

## Component Architecture

### Standalone Component Architecture

With Angular 20, standalone APIs are the default way to build Angular apps. No need for NgModule anymore. Components, directives, and pipes can be used standalone, enabling faster bootstrapping with less boilerplate.

In Angular 20, state management can be handled elegantly with services using RxJS, and enhanced with libraries like NgRx or Angular Signals. This chapter explores core state management techniques suitable for standalone component architecture.

### Component Best Practices

**1. Use OnPush Change Detection Strategy**

```typescript
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-user-profile',
  templateUrl: './user-profile.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserProfileComponent {
  // Component logic
}
```

Use Angular's `ChangeDetectionStrategy.OnPush` to minimize unnecessary change detection cycles. This strategy only checks components for changes when necessary, reducing unnecessary change detection checks.

**2. Keep Components Small and Focused**

Each component should have a single responsibility. If a component is doing too much, break it down into smaller, reusable components.

**3. Use Smart and Dumb Components**

Separate container components (smart) from presentation components (dumb). More details in the [Component Design Patterns](#component-design-patterns) section.

**4. Leverage Signals in Templates**

```typescript
export class CounterComponent {
  count = signal(0);

  increment() {
    this.count.update((n) => n + 1);
  }
}
```

```html
<div>Count: {{ count() }}</div>
<button (click)="increment()">Increment</button>
```

---

## Project Structure

### The LIFT Principle

The Angular team introduces the LIFT principle:

- **L**ocate code quickly - Keep related files in a group that will be easy to find
- **I**dentify the code at a glance - Name the file to know what it contains and represents instantly
- Maintain a **F**lat folder structure as long as possible
- **T**ry to be DRY (Don't Repeat Yourself) without sacrificing readability

### Feature-Based Structure (2025 Recommended)

Feature-based structure is the default in 2025. Modules are optional. The core/ folder replaces shared/, organized by responsibility.

In a features-first structure, your app is split by capabilities, not by type. A feature contains its own UI, logic, routes, and maybe even state.

### Recommended Folder Structure

```
src/
├── app/
│   ├── core/                    # Singleton services, global infrastructure
│   │   ├── components/          # Global components (header, footer, etc.)
│   │   ├── constants/
│   │   ├── directives/
│   │   ├── enums/
│   │   ├── guards/
│   │   ├── interceptors/
│   │   ├── pipes/
│   │   ├── providers/
│   │   ├── services/            # Global services (auth, logger, etc.)
│   │   ├── tokens/
│   │   ├── types/
│   │   └── validators/
│   │
│   ├── features/                # Feature modules (self-contained)
│   │   ├── dashboard/
│   │   │   ├── components/
│   │   │   ├── services/
│   │   │   ├── models/
│   │   │   └── dashboard.routes.ts
│   │   ├── users/
│   │   └── products/
│   │
│   ├── shared/                  # Reusable UI components, directives, pipes
│   │   ├── components/          # Reusable UI components
│   │   ├── directives/
│   │   └── pipes/
│   │
│   ├── layout/                  # Layout components
│   │   ├── header/
│   │   ├── sidebar/
│   │   └── footer/
│   │
│   ├── app.component.ts
│   ├── app.config.ts
│   └── app.routes.ts
│
├── assets/
└── environments/
```

### Key Folder Guidelines

#### Core Folder

Everything in core/ should be agnostic and not related to any concrete feature. Move global services (e.g., AuthService, LoggerService) to the core/ module, ensuring that there's a single instance across the app.

#### Feature Modules

Feature modules, located in the features/ folder, hold distinct functionalities like dashboards, users, or products, making them easier to manage and load independently.

Each feature is self-contained:

- Teams can work independently on features
- They're easier to refactor, lazy-load, or even remove
- Clear boundaries prevent coupling

#### Shared Module

The Shared module, stored in the shared/ folder, holds the reusable UI components, directives, and pipes that can be used across different modules.

**Important:** Avoid adding services to the shared folder to prevent unintentional singleton behavior. If a service is provided in SharedModule, each Feature Module that imports SharedModule gets a new instance of the service, which can lead to data inconsistencies.

### Modern Angular 17+ Considerations

Angular 17+ is built for this approach. With standalone components and route-level providers, your features load quickly and stay isolated.

### Additional Tips

- Use TypeScript path aliases in `tsconfig.json` to simplify long or complex import statements
- Properly managing imports and dependencies reduces errors and keeps your Angular project organized
- Avoid libs/ or mega service folders. Keep it flat, clear, and focused
- Lazy loading enhances an Angular project's performance by ensuring that only necessary modules are loading initially

---

## Performance Optimization

### Key Optimization Techniques

#### 1. Change Detection Optimization

The OnPush Change Detection strategy is one of the best ways to optimize performance in Angular. Angular uses the default change detection strategy, which checks all components for changes during a change detection cycle, even if none of its input properties have been modified. This leaves the application susceptible to sluggishness as you increase the number of components.

By switching to OnPush, Angular only checks components for changes when necessary, reducing unnecessary change detection checks.

#### 2. Lazy Loading

Lazy loading is crucial for optimizing the performance of your Angular application, especially in large applications. It ensures that the initial load time remains low by only loading feature modules when needed. This reduces unnecessary code from being loaded up front and prevents excessive network usage.

```typescript
// app.routes.ts
export const routes: Routes = [
  {
    path: 'dashboard',
    loadComponent: () => import('./features/dashboard/dashboard.component').then((m) => m.DashboardComponent),
  },
  {
    path: 'users',
    loadChildren: () => import('./features/users/users.routes').then((m) => m.USERS_ROUTES),
  },
];
```

#### 3. TrackBy Function

When rendering lists using ngFor, Angular re-renders the entire list each time a change occurs. This can be costly in terms of performance, especially for large lists.

Using the trackBy function allows Angular to uniquely identify each item in the list, ensuring that only modified items are updated rather than re-rendering the entire list. This optimization significantly improves performance.

```typescript
export class UsersComponent {
  users = signal<User[]>([]);

  trackByUserId(index: number, user: User): string {
    return user.id;
  }
}
```

```html
<div *ngFor="let user of users(); trackBy: trackByUserId">{{ user.name }}</div>
```

#### 4. Server-Side Rendering (SSR)

Angular's enhanced SSR leverages the PendingTasks API for precise control over application serialization, enabling better hydration strategies and optimal Core Web Vitals.

SSR with proper task management can improve:

- First Contentful Paint (FCP) by 40-60%
- Largest Contentful Paint (LCP) by 30-50%
- Prevents hydration mismatches that cause layout shifts

#### 5. Web Workers

Heavy computations can block the main thread, causing UI lag and slow response times. Web workers help by running JavaScript code in a separate thread, ensuring that user interactions remain smooth.

Angular supports web workers, making it possible to offload complex calculations and background tasks to improve performance.

### Performance Testing Tools

#### 1. Angular DevTools

Angular DevTools now provides:

- Signals monitoring
- Change detection tracking
- Performance profiling
- Developers can now see exactly what triggered re-renders

#### 2. WebPageTest

WebPageTest is a free online tool that allows you to test application performance from various locations and browsers worldwide. Using WebPageTest, you can measure the application's loading speed and detect Angular performance issues.

The tool provides insightful reports on:

- Speed
- Loading time
- Render time
- Time to first byte and paint
- Memory usage
- Network requests
- CPU usage

#### 3. Angular Performance Explorer

Angular Performance Explorer is a tool designed to analyze and measure the performance of Angular apps. It provides:

- Insights into rendering and change detection
- Visual interfaces for exploring performance metrics
- Memory usage, network requests, and CPU analysis
- Recommendations for optimization (e.g., optimizing change detection strategies, lazy loading modules)

### Performance Best Practices Summary

In 2025, Angular performance optimization has evolved with powerful new tools like signals and zoneless architecture, giving developers more control and speed than ever.

When combined with strategic lazy loading, you can see bundle sizes drop by 80%. Keep in mind that optimizing performance is a continuous effort, and to make sure your application is functioning properly, you must continuously test and monitor it.

---

## Zoneless Change Detection

### Overview

With signals driving modern Angular state management, zone.js is no longer needed for change detection. Zoneless change detection was introduced experimentally in v18, progressed through Developer Preview in v20, and reached stability in v20.2.

Through Google's experience with applications, they became increasingly confident that new Angular applications work best without zone.js. In 2024, more than half of the brand new Angular applications inside Google were built with the Zoneless change detection strategy. There are now hundreds of zoneless applications running inside Google in production.

**Important:** Given these strong signals, zone.js and its features will no longer be included by default in Angular applications in v21.

### Key Benefits

#### 1. Reduced Bundle Size

Zone.js is about 30kB raw and around 10kB gzipped. That's quite a lot for a dependency that has to be eagerly loaded before the application starts bootstrapping.

#### 2. Improved Startup Time

Implementing zoneless change detection can improve startup time by 60%. When combined with signals, applications feel much smoother.

#### 3. Precise Change Detection

Zone.js assists Angular's change detection by notifying it when operations finish, but it doesn't actually know whether these operations change any data. Because of this, the framework tends to overreact by scheduling a run "just in case."

The new Zoneless mode disables Zone.js completely and relies fully on Signals instead:

- No global async tracking
- Signals keep track of which components depend on them
- When a Signal changes, Angular calls markDirty() only for the affected components

Rather than triggering change detection "when some operation just happened, and something might have changed", the framework now triggers it "when it receives a notification that the data has changed". The scheduler exposes a special notify method called when a signal read in the template receives a new value.

### Best Practices for Zoneless

#### 1. Use Signals for State Management

If a component is used in production, issues should be addressed by updating the component to use signals for state or call `ChangeDetectorRef.markForCheck()`.

Angular Signals provide a reactive state model that automatically updates the UI when the underlying signal changes — without needing manual change detection calls. This is especially powerful in a zoneless setup.

#### 2. OnPush Strategy Recommended

The OnPush change detection strategy is not required, but it is a recommended step towards zoneless compatibility for application components.

Zoneless change detection isn't some optional experiment — it's the direction Angular is headed. The sooner you start embracing OnPush, Signals, and smart reactive patterns, the smoother your ride will be.

#### 3. Avoid Reference Change Pitfalls

Angular signals trigger change detection on reference changes, even when data hasn't changed. Use normalized values, leverage Angular's template optimizations, and build debugging tools to catch wasteful updates.

By default, signal equality is `Object.is`. For example, `Object.is([], [])` is false, though it's essentially the same value. It's not about using `{ equal: ... }` when creating signals; it's more about normalizing signal updates.

```typescript
// Bad: Creates new array reference every time
const items = signal<string[]>([]);
items.set([...items(), 'new item']); // Triggers change detection

// Better: Use update with normalization
items.update((current) => {
  const newItems = [...current, 'new item'];
  // Only return if actually changed
  return JSON.stringify(current) === JSON.stringify(newItems) ? current : newItems;
});
```

### Migration to Zoneless

#### 1. Remove Zone.js

Zoneless applications should remove ZoneJS entirely from the build to reduce bundle size. ZoneJS is typically loaded via the polyfills option in angular.json, both in the build and test targets. Remove zone.js and zone.js/testing from both to remove it from the build.

#### 2. Replace NgZone APIs

The `NgZone.onMicrotaskEmpty` and `NgZone.onStable` observables can be replaced by `afterNextRender` if they need to wait for a single change detection or `afterEveryRender` if there is some condition that might span several change detection rounds.

```typescript
// Old (Zone.js)
constructor(private ngZone: NgZone) {
  this.ngZone.onStable.subscribe(() => {
    // Do something after change detection
  });
}

// New (Zoneless)
import { afterNextRender } from '@angular/core';

constructor() {
  afterNextRender(() => {
    // Do something after next render
  });
}
```

#### 3. Migration Tools

Angular provides an `onpush_zoneless_migration` tool that can analyze your code and provide a plan to migrate your application to OnPush and zoneless change detection.

---

## Testing Strategies

### Testing Types Overview

Tests can usually be placed into one of the three categories: unit, integration, or end-to-end tests.

A unit is some individual piece of software which can also have some external dependencies. In the context of Angular, units are components, services, guards, pipes, helper functions, interceptors, models and other custom classes, etc.

### Unit Testing

#### Overview

Unit Tests are fast, cheap, and easy to pinpoint failures. They give you confidence that individual components are solid.

Unit tests are typically faster to execute since they focus on small, isolated units. They can pinpoint specific issues within a component or service and are ideal for testing complex logic and handling edge cases.

However, unit tests are closely tied to implementation details, making refactoring challenging.

#### Example

```typescript
import { TestBed } from '@angular/core/testing';
import { UserService } from './user.service';

describe('UserService', () => {
  let service: UserService;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(UserService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  it('should set user correctly', () => {
    const user = { id: '1', name: 'John' };
    service.setUser(user);
    expect(service.user()).toEqual(user);
  });
});
```

### Integration Testing

#### Overview

Integration testing includes multiple units which are tested together to check how they interact. In Angular, there is no special way of doing integration testing. There is a thin line between unit and integration tests, and that line is more conceptual than technical.

In Angular integration tests:

- Tests simulate user interactions such as clicking buttons and filling forms
- Then assert changes in the DOM
- Instead of mocking all dependencies, integration tests use real services and components where feasible
- Mocking only external systems like HTTP requests
- A single integration test can cover multiple components and services, providing a broader overview of the application's functionality

#### Example

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { UserProfileComponent } from './user-profile.component';
import { UserService } from '../services/user.service';

describe('UserProfileComponent', () => {
  let component: UserProfileComponent;
  let fixture: ComponentFixture<UserProfileComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [UserProfileComponent],
      providers: [UserService],
    }).compileComponents();

    fixture = TestBed.createComponent(UserProfileComponent);
    component = fixture.componentInstance;
  });

  it('should display user name when user is set', () => {
    const compiled = fixture.nativeElement;
    const user = { id: '1', name: 'John Doe' };

    component.user.set(user);
    fixture.detectChanges();

    expect(compiled.querySelector('.user-name').textContent).toContain('John Doe');
  });
});
```

### Modern Testing Tools (2025)

The Angular CLI downloads and installs everything you need to test an Angular application with the **Vitest** testing framework.

By default, new projects include vitest and jsdom. Vitest runs your unit tests in a Node.js environment, using jsdom to emulate the DOM. This allows for faster test execution by avoiding the overhead of launching a browser.

For E2E testing, **Cypress** has now become the preferred choice over Protractor, along with unit testing using **Jasmine** and **TestBed**.

### Testing Strategy Balance

Thinking about your testing strategy is about managing a trade-off between confidence, speed, and cost.

If you only write E2E tests, your test suite will be too slow and fragile to be useful. If you only write unit tests, you'll have no confidence that your application actually works when the pieces are combined.

To build a reliable Angular app, you'll need a balanced mix of all three:

- **Unit testing** catches small bugs early
- **Integration testing** ensures proper data flow
- **E2E testing** simulates the real user experience

Together, they create a strong testing strategy that keeps your app running smoothly.

### CI/CD Integration

Use GitHub Actions, GitLab CI, or similar tools to automatically review, install dependencies, and run all Angular unit testing and integration test suites whenever code is pushed.

If a single test fails, the pipeline stops and the team is notified, preventing regressions and ensuring the main branch stays stable.

### Testing Best Practices

1. **Write tests for critical paths first** - Focus on user journeys that matter most
2. **Use TestBed for component tests** - Leverage Angular's testing utilities
3. **Mock HTTP requests** - Use HttpTestingController for HTTP testing
4. **Test signals properly** - Verify signal updates trigger UI changes
5. **Aim for 80% coverage minimum** - Balance between confidence and maintainability
6. **Run tests in CI/CD** - Automate testing to catch regressions early

### Emerging Trends in 2025

Modern testing practices are moving towards more holistic tests that cover multiple files, aligning with industry trends and recommendations from the Angular team itself.

As we step into 2025, the importance of robust unit and E2E testing is greater than ever — especially for teams practicing test-driven development (TDD) in large, complex Angular applications.

---

## Dependency Injection

### Overview

Dependency Injection (DI) is a design pattern used to organize and share code across an application by allowing you to "inject" features into different parts.

It provides:

- Improved code maintainability through cleaner separation of concerns
- Scalability through modular functionality that can be reused across multiple contexts
- Better testing by allowing unit tests to easily use test doubles

### Core DI Decorators and Tokens

Angular's DI system revolves around a few core decorators:

- `@Injectable()` - Marks a class as a service that can be injected
- `@Inject()` - Used when injecting tokens or using custom providers
- `InjectionToken` - Allows you to create strongly typed tokens for DI

### Modern Injection Patterns (2025)

You can inject dependencies using Angular's `inject()` function, and the call to inject can appear in either the constructor or in a field initializer.

```typescript
import { inject } from '@angular/core';

// Constructor injection (traditional)
export class UserComponent {
  constructor(private userService: UserService) {}
}

// Field initializer injection (modern)
export class UserComponent {
  private userService = inject(UserService);
}
```

### Injector Hierarchy

Each component can have its own injector, forming a hierarchy. Angular's dependency injection system is hierarchical.

When a component requests a dependency, Angular starts with that component's injector and walks up the tree until it finds a provider for that dependency.

### Service Design Best Practices

#### 1. providedIn: 'root' for Singletons

Use Angular's hierarchical dependency injection with `@Injectable({ providedIn: 'root' })` for singleton services.

```typescript
@Injectable({
  providedIn: 'root',
})
export class AuthService {
  // Service implementation
}
```

By default, services provided in the root are singleton, which means only one instance is shared across the application.

#### 2. Component-Level Providers

However, services can also be provided at different levels if you want different instances for different parts of the application.

Use component-level providers only when you need a new instance per component, such as for:

- Managing local timers
- Form states
- Subscriptions

```typescript
@Component({
  selector: 'app-user-form',
  providers: [UserFormService],
})
export class UserFormComponent {
  // Gets its own instance of UserFormService
}
```

### Advanced Configurations

Angular's DI supports advanced configurations, such as:

- **Hierarchical injectors** for scoping services to specific modules or components
- **Multi-providers** to register multiple implementations of the same token
- **Injection contexts** for creating services dynamically during specific lifecycle events

### InjectionToken for Non-Class Dependencies

While the `@Injectable` decorator with `providedIn: 'root'` works great for services (classes), you might need to provide other types of values globally - like configuration objects, functions, or primitive values.

Angular provides `InjectionToken` for this purpose, which is an object that Angular's dependency injection system uses to uniquely identify values for injection.

```typescript
import { InjectionToken } from '@angular/core';

export interface AppConfig {
  apiUrl: string;
  environment: string;
}

export const APP_CONFIG = new InjectionToken<AppConfig>('app.config');

// Provide the config
export const appConfig: ApplicationConfig = {
  providers: [{ provide: APP_CONFIG, useValue: { apiUrl: '/api', environment: 'production' } }],
};

// Inject the config
export class ApiService {
  private config = inject(APP_CONFIG);
}
```

### 2025 Best Practices Summary

In 2025, the Angular ecosystem emphasizes:

- Modular architecture with standalone components
- Strict typing
- Performance optimization
- Adherence to modern web standards

Break down the application into feature modules using Angular's standalone components and lazy loading capabilities.

Use `InjectionToken` for abstract dependencies or interfaces. Leverage Angular Signals (new in Angular 16+) with reactive services for state management. Signals enable fine-grained and deterministic reactivity, improving performance and simplifying mental models.

---

## Component Design Patterns

### Smart and Dumb Components Pattern

In Angular, smart and dumb components refer to a design pattern that separates logic from presentation, promoting clean architecture, reusability, and testability.

### Smart Components (Container Components)

A container component mainly contains business logic and communication with the outside of the application, such as an API call. These components are also called stateful, logic, feature or smart components.

#### Key Characteristics

- Handle business logic, data fetching, and state management
- Coordinate interaction between dumb components
- Interact with services, stores (like NgRx), APIs, and routes
- Usually a routed component, like a page
- Can have external dependencies (Dependency Injection)
- May trigger side effects (e.g. API calls)

#### Example

```typescript
@Component({
  selector: 'app-users-container',
  template: ` <app-user-list [users]="users()" (userSelected)="onUserSelected($event)"></app-user-list> `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsersContainerComponent {
  private userService = inject(UserService);

  users = signal<User[]>([]);

  ngOnInit() {
    this.loadUsers();
  }

  async loadUsers() {
    const users = await this.userService.getUsers();
    this.users.set(users);
  }

  onUserSelected(user: User) {
    // Navigate or update state
    this.router.navigate(['/users', user.id]);
  }
}
```

### Dumb Components (Presentational Components)

It doesn't handle any business logic or make API calls. It communicates only with its parent container component, which manages the data and logic. These components are also called stateless, UI or dumb components.

#### Key Characteristics

- Focus solely on UI presentation
- Receive data and instructions through input properties (`@Input()`)
- Emit events (`@Output()`) to communicate user interactions or data changes back to parent
- Highly reusable and easy to test
- No external dependencies
- Produces no side effects
- Communication with parent only through `@Input()` and `@Output()` decorators

#### Example

```typescript
@Component({
  selector: 'app-user-list',
  template: `
    <div class="user-list">
      <div *ngFor="let user of users; trackBy: trackByUserId" class="user-item" (click)="onUserClick(user)">
        {{ user.name }}
      </div>
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UserListComponent {
  @Input() users: User[] = [];
  @Output() userSelected = new EventEmitter<User>();

  onUserClick(user: User) {
    this.userSelected.emit(user);
  }

  trackByUserId(index: number, user: User): string {
    return user.id;
  }
}
```

### Benefits of Smart/Dumb Pattern

With smart dumb component architecture we keep a clean separation of concerns by having our 'smart' components handle all our logic, whilst our 'dumb' components simply take in data, and spit out data. Nice and simple, no mutating data in random components, just clean separation of concerns.

Additional benefits include:

- **Testability:** Smart and dumb components can be tested more effectively in isolation
- **Maintainability:** Code becomes easier to understand, modify, and debug with clear separation
- **Reusability:** This approach makes it easier to reuse the same data or state across different UI layouts
- **Performance:** Re-render efficiently based on input changes using techniques like OnPush change detection

### Implementation Pattern

We've shifted all the responsibility of displaying the list to a new client-list component, which serves as the dumb or presentational component. Now the smart component only needs to add this dumb component to the template and supply the data through an input.

Remember, we don't want the dumb component to trigger any method in a service or navigation; this should be the smart component's responsibility.

### Hierarchy Considerations

**Question:** Can a dumb component have a smart child component?

**Answer:** NO. If you have the case when the child component is smart, then the parent dumb is not dumb anymore. Mainly as a dumb component, you will use the small components where you have a list, grid, or any easy logic that you can separate into a component and add an OnPush to that. And I don't think there will be a case where you will have a Smart component as a child.

---

## Code Quality and Tooling

### Modern Configuration (ESLint 9+ Flat Config)

From ESLint v9.0.0, the default configuration file is now `eslint.config.js`.

With Angular 20's new ESLint flat config, you can automate formatting, enforce best practices, and prevent unformatted or error-prone code from ever reaching your repository.

### Recommended Packages (2025)

```json
{
  "devDependencies": {
    "angular-eslint": "^19.6.0",
    "eslint": "^9.27.0",
    "eslint-config-prettier": "^10.1.5",
    "eslint-plugin-prettier": "^5.4.1",
    "prettier": "^3.5.3",
    "typescript-eslint": "^8.33.0",
    "husky": "^9.0.0",
    "lint-staged": "^15.0.0"
  }
}
```

### Purpose of Each Tool

- **Prettier:** Automatically formats your code for consistency across your team
- **ESLint:** Finds and fixes code quality and style issues, enforcing Angular and TypeScript best practices
- **Husky:** Runs scripts (like linting, formatting, and tests) as Git hooks before commits or pushes, so only quality code makes it to your repository

### Prettier Configuration

Create `.prettierrc.json`:

```json
{
  "semi": true,
  "singleQuote": true,
  "tabWidth": 2,
  "trailingComma": "es5",
  "printWidth": 100,
  "arrowParens": "avoid"
}
```

**Key Setting:** `singleQuote` enforces single quotes in JavaScript and TypeScript files. Most developers prefer single quotes since they are slightly more concise and don't require holding the Shift key.

**Rule of thumb:** Use single quotes in JavaScript/TypeScript and double quotes in HTML and (S)CSS.

### ESLint-Prettier Integration

`eslint-plugin-prettier` runs Prettier as an ESLint rule, so formatting issues show up as ESLint errors in your editor or CI. Together, they let you catch and fix code style and formatting issues in a single workflow.

### Alternative Approach

While there's an ESLint plugin for Prettier, some developers avoid using it because they don't want formatting errors to show up as linting errors, turning everything red in the editor.

Instead, you can use lint-staged to run Prettier before every commit. To ensure the git hooks execute properly, Husky is recommended.

### VS Code Configuration

Create `.vscode/settings.json`:

```json
{
  "editor.formatOnSave": true,
  "editor.defaultFormatter": "esbenp.prettier-vscode",
  "editor.codeActionsOnSave": {
    "source.fixAll.eslint": true,
    "source.organizeImports": true
  },
  "[html]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[typescript]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  },
  "[json]": {
    "editor.defaultFormatter": "esbenp.prettier-vscode"
  }
}
```

Configure VS Code to format HTML, SCSS, and TypeScript files with Prettier on save. This organizes imports and adds bracket colorization for readability.

You'll get live feedback for lint and format errors as you type — no need to wait for CI or run ng lint manually.

**Important:** If you use `'prettier/prettier': 'error'`, always enable `"editor.formatOnSave": true` to ensure your files are automatically formatted and you avoid disruptive lint errors while coding.

### Husky and Lint-Staged Setup

Install and configure:

```bash
npm install --save-dev husky lint-staged
npx husky install
```

Create `.husky/pre-commit`:

```bash
#!/bin/sh
. "$(dirname "$0")/_/husky.sh"

npx lint-staged
```

Create `.lintstagedrc.json`:

```json
{
  "*.{ts,html,scss}": ["prettier --write", "eslint --fix"]
}
```

Pre-commit hooks format and lint staged files before committing, ensuring code quality. Pre-commit hooks act as a safety net, catching formatting issues early in the development process.

### Additional Code Quality Tools

For code quality, a recommended setup includes:

- angular-eslint
- eslint-plugin-unused-imports
- husky
- prettier
- lint-staged
- Sheriff (for architectural rules)

When it comes to enforcing architectural rules — particularly module boundaries and dependency rules between them — Sheriff is a useful tool. It also integrates with ESLint.

### CI/CD Integration

Integrate these scripts into your CI/CD pipeline to enforce code formatting and linting before deployment.

Example GitHub Actions workflow:

```yaml
name: CI

on: [push, pull_request]

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - uses: actions/setup-node@v3
        with:
          node-version: '20'
      - run: npm ci
      - run: npm run lint
      - run: npm run prettier:check
```

### Monorepo Benefits

For monorepos, when you lint a specific library, ESLint only needs to create a TypeScript program for that small subset of files, making the process exponentially faster.

Type-aware rules are more reliable because they operate on the precise configuration defined for that library. Your linting performance remains high as your monorepo grows, as each part is linted in isolation.

**Nx is an option for managing these configurations automatically.** NX is a next generation build system with first-class monorepo support. If you migrate your Angular app to an Nx monorepo, you get all those configurations for free out-of-the-box.

---

## TypeScript Best Practices

### 1. Use Explicit Types

Avoid relying on `any`. Always define types explicitly to make the code more readable and safer.

```typescript
// Bad
function processUser(user: any) {
  return user.name;
}

// Good
interface User {
  id: string;
  name: string;
  email: string;
}

function processUser(user: User): string {
  return user.name;
}
```

### 2. Leverage `unknown` Instead of `any`

If you need a variable that could hold any value, opt for `unknown` over `any` for safer handling.

```typescript
// Bad
function parseData(data: any) {
  return JSON.parse(data);
}

// Good
function parseData(data: unknown): unknown {
  if (typeof data === 'string') {
    return JSON.parse(data);
  }
  throw new Error('Invalid data type');
}
```

### 3. Use Type Guards

```typescript
function isUser(obj: unknown): obj is User {
  return typeof obj === 'object' && obj !== null && 'id' in obj && 'name' in obj;
}

function processData(data: unknown) {
  if (isUser(data)) {
    // TypeScript knows data is User here
    console.log(data.name);
  }
}
```

### 4. Leverage Utility Types

TypeScript provides many built-in utility types:

```typescript
interface User {
  id: string;
  name: string;
  email: string;
  role: string;
}

// Partial - all properties optional
type PartialUser = Partial<User>;

// Pick - select specific properties
type UserPreview = Pick<User, 'id' | 'name'>;

// Omit - exclude specific properties
type UserWithoutRole = Omit<User, 'role'>;

// Required - all properties required
type RequiredUser = Required<Partial<User>>;

// Readonly - all properties readonly
type ImmutableUser = Readonly<User>;
```

### 5. Use Strict Mode

Enable strict mode in `tsconfig.json`:

```json
{
  "compilerOptions": {
    "strict": true,
    "strictNullChecks": true,
    "strictFunctionTypes": true,
    "strictBindCallApply": true,
    "strictPropertyInitialization": true,
    "noImplicitAny": true,
    "noImplicitThis": true,
    "alwaysStrict": true
  }
}
```

### 6. Use Const Assertions

```typescript
// Without const assertion
const config = {
  apiUrl: '/api',
  timeout: 3000,
}; // Type: { apiUrl: string; timeout: number }

// With const assertion
const config = {
  apiUrl: '/api',
  timeout: 3000,
} as const; // Type: { readonly apiUrl: "/api"; readonly timeout: 3000 }
```

### 7. Avoid Enums, Use Union Types

```typescript
// Instead of enum
enum Status {
  Active,
  Inactive,
}

// Prefer union types
type Status = 'active' | 'inactive';

// Or const object with as const
const Status = {
  Active: 'active',
  Inactive: 'inactive',
} as const;

type StatusType = (typeof Status)[keyof typeof Status];
```

### 8. Use Type Inference When Appropriate

```typescript
// Don't over-annotate when TypeScript can infer
const name: string = 'John'; // Redundant
const name = 'John'; // Better - TypeScript infers string

// But do annotate when it helps clarity
function getUser(): User {
  // Good - clarifies return type
  return { id: '1', name: 'John', email: 'john@example.com' };
}
```

---

## Summary and Additional Resources

### Key Takeaways for 2025

1. **Embrace Signals** - Modern state management without RxJS boilerplate
2. **Go Zoneless** - Better performance, smaller bundles, precise change detection
3. **Standalone Components** - Default architecture, no NgModules needed
4. **Feature-Based Structure** - Organize by capability, not by file type
5. **Smart/Dumb Pattern** - Clear separation of concerns
6. **OnPush Everywhere** - Optimize change detection by default
7. **Lazy Load Features** - Keep initial bundles small
8. **Test Strategically** - Balance unit, integration, and E2E tests
9. **Modern Tooling** - Vitest, Cypress, ESLint 9, Prettier
10. **Type Safety** - Strict TypeScript, no `any`, explicit types

### New Angular Features (2025)

- **Angular CLI with ESBuild** - Faster builds, smaller bundles
- **Angular DevTools** - Signals monitoring, change detection tracking, performance profiling
- **Zoneless by Default (v21)** - zone.js no longer included by default
- **Standalone APIs** - Full stability and default configuration
- **Signal-Based State** - First-class reactive primitives

### Continuous Improvement

Keep in mind that optimizing performance and code quality is a continuous effort. You must continuously:

- Test and monitor your application
- Audit performance with tools like Angular DevTools
- Review and refactor code for maintainability
- Stay updated with Angular's evolving best practices
- Leverage modern features as they become stable

### Community Best Practices

Modern Angular development in 2025 requires:

- Optimized performance
- Scalable architecture
- Efficient state management
- Robust testing

By following these best practices, you'll write clean, maintainable, and high-performing Angular applications that are ready for production and future-proof.

---

## Sources

This guide was compiled from research across multiple authoritative sources in the Angular ecosystem:

### State Management

- [Angular State Management for 2025 | Nx Blog](https://nx.dev/blog/angular-state-management-2025)
- [Best Practices for State Management in Angular Applications | Innoraft](https://www.innoraft.ai/blog/best-practices-state-management-angular-applications)
- [Angular 20 State Management Tutorial – RxJS, NgRx & Angular Signals Explained](https://tutorialrays.in/angular-20-state-management-tutorial-rxjs-ngrx-angular-signals-explained/)
- [Angular 20 Features & What's New in 2025 (With Examples)](https://medium.com/@rohitjsingh16/angular-20-features-whats-new-in-2025-with-examples-204c7720c4f4)
- [Angular Best Practices 2025: Clean & Scalable Code](https://www.ideas2it.com/blogs/angular-development-best-practices)

### Zoneless Change Detection

- [Zoneless • Angular](https://angular.dev/guide/zoneless)
- [The Latest in Angular Change Detection – All You Need to Know](https://angular.love/the-latest-in-angular-change-detection-zoneless-signals/)
- [Zoneless Change Detection in Angular 20: How to Remove Zone.js and Use Signals Properly](https://medium.com/@viacheslav.klavdiiev/zoneless-change-detection-in-angular-20-how-to-remove-zone-js-and-use-signals-properly-be9c67bea894)
- [10 Angular Performance Hacks to Supercharge Your Web Apps in 2025 | Syncfusion Blogs](https://www.syncfusion.com/blogs/post/angular-performance-optimization)
- [Announcing Angular v21](https://blog.angular.dev/announcing-angular-v21-57946c34f14b)

### Performance Optimization

- [10 Angular Performance Hacks to Supercharge Your Web Apps in 2025 | Syncfusion Blogs](https://www.syncfusion.com/blogs/post/angular-performance-optimization)
- [Performance • Overview • Angular](https://angular.dev/best-practices/runtime-performance)
- [Top 10 Techniques to Boost Angular Performance in 2025](https://www.angularminds.com/blog/techniques-to-boost-angular-performance)
- [Ultimate Guide to Angular Performance Optimization in 2025](https://www.bacancytechnology.com/blog/angular-performance-optimization)

### Project Structure

- [Angular Project Structure Guide: Small, Medium, and Large Projects](https://medium.com/@dragos.atanasoae_62577/angular-project-structure-guide-small-medium-and-large-projects-e17c361b2029)
- [Angular v20+ Folder Structure Guide: Best Practices](https://www.angular.courses/blog/angular-folder-structure-guide)
- [Angular File Structure: Effective Best Practices in 2025](https://www.jalasoft.com/blog/angular-project-structure)
- [Angular 2025 Guide: Project Structure with the Features Approach](https://www.ismaelramos.dev/blog/angular-2025-project-structure-with-the-features-approach/)

### Testing

- [Angular Unit Testing and Integration Testing: Complete Guide with Examples | 2025](https://medium.com/@relinns_technologies_pvt_ltd/angular-unit-testing-and-integration-testing-complete-guide-with-examples-2025-98dcf2aabe7b)
- [Modern Testing Practices in Angular: From Unit to Integration Testing](https://dev.to/bndf1/modern-testing-practices-in-angular-from-unit-to-integration-testing-2c01)
- [Experimental unit testing integration](https://angular.dev/guide/testing/unit-tests)
- [Advanced Angular Testing in 2025: Best Practices for Robust Unit and E2E Testing](https://medium.com/@roshannavale7/advanced-angular-testing-in-2025-best-practices-for-robust-unit-and-e2e-testing-1a7e629e000b)

### Dependency Injection

- [Dependency Injection • Overview • Angular](https://angular.dev/guide/di)
- [Mastering Dependency Injection in Angular 2025: The Complete Developer Guide](https://dev.to/codewithrajat/mastering-dependency-injection-in-angular-2025-the-complete-developer-guide-33m4)
- [Dependency Injection in Angular: Everything You Need to Know](https://devot.team/blog/dependency-injection-in-angular)

### Component Design Patterns

- [Clean Code Using Smart and Dumb Components in Angular](https://www.telerik.com/blogs/clean-code-using-smart-dumb-components-angular)
- [Angular Smart Components vs Presentational Components](https://blog.angular-university.io/angular-2-smart-components-vs-presentation-components-whats-the-difference-when-to-use-each-and-why/)
- [Refactoring into Smart and Dumb Components to Reduce Complexity in Angular](https://modernangular.com/articles/refactoring-into-smart-and-dumb-components)

### Code Quality and Tooling

- [NG Best Practices: Prettier & ESLint - ANGULARarchitects](https://www.angulararchitects.io/blog/best-practices-prettier-eslint/)
- [Effortless Code Quality in Angular 20: Prettier, ESLint, and Husky (2025 Edition)](https://tejas-variya.medium.com/effortless-code-quality-in-angular-20-prettier-eslint-and-husky-2025-edition-262ef2a9d3b9)
- [Clean Code, Fewer Bugs: Adding ESLint to Your Angular Project](https://angular.love/clean-code-fewer-bugs-adding-eslint-to-your-angular-project/)
- [TypeScript Best Practices in 2025](https://dev.to/mitu_mariam/typescript-best-practices-in-2025-57hb)

---

**Last Updated:** January 2025

**Version:** 1.0 - Angular 20+ Best Practices

**Maintained by:** Ptah Extension Development Team
