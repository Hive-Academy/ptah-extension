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
import { By } from '@angular/platform-browser';
import { provideRouter, Router, RouterOutlet } from '@angular/router';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
  ElectronLayoutService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { GlobalConfigMenuComponent } from '../molecules/global-config-menu.component';
import { ElectronShellComponent } from './electron-shell.component';

@Component({
  selector: 'ptah-configuration-route-test',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<div data-test="configuration-route-marker">Settings route</div>',
})
class ConfigurationRouteTestComponent {}

describe('ElectronShellComponent configuration gate', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;
  const layoutStub = {
    hasWorkspaceFolders: signal(false),
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
  const pendingSurface = signal<'tasks' | null>(null);
  const surfaceRouterStub = {
    remountActiveSurface: jest.fn(),
    pendingSurface: jest.fn(() => pendingSurface()),
  };

  function shell(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function backButton(): HTMLButtonElement | null {
    return shell().querySelector('[data-test="config-back-to-welcome"]');
  }

  function configurationHost(): HTMLElement {
    return shell().querySelector<HTMLElement>(
      '[data-test="configuration-surface-host"]',
    )!;
  }

  function showSettings(hasWorkspace = false): void {
    layoutStub.hasWorkspaceFolders.set(hasWorkspace);
    appStateStub.openConfigurationSurface.set('settings');
    appStateStub.currentView.set('settings');
    fixture.detectChanges();
  }

  function bumpTick(): void {
    appStateStub.configurationSurfaceRemountTick.update((tick) => tick + 1);
    fixture.detectChanges();
  }

  function expectBareOutlet(): void {
    expect(shell().querySelectorAll('router-outlet')).toHaveLength(1);
    expect(
      fixture.debugElement.queryAll(By.directive(RouterOutlet)),
    ).toHaveLength(1);
    expect(shell().querySelector('ptah-app-shell')).toBeNull();
    expect(shell().querySelector('ptah-electron-welcome')).toBeNull();
  }

  beforeEach(async () => {
    layoutStub.hasWorkspaceFolders.set(false);
    appStateStub.currentView.set('chat');
    appStateStub.openConfigurationSurface.set(null);
    appStateStub.configurationSurfaceRemountTick.set(0);
    appStateStub.setLayoutMode.mockReset();
    appStateStub.setCurrentView.mockReset();
    pendingSurface.set(null);
    surfaceRouterStub.remountActiveSurface.mockReset();
    surfaceRouterStub.pendingSurface.mockClear();
    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        provideRouter([
          { path: 'settings', component: ConfigurationRouteTestComponent },
        ]),
        { provide: ElectronLayoutService, useValue: layoutStub },
        { provide: AppStateManager, useValue: appStateStub },
        { provide: SurfaceRouterService, useValue: surfaceRouterStub },
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
        set: {
          imports: [RouterOutlet, GlobalConfigMenuComponent],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('shows only welcome content without a workspace or configuration surface', () => {
    expect(shell().querySelector('ptah-electron-welcome')).not.toBeNull();
    expect(shell().querySelector('router-outlet')).toBeNull();
    expect(shell().querySelector('ptah-app-shell')).toBeNull();
    expect(backButton()).toBeNull();
  });

  it('shows one real bare outlet and a back button for pre-workspace settings', () => {
    showSettings();
    expectBareOutlet();
    expect(backButton()?.type).toBe('button');
    expect(backButton()?.getAttribute('aria-label')).toBe('Back to welcome');
  });

  it('activates the settings route in the bare outlet without a workspace', async () => {
    showSettings();
    const router = TestBed.inject(Router);
    expect(await router.navigateByUrl('/settings')).toBe(true);
    fixture.detectChanges();
    await fixture.whenStable();
    expectBareOutlet();
    const outlet = fixture.debugElement
      .query(By.directive(RouterOutlet))
      .injector.get(RouterOutlet);
    expect(outlet.isActivated).toBe(true);
    expect(outlet.component).toBeInstanceOf(ConfigurationRouteTestComponent);
    expect(
      shell()
        .querySelector('router-outlet')
        ?.parentElement?.querySelector(
          '[data-test="configuration-route-marker"]',
        )?.textContent,
    ).toBe('Settings route');
  });

  it('shows the workspace app shell and Chat, Tasks, Tribunal, Analytics tabs in order', () => {
    layoutStub.hasWorkspaceFolders.set(true);
    fixture.detectChanges();
    expect(shell().querySelector('ptah-app-shell')).not.toBeNull();
    expect(backButton()).toBeNull();
    const tabs = Array.from(
      shell().querySelectorAll<HTMLButtonElement>(
        '[role="tablist"].electron-tabs button[role="tab"]',
      ),
    );
    expect(tabs.map((tab) => tab.title)).toEqual([
      'Chat',
      'Tasks',
      'Tribunal',
      'Analytics',
    ]);
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual([
      'Chat',
      'Tasks',
      'Tribunal',
      'Analytics',
    ]);
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual([
      'true',
      'false',
      'false',
      'false',
    ]);
    expect(shell().querySelectorAll('[role="tab"]')).toHaveLength(4);
  });

  it('keeps the configuration menu and back button in global no-drag actions without a workspace', () => {
    const trigger = shell().querySelector<HTMLElement>(
      '[data-test="config-menu-trigger"]',
    )!;
    expect(trigger).not.toBeNull();
    expect(trigger.closest('.no-drag')).not.toBeNull();
    expect(shell().querySelector('[role="tablist"]')).toBeNull();
    showSettings();
    const actions = trigger.closest('.no-drag');
    expect(actions?.contains(backButton())).toBe(true);
    expect(backButton()?.closest('.no-drag')).toBe(actions);
    // Resolve the host from the public trigger hook, never a menu tag selector.
    const menuHost = Array.from(actions?.children ?? []).find((child) =>
      child.contains(trigger),
    );
    expect(menuHost?.tagName.toLowerCase()).toBe('ptah-global-config-menu');
    expect(menuHost?.nextElementSibling?.tagName.toLowerCase()).toBe(
      'ptah-theme-toggle',
    );
  });

  it('returns to welcome after Back to welcome requests chat and configuration settles to null', () => {
    showSettings();
    backButton()!.click();
    expect(appStateStub.setCurrentView).toHaveBeenCalledTimes(1);
    expect(appStateStub.setCurrentView).toHaveBeenCalledWith('chat');
    appStateStub.openConfigurationSurface.set(null);
    fixture.detectChanges();
    expect(shell().querySelector('ptah-electron-welcome')).not.toBeNull();
    expect(shell().querySelector('router-outlet')).toBeNull();
    expect(backButton()).toBeNull();
  });

  it('opens the first workspace with a tick bump without retaining the bare outlet or throwing', () => {
    showSettings();
    expectBareOutlet();
    layoutStub.hasWorkspaceFolders.set(true);
    expect(() => bumpTick()).not.toThrow();
    expect(shell().querySelector('ptah-app-shell')).not.toBeNull();
    expect(shell().querySelector('router-outlet')).toBeNull();
    expect(backButton()).toBeNull();
    expect(appStateStub.openConfigurationSurface()).toBe('settings');
  });

  it('focuses the rendered configuration host when the first workspace opens from body focus', async () => {
    showSettings();
    expect(configurationHost()).toBeNull();
    (document.activeElement as HTMLElement)?.blur();
    expect(document.activeElement).toBe(document.body);
    layoutStub.hasWorkspaceFolders.set(true);
    bumpTick();
    await fixture.whenStable();
    expect(configurationHost()).not.toBeNull();
    expect(document.activeElement).toBe(configurationHost());
    expect(surfaceRouterStub.remountActiveSurface).toHaveBeenCalledTimes(1);
  });

  it('restores the bare outlet and back button when the last workspace closes on settings', () => {
    showSettings(true);
    layoutStub.hasWorkspaceFolders.set(false);
    fixture.detectChanges();
    expectBareOutlet();
    expect(backButton()).not.toBeNull();
  });

  it('shows welcome when Setup hub settles on a non-configuration surface without a workspace', () => {
    appStateStub.openConfigurationSurface.set('setup-hub');
    fixture.detectChanges();
    expectBareOutlet();
    appStateStub.currentView.set('tasks');
    appStateStub.openConfigurationSurface.set(null);
    fixture.detectChanges();
    expect(shell().querySelector('ptah-electron-welcome')).not.toBeNull();
    expect(shell().querySelector('router-outlet')).toBeNull();
    expect(backButton()).toBeNull();
  });

  it('ignores tick zero and remounts exactly once for a tick bump without replacing the app shell', () => {
    showSettings(true);
    const appShell = shell().querySelector('ptah-app-shell');
    expect(surfaceRouterStub.remountActiveSurface).not.toHaveBeenCalled();
    appStateStub.configurationSurfaceRemountTick.set(1);
    expect(surfaceRouterStub.remountActiveSurface).not.toHaveBeenCalled();
    fixture.detectChanges();
    fixture.detectChanges();
    expect(surfaceRouterStub.remountActiveSurface).toHaveBeenCalledTimes(1);
    expect(shell().querySelector('ptah-app-shell')).toBe(appShell);
  });

  it('does not remount at construction with tick three and remounts once when it changes to four', () => {
    fixture.destroy();
    appStateStub.configurationSurfaceRemountTick.set(3);
    appStateStub.openConfigurationSurface.set('settings');
    layoutStub.hasWorkspaceFolders.set(true);
    fixture = TestBed.createComponent(ElectronShellComponent);
    fixture.detectChanges();
    expect(surfaceRouterStub.remountActiveSurface).not.toHaveBeenCalled();
    appStateStub.configurationSurfaceRemountTick.set(4);
    fixture.detectChanges();
    fixture.detectChanges();
    expect(surfaceRouterStub.remountActiveSurface).toHaveBeenCalledTimes(1);
  });

  it('focuses the configuration host after remount when focus was on the body', async () => {
    showSettings(true);
    (document.activeElement as HTMLElement)?.blur();
    expect(document.activeElement).toBe(document.body);
    const host = configurationHost();
    expect(host.getAttribute('tabindex')).toBe('-1');
    expect(host.classList.contains('outline-none')).toBe(true);
    bumpTick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(host);
  });

  it('preserves focus on a live navbar button after remount', async () => {
    showSettings(true);
    const button = shell().querySelector<HTMLButtonElement>('[role="tab"]')!;
    button.focus();
    expect(document.activeElement).toBe(button);
    bumpTick();
    await fixture.whenStable();
    expect(document.activeElement).toBe(button);
  });

  it('skips a pending navigation tick without deferral and remounts once on the next settled tick', () => {
    showSettings(true);
    pendingSurface.set('tasks');
    bumpTick();
    expect(surfaceRouterStub.pendingSurface).toHaveBeenCalled();
    expect(surfaceRouterStub.remountActiveSurface).not.toHaveBeenCalled();
    pendingSurface.set(null);
    fixture.detectChanges();
    expect(surfaceRouterStub.remountActiveSurface).not.toHaveBeenCalled();
    bumpTick();
    expect(surfaceRouterStub.remountActiveSurface).toHaveBeenCalledTimes(1);
  });
});
