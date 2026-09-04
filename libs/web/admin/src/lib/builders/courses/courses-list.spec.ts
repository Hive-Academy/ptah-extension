import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter, type Route } from '@angular/router';
import { of, throwError } from 'rxjs';

import { ADMIN_ROUTES } from '../../admin.routes';
import { ADMIN_NAV_GROUPS } from '../../admin-layout/admin-nav.config';
import { AdminApiService } from '../../services/admin-api.service';
import {
  AdminLearningApiService,
  type AdminCourse,
} from '../../services/admin-learning-api.service';
import { CoursesList } from './courses-list';

function course(overrides: Partial<AdminCourse> = {}): AdminCourse {
  return {
    id: 'course-1',
    slug: 'ship-your-first-saas',
    title: 'Ship Your First SaaS',
    description: 'From nothing to a paying customer.',
    coverImageUrl: null,
    visibility: 'member',
    cohortKeys: [],
    cohortNames: [],
    published: false,
    sequential: false,
    sortOrder: 0,
    createdBy: null,
    moduleCount: 0,
    lessonCount: 0,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

describe('CoursesList', () => {
  let fixture: ComponentFixture<CoursesList>;
  let learningApi: {
    listCourses: jest.Mock;
    setCoursePublished: jest.Mock;
    reorderCourses: jest.Mock;
    deleteCourse: jest.Mock;
  };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(CoursesList);
    fixture.detectChanges();
  };

  function button(label: string): HTMLButtonElement {
    const found = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === label);
    if (!found) throw new Error(`No button labelled "${label}"`);
    return found;
  }

  beforeEach(() => {
    learningApi = {
      listCourses: jest.fn().mockReturnValue(of([])),
      setCoursePublished: jest.fn(),
      reorderCourses: jest.fn().mockReturnValue(of({ reordered: 2 })),
      deleteCourse: jest.fn().mockReturnValue(of({ deleted: true })),
    };

    TestBed.configureTestingModule({
      imports: [CoursesList],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: AdminLearningApiService, useValue: learningApi },
        // The form modal resolves cohorts through the generic admin client.
        { provide: AdminApiService, useValue: { listGroups: () => of([]) } },
      ],
    });
  });

  /* ---------------------------------------------------------------------- */
  /* Reachability                                                            */
  /* ---------------------------------------------------------------------- */

  it('is REACHABLE from the admin sidebar, under Builders Content', () => {
    // A screen nobody can navigate to is not a delivered screen. The learning
    // API shipped complete and had no client at all until this batch.
    const buildersContent = ADMIN_NAV_GROUPS.find(
      (group) => group.label === 'Builders Content',
    );

    expect(buildersContent).toBeDefined();
    expect(buildersContent?.items.map((item) => item.label)).toContain(
      'Courses',
    );
    expect(
      buildersContent?.items.find((item) => item.label === 'Courses')?.route,
    ).toBe('/admin/builders/courses');
  });

  it('both routes exist and resolve before the generic catch-alls', () => {
    // ⚠️ `builders/courses` is TWO segments, exactly like `:model/:id`.
    // Declared after it, the list route would resolve to `AdminDetail` with
    // `model='builders'` and the API would answer 400.
    const flatten = (routes: readonly Route[]): string[] =>
      routes.flatMap((route) => [
        route.path ?? '',
        ...(route.children ? flatten(route.children) : []),
      ]);
    const paths = flatten(ADMIN_ROUTES);

    expect(paths).toContain('builders/courses');
    expect(paths).toContain('builders/courses/:id');
    expect(paths.indexOf('builders/courses')).toBeLessThan(
      paths.indexOf(':model'),
    );
    expect(paths.indexOf('builders/courses')).toBeLessThan(
      paths.indexOf(':model/:id'),
    );
    expect(paths.indexOf('builders/courses/:id')).toBeLessThan(
      paths.indexOf(':model/:id'),
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Reads                                                                   */
  /* ---------------------------------------------------------------------- */

  it('renders the counts and the draft state the server reported', () => {
    learningApi.listCourses.mockReturnValue(
      of([course({ moduleCount: 3, lessonCount: 12 })]),
    );
    createComponent();

    const row = fixture.nativeElement.querySelector('tbody tr');
    expect(row.textContent).toContain('Ship Your First SaaS');
    expect(row.textContent).toContain('Draft');
    expect(row.textContent).toContain('3');
    expect(row.textContent).toContain('12');
  });

  it('warns when a cohort course names no cohort — it is visible to nobody', () => {
    // A real state the API accepts. Left as an empty cell an operator reads it
    // as "everyone", which is the exact opposite of what it means.
    learningApi.listCourses.mockReturnValue(
      of([course({ visibility: 'cohort', cohortKeys: [], cohortNames: [] })]),
    );
    createComponent();

    expect(
      fixture.nativeElement.querySelector('tbody tr').textContent,
    ).toContain('No cohort — nobody sees it');
  });

  /* ---------------------------------------------------------------------- */
  /* Publish — its own endpoint, never folded into a save                    */
  /* ---------------------------------------------------------------------- */

  it('publishes through PUT :id/published, not through a course PATCH', () => {
    // 🔴 The whole point of the separation: publication has its own request and
    // its own audit action, so an admin can never make a course member-visible
    // as a side effect of editing its description.
    learningApi.listCourses.mockReturnValue(of([course()]));
    learningApi.setCoursePublished.mockReturnValue(
      of(course({ published: true })),
    );
    createComponent();

    button('Publish').click();
    fixture.detectChanges();

    expect(learningApi.setCoursePublished).toHaveBeenCalledWith(
      'course-1',
      true,
    );
    expect(fixture.nativeElement.textContent).toContain('Unpublish');
  });

  it('keeps the row unchanged and reports the server message when publish fails', () => {
    learningApi.listCourses.mockReturnValue(of([course()]));
    learningApi.setCoursePublished.mockReturnValue(
      throwError(() => ({ error: { message: 'Course has no modules' } })),
    );
    createComponent();

    button('Publish').click();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Course has no modules',
    );
    expect(fixture.nativeElement.textContent).toContain('Draft');
  });

  /* ---------------------------------------------------------------------- */
  /* Reorder — the whole list, never the pair that moved                     */
  /* ---------------------------------------------------------------------- */

  it('sends EVERY id in the new order, because the server checks the full sibling set', () => {
    // A partial list is a 400 with no writes: the submitted ids must be exactly
    // the current live set, checked inside the transaction.
    learningApi.listCourses.mockReturnValue(
      of([
        course({ id: 'a', title: 'A' }),
        course({ id: 'b', title: 'B' }),
        course({ id: 'c', title: 'C' }),
      ]),
    );
    createComponent();

    const up: HTMLButtonElement = fixture.nativeElement.querySelector(
      'button[aria-label="Move C up"]',
    );
    up.click();
    fixture.detectChanges();

    expect(learningApi.reorderCourses).toHaveBeenCalledWith(['a', 'c', 'b']);
  });

  it('restores the previous order when the reorder is refused', () => {
    learningApi.listCourses.mockReturnValue(
      of([course({ id: 'a', title: 'A' }), course({ id: 'b', title: 'B' })]),
    );
    learningApi.reorderCourses.mockReturnValue(
      throwError(() => ({ error: { message: 'ids do not match' } })),
    );
    createComponent();

    fixture.nativeElement
      .querySelector('button[aria-label="Move B up"]')
      .click();
    fixture.detectChanges();

    const titles = Array.from<HTMLElement>(
      fixture.nativeElement.querySelectorAll('tbody tr td:nth-child(2) a'),
    ).map((a) => a.textContent?.trim());
    expect(titles).toEqual(['A', 'B']);
    expect(fixture.nativeElement.textContent).toContain('ids do not match');
  });

  /* ---------------------------------------------------------------------- */
  /* Errors                                                                  */
  /* ---------------------------------------------------------------------- */

  it('never shows a raw HttpErrorResponse message', () => {
    // The transport string names the URL and describes nothing an admin can
    // act on. Only the server's own `error.message` reaches the user.
    learningApi.listCourses.mockReturnValue(
      throwError(() => ({
        message:
          'Http failure response for /api/v1/admin/courses: 500 Internal Server Error',
        error: null,
      })),
    );
    createComponent();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load courses.');
    expect(text).not.toContain('Http failure response');
  });
});
