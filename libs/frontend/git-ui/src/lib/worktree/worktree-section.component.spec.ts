/**
 * WorktreeSectionComponent specs — TASK_2026_385, Batch 2.4.
 *
 * The active-worktree highlight used to read `EditorService.activeWorkspacePath`,
 * a plain field on a service that does not move into `git-ui`. It now reads
 * `ElectronLayoutService.activeWorkspace()?.path`, which is a signal — so the
 * highlight tracks a workspace switch without any extra change detection nudge.
 * These specs pin that: which row carries the "active" badge is a function of
 * `activeWorkspace()`, and a null active workspace falls back to the main
 * worktree.
 */

import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { LucideAngularModule } from 'lucide-angular';
import {
  ElectronLayoutService,
  type WorkspaceFolder,
} from '@ptah-extension/core';
import type { GitWorktreeInfo } from '@ptah-extension/shared';
import { WorktreeService } from '../services/worktree.service';
import { WorktreeSectionComponent } from './worktree-section.component';

function worktree(
  path: string,
  branch: string,
  isMain: boolean,
): GitWorktreeInfo {
  return { path, branch, head: 'abc1234', isMain, isBare: false };
}

const MAIN = worktree('D:\\repos\\app', 'main', true);
const FEATURE = worktree('D:\\repos\\app-feature', 'feature/x', false);

describe('WorktreeSectionComponent — active highlight tracks ElectronLayoutService', () => {
  let fixture: ComponentFixture<WorktreeSectionComponent>;
  let activeWorkspace: ReturnType<typeof signal<WorkspaceFolder | null>>;

  beforeEach(async () => {
    activeWorkspace = signal<WorkspaceFolder | null>(null);

    const worktreeStub = {
      worktrees: signal<GitWorktreeInfo[]>([MAIN, FEATURE]),
      isLoading: signal(false),
      loadWorktrees: jest.fn(async () => undefined),
      addWorktree: jest.fn(async () => ({ success: true })),
      removeWorktree: jest.fn(async () => ({ success: true })),
    } as unknown as WorktreeService;

    const layoutStub = {
      activeWorkspace,
      addFolderByPath: jest.fn(async () => undefined),
    } as unknown as ElectronLayoutService;

    await TestBed.configureTestingModule({
      imports: [WorktreeSectionComponent, LucideAngularModule],
      providers: [
        { provide: WorktreeService, useValue: worktreeStub },
        { provide: ElectronLayoutService, useValue: layoutStub },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(WorktreeSectionComponent);
    fixture.detectChanges();

    // The section is collapsed by default; the rows only exist once expanded.
    const toggle = fixture.nativeElement.querySelector(
      'button[aria-label="Toggle worktrees section"]',
    ) as HTMLButtonElement;
    toggle.click();
    fixture.detectChanges();
  });

  /** The branch label of every row currently carrying the "active" badge. */
  function activeRowBranches(): string[] {
    const rows = Array.from(
      fixture.nativeElement.querySelectorAll('button[title^="Switch to "]'),
    ) as HTMLElement[];
    return rows
      .filter((row) => (row.textContent ?? '').includes('active'))
      .map((row) => row.getAttribute('title') ?? '');
  }

  it('marks the worktree whose path is the active workspace', () => {
    activeWorkspace.set({ path: FEATURE.path, name: 'app-feature' });
    fixture.detectChanges();

    expect(activeRowBranches()).toEqual([`Switch to ${FEATURE.path}`]);
  });

  it('moves the highlight when the active workspace changes', () => {
    activeWorkspace.set({ path: FEATURE.path, name: 'app-feature' });
    fixture.detectChanges();
    expect(activeRowBranches()).toEqual([`Switch to ${FEATURE.path}`]);

    activeWorkspace.set({ path: MAIN.path, name: 'app' });
    fixture.detectChanges();

    expect(activeRowBranches()).toEqual([`Switch to ${MAIN.path}`]);
  });

  it('matches a path that differs only by separator style or trailing slash', () => {
    activeWorkspace.set({ path: 'D:/repos/app-feature/', name: 'app-feature' });
    fixture.detectChanges();

    expect(activeRowBranches()).toEqual([`Switch to ${FEATURE.path}`]);
  });

  it('falls back to the main worktree when there is no active workspace', () => {
    activeWorkspace.set(null);
    fixture.detectChanges();

    expect(activeRowBranches()).toEqual([`Switch to ${MAIN.path}`]);
  });
});
