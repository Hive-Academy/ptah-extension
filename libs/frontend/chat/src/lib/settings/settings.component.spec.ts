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
  ProvidersSettingsStateService,
  VSCodeService,
  type PendingSettingsTab,
  type ProvidersSettingsCommit,
  type ProvidersSettingsSection,
} from '@ptah-extension/core';
import type { ConfigGetScopesResult } from '@ptah-extension/shared';
import { provideSurfaceRouterTesting } from '@ptah-extension/core/testing';
import { SettingsComponent } from './settings.component';
import { OrchestrationSettingsComponent } from './ptah-ai/orchestration-settings.component';

/** The slice of the shared Providers state the shell and the interim Orchestration container read. */
function providersStateFake() {
  const unloaded = { status: 'unloaded' as const, data: null, error: null };
  return {
    scopes: signal<ProvidersSettingsSection<ConfigGetScopesResult>>(unloaded),
    commit: signal<ProvidersSettingsCommit>({
      status: 'idle', saved: [], unsaved: [], unconfirmed: [], refreshFailed: false, message: null,
    }),
    cliAgents: signal(unloaded),
    cliModels: signal(unloaded),
    orchestration: signal(unloaded),
    open: jest.fn(async () => undefined),
    redetectClis: jest.fn(async () => undefined),
  };
}

function authStateFake() {
  return {
    isLoading: signal(false),
    hasAnyCredential: signal(false),
    showProviderModels: signal(false),
    effectiveProviderId: signal('openrouter'),
    hasProviderCredential: signal(false),
    isCustomProviderSelected: signal(false),
    selectedCustomHost: signal<string | null>(null),
    loadAuthStatus: jest.fn().mockResolvedValue(undefined),
  };
}

describe('SettingsComponent deep-link', () => {
  let appState: AppStateManager;
  let providersStateStub: ReturnType<typeof providersStateFake>;

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
    providersStateStub = providersStateFake();
    TestBed.configureTestingModule({
      providers: [
        // The real `AppStateManager` reads the current surface from the Router
        // (TASK_2026_524), so it cannot be constructed without a route table.
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateStub },
        { provide: VSCodeService, useValue: vscodeServiceStub },
        { provide: ClaudeRpcService, useValue: claudeRpcStub },
        { provide: ProvidersSettingsStateService, useValue: providersStateStub },
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

  async function landWith(request: PendingSettingsTab) {
    appState.requestSettingsTab(request);
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    return fixture.componentInstance;
  }

  // Routing table, implementation-plan.md Component 10 (S5 rows).
  it('routes a providerId from any tab to Providers for the setup wizard, with no section focus', async () => {
    const page = await landWith({ tab: 'orchestration', providerId: 'openrouter' });
    expect(page.activeSettingsTab()).toBe('claude-auth');
    expect(page.requestedProviderId()).toBe('openrouter');
    expect(page.providersTarget()).toBeNull();
    expect(page.orchestrationTarget()).toBeNull();
  });

  it.each(['main-agent', 'main-model', 'main-effort', 'connections', 'more-providers'] as const)(
    'routes the %s section to Providers and focuses it there',
    async (section) => {
      const page = await landWith({ tab: 'orchestration', section });
      expect(page.activeSettingsTab()).toBe('claude-auth');
      expect(page.providersTarget()).toBe(section);
      expect(page.orchestrationTarget()).toBeNull();
    },
  );

  it.each([
    'background-models', 'memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement',
  ] as const)('routes the %s background-role section to Orchestration', async (section) => {
    const page = await landWith({ tab: 'providers', section });
    expect(page.activeSettingsTab()).toBe('orchestration');
    expect(page.orchestrationTarget()).toBe(section);
    expect(page.providersTarget()).toBeNull();
  });

  it('routes cli-agents to Orchestration (the interim #providers-cli-heading lives there)', async () => {
    const page = await landWith({ tab: 'providers', section: 'cli-agents' });
    expect(page.activeSettingsTab()).toBe('orchestration');
    expect(page.orchestrationTarget()).toBe('cli-agents');
  });

  it('opens the requested tab with no focus when there is no section', async () => {
    const page = await landWith({ tab: 'pro-features' });
    expect(page.activeSettingsTab()).toBe('pro-features');
    expect(page.providersTarget()).toBeNull();
    expect(page.orchestrationTarget()).toBeNull();
  });

  it('falls back to the requested tab for an unknown section', async () => {
    const page = await landWith({ tab: 'tools', section: 'not-a-section' as PendingSettingsTab['section'] });
    expect(page.activeSettingsTab()).toBe('tools');
    expect(page.providersTarget()).toBeNull();
    expect(page.orchestrationTarget()).toBeNull();
  });

  it('R2.7: reacts to a pending tab raised while Settings is already open', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.setActiveTab('pro-features');
    fixture.detectChanges();
    // Agent Orchestration's "Manage provider, model and credentials in Providers".
    appState.requestSettingsTab({ tab: 'providers', section: 'cli-agents' });
    TestBed.tick();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('orchestration');
    expect(fixture.componentInstance.orchestrationTarget()).toBe('cli-agents');
    expect(appState.pendingSettingsTab()).toBeNull();
  });

  it('a background role asking for provider setup switches to Providers with that provider', async () => {
    const page = await landWith({ tab: 'providers', section: 'judge' });
    page.openProviderSetup('moonshot');
    expect(page.activeSettingsTab()).toBe('claude-auth');
    expect(page.requestedProviderId()).toBe('moonshot');
  });

  it('#84: a VS Code LM model change re-detects CLIs through the shared state', async () => {
    const page = await landWith({ tab: 'pro-features' });
    page.onModelChanged();
    expect(providersStateStub.redetectClis).toHaveBeenCalledTimes(1);
  });

  it('ngOnInit leaves the default tab when no pending target', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();

    expect(fixture.componentInstance.activeSettingsTab()).toBe('claude-auth');
  });
});

/**
 * Plan :571-574: the harness cannot raise a pending-tab request, so this is the proof that a
 * direct Orchestration landing opens the shared state without mounting the Providers page.
 */
describe('SettingsComponent Orchestration landing', () => {
  it('renders the interim Orchestration container, not Providers, and opens the state', async () => {
    const state = providersStateFake();
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateFake() },
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn().mockResolvedValue(undefined) } },
        { provide: ProvidersSettingsStateService, useValue: state },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, {
      set: { imports: [OrchestrationSettingsComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    TestBed.overrideComponent(OrchestrationSettingsComponent, {
      set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    TestBed.inject(AppStateManager).requestSettingsTab({ tab: 'orchestration' });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();

    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ptah-orchestration-settings')).not.toBeNull();
    expect(element.querySelector('ptah-providers-settings')).toBeNull();
    expect(state.open).toHaveBeenCalledTimes(1);
    TestBed.resetTestingModule();
  });
});

describe('SettingsComponent header', () => {
  function render(isElectron: boolean, activePath: string | null) {
    const state = providersStateFake();
    state.scopes.set({ status: 'ready', data: { activePath, entries: [] }, error: null });
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateFake() },
        { provide: VSCodeService, useValue: { isElectron } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn().mockResolvedValue(undefined) } },
        { provide: ProvidersSettingsStateService, useValue: state },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, { set: { imports: [], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  it('shows the workspace name (full path in title) and the Desktop app label', () => {
    const element = render(true, 'C:\\work\\ptah-extension');
    const context = element.querySelector('[data-testid="settings-context"]');
    expect(context?.textContent?.replace(/\s+/g, ' ').trim()).toBe('Workspace: ptah-extension · App: Desktop');
    expect(context?.querySelector('[title]')?.getAttribute('title')).toBe('C:\\work\\ptah-extension');
  });

  it('shows only the VS Code app label when no folder is open', () => {
    const element = render(false, null);
    expect(element.querySelector('[data-testid="settings-context"]')?.textContent?.replace(/\s+/g, ' ').trim()).toBe('App: VS Code');
  });

  it('keeps Back and four enabled tab buttons with their names (D9)', () => {
    const element = render(false, null);
    expect(element.querySelector('[data-testid="settings-back"]')?.getAttribute('aria-label')).toBe('Back to Chat');
    const tabs = Array.from(element.querySelectorAll<HTMLButtonElement>('nav[aria-label="Settings sections"] button'));
    expect(tabs.map((tab) => tab.textContent?.trim())).toEqual(['Providers', 'Agent Orchestration', 'Advanced', 'Search & Voice']);
    expect(tabs.every((tab) => !tab.disabled)).toBe(true);
    expect(tabs[0].classList.contains('tab-active')).toBe(true);
    expect(tabs[0].getAttribute('aria-current')).toBe('page');
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
        { provide: ProvidersSettingsStateService, useValue: providersStateFake() },
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
    // D10 (Batch 28): one text-[11px] line, truncated rather than wrapped.
    expect(builtIn.className).toContain('text-[11px]');
    expect(builtIn.querySelector('p')?.className).toContain('truncate');
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
        { provide: ProvidersSettingsStateService, useValue: providersStateFake() },
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
