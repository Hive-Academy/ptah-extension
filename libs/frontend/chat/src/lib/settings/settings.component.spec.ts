import {
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  NgModule,
  ChangeDetectionStrategy,
  signal,
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
  WebviewNavigationService,
} from '@ptah-extension/core';
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
        AppStateManager,
        WebviewNavigationService,
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

  it('navigateToSettingsTab sets the pending target', async () => {
    const nav = TestBed.inject(WebviewNavigationService);
    await nav.navigateToSettingsTab('orchestration');
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
        AppStateManager,
        WebviewNavigationService,
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
