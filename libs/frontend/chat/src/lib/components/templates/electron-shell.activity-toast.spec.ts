/**
 * ElectronShellComponent — activity-toast placement spec (TASK_2026_405).
 *
 * Pins the four things the move out of the navbar has to keep true, none of
 * which `ActivityTickerComponent`'s own spec can see because that component is
 * handed its inputs directly and knows nothing about where it is mounted:
 *
 * 1. no activity element inside the navbar row;
 * 2. the toast is mounted outside that row, fixed and top-right;
 * 3. the pass-through layer never takes pointer events, the card does;
 * 4. idle removes the card and the next message brings it back.
 *
 * Testing strategy mirrors `chat-view.component.spec.ts`: stub `ngx-markdown`
 * before the component import, then render the real template with every child
 * except `ActivityTickerComponent` left as an unknown element
 * (`CUSTOM_ELEMENTS_SCHEMA`). The ticker stays real because point 4 is about
 * what it actually renders inside the card; instantiating the chat panel, the
 * workspace sidebar or the git dock would only add failure modes.
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  CUSTOM_ELEMENTS_SCHEMA,
  signal,
} from '@angular/core';

// Stub ngx-markdown (ESM-only bundle) BEFORE any component import.
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
import {
  AppStateManager,
  BackOfficeActivityService,
  ElectronLayoutService,
  VSCodeService,
  type ActivityItem,
} from '@ptah-extension/core';
import { ActivityTickerComponent } from '@ptah-extension/chat-ui';
import { ElectronShellComponent } from './electron-shell.component';

function activityItem(id: string, summary: string): ActivityItem {
  return {
    id,
    source: 'cron',
    kind: 'cron-run',
    summary,
    timestamp: 1,
    level: 'info',
  };
}

describe('ElectronShellComponent — activity toast', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;
  const items = signal<readonly ActivityItem[]>([]);
  const idle = signal(true);

  const layoutStub = {
    hasWorkspaceFolders: () => true,
    workspaceSidebarVisible: () => false,
    workspaceSidebarWidth: () => 240,
    editorPanelVisible: () => false,
    editorPanelWidth: () => 320,
    toggleWorkspaceSidebar: jest.fn(),
    toggleEditorPanel: jest.fn(),
    setSidebarDragging: jest.fn(),
    setEditorDragging: jest.fn(),
    setWorkspaceSidebarWidth: jest.fn(),
    setEditorPanelWidth: jest.fn(),
  };

  const appStateStub = {
    currentView: () => 'chat',
    thothFirstRunDismissed: () => true,
    setLayoutMode: jest.fn(),
    setCurrentView: jest.fn(),
    dismissThothFirstRun: jest.fn(),
  };

  const vscodeStub = {
    getPtahIconUri: () => 'icon.png',
    config: () => ({ platform: 'win32' }),
  };

  function navbar(): HTMLElement {
    // The navbar row is the first child of the shell's flex column.
    const row = fixture.nativeElement.querySelector('.h-10');
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  function layer(): HTMLElement | null {
    return fixture.nativeElement.querySelector(
      '[data-testid="activity-toast-layer"]',
    );
  }

  function card(): HTMLElement | null {
    return fixture.nativeElement.querySelector('[data-testid="activity-toast"]');
  }

  beforeEach(async () => {
    items.set([]);
    idle.set(true);
    appStateStub.setCurrentView.mockClear();

    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        { provide: VSCodeService, useValue: vscodeStub },
        {
          provide: BackOfficeActivityService,
          useValue: { recent: items, isIdle: idle },
        },
      ],
    })
      .overrideComponent(ElectronShellComponent, {
        set: {
          imports: [ActivityTickerComponent],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('keeps every activity element out of the navbar row', () => {
    idle.set(false);
    items.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    expect(card()).toBeTruthy();
    expect(navbar().querySelector('ptah-activity-ticker')).toBeNull();
    expect(
      navbar().querySelector('[data-testid="activity-toast-layer"]'),
    ).toBeNull();
    expect(navbar().querySelector('[data-testid="activity-toast"]')).toBeNull();
  });

  it('anchors the toast top-right, fixed and above the content', () => {
    const classes = layer()?.getAttribute('class') ?? '';

    expect(classes).toContain('fixed');
    expect(classes).toContain('top-11');
    expect(classes).toContain('right-3');
    expect(classes).toContain('z-50');
  });

  it('never lets the pass-through layer take clicks, but keeps the card clickable', () => {
    // Idle: layer present, card gone — nothing under the corner is blocked.
    expect(layer()?.getAttribute('class')).toContain('pointer-events-none');
    expect(card()).toBeNull();

    idle.set(false);
    items.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    // Busy: the layer is STILL pointer-events-none; only the card opts in.
    expect(layer()?.getAttribute('class')).toContain('pointer-events-none');
    expect(card()?.getAttribute('class')).toContain('pointer-events-auto');
  });

  it('hides the toast when idle and shows it again on the next message', () => {
    expect(card()).toBeNull();

    idle.set(false);
    items.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();
    expect(card()).toBeTruthy();

    idle.set(true);
    fixture.detectChanges();
    expect(card()).toBeNull();

    idle.set(false);
    items.set([activityItem('b', 'Indexing 80%'), activityItem('a', 'Backup')]);
    fixture.detectChanges();
    expect(card()).toBeTruthy();
  });

  it('renders the ticker line inside the toast and opens Thoth when it is clicked', () => {
    idle.set(false);
    items.set([activityItem('a', 'Backup finished')]);
    fixture.detectChanges();

    const line = card()?.querySelector('[data-testid="activity-ticker-line"]');
    expect(line?.textContent?.trim()).toBe('Backup finished');

    card()?.querySelector('button')?.click();
    expect(appStateStub.setCurrentView).toHaveBeenCalledWith('thoth');
  });
});
