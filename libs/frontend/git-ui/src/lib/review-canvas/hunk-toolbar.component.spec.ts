import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import type {
  GitApplyHunksResult,
  GitHunkRef,
} from '@ptah-extension/shared';
import {
  ReviewDiffService,
  type ReviewDiffEntry,
} from '../services/review-diff.service';
import type { DiffTabState, HunkApplyRequest } from '../types/diff-tab.types';
import {
  HunkToolbarComponent,
  type HunkToolbarComparison,
} from './hunk-toolbar.component';

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

const KEY = 'worktree::src/app.ts::src/app.ts';

function hunk(index: number): GitHunkRef {
  return {
    index,
    originalStart: 12,
    originalLines: 6,
    modifiedStart: 12,
    modifiedLines: 9,
    header: '@@ -12,6 +12,9 @@ function run()',
  };
}

function diffState(
  token: string,
  status: DiffTabState['status'] = 'fresh',
): DiffTabState {
  return { snapshotToken: token, status } as DiffTabState;
}

@Component({
  standalone: true,
  imports: [HunkToolbarComponent],
  template: `
    <ptah-hunk-toolbar
      [hunk]="hunk()"
      [hunkCount]="count()"
      [comparison]="comparison()"
      [entryKey]="key"
      [snapshotToken]="token()"
      (navigate)="navigated.push($event)"
    />
  `,
})
class HostComponent {
  readonly hunk = signal(hunk(0));
  readonly count = signal(3);
  readonly comparison = signal<HunkToolbarComparison>('worktree');
  readonly token = signal('tok-1');
  readonly key = KEY;
  readonly navigated: number[] = [];
}

describe('HunkToolbarComponent', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;
  let entries: ReturnType<typeof signal<ReadonlyMap<string, ReviewDiffEntry>>>;
  let applyHunks: jest.Mock<Promise<GitApplyHunksResult>, [HunkApplyRequest]>;

  function setEntryDiff(diff: DiffTabState | null): void {
    entries.set(
      new Map([[KEY, { key: KEY, diff } as unknown as ReviewDiffEntry]]),
    );
  }

  function el(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function q(testId: string): HTMLElement | null {
    return el().querySelector(`[data-testid="${testId}"]`);
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  beforeEach(() => {
    entries = signal<ReadonlyMap<string, ReviewDiffEntry>>(new Map());
    applyHunks = jest.fn();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [
        { provide: ReviewDiffService, useValue: { entries, applyHunks } },
      ],
    });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    setEntryDiff(diffState('tok-1'));
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  describe('content by comparison', () => {
    it('shows the hunk header and position', () => {
      expect(q('hunk-position')?.textContent?.trim()).toBe('Hunk 1 of 3');
      expect(el().textContent).toContain('@@ -12,6 +12,9 @@ function run()');
      expect(q('hunk-toolbar')?.getAttribute('aria-label')).toBe(
        'Hunk 1 of 3 actions',
      );
    });

    it('worktree offers Accept and Reject', () => {
      expect(q('hunk-stage')?.textContent?.trim()).toBe('Accept');
      expect(q('hunk-revert')?.textContent?.trim()).toBe('Reject');
      expect(q('hunk-unstage')).toBeNull();
      expect(q('hunk-stage')?.getAttribute('aria-disabled')).toBeNull();
      expect(q('hunk-revert')?.className).toContain('err-solid-text');
    });

    it('staged offers Unstage only', () => {
      host.comparison.set('staged');
      fixture.detectChanges();
      expect(q('hunk-unstage')?.textContent?.trim()).toBe('Unstage');
      expect(q('hunk-stage')).toBeNull();
      expect(q('hunk-revert')).toBeNull();
    });

    it.each<HunkToolbarComparison>(['branch', 'historical'])(
      '%s keeps Accept/Reject visible but aria-disabled and inert',
      (kind) => {
        host.comparison.set(kind);
        fixture.detectChanges();
        const accept = q('hunk-stage') as HTMLButtonElement;
        const reject = q('hunk-revert') as HTMLButtonElement;
        expect(accept.getAttribute('aria-disabled')).toBe('true');
        expect(reject.getAttribute('aria-disabled')).toBe('true');
        expect(accept.disabled).toBe(false);
        accept.click();
        reject.click();
        expect(applyHunks).not.toHaveBeenCalled();
        expect(q('git-confirm-dialog')).toBeNull();
      },
    );

    it('an empty snapshot token offers no action', () => {
      host.token.set('');
      fixture.detectChanges();
      expect(q('hunk-stage')?.getAttribute('aria-disabled')).toBe('true');
      (q('hunk-stage') as HTMLButtonElement).click();
      expect(applyHunks).not.toHaveBeenCalled();
    });
  });

  describe('apply', () => {
    it('Accept stages this hunk with the rendered token', async () => {
      host.hunk.set(hunk(2));
      fixture.detectChanges();
      applyHunks.mockResolvedValue({ success: true });

      (q('hunk-stage') as HTMLButtonElement).click();
      await settle();

      expect(applyHunks).toHaveBeenCalledWith({
        key: KEY,
        operation: 'stage',
        hunkIndices: [2],
        snapshotToken: 'tok-1',
      });
    });

    it('is inert while in flight and after success until the re-read lands', async () => {
      let resolve!: (r: GitApplyHunksResult) => void;
      applyHunks.mockReturnValue(new Promise((r) => (resolve = r)));

      (q('hunk-stage') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('hunk-toolbar')?.getAttribute('aria-busy')).toBe('true');
      (q('hunk-stage') as HTMLButtonElement).click();
      expect(applyHunks).toHaveBeenCalledTimes(1);

      // The service starts its forced re-read before answering.
      setEntryDiff(diffState('tok-1', 'refreshing'));
      resolve({ success: true });
      await settle();
      expect(q('hunk-stage')?.getAttribute('aria-disabled')).toBe('true');

      setEntryDiff(diffState('tok-2'));
      host.token.set('tok-2');
      fixture.detectChanges();
      expect(q('hunk-stage')?.getAttribute('aria-disabled')).toBeNull();
    });

    it('Reject confirms first and writes nothing on cancel', () => {
      (q('hunk-revert') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('git-confirm-dialog')).not.toBeNull();
      expect(applyHunks).not.toHaveBeenCalled();

      (q('git-confirm-cancel') as HTMLButtonElement).click();
      fixture.detectChanges();
      expect(q('git-confirm-dialog')).toBeNull();
      expect(applyHunks).not.toHaveBeenCalled();
    });

    it('Reject sends the token captured when the dialog opened', async () => {
      applyHunks.mockResolvedValue({
        success: false,
        code: 'STALE_SNAPSHOT',
        message: 'This diff changed while the hunk was selected.',
      });
      (q('hunk-revert') as HTMLButtonElement).click();
      fixture.detectChanges();

      // A re-read renumbers the hunks while the dialog is up.
      setEntryDiff(diffState('tok-9'));
      host.token.set('tok-9');
      fixture.detectChanges();

      (q('git-confirm-confirm') as HTMLButtonElement).click();
      await settle();

      expect(applyHunks).toHaveBeenCalledWith(
        expect.objectContaining({ operation: 'revert', snapshotToken: 'tok-1' }),
      );
      // The refusal is still shown even though the token moved on.
      expect(q('hunk-refused')?.textContent).toContain(
        'This diff changed while the hunk was selected.',
      );
    });
  });

  describe('refused state', () => {
    it('replaces the buttons with the sanitized reason until the re-read completes', async () => {
      applyHunks.mockImplementation(async () => {
        setEntryDiff(diffState('tok-1', 'refreshing'));
        return {
          success: false,
          code: 'APPLY_FAILED',
          message: 'git refused the patch.',
        };
      });

      (q('hunk-stage') as HTMLButtonElement).click();
      await settle();
      await settle();

      const chip = q('hunk-refused');
      expect(chip?.getAttribute('role')).toBe('alert');
      expect(chip?.textContent).toContain('git refused the patch.');
      expect(chip?.className).toContain('animate-glow-urgent');
      expect(q('hunk-toolbar')).toBeNull();
      expect(q('hunk-position')?.textContent?.trim()).toBe('Hunk 1 of 3');
      expect(document.activeElement).toBe(chip);

      setEntryDiff(diffState('tok-2'));
      host.token.set('tok-2');
      fixture.detectChanges();
      expect(q('hunk-refused')).toBeNull();
      expect(q('hunk-stage')?.getAttribute('aria-disabled')).toBeNull();
    });

    it('falls back to a generic sentence when the result has no message', async () => {
      applyHunks.mockResolvedValue({ success: false, code: 'UNKNOWN' });
      (q('hunk-stage') as HTMLButtonElement).click();
      await settle();
      expect(q('hunk-refused')?.textContent).toContain(
        'The hunk could not be applied. Nothing was written.',
      );
    });

    it('never shows the text of a thrown error', async () => {
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => undefined);
      applyHunks.mockRejectedValue(new Error('/abs/path stderr'));
      (q('hunk-stage') as HTMLButtonElement).click();
      await settle();
      expect(q('hunk-refused')?.textContent).not.toContain('/abs/path');
      expect(q('hunk-refused')?.textContent).toContain('Nothing was written.');
      spy.mockRestore();
    });
  });

  describe('navigation', () => {
    it('emits the wrapped previous and next ordinals', () => {
      (q('hunk-prev') as HTMLButtonElement).click();
      (q('hunk-next') as HTMLButtonElement).click();
      host.hunk.set(hunk(2));
      fixture.detectChanges();
      (q('hunk-next') as HTMLButtonElement).click();
      expect(host.navigated).toEqual([2, 1, 0]);
    });

    it('a single hunk disables Previous/Next', () => {
      host.count.set(1);
      fixture.detectChanges();
      expect(q('hunk-prev')?.getAttribute('aria-disabled')).toBe('true');
      (q('hunk-next') as HTMLButtonElement).click();
      expect(host.navigated).toEqual([]);
    });
  });

  describe('roving tabindex', () => {
    function tabStops(): string[] {
      return Array.from(
        el().querySelectorAll<HTMLElement>('[role="toolbar"] button'),
      )
        .filter((b) => b.getAttribute('tabindex') === '0')
        .map((b) => b.dataset['control'] ?? '');
    }

    function key(name: string): void {
      (document.activeElement ?? q('hunk-toolbar'))?.dispatchEvent(
        new KeyboardEvent('keydown', { key: name, bubbles: true }),
      );
      fixture.detectChanges();
    }

    it('has exactly one tab stop and moves it with the arrow keys, wrapping', () => {
      expect(tabStops()).toEqual(['prev']);
      (q('hunk-prev') as HTMLButtonElement).focus();

      key('ArrowRight');
      expect(document.activeElement).toBe(q('hunk-next'));
      expect(tabStops()).toEqual(['next']);

      key('End');
      expect(document.activeElement).toBe(q('hunk-revert'));

      key('ArrowRight');
      expect(document.activeElement).toBe(q('hunk-prev'));

      key('ArrowLeft');
      expect(document.activeElement).toBe(q('hunk-revert'));

      key('Home');
      expect(document.activeElement).toBe(q('hunk-prev'));
    });

    it('keeps disabled actions in the arrow order', () => {
      host.comparison.set('branch');
      fixture.detectChanges();
      (q('hunk-next') as HTMLButtonElement).focus();
      key('ArrowRight');
      expect(document.activeElement).toBe(q('hunk-stage'));
    });
  });
});

/**
 * Mirrors `PierreDiffHostComponent`'s hunk rows: one `[data-hunk-index]` row
 * per hunk under one container, inside a focusable section.
 */
@Component({
  standalone: true,
  imports: [HunkToolbarComponent],
  template: `
    <section tabindex="-1" data-testid="section">
      <div data-testid="rows">
        @for (h of hunks(); track h.index) {
          <div [attr.data-hunk-index]="h.index">
            <ptah-hunk-toolbar
              [hunk]="h"
              [hunkCount]="hunks().length"
              comparison="worktree"
              [entryKey]="key"
              [snapshotToken]="token()"
            />
          </div>
        }
      </div>
    </section>
    <button type="button" data-testid="elsewhere">elsewhere</button>
  `,
})
class RowsHostComponent {
  readonly hunks = signal([hunk(0), hunk(1)]);
  readonly token = signal('tok-1');
  readonly key = KEY;
}

describe('HunkToolbarComponent focus after its hunk is applied away', () => {
  let fixture: ComponentFixture<RowsHostComponent>;
  let entries: ReturnType<typeof signal<ReadonlyMap<string, ReviewDiffEntry>>>;
  let applyHunks: jest.Mock<Promise<GitApplyHunksResult>, [HunkApplyRequest]>;

  function setEntryDiff(diff: DiffTabState): void {
    entries.set(
      new Map([[KEY, { key: KEY, diff } as unknown as ReviewDiffEntry]]),
    );
  }

  function row(index: number): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-hunk-index="${index}"]`,
    ) as HTMLElement;
  }

  function q(testId: string): HTMLElement {
    return (fixture.nativeElement as HTMLElement).querySelector(
      `[data-testid="${testId}"]`,
    ) as HTMLElement;
  }

  async function settle(): Promise<void> {
    await fixture.whenStable();
    fixture.detectChanges();
  }

  /** Accept hunk `index` from its focused button, then land the re-read without it. */
  async function acceptAndReread(
    index: number,
    remaining: readonly GitHunkRef[],
  ): Promise<void> {
    const accept = row(index).querySelector<HTMLButtonElement>(
      '[data-testid="hunk-stage"]',
    ) as HTMLButtonElement;
    accept.focus();
    accept.click();
    await settle();
    setEntryDiff(diffState('tok-2'));
    fixture.componentInstance.token.set('tok-2');
    fixture.componentInstance.hunks.set([...remaining]);
    await settle();
  }

  beforeEach(() => {
    entries = signal<ReadonlyMap<string, ReviewDiffEntry>>(new Map());
    applyHunks = jest.fn().mockResolvedValue({ success: true });
    TestBed.configureTestingModule({
      imports: [RowsHostComponent],
      providers: [
        { provide: ReviewDiffService, useValue: { entries, applyHunks } },
      ],
    });
    fixture = TestBed.createComponent(RowsHostComponent);
    setEntryDiff(diffState('tok-1'));
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it('moves focus to the nearest remaining hunk instead of <body>', async () => {
    await acceptAndReread(1, [hunk(0)]);
    expect(row(1)).toBeNull();
    const stop = row(0).querySelector('[role="toolbar"] [tabindex="0"]');
    expect(stop).not.toBeNull();
    expect(document.activeElement).toBe(stop);
  });

  it('falls back to the focusable section when no hunk remains', async () => {
    await acceptAndReread(0, []);
    expect(document.activeElement).toBe(q('section'));
  });

  it('leaves focus alone when the user already moved it elsewhere', async () => {
    const accept = row(1).querySelector<HTMLButtonElement>(
      '[data-testid="hunk-stage"]',
    ) as HTMLButtonElement;
    accept.focus();
    accept.click();
    await settle();
    q('elsewhere').focus();

    setEntryDiff(diffState('tok-2'));
    fixture.componentInstance.token.set('tok-2');
    fixture.componentInstance.hunks.set([hunk(0)]);
    await settle();

    expect(document.activeElement).toBe(q('elsewhere'));
  });
});
