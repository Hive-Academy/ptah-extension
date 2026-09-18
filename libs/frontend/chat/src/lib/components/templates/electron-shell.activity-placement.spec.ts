/**
 * ElectronShellComponent — activity placement spec (TASK_2026_405).
 *
 * The back-office activity ticker must not live in this shell. Two earlier
 * placements both failed here:
 *
 * 1. in the navbar action cluster — an arriving message resized the cluster
 *    and shifted the centered tab strip;
 * 2. in a fixed top-right toast that published its own width — the canvas dock
 *    padded its right edge from that width, so the Layout and New Session
 *    buttons moved on every message.
 *
 * The ticker now sits in the canvas dock row, in normal flow, on that row's
 * free left edge (`OrchestraCanvasComponent`). This spec pins the shell side
 * of that decision: no ticker element, and no width-reservation variable.
 *
 * Testing strategy mirrors `chat-view.component.spec.ts`: stub `ngx-markdown`
 * before the component import, then render the real template with every child
 * left as an unknown element (`CUSTOM_ELEMENTS_SCHEMA`).
 */

import {
  Component,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  CUSTOM_ELEMENTS_SCHEMA,
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
  ElectronLayoutService,
  VSCodeService,
} from '@ptah-extension/core';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShellComponent — activity placement', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;

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

  function shell(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function navbar(): HTMLElement {
    // The navbar row is the first child of the shell's flex column.
    const row = shell().querySelector('.h-10');
    expect(row).toBeTruthy();
    return row as HTMLElement;
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        { provide: VSCodeService, useValue: vscodeStub },
      ],
    })
      .overrideComponent(ElectronShellComponent, {
        set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();

    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('mounts no activity ticker anywhere in the shell', () => {
    expect(shell().querySelector('ptah-activity-ticker')).toBeNull();
    expect(navbar().querySelector('ptah-activity-ticker')).toBeNull();
  });

  it('keeps the removed floating toast out of the shell', () => {
    expect(
      shell().querySelector('[data-testid="activity-toast-layer"]'),
    ).toBeNull();
    expect(shell().querySelector('[data-testid="activity-toast"]')).toBeNull();
  });

  it('publishes no toast-width variable that a dock could pad from', () => {
    const root = shell().firstElementChild as HTMLElement | null;
    expect(root).toBeTruthy();
    expect(root?.getAttribute('style') ?? '').not.toContain(
      '--ptah-activity-toast-inset',
    );
  });
});
