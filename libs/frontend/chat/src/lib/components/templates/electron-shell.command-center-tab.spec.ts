import {
  Component,
  ChangeDetectionStrategy,
  CUSTOM_ELEMENTS_SCHEMA,
  input,
  signal,
} from '@angular/core';

jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-test="markdown-stub">{{ data() }}</div>`,
  })
  class MarkdownStubComponent {
    public readonly data = input<string | null>('');
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
import { provideRouter, RouterOutlet } from '@angular/router';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
  ElectronLayoutService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { ClosedTabSessionEnderService } from '../../services/closed-tab-session-ender.service';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShellComponent Command Center tab', () => {
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

  function commandCenterTab(): HTMLButtonElement {
    const tab = (
      fixture.nativeElement as HTMLElement
    ).querySelector<HTMLButtonElement>('button[title="Command Center"]');
    if (!tab) throw new Error('Command Center tab was not rendered');
    return tab;
  }

  beforeEach(async () => {
    layoutStub.hasWorkspaceFolders.set(true);
    appStateStub.currentView.set('chat');
    appStateStub.openConfigurationSurface.set(null);
    appStateStub.configurationSurfaceRemountTick.set(0);
    appStateStub.setCurrentView.mockReset();
    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        { provide: ClosedTabSessionEnderService, useValue: {} },
        provideRouter([]),
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        { provide: SurfaceRouterService, useValue: surfaceRouterStub },
        {
          provide: VSCodeService,
          useValue: {
            isElectron: true,
            getPtahIconUri: () => 'icon.png',
            config: () => ({ platform: 'win32' }),
          },
        },
      ],
    })
      .overrideComponent(ElectronShellComponent, {
        set: { imports: [RouterOutlet], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
    appStateStub.setCurrentView.mockReset();
  });

  afterEach(() => fixture.destroy());

  it('renders a native, keyboard reachable tab', () => {
    const tab = commandCenterTab();
    expect(tab.tagName).toBe('BUTTON');
    expect(tab.getAttribute('role')).toBe('tab');
    expect(tab.tabIndex).toBeGreaterThanOrEqual(0);
    expect(tab.disabled).toBe(false);
    expect(tab.getAttribute('aria-label')).toBe('Command Center');
    expect(tab.querySelector('lucide-angular')).not.toBeNull();
    expect(tab.querySelector('.tab-label')?.textContent).toBe('Command Center');
  });

  it('keeps labels available to assistive tech when narrow styling hides them', () => {
    const tabs = Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>('.electron-tabs [role="tab"]'),
    );
    expect(tabs).toHaveLength(7);
    for (const tab of tabs) {
      expect(tab.getAttribute('aria-label')).toBe(tab.title);
      expect(tab.querySelector('.tab-label')).not.toBeNull();
    }
  });

  it('selects only the Command Center tab when its view is current', () => {
    expect(commandCenterTab().getAttribute('aria-selected')).toBe('false');
    appStateStub.currentView.set('command-center');
    fixture.detectChanges();
    const selected = Array.from(
      (
        fixture.nativeElement as HTMLElement
      ).querySelectorAll<HTMLButtonElement>(
        '[role="tab"][aria-selected="true"]',
      ),
    );
    expect(selected.map((tab) => tab.title)).toEqual(['Command Center']);
    appStateStub.currentView.set('apps');
    fixture.detectChanges();
    expect(commandCenterTab().getAttribute('aria-selected')).toBe('false');
  });

  it('requests the Command Center view on click', () => {
    commandCenterTab().click();
    expect(appStateStub.setCurrentView).toHaveBeenCalledTimes(1);
    expect(appStateStub.setCurrentView).toHaveBeenCalledWith('command-center');
  });
});
