import {
  Component,
  ChangeDetectionStrategy,
  EventEmitter,
  Input,
  NgModule,
  Output,
  signal,
} from '@angular/core';
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data }}</div>`,
  })
  class MarkdownStubComponent {
    @Input() data: string | null | undefined = '';
  }
  @NgModule({
    imports: [MarkdownStubComponent],
    exports: [MarkdownStubComponent],
  })
  class MarkdownModule {}
  return {
    MarkdownModule,
    MarkdownComponent: MarkdownStubComponent,
    provideMarkdown: () => [],
    MARKED_OPTIONS: 'MARKED_OPTIONS',
    CLIPBOARD_OPTIONS: 'CLIPBOARD_OPTIONS',
    MARKED_EXTENSIONS: 'MARKED_EXTENSIONS',
    MERMAID_OPTIONS: 'MERMAID_OPTIONS',
    SANITIZE: 'SANITIZE',
  };
});

import { ComponentFixture, TestBed } from '@angular/core/testing';
import { TabState } from '@ptah-extension/chat-types';
import { TabManagerService } from '@ptah-extension/chat-state';
import {
  AwaitingBackgroundIndicatorComponent,
  TabItemComponent,
} from '@ptah-extension/chat-ui';
import { LucideAngularModule } from 'lucide-angular';
import { TabBarComponent } from './tab-bar.component';

class MockResizeObserver {
  observe(): void {
    return;
  }
  unobserve(): void {
    return;
  }
  disconnect(): void {
    return;
  }
}
(
  globalThis as unknown as { ResizeObserver: typeof MockResizeObserver }
).ResizeObserver = MockResizeObserver;

@Component({
  selector: 'ptah-tab-item',
  standalone: true,
  template: '<div data-test="tab-item-stub">{{ tab?.title }}</div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class TabItemStubComponent {
  @Input() tab: TabState | null = null;
  @Input() isActive = false;
  @Input() isStreaming = false;
  @Input() livenessStatus: unknown = undefined;
  @Output() tabSelect = new EventEmitter<string>();
  @Output() tabClose = new EventEmitter<string>();
  @Output() viewModeToggle = new EventEmitter<string>();
}

@Component({
  selector: 'ptah-awaiting-background-indicator',
  standalone: true,
  template:
    '<div data-test="awaiting-background-stub">{{ taskCount }} tasks</div>',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
class AwaitingBackgroundIndicatorStubComponent {
  @Input() taskCount = 0;
  @Input() tasks: unknown[] = [];
}

function makeTab(overrides: Partial<TabState> = {}): TabState {
  return {
    id: overrides.id ?? 'tab-1',
    claudeSessionId: null,
    name: 'Test Tab',
    title: 'Test Tab',
    order: 0,
    status: overrides.status ?? 'loaded',
    isDirty: false,
    lastActivityAt: 0,
    messages: [],
    streamingState: null,
    pendingBackgroundTasks: overrides.pendingBackgroundTasks,
    ...overrides,
  } as TabState;
}

describe('TabBarComponent', () => {
  let fixture: ComponentFixture<TabBarComponent>;
  const tabsSignal = signal<TabState[]>([]);
  const activeTabIdSignal = signal<string | null>(null);

  const mockTabManager = {
    tabs: tabsSignal,
    activeTabId: activeTabIdSignal,
    isTabStreaming: jest.fn().mockReturnValue(false),
    switchTab: jest.fn(),
    closeTab: jest.fn(),
    toggleTabViewMode: jest.fn(),
  };

  beforeEach(async () => {
    tabsSignal.set([]);
    activeTabIdSignal.set(null);
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [TabBarComponent],
      providers: [{ provide: TabManagerService, useValue: mockTabManager }],
    })
      .overrideComponent(TabBarComponent, {
        remove: {
          imports: [
            AwaitingBackgroundIndicatorComponent,
            TabItemComponent,
            LucideAngularModule,
          ],
        },
        add: {
          imports: [
            TabItemStubComponent,
            AwaitingBackgroundIndicatorStubComponent,
            LucideAngularModule,
          ],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(TabBarComponent);
  });

  it('creates with no tabs', () => {
    fixture.detectChanges();
    expect(fixture.componentInstance).toBeTruthy();
  });

  it('does not render awaiting-background slot when no active tab is awaiting-background', () => {
    tabsSignal.set([
      makeTab({ id: 'a', status: 'loaded' }),
      makeTab({ id: 'b', status: 'streaming' }),
    ]);
    activeTabIdSignal.set('a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-test="tab-bar-awaiting-background-slot"]',
      ),
    ).toBeNull();
  });

  it('renders awaiting-background slot when active tab is awaiting-background', () => {
    tabsSignal.set([
      makeTab({
        id: 'a',
        status: 'awaiting-background',
        pendingBackgroundTasks: [
          {
            id: 't1',
            type: 'subagent',
            status: 'running',
            description: 'in-flight subagent',
          },
        ],
      }),
    ]);
    activeTabIdSignal.set('a');
    fixture.detectChanges();
    const slot = fixture.nativeElement.querySelector(
      '[data-test="tab-bar-awaiting-background-slot"]',
    );
    expect(slot).toBeTruthy();
    expect(slot.textContent).toContain('1 tasks');
  });

  it('hides slot when active tab flips back to loaded', () => {
    tabsSignal.set([
      makeTab({
        id: 'a',
        status: 'awaiting-background',
        pendingBackgroundTasks: [
          {
            id: 't1',
            type: 'subagent',
            status: 'running',
            description: 'in-flight subagent',
          },
        ],
      }),
    ]);
    activeTabIdSignal.set('a');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-test="tab-bar-awaiting-background-slot"]',
      ),
    ).toBeTruthy();
    tabsSignal.set([
      makeTab({ id: 'a', status: 'loaded', pendingBackgroundTasks: [] }),
    ]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector(
        '[data-test="tab-bar-awaiting-background-slot"]',
      ),
    ).toBeNull();
  });

  it('passes a zero-length task array when pendingBackgroundTasks is undefined', () => {
    tabsSignal.set([makeTab({ id: 'a', status: 'awaiting-background' })]);
    activeTabIdSignal.set('a');
    fixture.detectChanges();
    const slot = fixture.nativeElement.querySelector(
      '[data-test="tab-bar-awaiting-background-slot"]',
    );
    expect(slot).toBeTruthy();
    expect(slot.textContent).toContain('0 tasks');
  });
});
