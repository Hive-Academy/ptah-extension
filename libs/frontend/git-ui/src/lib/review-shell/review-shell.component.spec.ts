/**
 * ReviewShellComponent — unit specs with inert children (TASK_2026_576
 * Batch 43). Ports the `git-dock.component.spec.ts` cases that still apply to
 * the shell (arming, RC3 status states, re-read keeps the body mounted, Open
 * In through the launcher) and covers what is new: the tablist, the spot
 * editor mode, stash-canvas registration, disk-change forwarding and the one
 * width observer.
 *
 * The header, the canvas and the spot editor are replaced at the module
 * boundary, so the `@defer` blocks resolve to the stand-ins.
 */

import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
  signal,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { VSCodeService } from '@ptah-extension/core';
import { MESSAGE_TYPES } from '@ptah-extension/shared';
import type {
  EditorTarget,
  GitStatusUnavailableReason,
} from '@ptah-extension/shared';
import type { OpenInRequest } from '../open-in/open-in-button.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { FileContentChangesService } from '../services/file-content-changes.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitStashService } from '../services/git-stash.service';
import { GitStatusService } from '../services/git-status.service';
import { ReviewNavigationService } from '../services/review-navigation.service';
import type { FileViewOpenRequest } from '../types/diff-tab.types';
import type { ReviewShellComponent as ShellType } from './review-shell.component';

/** Loaded after the module mocks below are registered. */
let ReviewShellComponent: typeof ShellType;

@Component({
  selector: 'ptah-git-dock-header',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class MockGitDockHeader {}

@Component({
  selector: 'ptah-review-canvas',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-canvas"></div>`,
})
class MockReviewCanvas {
  readonly stacked = input(false);
}

@Component({
  selector: 'ptah-spot-editor',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<button type="button" data-testid="mock-spot-back">Back</button>`,
})
class MockSpotEditor {
  readonly request = input.required<FileViewOpenRequest>();
  readonly startEditable = input(false);
  readonly editorTargets = input<readonly EditorTarget[]>([]);
  readonly backToReview = output<void>();
  readonly openExternal = output<OpenInRequest>();
  readonly notifyDiskChange = jest.fn();
  readonly confirmLeave = jest.fn<boolean | Promise<boolean>, []>(() => true);
}

@Component({
  selector: 'ptah-commit-composer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<div data-testid="mock-composer"></div>`,
})
class MockCommitComposer {}

jest.mock('../commit/commit-composer.component', () => ({
  CommitComposerComponent: MockCommitComposer,
}));
jest.mock('../git-dock/git-dock-header.component', () => ({
  GitDockHeaderComponent: MockGitDockHeader,
}));
jest.mock('../review-canvas/review-canvas.component', () => ({
  ReviewCanvasComponent: MockReviewCanvas,
}));
jest.mock('../spot-editor/spot-editor.component', () => ({
  SpotEditorComponent: MockSpotEditor,
}));

/** A deterministic `ResizeObserver`: tests report sizes by hand. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed: Element[] = [];
  disconnected = false;

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(element: Element): void {
    this.observed.push(element);
  }

  unobserve(): void {
    // Not used by the shell.
  }

  disconnect(): void {
    this.disconnected = true;
  }

  resize(width: number): void {
    this.callback(
      [{ contentRect: { width } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

function makeGitStatus() {
  return {
    startListening: jest.fn(),
    stopListening: jest.fn(),
    activeWorkspacePath: signal<string | null>('/ws/a'),
    isGitRepo: signal(true),
    isLoading: signal(false),
    statusUnavailable: signal<GitStatusUnavailableReason | null>(null),
    staleReason: signal<GitStatusUnavailableReason | null>(null),
    changedFileCount: signal(3),
    stagedCount: signal(2),
  };
}

describe('ReviewShellComponent', () => {
  beforeAll(async () => {
    ({ ReviewShellComponent } = await import('./review-shell.component'));
  });

  let gitStatus: ReturnType<typeof makeGitStatus>;
  let gitBranches: {
    startListening: jest.Mock;
    stopListening: jest.Mock;
    refreshBranches: jest.Mock;
  };
  let launchers: {
    targets: ReturnType<typeof signal<readonly EditorTarget[]>>;
    detect: jest.Mock;
    openLinkedFile: jest.Mock;
  };
  let releaseStash: jest.Mock;
  let stash: { registerReviewCanvas: jest.Mock };
  let navigation: ReviewNavigationService;

  beforeEach(() => {
    FakeResizeObserver.instances = [];
    (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
      FakeResizeObserver;

    gitStatus = makeGitStatus();
    gitBranches = {
      startListening: jest.fn(),
      stopListening: jest.fn(),
      refreshBranches: jest.fn(async () => undefined),
    };
    launchers = {
      targets: signal<readonly EditorTarget[]>([]),
      detect: jest.fn(async () => undefined),
      openLinkedFile: jest.fn(async () => true),
    };
    releaseStash = jest.fn();
    stash = { registerReviewCanvas: jest.fn(() => releaseStash) };

    TestBed.configureTestingModule({
      imports: [ReviewShellComponent],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitBranchesService, useValue: gitBranches },
        { provide: EditorLauncherService, useValue: launchers },
        { provide: GitStashService, useValue: stash },
      ],
    });
    navigation = TestBed.inject(ReviewNavigationService);
  });

  afterEach(() => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
  });

  async function render(): Promise<ComponentFixture<ShellType>> {
    const fixture = TestBed.createComponent(ReviewShellComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  async function settle(fixture: ComponentFixture<unknown>): Promise<void> {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  function canvas(fixture: ComponentFixture<unknown>): MockReviewCanvas | null {
    return (
      (fixture.debugElement.query(By.directive(MockReviewCanvas))
        ?.componentInstance as MockReviewCanvas | undefined) ?? null
    );
  }

  function spotEditor(
    fixture: ComponentFixture<unknown>,
  ): MockSpotEditor | null {
    return (
      (fixture.debugElement.query(By.directive(MockSpotEditor))
        ?.componentInstance as MockSpotEditor | undefined) ?? null
    );
  }

  function text(fixture: ComponentFixture<unknown>): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function query(
    fixture: ComponentFixture<unknown>,
    selector: string,
  ): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(selector);
  }

  // -- Arming (ported from git-dock.component.spec.ts) ----------------------

  it('arms status and branches, reads branches and detects editors on construction', () => {
    TestBed.createComponent(ReviewShellComponent);

    expect(gitStatus.startListening).toHaveBeenCalledTimes(1);
    expect(gitBranches.startListening).toHaveBeenCalledTimes(1);
    expect(gitBranches.refreshBranches).toHaveBeenCalledTimes(1);
    expect(launchers.detect).toHaveBeenCalledTimes(1);
  });

  it('disarms both services when destroyed', () => {
    const fixture = TestBed.createComponent(ReviewShellComponent);
    expect(gitStatus.stopListening).not.toHaveBeenCalled();

    fixture.destroy();

    expect(gitStatus.stopListening).toHaveBeenCalledTimes(1);
    expect(gitBranches.stopListening).toHaveBeenCalledTimes(1);
  });

  it('re-arms idempotently after a prior destroy', () => {
    TestBed.createComponent(ReviewShellComponent).destroy();
    TestBed.createComponent(ReviewShellComponent);

    expect(gitStatus.startListening).toHaveBeenCalledTimes(2);
    expect(gitBranches.startListening).toHaveBeenCalledTimes(2);
  });

  // -- Stash routing (Batch 37) ---------------------------------------------

  it('registers as the stash review canvas while mounted and releases on destroy', () => {
    const fixture = TestBed.createComponent(ReviewShellComponent);
    expect(stash.registerReviewCanvas).toHaveBeenCalledTimes(1);
    expect(releaseStash).not.toHaveBeenCalled();

    fixture.destroy();

    expect(releaseStash).toHaveBeenCalledTimes(1);
  });

  // -- RC3 states (ported) ---------------------------------------------------

  it('shows "Loading repository…" only while nothing has been read', async () => {
    gitStatus.isGitRepo.set(false);
    gitStatus.isLoading.set(true);

    const fixture = await render();

    expect(
      query(fixture, '[data-testid="review-shell-loading"]'),
    ).not.toBeNull();
    expect(text(fixture)).toContain('Loading repository…');
    expect(canvas(fixture)).toBeNull();
    expect(query(fixture, '[role="tablist"]')).toBeNull();
  });

  it('never calls a failed first read "not a Git repository"', async () => {
    gitStatus.isGitRepo.set(false);
    gitStatus.statusUnavailable.set('error');

    const fixture = await render();
    const notice = query(
      fixture,
      '[data-testid="review-shell-status-unavailable"]',
    );

    expect(text(fixture)).not.toContain('not a Git repository');
    expect(notice?.getAttribute('role')).toBe('status');
    expect(notice?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Git status is unavailable (git reported an error).',
    );
    expect(canvas(fixture)).toBeNull();
  });

  it('says "not a Git repository" only for a readable result without a repo', async () => {
    gitStatus.isGitRepo.set(false);

    const fixture = await render();

    expect(text(fixture)).toContain(
      'The active workspace is not a Git repository.',
    );
    expect(
      query(fixture, '[data-testid="review-shell-status-unavailable"]'),
    ).toBeNull();
  });

  it('keeps the canvas and marks the changes stale when a re-read fails after a good one', async () => {
    gitStatus.statusUnavailable.set('timeout');
    gitStatus.staleReason.set('timeout');

    const fixture = await render();
    const stale = query(fixture, '[data-testid="review-shell-stale"]');

    expect(canvas(fixture)).not.toBeNull();
    expect(stale?.getAttribute('role')).toBe('status');
    expect(stale?.textContent?.replace(/\s+/g, ' ').trim()).toBe(
      'Git status is unavailable (git timed out) — showing the last known changes.',
    );
    expect(text(fixture)).not.toContain('not a Git repository');
  });

  it('shows no stale notice for a fresh read', async () => {
    const fixture = await render();

    expect(query(fixture, '[data-testid="review-shell-stale"]')).toBeNull();
  });

  it('keeps the same canvas instance mounted while a status re-read is loading', async () => {
    // TASK_2026_576 B7: a mutation's own refresh flips isLoading(); unmounting
    // the tab body there would drop its state mid-operation.
    const fixture = await render();
    const before = canvas(fixture);
    expect(before).not.toBeNull();

    gitStatus.isLoading.set(true);
    await settle(fixture);
    expect(canvas(fixture)).toBe(before);

    gitStatus.isLoading.set(false);
    await settle(fixture);
    expect(canvas(fixture)).toBe(before);
  });

  // -- Tabs -----------------------------------------------------------------

  it('renders the Changes and Commit tabs with their counts as an accessible tablist', async () => {
    const fixture = await render();
    const tablist = query(fixture, '[role="tablist"]');
    const tabs = [
      ...(tablist?.querySelectorAll<HTMLButtonElement>('[role="tab"]') ?? []),
    ];
    const panel = query(fixture, '[role="tabpanel"]');

    expect(tablist?.getAttribute('aria-label')).toBe('Review');
    expect(tabs).toHaveLength(2);
    expect(tabs[0].textContent?.replace(/\s+/g, '')).toBe('Changes3');
    expect(tabs[0].getAttribute('aria-label')).toBe('Changes, 3 changed files');
    expect(tabs[0].getAttribute('aria-selected')).toBe('true');
    expect(tabs[0].getAttribute('tabindex')).toBe('0');
    expect(tabs[0].getAttribute('aria-controls')).toBe(panel?.id);
    expect(tabs[1].textContent?.replace(/\s+/g, '')).toBe('Commit2');
    expect(tabs[1].getAttribute('aria-label')).toBe('Commit, 2 staged files');
    expect(tabs[1].getAttribute('aria-selected')).toBe('false');
    expect(tabs[1].getAttribute('tabindex')).toBe('-1');
    expect(panel?.getAttribute('aria-labelledby')).toBe(tabs[0].id);
    expect(panel?.contains(query(fixture, 'ptah-review-canvas'))).toBe(true);
  });

  it('says "1 staged file" in the singular', async () => {
    gitStatus.stagedCount.set(1);

    const fixture = await render();

    expect(
      query(fixture, '[data-tab-id="commit"]')?.getAttribute('aria-label'),
    ).toBe('Commit, 1 staged file');
  });

  it('moves focus and selection to the Commit tab with the arrow keys', async () => {
    const fixture = await render();
    const changes = query(fixture, '[data-tab-id="changes"]') as HTMLElement;
    changes.focus();

    changes.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }),
    );
    await settle(fixture);

    const commit = query(fixture, '[data-tab-id="commit"]');
    expect(document.activeElement).toBe(commit);
    expect(commit?.getAttribute('aria-selected')).toBe('true');
    expect(navigation.current().tab).toBe('commit');
  });

  // -- Commit tab (Batch 48) --------------------------------------------------

  function composer(
    fixture: ComponentFixture<unknown>,
  ): MockCommitComposer | null {
    return (
      (fixture.debugElement.query(By.directive(MockCommitComposer))
        ?.componentInstance as MockCommitComposer | undefined) ?? null
    );
  }

  it('does not load the commit composer until the Commit tab shows', async () => {
    const fixture = await render();

    expect(composer(fixture)).toBeNull();
    expect(
      query(fixture, '[data-testid="review-shell-commit-body"]')?.classList,
    ).toContain('hidden');
  });

  it('shows the composer in the tab panel when Commit is picked', async () => {
    const fixture = await render();

    (query(fixture, '[data-tab-id="commit"]') as HTMLButtonElement).click();
    await settle(fixture);

    const panel = query(fixture, '[role="tabpanel"]');
    const body = query(fixture, '[data-testid="review-shell-commit-body"]');
    expect(navigation.current().tab).toBe('commit');
    expect(composer(fixture)).not.toBeNull();
    expect(panel?.contains(query(fixture, 'ptah-commit-composer'))).toBe(true);
    expect(panel?.getAttribute('aria-labelledby')).toBe(
      query(fixture, '[data-tab-id="commit"]')?.id,
    );
    expect(body?.classList).toContain('flex');
    expect(body?.classList).not.toContain('hidden');
    expect(
      query(fixture, '[data-testid="review-shell-changes-body"]')?.classList,
    ).toContain('hidden');
  });

  it('keeps both bodies mounted across tab switches', async () => {
    const fixture = await render();
    const before = canvas(fixture);

    navigation.selectTab('commit');
    await settle(fixture);
    const mountedComposer = composer(fixture);
    expect(canvas(fixture)).toBe(before);

    navigation.selectTab('changes');
    await settle(fixture);

    expect(canvas(fixture)).toBe(before);
    expect(composer(fixture)).toBe(mountedComposer);
    expect(
      query(fixture, '[data-testid="review-shell-commit-body"]')?.classList,
    ).toContain('hidden');
    expect(
      query(fixture, '[data-testid="review-shell-changes-body"]')?.classList,
    ).toContain('flex');
  });

  it('shows the Changes tab when navigation names a tab the shell does not have yet', async () => {
    navigation.selectTab('history');

    const fixture = await render();

    expect(query(fixture, '[role="tab"]')?.getAttribute('aria-selected')).toBe(
      'true',
    );
    expect(canvas(fixture)).not.toBeNull();
  });

  it('drops the count outside a repository', async () => {
    gitStatus.isGitRepo.set(false);
    navigation.openFile('/ws/a/readme.md');

    const fixture = await render();
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll(
      '[role="tab"]',
    );

    expect(tabs[0]?.textContent?.trim()).toBe('Changes');
    expect(tabs[0]?.hasAttribute('aria-label')).toBe(false);
    expect(tabs[1]?.textContent?.trim()).toBe('Commit');
    expect(tabs[1]?.hasAttribute('aria-label')).toBe(false);
  });

  // -- Spot editor mode (design-spec §3.3) -----------------------------------

  it('swaps the canvas for the spot editor on a file target, read-only by default', async () => {
    const fixture = await render();

    navigation.openFile('/ws/a/src/a.ts', 12);
    await settle(fixture);

    const editor = spotEditor(fixture);
    expect(canvas(fixture)).toBeNull();
    expect(editor?.request()).toEqual({ path: '/ws/a/src/a.ts', line: 12 });
    expect(editor?.startEditable()).toBe(false);
  });

  it('opens the spot editor editable for the canvas Edit action', async () => {
    navigation.openFile('/ws/a/src/a.ts', undefined, { editable: true });

    const fixture = await render();

    expect(spotEditor(fixture)?.startEditable()).toBe(true);
  });

  it('hands the spot editor the same request object until a new navigation', async () => {
    navigation.openFile('/ws/a/src/a.ts');
    const fixture = await render();
    const first = spotEditor(fixture)?.request();

    gitStatus.changedFileCount.set(4);
    await settle(fixture);
    expect(spotEditor(fixture)?.request()).toBe(first);

    navigation.openFile('/ws/a/src/a.ts');
    await settle(fixture);
    expect(spotEditor(fixture)?.request()).not.toBe(first);
  });

  it('opens a linked file outside a repository', async () => {
    gitStatus.isGitRepo.set(false);
    navigation.openFile('/ws/a/readme.md');

    const fixture = await render();

    expect(spotEditor(fixture)).not.toBeNull();
    expect(text(fixture)).not.toContain('not a Git repository');
  });

  it('returns to the canvas on Back to review and keeps focus inside the panel', async () => {
    navigation.selectComparison('staged');
    navigation.openFile('/ws/a/src/a.ts');
    const fixture = await render();
    (
      query(fixture, '[data-testid="mock-spot-back"]') as HTMLButtonElement
    ).focus();

    spotEditor(fixture)?.backToReview.emit();
    await settle(fixture);

    expect(navigation.current().target).toEqual({ kind: 'none' });
    expect(navigation.current().scope).toEqual({ kind: 'staged' });
    expect(spotEditor(fixture)).toBeNull();
    expect(canvas(fixture)).not.toBeNull();
    expect(document.activeElement).toBe(query(fixture, '[role="tabpanel"]'));
  });

  it('routes the spot editor Open-in request through the launcher', async () => {
    navigation.openFile('/outside/a.ts');
    const fixture = await render();

    spotEditor(fixture)?.openExternal.emit({
      target: 'kiro',
      path: '/outside/a.ts',
    });

    expect(launchers.openLinkedFile).toHaveBeenCalledWith({
      target: 'kiro',
      path: '/outside/a.ts',
    });
  });

  it('passes the detected editor targets to the spot editor', async () => {
    const targets: EditorTarget[] = [
      { id: 'kiro', displayName: 'Kiro', executablePath: 'kiro' },
    ] as EditorTarget[];
    launchers.targets.set(targets);
    navigation.openFile('/ws/a/src/a.ts');

    const fixture = await render();

    expect(spotEditor(fixture)?.editorTargets()).toBe(targets);
  });

  // -- Unsaved edits (SER-B2) ------------------------------------------------

  it('asks the spot editor before a navigation replaces it; Keep editing keeps it mounted', async () => {
    navigation.openFile('/ws/a/src/a.ts', undefined, { editable: true });
    const fixture = await render();
    const editor = spotEditor(fixture);
    editor?.confirmLeave.mockReturnValue(Promise.resolve(false));

    navigation.openChangeSet({
      workspaceRoot: '/ws/a',
      files: [{ path: 'src/a.ts' }],
    });
    await settle(fixture);

    expect(editor?.confirmLeave).toHaveBeenCalledTimes(1);
    expect(navigation.current().target.kind).toBe('file');
    expect(spotEditor(fixture)).toBe(editor);
    expect(canvas(fixture)).toBeNull();
  });

  it('Discard lets the navigation replace the spot editor', async () => {
    navigation.openFile('/ws/a/src/a.ts', undefined, { editable: true });
    const fixture = await render();
    const editor = spotEditor(fixture);
    editor?.confirmLeave.mockReturnValue(Promise.resolve(true));

    navigation.selectComparison('staged');
    // The answer lands the navigation; the canvas `@defer` then resolves.
    await settle(fixture);
    await settle(fixture);

    expect(editor?.confirmLeave).toHaveBeenCalledTimes(1);
    expect(navigation.current().scope).toEqual({ kind: 'staged' });
    expect(spotEditor(fixture)).toBeNull();
    expect(canvas(fixture)).not.toBeNull();
  });

  it('Back to review is not asked twice: the editor already asked', async () => {
    navigation.openFile('/ws/a/src/a.ts');
    const fixture = await render();
    const editor = spotEditor(fixture);

    editor?.backToReview.emit();
    await settle(fixture);

    expect(editor?.confirmLeave).not.toHaveBeenCalled();
    expect(canvas(fixture)).not.toBeNull();
  });

  it('releases the leave guard on destroy', async () => {
    navigation.openFile('/ws/a/src/a.ts');
    const fixture = await render();
    const editor = spotEditor(fixture);
    editor?.confirmLeave.mockReturnValue(false);
    fixture.destroy();

    navigation.selectComparison('staged');

    expect(editor?.confirmLeave).not.toHaveBeenCalled();
    expect(navigation.current().scope).toEqual({ kind: 'staged' });
  });

  // -- Disk changes (Batch 42) -----------------------------------------------

  function pushDiskChange(filePaths: string[], truncated: boolean): void {
    TestBed.inject(FileContentChangesService).handleMessage({
      type: MESSAGE_TYPES.FILE_CONTENT_CHANGED,
      payload: { filePaths, truncated },
    });
  }

  it('forwards file:content-changed batches to the open spot editor', async () => {
    navigation.openFile('/ws/a/src/a.ts');
    const fixture = await render();
    const editor = spotEditor(fixture);

    pushDiskChange(['/ws/a/src/a.ts'], false);
    pushDiskChange([], true);

    expect(editor?.notifyDiskChange.mock.calls).toEqual([
      [['/ws/a/src/a.ts'], false],
      [[], true],
    ]);
  });

  it('ignores disk changes while the canvas shows, and after destroy', async () => {
    const fixture = await render();
    expect(() => pushDiskChange(['/ws/a/src/a.ts'], false)).not.toThrow();

    navigation.openFile('/ws/a/src/a.ts');
    await settle(fixture);
    const editor = spotEditor(fixture);
    fixture.destroy();
    pushDiskChange(['/ws/a/src/a.ts'], false);

    expect(editor?.notifyDiskChange).not.toHaveBeenCalled();
  });

  // -- Width (design-spec §6.1a) --------------------------------------------

  it('stacks the canvas below 520 px through one host ResizeObserver', async () => {
    const fixture = await render();

    expect(FakeResizeObserver.instances).toHaveLength(1);
    const observer = FakeResizeObserver.instances[0];
    expect(observer.observed).toEqual([fixture.nativeElement]);
    expect(canvas(fixture)?.stacked()).toBe(false);

    observer.resize(519);
    await settle(fixture);
    expect(canvas(fixture)?.stacked()).toBe(true);

    // A hidden dock measures 0: the last real layout stays.
    observer.resize(0);
    await settle(fixture);
    expect(canvas(fixture)?.stacked()).toBe(true);

    observer.resize(520);
    await settle(fixture);
    expect(canvas(fixture)?.stacked()).toBe(false);
  });

  it('keeps one observer across body swaps and disconnects it on destroy', async () => {
    const fixture = await render();

    navigation.openFile('/ws/a/src/a.ts');
    await settle(fixture);
    navigation.backToReview();
    await settle(fixture);

    expect(FakeResizeObserver.instances).toHaveLength(1);
    fixture.destroy();
    expect(FakeResizeObserver.instances[0].disconnected).toBe(true);
  });

  it('renders without ResizeObserver', async () => {
    delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;

    const fixture = await render();

    expect(canvas(fixture)?.stacked()).toBe(false);
    expect(() => fixture.destroy()).not.toThrow();
  });
});
