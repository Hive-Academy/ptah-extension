import {
  ChangeDetectionStrategy,
  Component,
  CUSTOM_ELEMENTS_SCHEMA,
  Input,
  NgModule,
  signal,
} from '@angular/core';

// Stub ngx-markdown (ESM-only bundle) BEFORE any component import, as the
// sibling electron-shell specs do.
jest.mock('ngx-markdown', () => {
  @Component({
    // eslint-disable-next-line @angular-eslint/component-selector
    selector: 'markdown',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div>{{ data }}</div>`,
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

/**
 * The dock body is git-ui's `ReviewShellComponent`, loaded by dynamic import
 * when the dock opens (TASK_2026_576 Batch 58). git-ui is mocked at the module
 * boundary; reading `ReviewShellComponent` throws while `mockChunkFails` is
 * set, which reaches the same `.catch` a failed chunk load does.
 */
let mockChunkFails = false;
jest.mock('@ptah-extension/git-ui', () => {
  @Component({
    selector: 'ptah-review-shell',
    standalone: true,
    changeDetection: ChangeDetectionStrategy.OnPush,
    template: `<div data-testid="review-shell-stub"></div>`,
  })
  class ReviewShellStubComponent {}

  return {
    get ReviewShellComponent() {
      if (mockChunkFails) throw new Error('chunk load failed');
      return ReviewShellStubComponent;
    },
  };
});

import { NgComponentOutlet } from '@angular/common';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, RouterOutlet } from '@angular/router';
import {
  AppStateManager,
  type ConfigurationSurfaceId,
  ElectronLayoutService,
  SurfaceRouterService,
  VSCodeService,
} from '@ptah-extension/core';
import { ElectronShellComponent } from './electron-shell.component';

describe('ElectronShellComponent review dock', () => {
  let fixture: ComponentFixture<ElectronShellComponent>;
  let error: jest.SpyInstance;
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
    setLayoutMode: jest.fn(),
    setCurrentView: jest.fn(),
  };

  function query(selector: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(selector);
  }

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    // The dynamic import resolves on a later microtask than the effect.
    await new Promise((resolve) => setTimeout(resolve, 0));
    fixture.detectChanges();
  }

  function retryButton(): HTMLButtonElement | undefined {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
    ).find((button) => button.textContent?.trim() === 'Retry');
  }

  beforeEach(async () => {
    mockChunkFails = false;
    layoutStub.editorPanelVisible.set(false);
    error = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    await TestBed.configureTestingModule({
      imports: [ElectronShellComponent],
      providers: [
        provideRouter([]),
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
            isElectron: true,
            getPtahIconUri: () => 'icon.png',
            config: () => ({ platform: 'win32' }),
          },
        },
      ],
    })
      .overrideComponent(ElectronShellComponent, {
        set: {
          imports: [RouterOutlet, NgComponentOutlet],
          schemas: [CUSTOM_ELEMENTS_SCHEMA],
        },
      })
      .compileComponents();
    fixture = TestBed.createComponent(ElectronShellComponent);
    await settle();
  });

  afterEach(() => {
    fixture.destroy();
    error.mockRestore();
  });

  it('loads nothing until the dock opens, then mounts ReviewShellComponent', async () => {
    expect(query('[data-testid="review-shell-stub"]')).toBeNull();

    layoutStub.editorPanelVisible.set(true);
    await settle();

    expect(query('[data-testid="review-shell-stub"]')).not.toBeNull();
    expect(retryButton()).toBeUndefined();
  });

  it('shows Retry when the chunk fails, and Retry loads the shell', async () => {
    mockChunkFails = true;
    layoutStub.editorPanelVisible.set(true);
    await settle();

    expect(query('[data-testid="review-shell-stub"]')).toBeNull();
    expect(
      (fixture.nativeElement as HTMLElement).textContent,
    ).toContain('Failed to load the git panel.');
    expect(error).toHaveBeenCalledWith(
      expect.stringContaining('[ElectronShellComponent]'),
      'chunk load failed',
    );

    mockChunkFails = false;
    retryButton()?.click();
    await settle();

    expect(query('[data-testid="review-shell-stub"]')).not.toBeNull();
    expect(retryButton()).toBeUndefined();
  });
});
