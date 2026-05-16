/**
 * Unit Tests for Framework-Specific Anti-Pattern Detection Rules
 *
 * Tests all framework rule categories with positive and negative cases:
 * - Angular rules (5 rules)
 * - NestJS rules (5 rules)
 * - React rules (5 rules)
 * - RuleRegistry integration for new categories
 */

import {
  // Angular rules
  angularRules,
  improperChangeDetectionRule,
  subscriptionLeakRule,
  circularDependencyRule,
  angularLargeComponentRule,
  missingTrackByRule,
  // NestJS rules
  nestjsRules,
  missingDecoratorRule,
  controllerLogicRule,
  unsafeRepositoryRule,
  missingGuardRule,
  circularModuleRule,
  // React rules
  reactRules,
  missingKeyRule,
  directStateMutationRule,
  useEffectDependenciesRule,
  reactLargeComponentRule,
  inlineFunctionPropRule,
  // Registry
  RuleRegistry,
  ALL_RULES,
} from './index';

// ============================================
// Angular Rules Tests
// ============================================

describe('Angular Rules', () => {
  describe('improperChangeDetectionRule', () => {
    it('should detect @Component without OnPush', async () => {
      const content = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-list',
  template: '<div>Hello</div>'
})
export class ListComponent {
  items = [];
}
`;
      const matches = await improperChangeDetectionRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].type).toBe('angular-improper-change-detection');
      expect(matches[0].metadata?.['reason']).toBe('missing-onpush');
    });

    it('should detect manual detectChanges() calls', async () => {
      const content = `
import { Component, ChangeDetectionStrategy, ChangeDetectorRef } from '@angular/core';

@Component({
  selector: 'app-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div>Hello</div>'
})
export class ListComponent {
  constructor(private cdr: ChangeDetectorRef) {}

  update() {
    this.cdr.detectChanges();
  }
}
`;
      const matches = await improperChangeDetectionRule.detect(
        content,
        'list.component.ts',
      );

      const detectChangesMatch = matches.find(
        (m) => m.metadata?.['reason'] === 'manual-detect-changes',
      );
      expect(detectChangesMatch).toBeDefined();
    });

    it('should NOT detect @Component with OnPush and no detectChanges', async () => {
      const content = `
import { Component, ChangeDetectionStrategy } from '@angular/core';

@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div>Card</div>'
})
export class CardComponent {
  title = 'Hello';
}
`;
      const matches = await improperChangeDetectionRule.detect(
        content,
        'card.component.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect files without @Component', async () => {
      const content = `
import { Injectable } from '@angular/core';

@Injectable({ providedIn: 'root' })
export class DataService {
  getData() { return []; }
}
`;
      const matches = await improperChangeDetectionRule.detect(
        content,
        'data.service.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('subscriptionLeakRule', () => {
    it('should detect .subscribe() without cleanup in component', async () => {
      const content = `
import { Component, OnInit } from '@angular/core';
import { DataService } from './data.service';

@Component({
  selector: 'app-list',
  template: '<div>Hello</div>'
})
export class ListComponent implements OnInit {
  constructor(private dataService: DataService) {}

  ngOnInit() {
    this.dataService.getData().subscribe(data => {
      this.items = data;
    });
  }
}
`;
      const matches = await subscriptionLeakRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('angular-subscription-leak');
      expect(matches[0].metadata?.['subscribeCount']).toBe(1);
    });

    it('should NOT detect subscribe with takeUntilDestroyed', async () => {
      const content = `
import { Component, inject, DestroyRef } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

@Component({
  selector: 'app-list',
  template: '<div>Hello</div>'
})
export class ListComponent {
  private destroyRef = inject(DestroyRef);

  ngOnInit() {
    this.data$.pipe(takeUntilDestroyed(this.destroyRef)).subscribe(d => this.data = d);
  }
}
`;
      const matches = await subscriptionLeakRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect subscribe with ngOnDestroy and unsubscribe', async () => {
      const content = `
import { Component, OnInit, OnDestroy } from '@angular/core';

@Component({
  selector: 'app-list',
  template: '<div>Hello</div>'
})
export class ListComponent implements OnInit, OnDestroy {
  private sub: Subscription;

  ngOnInit() {
    this.sub = this.data$.subscribe(d => this.data = d);
  }

  ngOnDestroy() {
    this.sub.unsubscribe();
  }
}
`;
      const matches = await subscriptionLeakRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect files without @Component', async () => {
      const content = `
import { Injectable } from '@angular/core';

@Injectable()
export class DataService {
  load() {
    this.http.get('/api').subscribe(data => this.cache = data);
  }
}
`;
      const matches = await subscriptionLeakRule.detect(
        content,
        'data.service.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('circularDependencyRule', () => {
    it('should detect forwardRef usage', async () => {
      const content = `
import { Inject, forwardRef } from '@angular/core';

constructor(@Inject(forwardRef(() => ParentService)) private parent: ParentService) {}
`;
      const matches = await circularDependencyRule.detect(
        content,
        'child.service.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('angular-circular-dependency');
    });

    it('should detect multiple forwardRef usages', async () => {
      const content = `
import { Inject, forwardRef } from '@angular/core';

constructor(
  @Inject(forwardRef(() => ServiceA)) private a: ServiceA,
  @Inject(forwardRef(() => ServiceB)) private b: ServiceB
) {}
`;
      const matches = await circularDependencyRule.detect(
        content,
        'combined.service.ts',
      );

      expect(matches.length).toBe(2);
    });

    it('should NOT detect files without forwardRef', async () => {
      const content = `
import { Injectable } from '@angular/core';

@Injectable()
export class CleanService {
  constructor(private dep: DependencyService) {}
}
`;
      const matches = await circularDependencyRule.detect(
        content,
        'clean.service.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('angularLargeComponentRule', () => {
    it('should detect component with >500 lines', async () => {
      const header = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-large',
  template: '<div>Large</div>'
})
export class LargeComponent {
`;
      const body = Array(500).fill('  line = "filler";').join('\n');
      const content = header + body + '\n}';

      const matches = await angularLargeComponentRule.detect(
        content,
        'large.component.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('angular-large-component');
      expect(matches[0].metadata?.['lineCount']).toBeGreaterThan(500);
    });

    it('should NOT detect component with <=500 lines', async () => {
      const content = `
import { Component } from '@angular/core';

@Component({
  selector: 'app-small',
  template: '<div>Small</div>'
})
export class SmallComponent {
  title = 'Hello';
}
`;
      const matches = await angularLargeComponentRule.detect(
        content,
        'small.component.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect large non-component files', async () => {
      const body = Array(600).fill('  line = "filler";').join('\n');
      const content = `
import { Injectable } from '@angular/core';

@Injectable()
export class LargeService {
${body}
}
`;
      const matches = await angularLargeComponentRule.detect(
        content,
        'large.service.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('missingTrackByRule', () => {
    it('should detect *ngFor without trackBy', async () => {
      const content = `
@Component({
  template: \`
    <div *ngFor="let item of items">{{item.name}}</div>
  \`
})
export class ListComponent {}
`;
      const matches = await missingTrackByRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('angular-missing-trackby');
      expect(matches[0].metadata?.['directive']).toBe('*ngFor');
    });

    it('should detect @for without track', async () => {
      const content = `
@Component({
  template: \`
    @for (item of items) {
      <div>{{item.name}}</div>
    }
  \`
})
export class ListComponent {}
`;
      const matches = await missingTrackByRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['directive']).toBe('@for');
    });

    it('should NOT detect *ngFor with trackBy', async () => {
      const content = `
@Component({
  template: \`
    <div *ngFor="let item of items; trackBy: trackItem">{{item.name}}</div>
  \`
})
export class ListComponent {
  trackItem(index: number, item: Item) { return item.id; }
}
`;
      const matches = await missingTrackByRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect @for with track', async () => {
      const content = `
@Component({
  template: \`
    @for (item of items; track item.id) {
      <div>{{item.name}}</div>
    }
  \`
})
export class ListComponent {}
`;
      const matches = await missingTrackByRule.detect(
        content,
        'list.component.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  it('angularRules should contain all 5 rules', async () => {
    expect(angularRules).toHaveLength(5);
  });
});

// ============================================
// NestJS Rules Tests
// ============================================

describe('NestJS Rules', () => {
  describe('missingDecoratorRule', () => {
    it('should detect NestJS class without @Injectable()', async () => {
      const content = `
import { HttpService } from '@nestjs/common';

export class UserService {
  constructor(private http: HttpService) {}

  async getUsers() {
    return this.http.get('/users');
  }
}
`;
      const matches = await missingDecoratorRule.detect(
        content,
        'user.service.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('nestjs-missing-decorator');
      expect(matches[0].metadata?.['className']).toBe('UserService');
    });

    it('should NOT detect class with @Injectable()', async () => {
      const content = `
import { Injectable, HttpService } from '@nestjs/common';

@Injectable()
export class UserService {
  constructor(private http: HttpService) {}

  async getUsers() {
    return this.http.get('/users');
  }
}
`;
      const matches = await missingDecoratorRule.detect(
        content,
        'user.service.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect class with @Controller()', async () => {
      const content = `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get()
  getUsers() { return []; }
}
`;
      const matches = await missingDecoratorRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect non-NestJS files', async () => {
      const content = `
import { something } from './utils';

export class UtilityHelper {
  doWork() { return true; }
}
`;
      const matches = await missingDecoratorRule.detect(content, 'helper.ts');

      expect(matches.length).toBe(0);
    });
  });

  describe('controllerLogicRule', () => {
    it('should detect controller method with >20 lines', async () => {
      const methodBody = Array(22).fill('    const x = 1;').join('\n');
      const content = `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get()
  async getUsers() {
${methodBody}
  }
}
`;
      const matches = await controllerLogicRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('nestjs-controller-logic');
      expect(matches[0].metadata?.['lineCount']).toBeGreaterThan(20);
    });

    it('should NOT detect short controller methods', async () => {
      const content = `
import { Controller, Get } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Get()
  async getUsers() {
    return this.userService.findAll();
  }

  @Get(':id')
  async getUser(id: string) {
    return this.userService.findById(id);
  }
}
`;
      const matches = await controllerLogicRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect non-controller files', async () => {
      const methodBody = Array(25).fill('    const x = 1;').join('\n');
      const content = `
import { Injectable } from '@nestjs/common';

@Injectable()
export class UserService {
  async processUsers() {
${methodBody}
  }
}
`;
      const matches = await controllerLogicRule.detect(
        content,
        'user.service.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('unsafeRepositoryRule', () => {
    it('should detect template literal in query()', async () => {
      const content = `
async findUser(userId: string) {
  return this.db.query(\`SELECT * FROM users WHERE id = \${userId}\`);
}
`;
      const matches = await unsafeRepositoryRule.detect(
        content,
        'user.repository.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('nestjs-unsafe-repository');
    });

    it('should detect template literal in execute()', async () => {
      const content = `
async deleteUser(userId: string) {
  return this.db.execute(\`DELETE FROM users WHERE id = \${userId}\`);
}
`;
      const matches = await unsafeRepositoryRule.detect(
        content,
        'user.repository.ts',
      );

      expect(matches.length).toBe(1);
    });

    it('should NOT detect parameterized queries', async () => {
      const content = `
async findUser(userId: string) {
  return this.db.query('SELECT * FROM users WHERE id = $1', [userId]);
}
`;
      const matches = await unsafeRepositoryRule.detect(
        content,
        'user.repository.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect ORM method calls', async () => {
      const content = `
async findUser(userId: string) {
  return this.userRepo.findOne({ where: { id: userId } });
}
`;
      const matches = await unsafeRepositoryRule.detect(
        content,
        'user.repository.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('missingGuardRule', () => {
    it('should detect @Post without @UseGuards', async () => {
      const content = `
import { Controller, Post, Body } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }
}
`;
      const matches = await missingGuardRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('nestjs-missing-guard');
    });

    it('should detect @Delete without @UseGuards', async () => {
      const content = `
import { Controller, Delete, Param } from '@nestjs/common';

@Controller('users')
export class UserController {
  @Delete(':id')
  async deleteUser(@Param('id') id: string) {
    return this.userService.delete(id);
  }
}
`;
      const matches = await missingGuardRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(1);
    });

    it('should NOT detect when class-level @UseGuards is present', async () => {
      const content = `
import { Controller, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from './auth.guard';

@Controller('users')
@UseGuards(AuthGuard)
export class UserController {
  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }
}
`;
      const matches = await missingGuardRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect when method-level @UseGuards is present', async () => {
      const content = `
import { Controller, Post, UseGuards } from '@nestjs/common';

@Controller('users')
export class UserController {
  @UseGuards(AuthGuard)
  @Post()
  async createUser(@Body() dto: CreateUserDto) {
    return this.userService.create(dto);
  }
}
`;
      const matches = await missingGuardRule.detect(
        content,
        'user.controller.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('circularModuleRule', () => {
    it('should detect forwardRef in module imports', async () => {
      const content = `
import { Module, forwardRef } from '@nestjs/common';

@Module({
  imports: [forwardRef(() => OtherModule)],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
`;
      const matches = await circularModuleRule.detect(
        content,
        'user.module.ts',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('nestjs-circular-module');
    });

    it('should NOT detect modules without forwardRef', async () => {
      const content = `
import { Module } from '@nestjs/common';

@Module({
  imports: [OtherModule, SharedModule],
  controllers: [UserController],
  providers: [UserService],
})
export class UserModule {}
`;
      const matches = await circularModuleRule.detect(
        content,
        'user.module.ts',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect forwardRef outside imports', async () => {
      const content = `
import { Module, forwardRef } from '@nestjs/common';

@Module({
  imports: [OtherModule],
  providers: [
    {
      provide: 'SERVICE',
      useFactory: (dep) => new MyService(dep),
      inject: [forwardRef(() => DepService)],
    }
  ],
})
export class UserModule {}
`;
      const matches = await circularModuleRule.detect(
        content,
        'user.module.ts',
      );

      // The regex only matches forwardRef inside the imports array
      expect(matches.length).toBe(0);
    });
  });

  it('nestjsRules should contain all 5 rules', async () => {
    expect(nestjsRules).toHaveLength(5);
  });
});

// ============================================
// React Rules Tests
// ============================================

describe('React Rules', () => {
  describe('missingKeyRule', () => {
    it('should detect .map() returning JSX without key', async () => {
      const content = `
function UserList({ users }) {
  return (
    <ul>
      {users.map(user => <li>{user.name}</li>)}
    </ul>
  );
}
`;
      const matches = await missingKeyRule.detect(content, 'UserList.tsx');

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('react-missing-key');
    });

    it('should NOT detect .map() with key prop', async () => {
      const content = `
function UserList({ users }) {
  return (
    <ul>
      {users.map(user => <li key={user.id}>{user.name}</li>)}
    </ul>
  );
}
`;
      const matches = await missingKeyRule.detect(content, 'UserList.tsx');

      expect(matches.length).toBe(0);
    });

    it('should detect .map() with parenthesized arrow returning JSX', async () => {
      const content = `
function ItemGrid({ items }) {
  return (
    <div>
      {items.map((item) => <Card title={item.name} />)}
    </div>
  );
}
`;
      const matches = await missingKeyRule.detect(content, 'ItemGrid.tsx');

      expect(matches.length).toBe(1);
    });

    it('should NOT detect .map() returning non-JSX', async () => {
      const content = `
function getNames(users) {
  return users.map(user => user.name);
}
`;
      const matches = await missingKeyRule.detect(content, 'utils.tsx');

      expect(matches.length).toBe(0);
    });
  });

  describe('directStateMutationRule', () => {
    it('should detect this.state.property = value', async () => {
      const content = `
class Counter extends React.Component {
  increment() {
    this.state.count = this.state.count + 1;
  }
}
`;
      const matches = await directStateMutationRule.detect(
        content,
        'Counter.tsx',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('react-direct-state-mutation');
    });

    it('should detect multiple state mutations', async () => {
      const content = `
class Form extends React.Component {
  update() {
    this.state.name = 'John';
    this.state.age = 30;
  }
}
`;
      const matches = await directStateMutationRule.detect(content, 'Form.tsx');

      expect(matches.length).toBe(2);
    });

    it('should NOT detect this.setState()', async () => {
      const content = `
class Counter extends React.Component {
  increment() {
    this.setState({ count: this.state.count + 1 });
  }
}
`;
      const matches = await directStateMutationRule.detect(
        content,
        'Counter.tsx',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect regular object property assignment', async () => {
      const content = `
class UserService {
  update(data) {
    this.data.name = data.name;
    this.config.value = 42;
  }
}
`;
      const matches = await directStateMutationRule.detect(
        content,
        'UserService.ts',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('useEffectDependenciesRule', () => {
    it('should detect useEffect with [] deps referencing props', async () => {
      const content = `
function UserProfile({ userId }) {
  useEffect(() => {
    fetchUser(props.userId);
  }, []);
}
`;
      const matches = await useEffectDependenciesRule.detect(
        content,
        'UserProfile.tsx',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('react-useeffect-dependencies');
      expect(matches[0].metadata?.['referencesProps']).toBe(true);
    });

    it('should detect useEffect with [] deps referencing state', async () => {
      const content = `
function Counter() {
  const [count, setCount] = useState(0);

  useEffect(() => {
    document.title = state.count;
  }, []);
}
`;
      const matches = await useEffectDependenciesRule.detect(
        content,
        'Counter.tsx',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].metadata?.['referencesState']).toBe(true);
    });

    it('should NOT detect useEffect with proper dependencies', async () => {
      const content = `
function UserProfile({ userId }) {
  useEffect(() => {
    fetchUser(userId);
  }, [userId]);
}
`;
      const matches = await useEffectDependenciesRule.detect(
        content,
        'UserProfile.tsx',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect useEffect with [] deps not referencing props/state', async () => {
      const content = `
function App() {
  useEffect(() => {
    console.log('mounted');
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);
}
`;
      const matches = await useEffectDependenciesRule.detect(
        content,
        'App.tsx',
      );

      expect(matches.length).toBe(0);
    });
  });

  describe('reactLargeComponentRule', () => {
    it('should detect React component file with >300 lines', async () => {
      const header = `
import React from 'react';

function Dashboard() {
  return (
    <div>
`;
      const body = Array(300).fill('      <span>line</span>').join('\n');
      const footer = `
    </div>
  );
}

export default Dashboard;
`;
      const content = header + body + footer;

      const matches = await reactLargeComponentRule.detect(
        content,
        'Dashboard.tsx',
      );

      expect(matches.length).toBe(1);
      expect(matches[0].type).toBe('react-large-component');
      expect(matches[0].metadata?.['lineCount']).toBeGreaterThan(300);
    });

    it('should NOT detect small React component', async () => {
      const content = `
import React from 'react';

function Button({ onClick, children }) {
  return (
    <button onClick={onClick} className="btn">
      {children}
    </button>
  );
}

export default Button;
`;
      const matches = await reactLargeComponentRule.detect(
        content,
        'Button.tsx',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect large non-component TSX file', async () => {
      const body = Array(400).fill('  const x = 1;').join('\n');
      const content = `
// Utility file with no React component
${body}
`;
      const matches = await reactLargeComponentRule.detect(
        content,
        'utils.tsx',
      );

      expect(matches.length).toBe(0);
    });

    it('should detect class component with >300 lines', async () => {
      const header = `
import React, { Component } from 'react';

class BigComponent extends Component {
  render() {
    return (
      <div>
`;
      const body = Array(300).fill('        <span>line</span>').join('\n');
      const footer = `
      </div>
    );
  }
}

export default BigComponent;
`;
      const content = header + body + footer;

      const matches = await reactLargeComponentRule.detect(
        content,
        'BigComponent.tsx',
      );

      expect(matches.length).toBe(1);
    });
  });

  describe('inlineFunctionPropRule', () => {
    it('should detect inline arrow function prop', async () => {
      const content = `
function UserList({ users, onSelect }) {
  return (
    <ul>
      {users.map(user => (
        <UserItem key={user.id} onClick={(e) => onSelect(user.id)} />
      ))}
    </ul>
  );
}
`;
      const matches = await inlineFunctionPropRule.detect(
        content,
        'UserList.tsx',
      );

      expect(matches.length).toBeGreaterThanOrEqual(1);
      expect(matches[0].type).toBe('react-inline-function-prop');
    });

    it('should detect multiple inline function props', async () => {
      const content = `
<Form
  onSubmit={(e) => handleSubmit(e)}
  onChange={(val) => setValue(val)}
  onReset={() => resetForm()}
/>
`;
      // The first two match our pattern, the third has () which matches too
      const matches = await inlineFunctionPropRule.detect(content, 'Form.tsx');

      expect(matches.length).toBeGreaterThanOrEqual(2);
    });

    it('should NOT detect named function reference props', async () => {
      const content = `
function UserList({ onSelect }) {
  return <UserItem onClick={handleClick} onHover={handleHover} />;
}
`;
      const matches = await inlineFunctionPropRule.detect(
        content,
        'UserList.tsx',
      );

      expect(matches.length).toBe(0);
    });

    it('should NOT detect non-function props', async () => {
      const content = `
<Component title="hello" count={42} active={true} data={items} />
`;
      const matches = await inlineFunctionPropRule.detect(content, 'Test.tsx');

      expect(matches.length).toBe(0);
    });
  });

  it('reactRules should contain all 5 rules', async () => {
    expect(reactRules).toHaveLength(5);
  });
});

// ============================================
// RuleRegistry Integration Tests for New Categories
// ============================================

describe('RuleRegistry Integration - Framework Rules', () => {
  let registry: RuleRegistry;

  beforeEach(() => {
    registry = new RuleRegistry();
  });

  describe('ALL_RULES', () => {
    it('should contain 25 total rules (10 existing + 15 new)', async () => {
      expect(ALL_RULES.length).toBe(25);
    });

    it('should contain all 7 categories', async () => {
      const categories = new Set(ALL_RULES.map((r) => r.category));

      expect(categories.has('typescript')).toBe(true);
      expect(categories.has('error-handling')).toBe(true);
      expect(categories.has('architecture')).toBe(true);
      expect(categories.has('testing')).toBe(true);
      expect(categories.has('angular')).toBe(true);
      expect(categories.has('nestjs')).toBe(true);
      expect(categories.has('react')).toBe(true);
    });

    it('should have unique rule IDs across all 25 rules', async () => {
      const ids = ALL_RULES.map((r) => r.id);
      const uniqueIds = new Set(ids);

      expect(uniqueIds.size).toBe(25);
    });

    it('should have all rules enabled by default', async () => {
      ALL_RULES.forEach((rule) => {
        expect(rule.enabledByDefault).toBe(true);
      });
    });
  });

  describe('getRulesByCategory for new categories', () => {
    it('should return 5 angular rules', async () => {
      const rules = registry.getRulesByCategory('angular');

      expect(rules.length).toBe(5);
      rules.forEach((rule) => {
        expect(rule.category).toBe('angular');
      });
    });

    it('should return 5 nestjs rules', async () => {
      const rules = registry.getRulesByCategory('nestjs');

      expect(rules.length).toBe(5);
      rules.forEach((rule) => {
        expect(rule.category).toBe('nestjs');
      });
    });

    it('should return 5 react rules', async () => {
      const rules = registry.getRulesByCategory('react');

      expect(rules.length).toBe(5);
      rules.forEach((rule) => {
        expect(rule.category).toBe('react');
      });
    });
  });

  describe('getRulesForExtension for new file types', () => {
    it('should return React rules for .tsx files', async () => {
      const rules = registry.getRulesForExtension('.tsx');

      // .tsx should match: typescript rules (3) + architecture rules (3) + some react rules + some angular
      const reactRulesInTsx = rules.filter((r) => r.category === 'react');
      expect(reactRulesInTsx.length).toBeGreaterThanOrEqual(3);
    });

    it('should return React rules for .jsx files', async () => {
      const rules = registry.getRulesForExtension('.jsx');

      const reactRulesInJsx = rules.filter((r) => r.category === 'react');
      expect(reactRulesInJsx.length).toBeGreaterThanOrEqual(3);
    });

    it('should return Angular and NestJS rules for .ts files', async () => {
      const rules = registry.getRulesForExtension('.ts');

      const angularRulesInTs = rules.filter((r) => r.category === 'angular');
      const nestjsRulesInTs = rules.filter((r) => r.category === 'nestjs');

      expect(angularRulesInTs.length).toBe(5);
      expect(nestjsRulesInTs.length).toBe(5);
    });

    it('should return Angular trackBy rule for .html files', async () => {
      const rules = registry.getRulesForExtension('.html');

      expect(rules.length).toBeGreaterThanOrEqual(1);
      const trackByRule = rules.find((r) => r.id === 'angular-missing-trackby');
      expect(trackByRule).toBeDefined();
    });
  });
});
