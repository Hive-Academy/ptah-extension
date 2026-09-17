import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EditorTarget } from '@ptah-extension/shared';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitDockHeaderComponent } from './git-dock-header.component';
import { ElectronLayoutService } from '@ptah-extension/core';
import { GitReviewService } from '../services/git-review.service';
import { GitStashService } from '../services/git-stash.service';

const kiro: EditorTarget = {
  id: 'kiro',
  displayName: 'Kiro',
  executablePath: 'kiro',
};

describe('GitDockHeaderComponent', () => {
  const gitStatus = {
    isGitRepo: signal(true),
    branchName: signal('main'),
    branch: signal({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
    }),
    activeWorkspacePath: signal('/ws/a'),
    refresh: jest.fn(async () => undefined),
  };
  const gitBranches = {
    currentBranch: signal('main'),
    localBranches: signal([
      { name: 'main', isCurrent: true },
      { name: 'feature', isCurrent: false },
    ]),
    remoteBranches: signal([]),
    recentBranches: signal([]),
    stashCount: signal(0),
    lastCommit: signal(null),
    remotes: signal([]),
    refreshRemotes: jest.fn(async () => undefined),
    checkout: jest.fn(async () => ({ success: true })),
    recordVisitedBranch: jest.fn(),
    push: jest.fn(async () => ({
      success: false,
      error: 'Push was rejected.',
    })),
    pull: jest.fn(async () => ({ success: true })),
    fetch: jest.fn(async () => ({ success: true })),
  };
  const stash = {
    entries: signal([]),
    listLoading: signal(false),
    selectedIndex: signal(null),
    files: signal([]),
    filesLoading: signal(false),
    busy: signal(false),
    error: signal(null),
    loadList: jest.fn(async () => undefined),
  };
  const launchers = {
    targets: signal<readonly EditorTarget[]>([kiro]),
    launchStatus: signal(null),
    openWorkspace: jest.fn(async () => false),
  };
  const reviewMode = signal<'working-tree' | 'branch-review'>('working-tree');
  const railCollapsed = signal(false);
  const layout = {
    gitRailCollapsed: railCollapsed.asReadonly(),
    toggleGitRail: jest.fn(() => railCollapsed.update((value) => !value)),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    gitStatus.activeWorkspacePath.set('/ws/a');
    reviewMode.set('working-tree');
    railCollapsed.set(false);
    gitStatus.branch.set({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 1,
      behind: 0,
    });
    TestBed.configureTestingModule({
      imports: [GitDockHeaderComponent],
      providers: [
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: EditorLauncherService, useValue: launchers },
        {
          provide: GitReviewService,
          useValue: { mode: reviewMode.asReadonly() },
        },
        { provide: ElectronLayoutService, useValue: layout },
        { provide: GitStashService, useValue: stash },
      ],
    });
  });

  it('toggles the working-tree rail with accessible expanded state', () => {
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    const toggle = fixture.nativeElement.querySelector(
      '[data-testid="git-rail-toggle"]',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(toggle.getAttribute('aria-label')).toBe('Hide source control');

    toggle.click();
    fixture.detectChanges();

    expect(layout.toggleGitRail).toHaveBeenCalledTimes(1);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.getAttribute('aria-label')).toBe('Show source control');
  });

  it('hides the rail toggle in historical review mode', () => {
    reviewMode.set('branch-review');
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="git-rail-toggle"]'),
    ).toBeNull();
  });

  it('mounts the branch picker and restores focus after Escape', () => {
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    const trigger = fixture.nativeElement.querySelector(
      '[data-testid="current-branch-button"]',
    ) as HTMLButtonElement;
    trigger.click();
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="branch-picker"]'),
    ).not.toBeNull();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(
      fixture.nativeElement.querySelector('[data-testid="branch-picker"]'),
    ).toBeNull();
    expect(document.activeElement).toBe(trigger);
  });

  it('routes the mounted workspace Open In control through the launcher', () => {
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="open-in-primary"]',
      ) as HTMLButtonElement
    ).click();
    expect(launchers.openWorkspace).toHaveBeenCalledWith('kiro', '/ws/a');
  });

  it('renders a push failure after a real button click', async () => {
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    (
      fixture.nativeElement.querySelector(
        '[data-testid="git-push-button"]',
      ) as HTMLButtonElement
    ).click();
    await fixture.whenStable();
    fixture.detectChanges();
    const status = fixture.nativeElement.querySelector(
      '[role="status"].text-error',
    ) as HTMLElement;
    expect(status.textContent).toContain('Push was rejected.');
    expect(status.className).toContain('text-error');
  });

  function query(fixture: { nativeElement: HTMLElement }, id: string) {
    return fixture.nativeElement.querySelector(
      `[data-testid="${id}"]`,
    ) as HTMLButtonElement;
  }

  it('always shows Pull and Push, with the counts moved off the branch button', () => {
    gitStatus.branch.set({
      branch: 'main',
      upstream: 'origin/main',
      ahead: 2,
      behind: 3,
    });
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    expect(query(fixture, 'git-pull-button').textContent).toContain('↓3');
    expect(query(fixture, 'git-push-button').textContent).toContain('↑2');
    expect(query(fixture, 'current-branch-button').textContent).not.toMatch(
      /[↑↓]/,
    );

    gitStatus.branch.set({
      branch: 'main',
      upstream: null as unknown as string,
      ahead: 0,
      behind: 0,
    });
    fixture.detectChanges();
    expect(query(fixture, 'git-pull-button').textContent).toContain('Pull');
    expect(query(fixture, 'git-push-button').textContent).toContain('Push');
    expect(query(fixture, 'git-pull-button').getAttribute('aria-label')).toBe(
      'Pull',
    );
    expect(query(fixture, 'git-push-button').getAttribute('aria-label')).toBe(
      'Push',
    );
  });

  it('pulls, disables every sync button while busy, then refreshes status', async () => {
    let finish: (value: { success: boolean }) => void = () => undefined;
    gitBranches.pull.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    query(fixture, 'git-pull-button').click();
    fixture.detectChanges();
    for (const id of ['git-pull-button', 'git-push-button', 'git-fetch-button'])
      expect(query(fixture, id).disabled).toBe(true);

    finish({ success: true });
    await fixture.whenStable();
    fixture.detectChanges();
    expect(gitStatus.refresh).toHaveBeenCalled();
    expect(query(fixture, 'git-pull-button').disabled).toBe(false);
    expect(fixture.nativeElement.textContent).toContain('Pull completed.');
  });

  it('fetches from the icon button', async () => {
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    query(fixture, 'git-fetch-button').click();
    await fixture.whenStable();
    expect(gitBranches.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not publish or refresh a sync result after the workspace changes', async () => {
    let finish: (value: { success: boolean }) => void = () => undefined;
    gitBranches.pull.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();

    query(fixture, 'git-pull-button').click();
    gitStatus.activeWorkspacePath.set('/ws/b');
    finish({ success: true });
    await fixture.whenStable();
    fixture.detectChanges();

    expect(gitStatus.refresh).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).not.toContain('Pull completed.');
  });

  it('opens the stash viewer from the stash button and restores focus on Escape', () => {
    gitBranches.stashCount.set(2);
    const fixture = TestBed.createComponent(GitDockHeaderComponent);
    fixture.detectChanges();
    const trigger = query(fixture, 'git-stash-button');
    expect(trigger.textContent).toContain('2');
    trigger.click();
    fixture.detectChanges();
    expect(query(fixture, 'stash-popover')).not.toBeNull();
    expect(stash.loadList).toHaveBeenCalled();

    document.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    fixture.detectChanges();
    expect(query(fixture, 'stash-popover')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    gitBranches.stashCount.set(0);
  });
});
