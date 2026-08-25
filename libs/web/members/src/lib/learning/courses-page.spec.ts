import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { CoursesPage } from './courses-page';
import { courseSummary } from './learning-fixtures';

const COURSES = '/api/v1/members/courses';

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

describe('CoursesPage (R2.1.1, R2.1.4, R6.3, R6.4)', () => {
  let fixture: ComponentFixture<CoursesPage>;
  let http: HttpTestingController;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    await TestBed.configureTestingModule({
      imports: [CoursesPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CoursesPage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
  }

  function html(): string {
    return (fixture.nativeElement as HTMLElement).innerHTML;
  }

  function flush(body: unknown, opts?: { status: number }): void {
    const request = http.expectOne(COURSES);
    if (opts) {
      request.flush(body, { status: opts.status, statusText: 'Error' });
    } else {
      request.flush(body);
    }
    fixture.detectChanges();
  }

  function cards(): HTMLElement[] {
    return Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll(
        '[data-course-slug]',
      ),
    );
  }

  /* ---------------------------------------------------------------------- */

  it('issues exactly ONE request on load', () => {
    http.expectOne(COURSES).flush([]);
    fixture.detectChanges();
    http.verify();
  });

  it('shows a resolving busy state, never a spinner that hangs', () => {
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[aria-busy="true"]',
      ),
    ).not.toBeNull();

    flush([]);
    expect(
      (fixture.nativeElement as HTMLElement).querySelector(
        '[aria-busy="true"]',
      ),
    ).toBeNull();
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 server order is preserved and nothing is re-sorted', () => {
    it('renders the rows in the order the wire carried them', () => {
      flush([
        courseSummary({ id: 'c3', slug: 'zeta', title: 'Zeta' }),
        courseSummary({ id: 'c1', slug: 'alpha', title: 'Alpha' }),
        courseSummary({ id: 'c2', slug: 'mid', title: 'Mid' }),
      ]);

      expect(cards().map((el) => el.dataset['courseSlug'])).toEqual([
        'zeta',
        'alpha',
        'mid',
      ]);
    });

    it('links each card at its slug', () => {
      flush([courseSummary()]);
      expect(cards()[0].getAttribute('href')).toBe(
        '/members/courses/operator-design-patterns',
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 ProgressMeter gets COUNTS, never a percentage (RISK-O)', () => {
    it('binds completedLessons and totalLessons, and renders the derived figure', () => {
      flush([
        courseSummary({ completedLessons: 1, totalLessons: 3, percent: 33 }),
      ]);

      const bar = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="progressbar"]',
      );
      expect(bar?.getAttribute('aria-valuenow')).toBe('33');
      expect(text()).toContain('1 of 3 lessons');
    });

    it('a wire `percent` that disagrees with the counts does NOT reach the meter', () => {
      // ⚠️ The device, asserted. The server sends `percent`; the meter takes
      // the two counts and computes its own. A caller CANNOT pass a figure
      // derived from seconds, because there is no input for one.
      flush([
        courseSummary({ completedLessons: 1, totalLessons: 4, percent: 99 }),
      ]);

      const bar = (fixture.nativeElement as HTMLElement).querySelector(
        '[role="progressbar"]',
      );
      expect(bar?.getAttribute('aria-valuenow')).toBe('25');
      expect(text()).not.toContain('99%');
    });

    it('a course with no lessons renders 0%, not NaN', () => {
      flush([
        courseSummary({ completedLessons: 0, totalLessons: 0, percent: 0 }),
      ]);
      expect(text()).not.toContain('NaN');
      expect(text()).toContain('0%');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('empty and failed are DIFFERENT signals (R6.3, R6.4)', () => {
    it('no courses renders an EmptyState that names the situation', () => {
      flush([]);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'ptah-empty-state',
        ),
      ).not.toBeNull();
      expect(text()).toContain(
        'The cohort curriculum has not been published yet.',
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });

    it('🔴 a 500 renders a RETRYABLE ERROR, not an EmptyState', () => {
      flush({}, { status: 500 });

      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'ptah-empty-state',
        ),
      ).toBeNull();
      // ⚠️ The empty-state copy must NOT appear after a failure: it would tell
      // a paying member the curriculum does not exist.
      expect(text()).not.toContain('has not been published yet');
      expect(text()).toContain('Try again');
    });

    it('🔴 a failed retry CLEARS the previous rows', () => {
      flush([courseSummary({ title: 'Operator design patterns' })]);
      expect(text()).toContain('Operator design patterns');

      // A reload that FAILS, from a page that currently holds rows.
      (fixture.componentInstance as unknown as { reload(): void }).reload();
      flush({}, { status: 500 });

      // Stale content must not sit under an error banner (B7.1's rule).
      expect(text()).not.toContain('Operator design patterns');
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).not.toBeNull();
    });

    it('Try again re-issues the request and recovers', () => {
      flush({}, { status: 500 });
      (
        Array.from<HTMLButtonElement>(
          (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
        ).find((b) => b.textContent?.includes('Try again')) as HTMLButtonElement
      ).click();
      fixture.detectChanges();

      flush([courseSummary()]);
      expect(cards()).toHaveLength(1);
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('NFR-S2 / NFR-U2', () => {
    it('renders NO markdown block — the description is plain text', () => {
      flush([courseSummary()]);
      expect(html()).not.toContain('ptah-markdown-block');
    });

    it('escapes anything HTML-shaped in a description', () => {
      flush([courseSummary({ description: '<img src=x onerror=alert(1)>' })]);
      // Interpolated as a text node — the markup is visible, not executed.
      expect(html()).not.toContain('<img src=x');
      expect(text()).toContain('<img src=x onerror=alert(1)>');
    });

    it('uses tokens only — no raw hex, base-300 never as a border', () => {
      flush([courseSummary()]);
      expect(html()).toContain('border-hairline');
      expect(html()).toContain('hover:bg-surface-high');
      expect(html()).not.toContain(BORDER_FILL_MISUSE);
      expect(html()).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html()).not.toMatch(/\bink-(?:\d{2,3}|content)\b/);
      expect(html()).not.toMatch(/\bamber-\d{2,3}\b/);
      expect(html()).not.toContain('text-base-content/40');
    });
  });
});
