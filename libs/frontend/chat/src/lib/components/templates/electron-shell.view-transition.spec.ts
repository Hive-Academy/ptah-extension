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

import {
  ComponentFixture,
  DeferBlockBehavior,
  DeferBlockState,
  TestBed,
} from '@angular/core/testing';
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
    workspaceResolved: signal(true),
    pendingWorkspaceName: signal<string | null>(null),
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
    ).querySelectorAll<HTMLElement>('[data-shell-surface]');
    expect(surfaces).toHaveLength(1);
    expect(surfaces[0].matches(selector)).toBe(true);
    return surfaces[0];
  }

  beforeEach(async () => {
    layoutStub.hasWorkspaceFolders.set(false);
    layoutStub.workspaceResolved.set(true);
    layoutStub.pendingWorkspaceName.set(null);
    layoutStub.workspaceSidebarVisible.set(false);
    layoutStub.editorPanelVisible.set(false);
    appStateStub.currentView.set('chat');
    appStateStub.openConfigurationSurface.set(null);
    appStateStub.configurationSurfaceRemountTick.set(0);
    await mount(DeferBlockBehavior.Playthrough);
  });

  async function mount(deferBlockBehavior: DeferBlockBehavior): Promise<void> {
    await TestBed.configureTestingModule({
      deferBlockBehavior,
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
  }

  afterEach(() => fixture.destroy());

  it('keeps one flex-1 surface box while the deferred welcome loads', async () => {
    // Playthrough resolves the JIT block at once; Manual holds the placeholder.
    fixture.destroy();
    TestBed.resetTestingModule();
    await mount(DeferBlockBehavior.Manual);

    const placeholder = expectOnlySurface(
      '[data-testid="electron-welcome-placeholder"]',
    );
    expect(placeholder.classList.contains('flex-1')).toBe(true);
    expect(placeholder.getAttribute('aria-hidden')).toBe('true');

    const blocks = await fixture.getDeferBlocks();
    expect(blocks).toHaveLength(1);
    await blocks[0].render(DeferBlockState.Complete);
    expectOnlySurface('ptah-electron-welcome');
  });

  it('offers an accessible Reload when the welcome chunk fails to load', async () => {
    fixture.destroy();
    TestBed.resetTestingModule();
    await mount(DeferBlockBehavior.Manual);

    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Error);
    const error = expectOnlySurface('[data-testid="electron-welcome-error"]');
    expect(error.getAttribute('role')).toBe('alert');
    expect(error.textContent).toContain('The welcome screen could not load.');

    const shell = fixture.componentInstance as unknown as {
      reloadWindow(): void;
    };
    const reload = jest.spyOn(shell, 'reloadWindow').mockImplementation(() => {
      // jsdom cannot reload; the call itself is the contract.
    });
    const button = error.querySelector<HTMLButtonElement>(
      '[data-testid="electron-welcome-reload"]',
    );
    expect(button?.getAttribute('type')).toBe('button');
    expect(button?.textContent?.trim()).toBe('Reload');
    button?.click();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('names only the welcome element before a workspace opens', async () => {
    await fixture.whenStable();
    fixture.detectChanges();
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

  it('shows only the L1 loading state until the workspace resolves', () => {
    layoutStub.workspaceResolved.set(false);
    layoutStub.pendingWorkspaceName.set('ptah-extension');
    fixture.detectChanges();
    expectOnlySurface('ptah-workspace-loading-state');
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        'ptah-electron-welcome',
      ),
    ).toBeNull();
  });

  it('puts the L1 loading state ahead of a cached workspace', () => {
    layoutStub.workspaceResolved.set(false);
    layoutStub.hasWorkspaceFolders.set(true);
    fixture.detectChanges();
    expectOnlySurface('ptah-workspace-loading-state');

    layoutStub.workspaceResolved.set(true);
    fixture.detectChanges();
    expectOnlySurface('[data-test="configuration-surface-host"]');
  });
});
