jest.mock('ngx-markdown');
jest.mock('@ptah-extension/markdown', () => ({
  MarkdownBlockComponent: jest.requireActual(
    '../../../../markdown/src/lib/markdown-block.component',
  ).MarkdownBlockComponent,
}));

import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import { DiffTabsService } from '../services/diff-tabs.service';
import { EditorLauncherService } from '../services/editor-launcher.service';

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});
const { GitDockComponent } = jest.requireActual(
  './git-dock.component',
) as typeof import('./git-dock.component');

function vscodeStub() {
  const config = signal({
    isVSCode: false,
    theme: 'dark',
    workspaceRoot: '/ws/a',
    workspaceName: 'a',
    extensionUri: '',
    baseUri: '',
    iconUri: '',
    userIconUri: '',
    panelId: '',
    isElectron: true,
  });
  return {
    config: config.asReadonly(),
    isConnected: signal(false).asReadonly(),
    getState: jest.fn().mockReturnValue(null),
    setState: jest.fn(),
    postMessage: jest.fn(),
    messages$: { pipe: jest.fn() },
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

describe('GitDockComponent mounted controls', () => {
  let rpcData: Record<string, unknown>;
  let vscode: ReturnType<typeof vscodeStub>;

  beforeEach(() => {
    mockRpcCall.mockReset();
    vscode = vscodeStub();
    rpcData = {
      'git:info': {
        isGitRepo: true,
        branch: {
          branch: 'main',
          upstream: 'origin/main',
          ahead: 0,
          behind: 0,
        },
        files: [
          {
            path: 'a.ts',
            status: 'M',
            staged: false,
            additions: 2,
            deletions: 1,
          },
        ],
      },
      'editor:detectTargets': {
        targets: [{ id: 'kiro', displayName: 'Kiro', executablePath: 'kiro' }],
      },
      'settings:get': { success: true },
      'settings:set': { success: true },
      'editor:openFile': { success: true },
      'git:branches': {
        current: 'main',
        local: [{ name: 'main', isCurrent: true }],
        remote: [],
      },
      'git:stashList': { success: true, entries: [], count: 0 },
      'git:lastCommit': { success: false },
      'git:diffFile': {
        path: 'alpha.ts',
        originalPath: 'alpha.ts',
        comparison: 'worktree',
        original: { outcome: 'content', content: 'old' },
        modified: { outcome: 'content', content: 'new' },
        originalRef: { kind: 'index' },
        modifiedRef: { kind: 'worktree' },
        snapshotToken: 'mount-token',
        patch: null,
        hunks: [],
      },
      'git:reviewChanges': {
        success: true,
        base: { name: 'main', sha: 'a'.repeat(40) },
        head: { name: 'HEAD', sha: 'b'.repeat(40) },
        mergeBaseSha: 'a'.repeat(40),
        files: [
          {
            path: 'a.ts',
            status: 'M',
            additions: 2,
            deletions: 1,
            binary: false,
          },
        ],
        totals: { additions: 2, deletions: 1, binaryFiles: 0 },
      },
      'file:viewContent': {
        success: true,
        absolutePath: '/ws/a/readme.md',
        workspaceRoot: '/ws/a',
        relativePath: 'readme.md',
        content: '# Mounted preview',
        sizeBytes: 17,
        encoding: 'utf-8',
      },
    };
    mockRpcCall.mockImplementation((_vscode: unknown, method: string) => {
      return Promise.resolve({
        success: true,
        data: rpcData[method] ?? { success: true },
      });
    });
    TestBed.configureTestingModule({
      imports: [GitDockComponent],
      providers: [
        { provide: VSCodeService, useValue: vscode },
        {
          provide: MonacoLoaderService,
          useValue: { load: jest.fn(() => new Promise(() => undefined)) },
        },
      ],
    });
  });

  it('collapses the rendered working-tree rail and persists layout state', async () => {
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#git-source-control-rail'),
    ).not.toBeNull();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="git-rail-toggle"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('#git-source-control-rail'),
    ).toBeNull();
    expect(TestBed.inject(ElectronLayoutService).gitRailCollapsed()).toBe(true);
    expect(vscode.setState).toHaveBeenCalledWith(
      'electron-layout',
      expect.objectContaining({ gitRailCollapsed: true, gitRailWidth: 256 }),
    );
  });

  // L-13. Git repo + collapsed rail + no open tab used to render a `flex-1
  // p-4` div whose two inner conditions were both false — a blank pane with no
  // way back to the file list from that region.
  it('offers a way back when the rail is collapsed with no tab open', async () => {
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="git-rail-toggle"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Source control is collapsed.',
    );
    const expand = fixture.nativeElement.querySelector(
      '[data-testid="git-dock-expand-rail"]',
    ) as HTMLButtonElement;
    expect(expand).not.toBeNull();
    expand.click();
    fixture.detectChanges();

    expect(TestBed.inject(ElectronLayoutService).gitRailCollapsed()).toBe(
      false,
    );
    expect(
      fixture.nativeElement.querySelector('#git-source-control-rail'),
    ).not.toBeNull();
  });

  it('renders every row and a diff when successful editor detection omits targets', async () => {
    rpcData['editor:detectTargets'] = {};
    rpcData['git:info'] = {
      isGitRepo: true,
      branch: {
        branch: 'main',
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
      },
      files: [
        { path: 'alpha.ts', status: 'M', staged: false },
        { path: 'beta.ts', status: 'M', staged: false },
      ],
    };
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll(
      'ptah-source-control-file',
    );
    expect(rows).toHaveLength(2);
    expect(fixture.nativeElement.textContent).toContain('alpha.ts');
    expect(fixture.nativeElement.textContent).toContain('beta.ts');
    const launcher = TestBed.inject(EditorLauncherService);
    expect(launcher.targets()).toEqual([]);
    expect(launcher.detectionError()).toBe(
      'Editor detection returned invalid data.',
    );

    await TestBed.inject(DiffTabsService).openDiff({
      path: 'alpha.ts',
      comparison: 'worktree',
    });
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-diff-view'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelectorAll('ptah-source-control-file'),
    ).toHaveLength(2);
  });

  it('uses real dock/header/source-control/Open In children and sends the workspace-safe file request', async () => {
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-git-dock-header'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-source-control-panel'),
    ).not.toBeNull();
    const open = fixture.nativeElement.querySelector(
      'ptah-source-control-file [data-testid="open-in-primary"]',
    ) as HTMLButtonElement;
    expect(open).not.toBeNull();
    open.click();
    await fixture.whenStable();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:openFile',
      { target: 'kiro', workspaceRoot: '/ws/a', path: 'a.ts' },
    );
  });

  it('switches through the real toolbar into the real historical review panel', async () => {
    const review = TestBed.inject(GitReviewService);
    review.switchWorkspace('/ws/a');
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    const branchReview = [
      ...fixture.nativeElement.querySelectorAll('button'),
    ].find(
      (button: HTMLButtonElement) =>
        button.textContent?.trim() === 'Branch review',
    ) as HTMLButtonElement;
    branchReview.click();
    await fixture.whenStable();
    fixture.detectChanges();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:reviewChanges',
      {
        workspaceRoot: '/ws/a',
        base: 'main',
        head: 'HEAD',
      },
    );
    expect(
      fixture.nativeElement.querySelector('ptah-git-review-panel'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('a.ts');
  });

  it('renders a file tab in a non-git workspace and markdown through the real preview', async () => {
    rpcData['git:info'] = { isGitRepo: false, files: [] };
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    await TestBed.inject(DiffTabsService).openFileView({
      path: '/ws/a/readme.md',
      workspaceRoot: '/ws/a',
    });
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('ptah-file-view'),
    ).not.toBeNull();
    expect(
      fixture.nativeElement.querySelector('ptah-markdown-block'),
    ).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Mounted preview');
    expect(fixture.nativeElement.textContent).not.toContain(
      'The active workspace is not a Git repository.',
    );
  });

  it('keeps mixed tabs keyboard-navigable', async () => {
    const gitStatus = TestBed.inject(GitStatusService);
    gitStatus.switchWorkspace('/ws/a');
    const tabs = TestBed.inject(DiffTabsService);
    await tabs.openDiff({ path: 'alpha.ts', comparison: 'worktree' });
    await tabs.openFileView({
      path: '/ws/a/readme.md',
      workspaceRoot: '/ws/a',
    });
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();
    const controls = fixture.nativeElement.querySelectorAll(
      '[role="tab"]',
    ) as NodeListOf<HTMLButtonElement>;
    expect(controls).toHaveLength(2);
    controls[1].dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true }),
    );
    fixture.detectChanges();
    expect(controls[0].getAttribute('aria-selected')).toBe('true');
  });

  it('confirms a blocked absolute path before one external-link launch', async () => {
    rpcData['file:viewContent'] = {
      success: false,
      reason: 'outside-roots',
      error: 'This file is outside the open workspaces.',
      absolutePath: '/outside/a.ts',
      externalOpenAllowed: true,
    };
    const tabs = TestBed.inject(DiffTabsService);
    await tabs.openFileView({ path: '/outside/a.ts', workspaceRoot: '/ws/a' });
    const fixture = TestBed.createComponent(GitDockComponent);
    await fixture.whenStable();
    fixture.detectChanges();

    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    fixture.detectChanges();
    const dialog = fixture.nativeElement.querySelector(
      '[role="alertdialog"]',
    ) as HTMLElement;
    expect(dialog.textContent).toContain('/outside/a.ts');
    expect(dialog.textContent).toContain('Kiro');
    expect(
      mockRpcCall.mock.calls.filter((call) => call[1] === 'editor:openFile'),
    ).toHaveLength(0);
    (
      dialog.querySelector(
        '[data-testid="confirm-external-open"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:openFile',
      {
        target: 'kiro',
        path: '/outside/a.ts',
        scope: 'external-link',
      },
    );
  });
});
