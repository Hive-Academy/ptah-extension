/**
 * TaskWorktreeViewComponent specs — TASK_2026_576 Batch 50.
 *
 * Ports every `worktree-section.component.spec.ts` case (parity §4 rows,
 * `parity-inventory.md:87-93`) and covers what is new: the branch panel
 * (parity §2 rows moved here), the PR/CI panel with its quiet unavailable
 * reasons, the one component-owned refresh timer, the sibling Remove button
 * with the git-ui confirm dialog, and axe.
 */

import axe from 'axe-core';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ElectronLayoutService,
  VSCodeService,
  type WorkspaceFolder,
} from '@ptah-extension/core';
import type {
  EditorTarget,
  GitBranchInfo,
  GitLastCommitResult,
  GitPrStatusResult,
  GitPrUnavailableReason,
  GitRepoOperation,
  GitWorktreeInfo,
  RemoteInfo,
} from '@ptah-extension/shared';
import { OpenInButtonComponent } from '../open-in/open-in-button.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { WorktreeService } from '../services/worktree.service';
import {
  PR_REFRESH_INTERVAL_MS,
  TaskWorktreeViewComponent,
} from './task-worktree-view.component';

/** jsdom has no HTMLDialogElement methods; reflect `open` like diff-view's spec. */
beforeAll(() => {
  if (!HTMLDialogElement.prototype.showModal) {
    HTMLDialogElement.prototype.showModal = function showModal(
      this: HTMLDialogElement,
    ) {
      this.setAttribute('open', '');
    } as HTMLDialogElement['showModal'];
  }
  if (!HTMLDialogElement.prototype.close) {
    HTMLDialogElement.prototype.close = function close(
      this: HTMLDialogElement,
    ) {
      this.removeAttribute('open');
    } as HTMLDialogElement['close'];
  }
});

function worktree(
  path: string,
  branch: string,
  isMain: boolean,
  extra: Partial<GitWorktreeInfo> = {},
): GitWorktreeInfo {
  return { path, branch, head: 'abc1234', isMain, isBare: false, ...extra };
}

const MAIN = worktree('D:\\repos\\app', 'main', true);
const FEATURE = worktree('D:\\repos\\app-feature', 'feature/x', false);

const PR_OK: GitPrStatusResult = {
  status: 'ok',
  pr: {
    number: 412,
    title: 'Advanced git review UI',
    state: 'OPEN',
    isDraft: false,
    reviewDecision: 'APPROVED',
    url: 'https://github.com/o/r/pull/412',
  },
  checks: { passing: 8, failing: 1, pending: 2, total: 11 },
};

function prOk(
  pr: Partial<Extract<GitPrStatusResult, { status: 'ok' }>['pr']>,
  checks = PR_OK.status === 'ok' ? PR_OK.checks : undefined,
): GitPrStatusResult {
  if (PR_OK.status !== 'ok' || !checks) throw new Error('fixture');
  return { status: 'ok', pr: { ...PR_OK.pr, ...pr }, checks };
}

describe('TaskWorktreeViewComponent', () => {
  let fixture: ComponentFixture<TaskWorktreeViewComponent>;
  let activeWorkspace: ReturnType<typeof signal<WorkspaceFolder | null>>;
  let addFolderByPath: jest.Mock;
  let gitStatus: {
    activeWorkspacePath: ReturnType<typeof signal<string | null>>;
    branch: ReturnType<typeof signal<GitBranchInfo>>;
    branchName: () => string;
    operation: ReturnType<typeof signal<GitRepoOperation | null>>;
  };
  let gitBranches: {
    currentBranch: ReturnType<typeof signal<string>>;
    stashCount: ReturnType<typeof signal<number>>;
    lastCommit: ReturnType<typeof signal<GitLastCommitResult | null>>;
    remotes: ReturnType<typeof signal<RemoteInfo[]>>;
    pushCompletions: ReturnType<typeof signal<number>>;
    refreshRemotes: jest.Mock;
    readPrStatus: jest.Mock<Promise<GitPrStatusResult>, [string]>;
  };
  let worktreeStub: {
    worktrees: ReturnType<typeof signal<GitWorktreeInfo[]>>;
    isLoading: ReturnType<typeof signal<boolean>>;
    loadError: ReturnType<typeof signal<string | null>>;
    loadWorktrees: jest.Mock;
    addWorktree: jest.Mock;
    removeWorktree: jest.Mock;
  };
  let launchers: {
    targets: ReturnType<typeof signal<readonly EditorTarget[]>>;
    openWorkspace: jest.Mock;
  };

  beforeEach(async () => {
    activeWorkspace = signal<WorkspaceFolder | null>(null);
    addFolderByPath = jest.fn(async () => undefined);
    const branch = signal<GitBranchInfo>({
      branch: 'feat/task-576',
      upstream: 'origin/feat/task-576',
      ahead: 1,
      behind: 0,
    });
    gitStatus = {
      activeWorkspacePath: signal<string | null>('/ws/a'),
      branch,
      branchName: () => branch().branch,
      operation: signal<GitRepoOperation | null>(null),
    };
    gitBranches = {
      currentBranch: signal('feat/task-576'),
      stashCount: signal(3),
      lastCommit: signal<GitLastCommitResult | null>({
        hash: 'a1b2c3d4e5',
        shortHash: 'a1b2c3d',
        subject: 'feat(git): task view',
        author: 'Ada',
      } as GitLastCommitResult),
      remotes: signal<RemoteInfo[]>([
        {
          name: 'origin',
          fetchUrl: 'https://github.com/o/r.git',
        } as RemoteInfo,
      ]),
      pushCompletions: signal(0),
      refreshRemotes: jest.fn(async () => undefined),
      readPrStatus: jest.fn<Promise<GitPrStatusResult>, [string]>(
        async () => PR_OK,
      ),
    };
    worktreeStub = {
      worktrees: signal<GitWorktreeInfo[]>([MAIN, FEATURE]),
      isLoading: signal(false),
      loadError: signal<string | null>(null),
      loadWorktrees: jest.fn(async () => undefined),
      addWorktree: jest.fn(async () => ({ success: true })),
      removeWorktree: jest.fn(async () => ({ success: true })),
    };
    launchers = {
      targets: signal<readonly EditorTarget[]>([]),
      openWorkspace: jest.fn(async () => true),
    };

    await TestBed.configureTestingModule({
      imports: [TaskWorktreeViewComponent],
      providers: [
        // OpenInButtonComponent reads its remembered target only with one.
        { provide: VSCodeService, useValue: null },
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: WorktreeService, useValue: worktreeStub },
        { provide: EditorLauncherService, useValue: launchers },
        {
          provide: ElectronLayoutService,
          useValue: { activeWorkspace, addFolderByPath },
        },
      ],
    }).compileComponents();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(shown = true): Promise<void> {
    fixture = TestBed.createComponent(TaskWorktreeViewComponent);
    fixture.componentRef.setInput('shown', shown);
    await settle();
  }

  function query<T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(selector);
  }

  function queryAll<T extends HTMLElement = HTMLElement>(
    selector: string,
  ): T[] {
    return [
      ...(fixture.nativeElement as HTMLElement).querySelectorAll<T>(selector),
    ];
  }

  function textOf(element: Element | null): string {
    return (element?.textContent ?? '').replace(/\s+/g, ' ').trim();
  }

  function switchButtons(): HTMLButtonElement[] {
    return queryAll<HTMLButtonElement>('[data-testid="task-worktree-switch"]');
  }

  function switchButtonFor(path: string): HTMLButtonElement {
    const found = switchButtons().find(
      (button) => button.title === `Switch to ${path}`,
    );
    if (!found) throw new Error(`no row for ${path}`);
    return found;
  }

  /** The `title` of every row currently marked active. */
  function activeRows(): string[] {
    return switchButtons()
      .filter((button) => button.getAttribute('aria-current') === 'true')
      .map((button) => button.title);
  }

  // -- Worktree rows (ported from worktree-section.component.spec.ts) --------

  describe('active highlight tracks ElectronLayoutService (parity §4 row 90)', () => {
    beforeEach(async () => {
      await render();
    });

    it('marks the worktree whose path is the active workspace', async () => {
      activeWorkspace.set({ path: FEATURE.path, name: 'app-feature' });
      await settle();

      expect(activeRows()).toEqual([`Switch to ${FEATURE.path}`]);
      const row = switchButtonFor(FEATURE.path);
      expect(row.getAttribute('aria-label')).toBe(
        `Switch to feature/x (active), ${FEATURE.path}`,
      );
      expect(textOf(row)).toContain('active');
    });

    it('moves the highlight when the active workspace changes', async () => {
      activeWorkspace.set({ path: FEATURE.path, name: 'app-feature' });
      await settle();
      expect(activeRows()).toEqual([`Switch to ${FEATURE.path}`]);

      activeWorkspace.set({ path: MAIN.path, name: 'app' });
      await settle();

      expect(activeRows()).toEqual([`Switch to ${MAIN.path}`]);
    });

    it('matches a path that differs only by separator style or trailing slash', async () => {
      activeWorkspace.set({
        path: 'D:/repos/app-feature/',
        name: 'app-feature',
      });
      await settle();

      expect(activeRows()).toEqual([`Switch to ${FEATURE.path}`]);
    });

    it('falls back to the main worktree when there is no active workspace', async () => {
      activeWorkspace.set(null);
      await settle();

      expect(activeRows()).toEqual([`Switch to ${MAIN.path}`]);
    });
  });

  it('opens a worktree only after the user explicitly clicks its row (parity §4 row 91)', async () => {
    activeWorkspace.set({ path: MAIN.path, name: 'app' });
    await render();

    expect(addFolderByPath).not.toHaveBeenCalled();
    switchButtonFor(FEATURE.path).click();
    await fixture.whenStable();

    expect(addFolderByPath).toHaveBeenCalledTimes(1);
    expect(addFolderByPath).toHaveBeenCalledWith(FEATURE.path);
  });

  it('heads the list "Worktrees (N)" (parity §4 row 87)', async () => {
    await render();

    expect(textOf(query('[data-testid="task-worktrees-heading"]'))).toBe(
      'Worktrees (2)',
    );
  });

  it('shows branch or "(detached)", path and main, locked and prunable badges (parity §4 row 90)', async () => {
    worktreeStub.worktrees.set([
      MAIN,
      worktree('/r/wt/locked', 'hotfix/urgent', false, {
        locked: true,
        lockReason: 'on a USB drive',
      }),
      worktree('/r/wt/gone', '', false, { prunable: true }),
    ]);
    await render();

    const rows = switchButtons();
    expect(textOf(rows[0])).toContain('main');
    expect(textOf(rows[0])).toContain(MAIN.path);
    expect(textOf(rows[1])).toContain('hotfix/urgent');
    expect(textOf(rows[1])).toContain('locked');
    expect(rows[1].getAttribute('aria-label')).toBe(
      'Switch to hotfix/urgent (locked), /r/wt/locked',
    );
    expect(textOf(rows[2])).toContain('(detached)');
    expect(textOf(rows[2])).toContain('prunable');
  });

  it('shows a spinner while the first list loads, and an empty state after (parity §4 row 93)', async () => {
    worktreeStub.worktrees.set([]);
    worktreeStub.isLoading.set(true);
    await render();

    expect(query('[data-testid="task-worktrees-loading"]')).not.toBeNull();
    expect(query('[data-testid="task-worktrees-empty"]')).toBeNull();

    worktreeStub.isLoading.set(false);
    await settle();

    expect(query('[data-testid="task-worktrees-loading"]')).toBeNull();
    expect(textOf(query('[data-testid="task-worktrees-empty"]'))).toBe(
      'No worktrees found.',
    );
  });

  it('a failed worktree read shows an error with Retry, never "No worktrees found." (MOD-3)', async () => {
    worktreeStub.worktrees.set([]);
    worktreeStub.loadError.set('Could not read the worktree list.');
    await render();

    const alert = query('[data-testid="task-worktrees-error"]');
    expect(alert?.getAttribute('role')).toBe('alert');
    expect(textOf(alert)).toContain('Could not read the worktree list.');
    expect(query('[data-testid="task-worktrees-empty"]')).toBeNull();

    const calls = worktreeStub.loadWorktrees.mock.calls.length;
    query<HTMLButtonElement>('[data-testid="task-worktrees-retry"]')?.click();
    await settle();
    expect(worktreeStub.loadWorktrees).toHaveBeenCalledTimes(calls + 1);
  });

  it('loads worktrees and remotes when the tab opens, and again on Refresh (parity §4 row 88, §2 row 52)', async () => {
    await render(false);
    expect(worktreeStub.loadWorktrees).not.toHaveBeenCalled();
    expect(gitBranches.refreshRemotes).not.toHaveBeenCalled();

    fixture.componentRef.setInput('shown', true);
    await settle();
    expect(worktreeStub.loadWorktrees).toHaveBeenCalledTimes(1);
    expect(gitBranches.refreshRemotes).toHaveBeenCalledTimes(1);

    query<HTMLButtonElement>('[data-testid="task-refresh"]')?.click();
    await settle();
    expect(worktreeStub.loadWorktrees).toHaveBeenCalledTimes(2);
    expect(gitBranches.refreshRemotes).toHaveBeenCalledTimes(2);
  });

  // -- Add form (parity §4 row 89) ---------------------------------------------

  describe('add form (parity §4 row 89)', () => {
    async function openForm(): Promise<void> {
      query<HTMLButtonElement>(
        '[data-testid="task-worktree-add-toggle"]',
      )?.click();
      await settle();
    }

    function type(selector: string, value: string): void {
      const input = query<HTMLInputElement>(selector);
      if (!input) throw new Error(selector);
      input.value = value;
      input.dispatchEvent(new Event('input'));
    }

    function press(selector: string, key: string): void {
      query(selector)?.dispatchEvent(
        new KeyboardEvent('keydown', { key, bubbles: true }),
      );
    }

    beforeEach(async () => {
      await render();
    });

    it('opens from Add with its expanded state, and Create stays disabled without a branch', async () => {
      const toggle = query('[data-testid="task-worktree-add-toggle"]');
      expect(toggle?.getAttribute('aria-expanded')).toBe('false');

      await openForm();

      expect(toggle?.getAttribute('aria-expanded')).toBe('true');
      expect(query('[data-testid="task-worktree-add-form"]')?.id).toBe(
        toggle?.getAttribute('aria-controls'),
      );
      expect(
        query<HTMLButtonElement>('[data-testid="task-worktree-create"]')
          ?.disabled,
      ).toBe(true);
    });

    it('Create stays disabled while a merge, rebase or cherry-pick is open (design-spec §11)', async () => {
      gitStatus.operation.set({ kind: 'rebase', conflictedPaths: ['a.ts'] });
      await openForm();
      type('[data-testid="task-worktree-branch"]', 'feature/y');
      await settle();

      const create = query<HTMLButtonElement>(
        '[data-testid="task-worktree-create"]',
      );
      expect(create?.disabled).toBe(true);
      press('[data-testid="task-worktree-branch"]', 'Enter');
      await settle();
      expect(worktreeStub.addWorktree).not.toHaveBeenCalled();

      gitStatus.operation.set(null);
      await settle();
      expect(create?.disabled).toBe(false);
    });

    it('submits branch, custom path and "Create new branch" on Enter, then closes', async () => {
      await openForm();
      type('[data-testid="task-worktree-branch"]', ' feature/y ');
      type('[data-testid="task-worktree-path"]', ' ../wt/y ');
      const checkbox = query<HTMLInputElement>(
        '[data-testid="task-worktree-create-branch"]',
      );
      checkbox?.click();
      await settle();

      press('[data-testid="task-worktree-branch"]', 'Enter');
      await settle();

      expect(worktreeStub.addWorktree).toHaveBeenCalledWith('feature/y', {
        path: '../wt/y',
        createBranch: true,
      });
      expect(query('[data-testid="task-worktree-add-form"]')).toBeNull();
    });

    it('omits an empty custom path', async () => {
      await openForm();
      type('[data-testid="task-worktree-branch"]', 'feature/z');
      await settle();

      query<HTMLButtonElement>('[data-testid="task-worktree-create"]')?.click();
      await settle();

      expect(worktreeStub.addWorktree).toHaveBeenCalledWith('feature/z', {
        path: undefined,
        createBranch: false,
      });
    });

    it('cancels on Escape without adding', async () => {
      await openForm();
      type('[data-testid="task-worktree-branch"]', 'feature/y');

      press('[data-testid="task-worktree-branch"]', 'Escape');
      await settle();

      expect(query('[data-testid="task-worktree-add-form"]')).toBeNull();
      expect(worktreeStub.addWorktree).not.toHaveBeenCalled();
    });

    it('shows "Creating…" while it runs and keeps the form with an inline error on failure', async () => {
      let finish: (value: { success: boolean; error?: string }) => void = () =>
        undefined;
      worktreeStub.addWorktree.mockReturnValueOnce(
        new Promise((resolve) => {
          finish = resolve;
        }),
      );
      await openForm();
      type('[data-testid="task-worktree-branch"]', 'feature/y');
      await settle();

      query<HTMLButtonElement>('[data-testid="task-worktree-create"]')?.click();
      fixture.detectChanges();
      const create = query<HTMLButtonElement>(
        '[data-testid="task-worktree-create"]',
      );
      expect(textOf(create)).toBe('Creating…');
      expect(create?.disabled).toBe(true);

      finish({ success: false, error: 'branch already checked out' });
      await settle();

      const error = query('[data-testid="task-worktree-add-error"]');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(textOf(error)).toBe('branch already checked out');
      expect(query('[data-testid="task-worktree-add-form"]')).not.toBeNull();
    });
  });

  // -- Remove (parity §4 row 92) -------------------------------------------------

  describe('remove (parity §4 row 92)', () => {
    beforeEach(async () => {
      await render();
    });

    function removeButtons(): HTMLButtonElement[] {
      return queryAll<HTMLButtonElement>(
        '[data-testid="task-worktree-remove"]',
      );
    }

    async function askToRemove(): Promise<void> {
      removeButtons()[0].click();
      await settle();
    }

    function dialogButton(id: string): HTMLButtonElement {
      const button = query<HTMLButtonElement>(`[data-testid="${id}"]`);
      if (!button) throw new Error(id);
      return button;
    }

    it('offers Remove only for non-main worktrees, as a sibling of the switch button', () => {
      const buttons = removeButtons();

      expect(buttons).toHaveLength(1);
      expect(buttons[0].getAttribute('aria-label')).toBe(
        'Remove worktree feature/x',
      );
      // The parity defect: no interactive control nested in another.
      expect(
        buttons[0].closest('[data-testid="task-worktree-switch"]'),
      ).toBeNull();
      expect(query('button button')).toBeNull();
    });

    it('asks through the confirm dialog before removing anything', async () => {
      await askToRemove();

      const dialog = query('[data-testid="git-confirm-dialog"]');
      expect(dialog?.getAttribute('role')).toBe('alertdialog');
      expect(textOf(dialog)).toContain('Remove worktree "feature/x"?');
      expect(dialogButton('git-confirm-secondary').textContent?.trim()).toBe(
        'Remove',
      );
      expect(dialogButton('git-confirm-confirm').textContent?.trim()).toBe(
        'Force remove',
      );
      expect(worktreeStub.removeWorktree).not.toHaveBeenCalled();
    });

    it('Remove removes without force', async () => {
      await askToRemove();

      dialogButton('git-confirm-secondary').click();
      await settle();

      expect(worktreeStub.removeWorktree).toHaveBeenCalledWith(
        FEATURE.path,
        false,
      );
      expect(query('[data-testid="git-confirm-dialog"]')).toBeNull();
    });

    it('Force remove removes with force', async () => {
      await askToRemove();

      dialogButton('git-confirm-confirm').click();
      await settle();

      expect(worktreeStub.removeWorktree).toHaveBeenCalledWith(
        FEATURE.path,
        true,
      );
    });

    it('Cancel removes nothing', async () => {
      await askToRemove();

      dialogButton('git-confirm-cancel').click();
      await settle();

      expect(worktreeStub.removeWorktree).not.toHaveBeenCalled();
      expect(query('[data-testid="git-confirm-dialog"]')).toBeNull();
    });

    it('shows a failure inline', async () => {
      worktreeStub.removeWorktree.mockResolvedValueOnce({
        success: false,
        error: 'worktree contains modified files',
      });
      await askToRemove();

      dialogButton('git-confirm-secondary').click();
      await settle();

      const error = query('[data-testid="task-worktree-remove-error"]');
      expect(error?.getAttribute('role')).toBe('alert');
      expect(textOf(error)).toBe('worktree contains modified files');
    });

    it('says a locked worktree needs Force remove', async () => {
      worktreeStub.worktrees.set([
        MAIN,
        worktree('/r/wt/locked', 'hotfix/urgent', false, { locked: true }),
      ]);
      await settle();
      await askToRemove();

      expect(textOf(query('[data-testid="git-confirm-dialog"]'))).toContain(
        'This worktree is locked. Removing it requires Force remove.',
      );
    });
  });

  // -- Branch panel (parity §2 rows 51-55, moved here) -------------------------

  it('shows branch, upstream, ahead/behind and the branch details inline', async () => {
    gitStatus.branch.set({
      branch: 'feat/task-576',
      upstream: 'origin/feat/task-576',
      ahead: 2,
      behind: 3,
    });
    await render();

    expect(textOf(query('[data-testid="task-branch-name"]'))).toBe(
      'feat/task-576',
    );
    expect(textOf(query('[data-testid="task-branch-upstream"]'))).toBe(
      '→ origin/feat/task-576',
    );
    const counts = query('[data-testid="task-ahead-behind"]');
    // Arrows for the eye, words for a screen reader.
    expect(textOf(counts)).toBe('↑2 ahead,↓3 behind');
    const details = query('[data-testid="task-branch-details"]');
    expect(
      [...(details?.querySelectorAll('dt') ?? [])].map((dt) => textOf(dt)),
    ).toEqual(['Stashes', 'Last commit', 'Remote']);
    expect(
      [...(details?.querySelectorAll('dd') ?? [])].map((dd) => textOf(dd)),
    ).toEqual([
      '3',
      'a1b2c3d feat(git): task view · Ada',
      'origin · https://github.com/o/r.git',
    ]);
  });

  it('says "No upstream" and drops the counts for a branch without one', async () => {
    gitStatus.branch.set({
      branch: 'local-only',
      upstream: null,
      ahead: 0,
      behind: 0,
    });
    await render();

    expect(query('[data-testid="task-ahead-behind"]')).toBeNull();
    expect(textOf(query('[data-testid="task-branch-panel"]'))).toContain(
      'No upstream',
    );
  });

  it('routes Open-in to the launcher for the workspace root (parity §2 row 55)', async () => {
    await render();

    fixture.debugElement
      .query(By.directive(OpenInButtonComponent))
      .componentInstance.open.emit({ target: 'kiro' });

    expect(launchers.openWorkspace).toHaveBeenCalledWith('kiro', '/ws/a');
  });

  // -- PR panel ------------------------------------------------------------------

  describe('PR panel', () => {
    it('shows a skeleton until the first reply', async () => {
      gitBranches.readPrStatus.mockReturnValueOnce(
        new Promise(() => undefined),
      );
      await render();

      const loading = query('[data-testid="task-pr-loading"]');
      expect(loading?.getAttribute('role')).toBe('status');
    });

    it('shows number, title, state, review decision, CI counts and an https Open PR link', async () => {
      await render();

      expect(gitBranches.readPrStatus).toHaveBeenCalledWith('/ws/a');
      expect(textOf(query('[data-testid="task-pr-title"]'))).toBe(
        '#412 Advanced git review UI',
      );
      const state = query('[data-testid="task-pr-state"]');
      expect(textOf(state)).toBe('open');
      expect(state?.className).toContain('badge-success');
      expect(state?.tagName).not.toBe('BUTTON');
      expect(textOf(query('[data-testid="task-pr-review"]'))).toBe(
        'Review: Approved',
      );
      expect(textOf(query('[data-testid="task-pr-checks"]'))).toBe(
        '8 passing 1 failing 2 pending',
      );
      const open = query<HTMLAnchorElement>('[data-testid="task-pr-open"]');
      expect(open?.tagName).toBe('A');
      expect(open?.getAttribute('href')).toBe(
        'https://github.com/o/r/pull/412',
      );
      expect(open?.getAttribute('target')).toBe('_blank');
      expect(open?.getAttribute('rel')).toBe('noopener noreferrer');
    });

    it.each([
      ['http://github.com/o/r/pull/1'],
      ['javascript:alert(1)'],
      ['not a url'],
      [undefined],
    ])('offers no Open PR for %s', async (url) => {
      gitBranches.readPrStatus.mockResolvedValue(prOk({ url }));
      await render();

      expect(query('[data-testid="task-pr-title"]')).not.toBeNull();
      expect(query('[data-testid="task-pr-open"]')).toBeNull();
    });

    it.each<[Parameters<typeof prOk>[0], string, string]>([
      [{ state: 'OPEN', isDraft: true }, 'draft', 'badge-ghost'],
      [{ state: 'MERGED' }, 'merged', 'badge-outline'],
      [{ state: 'CLOSED' }, 'closed', 'err-solid-text'],
    ])('badges %o as %s', async (pr, label, cls) => {
      gitBranches.readPrStatus.mockResolvedValue(prOk(pr));
      await render();

      const state = query('[data-testid="task-pr-state"]');
      expect(textOf(state)).toBe(label);
      expect(state?.className).toContain(cls);
    });

    it('says "No checks" when the PR has none and omits an absent review decision', async () => {
      gitBranches.readPrStatus.mockResolvedValue(
        prOk(
          { reviewDecision: null },
          { passing: 0, failing: 0, pending: 0, total: 0 },
        ),
      );
      await render();

      expect(textOf(query('[data-testid="task-pr-checks"]'))).toBe('No checks');
      expect(query('[data-testid="task-pr-review"]')).toBeNull();
    });

    it.each<[GitPrUnavailableReason, string]>([
      ['gh-missing', 'GitHub CLI not available — PR status hidden.'],
      ['not-authenticated', 'GitHub CLI is not signed in — PR status hidden.'],
      ['not-github', 'This repository is not on GitHub — PR status hidden.'],
      ['no-pr', 'No pull request found for this branch.'],
      ['timeout', 'GitHub did not answer in time — PR status hidden.'],
      ['failed', 'PR status could not be read.'],
    ])('shows %s as one quiet muted line', async (reason, line) => {
      gitBranches.readPrStatus.mockResolvedValue({
        status: 'unavailable',
        reason,
      });
      await render();

      const note = query('[data-testid="task-pr-unavailable"]');
      expect(textOf(note)).toBe(line);
      expect(note?.className).toContain('text-base-content-muted');
      expect(note?.className).not.toContain('error');
      expect(note?.hasAttribute('role')).toBe(false);
      expect(query('[data-testid="task-pr-panel"] [role="alert"]')).toBeNull();
      // The rest of the view still works.
      expect(switchButtons()).toHaveLength(2);
    });
  });

  // -- Refresh policy (Requirement 10.5) ----------------------------------------

  describe('refresh policy', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    async function tick(ms = 0): Promise<void> {
      fixture.detectChanges();
      await jest.advanceTimersByTimeAsync(ms);
      fixture.detectChanges();
    }

    function create(shown: boolean): void {
      fixture = TestBed.createComponent(TaskWorktreeViewComponent);
      fixture.componentRef.setInput('shown', shown);
    }

    it('reads nothing while hidden, then once when the tab opens', async () => {
      create(false);
      await tick(PR_REFRESH_INTERVAL_MS * 2);
      expect(gitBranches.readPrStatus).not.toHaveBeenCalled();

      fixture.componentRef.setInput('shown', true);
      await tick();

      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);
    });

    it('re-reads at most once per interval while shown', async () => {
      create(true);
      await tick();
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);

      await tick(PR_REFRESH_INTERVAL_MS - 1);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);

      await tick(1);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);

      await tick(PR_REFRESH_INTERVAL_MS);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(3);
    });

    it('clears the timer when the tab hides and restarts on the next open', async () => {
      create(true);
      await tick();

      fixture.componentRef.setInput('shown', false);
      await tick(PR_REFRESH_INTERVAL_MS * 3);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);

      fixture.componentRef.setInput('shown', true);
      await tick();
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);
      await tick(PR_REFRESH_INTERVAL_MS);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(3);
    });

    it('clears the timer on destroy', async () => {
      create(true);
      await tick();
      const clearSpy = jest.spyOn(globalThis, 'clearTimeout');

      fixture.destroy();

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
      await jest.advanceTimersByTimeAsync(PR_REFRESH_INTERVAL_MS * 2);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);
    });

    it('re-reads after a push completes, replacing the pending timer rather than adding one', async () => {
      create(true);
      await tick(PR_REFRESH_INTERVAL_MS / 2);

      gitBranches.pushCompletions.set(1);
      await tick();
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);

      // The first timer would have fired here; only the new one remains.
      await tick(PR_REFRESH_INTERVAL_MS / 2);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);
      await tick(PR_REFRESH_INTERVAL_MS / 2);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(3);
    });

    it('re-reads immediately on Refresh and restarts the interval', async () => {
      create(true);
      await tick(PR_REFRESH_INTERVAL_MS / 2);

      query<HTMLButtonElement>('[data-testid="task-refresh"]')?.click();
      await tick();
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);

      await tick(PR_REFRESH_INTERVAL_MS - 1);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(2);
      await tick(1);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(3);
    });

    it('drops a reply that lands after the tab hid', async () => {
      let answer: (value: GitPrStatusResult) => void = () => undefined;
      gitBranches.readPrStatus.mockReturnValueOnce(
        new Promise((resolve) => {
          answer = resolve;
        }),
      );
      create(true);
      await tick();

      fixture.componentRef.setInput('shown', false);
      await tick();
      answer(PR_OK);
      await tick();

      expect(query('[data-testid="task-pr-title"]')).toBeNull();
      // Nor does the late reply arm a timer.
      await tick(PR_REFRESH_INTERVAL_MS * 2);
      expect(gitBranches.readPrStatus).toHaveBeenCalledTimes(1);
    });

    it('re-reads for a new workspace and never shows the old one there', async () => {
      let answerOld: (value: GitPrStatusResult) => void = () => undefined;
      gitBranches.readPrStatus
        .mockReturnValueOnce(
          new Promise((resolve) => {
            answerOld = resolve;
          }),
        )
        .mockResolvedValueOnce({ status: 'unavailable', reason: 'no-pr' });
      create(true);
      await tick();

      gitStatus.activeWorkspacePath.set('/ws/b');
      await tick();
      answerOld(PR_OK);
      await tick();

      expect(gitBranches.readPrStatus).toHaveBeenLastCalledWith('/ws/b');
      expect(query('[data-testid="task-pr-title"]')).toBeNull();
      expect(textOf(query('[data-testid="task-pr-unavailable"]'))).toBe(
        'No pull request found for this branch.',
      );
    });
  });

  // -- Accessibility -------------------------------------------------------------

  it('has no axe violations with the PR, worktrees and the add form showing', async () => {
    await render();
    query<HTMLButtonElement>(
      '[data-testid="task-worktree-add-toggle"]',
    )?.click();
    await settle();

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
