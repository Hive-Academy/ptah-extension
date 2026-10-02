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
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import {
  AwaitingBackgroundIndicatorComponent,
  TabItemComponent,
} from '@ptah-extension/chat-ui';
import { LucideAngularModule } from 'lucide-angular';
import { FloatingUIService } from '@ptah-extension/ui';
import { TabBarComponent, tailPath } from './tab-bar.component';

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
  template: `<div data-test="tab-item-stub" (click)="tabSelect.emit(tab?.id)">
    <ng-content select="[tabItemLeading]" />{{ tab?.title }}
  </div>`,
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
  @Input() crons: unknown[] = [];
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

  const floatingUI = {
    position: jest.fn().mockResolvedValue(undefined),
    cleanup: jest.fn(),
  };

  const claimedSurfaces = new Map<string, string>();
  const mockClaims = {
    surfaceFor: jest.fn(
      (id: string): string | null => claimedSurfaces.get(id) ?? null,
    ),
  };

  beforeEach(async () => {
    tabsSignal.set([]);
    activeTabIdSignal.set(null);
    claimedSurfaces.clear();
    jest.clearAllMocks();
    await TestBed.configureTestingModule({
      imports: [TabBarComponent],
      providers: [
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: WorkflowSessionClaimService, useValue: mockClaims },
      ],
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
      .overrideProvider(FloatingUIService, { useValue: floatingUI })
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

  it('renders the slot for a sleeping tab and hands it the session crons (TASK_2026_360)', () => {
    tabsSignal.set([
      makeTab({
        id: 'a',
        status: 'sleeping',
        pendingBackgroundTasks: [],
        pendingSessionCrons: [
          { id: 'c1', schedule: '*/5 * * * *', recurring: true, prompt: 'p' },
        ],
      }),
    ]);
    activeTabIdSignal.set('a');
    fixture.detectChanges();

    const slot = fixture.nativeElement.querySelector(
      '[data-test="tab-bar-awaiting-background-slot"]',
    );
    expect(slot).toBeTruthy();
    const stub = fixture.debugElement.query(
      (el) => el.name === 'ptah-awaiting-background-indicator',
    );
    expect(stub.componentInstance.crons).toHaveLength(1);
  });

  it('hides workflow-claimed tabs from the rendered tab list', () => {
    tabsSignal.set([
      makeTab({ id: 'chat', title: 'Chat' }),
      makeTab({ id: 'workflow', title: 'Tribunal: council' }),
    ]);
    claimedSurfaces.set('workflow', 'surface-1');
    fixture.detectChanges();

    const items = fixture.nativeElement.querySelectorAll(
      '[data-test="tab-item-stub"]',
    );
    expect(items.length).toBe(1);
    expect(items[0].textContent).toContain('Chat');
  });

  it('reveals a previously-claimed tab once its claim is released', () => {
    tabsSignal.set([makeTab({ id: 'workflow', title: 'Tribunal: council' })]);
    claimedSurfaces.set('workflow', 'surface-1');
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-test="tab-item-stub"]')
        .length,
    ).toBe(0);

    claimedSurfaces.delete('workflow');
    tabsSignal.set([makeTab({ id: 'workflow', title: 'Tribunal: council' })]);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelectorAll('[data-test="tab-item-stub"]')
        .length,
    ).toBe(1);
  });

  describe('agent badge (TASK_2026_584)', () => {
    const origin = {
      parentTabId: 'parent',
      parentSessionId: null,
      label: 'Child',
      branch: 'feat/child',
      worktreePath: '/ws/.worktrees/child',
      startedAt: 1,
    };

    function badges(): HTMLButtonElement[] {
      return Array.from(
        fixture.nativeElement.querySelectorAll(
          '[data-test="tab-bar-agent-badge"]',
        ),
      );
    }

    function tooltip(): HTMLElement | null {
      return fixture.nativeElement.querySelector(
        '[data-test="tab-bar-agent-badge-tooltip"]',
      );
    }

    function withParent(): void {
      tabsSignal.set([
        makeTab({ id: 'parent', title: 'Planner' }),
        makeTab({ id: 'child', title: 'Child', agentOrigin: origin }),
      ]);
      fixture.detectChanges();
    }

    it('renders only on tabs with an agent origin', () => {
      withParent();
      expect(badges()).toHaveLength(1);
    });

    it('sits inside the child tab item, before its title', () => {
      withParent();
      const items: HTMLElement[] = Array.from(
        fixture.nativeElement.querySelectorAll('[data-test="tab-item-stub"]'),
      );
      const [badge] = badges();

      expect(items[0].contains(badge)).toBe(false);
      expect(items[1].contains(badge)).toBe(true);
      expect(items[1].firstElementChild).toBe(badge);
    });

    it('is a compact, icon-only, labelled, keyboard-reachable button with no native title', () => {
      withParent();

      const [badge] = badges();
      expect(badge.tagName).toBe('BUTTON');
      expect(badge.type).toBe('button');
      expect(badge.tabIndex).toBe(0);
      // Accessible name = the tooltip's first line.
      expect(badge.getAttribute('aria-label')).toBe('Started by Planner');
      expect(badge.getAttribute('aria-disabled')).toBeNull();
      expect(badge.hasAttribute('title')).toBe(false);
      // Icon only: no visible text, so the tab title keeps its width.
      expect(badge.textContent?.trim()).toBe('');
      expect(badge.querySelector('lucide-angular')?.classList).toContain('w-3');
      // 12px icon + 6px padding on each side = 24x24 hit area; the negative
      // block margin keeps the tab height unchanged.
      expect(badge.classList).toContain('p-1.5');
      expect(badge.classList).toContain('-my-1');
      expect(badge.className).not.toContain('badge');
      // Icon on the base-content token (passes 3:1 on the tab background in
      // both themes); no info hue, no info focus ring overriding the global
      // gold `button:focus-visible` ring.
      expect(badge.classList).toContain('text-base-content');
      expect(badge.innerHTML).not.toContain('text-info');
      expect(badge.className).not.toContain('outline-info');
      expect(badge.classList).toContain('cursor-pointer');
      expect(badge.classList).not.toContain('opacity-60');
    });

    it('switches to the parent tab when activated, without selecting the child tab it sits in', () => {
      withParent();
      activeTabIdSignal.set('child');
      fixture.detectChanges();

      badges()[0].click();

      expect(mockTabManager.switchTab).toHaveBeenCalledTimes(1);
      expect(mockTabManager.switchTab).toHaveBeenCalledWith('parent');
    });

    it('says the parent tab is gone, looks inert and does nothing when activated', () => {
      tabsSignal.set([
        makeTab({ id: 'child', title: 'Child', agentOrigin: origin }),
      ]);
      fixture.detectChanges();

      const [badge] = badges();
      expect(badge.getAttribute('aria-label')).toBe(
        'Started by an agent session (parent tab closed)',
      );
      expect(badge.getAttribute('aria-disabled')).toBe('true');
      expect(badge.classList).toContain('opacity-60');
      expect(badge.classList).toContain('cursor-default');
      expect(badge.classList).not.toContain('cursor-pointer');

      badge.click();
      expect(mockTabManager.switchTab).not.toHaveBeenCalled();
    });

    it('shows the origin tooltip on keyboard focus, described by the badge, and hides it on blur', () => {
      withParent();
      const [badge] = badges();
      expect(tooltip()).toBeNull();

      badge.dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();

      const tip = tooltip();
      expect(tip?.getAttribute('role')).toBe('tooltip');
      expect(badge.getAttribute('aria-describedby')).toBe(tip?.id);
      expect(tip?.textContent).toContain('Started by Planner');
      expect(tip?.textContent).toContain('feat/child');
      expect(tip?.textContent).toContain('…/.worktrees/child');
      expect(floatingUI.position).toHaveBeenCalledWith(
        badge,
        tip,
        expect.objectContaining({ placement: 'bottom-start' }),
      );

      badge.dispatchEvent(new FocusEvent('blur'));
      fixture.detectChanges();
      expect(tooltip()).toBeNull();
      expect(badge.getAttribute('aria-describedby')).toBeNull();
      expect(floatingUI.cleanup).toHaveBeenCalled();
    });

    it('shows the tooltip on hover, says the parent is gone, and Escape dismisses it', () => {
      tabsSignal.set([
        makeTab({ id: 'child', title: 'Child', agentOrigin: origin }),
      ]);
      fixture.detectChanges();
      const [badge] = badges();

      badge.dispatchEvent(new MouseEvent('mouseenter'));
      fixture.detectChanges();
      expect(tooltip()?.textContent).toContain('parent tab closed');

      badge.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
      fixture.detectChanges();
      expect(tooltip()).toBeNull();
    });

    it('drops the tooltip and releases Floating UI when its tab is closed while it is open', () => {
      withParent();
      badges()[0].dispatchEvent(new FocusEvent('focus'));
      fixture.detectChanges();
      expect(tooltip()).not.toBeNull();
      floatingUI.cleanup.mockClear();

      // The tab is removed with the tooltip open; no blur reaches the badge.
      tabsSignal.set([makeTab({ id: 'parent', title: 'Planner' })]);
      fixture.detectChanges();

      expect(tooltip()).toBeNull();
      expect(floatingUI.cleanup).toHaveBeenCalledTimes(1);
    });
  });

  describe('tailPath', () => {
    it.each([
      ['/ws/.worktrees/child', '…/.worktrees/child'],
      [
        'C:\\ws\\.worktrees\\feat-agent-auth-tests',
        '…\\.worktrees\\feat-agent-auth-tests',
      ],
      ['/child', '/child'],
      ['ws/child', 'ws/child'],
    ])('shortens %s to %s', (input, expected) => {
      expect(tailPath(input)).toBe(expected);
    });
  });
});
