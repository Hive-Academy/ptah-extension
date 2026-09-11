import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { EditorTarget } from '@ptah-extension/shared';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStatusService } from '../services/git-status.service';
import { GitDockHeaderComponent } from './git-dock-header.component';

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

  beforeEach(() => {
    jest.clearAllMocks();
    TestBed.configureTestingModule({
      imports: [GitDockHeaderComponent],
      providers: [
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: EditorLauncherService, useValue: launchers },
      ],
    });
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
