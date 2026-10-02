/**
 * Accessibility gate for `GitConfirmDialogComponent`.
 *
 * Ports every case of `diff-view/diff-view-dialog.a11y.spec.ts` (the axe scan,
 * the proof that its load-bearing rules ran, and the proof that the dialog
 * itself was scanned) onto the extracted primitive, for both tones, and adds
 * the behavioural half axe cannot see: Cancel-first focus, the Tab trap, both
 * Escape routes, focus restore, no backdrop dismiss and unmount-while-open.
 *
 * jsdom has no layout, compositing or hit-testing, so rendering-dependent axe
 * rules are switched off below rather than left on to produce noise. Whether
 * the dialog really reaches the top layer is proven only in the live-host e2e
 * specs; this file covers the structural and keyboard contract.
 */

import axe from 'axe-core';
import { Component, signal, viewChild } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import type { ComponentFixture } from '@angular/core/testing';
import {
  GitConfirmDialogComponent,
  type GitConfirmDialogTone,
} from './git-confirm-dialog.component';

/**
 * jsdom implements no `HTMLDialogElement` methods, so `showModal()` would
 * throw the moment the dialog opens. Reflecting the `open` attribute is enough
 * for axe, which reads the DOM and not the top layer.
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

  // jsdom has no hit-testing. axe calls `elementFromPoint` while looking for
  // the topmost modal; when it throws, every downstream rule (including
  // `aria-dialog-name` and `button-name`) lands in `incomplete` and the scan
  // reports zero violations whatever the markup says. Returning null says
  // "nothing is under that point" without claiming any element is on top.
  const doc = document as Document & {
    elementFromPoint?: (x: number, y: number) => Element | null;
    elementsFromPoint?: (x: number, y: number) => Element[];
  };
  if (!doc.elementFromPoint) doc.elementFromPoint = () => null;
  if (!doc.elementsFromPoint) doc.elementsFromPoint = () => [];
});

/** Rules jsdom cannot evaluate (each needs a rendered box), not rules failed. */
const RULES_JSDOM_CANNOT_EVALUATE = [
  'color-contrast',
  'target-size',
  'scrollable-region-focusable',
] as const;

/**
 * Lower bound on rules that must have RUN for a clean result to mean
 * anything; far below the observed count so it fails on a broken
 * configuration rather than on axe shipping a new rule.
 */
const MIN_RULES_EXERCISED = 10;

/** The rules that carry this dialog's contract. */
const LOAD_BEARING_RULES = [
  'aria-dialog-name',
  'aria-required-attr',
  'aria-valid-attr-value',
  'button-name',
] as const;

const TONES: readonly GitConfirmDialogTone[] = ['danger', 'warning'];

type AxeCheckable = Parameters<typeof axe.run>[0];

async function scan(element: HTMLElement): Promise<axe.AxeResults> {
  return axe.run(element as AxeCheckable, {
    rules: Object.fromEntries(
      RULES_JSDOM_CANNOT_EVALUATE.map((id) => [id, { enabled: false }]),
    ),
  });
}

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

@Component({
  standalone: true,
  imports: [GitConfirmDialogComponent],
  template: `
    <button type="button" data-testid="invoker">Drop stash</button>
    @if (mounted()) {
      <ptah-git-confirm-dialog
        title="Drop this stash?"
        description="The stashed changes will be deleted and cannot be recovered."
        confirmLabel="Drop stash"
        [tone]="tone()"
        (confirmed)="confirmed = confirmed + 1"
        (cancelled)="cancelled = cancelled + 1"
      />
    }
  `,
})
class HostComponent {
  readonly mounted = signal(true);
  readonly tone = signal<GitConfirmDialogTone>('danger');
  readonly dialog = viewChild(GitConfirmDialogComponent);
  confirmed = 0;
  cancelled = 0;
}

function query(
  fixture: ComponentFixture<HostComponent>,
  testId: string,
): HTMLElement | null {
  return fixture.nativeElement.querySelector(`[data-testid="${testId}"]`);
}

function required(
  fixture: ComponentFixture<HostComponent>,
  testId: string,
): HTMLElement {
  const element = query(fixture, testId);
  if (!element) throw new Error(`[data-testid="${testId}"] is not rendered`);
  return element;
}

function key(target: HTMLElement, keyName: string, shiftKey = false): void {
  target.dispatchEvent(
    new KeyboardEvent('keydown', {
      key: keyName,
      shiftKey,
      bubbles: true,
      cancelable: true,
    }),
  );
}

async function openDialog(tone: GitConfirmDialogTone = 'danger'): Promise<{
  fixture: ComponentFixture<HostComponent>;
  dialog: HTMLElement;
  invoker: HTMLElement;
}> {
  await TestBed.configureTestingModule({
    imports: [HostComponent],
  }).compileComponents();

  const fixture = TestBed.createComponent(HostComponent);
  // Attached so `focus()` and `isConnected` behave as they do in a page.
  document.body.appendChild(fixture.nativeElement);
  fixture.componentInstance.tone.set(tone);
  fixture.detectChanges();

  const invoker = required(fixture, 'invoker');
  invoker.focus();
  fixture.componentInstance.dialog()?.open(invoker);
  fixture.detectChanges();

  const dialog = query(fixture, 'git-confirm-dialog');
  // Guard, not decoration: every assertion below is vacuous if the dialog
  // never opened, and a silently-empty scan is what this file prevents.
  if (!dialog) {
    throw new Error(
      'git-confirm-dialog did not open — the checks below would have passed ' +
        'against nothing.',
    );
  }
  return { fixture, dialog, invoker };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('GitConfirmDialogComponent — axe', () => {
  for (const tone of TONES) {
    describe(`tone ${tone}`, () => {
      it('the open dialog has no axe violations', async () => {
        const { dialog } = await openDialog(tone);

        const results = await scan(dialog);

        expect(describeViolations(results)).toBe('');
        expect(results.violations).toHaveLength(0);
      });

      it('exercised its load-bearing rules, so a clean result means something', async () => {
        const { dialog } = await openDialog(tone);

        const results = await scan(dialog);

        expect(results.passes.length).toBeGreaterThanOrEqual(
          MIN_RULES_EXERCISED,
        );
        const ran = new Set(
          [...results.passes, ...results.violations, ...results.incomplete].map(
            (r) => r.id,
          ),
        );
        for (const rule of LOAD_BEARING_RULES) {
          expect(ran.has(rule)).toBe(true);
        }
        // `incomplete` is a rule silently not being enforced.
        expect(results.incomplete.map((r) => r.id)).toEqual([]);
      });

      it('scans the dialog itself, not an ancestor that happens to contain it', async () => {
        const { dialog } = await openDialog(tone);

        expect(dialog.tagName).toBe('DIALOG');
        expect(dialog.getAttribute('role')).toBe('alertdialog');
      });
    });
  }
});

describe('GitConfirmDialogComponent — dialog contract', () => {
  it('is labelled and described by its own title and description', async () => {
    const { dialog } = await openDialog();

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    const title = document.getElementById(
      dialog.getAttribute('aria-labelledby') ?? '',
    );
    const description = document.getElementById(
      dialog.getAttribute('aria-describedby') ?? '',
    );
    expect(title?.textContent?.trim()).toBe('Drop this stash?');
    expect(description?.textContent?.trim()).toBe(
      'The stashed changes will be deleted and cannot be recovered.',
    );
  });

  it('opens in the top layer with focus on Cancel', async () => {
    const { fixture, dialog } = await openDialog();

    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(document.activeElement).toBe(
      required(fixture, 'git-confirm-cancel'),
    );
  });

  it('uses a solid AA-safe fill for each tone', async () => {
    const danger = await openDialog('danger');
    const dangerClasses = required(
      danger.fixture,
      'git-confirm-confirm',
    ).classList;
    expect(dangerClasses).toContain('btn-error');
    expect(dangerClasses).toContain('err-solid-text');
    expect(dangerClasses).not.toContain('btn-outline');

    danger.fixture.componentInstance.tone.set('warning');
    danger.fixture.detectChanges();
    const warningClasses = required(
      danger.fixture,
      'git-confirm-confirm',
    ).classList;
    expect(warningClasses).toContain('btn-warning');
    expect(warningClasses).not.toContain('btn-error');
  });

  it('confirm emits confirmed once, closes, and restores focus to the invoker', async () => {
    const { fixture, invoker } = await openDialog();

    required(fixture, 'git-confirm-confirm').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.confirmed).toBe(1);
    expect(fixture.componentInstance.cancelled).toBe(0);
    expect(query(fixture, 'git-confirm-dialog')).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it('cancel emits cancelled once, closes, and restores focus to the invoker', async () => {
    const { fixture, invoker } = await openDialog();

    required(fixture, 'git-confirm-cancel').click();
    fixture.detectChanges();

    expect(fixture.componentInstance.cancelled).toBe(1);
    expect(fixture.componentInstance.confirmed).toBe(0);
    expect(query(fixture, 'git-confirm-dialog')).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it('Escape keydown cancels and does not reach anything behind the dialog', async () => {
    const { fixture, dialog, invoker } = await openDialog();
    const behind = jest.fn();
    document.body.addEventListener('keydown', behind);

    key(required(fixture, 'git-confirm-cancel'), 'Escape');
    fixture.detectChanges();

    document.body.removeEventListener('keydown', behind);
    expect(behind).not.toHaveBeenCalled();
    expect(fixture.componentInstance.cancelled).toBe(1);
    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).toBe(invoker);
  });

  it("the UA's cancel event is the same Cancel, not a bare close", async () => {
    const { fixture, dialog, invoker } = await openDialog();
    const event = new Event('cancel', { cancelable: true });

    dialog.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(true);
    expect(fixture.componentInstance.cancelled).toBe(1);
    expect(query(fixture, 'git-confirm-dialog')).toBeNull();
    expect(document.activeElement).toBe(invoker);
  });

  it('Tab and Shift+Tab stay between Cancel and Confirm', async () => {
    const { fixture } = await openDialog();
    const cancel = required(fixture, 'git-confirm-cancel');
    const confirm = required(fixture, 'git-confirm-confirm');

    key(cancel, 'Tab');
    expect(document.activeElement).toBe(confirm);
    key(confirm, 'Tab');
    expect(document.activeElement).toBe(cancel);
    key(cancel, 'Tab', true);
    expect(document.activeElement).toBe(confirm);
    key(confirm, 'Tab', true);
    expect(document.activeElement).toBe(cancel);
  });

  it('has no backdrop that dismisses it', async () => {
    const { fixture, dialog } = await openDialog();
    const backdrop = dialog.querySelector('.modal-backdrop') as HTMLElement;

    expect(backdrop.getAttribute('aria-hidden')).toBe('true');
    expect(backdrop.querySelector('form, button')).toBeNull();
    backdrop.click();
    fixture.detectChanges();

    expect((dialog as HTMLDialogElement).open).toBe(true);
    expect(fixture.componentInstance.cancelled).toBe(0);
  });

  it('a second open while open does not re-target the focus restore', async () => {
    const { fixture, invoker } = await openDialog();
    const other = document.createElement('button');
    document.body.appendChild(other);

    fixture.componentInstance.dialog()?.open(other);
    fixture.detectChanges();
    required(fixture, 'git-confirm-cancel').click();
    fixture.detectChanges();

    expect(document.activeElement).toBe(invoker);
  });

  it('unmounting while open closes it and restores focus, emitting nothing', async () => {
    const { fixture, dialog, invoker } = await openDialog();

    fixture.componentInstance.mounted.set(false);
    fixture.detectChanges();

    expect((dialog as HTMLDialogElement).open).toBe(false);
    expect(document.activeElement).toBe(invoker);
    expect(fixture.componentInstance.cancelled).toBe(0);
    expect(fixture.componentInstance.confirmed).toBe(0);
  });
});
