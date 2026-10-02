/**
 * HistoryTimelineComponent specs — TASK_2026_576 Batch 56 (Requirement 12).
 *
 * Covers the `git:log` states (loading, since-base, recent, empty, truncated,
 * detached, unavailable + Retry), when the log is read again, selecting a
 * commit, the root and merge commit rows, the Stashes section ported from the
 * stash popover (parity §5 rows 105-113) with its confirmed drop, and axe.
 */

import axe from 'axe-core';
import { signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { VSCodeService } from '@ptah-extension/core';
import type {
  EditorTarget,
  GitHistoryCommit,
  GitLastCommitResult,
  GitLogResult,
  GitStashFileEntry,
  StashEntry,
} from '@ptah-extension/shared';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitHistoryService } from '../services/git-history.service';
import { GitStashService } from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import {
  ReviewNavigationService,
  type ReviewNavigationOutcome,
} from '../services/review-navigation.service';
import { HistoryTimelineComponent } from './history-timeline.component';

/** jsdom has no HTMLDialogElement methods; reflect `open` like other specs. */
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

const HOUR = 3_600_000;

function commit(
  shortSha: string,
  subject: string,
  extra: Partial<GitHistoryCommit> = {},
): GitHistoryCommit {
  return {
    sha: `${shortSha}${'0'.repeat(40 - shortSha.length)}`,
    shortSha,
    subject,
    authorName: 'Ada',
    authorDate: new Date(Date.now() - 2 * HOUR).toISOString(),
    parentCount: 1,
    isRoot: false,
    ...extra,
  };
}

const C1 = commit('a1b2c3d', 'feat: add hunk toolbar');
const C2 = commit('e4f5a6b', 'fix: stale snapshot check', {
  authorName: 'Grace',
  authorDate: new Date(Date.now() - 26 * HOUR).toISOString(),
});

function sinceBase(
  commits: GitHistoryCommit[],
  extra: Partial<Extract<GitLogResult, { status: 'ok' }>> = {},
): GitLogResult {
  return {
    status: 'ok',
    mode: 'since-base',
    base: 'origin/main',
    branch: 'feat/task-576',
    commits,
    truncated: false,
    ...extra,
  };
}

const STASH: StashEntry = {
  index: 0,
  hash: '0123456789abcdef',
  message: 'wip: try approach B',
  branch: 'feat/task-576',
};

describe('HistoryTimelineComponent', () => {
  let fixture: ComponentFixture<HistoryTimelineComponent>;
  let workspace: ReturnType<typeof signal<string | null>>;
  let branch: ReturnType<typeof signal<string>>;
  let lastCommit: ReturnType<typeof signal<GitLastCommitResult | null>>;
  let pushCompletions: ReturnType<typeof signal<number>>;
  let stashCount: ReturnType<typeof signal<number>>;
  let readLog: jest.Mock<Promise<GitLogResult>, [string]>;
  let openHistorical: jest.Mock<Promise<ReviewNavigationOutcome>, [string]>;
  let launchers: {
    targets: ReturnType<typeof signal<readonly EditorTarget[]>>;
    openWorkspace: jest.Mock;
  };
  let stash: {
    entries: ReturnType<typeof signal<StashEntry[]>>;
    listLoading: ReturnType<typeof signal<boolean>>;
    selectedIndex: ReturnType<typeof signal<number | null>>;
    files: ReturnType<typeof signal<GitStashFileEntry[]>>;
    filesLoading: ReturnType<typeof signal<boolean>>;
    busy: ReturnType<typeof signal<boolean>>;
    error: ReturnType<typeof signal<string | null>>;
    loadList: jest.Mock;
    select: jest.Mock;
    mutate: jest.Mock;
    openFileDiff: jest.Mock;
  };

  beforeEach(async () => {
    workspace = signal<string | null>('/ws/a');
    branch = signal('feat/task-576');
    lastCommit = signal<GitLastCommitResult | null>({
      hash: C1.sha,
    } as GitLastCommitResult);
    pushCompletions = signal(0);
    stashCount = signal(1);
    readLog = jest.fn<Promise<GitLogResult>, [string]>(async () =>
      sinceBase([C1, C2]),
    );
    openHistorical = jest.fn<Promise<ReviewNavigationOutcome>, [string]>(
      async () => ({ opened: true }),
    );
    launchers = {
      targets: signal<readonly EditorTarget[]>([
        { id: 'vscode', displayName: 'VS Code' },
      ]),
      openWorkspace: jest.fn(async () => true),
    };
    stash = {
      entries: signal<StashEntry[]>([STASH]),
      listLoading: signal(false),
      selectedIndex: signal<number | null>(null),
      files: signal<GitStashFileEntry[]>([]),
      filesLoading: signal(false),
      busy: signal(false),
      error: signal<string | null>(null),
      loadList: jest.fn(async () => undefined),
      select: jest.fn(async () => undefined),
      mutate: jest.fn(async () => ({ success: true })),
      openFileDiff: jest.fn(async () => undefined),
    };

    await TestBed.configureTestingModule({
      imports: [HistoryTimelineComponent],
      providers: [
        // OpenInButtonComponent reads its remembered target only with one.
        { provide: VSCodeService, useValue: null },
        {
          provide: GitStatusService,
          useValue: {
            activeWorkspacePath: workspace,
            branchName: () => branch(),
          },
        },
        {
          provide: GitBranchesService,
          useValue: { lastCommit, pushCompletions, stashCount },
        },
        { provide: GitHistoryService, useValue: { readLog } },
        { provide: ReviewNavigationService, useValue: { openHistorical } },
        { provide: EditorLauncherService, useValue: launchers },
        { provide: GitStashService, useValue: stash },
      ],
    }).compileComponents();
  });

  async function settle(): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  async function render(shown = true): Promise<void> {
    fixture = TestBed.createComponent(HistoryTimelineComponent);
    fixture.componentRef.setInput('shown', shown);
    await settle();
  }

  function query<T extends HTMLElement = HTMLElement>(
    testId: string,
  ): T | null {
    return (fixture.nativeElement as HTMLElement).querySelector<T>(
      `[data-testid="${testId}"]`,
    );
  }

  function queryAll(testId: string): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLElement>(
        `[data-testid="${testId}"]`,
      ),
    );
  }

  function text(testId: string): string {
    return query(testId)?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
  }

  // -- Reads ---------------------------------------------------------------------

  it('reads nothing while hidden and reads the active workspace on show', async () => {
    await render(false);
    expect(readLog).not.toHaveBeenCalled();
    expect(stash.loadList).not.toHaveBeenCalled();

    fixture.componentRef.setInput('shown', true);
    await settle();
    expect(readLog).toHaveBeenCalledWith('/ws/a');
    expect(stash.loadList).toHaveBeenCalled();
  });

  it('shows a loading status while the first read is pending', async () => {
    let resolve: (value: GitLogResult) => void = () => undefined;
    readLog.mockImplementation(
      () => new Promise<GitLogResult>((r) => (resolve = r)),
    );
    fixture = TestBed.createComponent(HistoryTimelineComponent);
    fixture.componentRef.setInput('shown', true);
    fixture.detectChanges();
    expect(query('history-loading')?.getAttribute('role')).toBe('status');

    resolve(sinceBase([C1]));
    await settle();
    expect(query('history-loading')).toBeNull();
    expect(queryAll('history-commit')).toHaveLength(1);
  });

  it('does not read again when shown again with nothing moved', async () => {
    await render();
    fixture.componentRef.setInput('shown', false);
    await settle();
    fixture.componentRef.setInput('shown', true);
    await settle();
    expect(readLog).toHaveBeenCalledTimes(1);
  });

  it('reads again on show after a commit moved HEAD while hidden', async () => {
    await render();
    fixture.componentRef.setInput('shown', false);
    await settle();
    lastCommit.set({ hash: 'f'.repeat(40) } as GitLastCommitResult);
    await settle();
    expect(readLog).toHaveBeenCalledTimes(1);

    fixture.componentRef.setInput('shown', true);
    await settle();
    expect(readLog).toHaveBeenCalledTimes(2);
  });

  it('reads again while shown after a push or a branch switch', async () => {
    await render();
    pushCompletions.set(1);
    await settle();
    branch.set('main');
    await settle();
    expect(readLog).toHaveBeenCalledTimes(3);
  });

  it('drops a reply for a workspace that is no longer active', async () => {
    const pending: Array<(value: GitLogResult) => void> = [];
    readLog.mockImplementation(
      () => new Promise<GitLogResult>((r) => pending.push(r)),
    );
    fixture = TestBed.createComponent(HistoryTimelineComponent);
    fixture.componentRef.setInput('shown', true);
    fixture.detectChanges();
    workspace.set('/ws/b');
    fixture.detectChanges();
    expect(readLog).toHaveBeenLastCalledWith('/ws/b');

    pending[0](sinceBase([C1, C2]));
    await settle();
    expect(queryAll('history-commit')).toHaveLength(0);

    pending[1](sinceBase([C2]));
    await settle();
    expect(queryAll('history-commit')).toHaveLength(1);
  });

  // -- States --------------------------------------------------------------------

  it('lists commits since the base, newest first, with hash, subject, author and time', async () => {
    await render();
    expect(text('history-heading')).toBe('Commits since origin/main');
    const rows = queryAll('history-commit');
    expect(rows).toHaveLength(2);
    expect(rows[0].tagName).toBe('BUTTON');
    expect(rows[0].textContent).toContain('a1b2c3d');
    expect(rows[0].textContent).toContain('feat: add hunk toolbar');
    expect(rows[0].textContent).toContain('Ada');
    expect(rows[0].textContent).toContain('2h ago');
    expect(rows[1].textContent).toContain('1d ago');

    const time = rows[0].querySelector('time');
    expect(time?.getAttribute('datetime')).toBe(C1.authorDate);
    const absolute = new Date(C1.authorDate).toLocaleString();
    expect(time?.getAttribute('title')).toBe(absolute);
    expect(time?.querySelector('.sr-only')?.textContent).toContain(absolute);
  });

  it('heads the list "Recent commits" on the base branch', async () => {
    readLog.mockResolvedValue({
      ...sinceBase([C1]),
      mode: 'recent',
      base: null,
      branch: 'main',
    });
    await render();
    expect(text('history-heading')).toBe('Recent commits');
  });

  it('says "No commits yet on this branch." when the branch has none of its own', async () => {
    readLog.mockResolvedValue(sinceBase([]));
    await render();
    expect(text('history-empty')).toBe('No commits yet on this branch.');
    expect(queryAll('history-commit')).toHaveLength(0);
  });

  it('notes that older commits are not shown when the list is truncated', async () => {
    await render();
    expect(query('history-truncated')).toBeNull();

    readLog.mockResolvedValue(sinceBase([C1], { truncated: true }));
    query<HTMLButtonElement>('history-refresh')?.click();
    await settle();
    expect(text('history-truncated')).toBe('Older commits are not shown.');
  });

  it('notes a detached HEAD', async () => {
    readLog.mockResolvedValue(sinceBase([C1], { branch: null }));
    await render();
    expect(text('history-detached')).toContain('HEAD is detached');
  });

  it('shows an error row with Retry when the log is unavailable', async () => {
    readLog.mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'git-failed',
    });
    await render();
    const row = query('history-unavailable');
    expect(row?.getAttribute('role')).toBe('alert');
    expect(row?.textContent).toContain('Could not read the commit history.');

    query<HTMLButtonElement>('history-retry')?.click();
    await settle();
    expect(readLog).toHaveBeenCalledTimes(2);
    expect(query('history-unavailable')).toBeNull();
    expect(queryAll('history-commit')).toHaveLength(2);
  });

  it('reads again on the next show after a failed read', async () => {
    readLog.mockResolvedValueOnce({
      status: 'unavailable',
      reason: 'not-a-repository',
    });
    await render();
    expect(text('history-unavailable')).toContain('not a git repository');

    fixture.componentRef.setInput('shown', false);
    await settle();
    fixture.componentRef.setInput('shown', true);
    await settle();
    expect(readLog).toHaveBeenCalledTimes(2);
  });

  it('asks for a workspace when none is open', async () => {
    workspace.set(null);
    await render();
    expect(readLog).not.toHaveBeenCalled();
    expect(query('history-no-workspace')).not.toBeNull();
  });

  // -- Commit rows ---------------------------------------------------------------

  it('opens a selected commit as a historical comparison', async () => {
    await render();
    queryAll('history-commit')[1].click();
    await settle();
    expect(openHistorical).toHaveBeenCalledWith(C2.sha);
    expect(query('history-open-error')).toBeNull();
  });

  it('shows why a commit could not be opened', async () => {
    openHistorical.mockResolvedValueOnce({
      opened: false,
      error: 'Could not read this commit.',
    });
    await render();
    queryAll('history-commit')[0].click();
    await settle();
    expect(query('history-open-error')?.getAttribute('role')).toBe('alert');
    expect(text('history-open-error')).toBe('Could not read this commit.');
  });

  it('stays quiet when a newer navigation superseded the open', async () => {
    openHistorical.mockResolvedValueOnce({ opened: false, error: null });
    await render();
    queryAll('history-commit')[0].click();
    await settle();
    expect(query('history-open-error')).toBeNull();
  });

  it('offers "Initial commit — open in editor" for a root commit instead of a comparison', async () => {
    const root = commit('0abcdef', 'chore: initial commit', {
      parentCount: 0,
      isRoot: true,
    });
    readLog.mockResolvedValue(sinceBase([C1, root]));
    await render();

    expect(queryAll('history-commit')).toHaveLength(1);
    const row = query('history-root-commit');
    expect(row?.tagName).not.toBe('BUTTON');
    expect(row?.textContent).toContain('Initial commit — open in editor');

    row
      ?.querySelector<HTMLButtonElement>('[data-testid="open-in-primary"]')
      ?.click();
    await settle();
    expect(openHistorical).not.toHaveBeenCalled();
    expect(launchers.openWorkspace).toHaveBeenCalledWith('vscode', '/ws/a');
  });

  it('labels a merge commit as compared with its first parent', async () => {
    const merge = commit('9f8e7d6', 'Merge branch main', { parentCount: 2 });
    readLog.mockResolvedValue(sinceBase([merge]));
    await render();
    const row = queryAll('history-commit')[0];
    expect(row.querySelector('[data-testid="history-merge"]')).not.toBeNull();
    expect(row.textContent).toContain('compared with its first parent');
    expect(row.getAttribute('title')).toContain('its first parent');
  });

  // -- Stashes -------------------------------------------------------------------

  it('lists stashes with ref, message, branch and a collapse toggle', async () => {
    await render();
    const entry = query('history-stash-entry');
    expect(entry?.textContent).toContain('stash@{0}');
    expect(entry?.textContent).toContain('wip: try approach B');
    expect(entry?.textContent).toContain('on feat/task-576');

    const toggle = query<HTMLButtonElement>('history-stashes-toggle');
    expect(toggle?.textContent).toContain('Stashes (1)');
    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    toggle?.click();
    await settle();
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows the stash empty state and reloads when the stash count moves', async () => {
    stash.entries.set([]);
    await render();
    expect(text('history-stash-empty')).toBe('No stashes.');
    expect(stash.loadList).toHaveBeenCalledTimes(1);

    stashCount.set(2);
    await settle();
    expect(stash.loadList).toHaveBeenCalledTimes(2);
  });

  it('applies and pops a stash directly', async () => {
    await render();
    query<HTMLButtonElement>('history-stash-apply')?.click();
    query<HTMLButtonElement>('history-stash-pop')?.click();
    expect(stash.mutate).toHaveBeenNthCalledWith(1, 'apply', STASH);
    expect(stash.mutate).toHaveBeenNthCalledWith(2, 'pop', STASH);
  });

  it('drops a stash only after the confirm dialog', async () => {
    await render();
    const drop = query<HTMLButtonElement>('history-stash-drop');
    expect(drop?.getAttribute('aria-label')).toBe('Drop stash@{0}');
    drop?.click();
    await settle();

    expect(stash.mutate).not.toHaveBeenCalled();
    const dialog = query('git-confirm-dialog');
    expect(dialog?.textContent).toContain('Drop stash@{0}?');

    query<HTMLButtonElement>('git-confirm-confirm')?.click();
    await settle();
    expect(stash.mutate).toHaveBeenCalledWith('drop', STASH);
    expect(document.activeElement).toBe(drop);
  });

  it('cancelling the drop dialog drops nothing', async () => {
    await render();
    query<HTMLButtonElement>('history-stash-drop')?.click();
    await settle();
    query<HTMLButtonElement>('git-confirm-cancel')?.click();
    await settle();
    expect(stash.mutate).not.toHaveBeenCalled();
    expect(query('git-confirm-dialog')).toBeNull();
  });

  it('drops nothing when the stash left the list while the dialog was open', async () => {
    await render();
    query<HTMLButtonElement>('history-stash-drop')?.click();
    await settle();
    stash.entries.set([{ ...STASH, hash: 'ffffffffffffffff' }]);
    await settle();
    query<HTMLButtonElement>('git-confirm-confirm')?.click();
    await settle();
    expect(stash.mutate).not.toHaveBeenCalled();
  });

  it('expands a stash and opens a file diff', async () => {
    await render();
    query<HTMLButtonElement>('history-stash-entry')?.click();
    expect(stash.select).toHaveBeenCalledWith(STASH);

    stash.selectedIndex.set(0);
    stash.files.set([{ path: 'src/a.ts', status: 'M' }]);
    await settle();
    expect(query('history-stash-entry')?.getAttribute('aria-expanded')).toBe(
      'true',
    );
    query<HTMLButtonElement>('history-stash-file')?.click();
    expect(stash.openFileDiff).toHaveBeenCalledWith({
      path: 'src/a.ts',
      status: 'M',
    });
  });

  it('disables stash controls while a stash action runs', async () => {
    stash.busy.set(true);
    await render();
    for (const id of [
      'history-stash-entry',
      'history-stash-apply',
      'history-stash-pop',
      'history-stash-drop',
    ]) {
      expect(query<HTMLButtonElement>(id)?.disabled).toBe(true);
    }
  });

  // -- Accessibility -------------------------------------------------------------

  it('has no axe violations with stashes, commits and a root commit showing', async () => {
    const root = commit('0abcdef', 'chore: initial commit', {
      parentCount: 0,
      isRoot: true,
    });
    const merge = commit('9f8e7d6', 'Merge branch main', { parentCount: 2 });
    readLog.mockResolvedValue(
      sinceBase([C1, merge, root], { truncated: true }),
    );
    stash.selectedIndex.set(0);
    stash.files.set([{ path: 'src/a.ts', status: 'M' }]);
    await render();

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
