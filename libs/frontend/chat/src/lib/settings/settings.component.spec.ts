import {
  Component,
  Input,
  NgModule,
  input,
  output,
  ChangeDetectionStrategy,
  signal,
  CUSTOM_ELEMENTS_SCHEMA,
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

import { TestBed } from '@angular/core/testing';
import {
  AppStateManager,
  AuthStateService,
  ClaudeRpcService,
  VSCodeService,
} from '@ptah-extension/core';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
import { SettingsComponent } from './settings.component';

describe('SettingsComponent deep-link', () => {
  let appState: AppStateManager;

  const authStateStub = {
    isLoading: signal(false),
    hasAnyCredential: signal(false),
    showProviderModels: signal(false),
    loadAuthStatus: jest.fn().mockResolvedValue(undefined),
  };

  const vscodeServiceStub = {
    isElectron: false,
  };

  const claudeRpcStub = {
    call: jest.fn().mockResolvedValue(undefined),
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        // The real `AppStateManager` reads the current surface from the Router
        // (TASK_2026_524), so it cannot be constructed without a route table.
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateStub },
        { provide: VSCodeService, useValue: vscodeServiceStub },
        { provide: ClaudeRpcService, useValue: claudeRpcStub },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, {
      set: { imports: [], template: '' },
    });
    appState = TestBed.inject(AppStateManager);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('openSettingsTab sets the pending target', () => {
    // Replaces `WebviewNavigationService.navigateToSettingsTab`, which did the
    // same two things: raise the pending tab, then go to the Settings surface.
    // Only the request half is asserted here — the surface half belongs to the
    // Router and is pinned in `libs/frontend/core`.
    appState.openSettingsTab('orchestration');

    expect(appState.pendingSettingsTab()).toEqual({
      tab: 'orchestration',
      providerId: undefined,
    });
  });

  it('ngOnInit consumes the pending tab and selects orchestration', async () => {
    appState.requestSettingsTab({ tab: 'orchestration' });

    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.activeSettingsTab()).toBe('orchestration');
    expect(appState.consumePendingSettingsTab()).toBeNull();
  });

  it('forwards provider configuration links to Providers CLI agents', async () => {
    appState.requestSettingsTab({ tab: 'orchestration', providerId: 'openrouter' });
    const fixture = TestBed.createComponent(SettingsComponent); await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('claude-auth');
    expect(fixture.componentInstance.providersTarget()).toBe('cli-agents');
    expect(fixture.componentInstance.requestedProviderId()).toBe('openrouter');
  });
  it('forwards a background field without changing it', async () => {
    appState.requestSettingsTab({ tab: 'providers', section: 'memory-curator' });
    const fixture = TestBed.createComponent(SettingsComponent); await fixture.componentInstance.ngOnInit();
    expect(fixture.componentInstance.providersTarget()).toBe('memory-curator');
  });
  it('R2.7: reacts to a pending tab raised while Settings is already open', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.setActiveTab('orchestration');
    fixture.detectChanges();
    // Agent Orchestration's "Manage provider, model and credentials in Providers".
    appState.requestSettingsTab({ tab: 'providers', section: 'cli-agents' });
    TestBed.tick();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('claude-auth');
    expect(fixture.componentInstance.providersTarget()).toBe('cli-agents');
    expect(appState.pendingSettingsTab()).toBeNull();
  });
  it('ngOnInit leaves the default tab when no pending target', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.activeSettingsTab()).toBe('claude-auth');
  });
});

/**
 * The security claim on the Authentication tab is two mutually exclusive
 * statements (TASK_2026_236). The built-in line asserts something auditable
 * about endpoints that ship in Ptah's source; a user-typed endpoint cannot
 * borrow that claim, so it gets its own line naming the host instead.
 *
 * Renders the real template with CUSTOM_ELEMENTS_SCHEMA so the child settings
 * components stay unresolved — the assertion is about copy, not about them.
 */
describe('SettingsComponent security copy', () => {
  const isCustomProviderSelected = signal(false);
  const selectedCustomHost = signal<string | null>(null);

  const authStateStub = {
    isLoading: signal(false),
    hasAnyCredential: signal(false),
    showProviderModels: signal(false),
    effectiveProviderId: signal('openrouter'),
    hasProviderCredential: signal(false),
    isCustomProviderSelected,
    selectedCustomHost,
    loadAuthStatus: jest.fn().mockResolvedValue(undefined),
  };

  function render() {
    TestBed.configureTestingModule({
      providers: [
        // See the note in the deep-link suite: the real `AppStateManager`
        // resolves the current surface through the Router.
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateStub },
        { provide: VSCodeService, useValue: { isElectron: false } },
        {
          provide: ClaudeRpcService,
          useValue: { call: jest.fn().mockResolvedValue(undefined) },
        },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    isCustomProviderSelected.set(false);
    selectedCustomHost.set(null);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  it('keeps the built-in claim verbatim for a shipped provider', () => {
    const fixture = render();
    const builtIn = fixture.nativeElement.querySelector(
      '[data-testid="builtin-provider-security-copy"]',
    );
    expect(builtIn).toBeTruthy();
    expect(builtIn.textContent.replace(/\s+/g, ' ')).toContain(
      'Your credentials go directly from this machine to the AI provider — no proxies, no Ptah servers involved.',
    );
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="custom-provider-security-copy"]',
      ),
    ).toBeNull();
  });

  it('swaps in a host-naming claim for a user-defined provider', () => {
    isCustomProviderSelected.set(true);
    selectedCustomHost.set('192.168.1.50:8000');
    const fixture = render();

    const custom = fixture.nativeElement.querySelector(
      '[data-testid="custom-provider-security-copy"]',
    );
    expect(custom).toBeTruthy();
    const text = custom.textContent.replace(/\s+/g, ' ');
    expect(text).toContain('192.168.1.50:8000');
    expect(text).toContain('Ptah does not operate, vet, or monitor it');
    expect(
      fixture.nativeElement.querySelector(
        '[data-testid="builtin-provider-security-copy"]',
      ),
    ).toBeNull();
  });
});

/**
 * PR 581: the deep-linked provider request is one-shot. The Providers page is
 * destroyed when another tab is shown, so a request that stayed set would
 * reopen the wizard every time the user came back to Providers.
 */
describe('SettingsComponent deep-linked provider request', () => {
  const opened: string[] = [];

  /** Stands in for ProvidersSettingsComponent's deep-link contract (spec'd in its own suite). */
  @Component({
    selector: 'ptah-providers-settings',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: '',
  })
  class ProvidersPageStub {
    readonly focusTarget = input<unknown>(null);
    readonly requestedProviderId = input<string>('');
    readonly requestedProviderConsumed = output<string>();
    constructor() {
      queueMicrotask(() => {
        const id = this.requestedProviderId();
        if (id) {
          opened.push(id);
          this.requestedProviderConsumed.emit(id);
        }
      });
    }
  }

  const authStateStub = {
    isLoading: signal(false),
    hasAnyCredential: signal(false),
    showProviderModels: signal(false),
    effectiveProviderId: signal('openrouter'),
    hasProviderCredential: signal(false),
    isCustomProviderSelected: signal(false),
    selectedCustomHost: signal<string | null>(null),
    loadAuthStatus: jest.fn().mockResolvedValue(undefined),
  };

  afterEach(() => {
    TestBed.resetTestingModule();
    opened.length = 0;
  });

  it('opens the wizard once and does not reopen it after leaving and returning to Providers', async () => {
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateStub },
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn().mockResolvedValue(undefined) } },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, {
      set: { imports: [ProvidersPageStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    const appState = TestBed.inject(AppStateManager);
    appState.requestSettingsTab({ tab: 'orchestration', providerId: 'openrouter' });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(opened).toEqual(['openrouter']);
    expect(fixture.componentInstance.requestedProviderId()).toBeUndefined();

    fixture.componentInstance.setActiveTab('orchestration');
    fixture.detectChanges();
    fixture.componentInstance.setActiveTab('providers');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(opened).toEqual(['openrouter']);
  });
});
