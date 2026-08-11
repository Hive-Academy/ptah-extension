/**
 * SourceControlPanelComponent specs — D1 (TASK_2026_173).
 *
 * Both section headers used to be a single `<button>` with the stage-all /
 * unstage-all `<button>` nested INSIDE it. Nested interactive content inside a
 * `<button>` is invalid HTML — the browser flattens it — and it is why
 * `onStageAll` / `onUnstageAll` had to call `event.stopPropagation()`: without
 * that, staging everything also collapsed the section you were looking at.
 *
 * Each header is now a presentational row holding a disclosure `<button>` and
 * the bulk-action `<button>` as SIBLINGS, both handlers take no event, and the
 * disclosure state is announced via `aria-expanded` + `aria-controls` instead
 * of being carried by the chevron glyph alone.
 */

import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule } from 'lucide-angular';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import type { GitFileStatus } from '@ptah-extension/shared';
import { SourceControlPanelComponent } from './source-control-panel.component';
import { SourceControlFileComponent } from './source-control-file.component';
import { SourceControlService } from '../services/source-control.service';

/**
 * The worktree section pulls WorktreeService / EditorService / the Electron
 * layout service, none of which this suite is about — stub the selector out.
 */
@Component({
  selector: 'ptah-worktree-section',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: '',
})
class StubWorktreeSectionComponent {}

/** Every element a keyboard user or the browser treats as interactive. */
const INTERACTIVE = 'a[href], button, input, select, textarea, [tabindex]';

function makeSourceControlStub() {
  return {
    stageFile: jest.fn(async () => undefined),
    unstageFile: jest.fn(async () => undefined),
    discardChanges: jest.fn(async () => undefined),
    stageAll: jest.fn(async () => undefined),
    unstageAll: jest.fn(async () => undefined),
    commit: jest.fn(async () => ({ success: true })),
  } as unknown as SourceControlService & {
    stageAll: jest.Mock;
    unstageAll: jest.Mock;
  };
}

@Component({
  standalone: true,
  imports: [SourceControlPanelComponent],
  template: `<ptah-source-control-panel [files]="files()" />`,
})
class HostComponent {
  readonly files = signal<GitFileStatus[]>([
    { path: 'src/a.ts', status: 'M', staged: true } as GitFileStatus,
    { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
  ]);
}

describe('SourceControlPanelComponent — header controls are siblings, not nested (D1)', () => {
  let fixture: ComponentFixture<HostComponent>;
  let sourceControl: ReturnType<typeof makeSourceControlStub>;

  function q<T extends HTMLElement>(selector: string): T {
    const el = fixture.nativeElement.querySelector(selector) as T | null;
    expect(el).toBeTruthy();
    return el as T;
  }

  const stagedToggle = () =>
    q<HTMLButtonElement>('button[aria-label="Toggle staged changes section"]');
  const unstagedToggle = () =>
    q<HTMLButtonElement>('button[aria-label="Toggle changes section"]');
  const unstageAll = () =>
    q<HTMLButtonElement>('button[aria-label="Unstage all files"]');
  const stageAll = () =>
    q<HTMLButtonElement>('button[aria-label="Stage all files"]');

  function clickReal(el: HTMLElement): void {
    el.dispatchEvent(
      new MouseEvent('click', { bubbles: true, cancelable: true }),
    );
  }

  beforeEach(() => {
    sourceControl = makeSourceControlStub();
    TestBed.configureTestingModule({
      imports: [HostComponent],
      providers: [{ provide: SourceControlService, useValue: sourceControl }],
    });
    TestBed.overrideComponent(SourceControlPanelComponent, {
      set: {
        imports: [
          FormsModule,
          LucideAngularModule,
          SourceControlFileComponent,
          StubWorktreeSectionComponent,
        ],
      },
    });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jest.clearAllMocks();
  });

  // -- AC1 -------------------------------------------------------------------

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

  it('keeps each bulk action a sibling of its disclosure toggle (AC1)', () => {
    expect(unstageAll().parentElement).toBe(stagedToggle().parentElement);
    expect(stageAll().parentElement).toBe(unstagedToggle().parentElement);
    expect(stagedToggle().contains(unstageAll())).toBe(false);
    expect(unstagedToggle().contains(stageAll())).toBe(false);
    // The header row itself is not a control.
    expect(stagedToggle().parentElement?.tagName).toBe('DIV');
  });

  // -- AC3/AC4: the disclosure state is announced ----------------------------

  it('announces the disclosure state and the region each toggle controls (AC3, AC4)', () => {
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');

    const stagedRegionId = stagedToggle().getAttribute('aria-controls');
    expect(stagedRegionId).toBeTruthy();
    const stagedRegion = document.getElementById(
      stagedRegionId as string,
    ) as HTMLElement | null;
    expect(stagedRegion).toBeTruthy();
    expect(stagedRegion?.getAttribute('aria-label')).toBe('Staged files');

    // Every toggle points at a DIFFERENT region.
    expect(unstagedToggle().getAttribute('aria-controls')).not.toBe(
      stagedRegionId,
    );

    clickReal(stagedToggle());
    fixture.detectChanges();

    expect(stagedToggle().getAttribute('aria-expanded')).toBe('false');
    // The other section is untouched.
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
    expect(
      fixture.nativeElement.querySelector('[aria-label="Staged files"]'),
    ).toBeNull();
  });

  it('labels every header control distinctly (AC4)', () => {
    const labels = [
      stagedToggle(),
      unstageAll(),
      unstagedToggle(),
      stageAll(),
    ].map((b) => b.getAttribute('aria-label'));

    expect(labels).toEqual([
      'Toggle staged changes section',
      'Unstage all files',
      'Toggle changes section',
      'Stage all files',
    ]);
    expect(new Set(labels).size).toBe(labels.length);
  });

  // -- AC5: isolation without stopPropagation --------------------------------

  it('unstages everything WITHOUT collapsing the staged section (AC5)', () => {
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');

    clickReal(unstageAll());
    fixture.detectChanges();

    expect(sourceControl.unstageAll).toHaveBeenCalledTimes(1);
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('stages everything WITHOUT collapsing the changes section (AC5)', () => {
    clickReal(stageAll());
    fixture.detectChanges();

    expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('lets the bulk-action click keep bubbling — isolation is structural, not a stopped event (AC5)', () => {
    const reachedRoot: string[] = [];
    fixture.nativeElement.addEventListener('click', () => {
      reachedRoot.push('root');
    });

    clickReal(stageAll());
    fixture.detectChanges();

    // Nothing suppresses propagation any more; the toggle simply is not an
    // ancestor of the bulk-action button.
    expect(reachedRoot).toEqual(['root']);
    expect(sourceControl.stageAll).toHaveBeenCalledTimes(1);
    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('still toggles the section when the disclosure button itself is clicked (AC5)', () => {
    clickReal(unstagedToggle());
    fixture.detectChanges();

    expect(unstagedToggle().getAttribute('aria-expanded')).toBe('false');
    expect(sourceControl.stageAll).not.toHaveBeenCalled();
  });

  // -- AC2/AC7 ---------------------------------------------------------------

  it('gives each header control independent keyboard focus and a focus ring (AC2, AC7)', () => {
    // jsdom does not implement the UA default action that turns Enter/Space on
    // a <button> into a click, so the key press itself cannot be asserted
    // here. What is asserted is the property that buys it unconditionally:
    // four separate, natively focusable, in-tab-order <button>s.
    const controls = [
      stagedToggle(),
      unstageAll(),
      unstagedToggle(),
      stageAll(),
    ];
    for (const el of controls) {
      expect(el.tagName).toBe('BUTTON');
      expect(el.type).toBe('button');
      expect(el.getAttribute('tabindex')).toBeNull();
      el.focus();
      expect(document.activeElement).toBe(el);
      expect(el.className).toContain('focus-visible:outline-2');
    }
    expect(new Set(controls).size).toBe(4);
  });

  // -- AC6 -------------------------------------------------------------------

  it('keeps the header chrome — including the shared opacity — on the header row (AC6)', () => {
    const row = stagedToggle().parentElement as HTMLElement;
    for (const cls of [
      'flex',
      'items-center',
      'gap-1',
      'w-full',
      'px-2',
      'py-1',
      'text-[10px]',
      'font-semibold',
      'uppercase',
      'tracking-wider',
      'bg-base-200',
      'transition-opacity',
    ]) {
      expect(row.className).toContain(cls);
    }
    // opacity-70/hover:opacity-100 stays on the ROW, not on the toggle, so the
    // bulk-action button's resting opacity is exactly what it was before.
    expect(row.className).toContain('opacity-70');
    expect(row.className).toContain('hover:opacity-100');
    expect(unstageAll().className).not.toContain('opacity-70');

    // The bulk action is still pushed to the right edge and is always visible
    // (these two are NOT hover-gated, unlike the tab close and the row actions).
    expect(unstageAll().className).toContain('ml-auto');
    expect(unstageAll().className).toContain('btn-ghost');
    expect(unstageAll().className).not.toContain('opacity-0');
  });

  it('repeats `uppercase` on the toggle, which the button preflight would otherwise strip (AC6)', () => {
    // Tailwind preflight sets `text-transform: none` on <button>. Now that the
    // header text lives INSIDE a button instead of being the button, the
    // inherited `uppercase` from the row is reset and the label silently drops
    // out of caps — measured as a 108.39px -> 96.78px label in Chromium before
    // this class was added back. jsdom applies no stylesheet, so assert the
    // class rather than the computed style.
    expect(stagedToggle().className).toContain('uppercase');
    expect(unstagedToggle().className).toContain('uppercase');
  });

  // -- TASK_2026_211: empty-state list ownership ------------------------------

  /**
   * Every element child of a `role="list"` that the accessibility tree does
   * NOT resolve to a `listitem`.
   *
   * The walk descends through `role="presentation"` / `role="none"` hosts and
   * nothing else, which is exactly how an owned-element check resolves this
   * panel's markup: `<ptah-source-control-file>` carries `role="presentation"`
   * on its host precisely so the `role="listitem"` div inside it is owned by
   * the list. Anything else — notably a bare `<div>`, whose implicit role is
   * `generic` — is an unowned child and a critical `aria-required-children`
   * violation.
   */
  function unownedChildren(list: HTMLElement): HTMLElement[] {
    const offenders: HTMLElement[] = [];
    const visit = (parent: Element): void => {
      for (const child of Array.from(parent.children) as HTMLElement[]) {
        const role = child.getAttribute('role');
        if (role === 'listitem') continue;
        if (role === 'presentation' || role === 'none') {
          visit(child);
          continue;
        }
        offenders.push(child);
      }
    };
    visit(list);
    return offenders;
  }

  const lists = () =>
    Array.from(
      fixture.nativeElement.querySelectorAll('[role="list"]'),
    ) as HTMLElement[];

  it('detects an unowned child — the checker above is not vacuous (TASK_2026_211)', () => {
    // Without this, every assertion below would still pass if `unownedChildren`
    // silently returned []. Re-creates the exact defect shape: a bare <div>
    // dropped straight into the list region.
    const [staged] = lists();
    const bare = document.createElement('div');
    bare.textContent = 'No staged changes';
    staged.appendChild(bare);

    expect(unownedChildren(staged)).toEqual([bare]);

    staged.removeChild(bare);
    expect(unownedChildren(staged)).toEqual([]);
  });

  it('owns the empty-state message of BOTH sections as a listitem (TASK_2026_211)', () => {
    fixture.componentInstance.files.set([]);
    fixture.detectChanges();

    const regions = lists();
    expect(regions.length).toBe(2);

    for (const region of regions) {
      // The section is empty, so the empty-state message is the only child —
      // and it must be the list's own item, not an orphan inside it.
      expect(unownedChildren(region)).toEqual([]);
      expect(region.children.length).toBe(1);
      expect(region.children[0].getAttribute('role')).toBe('listitem');
    }

    expect(regions.map((r) => (r.textContent ?? '').trim())).toEqual([
      'No staged changes',
      'No changes',
    ]);
  });

  it('keeps both empty-state messages visually unchanged (TASK_2026_211)', () => {
    fixture.componentInstance.files.set([]);
    fixture.detectChanges();

    for (const region of lists()) {
      const message = region.children[0] as HTMLElement;
      // role= is the whole change; the presentation must not have moved.
      for (const cls of [
        'px-3',
        'py-2',
        'text-[10px]',
        'opacity-40',
        'text-center',
      ]) {
        expect(message.className).toContain(cls);
      }
    }
  });

  it('owns every child in the half-empty and populated states too (TASK_2026_211)', () => {
    // Populated on both sides (the fixture default) — the state Batch 6's own
    // axe run used, which is why it never saw the defect.
    for (const region of lists()) {
      expect(unownedChildren(region)).toEqual([]);
    }

    // One side empty, one side populated — the mixed case neither the
    // populated run nor a both-empty run would cover.
    fixture.componentInstance.files.set([
      { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();

    const regions = lists();
    expect(regions.length).toBe(2);
    expect(unownedChildren(regions[0])).toEqual([]);
    expect(regions[0].children[0].getAttribute('role')).toBe('listitem');
    expect((regions[0].textContent ?? '').trim()).toBe('No staged changes');
    expect(unownedChildren(regions[1])).toEqual([]);
  });

  it('hides each bulk action when its section is empty (AC6)', () => {
    fixture.componentInstance.files.set([
      { path: 'src/b.ts', status: 'A', staged: false } as GitFileStatus,
    ]);
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector(
        'button[aria-label="Unstage all files"]',
      ),
    ).toBeNull();
    expect(stageAll()).toBeTruthy();
    // The toggle is unaffected by the action's absence.
    expect(stagedToggle().getAttribute('aria-expanded')).toBe('true');
  });
});
