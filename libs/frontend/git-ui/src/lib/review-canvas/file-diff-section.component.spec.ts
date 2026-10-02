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
import type { GitHunkRef } from '@ptah-extension/shared';
import type { PierreHunkToolbarContext } from '../renderer/pierre-diff-host.component';
import { ReviewCommentDraftStore } from '../services/review-comment-draft.store';
import {
  ReviewDiffService,
  type ReviewDiffEntry,
  type ReviewDiffRequest,
} from '../services/review-diff.service';
import type { DiffTabState } from '../types/diff-tab.types';
import type {
  FileDiffSectionComponent as SectionType,
  ReviewCanvasFile,
} from './file-diff-section.component';

/**
 * Stand-in for Pierre's host: `@pierre/diffs` is ESM-only and lazy in the app.
 * It renders one hunk host per hunk and projects the section's toolbar
 * template into it, the slot contract the real host keeps (Batch 22).
 */
@Component({
  selector: 'ptah-pierre-diff-host',
  standalone: true,
  imports: [NgTemplateOutlet],
  template: `
    @for (hunk of hunks(); track hunk.index) {
      <div [attr.data-hunk-index]="hunk.index" data-testid="pierre-hunk-host">
        @if (hunkToolbar(); as toolbar) {
          <ng-container
            *ngTemplateOutlet="
              toolbar;
              context: { $implicit: hunk, index: hunk.index }
            "
          />
        }
      </div>
    }
  `,
})
class MockPierreDiffHost {
  /** Instances ever created: proves the renderer never mounted at all. */
  static created = 0;
  constructor() {
    MockPierreDiffHost.created++;
  }
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

const HUNKS: GitHunkRef[] = [
  {
    index: 0,
    originalStart: 2,
    originalLines: 1,
    modifiedStart: 2,
    modifiedLines: 2,
    header: '@@ -2,1 +2,2 @@',
  },
  {
    index: 1,
    originalStart: 9,
    originalLines: 1,
    modifiedStart: 10,
    modifiedLines: 1,
    header: '@@ -9,1 +10,1 @@',
  },
];

const REQUEST: ReviewDiffRequest = {
  comparison: { kind: 'worktree' },
  path: 'src/app.ts',
};
const KEY = 'review:worktree\u0000src/app.ts\u0000src/app.ts';

function makeFile(overrides: Partial<ReviewCanvasFile> = {}): ReviewCanvasFile {
  return {
    id: 'worktree\u0000src/app.ts\u0000src/app.ts',
    path: 'src/app.ts',
    status: 'M',
    additions: 2,
    deletions: 1,
    comparison: 'worktree',
    request: REQUEST,
    label: null,
    ...overrides,
  };
}

function makeDiff(overrides: Partial<DiffTabState> = {}): DiffTabState {
  return {
    provenance: { kind: 'mutable', comparison: 'worktree' },
    comparison: 'worktree',
    path: 'src/app.ts',
    originalPath: 'src/app.ts',
    original: 'a\nold\nc\n',
    modified: 'a\nnew 1\nnew 2\nc\n',
    originalRef: { kind: 'index' },
    modifiedRef: { kind: 'worktree' },
    snapshotToken: 'tok-1',
    hunks: HUNKS,
    isBinary: false,
    status: 'fresh',
    requestId: 1,
    ...overrides,
  };
}

describe('FileDiffSectionComponent', () => {
  let Section: Type<SectionType>;
  let fixture: ComponentFixture<SectionType>;
  let store: ReviewCommentDraftStore;

  const entries = signal<ReadonlyMap<string, ReviewDiffEntry>>(new Map());
  const reviewDiff = {
    entries: entries.asReadonly(),
    mount: jest.fn((_request: ReviewDiffRequest) => KEY),
    unmount: jest.fn(),
    retry: jest.fn(async () => undefined),
    applyHunks: jest.fn(),
  };

  const owner = { workspaceRoot: '/ws' };
  const host = (): HTMLElement => fixture.nativeElement as HTMLElement;
  const byTestId = <T extends HTMLElement = HTMLElement>(
    id: string,
  ): T | null => host().querySelector<T>(`[data-testid="${id}"]`);
  const settle = async (): Promise<void> => {
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  };
  const pierre = (): MockPierreDiffHost | null =>
    (fixture.debugElement.query(By.directive(MockPierreDiffHost))
      ?.componentInstance as MockPierreDiffHost | undefined) ?? null;

  function setDiff(diff: DiffTabState | null): void {
    entries.set(
      new Map([
        [
          KEY,
          {
            key: KEY,
            comparison: { kind: 'worktree' },
            path: 'src/app.ts',
            originalPath: 'src/app.ts',
            diff,
            invalidated: false,
          },
        ],
      ]),
    );
  }

  async function create(inputs: Record<string, unknown> = {}): Promise<void> {
    fixture = TestBed.createComponent(Section);
    fixture.componentRef.setInput('file', makeFile());
    fixture.componentRef.setInput('reservedHeight', 480);
    for (const [name, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(name, value);
    }
    await settle();
  }

  beforeAll(async () => {
    ({ FileDiffSectionComponent: Section } =
      await import('./file-diff-section.component'));
  });

  beforeEach(() => {
    jest.clearAllMocks();
    entries.set(new Map());
    TestBed.configureTestingModule({
      imports: [Section],
      providers: [{ provide: ReviewDiffService, useValue: reviewDiff }],
    });
    store = TestBed.inject(ReviewCommentDraftStore);
  });

  describe('mounting', () => {
    it('holds the reserved height and reads nothing while far from view', async () => {
      await create({ near: false });
      expect(reviewDiff.mount).not.toHaveBeenCalled();
      expect(byTestId('file-placeholder')).not.toBeNull();
      expect(pierre()).toBeNull();
      expect(host().style.minHeight).toBe('480px');
      expect(host().getAttribute('data-file-id')).toBe(makeFile().id);
    });

    it('reads the diff when near and renders it from the cache', async () => {
      await create({ near: true });
      expect(reviewDiff.mount).toHaveBeenCalledWith(REQUEST);
      expect(byTestId('file-loading')?.getAttribute('role')).toBe('status');
      expect(host().style.minHeight).toBe('480px');

      setDiff(makeDiff());
      await settle();
      const rendered = pierre();
      expect(rendered?.oldText()).toBe('a\nold\nc\n');
      expect(rendered?.newText()).toBe('a\nnew 1\nnew 2\nc\n');
      expect(rendered?.hunks()).toEqual(HUNKS);
      expect(rendered?.diffStyle()).toBe('split');
      expect(host().style.minHeight).toBe('');
      expect(
        Array.from(host().querySelectorAll('[data-testid="file-chip"]')).map(
          (chip) => chip.textContent?.trim(),
        ),
      ).toEqual(['2 hunks']);
    });

    it('unmounts the read when it leaves the window and on destroy', async () => {
      await create({ near: true });
      fixture.componentRef.setInput('near', false);
      await settle();
      expect(reviewDiff.unmount).toHaveBeenCalledWith(KEY);
      expect(pierre()).toBeNull();

      fixture.componentRef.setInput('near', true);
      await settle();
      expect(reviewDiff.mount).toHaveBeenCalledTimes(2);
      fixture.destroy();
      expect(reviewDiff.unmount).toHaveBeenCalledTimes(2);
    });

    it('does not remount when the canvas rebuilds an equal file record', async () => {
      await create({ near: true });
      fixture.componentRef.setInput('file', makeFile());
      await settle();
      expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
      expect(reviewDiff.unmount).not.toHaveBeenCalled();
    });

    it('passes a null side for an added file and marks it new', async () => {
      await create({ near: true });
      setDiff(makeDiff({ originalRef: { kind: 'absent' }, original: '' }));
      await settle();
      expect(pierre()?.oldText()).toBeNull();
      expect(
        Array.from(host().querySelectorAll('[data-testid="file-chip"]')).map(
          (chip) => chip.textContent?.trim(),
        ),
      ).toContain('new');
    });
  });

  describe('labelled rows', () => {
    it.each([
      ['conflicted', 'Conflicted — resolve to review'],
      ['submodule', 'Submodule'],
      ['binary', 'Binary file — diff not shown'],
    ] as const)(
      'shows %s as a label and never reads it',
      async (label, text) => {
        await create({ near: true, file: makeFile({ label }) });
        expect(reviewDiff.mount).not.toHaveBeenCalled();
        expect(byTestId('file-label-row')?.textContent).toContain(text);
        expect(pierre()).toBeNull();
        expect(host().style.minHeight).toBe('');
      },
    );

    it('labels a file binary once its read says so', async () => {
      await create({ near: true });
      setDiff(
        makeDiff({ isBinary: true, hunks: [], original: '', modified: '' }),
      );
      await settle();
      expect(byTestId('file-label-row')?.textContent).toContain('Binary file');
      expect(pierre()).toBeNull();
    });

    it.each([
      [
        'too-large',
        3 * 1024 * 1024 + 512 * 1024,
        'Too large to display (3.5 MB)',
      ],
      ['lfs-pointer', 2048, 'Git LFS pointer — diff not shown (2.0 KB)'],
    ] as const)(
      'labels a %s side with its size instead of mounting the renderer',
      async (reason, size, text) => {
        await create({
          near: true,
          draftOwner: owner,
          editorTargets: [{ id: 'vscode', displayName: 'VS Code' }],
        });
        setDiff(
          makeDiff({
            hunks: [],
            original: 'a\n',
            modified: '',
            unrenderable: { side: 'modified', reason, size },
          }),
        );
        await settle();
        const row = byTestId('file-label-row');
        expect(row?.textContent).toContain(text);
        expect(row?.querySelector('.text-base-content-muted')).not.toBeNull();
        expect(pierre()).toBeNull();
        expect(byTestId('file-diff-body')).toBeNull();
        expect(byTestId('file-section-comment')).toBeNull();
        expect(host().querySelector('ptah-open-in-button')).not.toBeNull();
      },
    );

    it('omits a size that is not known', async () => {
      await create({ near: true });
      setDiff(
        makeDiff({
          hunks: [],
          original: '',
          modified: '',
          unrenderable: { side: 'original', reason: 'too-large', size: 0 },
        }),
      );
      await settle();
      expect(byTestId('file-label-row')?.textContent?.trim()).toMatch(
        /Too large to display$/,
      );
    });

    it('renders a file at exactly the changed-line cap (3,000)', async () => {
      await create({
        near: true,
        file: makeFile({ additions: 2000, deletions: 1000 }),
      });
      expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
      setDiff(makeDiff());
      await settle();
      expect(byTestId('file-label-row')).toBeNull();
      expect(pierre()).not.toBeNull();
    });

    it('labels a file one line over the cap (3,001) with Open-in and never reads it', async () => {
      await create({
        near: true,
        draftOwner: owner,
        editorTargets: [{ id: 'vscode', displayName: 'VS Code' }],
        file: makeFile({ additions: 2001, deletions: 1000 }),
      });
      expect(reviewDiff.mount).not.toHaveBeenCalled();
      const row = byTestId('file-label-row');
      expect(row?.textContent).toContain(
        'Too large to display (3,001 changed lines)',
      );
      expect(row?.querySelector('.text-base-content-muted')).not.toBeNull();
      expect(pierre()).toBeNull();
      expect(byTestId('file-section-comment')).toBeNull();
      expect(host().querySelector('ptah-open-in-button')).not.toBeNull();
    });

    it('counts a missing side as zero against the cap', async () => {
      await create({
        near: true,
        file: makeFile({ additions: 3001, deletions: null }),
      });
      expect(reviewDiff.mount).not.toHaveBeenCalled();
      expect(byTestId('file-label-row')?.textContent).toContain(
        '3,001 changed lines',
      );
    });

    describe('a file the list has no counts for (MOD-B2)', () => {
      const untracked = (): ReviewCanvasFile =>
        makeFile({ status: '??', additions: null, deletions: null });
      const lines = (count: number): string => 'x\n'.repeat(count);

      it('renders an untracked file at exactly the cap (3,000 lines)', async () => {
        await create({ near: true, file: untracked() });
        expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
        setDiff(
          makeDiff({
            originalRef: { kind: 'absent' },
            original: '',
            modified: lines(3000),
            hunks: [],
          }),
        );
        await settle();
        expect(byTestId('file-label-row')).toBeNull();
        expect(pierre()).not.toBeNull();
      });

      it('labels an untracked file over the cap after its read, before Pierre ever mounts', async () => {
        MockPierreDiffHost.created = 0;
        await create({
          near: true,
          draftOwner: owner,
          editorTargets: [{ id: 'vscode', displayName: 'VS Code' }],
          file: untracked(),
        });
        expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
        setDiff(
          makeDiff({
            originalRef: { kind: 'absent' },
            original: '',
            modified: lines(3001),
            hunks: [],
          }),
        );
        await settle();

        const row = byTestId('file-label-row');
        expect(row?.textContent).toContain(
          'Too large to display (3,001 lines)',
        );
        expect(row?.querySelector('.text-base-content-muted')).not.toBeNull();
        expect(MockPierreDiffHost.created).toBe(0);
        expect(byTestId('file-diff-body')).toBeNull();
        expect(byTestId('file-section-comment')).toBeNull();
        expect(host().querySelector('ptah-open-in-button')).not.toBeNull();
        // Labelled from the read, not re-read in a loop.
        expect(reviewDiff.mount).toHaveBeenCalledTimes(1);
        expect(reviewDiff.unmount).not.toHaveBeenCalled();
      });

      it('measures the longer side when both sides are present', async () => {
        MockPierreDiffHost.created = 0;
        await create({ near: true, file: untracked() });
        setDiff(
          makeDiff({
            original: lines(10),
            modified: `${lines(4000)}tail`,
            hunks: [],
          }),
        );
        await settle();
        expect(byTestId('file-label-row')?.textContent).toContain(
          'Too large to display (4,001 lines)',
        );
        expect(MockPierreDiffHost.created).toBe(0);
      });

      it('leaves a file with list counts to the list cap alone', async () => {
        await create({ near: true });
        setDiff(makeDiff({ modified: lines(5000) }));
        await settle();
        expect(byTestId('file-label-row')).toBeNull();
        expect(pierre()).not.toBeNull();
      });
    });

    it('keeps the error row when a failed read also carries an unshipped side', async () => {
      await create({ near: true });
      setDiff(
        makeDiff({
          status: 'error',
          errorMessage: 'Git could not read this file.',
          hunks: [],
          original: '',
          modified: '',
          unrenderable: { side: 'modified', reason: 'lfs-pointer', size: 10 },
        }),
      );
      await settle();
      expect(byTestId('file-label-row')).toBeNull();
      expect(byTestId('file-read-error')).not.toBeNull();
    });
  });

  describe('read failures', () => {
    it('shows the sanitized message with Retry, never the content', async () => {
      await create({ near: true });
      setDiff(
        makeDiff({
          status: 'error',
          errorMessage: 'Git could not read this file.',
          original: '',
          modified: '',
          hunks: [],
        }),
      );
      await settle();
      const row = byTestId('file-read-error');
      expect(row?.getAttribute('role')).toBe('alert');
      expect(row?.textContent).toContain('Git could not read this file.');
      expect(pierre()).toBeNull();
      byTestId<HTMLButtonElement>('file-read-retry')?.click();
      expect(reviewDiff.retry).toHaveBeenCalledWith(KEY);
    });

    it('keeps the last content with a note when a refresh could not reach git', async () => {
      await create({ near: true });
      setDiff(
        makeDiff({ status: 'stale', errorMessage: 'Showing the last read.' }),
      );
      await settle();
      expect(byTestId('file-stale-note')?.textContent).toContain(
        'Showing the last read.',
      );
      expect(pierre()).not.toBeNull();
      byTestId<HTMLButtonElement>('file-stale-retry')?.click();
      expect(reviewDiff.retry).toHaveBeenCalledWith(KEY);
    });

    it('marks the body busy while a refresh is in flight', async () => {
      await create({ near: true });
      setDiff(makeDiff({ status: 'refreshing' }));
      await settle();
      expect(byTestId('file-diff-body')?.getAttribute('aria-busy')).toBe(
        'true',
      );
    });
  });

  describe('hunk toolbar', () => {
    it('hands each toolbar the entry key, snapshot token and hunk count', async () => {
      await create({ near: true });
      setDiff(makeDiff());
      await settle();
      const positions = Array.from(
        host().querySelectorAll('[data-testid="hunk-position"]'),
      ).map((element) => element.textContent?.trim());
      expect(positions).toEqual(['Hunk 1 of 2', 'Hunk 2 of 2']);
      const accept = host().querySelector<HTMLButtonElement>(
        '[data-testid="hunk-stage"]',
      );
      expect(accept?.getAttribute('aria-disabled')).toBeNull();
    });

    it('dims the body while a refusal chip shows (85%)', async () => {
      await create({ near: true });
      setDiff(makeDiff());
      await settle();
      expect(byTestId('file-diff-body')?.className).toContain(
        'has-[[data-testid=hunk-refused]]:opacity-[0.85]',
      );
    });

    it('Next moves focus to the next hunk toolbar', async () => {
      await create({ near: true });
      setDiff(makeDiff());
      await settle();
      const firstNext = host().querySelector<HTMLButtonElement>(
        '[data-hunk-index="0"] [data-testid="hunk-next"]',
      );
      firstNext?.click();
      await settle();
      const target = host().querySelector('[data-hunk-index="1"]');
      expect(target?.contains(document.activeElement)).toBe(true);
    });
  });

  describe('draft comments', () => {
    async function openComposer(): Promise<void> {
      await create({ near: true, draftOwner: owner });
      setDiff(makeDiff());
      await settle();
      byTestId<HTMLButtonElement>('file-section-comment')?.click();
      await settle();
    }

    function type(id: string, value: string): void {
      const field = byTestId<HTMLInputElement | HTMLTextAreaElement>(id);
      if (!field) throw new Error(`no ${id}`);
      field.value = value;
      field.dispatchEvent(new Event('input'));
    }

    it('offers no Comment action without an owner', async () => {
      await create({ near: true });
      setDiff(makeDiff());
      await settle();
      expect(byTestId('file-section-comment')).toBeNull();
    });

    it('opens on the first hunk, focused, and adds the quoted lines as a draft', async () => {
      await openComposer();
      const side = byTestId<HTMLSelectElement>('comment-side');
      expect(document.activeElement).toBe(side);
      expect(byTestId<HTMLInputElement>('comment-from')?.value).toBe('2');

      type('comment-to', '3');
      type('comment-body', '  Why two lines?  ');
      byTestId<HTMLButtonElement>('comment-add')?.click();
      await settle();

      const drafts = store.draftsFor(owner);
      expect(drafts).toHaveLength(1);
      expect(drafts[0]).toMatchObject({
        path: 'src/app.ts',
        startLine: 2,
        endLine: 3,
        lines: ['new 1', 'new 2'],
        body: 'Why two lines?',
      });
      expect(byTestId('comment-composer')).toBeNull();
      expect(document.activeElement).toBe(byTestId('file-section-comment'));
    });

    it('quotes the old side from the pre-rename path', async () => {
      await create({
        near: true,
        draftOwner: owner,
        file: makeFile({ originalPath: 'src/old.ts' }),
      });
      setDiff(makeDiff());
      await settle();
      byTestId<HTMLButtonElement>('file-section-comment')?.click();
      await settle();
      const side = byTestId<HTMLSelectElement>('comment-side');
      if (!side) throw new Error('no side');
      side.value = 'deletions';
      side.dispatchEvent(new Event('change'));
      type('comment-from', '2');
      type('comment-to', '2');
      byTestId<HTMLButtonElement>('comment-add')?.click();
      await settle();
      expect(store.draftsFor(owner)[0]).toMatchObject({
        path: 'src/old.ts',
        lines: ['old'],
      });
    });

    it('refuses a range outside the file and keeps the composer', async () => {
      await openComposer();
      type('comment-to', '9');
      byTestId<HTMLButtonElement>('comment-add')?.click();
      await settle();
      expect(byTestId('comment-error')?.textContent).toContain(
        'Choose lines between 1 and 4',
      );
      expect(store.draftsFor(owner)).toHaveLength(0);
      expect(byTestId('comment-composer')).not.toBeNull();
    });

    it('Cancel closes the composer and returns focus to Comment', async () => {
      await openComposer();
      byTestId<HTMLButtonElement>('comment-cancel')?.click();
      await settle();
      expect(byTestId('comment-composer')).toBeNull();
      expect(document.activeElement).toBe(byTestId('file-section-comment'));
    });
  });
});
