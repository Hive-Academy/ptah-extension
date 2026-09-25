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
import { provideRouter, RouterOutlet } from '@angular/router';
import { AppWindow } from 'lucide-angular';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
  ElectronLayoutService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShellComponent Apps tab', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;
  const layoutStub = {
    hasWorkspaceFolders: signal(true),
    workspaceSidebarVisible: signal(false),
    workspaceSidebarWidth: signal(240),
    editorPanelVisible: signal(false),
    editorPanelWidth: signal(320),
  };
  const appStateStub = {
    currentView: signal('chat'),
    openConfigurationSurface: signal<ConfigurationSurfaceId | null>(null),
    configurationSurfaceRemountTick: signal(0),
    thothFirstRunDismissed: signal(true),
    setLayoutMode: jest.fn(),
    setCurrentView: jest.fn(),
    dismissThothFirstRun: jest.fn(),
  };
  const surfaceRouterStub = {
    remountActiveSurface: jest.fn(),
    pendingSurface: jest.fn(() => null),
  };

  function shell(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function tabs(): HTMLButtonElement[] {
    return Array.from(
      shell().querySelectorAll<HTMLButtonElement>(
        '[role="tablist"].electron-tabs button[role="tab"]',
      ),
    );
  }

  function appsTab(): HTMLButtonElement | undefined {
    return tabs().find((tab) => tab.title === 'Apps');
  }

  beforeEach(async () => {
    layoutStub.hasWorkspaceFolders.set(true);
    appStateStub.currentView.set('chat');
    appStateStub.openConfigurationSurface.set(null);
    appStateStub.configurationSurfaceRemountTick.set(0);
    appStateStub.setLayoutMode.mockReset();
    appStateStub.setCurrentView.mockReset();
    surfaceRouterStub.remountActiveSurface.mockReset();
    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        provideRouter([]),
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        { provide: SurfaceRouterService, useValue: surfaceRouterStub },
        {
          provide: VSCodeService,
          // The shell renders only on the Electron host (batches.md B16 note).
          useValue: {
            isElectron: true,
            getPtahIconUri: () => 'icon.png',
            config: () => ({ platform: 'win32' }),
          },
        },
      ],
    })
      .overrideComponent(ElectronShellComponent, {
        set: {
          imports: [RouterOutlet],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
    // The constructor forces grid mode; only clicks are under test below.
    appStateStub.setLayoutMode.mockReset();
    appStateStub.setCurrentView.mockReset();
  });

  afterEach(() => fixture.destroy());

  it('orders the tab row Chat, Apps, Tasks, Tribunal, Analytics when folders exist', () => {
    const order = ['Chat', 'Apps', 'Tasks', 'Tribunal', 'Analytics'];
    expect(tabs().map((tab) => tab.title)).toEqual(order);
    expect(tabs().map((tab) => tab.textContent?.trim())).toEqual(order);
    expect(shell().querySelectorAll('[role="tab"]')).toHaveLength(5);
  });

  it('renders the Apps tab with the sibling tab pattern and the AppWindow icon', () => {
    const apps = appsTab()!;
    const tasks = tabs().find((tab) => tab.title === 'Tasks')!;
    expect(apps.getAttribute('role')).toBe('tab');
    expect(apps.className).toBe(tasks.className);
    expect(Array.from(apps.classList)).toEqual(['tab', 'gap-1.5', 'no-drag']);
    expect(apps.className).not.toMatch(/text-base-content\//);
    const icon = apps.querySelector('lucide-angular') as
      | (HTMLElement & { img?: unknown })
      | null;
    expect(icon).not.toBeNull();
    expect(icon!.img).toBe(AppWindow);
    expect(icon!.getAttribute('class')).toBe('w-3.5 h-3.5');
  });

  it('does not render the Apps tab without workspace folders', () => {
    layoutStub.hasWorkspaceFolders.set(false);
    fixture.detectChanges();
    expect(shell().querySelector('[role="tablist"]')).toBeNull();
    expect(shell().querySelector('button[title="Apps"]')).toBeNull();

    layoutStub.hasWorkspaceFolders.set(true);
    fixture.detectChanges();
    expect(appsTab()).toBeDefined();
  });

  it('requests the apps view exactly once on click', () => {
    appsTab()!.click();
    expect(appStateStub.setCurrentView).toHaveBeenCalledTimes(1);
    expect(appStateStub.setCurrentView).toHaveBeenCalledWith('apps');
    expect(appStateStub.setLayoutMode).not.toHaveBeenCalled();
  });

  it('binds aria-selected and tab-active to currentView() === "apps"', () => {
    expect(appsTab()!.getAttribute('aria-selected')).toBe('false');
    expect(appsTab()!.classList.contains('tab-active')).toBe(false);

    appStateStub.currentView.set('apps');
    fixture.detectChanges();
    expect(tabs().map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'false',
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(
      tabs()
        .filter((tab) => tab.classList.contains('tab-active'))
        .map((tab) => tab.title),
    ).toEqual(['Apps']);

    appStateStub.currentView.set('tasks');
    fixture.detectChanges();
    expect(appsTab()!.getAttribute('aria-selected')).toBe('false');
    expect(appsTab()!.classList.contains('tab-active')).toBe(false);
  });
});
