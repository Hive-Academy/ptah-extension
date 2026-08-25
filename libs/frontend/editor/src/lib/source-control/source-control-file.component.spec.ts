/**
 * SourceControlFileComponent specs — D1 (TASK_2026_173).
 *
 * The row used to be a single `<button role="listitem">` with the stage /
 * unstage / discard `<button>`s nested INSIDE it. That is invalid HTML — the
 * browser flattens the inner buttons out of the parsed DOM — and it is the
 * only reason `onAction` ever needed `event.stopPropagation()`: without it a
 * click on "Discard" also fired the row's open-diff handler.
 *
 * The row is now a `<div role="listitem">` holding an open-diff `<button>` and
 * the action buttons as SIBLINGS, and `onAction` takes no event at all. These
 * specs pin that the isolation is STRUCTURAL: every assertion below dispatches
 * a real bubbling click and checks both that the action fired and that the
 * open-diff output did not — and one of them explicitly proves the click is
 * still allowed to bubble past the row, which is what makes the guarantee
 * independent of propagation suppression.
 */

import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitFileStatus } from '@ptah-extension/shared';
import type { OpenDiffRequest } from '../services/editor/editor-tab.types';
import { SourceControlFileComponent } from './source-control-file.component';

/** Every element a keyboard user or the browser treats as interactive. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex]';

@Component({
  standalone: true,
  imports: [SourceControlFileComponent],
  template: `
    <div role="list" aria-label="Test files">
      <ptah-source-control-file
        [file]="file()"
        [staged]="staged()"
        (stage)="stage.push($event)"
        (unstage)="unstage.push($event)"
        (discard)="discard.push($event)"
        (openDiff)="openDiff.push($event)"
      />
    </div>
  `,
})
class HostComponent {
  readonly file = signal<GitFileStatus>({
    path: 'libs/frontend/editor/src/a.ts',
    status: 'M',
    staged: false,
  } as GitFileStatus);
  readonly staged = signal(false);
  readonly stage: string[] = [];
  readonly unstage: string[] = [];
  readonly discard: string[] = [];
  readonly openDiff: OpenDiffRequest[] = [];
}

describe('SourceControlFileComponent — row actions are siblings, not nested (D1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HostComponent;

  function q<T extends HTMLElement>(selector: string): T {
    const el = fixture.nativeElement.querySelector(selector) as T | null;
    expect(el).toBeTruthy();
    return el as T;
  }

  function clickReal(el: HTMLElement): void {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  }

  const openDiffButton = () =>
    q<HTMLButtonElement>('button[aria-label^="Open diff for"]');
  const stageButton = () =>
    q<HTMLButtonElement>('button[aria-label="Stage file"]');
  const unstageButton = () =>
    q<HTMLButtonElement>('button[aria-label="Unstage file"]');
  const discardButton = () =>
    q<HTMLButtonElement>('button[aria-label="Discard changes"]');

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.componentInstance;
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  // -- AC1 ------------------------------------------------------------------

  it('renders no interactive element inside another interactive element (AC1)', () => {
    const nested: string[] = [];
    for (const el of fixture.nativeElement.querySelectorAll(INTERACTIVE)) {
      // The walk MUST start at the parent: `closest` matches the element
      // itself, so a self-comparing variant of this check silently passes
      // even on the pre-batch-6 nested markup.
      if ((el as HTMLElement).parentElement?.closest(INTERACTIVE)) {
        nested.push((el as HTMLElement).outerHTML.slice(0, 140));
      }
    }
    expect(nested).toEqual([]);
  });

  it('makes the row a listitem and the controls its siblings, not its children (AC1)', () => {
    const row = q<HTMLElement>('[role="listitem"]');
    expect(row.tagName).toBe('DIV');
    expect(row.querySelector('button[role="listitem"]')).toBeNull();

    // The open-diff button and the action cluster are siblings under the row.
    expect(openDiffButton().parentElement).toBe(row);
    expect(openDiffButton().contains(discardButton())).toBe(false);
    expect(discardButton().closest('button')).toBe(discardButton());

    // The component host sits between role="list" and role="listitem", so it
    // is marked presentational to keep the listitem owned by the list.
    const hostEl = q<HTMLElement>('ptah-source-control-file');
    expect(hostEl.getAttribute('role')).toBe('presentation');
    expect(hostEl.parentElement?.getAttribute('role')).toBe('list');
  });

  // -- AC5: isolation without stopPropagation --------------------------------

  it('discards without opening the diff (AC5)', () => {
    clickReal(discardButton());

    expect(host.discard).toEqual(['libs/frontend/editor/src/a.ts']);
    expect(host.openDiff).toEqual([]);
  });

  it('stages without opening the diff, and unstages without opening it (AC5)', () => {
    clickReal(stageButton());
    expect(host.stage).toEqual(['libs/frontend/editor/src/a.ts']);
    expect(host.openDiff).toEqual([]);

    host.staged.set(true);
    fixture.detectChanges();

    clickReal(unstageButton());
    expect(host.unstage).toEqual(['libs/frontend/editor/src/a.ts']);
    expect(host.openDiff).toEqual([]);
  });

  it('lets the action click keep bubbling — the isolation is structural, not a stopped event (AC5)', () => {
    const reachedRoot: string[] = [];
    fixture.nativeElement.addEventListener('click', () => {
      reachedRoot.push('root');
    });

    clickReal(discardButton());

    // Not swallowed: the event still reaches an ancestor listener. Nothing
    // calls stopPropagation() any more — the open-diff button simply is not
    // an ancestor of the discard button.
    expect(reachedRoot).toEqual(['root']);
    expect(host.openDiff).toEqual([]);
  });

  it('opens the diff for the comparison the row stands for (AC5)', () => {
    clickReal(openDiffButton());

    expect(host.openDiff).toEqual([
      { path: 'libs/frontend/editor/src/a.ts', comparison: 'worktree' },
    ]);
    expect(host.stage).toEqual([]);
    expect(host.discard).toEqual([]);
  });

  // -- AC2/AC4/AC7 -----------------------------------------------------------

  it('gives every control a distinct label and independent keyboard focus (AC2, AC4)', () => {
    const labels = [...fixture.nativeElement.querySelectorAll('button')].map(
      (b) => (b as HTMLButtonElement).getAttribute('aria-label'),
    );

    expect(labels).toEqual([
      'Open diff for a.ts',
      'Stage file',
      'Discard changes',
    ]);
    expect(new Set(labels).size).toBe(labels.length);

    // Every one is a natively focusable <button> in the tab order, which is
    // what buys Enter/Space activation from the user agent unconditionally.
    // (jsdom does not implement that default action, so the key press itself
    // cannot be asserted here.)
    for (const el of fixture.nativeElement.querySelectorAll('button')) {
      const btn = el as HTMLButtonElement;
      expect(btn.type).toBe('button');
      expect(btn.getAttribute('tabindex')).toBeNull();
      btn.focus();
      expect(document.activeElement).toBe(btn);
    }
  });

  it('reveals the hover-gated action cluster on keyboard focus (AC7)', () => {
    const cluster = q<HTMLElement>('.group-hover\\:opacity-100');
    expect(cluster.className).toContain('opacity-0');
    expect(cluster.className).toContain('focus-within:opacity-100');

    for (const el of fixture.nativeElement.querySelectorAll('button')) {
      expect((el as HTMLElement).className).toContain(
        'focus-visible:outline-2',
      );
    }
  });

  // -- AC6 -------------------------------------------------------------------

  it('keeps the row chrome, hover state and status badge on the row (AC6)', () => {
    const row = q<HTMLElement>('[role="listitem"]');
    for (const cls of [
      'group',
      'flex',
      'items-center',
      'gap-1.5',
      'w-full',
      'px-2',
      'py-0.5',
      'text-xs',
      'hover:bg-base-content/10',
      'transition-colors',
    ]) {
      expect(row.className).toContain(cls);
    }

    // Status badge is still the last child of the row, outside every control.
    const badge = row.lastElementChild as HTMLElement;
    expect(badge.textContent?.trim()).toBe('M');
    expect(badge.closest('button')).toBeNull();
  });

  it('still carries the rename-aware row title (AC6)', () => {
    host.file.set({
      path: 'src/new.ts',
      origPath: 'src/old.ts',
      status: 'R',
      staged: true,
    } as GitFileStatus);
    host.staged.set(true);
    fixture.detectChanges();

    expect(openDiffButton().getAttribute('title')).toBe(
      'src/old.ts → src/new.ts',
    );

    clickReal(openDiffButton());
    expect(host.openDiff).toEqual([
      { path: 'src/new.ts', comparison: 'staged', origPath: 'src/old.ts' },
    ]);
  });
});
