/**
 * Accessibility gate for the editor's confirmation dialog (TASK_2026_215).
 *
 * WHY THIS FILE EXISTS
 *
 * TASK_2026_173 Batch 6 and Batch 7 both PROVED their dialog a11y claims with
 * `axe-core`, and both did it with throwaway specs that were deleted the same
 * day. `axe-core` itself was never declared — it was reached transitively
 * through `@axe-core/playwright`, so an import of it worked by hoisting luck
 * and would have broken silently on a dependency bump. Batch 6 and Batch 7 were
 * both fenced to `libs/frontend/editor/**` and declaring a dependency means
 * editing the root `package.json`, so neither could close it. That is the whole
 * of TASK_2026_215: `axe-core` is now a declared devDependency, and the probe is
 * permanent instead of remembered.
 *
 * WHAT THIS CAN AND CANNOT PROVE
 *
 * jsdom has no layout, no compositing and no hit-testing, so the axe rules that
 * depend on rendering are meaningless here and are switched off below rather
 * than left on to produce reassuring noise. `color-contrast` is the obvious
 * one; so is anything that reasons about whether an element is visually
 * obscured. What survives is the structural half of the dialog contract —
 * roles, accessible names, ARIA validity, id references, nesting — which is
 * exactly the half that regresses when someone edits the markup.
 *
 * axe ALSO has no rule for focus trapping at all. It could not have caught
 * Batch 7's Serious 2, and it cannot catch its recurrence. The behavioural
 * assertions that do cover that live alongside these in
 * `diff-view.component.spec.ts` (role/aria wiring, Cancel-first focus, Escape
 * and cancel routes) and in the live-host spec
 * `apps/ptah-electron-e2e/src/specs/editor/hunk-revert-top-layer.spec.ts`,
 * which is the only place the top layer is real. This file is an addition to
 * those, never a replacement.
 *
 * SCOPE
 *
 * The hunk-revert dialog in `DiffViewComponent` only. The two dialogs in
 * `EditorPanelComponent` (delete confirmation, name input) need that
 * component's large stub harness to mount and are covered by its own spec
 * file; extending this gate to them means adding cases there rather than
 * duplicating ~150 lines of stubs here.
 */

import axe from 'axe-core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import { DiffViewComponent } from './diff-view.component';
import { MonacoLoaderService } from '../services/monaco-loader.service';
import type {
  DiffSideRef,
  DiffTabState,
  EditorTab,
  GitHunkRef,
} from '../services/editor/editor-tab.types';
import { diffTabKey } from '../services/editor/editor-tab.types';

/**
 * jsdom implements no `HTMLDialogElement` methods, so the dialog's
 * `showModal()` would throw the moment it opens. Reflecting the `open`
 * attribute is enough for axe, which reads the DOM and not the top layer.
 */
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

  // jsdom implements no hit-testing, so `document.elementFromPoint` is absent.
  // axe calls it while looking for the topmost modal, the call THROWS, and
  // every rule downstream of that lookup is reported as `incomplete` with an
  // `error-occurred` check rather than as a pass or a violation — 17 of them
  // here, including `aria-dialog-name` and `button-name`. A scan in that state
  // reports zero violations no matter what the markup says.
  //
  // Returning null is the honest stand-in, not a convenience: it tells axe
  // "nothing is under that point", so it evaluates the tree without claiming
  // any element is on top. Whether this dialog really reaches the top layer is
  // precisely what jsdom cannot answer, and it is proven where it can be — in
  // `apps/ptah-electron-e2e/src/specs/editor/hunk-revert-top-layer.spec.ts`.
  const doc = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (!doc.elementFromPoint) doc.elementFromPoint = () => null;
  if (!doc.elementsFromPoint) doc.elementsFromPoint = () => [];
});

/**
 * Rules disabled because jsdom cannot evaluate them, NOT because the dialog
 * fails them. Each one needs a rendered box, and jsdom has none — leaving them
 * enabled would produce results that are noise in both directions.
 */
const RULES_JSDOM_CANNOT_EVALUATE = [
  'color-contrast',
  'target-size',
  'scrollable-region-focusable',
] as const;

/**
 * The lower bound on rules that must actually have RUN for a clean result to
 * mean anything.
 *
 * Without this, a mistake in the axe options — a bad selector, an over-broad
 * disable list, an element that was never in scope — produces zero violations
 * and a permanently green test that checks nothing. Deliberately far below the
 * observed count so it fails on a broken configuration rather than on axe
 * shipping a new rule.
 */
const MIN_RULES_EXERCISED = 10;

/**
 * The rules that carry this dialog's contract. If one of these stops running,
 * the scan is green for the wrong reason.
 */
const LOAD_BEARING_RULES = [
  'aria-dialog-name',
  'aria-required-attr',
  'aria-valid-attr-value',
  'button-name',
] as const;

type AxeCheckable = Parameters<typeof axe.run>[0];

async function scan(element: HTMLElement): Promise<axe.AxeResults> {
  return axe.run(element as AxeCheckable, {
    rules: Object.fromEntries(
      RULES_JSDOM_CANNOT_EVALUATE.map((id) => [id, { enabled: false }]),
    ),
  });
}

/** Readable failure text — the rule id plus the node axe objected to. */
function describeViolations(results: axe.AxeResults): string {
  return results.violations
    .map(
      (v) =>
        `${v.id} (${v.impact}): ${v.help}\n  ${v.nodes
          .map((n) => n.html)
          .join('\n  ')}`,
    )
    .join('\n');
}

function hunkRef(index: number, modifiedStart: number): GitHunkRef {
  return {
    index,
    originalStart: modifiedStart,
    originalLines: 3,
    modifiedStart,
    modifiedLines: 3,
    header: `@@ -${modifiedStart},3 +${modifiedStart},3 @@`,
  };
}

const TWENTY_LINES = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join(
  '\n',
);

function hunkTab(): EditorTab {
  const diff: DiffTabState = {
    comparison: 'worktree',
    path: 'src/index.ts',
    originalPath: 'src/index.ts',
    original: TWENTY_LINES,
    modified: TWENTY_LINES,
    originalRef: { kind: 'index' } as DiffSideRef,
    modifiedRef: { kind: 'worktree' } as DiffSideRef,
    snapshotToken: 'tok-1',
    hunks: [hunkRef(0, 2), hunkRef(1, 8), hunkRef(2, 14)],
    isBinary: false,
    status: 'fresh',
    requestId: 1,
  };
  return {
    filePath: diffTabKey(diff.comparison, diff.path),
    fileName: 'index.ts (working tree)',
    content: diff.modified,
    isDirty: false,
    diff,
  };
}

function query(
  fixture: ComponentFixture<DiffViewComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function click(
  fixture: ComponentFixture<DiffViewComponent>,
  testId: string,
): void {
  (query(fixture, testId) as HTMLButtonElement | null)?.click();
  fixture.detectChanges();
}

describe('DiffViewComponent hunk-revert dialog — axe (TASK_2026_215)', () => {
  const originalResizeObserver = globalThis.ResizeObserver;

  beforeAll(() => {
    // jsdom has no ResizeObserver; the component observes its own container.
    globalThis.ResizeObserver = class {
      observe(): void {
        /* no-op */
      }
      unobserve(): void {
        /* no-op */
      }
      disconnect(): void {
        /* no-op */
      }
    } as unknown as typeof ResizeObserver;
  });

  afterAll(() => {
    globalThis.ResizeObserver = originalResizeObserver;
  });

  async function openRevertDialog(): Promise<{
    fixture: ComponentFixture<DiffViewComponent>;
    dialog: HTMLElement;
  }> {
    await TestBed.configureTestingModule({
      imports: [DiffViewComponent],
      providers: [
        {
          provide: MonacoLoaderService,
          // The dialog is template state; Monaco is never needed to render it.
          useValue: { load: () => new Promise<never>(() => undefined) },
        },
      ],
    }).compileComponents();

    const fixture = TestBed.createComponent(DiffViewComponent);
    const tab = hunkTab();
    fixture.componentRef.setInput('diffTab', tab);
    fixture.componentRef.setInput('openDiffKeys', [tab.filePath]);
    // The toolbar is absent unless an apply handler is bound — see
    // `hunkActionsAvailable`. Without this there is no Discard button to press.
    fixture.componentRef.setInput('applyHunks', jest.fn());
    fixture.detectChanges();

    click(fixture, 'hunk-next');
    click(fixture, 'hunk-revert');

    const dialog = query(fixture, 'hunk-revert-dialog');
    // Guard, not decoration: every assertion below is vacuous if the dialog
    // never opened, and a silently-empty scan is the failure mode this whole
    // file exists to prevent.
    if (!dialog) {
      throw new Error(
        'hunk-revert-dialog did not open — the axe scan below would have ' +
          'passed against nothing. Check the toolbar affordance, not axe.',
      );
    }
    return { fixture, dialog };
  }

  it('the open dialog has no axe violations', async () => {
    const { dialog } = await openRevertDialog();

    const results = await scan(dialog);

    expect(describeViolations(results)).toBe('');
    expect(results.violations).toHaveLength(0);
  });

  it('exercised its load-bearing rules, so a clean result means something', async () => {
    const { dialog } = await openRevertDialog();

    const results = await scan(dialog);

    // `passes` counts rules that RAN and found compliant nodes. A
    // misconfigured scan reports zero of everything and would otherwise look
    // identical to a perfect one. Observed: 16.
    expect(results.passes.length).toBeGreaterThanOrEqual(MIN_RULES_EXERCISED);

    // The rules this gate is actually for. Named rather than counted, because
    // "16 rules ran" stays true while the four that matter quietly drop into
    // `incomplete` — which is exactly what a missing `elementFromPoint` did.
    const ran = new Set(
      [...results.passes, ...results.violations, ...results.incomplete].map(
        (r) => r.id,
      ),
    );
    for (const rule of LOAD_BEARING_RULES) {
      expect(ran.has(rule)).toBe(true);
    }

    // `incomplete` means axe could not decide. Any entry here is a rule
    // silently not being enforced, so it fails rather than being tolerated.
    expect(results.incomplete.map((r) => r.id)).toEqual([]);
  });

  it('scans the dialog itself, not an ancestor that happens to contain it', async () => {
    const { dialog } = await openRevertDialog();

    // If the element handed to axe were the component host, a violation
    // anywhere in the diff surface would be attributed to the dialog and a
    // dialog regression could be masked by an unrelated fix elsewhere.
    expect(dialog.tagName).toBe('DIALOG');
    expect(dialog.getAttribute('role')).toBe('alertdialog');
  });
});
