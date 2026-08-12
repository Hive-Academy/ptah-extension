import { ChangeDetectionStrategy, Component, signal } from '@angular/core';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import { provideRouter } from '@angular/router';

import type { MemberModuleSummary } from '@ptah-contracts/community';

import {
  lessonSummary,
  lockedByDateModule,
  lockedBySequenceModule,
  moduleSummary,
} from '../learning-fixtures';
import { ModuleOutline, formatRuntime } from './module-outline';

/**
 * `border-base-300` — the class this panel must never emit (`base-300` is a
 * FILL, panel-theme-spec.md §2).
 *
 * ⚠️ IT IS ASSEMBLED RATHER THAN WRITTEN AS A LITERAL, AND THAT IS NOT A
 * WORKAROUND FOR THE RULE — IT IS THE ONLY WAY TO ASSERT IT FROM INSIDE THIS
 * LIB. Task 4.7's `no-restricted-syntax` selector matches ANY string literal
 * containing the token, including one written in a spec in order to prove its
 * ABSENCE. `libs/web/panel-ui/.../thread-row.spec.ts` can write it plainly only
 * because that lib sits outside the rule's scope. Assembling it keeps both the
 * lint rule and the runtime assertion, and weakens neither.
 */
const BORDER_FILL_MISUSE = ['border', 'base-300'].join('-');

@Component({
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [ModuleOutline],
  template: `
    <ptah-module-outline
      [courseSlug]="courseSlug()"
      [modules]="modules()"
      [currentLessonSlug]="currentLessonSlug()"
    />
  `,
})
class Host {
  public readonly courseSlug = signal('operator-design-patterns');
  public readonly modules = signal<MemberModuleSummary[]>([]);
  public readonly currentLessonSlug = signal<string | null>(null);
}

describe('ModuleOutline (R2.1.4, R2.4.4, R9.7)', () => {
  let fixture: ComponentFixture<Host>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [Host],
      providers: [provideRouter([])],
    }).compileComponents();
    fixture = TestBed.createComponent(Host);
  });

  function render(modules: MemberModuleSummary[]): void {
    fixture.componentInstance.modules.set(modules);
    fixture.detectChanges();
  }

  function moduleEls(): HTMLElement[] {
    return fixture.debugElement
      .queryAll(By.css('[data-module-slug]'))
      .map((d) => d.nativeElement as HTMLElement);
  }

  /* ---------------------------------------------------------------------- */

  describe('🔴 server order is preserved and nothing is re-sorted', () => {
    it('renders modules in the array order, even when sortOrder disagrees', () => {
      // Deliberately out of `sortOrder` sequence: a client-side sort would
      // "fix" this and thereby prove it exists.
      render([
        moduleSummary({
          id: 'm2',
          slug: 'second',
          title: 'Second',
          sortOrder: 5,
        }),
        moduleSummary({
          id: 'm1',
          slug: 'first',
          title: 'First',
          sortOrder: 0,
        }),
      ]);

      expect(moduleEls().map((el) => el.dataset['moduleSlug'])).toEqual([
        'second',
        'first',
      ]);
    });

    it('renders lessons in the array order too', () => {
      render([
        moduleSummary({
          lessons: [
            lessonSummary({
              id: 'b',
              slug: 'beta',
              title: 'Beta',
              sortOrder: 9,
            }),
            lessonSummary({
              id: 'a',
              slug: 'alpha',
              title: 'Alpha',
              sortOrder: 0,
            }),
          ],
        }),
      ]);

      const slugs = fixture.debugElement
        .queryAll(By.css('[data-lesson-slug]'))
        .map((d) => (d.nativeElement as HTMLElement).dataset['lessonSlug']);
      expect(slugs).toEqual(['beta', 'alpha']);
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 a LOCKED module shows titles and nothing else (R2.4.4)', () => {
    beforeEach(() => render([moduleSummary(), lockedByDateModule()]));

    it('lists the locked module and its lesson titles', () => {
      const locked = moduleEls()[1];
      expect(locked.dataset['locked']).toBe('true');
      expect(locked.textContent).toContain('Advanced patterns');
      expect(locked.textContent).toContain('Finalizer logic');
    });

    it('🔴 renders NO <ptah-markdown-block> anywhere in the locked module', () => {
      // The redaction is structural — `MemberLessonSummary` has no body field —
      // so this asserts the structure was not defeated by some other route to
      // the renderer.
      const locked = moduleEls()[1];
      expect(locked.querySelector('ptah-markdown-block')).toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          'ptah-markdown-block',
        ).length,
      ).toBe(0);
    });

    it('🔴 renders NO play affordance and NO link for a locked lesson', () => {
      const locked = moduleEls()[1];
      expect(locked.querySelectorAll('a').length).toBe(0);
      expect(locked.querySelector('button')).toBeNull();
      expect(locked.querySelector('iframe')).toBeNull();
    });

    it('the UNLOCKED module in the same outline DOES link its lessons (control)', () => {
      // Without this the assertion above would pass on an outline that linked
      // nothing at all.
      const open = moduleEls()[0];
      const link = open.querySelector('a');
      expect(link).not.toBeNull();
      expect(link?.getAttribute('href')).toBe(
        '/members/courses/operator-design-patterns/lessons/reconcile-loop-fundamentals',
      );
    });

    it('renders the LockedModuleNotice with the wire reason and date', () => {
      const notice = fixture.debugElement.query(
        By.css('[data-testid="locked-module-notice"]'),
      );
      expect(notice).not.toBeNull();
      expect(
        (notice.nativeElement as HTMLElement).textContent?.replace(/\s+/g, ' '),
      ).toContain('Unlocks on');
    });

    it("passes the PRECEDING module's title into a sequential lock's notice", () => {
      render([
        moduleSummary({ title: 'Foundations' }),
        lockedBySequenceModule(),
      ]);

      const notice = fixture.debugElement.query(
        By.css('[data-testid="locked-module-notice"]'),
      ).nativeElement as HTMLElement;
      expect(notice.textContent?.replace(/\s+/g, ' ')).toContain(
        'Complete every lesson in Foundations',
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('completion and runtime chips', () => {
    it('marks a completed lesson with an icon AND sr-only text, not colour alone', () => {
      render([
        moduleSummary({
          lessons: [
            lessonSummary({ id: 'a', slug: 'a', completed: true }),
            lessonSummary({ id: 'b', slug: 'b', completed: false }),
          ],
        }),
      ]);

      const done = fixture.debugElement.query(By.css('[data-lesson-slug="a"]'))
        .nativeElement as HTMLElement;
      expect(done.dataset['completed']).toBe('true');
      expect(done.querySelector('.sr-only')?.textContent).toContain(
        'Completed',
      );
    });

    it('shows a per-module count of lessons, not a percentage', () => {
      render([
        moduleSummary({
          lessons: [
            lessonSummary({ id: 'a', slug: 'a', completed: true }),
            lessonSummary({ id: 'b', slug: 'b', completed: false }),
            lessonSummary({ id: 'c', slug: 'c', completed: false }),
          ],
        }),
      ]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        '1 of 3',
      );
    });

    it('🔴 shows a runtime chip ONLY when durationSeconds is non-null', () => {
      // `null` means manual-completion-only (ASSUMPTION-8). A "0:00" chip there
      // would assert a runtime the server does not have.
      render([
        moduleSummary({
          lessons: [
            lessonSummary({ id: 'a', slug: 'a', durationSeconds: 212 }),
            lessonSummary({ id: 'b', slug: 'b', durationSeconds: null }),
          ],
        }),
      ]);

      const withDuration = fixture.debugElement.query(
        By.css('[data-lesson-slug="a"]'),
      ).nativeElement as HTMLElement;
      const without = fixture.debugElement.query(
        By.css('[data-lesson-slug="b"]'),
      ).nativeElement as HTMLElement;

      expect(withDuration.textContent).toContain('3:32');
      expect(without.textContent).not.toContain(':');
      expect(without.textContent).not.toContain('0:00');
    });

    it('marks the currently-open lesson with aria-current="page"', () => {
      render([moduleSummary()]);
      fixture.componentInstance.currentLessonSlug.set(
        'reconcile-loop-fundamentals',
      );
      fixture.detectChanges();

      const link = fixture.debugElement.query(By.css('a'))
        .nativeElement as HTMLElement;
      expect(link.getAttribute('aria-current')).toBe('page');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('formatRuntime — a DURATION, never a position (RISK-O)', () => {
    it.each([
      [0, '0:00'],
      [9, '0:09'],
      [59, '0:59'],
      [60, '1:00'],
      [212, '3:32'],
      [3599, '59:59'],
      [3600, '1:00:00'],
      [3661, '1:01:01'],
    ])('formats %i seconds as %s', (seconds, expected) => {
      expect(formatRuntime(seconds)).toBe(expected);
    });

    it('never renders a negative or fractional runtime', () => {
      expect(formatRuntime(-30)).toBe('0:00');
      expect(formatRuntime(90.7)).toBe('1:30');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('empty and token states', () => {
    it('an outline with no modules says so rather than rendering a blank list', () => {
      render([]);
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(
        'This course has no modules yet.',
      );
    });

    it('NFR-U2 — hairline boundaries, surface-high hover, base-300 never as a border', () => {
      render([moduleSummary()]);
      const html = (fixture.nativeElement as HTMLElement).innerHTML;

      expect(html).toContain('border-hairline');
      expect(html).toContain('hover:bg-surface-high');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/\bink-(?:\d{2,3}|content)\b/);
      expect(html).not.toMatch(/\bamber-\d{2,3}\b/);
    });
  });
});
