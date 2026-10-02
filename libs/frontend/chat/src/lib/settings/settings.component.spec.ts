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

import { DeferBlockBehavior, DeferBlockState, TestBed } from '@angular/core/testing';
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

/** The deferred CLI matrix: only the table the `cli-agents` deep link focuses (Batch 34). */
@Component({
  selector: 'ptah-cli-orchestration-matrix',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '<table data-testid="cli-matrix" tabindex="-1" aria-label="CLI matrix"><tbody><tr><td>Codex</td></tr></tbody></table>',
})
class CliMatrixStub {}

/** The slice of the shared Providers state the shell and the Orchestration container read. */
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

  it('routes cli-agents to Orchestration (the CLI matrix lives there)', async () => {
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
    // A cli-agents request raised while Settings is open (the routing map's CLI agents node, RM-3).
    appState.requestSettingsTab({ tab: 'providers', section: 'cli-agents' });
    TestBed.tick();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('orchestration');
    expect(fixture.componentInstance.orchestrationTarget()).toBe('cli-agents');
    expect(appState.pendingSettingsTab()).toBeNull();
  });

  // Batch 35: the Orchestration container raises `requestSettingsTab({tab:'providers', providerId})` for a background
  // role's "Set up"; Settings is already open, so the pending-tab effect lands on Providers with the wizard's provider.
  it('a background role asking for provider setup (raised while open) switches to Providers with that provider', async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.componentInstance.setActiveTab('orchestration');
    fixture.detectChanges();
    appState.requestSettingsTab({ tab: 'providers', providerId: 'moonshot' });
    TestBed.tick();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('claude-auth');
    expect(fixture.componentInstance.requestedProviderId()).toBe('moonshot');
    expect(appState.pendingSettingsTab()).toBeNull();
  });

  // Batch 35 revise R3: a deep-link target belongs to the visit it opened; leaving the tab clears it.
  it('clears a deep-link target when the tab changes, so a later visit does not re-apply it', async () => {
    const page = await landWith({ tab: 'providers', section: 'judge' });
    expect(page.orchestrationTarget()).toBe('judge');
    page.setActiveTab('orchestration');
    expect(page.orchestrationTarget()).toBe('judge');
    page.setActiveTab('pro-features');
    expect(page.orchestrationTarget()).toBeNull();
    page.setActiveTab('orchestration');
    expect(page.orchestrationTarget()).toBeNull();
    const providers = await landWith({ tab: 'orchestration', section: 'connections' });
    expect(providers.providersTarget()).toBe('connections');
    providers.setActiveTab('tools');
    expect(providers.providersTarget()).toBeNull();
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
  /** Lands on Settings with `request` and renders the real Orchestration container (children unresolved but the matrix stub). */
  async function land(request: PendingSettingsTab) {
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
      set: { imports: [CliMatrixStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    TestBed.inject(AppStateManager).requestSettingsTab(request);
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture.nativeElement as HTMLElement;
  }
  afterEach(() => TestBed.resetTestingModule());

  // Batch 33 (deviation 4): the roles sit in a <details> closed by default; a background-role deep link opens it.
  it.each([
    'background-models', 'memory-curator', 'archaeologist', 'synthesis', 'judge', 'replay', 'judging-enhancement',
  ] as const)('opens the background roles <details> for the %s deep link and focuses the section', async (section) => {
    const element = await land({ tab: 'providers', section });
    const details = element.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]');
    expect(details?.open).toBe(true);
    expect(document.activeElement).toBe(element.querySelector('[data-focus="background-models"]'));
  });

  // Batch 34 (plan Component 10, S6 row): cli-agents focuses the matrix table, not the retired CLI manager's heading.
  it('focuses the CLI matrix table for the cli-agents deep link', async () => {
    const element = await land({ tab: 'providers', section: 'cli-agents' });
    const table = element.querySelector('[data-testid="cli-matrix"]');
    expect(table).not.toBeNull();
    expect(document.activeElement).toBe(table);
    expect(element.querySelector('#providers-cli-heading')).toBeNull();
  });

  // Batch 35 revise R3: the sticky deep link. Leaving Orchestration and coming back must not re-open the roles.
  it('re-visiting Orchestration after a background-role deep link leaves the roles closed and unfocused', async () => {
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
    TestBed.overrideComponent(SettingsComponent, { set: { imports: [OrchestrationSettingsComponent], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    TestBed.overrideComponent(OrchestrationSettingsComponent, { set: { imports: [CliMatrixStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    TestBed.inject(AppStateManager).requestSettingsTab({ tab: 'providers', section: 'judge' });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]')?.open).toBe(true);
    fixture.componentInstance.setActiveTab('pro-features');
    fixture.detectChanges();
    (document.activeElement as HTMLElement | null)?.blur();
    fixture.componentInstance.setActiveTab('orchestration');
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(element.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]')?.open).toBe(false);
    expect(document.activeElement).not.toBe(element.querySelector('[data-focus="background-models"]'));
  });

  // Gate V 36 M-1: a consumed target is cleared, so the same role deep-linked again while on the tab applies again.
  it('clears the Orchestration target once the tab consumed it, so a repeated deep link to the same role applies again', async () => {
    @Component({ selector: 'ptah-orchestration-settings', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
    class OrchestrationStub {
      readonly focusTarget = input<string | null>(null);
      readonly focusTargetConsumed = output<void>();
    }
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateFake() },
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn().mockResolvedValue(undefined) } },
        { provide: ProvidersSettingsStateService, useValue: providersStateFake() },
      ],
    });
    TestBed.overrideComponent(SettingsComponent, { set: { imports: [OrchestrationStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] } });
    const appState = TestBed.inject(AppStateManager);
    appState.requestSettingsTab({ tab: 'providers', section: 'judge' });
    const fixture = TestBed.createComponent(SettingsComponent);
    await fixture.componentInstance.ngOnInit();
    fixture.detectChanges();
    const stub = () => fixture.debugElement.query((node) => node.componentInstance instanceof OrchestrationStub)
      .componentInstance as OrchestrationStub;
    expect(stub().focusTarget()).toBe('judge');
    stub().focusTargetConsumed.emit();
    fixture.detectChanges();
    expect(fixture.componentInstance.orchestrationTarget()).toBeNull();
    expect(stub().focusTarget()).toBeNull();
    appState.requestSettingsTab({ tab: 'providers', section: 'judge' });
    TestBed.tick();
    expect(fixture.componentInstance.activeSettingsTab()).toBe('orchestration');
    expect(stub().focusTarget()).toBe('judge');
  });

  it.each([{ tab: 'orchestration' }, { tab: 'providers', section: 'cli-agents' }] as const)(
    'leaves the background roles closed for %o', async (request) => {
      const element = await land(request);
      expect(element.querySelector<HTMLDetailsElement>('[data-testid="background-roles-details"]')?.open).toBe(false);
    },
  );

  it('renders the Orchestration container, not Providers, and opens the state', async () => {
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
 * The Advanced and Search & Voice tabs are `@defer (on immediate)` blocks so each loads as its own
 * chunk; the placeholder is `aria-busy` so the harness `waitForSettled` keeps waiting for it.
 */
describe('SettingsComponent deferred tabs', () => {
  @Component({ selector: 'ptah-advanced-settings', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
  class AdvancedStub {
    readonly modelChanged = output<void>();
  }

  @Component({ selector: 'ptah-search-voice-settings', standalone: true, changeDetection: ChangeDetectionStrategy.OnPush, template: '' })
  class SearchVoiceStub {}

  let providersState: ReturnType<typeof providersStateFake>;

  function create(behavior: DeferBlockBehavior) {
    providersState = providersStateFake();
    TestBed.configureTestingModule({
      providers: [
        ...provideSurfaceRouterTesting(),
        AppStateManager,
        { provide: AuthStateService, useValue: authStateFake() },
        { provide: VSCodeService, useValue: { isElectron: false } },
        { provide: ClaudeRpcService, useValue: { call: jest.fn().mockResolvedValue(undefined) } },
        { provide: ProvidersSettingsStateService, useValue: providersState },
      ],
      deferBlockBehavior: behavior,
    });
    TestBed.overrideComponent(SettingsComponent, {
      set: { imports: [AdvancedStub, SearchVoiceStub], schemas: [CUSTOM_ELEMENTS_SCHEMA] },
    });
    return TestBed.createComponent(SettingsComponent);
  }

  afterEach(() => TestBed.resetTestingModule());

  it('shows an aria-busy placeholder until the Advanced chunk renders, then wires modelChanged', async () => {
    const fixture = create(DeferBlockBehavior.Manual);
    fixture.componentInstance.setActiveTab('pro-features');
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector('ptah-advanced-settings')).toBeNull();
    expect(element.querySelector('[aria-busy="true"]')).not.toBeNull();

    const [block] = await fixture.getDeferBlocks();
    await block.render(DeferBlockState.Complete);
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
    const advanced = element.querySelector('ptah-advanced-settings');
    expect(advanced).not.toBeNull();

    // The (modelChanged) binding survives the deferral (#84).
    fixture.debugElement.query((node) => node.nativeElement === advanced).componentInstance.modelChanged.emit();
    expect(providersState.redetectClis).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['pro-features', 'ptah-advanced-settings'],
    ['tools', 'ptah-search-voice-settings'],
  ] as const)('loads the %s tab on its own when shown (Playthrough)', async (tab, selector) => {
    const fixture = create(DeferBlockBehavior.Playthrough);
    fixture.componentInstance.setActiveTab(tab);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element = fixture.nativeElement as HTMLElement;
    expect(element.querySelector(selector)).not.toBeNull();
    expect(element.querySelector('[aria-busy="true"]')).toBeNull();
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
