/**
 * ReviewShellComponent with its real header and review canvas (TASK_2026_576
 * Batch 43). Ports the `git-dock.mount.spec.ts` cases that still apply: the
 * real children render from a real status read, the header's collapse control
 * hides the file tree and persists the layout, and the comparison bar reaches
 * the branch review read. Adds axe on the mounted shell.
 *
 * Pierre (ESM-only, lazy in the app) and the spot editor (CodeMirror, covered
 * by its own spec) are replaced at the module boundary; `rpcCall` is mocked.
 */

import axe from 'axe-core';
import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
  type TemplateRef,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import type { EditorTarget, GitHunkRef } from '@ptah-extension/shared';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import type { PierreHunkToolbarContext } from '../renderer/pierre-diff-host.component';
import type { GitReviewService as ReviewType } from '../services/git-review.service';
import type { GitStatusService as StatusType } from '../services/git-status.service';
import type { FileViewOpenRequest } from '../types/diff-tab.types';
import type { ReviewShellComponent as ShellType } from './review-shell.component';

@Component({
  selector: 'ptah-pierre-diff-host',
  standalone: true,
  imports: [NgTemplateOutlet],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-pierre"></div>`,
})
class MockPierreDiffHost {
  readonly patch = input<string | null>(null);
  readonly oldText = input<string | null>(null);
  readonly newText = input<string | null>(null);
  readonly fileName = input('');
  readonly hunks = input<readonly GitHunkRef[]>([]);
  readonly diffStyle = input<'split' | 'unified'>('split');
  readonly hunkToolbar = input<TemplateRef<PierreHunkToolbarContext> | null>(
    null,
  );
}

@Component({
  selector: 'ptah-spot-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class MockSpotEditor {
  readonly request = input.required<FileViewOpenRequest>();
  readonly startEditable = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly backToReview = output<void>();
  readonly openExternal = output<OpenInRequest>();
}

jest.mock('../renderer/pierre-diff-host.component', () => ({
  PierreDiffHostComponent: MockPierreDiffHost,
}));
jest.mock('../spot-editor/spot-editor.component', () => ({
  SpotEditorComponent: MockSpotEditor,
}));

const mockRpcCall = jest.fn();
jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return { ...actual, rpcCall: (...args: unknown[]) => mockRpcCall(...args) };
});

/**
 * Loaded after the module mocks above are registered, so every module behind
 * them binds to the mocked `rpcCall`.
 */
let ReviewShellComponent: typeof ShellType;
let GitStatusService: typeof StatusType;
let GitReviewService: typeof ReviewType;

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
    handleMessage: jest.fn(),
    handledMessageTypes: [],
  };
}

describe('ReviewShellComponent mounted with its real header and canvas', () => {
  let rpcData: Record<string, unknown>;
  let vscode: ReturnType<typeof vscodeStub>;
  let fixture: ComponentFixture<ShellType>;

  beforeAll(async () => {
    ({ ReviewShellComponent } = await import('./review-shell.component'));
    ({ GitStatusService } = await import('../services/git-status.service'));
    ({ GitReviewService } = await import('../services/git-review.service'));
  });

  beforeEach(async () => {
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
      'git:branches': {
        current: 'main',
        local: [{ name: 'main', isCurrent: true }],
        remote: [],
      },
      'git:stashList': { success: true, entries: [], count: 0 },
      'git:lastCommit': { success: false },
      'git:diffFile': {
        path: 'a.ts',
        originalPath: 'a.ts',
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
    };
    mockRpcCall.mockImplementation((_vscode: unknown, method: string) =>
      Promise.resolve({
        success: true,
        data: rpcData[method] ?? { success: true },
      }),
    );
    TestBed.configureTestingModule({
      imports: [ReviewShellComponent],
      providers: [{ provide: VSCodeService, useValue: vscode }],
    });
    TestBed.inject(GitStatusService).switchWorkspace('/ws/a');
    TestBed.inject(GitReviewService).switchWorkspace('/ws/a');
    fixture = TestBed.createComponent(ReviewShellComponent);
    // Once for the status read and the deferred canvas chunk, once for what
    // the canvas renders from them.
    await settle();
    await settle();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function query<T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  }

  it('renders the real header, the tablist and the canvas from a real status read', () => {
    expect(query('[data-testid="git-dock-header"]')).not.toBeNull();
    expect(query('[role="tab"]')?.getAttribute('aria-label')).toBe(
      'Changes, 1 changed file',
    );
    expect(query('[role="tabpanel"] ptah-review-canvas')).not.toBeNull();
    expect(query('[data-testid="tree-row-file"]')?.textContent).toContain(
      'a.ts',
    );
  });

  it('shows the real conflict banner above the tabs while an operation is in progress (Batch 54)', async () => {
    expect(query('[data-testid="conflict-banner"]')).toBeNull();
    const info = rpcData['git:info'] as Record<string, unknown>;
    rpcData['git:info'] = {
      ...info,
      files: [
        {
          path: 'a.ts',
          status: 'U',
          staged: false,
          conflict: { kind: 'content' },
        },
      ],
      operation: { kind: 'merge', conflictedPaths: ['a.ts'] },
    };
    await TestBed.inject(GitStatusService).refresh();
    await settle();

    const banner = query('[data-testid="conflict-banner"]');
    expect(banner?.getAttribute('role')).toBe('region');
    expect(
      banner &&
        banner.compareDocumentPosition(
          query('[role="tablist"]') as HTMLElement,
        ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // Kiro has no merge view: the backend answers unsupported, the file opens.
    rpcData['editor:openMerge'] = { status: 'unsupported' };
    query<HTMLButtonElement>(
      '[data-testid="conflict-banner-open-editor"]',
    )?.click();
    await settle();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:openMerge',
      { target: 'kiro', path: 'a.ts', workspaceRoot: '/ws/a' },
    );
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'editor:openFile',
      { target: 'kiro', workspaceRoot: '/ws/a', path: 'a.ts' },
    );

    // Resolved: Continue appears, completes, and the refreshed status ends it.
    rpcData['git:info'] = {
      ...info,
      operation: { kind: 'merge', conflictedPaths: [] },
    };
    await TestBed.inject(GitStatusService).refresh();
    await settle();
    rpcData['git:operationContinue'] = { status: 'completed', kind: 'merge' };
    rpcData['git:info'] = info;
    query<HTMLButtonElement>(
      '[data-testid="conflict-banner-continue"]',
    )?.click();
    await settle();
    await settle();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:operationContinue',
      { workspaceRoot: '/ws/a' },
      expect.any(Number),
    );
    expect(query('[data-testid="conflict-banner"]')).toBeNull();
    expect(
      query('[data-testid="conflict-banner-ended"]')?.textContent?.trim(),
    ).toBe('Merge completed.');
    expect(query('[role="tabpanel"] ptah-review-canvas')).not.toBeNull();
  });

  it('collapses the file tree from the header and persists the layout', async () => {
    expect(query('[data-testid="changed-file-tree"]')).not.toBeNull();

    query<HTMLButtonElement>('[data-testid="git-rail-toggle"]')?.click();
    await settle();

    expect(query('[data-testid="changed-file-tree"]')).toBeNull();
    expect(TestBed.inject(ElectronLayoutService).gitRailCollapsed()).toBe(true);
    expect(vscode.setState).toHaveBeenCalledWith(
      'electron-layout',
      expect.objectContaining({ gitRailCollapsed: true }),
    );
  });

  it('reads the branch review when Branch review is picked in the comparison bar', async () => {
    query<HTMLButtonElement>('[data-testid="comparison-trigger"]')?.click();
    await settle();
    query<HTMLButtonElement>(
      '[data-testid="comparison-option-branch"]',
    )?.click();
    await settle();

    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:reviewChanges',
      { workspaceRoot: '/ws/a', base: 'main', head: 'HEAD' },
    );
  });

  it('loads the real task view on the Task tab and reads PR status for the workspace', async () => {
    rpcData['git:prStatus'] = { status: 'unavailable', reason: 'gh-missing' };
    rpcData['git:remotes'] = { remotes: [] };
    rpcData['git:worktrees'] = {
      worktrees: [
        {
          path: '/ws/a',
          branch: 'main',
          head: 'abc',
          isMain: true,
          isBare: false,
        },
      ],
    };

    query<HTMLButtonElement>('[data-tab-id="task"]')?.click();
    await settle();
    await settle();

    expect(query('[role="tabpanel"] ptah-task-worktree-view')).not.toBeNull();
    expect(mockRpcCall).toHaveBeenCalledWith(
      expect.anything(),
      'git:prStatus',
      { workspaceRoot: '/ws/a' },
      30_000,
    );
    expect(
      query('[data-testid="task-pr-unavailable"]')?.textContent?.trim(),
    ).toBe('GitHub CLI not available — PR status hidden.');

    const results = await axe.run(
      query('[data-testid="review-shell-task-body"]') as Parameters<
        typeof axe.run
      >[0],
      {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      },
    );
    expect(results.violations.map((violation) => violation.id)).toEqual([]);
  });

  it('has no axe violations', async () => {
    const results = await axe.run(
      fixture.nativeElement as Parameters<typeof axe.run>[0],
      {
        rules: {
          'color-contrast': { enabled: false },
          'target-size': { enabled: false },
        },
      },
    );

    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.html),
      })),
    ).toEqual([]);
  });
});
