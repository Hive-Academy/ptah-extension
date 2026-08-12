import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import { CoursePage } from './course-page';
import {
  courseDetail,
  lessonSummary,
  lockedByDateModule,
  moduleSummary,
} from './learning-fixtures';

const COURSES = '/api/v1/members/courses';

/** The three words a 404 screen may never contain (R1.1.3). */
const FORBIDDEN_WORDS = ['not allowed', 'forbidden', 'permission'];

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

describe('CoursePage (R2.1.3, R2.3.6, R2.4.4, R6.4)', () => {
  let fixture: ComponentFixture<CoursePage>;
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    params = new BehaviorSubject(
      convertToParamMap({ slug: 'operator-design-patterns' }),
    );

    await TestBed.configureTestingModule({
      imports: [CoursePage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(CoursePage);
    fixture.detectChanges();
  });

  afterEach(() => http.verify());

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
  }

  function flush(slug: string, body: unknown, opts?: { status: number }): void {
    const request = http.expectOne(`${COURSES}/${slug}`);
    if (opts) {
      request.flush(body, { status: opts.status, statusText: 'Error' });
    } else {
      request.flush(body);
    }
    fixture.detectChanges();
  }

  /* ---------------------------------------------------------------------- */

  describe('🔴 the :slug parameter is a SIGNAL, not a snapshot', () => {
    it('re-loads when the route parameter changes on the SAME instance', () => {
      flush('operator-design-patterns', courseDetail());
      expect(text()).toContain('Operator design patterns');

      params.next(convertToParamMap({ slug: 'second-course' }));
      fixture.detectChanges();

      // A snapshot read would have left the first course on screen forever.
      flush('second-course', courseDetail({ title: 'Second course' }));
      expect(text()).toContain('Second course');
      expect(text()).not.toContain('Operator design patterns');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 the resume target comes from the SERVER (R2.3.6)', () => {
    it('links at resumeLesson, not at the first incomplete row it can find', () => {
      // The outline's FIRST incomplete lesson and the server's `resumeLesson`
      // deliberately disagree here. The page must follow the server, or this
      // page and the hub card will eventually point at different lessons.
      flush(
        'operator-design-patterns',
        courseDetail({
          modules: [
            moduleSummary({
              lessons: [
                lessonSummary({
                  id: 'l1',
                  slug: 'first-lesson',
                  completed: false,
                }),
              ],
            }),
          ],
          resumeLesson: {
            slug: 'a-later-lesson',
            title: 'A later lesson',
            moduleTitle: 'Foundations',
          },
        }),
      );

      const resume = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="resume-link"]',
      );
      expect(resume?.getAttribute('href')).toBe(
        '/members/courses/operator-design-patterns/lessons/a-later-lesson',
      );
    });

    it('names the module and the lesson in the accessible label', () => {
      flush('operator-design-patterns', courseDetail());
      const resume = (fixture.nativeElement as HTMLElement).querySelector(
        '[data-testid="resume-link"]',
      );
      expect(resume?.getAttribute('aria-label')).toBe(
        'Resume: Foundations — Reconcile loop fundamentals',
      );
    });

    it('says "Start course" on an untouched course', () => {
      flush(
        'operator-design-patterns',
        courseDetail({ completedLessons: 0, percent: 0 }),
      );
      expect(text()).toContain('Start course');
    });

    it('a null resumeLesson on a course WITH lessons is a completion state, not a dead button', () => {
      flush(
        'operator-design-patterns',
        courseDetail({
          resumeLesson: null,
          completedLessons: 3,
          totalLessons: 3,
          percent: 100,
        }),
      );

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="resume-link"]',
        ),
      ).toBeNull();
      expect(text()).toContain('You have completed this course');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('the outline', () => {
    it('renders modules in server order, locked ones included (R2.4.4)', () => {
      flush('operator-design-patterns', courseDetail());

      const modules = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-module-slug]',
        ),
      );
      expect(
        modules.map((m) => (m as HTMLElement).dataset['moduleSlug']),
      ).toEqual(['foundations', 'advanced-patterns']);
      expect((modules[1] as HTMLElement).dataset['locked']).toBe('true');
    });

    it('a locked module renders the notice WITHOUT any request failing', () => {
      // The lock arrives inside a perfectly successful 200; the 403 belongs to
      // the lesson endpoint.
      flush(
        'operator-design-patterns',
        courseDetail({ modules: [lockedByDateModule()] }),
      );
      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          '[data-testid="locked-module-notice"]',
        ),
      ).not.toBeNull();
      expect(
        (fixture.nativeElement as HTMLElement).querySelector('[role="alert"]'),
      ).toBeNull();
    });

    it('a course with NO modules renders an EmptyState inside the detail', () => {
      flush('operator-design-patterns', courseDetail({ modules: [] }));

      expect(
        (fixture.nativeElement as HTMLElement).querySelector(
          'ptah-empty-state',
        ),
      ).not.toBeNull();
      // …and the header is still there, so it is not a blank page.
      expect(text()).toContain('Operator design patterns');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 404 vs 500 render differently, and the 404 copy is neutral', () => {
    it('a 404 says the course is not available, with NONE of the three words', () => {
      flush(
        'operator-design-patterns',
        { message: 'Course not found' },
        {
          status: 404,
        },
      );

      expect(text()).toContain('This course is not available');
      for (const word of FORBIDDEN_WORDS) {
        expect(text().toLowerCase()).not.toContain(word);
      }
    });

    it('a 404 is NOT retryable — pressing Try again would repeat the answer', () => {
      flush('operator-design-patterns', {}, { status: 404 });
      const labels = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('button'),
      ).map((b) => b.textContent?.trim());
      expect(labels).not.toContain('Try again');
      expect(text()).toContain('Back to courses');
    });

    it('a 500 IS retryable and does not use the 404 copy', () => {
      flush('operator-design-patterns', {}, { status: 500 });
      expect(text()).toContain('We could not load this course');
      expect(text()).toContain('Try again');
      expect(text()).not.toContain('This course is not available');
    });

    it('a failed load clears the previous course', () => {
      flush('operator-design-patterns', courseDetail());
      expect(text()).toContain('Operator design patterns');

      params.next(convertToParamMap({ slug: 'gone' }));
      fixture.detectChanges();
      flush('gone', {}, { status: 404 });

      expect(text()).not.toContain('Operator design patterns');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('NFR-S2 / NFR-U2', () => {
    it('renders NO markdown block — description is plain text', () => {
      flush('operator-design-patterns', courseDetail());
      expect((fixture.nativeElement as HTMLElement).innerHTML).not.toContain(
        'ptah-markdown-block',
      );
    });

    it('uses tokens only', () => {
      flush('operator-design-patterns', courseDetail());
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('border-hairline');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toContain('text-base-content/40');
    });
  });
});
