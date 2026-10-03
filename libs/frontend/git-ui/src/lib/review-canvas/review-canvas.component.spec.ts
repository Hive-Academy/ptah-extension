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
import {
  ElectronLayoutService,
  ThemeService,
  VSCodeService,
} from '@ptah-extension/core';
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
  readonly themeType = input<'light' | 'dark'>('dark');
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

/** A deterministic `ResizeObserver`: tests report the list's box by hand. */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];
  readonly observed = new Set<Element>();
  disconnected = false;
  constructor(readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
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
  /** Report every observed element at `height` (0 = hidden). */
  emit(height: number): void {
    this.callback(
      [...this.observed].map(
        (target) =>
          ({
            target,
            contentRect: { width: height > 0 ? 600 : 0, height },
          }) as ResizeObserverEntry,
      ),
      this as unknown as ResizeObserver,
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
    entry: jest.fn((key: string) => entries().get(key)),
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

  const isDarkMode = signal(true);

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
    isDarkMode.set(true);
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
        { provide: ThemeService, useValue: { isDarkMode } },
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

    it('shows unified while the list is under 600 px, and keeps Split once the user presses it (V-5)', async () => {
      FakeResizeObserver.instances = [];
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        FakeResizeObserver;
      try {
        await create();
        const observerOfList = FakeResizeObserver.instances.at(-1);
        const list = byTestId('review-canvas-list');
        if (!observerOfList || !list) throw new Error('list not observed');
        const reportWidth = async (width: number): Promise<void> => {
          observerOfList.callback(
            [{ target: list, contentRect: { width, height: 400 } }] as never,
            observerOfList as unknown as ResizeObserver,
          );
          await settle();
        };
        const layouts = (): string[] =>
          sectionInstances().map((section) => section.diffStyle());
        const pressed = (id: string): string | null | undefined =>
          byTestId(id)?.getAttribute('aria-pressed');

        await reportWidth(420);
        expect(new Set(layouts())).toEqual(new Set(['unified']));
        expect(pressed('layout-unified')).toBe('true');
        expect(pressed('layout-split')).toBe('false');

        await reportWidth(800);
        expect(new Set(layouts())).toEqual(new Set(['split']));

        // Hidden (0 wide) keeps the last real layout.
        await reportWidth(420);
        await reportWidth(0);
        expect(new Set(layouts())).toEqual(new Set(['unified']));

        byTestId<HTMLButtonElement>('layout-split')?.click();
        await settle();
        expect(new Set(layouts())).toEqual(new Set(['split']));
        expect(pressed('layout-split')).toBe('true');
      } finally {
        delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
      }
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

    it('Alt+ArrowUp from the first file wraps to the last (parity row 40)', async () => {
      await create();
      const list = byTestId('review-canvas-list');
      const altKey = (key: string): void => {
        list?.dispatchEvent(
          new KeyboardEvent('keydown', { key, altKey: true, bubbles: true }),
        );
      };
      altKey('ArrowDown');
      await settle();
      expect(scrolled).toEqual(['src/app.ts']);
      altKey('ArrowUp');
      await settle();
      // Tree order ends with logo.png; the untracked directory is skipped.
      expect(scrolled[1]).toBe('logo.png');
    });

    describe('collapsing a file (parity rows 39, 40)', () => {
      const treeRow = (name: string): HTMLElement => {
        const found = Array.from(
          host().querySelectorAll<HTMLElement>('[role="treeitem"]'),
        ).find(
          (item) =>
            item.querySelector('[id$="-name"]')?.textContent?.trim() === name,
        );
        if (!found) throw new Error(`no row ${name}`);
        return found;
      };
      const section = (path: string): SectionType => {
        const found = sectionInstances().find((s) => s.file().path === path);
        if (!found) throw new Error(`no section ${path}`);
        return found;
      };

      it("from a section's header toggle, and back", async () => {
        await create();
        const toggle = sectionFor(
          'src/util.ts',
        ).querySelector<HTMLButtonElement>(
          '[data-testid="file-section-toggle"]',
        );
        toggle?.click();
        await settle();
        expect(section('src/util.ts').collapsed()).toBe(true);
        expect(section('src/app.ts').collapsed()).toBe(false);
        toggle?.click();
        await settle();
        expect(section('src/util.ts').collapsed()).toBe(false);
      });

      it('Delete on a tree row collapses that section; selecting the row shows it again', async () => {
        await create();
        const row = treeRow('util.ts');
        row.focus();
        row.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Delete', bubbles: true }),
        );
        await settle();
        expect(section('src/util.ts').collapsed()).toBe(true);
        expect(
          sectionFor('src/util.ts').querySelector(
            '[data-testid="file-section-header"]',
          ),
        ).not.toBeNull();

        treeRow('util.ts').click();
        await settle();
        expect(section('src/util.ts').collapsed()).toBe(false);
        expect(scrolled).toContain('src/util.ts');
      });

      it('forgets collapsed files when the comparison changes', async () => {
        await create();
        sectionFor('src/app.ts')
          .querySelector<HTMLButtonElement>(
            '[data-testid="file-section-toggle"]',
          )
          ?.click();
        await settle();
        expect(section('src/app.ts').collapsed()).toBe(true);
        navigate({ scope: { kind: 'staged' }, target: { kind: 'none' } });
        await settle();
        expect(section('src/app.ts').collapsed()).toBe(false);
      });
    });

    it('re-reads a cached diff when its tree row is selected again (A1 AC4 re-click revalidation)', async () => {
      await create();
      const key = reviewDiffKey({
        comparison: { kind: 'worktree' },
        path: 'src/util.ts',
      });
      const row = (): HTMLElement | undefined =>
        Array.from(
          host().querySelectorAll<HTMLElement>('[role="treeitem"]'),
        ).find((item) => item.textContent?.includes('util.ts'));

      // Never read yet: the section's mount reads it, nothing to revalidate.
      row()?.click();
      await settle();
      expect(reviewDiff.retry).not.toHaveBeenCalled();

      entries.set(new Map([[key, { key } as unknown as ReviewDiffEntry]]));
      row()?.click();
      await settle();
      expect(reviewDiff.retry).toHaveBeenCalledWith(key);
    });

    it('hands every section the app theme and follows a switch', async () => {
      await create();
      expect(sectionInstances().every((s) => s.themeType() === 'dark')).toBe(
        true,
      );
      isDarkMode.set(false);
      await settle();
      expect(sectionInstances().every((s) => s.themeType() === 'light')).toBe(
        true,
      );
    });

    // N-6: a canvas mounted after the app switched to light (the dock closed
    // and reopened) starts light; nothing from the earlier dark mount sticks.
    it('mounts light when the app theme is already light', async () => {
      isDarkMode.set(false);
      await create();
      expect(sectionInstances().length).toBeGreaterThan(0);
      expect(sectionInstances().every((s) => s.themeType() === 'light')).toBe(
        true,
      );
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

    it("a tree row's Open-in launches the external editor at that file in the active workspace (parity §1 row 41)", async () => {
      await create();
      const { ChangedFileTreeComponent } =
        await import('./changed-file-tree.component');
      const tree = fixture.debugElement.query(
        By.directive(ChangedFileTreeComponent),
      );
      expect(tree).not.toBeNull();

      (
        tree.componentInstance as InstanceType<typeof ChangedFileTreeComponent>
      ).openFile.emit({ target: 'vscode', path: 'src/app.ts', line: 7 });

      expect(launchers.openFile).toHaveBeenCalledWith(
        'vscode',
        '/ws',
        'src/app.ts',
        7,
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

  describe('reading position', () => {
    const SECTION_PX = 100;
    const VIEWPORT_PX = 400;
    /** Section heights by path; unlisted sections are SECTION_PX tall. */
    let heights: Map<string, number>;
    let scrollTop: number;
    let frames: Map<number, FrameRequestCallback>;
    let nextFrame: number;
    let spies: jest.SpyInstance[];

    const pathOf = (section: Element): string =>
      section
        .querySelector('[data-testid="file-section-path"]')
        ?.textContent?.trim() ?? '';
    const heightOf = (section: Element): number => {
      const path = pathOf(section);
      for (const [prefix, height] of heights) {
        if (path.startsWith(prefix)) return height;
      }
      return SECTION_PX;
    };
    const list = (): HTMLElement => {
      const found = byTestId('review-canvas-list');
      if (!found) throw new Error('no list');
      return found;
    };
    const resizeObserver = (): FakeResizeObserver => {
      const last = FakeResizeObserver.instances.at(-1);
      if (!last) throw new Error('no resize observer');
      return last;
    };
    /** Run queued animation frames (and the ones they queue), bounded. */
    const flushFrames = (limit = 200): void => {
      for (let i = 0; i < limit && frames.size > 0; i++) {
        const batch = [...frames.values()];
        frames.clear();
        for (const callback of batch) callback(0);
      }
    };
    /** The user scrolls the list to `top`; the canvas records its anchor. */
    const userScroll = (top: number): void => {
      list().dispatchEvent(new Event('wheel'));
      scrollTop = top;
      list().dispatchEvent(new Event('scroll'));
      flushFrames();
    };
    /** The first section reaching into the viewport, and how far past it. */
    const readingPosition = (): { path: string; offset: number } => {
      for (const section of sections()) {
        const rect = section.getBoundingClientRect();
        if (rect.bottom > 1)
          return { path: pathOf(section), offset: -rect.top };
      }
      return { path: '', offset: 0 };
    };

    beforeEach(() => {
      heights = new Map();
      scrollTop = 0;
      frames = new Map();
      nextFrame = 0;
      FakeResizeObserver.instances = [];
      (globalThis as { ResizeObserver?: unknown }).ResizeObserver =
        FakeResizeObserver;
      spies = [
        jest
          .spyOn(window, 'requestAnimationFrame')
          .mockImplementation((callback) => {
            frames.set(++nextFrame, callback);
            return nextFrame;
          }),
        jest
          .spyOn(window, 'cancelAnimationFrame')
          .mockImplementation((id) => void frames.delete(id)),
        // Stacked layout: the list's top is at 0, each section below the last.
        jest
          .spyOn(Element.prototype, 'getBoundingClientRect')
          .mockImplementation(function (this: Element) {
            if (this.getAttribute('data-testid') === 'review-canvas-list') {
              return {
                top: 0,
                bottom: VIEWPORT_PX,
                height: VIEWPORT_PX,
              } as DOMRect;
            }
            if (this.tagName.toLowerCase() !== 'ptah-file-diff-section') {
              return { top: 0, bottom: 0, height: 0 } as DOMRect;
            }
            let top = -scrollTop;
            for (const section of sections()) {
              if (section === this) break;
              top += heightOf(section);
            }
            const height = heightOf(this);
            return { top, bottom: top + height, height } as DOMRect;
          }),
      ];
    });

    afterEach(() => {
      for (const spy of spies) spy.mockRestore();
      delete (globalThis as { ResizeObserver?: unknown }).ResizeObserver;
    });

    async function createWithLayout(): Promise<void> {
      await create();
      Object.defineProperty(list(), 'scrollTop', {
        configurable: true,
        get: () => scrollTop,
        set: (value: number) => {
          scrollTop = Math.max(0, value);
        },
      });
      flushFrames();
    }

    /** The shell hides the Changes body: the list loses its scroll offset. */
    function hide(): void {
      resizeObserver().emit(0);
      scrollTop = 0;
      list().dispatchEvent(new Event('scroll'));
      flushFrames();
    }

    function show(): void {
      resizeObserver().emit(VIEWPORT_PX);
      flushFrames();
    }

    it('restores the anchor when the hidden body shows again', async () => {
      await createWithLayout();
      userScroll(250);
      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });

      hide();
      // Sections above were unmounted while hidden and are estimated taller.
      heights.set('src/app.ts', 300);
      show();

      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
      expect(scrollTop).toBe(450);
    });

    it('does not overwrite the anchor while the body is hidden', async () => {
      await createWithLayout();
      userScroll(250);
      hide();
      // A scroll event while hidden reads offset 0 at the first file.
      list().dispatchEvent(new Event('scroll'));
      flushFrames();
      show();
      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
    });

    it('restores a comparison after switching through an empty one', async () => {
      await createWithLayout();
      userScroll(250);
      expect(readingPosition().path).toBe('src/new-name.ts');

      navigate({
        scope: {
          kind: 'historical',
          base: { name: 'abc^', sha: 'p1' },
          head: { name: 'abc', sha: 'h1' },
          label: 'abc1234',
          files: [],
        },
        target: { kind: 'none' },
      });
      await settle();
      // The emptied list clamps to the top.
      scrollTop = 0;
      list().dispatchEvent(new Event('scroll'));
      flushFrames();
      expect(sections()).toHaveLength(0);

      navigate({ scope: { kind: 'worktree' }, target: { kind: 'none' } });
      await settle();
      flushFrames();
      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
    });

    it('re-anchors when a section above is measured after the restore began', async () => {
      await createWithLayout();
      userScroll(250);
      hide();
      resizeObserver().emit(VIEWPORT_PX);
      // First frame applied from estimates; then the section above renders.
      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
      heights.set('src/util.ts', 520);
      flushFrames();

      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
      expect(scrollTop).toBe(100 + 520 + 50);
      // Settled: the loop stopped.
      expect(frames.size).toBe(0);
    });

    it('yields to the user scrolling during a restore', async () => {
      await createWithLayout();
      userScroll(250);
      hide();
      resizeObserver().emit(VIEWPORT_PX);
      userScroll(20);
      heights.set('src/app.ts', 600);
      flushFrames();
      expect(scrollTop).toBe(20);
    });

    it('restores to a file that was staged while the body was hidden (its id changed)', async () => {
      await createWithLayout();
      userScroll(150);
      expect(readingPosition()).toEqual({ path: 'src/util.ts', offset: 50 });

      hide();
      statusFiles.set(
        STATUS.map((file) =>
          file.path === 'src/util.ts' ? { ...file, staged: true } : file,
        ),
      );
      await settle();
      show();

      expect(readingPosition()).toEqual({ path: 'src/util.ts', offset: 50 });
    });

    it('keeps a collapsed file collapsed when staging changes its id', async () => {
      await createWithLayout();
      sectionFor('src/util.ts')
        .querySelector<HTMLButtonElement>('[data-testid="file-section-toggle"]')
        ?.click();
      await settle();

      statusFiles.set(
        STATUS.map((file) =>
          file.path === 'src/util.ts' ? { ...file, staged: true } : file,
        ),
      );
      await settle();

      const util = sectionInstances().find(
        (s) => s.file().path === 'src/util.ts',
      );
      expect(util?.file().comparison).toBe('staged');
      expect(util?.collapsed()).toBe(true);
    });

    it('keeps re-anchoring past the frame cap while a section in the window waits for its first read', async () => {
      await createWithLayout();
      userScroll(250);
      hide();
      observer().emit([sectionFor('src/util.ts')], true);
      await settle();
      resizeObserver().emit(VIEWPORT_PX);

      // Well past the 60-frame cap: the restore is still running.
      flushFrames(100);
      expect(frames.size).toBeGreaterThan(0);

      // The slow read lands and the section above grows.
      const key = reviewDiffKey({
        comparison: { kind: 'worktree' },
        path: 'src/util.ts',
      });
      entries.set(
        new Map([
          [
            key,
            {
              key,
              comparison: { kind: 'worktree' },
              path: 'src/util.ts',
              originalPath: 'src/util.ts',
              diff: {
                provenance: { kind: 'mutable', comparison: 'worktree' },
                comparison: 'worktree',
                path: 'src/util.ts',
                originalPath: 'src/util.ts',
                original: '',
                modified: '',
                originalRef: { kind: 'index' },
                modifiedRef: { kind: 'worktree' },
                snapshotToken: 'tok-1',
                hunks: [],
                isBinary: false,
                status: 'error',
                requestId: 1,
              },
              invalidated: false,
            } as ReviewDiffEntry,
          ],
        ]),
      );
      heights.set('src/util.ts', 520);
      await settle();
      flushFrames();

      expect(readingPosition()).toEqual({
        path: 'src/new-name.ts',
        offset: 50,
      });
      expect(frames.size).toBe(0);
    });

    it('observes the list size and disconnects on destroy', async () => {
      await createWithLayout();
      const ro = resizeObserver();
      expect([...ro.observed]).toEqual([list()]);
      fixture.destroy();
      expect(ro.disconnected).toBe(true);
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
