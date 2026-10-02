import axe from 'axe-core';
import { NgTemplateOutlet } from '@angular/common';
import {
  Component,
  input,
  signal,
  type TemplateRef,
  type Type,
} from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { ElectronLayoutService, VSCodeService } from '@ptah-extension/core';
import type {
  GitFileStatus,
  GitHunkRef,
  GitReviewChangesResult,
  GitReviewFile,
} from '@ptah-extension/shared';
import type { PierreHunkToolbarContext } from '../renderer/pierre-diff-host.component';
import { EditorLauncherService } from '../services/editor-launcher.service';
import { GitBranchesService } from '../services/git-branches.service';
import { GitReviewService } from '../services/git-review.service';
import { GitStatusService } from '../services/git-status.service';
import { ReviewCommentDraftStore } from '../services/review-comment-draft.store';
import {
  ReviewDiffService,
  reviewDiffKey,
  type ReviewDiffEntry,
  type ReviewDiffRequest,
} from '../services/review-diff.service';
import {
  ReviewNavigationService,
  type ReviewNavigation,
} from '../services/review-navigation.service';
import { SourceControlService } from '../services/source-control.service';
import type { ReviewCanvasComponent as CanvasType } from './review-canvas.component';
import type { FileDiffSectionComponent as SectionType } from './file-diff-section.component';

/** Stand-in for Pierre's host (ESM-only, lazy in the app). */
@Component({
  selector: 'ptah-pierre-diff-host',
  standalone: true,
  imports: [NgTemplateOutlet],
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

jest.mock('../renderer/pierre-diff-host.component', () => ({
  PierreDiffHostComponent: MockPierreDiffHost,
}));

jest.mock('@ptah-extension/core', () => {
  const actual = jest.requireActual<Record<string, unknown>>(
    '@ptah-extension/core',
  );
  return {
    ...actual,
    rpcCall: jest.fn(async () => ({ success: false, error: 'not in tests' })),
  };
});

/** A deterministic `IntersectionObserver`: tests push entries by hand. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(
    readonly callback: IntersectionObserverCallback,
    readonly options: IntersectionObserverInit,
  ) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element): void {
    this.observed.add(element);
  }
  unobserve(element: Element): void {
    this.observed.delete(element);
  }
  disconnect(): void {
    this.disconnected = true;
    this.observed.clear();
  }
  takeRecords(): IntersectionObserverEntry[] {
    return [];
  }
  /** Report `elements` as entering (or leaving) the window. */
  emit(
    elements: readonly Element[],
    isIntersecting: boolean,
    height = 0,
  ): void {
    this.callback(
      elements.map(
        (target) =>
          ({
            target,
            isIntersecting,
            boundingClientRect: { height } as DOMRectReadOnly,
          }) as IntersectionObserverEntry,
      ),
      this as unknown as IntersectionObserver,
    );
  }
}

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

const STATUS: GitFileStatus[] = [
  { path: 'src/app.ts', status: 'M', staged: true, additions: 4, deletions: 2 },
  {
    path: 'src/util.ts',
    status: 'M',
    staged: false,
    additions: 3,
    deletions: 1,
  },
  {
    path: 'src/new-name.ts',
    origPath: 'src/old-name.ts',
    status: 'R',
    staged: false,
    additions: 1,
    deletions: 1,
  },
  {
    path: 'src/merge.ts',
    status: 'U',
    staged: false,
    conflict: { kind: 'both-modified' },
  },
  { path: 'logo.png', status: 'M', staged: false, binary: true },
  { path: 'scratch/', status: '??', staged: false, isDirectory: true },
];

const REVIEW_FILES: GitReviewFile[] = [
  { path: 'README.md', status: 'M', additions: 2, deletions: 0, binary: false },
  {
    path: 'icon.bin',
    status: 'A',
    additions: null,
    deletions: null,
    binary: true,
  },
];

describe('ReviewCanvasComponent', () => {
  let Canvas: Type<CanvasType>;
  let Section: Type<SectionType>;
  let fixture: ComponentFixture<CanvasType>;

  const navigation = signal<ReviewNavigation>({
    seq: 0,
    tab: 'changes',
    scope: { kind: 'worktree' },
    target: { kind: 'none' },
  });
  const navigationService = {
    current: navigation.asReadonly(),
    selectComparison: jest.fn(),
    openFile: jest.fn(),
  };

  const statusFiles = signal<GitFileStatus[]>(STATUS);
  const statusUnavailable = signal(false);
  const gitStatus = {
    files: statusFiles.asReadonly(),
    activeWorkspacePath: signal<string | null>('/ws').asReadonly(),
    isStatusUnavailable: statusUnavailable.asReadonly(),
    refresh: jest.fn(async () => undefined),
  };

  const reviewResult = signal<GitReviewChangesResult | null>(null);
  const reviewError = signal<string | null>(null);
  const reviewLoading = signal(false);
  const review = {
    base: signal('main').asReadonly(),
    head: signal('HEAD').asReadonly(),
    result: reviewResult.asReadonly(),
    files: signal<GitReviewFile[]>(REVIEW_FILES).asReadonly(),
    error: reviewError.asReadonly(),
    loading: reviewLoading.asReadonly(),
    setMode: jest.fn(),
    setBase: jest.fn(),
    setHead: jest.fn(),
    isViewed: () => false,
    toggleViewed: jest.fn(),
  };

  const entries = signal<ReadonlyMap<string, ReviewDiffEntry>>(new Map());
  const reviewDiff = {
    entries: entries.asReadonly(),
    mount: jest.fn((request: ReviewDiffRequest) => reviewDiffKey(request)),
    unmount: jest.fn(),
    retry: jest.fn(async () => undefined),
    applyHunks: jest.fn(),
  };

  const launchers = {
    targets: signal([]).asReadonly(),
    detect: jest.fn(async () => undefined),
    openFile: jest.fn(async () => true),
  };

  const layout = {
    gitRailWidth: signal(256).asReadonly(),
    gitRailCollapsed: signal(false).asReadonly(),
    setGitRailWidth: jest.fn(),
    commitGitRailWidth: jest.fn(),
  };

  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const sections = (): HTMLElement[] =>
    Array.from(host().querySelectorAll<HTMLElement>('ptah-file-diff-section'));
  const sectionPaths = (): string[] =>
    sections().map(
      (section) =>
        section
          .querySelector('[data-testid="file-section-path"]')
          ?.textContent?.trim() ?? '',
    );
  const sectionFor = (path: string): HTMLElement => {
    const found = sections().find((section) =>
      section
        .querySelector('[data-testid="file-section-path"]')
        ?.textContent?.trim()
        .startsWith(path),
    );
    if (!found) throw new Error(`no section ${path}`);
    return found;
  };
  const observer = (): FakeIntersectionObserver => {
    const last = FakeIntersectionObserver.instances.at(-1);
    if (!last) throw new Error('no observer');
    return last;
  };
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const sectionInstances = (): SectionType[] =>
    fixture.debugElement
      .queryAll(By.directive(Section))
      .map((debug) => debug.componentInstance as SectionType);

  async function create(): Promise<void> {
    fixture = TestBed.createComponent(Canvas);
    await settle();
  }

  function navigate(next: Omit<ReviewNavigation, 'seq' | 'tab'>): void {
    navigation.set({
      seq: navigation().seq + 1,
      tab: 'changes',
      ...next,
    });
  }

  beforeAll(async () => {
    ({ ReviewCanvasComponent: Canvas } =
      await import('./review-canvas.component'));
    ({ FileDiffSectionComponent: Section } =
      await import('./file-diff-section.component'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    FakeIntersectionObserver.instances = [];
    (globalThis as { IntersectionObserver?: unknown }).IntersectionObserver =
      FakeIntersectionObserver;
    navigation.set({
      seq: 0,
      tab: 'changes',
      scope: { kind: 'worktree' },
      target: { kind: 'none' },
    });
    statusFiles.set(STATUS);
    statusUnavailable.set(false);
    reviewResult.set(null);
    reviewError.set(null);
    reviewLoading.set(false);
    entries.set(new Map());
    TestBed.configureTestingModule({
      imports: [Canvas],
      providers: [
        { provide: VSCodeService, useValue: {} },
        { provide: ElectronLayoutService, useValue: layout },
        { provide: ReviewNavigationService, useValue: navigationService },
        { provide: GitStatusService, useValue: gitStatus },
        { provide: GitReviewService, useValue: review },
        {
          provide: GitBranchesService,
          useValue: { localBranches: signal([]).asReadonly() },
        },
        { provide: SourceControlService, useValue: {} },
        { provide: ReviewDiffService, useValue: reviewDiff },
        { provide: EditorLauncherService, useValue: launchers },
      ],
    });
  });

  afterEach(() => {
    delete (globalThis as { IntersectionObserver?: unknown })
      .IntersectionObserver;
  });

  describe('file list', () => {
    it('lists every working-tree change, staged ones as staged diffs, without folders', async () => {
      await create();
      expect(sectionPaths()).toEqual([
        'src/app.ts',
        'src/util.ts',
        'src/new-name.ts',
        'src/merge.ts',
        'logo.png',
      ]);
      const files = sectionInstances().map((section) => section.file());
      expect(files[0].comparison).toBe('staged');
      expect(files[0].request?.comparison).toEqual({ kind: 'staged' });
      expect(files[1].comparison).toBe('worktree');
      expect(files[2].request).toEqual({
        comparison: { kind: 'worktree' },
        path: 'src/new-name.ts',
        origPath: 'src/old-name.ts',
      });
      expect(files[3].label).toBe('conflicted');
      expect(files[4].label).toBe('binary');
    });

    it('lists only staged files for the Staged comparison', async () => {
      navigate({ scope: { kind: 'staged' }, target: { kind: 'none' } });
      await create();
      expect(sectionPaths()).toEqual(['src/app.ts']);
    });

    it('narrows to a change set and sends its drafts to the owning session', async () => {
      navigate({
        scope: { kind: 'worktree' },
        target: {
          kind: 'change-set',
          workspaceRoot: '/ws',
          files: [{ path: 'src/util.ts' }, { path: 'src/old-name.ts' }],
          ownerSessionId: 'session-7',
        },
      });
      await create();
      expect(sectionPaths()).toEqual(['src/util.ts', 'src/new-name.ts']);
      expect(sectionInstances()[0].draftOwner()).toEqual({
        workspaceRoot: '/ws',
        ownerSessionId: 'session-7',
      });
    });

    it('reads a branch review between the merge base and head, read-only', async () => {
      reviewResult.set({
        success: true,
        base: { name: 'main', sha: 'aaa111' },
        head: { name: 'HEAD', sha: 'bbb222' },
        mergeBaseSha: 'ccc333',
        files: REVIEW_FILES,
        totals: { additions: 2, deletions: 0, binaryFiles: 1 },
      });
      navigate({ scope: { kind: 'branch' }, target: { kind: 'none' } });
      await create();
      const files = sectionInstances().map((section) => section.file());
      expect(files.map((file) => file.path)).toEqual(['README.md', 'icon.bin']);
      expect(files[0].comparison).toBe('branch');
      expect(files[0].request?.comparison).toEqual({
        kind: 'historical',
        base: { name: 'main', sha: 'ccc333' },
        head: { name: 'HEAD', sha: 'bbb222' },
      });
      expect(files[1].label).toBe('binary');
    });

    it('shows the branch review error and loading state', async () => {
      navigate({ scope: { kind: 'branch' }, target: { kind: 'none' } });
      reviewLoading.set(true);
      await create();
      expect(byTestId('review-canvas-message')?.textContent).toContain(
        'Loading the branch review',
      );
      reviewError.set('Unknown base branch.');
      await settle();
      const message = byTestId('review-canvas-message');
      expect(message?.textContent).toContain('Unknown base branch.');
      expect(message?.getAttribute('role')).toBe('alert');
    });

    it('lists a historical comparison from its own files', async () => {
      navigate({
        scope: {
          kind: 'historical',
          base: { name: 'abc^', sha: 'p1' },
          head: { name: 'abc', sha: 'h1' },
          label: 'abc1234',
          files: [REVIEW_FILES[0]],
        },
        target: { kind: 'none' },
      });
      await create();
      const [file] = sectionInstances().map((section) => section.file());
      expect(file.comparison).toBe('historical');
      expect(file.request?.comparison).toEqual({
        kind: 'historical',
        base: { name: 'abc^', sha: 'p1' },
        head: { name: 'abc', sha: 'h1' },
      });
    });

    it('filters the list by path and totals what remains', async () => {
      await create();
      const filter = byTestId<HTMLInputElement>('comparison-filter');
      if (!filter) throw new Error('no filter');
      filter.value = 'UTIL';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(sectionPaths()).toEqual(['src/util.ts']);
      expect(byTestId('comparison-totals')?.textContent).toContain(
        '1 file changed, 3 additions, 1 deletions',
      );
      filter.value = 'nothing-here';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(byTestId('review-canvas-message')?.textContent).toContain(
        'No files match the filter.',
      );
    });

    it('says so when the working tree is clean', async () => {
      statusFiles.set([]);
      await create();
      expect(byTestId('review-canvas-message')?.textContent).toContain(
        'No changes in the working tree.',
      );
    });

    it('reports an unreadable status as an error, not as a clean tree', async () => {
      statusFiles.set([]);
      statusUnavailable.set(true);
      await create();
      const message = byTestId('review-canvas-message');
      expect(message?.getAttribute('role')).toBe('alert');
      expect(message?.textContent).toContain('could not be read');
    });

    it('passes the layout from Split / Unified to every section', async () => {
      await create();
      expect(sectionInstances()[0].diffStyle()).toBe('split');
      byTestId<HTMLButtonElement>('layout-unified')?.click();
      await settle();
      expect(
        sectionInstances().every(
          (section) => section.diffStyle() === 'unified',
        ),
      ).toBe(true);
    });
  });

  describe('window (A9)', () => {
    it('observes every section with ONE observer, rooted on the list, one viewport of margin', async () => {
      await create();
      expect(FakeIntersectionObserver.instances).toHaveLength(1);
      const io = observer();
      expect(io.options.root).toBe(byTestId('review-canvas-list'));
      expect(io.options.rootMargin).toBe('100% 0px');
      expect(io.observed.size).toBe(5);
    });

    it('mounts only near sections, and caches the measured height on leave', async () => {
      await create();
      expect(reviewDiff.mount).not.toHaveBeenCalled();
      const util = sectionFor('src/util.ts');
      observer().emit([util], true);
      await settle();
      expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
      expect(reviewDiff.mount).toHaveBeenCalledWith({
        comparison: { kind: 'worktree' },
        path: 'src/util.ts',
      });
      const estimated = Number.parseFloat(util.style.minHeight);
      expect(estimated).toBeGreaterThan(0);

      observer().emit([util], false, 1234);
      await settle();
      expect(reviewDiff.unmount).toHaveBeenCalledTimes(1);
      expect(util.style.minHeight).toBe('1234px');
    });

    it('never reads a labelled row even when near', async () => {
      await create();
      observer().emit(
        [sectionFor('src/merge.ts'), sectionFor('logo.png')],
        true,
      );
      await settle();
      expect(reviewDiff.mount).not.toHaveBeenCalled();
    });

    it('stops observing filtered-out sections and disconnects on destroy', async () => {
      await create();
      const io = observer();
      const filter = byTestId<HTMLInputElement>('comparison-filter');
      if (!filter) throw new Error('no filter');
      filter.value = 'app';
      filter.dispatchEvent(new Event('input'));
      await settle();
      expect(io.observed.size).toBe(1);
      fixture.destroy();
      expect(io.disconnected).toBe(true);
    });

    it('treats every section as near where IntersectionObserver is missing', async () => {
      delete (globalThis as { IntersectionObserver?: unknown })
        .IntersectionObserver;
      await create();
      // Five sections, two labelled: three reads.
      expect(reviewDiff.mount).toHaveBeenCalledTimes(3);
    });
  });

  describe('navigation and keyboard', () => {
    let scrolled: string[];

    beforeEach(() => {
      scrolled = [];
      Element.prototype.scrollIntoView = function scrollIntoView(
        this: Element,
      ): void {
        const path = this.querySelector(
          '[data-testid="file-section-path"]',
        )?.textContent?.trim();
        if (path) scrolled.push(path);
      };
    });

    afterEach(() => {
      delete (Element.prototype as Partial<Element>).scrollIntoView;
    });

    it('scrolls to the file a tree row selects and marks it active', async () => {
      await create();
      const row = Array.from(
        host().querySelectorAll<HTMLElement>('[role="treeitem"]'),
      ).find((item) => item.textContent?.includes('util.ts'));
      row?.click();
      await settle();
      expect(scrolled).toContain('src/util.ts');
      expect(row?.getAttribute('aria-selected')).toBe('true');
    });

    it('Alt+ArrowDown in the list moves to the next file', async () => {
      await create();
      const list = byTestId('review-canvas-list');
      list?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          bubbles: true,
        }),
      );
      await settle();
      expect(scrolled.length).toBe(1);
      list?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          altKey: true,
          bubbles: true,
        }),
      );
      await settle();
      expect(scrolled.length).toBe(2);
      expect(scrolled[1]).not.toBe(scrolled[0]);
    });

    it("a section's Edit opens the spot editor, editable, in the active workspace", async () => {
      await create();

      sectionFor('src/app.ts')
        .querySelector<HTMLButtonElement>('[data-testid="file-section-edit"]')
        ?.click();

      expect(navigationService.openFile).toHaveBeenCalledWith(
        'src/app.ts',
        undefined,
        { editable: true, workspaceRoot: '/ws' },
      );
    });

    it('brings a navigation target into view', async () => {
      await create();
      navigate({
        scope: { kind: 'worktree' },
        target: { kind: 'diff', path: 'src/new-name.ts' },
      });
      await settle();
      expect(scrolled).toEqual(['src/new-name.ts']);
    });

    it('moves focus to the list when the draft bar disappears', async () => {
      await create();
      const store = TestBed.inject(ReviewCommentDraftStore);
      store.add(
        { workspaceRoot: '/ws' },
        {
          path: 'src/util.ts',
          startLine: 1,
          endLine: 1,
          lines: ['x'],
          body: '',
        },
      );
      await settle();
      const toggle = byTestId<HTMLButtonElement>('draft-comments-toggle');
      toggle?.focus();
      expect(document.activeElement).toBe(toggle);

      const [draft] = store.draftsFor({ workspaceRoot: '/ws' });
      store.remove({ workspaceRoot: '/ws' }, draft.id);
      await settle();
      expect(byTestId('draft-comments-bar')).toBeNull();
      expect(document.activeElement).toBe(byTestId('review-canvas-list'));
    });
  });

  it('has no axe violations', async () => {
    await create();
    observer().emit([sectionFor('src/util.ts')], true);
    await settle();
    const results = await axe.run(host() as Parameters<typeof axe.run>[0], {
      rules: {
        'color-contrast': { enabled: false },
        'target-size': { enabled: false },
      },
    });
    expect(
      results.violations.map((violation) => ({
        id: violation.id,
        nodes: violation.nodes.map((node) => node.html),
      })),
    ).toEqual([]);
  });
});
