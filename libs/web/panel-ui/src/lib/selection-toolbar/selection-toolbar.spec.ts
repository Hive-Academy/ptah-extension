import { Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';

import { SelectionToolbar } from './selection-toolbar';

/**
 * `SelectionToolbar`'s FIRST spec.
 *
 * ⚠️ IT SHIPPED WITH FOUR ADMIN CONSUMERS AND NO TEST. `users-list`,
 * `admin-list`, `webhooks` and `community-moderation` all render it today; the
 * member notifications page (Task 15.6) is the fifth. This file is therefore a
 * CROSS-PANEL IMPROVEMENT, in the same shape as B13's F-1 fix — and, like that
 * one, it should be committed separately so it stays revertible independently
 * of the member batch around it.
 *
 * The properties pinned here are the ones a consumer relies on WITHOUT being
 * able to see them: that the bar vanishes at zero (so no consumer needs its own
 * `@if`), that the noun pluralises (so no consumer passes "users" and gets
 * "userss"), and that the region is labelled (so the projected action buttons
 * are reachable in a screen reader's landmark list).
 */
@Component({
  standalone: true,
  imports: [SelectionToolbar],
  template: `
    <ptah-selection-toolbar
      [count]="count()"
      [itemNoun]="noun()"
      (cleared)="clearedCount = clearedCount + 1"
    >
      <button type="button" class="btn btn-sm" data-action>Mark read</button>
    </ptah-selection-toolbar>
  `,
})
class Host {
  public readonly count = signal(0);
  public readonly noun = signal('item');
  public clearedCount = 0;
}

describe('SelectionToolbar', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [Host],
    }).compileComponents();

    fixture = TestBed.createComponent(Host);
    fixture.detectChanges();
  });

  function root(): HTMLElement {
    return fixture.nativeElement as HTMLElement;
  }

  function bar(): HTMLElement | null {
    return root().querySelector('[role="region"]');
  }

  function setCount(count: number): void {
    fixture.componentInstance.count.set(count);
    fixture.detectChanges();
  }

  /* ---------------------------------------------------------------------- */

  describe('🔴 it renders NOTHING at a count of zero', () => {
    it('no region, no label, no projected action', () => {
      // This is the property every consumer leans on: none of the five wraps
      // the component in its own `@if`. If the bar rendered an empty shell at
      // zero, all five surfaces would grow a permanent strip of chrome.
      expect(bar()).toBeNull();
      expect(root().querySelector('[data-action]')).toBeNull();
      expect((root().textContent ?? '').trim()).toBe('');
    });

    it('appears at one and disappears again at zero', () => {
      setCount(1);
      expect(bar()).not.toBeNull();

      setCount(0);
      expect(bar()).toBeNull();
    });

    it('a NEGATIVE count renders nothing either', () => {
      // Defensive, and cheap: the guard is `> 0`, not `!== 0`. A consumer
      // computing a count by subtraction could pass -1, and "-1 items
      // selected" is a worse render than none.
      setCount(-1);
      expect(bar()).toBeNull();
    });
  });

  describe('the count label', () => {
    it('is singular at one', () => {
      fixture.componentInstance.noun.set('notification');
      setCount(1);

      expect(bar()?.textContent).toContain('1 notification selected');
    });

    it('is plural above one', () => {
      fixture.componentInstance.noun.set('notification');
      setCount(3);

      expect(bar()?.textContent).toContain('3 notifications selected');
    });

    it('defaults the noun to "item"', () => {
      setCount(2);

      expect(bar()?.textContent).toContain('2 items selected');
    });

    it('tracks the count reactively', () => {
      setCount(1);
      expect(bar()?.textContent).toContain('1 item selected');

      setCount(9);
      expect(bar()?.textContent).toContain('9 items selected');
    });
  });

  describe('the Clear control', () => {
    it('emits `cleared` when pressed', () => {
      setCount(2);

      const clear = Array.from(bar()?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.includes('Clear'),
      );
      clear?.click();

      expect(fixture.componentInstance.clearedCount).toBe(1);
    });

    it('does NOT change the count itself — the parent owns the selection', () => {
      // The bar is a dumb shell. If it cleared its own input the parent's
      // selection and the bar would disagree, and the parent's is the one the
      // bulk action reads.
      setCount(2);

      Array.from(bar()?.querySelectorAll('button') ?? [])
        .find((button) => button.textContent?.includes('Clear'))
        ?.click();
      fixture.detectChanges();

      expect(fixture.componentInstance.count()).toBe(2);
      expect(bar()).not.toBeNull();
    });

    it('is a real button of type="button"', () => {
      // Inside a form, a button without `type` submits it.
      setCount(1);

      const clear = Array.from(bar()?.querySelectorAll('button') ?? []).find(
        (button) => button.textContent?.includes('Clear'),
      );
      expect(clear?.getAttribute('type')).toBe('button');
    });
  });

  describe('accessibility and projection', () => {
    it('exposes a labelled region', () => {
      // The label is what puts the projected actions in a screen reader's
      // landmark list; without it the bar is an unnamed div that appears and
      // disappears with no announcement of what it is.
      setCount(1);

      expect(bar()?.getAttribute('role')).toBe('region');
      expect(bar()?.getAttribute('aria-label')).toBe('Bulk actions');
    });

    it('projects the consumer’s action buttons', () => {
      setCount(1);

      const action = root().querySelector('[data-action]');
      if (action === null) throw new Error('the action was not projected');

      expect(action.textContent).toContain('Mark read');
      // Projected INSIDE the region, so the landmark actually contains them.
      expect(bar()?.contains(action)).toBe(true);
    });

    it('the projected content is not duplicated across re-renders', () => {
      setCount(1);
      setCount(2);
      setCount(3);

      expect(root().querySelectorAll('[data-action]')).toHaveLength(1);
    });
  });
});
