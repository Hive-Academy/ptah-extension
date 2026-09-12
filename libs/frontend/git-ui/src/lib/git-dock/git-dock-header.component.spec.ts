import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EditorTarget } from '@ptah-extension/shared';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitDockHeaderComponent } from './git-dock-header.component';
import { ElectronLayoutService } from '@ptah-extension/core';
import { GitReviewService } from '../services/git-review.service';

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
    reviewMode.set('working-tree');
    railCollapsed.set(false);
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
});
