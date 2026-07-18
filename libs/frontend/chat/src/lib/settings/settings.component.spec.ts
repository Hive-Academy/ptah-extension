import {
  Component,
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
