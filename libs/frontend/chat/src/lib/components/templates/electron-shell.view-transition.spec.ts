import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  input,
  signal,
} from '@angular/core';

// The shell's child import graph reaches the ESM-only ngx-markdown package.
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '{{ data() }}',
  })
  class MarkdownStubComponent {
    readonly data = input<string | null | undefined>('');
  }

  return {
    MarkdownModule: MarkdownStubComponent,
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
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShellComponent view-transition surface', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;

  const layoutStub = {
    hasWorkspaceFolders: signal(false),
    workspaceSidebarVisible: signal(false),
    workspaceSidebarWidth: signal(240),
    editorPanelVisible: signal(false),
    editorPanelWidth: signal(320),
    toggleWorkspaceSidebar: jest.fn(),
    toggleEditorPanel: jest.fn(),
    setEditorDragging: jest.fn(),
    setEditorPanelWidth: jest.fn(),
  };
  const appStateStub = {
    currentView: signal('chat'),
    openConfigurationSurface: signal<string | null>(null),
    configurationSurfaceRemountTick: signal(0),
    thothFirstRunDismissed: signal(true),
    setCurrentView: jest.fn(),
  };

  function expectOnlySurface(selector: string): HTMLElement {
    const surfaces = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLElement>('.ptah-vt-surface');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].matches(selector)).toBe(true);
    return surfaces[0];
  }

  beforeEach(async () => {
    layoutStub.hasWorkspaceFolders.set(false);
    layoutStub.workspaceSidebarVisible.set(false);
    layoutStub.editorPanelVisible.set(false);
    appStateStub.currentView.set('chat');
    appStateStub.openConfigurationSurface.set(null);
    appStateStub.configurationSurfaceRemountTick.set(0);

    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        { provide: ClosedTabSessionEnderService, useValue: {} },
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        {
          provide: SurfaceRouterService,
          useValue: {
            remountActiveSurface: jest.fn(),
            pendingSurface: () => null,
          },
        },
        {
          provide: VSCodeService,
          useValue: {
            getPtahIconUri: () => 'icon.png',
            config: () => ({ platform: 'win32' }),
          },
        },
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

  it('names only the welcome element before a workspace opens', () => {
    expectOnlySurface('ptah-electron-welcome');
  });

  it('names only the outlet wrapper on a pre-workspace configuration page', () => {
    appStateStub.openConfigurationSurface.set('settings');
    fixture.detectChanges();
    const wrapper = expectOnlySurface('div');
    expect(wrapper.querySelector('router-outlet')).not.toBeNull();
  });

  it('names only the content host when a workspace is open', () => {
    layoutStub.hasWorkspaceFolders.set(true);
    fixture.detectChanges();
    expectOnlySurface('[data-test="configuration-surface-host"]');
  });
});
