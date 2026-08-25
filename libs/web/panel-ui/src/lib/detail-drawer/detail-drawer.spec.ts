import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { DetailDrawer } from './detail-drawer';

/**
 * DetailDrawer's keyboard-reachability regression guard.
 *
 * 🔴 THIS SPEC EXISTS BECAUSE BATCH 15's AXE PASS FOUND A REAL `serious`
 * VIOLATION HERE, AND NOTHING IN THE TREE COULD SEE IT — the same sentence
 * `empty-state.spec.ts` opens with, about the same component library, two
 * batches apart.
 *
 * The defect: while CLOSED, the drawer's root carried `aria-hidden="true"` and
 * `pointer-events-none`, and its contents — the "Close panel" button, and
 * everything a consumer projects — REMAINED IN THE TAB ORDER.
 * `pointer-events-none` stops the mouse and does nothing at all to the
 * keyboard. axe reports that as `aria-hidden-focus`: focusable content inside
 * an `aria-hidden` subtree, i.e. a control a keyboard user can reach and a
 * screen-reader user cannot know exists.
 *
 * ⚠️ IT WAS INVISIBLE FOR FOUR PHASES FOR THREE REASONS AT ONCE — the same
 * three that hid B13's F-1:
 *   1. The Task 4.7 lint rule is scoped to `libs/web/members/**`; this file is
 *      in `libs/web/panel-ui/**` and no lint rule reads it.
 *   2. Every axe pass before Batch 15 loaded axe-core **4.10.2 from a CDN**,
 *      which did not report it. The pinned `@axe-core/playwright` 4.12.1
 *      dependency does.
 *   3. `panel-ui` had no spec for this component at all.
 *
 * The fix is `inert`, which is the one primitive that removes a subtree from
 * BOTH the tab order and the accessibility tree.
 */
@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailDrawer],
  template: `
    <ptah-detail-drawer [open]="open()" title="Webhook detail">
      <button type="button" data-projected>Projected action</button>
    </ptah-detail-drawer>
  `,
})
class HostComponent {
  public readonly open = signal(false);
}

describe('DetailDrawer', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    fixture.detectChanges();
  });

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  /** The `fixed inset-0` container that carries `aria-hidden` and `inert`. */
  function shell(): HTMLElement {
    const element = root().querySelector<HTMLElement>('.fixed');
    if (element === null) throw new Error('drawer shell not found');
    return element;
  }

  function setOpen(open: boolean): void {
    fixture.componentInstance.open.set(open);
    fixture.detectChanges();
  }

  it('🔴 while CLOSED it is aria-hidden AND inert — not merely pointer-blocked', () => {
    // 🔴 THE ASSERTION THE DEFECT WAS. `aria-hidden` without `inert` is exactly
    // the `aria-hidden-focus` violation: the contents stay tabbable while being
    // hidden from assistive technology.
    expect(shell().getAttribute('aria-hidden')).toBe('true');
    expect(shell().hasAttribute('inert')).toBe(true);
  });

  it('🔴 while OPEN it is neither aria-hidden nor inert', () => {
    // The other half, and the one a naive fix breaks: `inert` is a BOOLEAN
    // attribute, so `inert="false"` is still inert. It has to be ABSENT.
    setOpen(true);

    expect(shell().getAttribute('aria-hidden')).toBe('false');
    expect(shell().hasAttribute('inert')).toBe(false);
  });

  it('🔴 `inert` is written as the EMPTY STRING, never as "false"', () => {
    // Pinned explicitly because the failure is silent: a drawer rendered with
    // `inert="false"` looks correct in the source and is permanently unusable.
    setOpen(true);
    expect(shell().getAttribute('inert')).toBeNull();

    setOpen(false);
    expect(shell().getAttribute('inert')).toBe('');
  });

  it('the close button and PROJECTED content are both inside the inert subtree', () => {
    // Anti-vacuity: `inert` on an empty container would satisfy the assertions
    // above and protect nothing. These are the two focusable things that were
    // actually reachable.
    const closeButton = shell().querySelector('[aria-label="Close panel"]');
    const projected = shell().querySelector('[data-projected]');

    expect(closeButton).not.toBeNull();
    expect(projected).not.toBeNull();
    expect(shell().contains(closeButton)).toBe(true);
    expect(shell().contains(projected)).toBe(true);
  });

  it('the panel stays MOUNTED when closed — the slide is a CSS transform', () => {
    // This is WHY `inert` is needed rather than an `@if`. The component's own
    // docblock relies on the panel being mounted so `viewChild` resolves and
    // focus can move on open; that same decision is what leaves focusable
    // content in the DOM while closed.
    expect(shell().querySelector('[role="dialog"]')).not.toBeNull();
    expect(shell().querySelector('.translate-x-full')).not.toBeNull();
  });

  it('is labelled as a modal dialog with the supplied title', () => {
    setOpen(true);
    const dialog = shell().querySelector('[role="dialog"]');

    expect(dialog?.getAttribute('aria-modal')).toBe('true');
    expect(dialog?.getAttribute('aria-label')).toBe('Webhook detail');
  });
});
