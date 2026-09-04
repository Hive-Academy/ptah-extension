import { provideHttpClient } from '@angular/common/http';
import { provideHttpClientTesting } from '@angular/common/http/testing';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import {
  ActivatedRoute,
  convertToParamMap,
  type ParamMap,
} from '@angular/router';
import { BehaviorSubject, Subject, of, throwError } from 'rxjs';

import {
  AdminLearningApiService,
  type AdminCourse,
  type AdminCourseModuleWithLessons,
  type AdminCourseOutline,
  type AdminLesson,
  type AdminModuleSchedule,
  type AdminModuleScheduleEntry,
} from '../../services/admin-learning-api.service';
import { CourseDetail } from './course-detail';

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
    moduleCount: 2,
    lessonCount: 2,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function lesson(overrides: Partial<AdminLesson> = {}): AdminLesson {
  return {
    id: 'lesson-1',
    moduleId: 'module-1',
    slug: 'set-up-the-repo',
    title: 'Set up the repo',
    bodyMarkdown: 'Clone it.',
    sortOrder: 0,
    youtubeVideoId: null,
    videoTitle: null,
    videoDurationSeconds: null,
    videoThumbnailUrl: null,
    videoMetadataFetchedAt: null,
    videoMetadataSource: null,
    commentCount: 0,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function courseModule(
  overrides: Partial<AdminCourseModuleWithLessons> = {},
): AdminCourseModuleWithLessons {
  const lessons = overrides.lessons ?? [];
  return {
    id: 'module-1',
    courseId: 'course-1',
    slug: 'week-1',
    title: 'Week 1',
    description: null,
    sortOrder: 0,
    releaseAt: null,
    lessonCount: lessons.length,
    deletedAt: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
    lessons,
  };
}

/** The two-module, two-lesson outline every test starts from. */
function outline(): AdminCourseOutline {
  return {
    modules: [
      courseModule({ lessons: [lesson()] }),
      courseModule({
        id: 'module-2',
        slug: 'week-2',
        title: 'Week 2',
        sortOrder: 1,
        lessons: [
          lesson({
            id: 'lesson-2',
            moduleId: 'module-2',
            slug: 'ship-it',
            title: 'Ship it',
          }),
        ],
      }),
    ],
  };
}

function entry(
  overrides: Partial<AdminModuleScheduleEntry> = {},
): AdminModuleScheduleEntry {
  return {
    moduleId: 'module-1',
    slug: 'week-1',
    title: 'Week 1',
    sortOrder: 0,
    day: 1,
    weekday: 'Mon',
    localDate: '2026-02-02',
    releaseAt: '2026-02-02T08:00:00.000Z',
    currentReleaseAt: null,
    changed: true,
    ...overrides,
  };
}

function schedule(
  entries: AdminModuleScheduleEntry[],
  overrides: Partial<AdminModuleSchedule> = {},
): AdminModuleSchedule {
  return {
    courseId: 'course-1',
    courseSlug: 'ship-your-first-saas',
    timeZone: 'UTC',
    startDate: '2026-02-02',
    timeOfDay: '09:00',
    moduleCount: entries.length,
    lastReleaseDate: entries[entries.length - 1]?.localDate ?? '2026-02-02',
    changedCount: entries.filter((e) => e.changed).length,
    entries,
    applied: false,
    ...overrides,
  };
}

describe('CourseDetail', () => {
  let fixture: ComponentFixture<CourseDetail>;
  let api: {
    getCourse: jest.Mock;
    getCourseOutline: jest.Mock;
    previewModuleSchedule: jest.Mock;
    applyModuleSchedule: jest.Mock;
    reorderModules: jest.Mock;
    deleteModule: jest.Mock;
    deleteLesson: jest.Mock;
    reorderLessons: jest.Mock;
    refreshLessonMetadata: jest.Mock;
    refreshLessonMetadataOne: jest.Mock;
  };

  /**
   * The route's `paramMap`, driven by the tests.
   *
   * A `BehaviorSubject` rather than `of(...)`: the router reuses ONE component
   * instance across `builders/courses/:id`, so a navigation between two courses
   * is a second emission on this stream, not a second component.
   */
  let routeParams: BehaviorSubject<ParamMap>;

  /** Pushes a navigation to `id` and lets the route effect run. */
  const navigateTo = (id: string): void => {
    routeParams.next(convertToParamMap({ id }));
    fixture.detectChanges();
  };

  const createComponent = (): void => {
    fixture = TestBed.createComponent(CourseDetail);
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
    routeParams = new BehaviorSubject<ParamMap>(
      convertToParamMap({ id: 'course-1' }),
    );
    api = {
      getCourse: jest.fn().mockReturnValue(of(course())),
      getCourseOutline: jest.fn().mockReturnValue(of(outline())),
      previewModuleSchedule: jest.fn().mockReturnValue(
        of(
          schedule([
            entry(),
            entry({
              moduleId: 'module-2',
              slug: 'week-2',
              title: 'Week 2',
              sortOrder: 1,
              day: 2,
              weekday: 'Tue',
              localDate: '2026-02-03',
            }),
          ]),
        ),
      ),
      applyModuleSchedule: jest.fn(),
      reorderModules: jest.fn().mockReturnValue(of({ reordered: 2 })),
      deleteModule: jest.fn().mockReturnValue(of({ deleted: true })),
      deleteLesson: jest.fn().mockReturnValue(of({ deleted: true })),
      reorderLessons: jest.fn().mockReturnValue(of({ reordered: 2 })),
      refreshLessonMetadata: jest
        .fn()
        .mockReturnValue(of({ refreshed: 2, skipped: 0, failed: [] })),
      refreshLessonMetadataOne: jest
        .fn()
        .mockReturnValue(of({ refreshed: 1, skipped: 0, failed: [] })),
    };

    TestBed.configureTestingModule({
      imports: [CourseDetail],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        { provide: AdminLearningApiService, useValue: api },
        {
          provide: ActivatedRoute,
          useValue: {
            paramMap: routeParams,
            snapshot: { paramMap: convertToParamMap({ id: 'course-1' }) },
          },
        },
      ],
    });
  });

  /* ---------------------------------------------------------------------- */
  /* The outline is the read                                                 */
  /* ---------------------------------------------------------------------- */

  it('reads the modules from the course outline', () => {
    createComponent();

    expect(api.getCourse).toHaveBeenCalledWith('course-1');
    expect(api.getCourseOutline).toHaveBeenCalledWith('course-1');
    expect(fixture.nativeElement.textContent).toContain('Week 1');
    expect(fixture.nativeElement.textContent).toContain('Week 2');
  });

  it('does NOT call the schedule preview on load', () => {
    // The preview answers about a PROPOSED schedule nothing has applied. It
    // belongs in the schedule panel, where the admin supplied its inputs.
    createComponent();

    expect(api.previewModuleSchedule).not.toHaveBeenCalled();
  });

  it('renders the lessons the server returned, not just session writes', () => {
    createComponent();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Set up the repo');
    expect(text).toContain('Ship it');
    expect(text).not.toContain('The API has no lesson read endpoint');
  });

  it('asks for the outline even when the course has no modules', () => {
    // The route answers `{ modules: [] }` rather than an error, so there is no
    // count to check first.
    api.getCourse.mockReturnValue(of(course({ moduleCount: 0 })));
    api.getCourseOutline.mockReturnValue(of({ modules: [] }));
    createComponent();

    expect(api.getCourseOutline).toHaveBeenCalledWith('course-1');
    expect(fixture.nativeElement.textContent).toContain('No modules yet.');
  });

  /* ---------------------------------------------------------------------- */
  /* Writes re-read the outline                                              */
  /* ---------------------------------------------------------------------- */

  it('re-reads the outline after a module write instead of patching locally', () => {
    createComponent();
    expect(api.getCourseOutline).toHaveBeenCalledTimes(1);

    fixture.nativeElement
      .querySelector('button[aria-label="Move Week 2 up"]')
      .click();
    fixture.detectChanges();

    expect(api.reorderModules).toHaveBeenCalledWith('course-1', [
      'module-2',
      'module-1',
    ]);
    // Sort order is renumbered inside the server's transaction, so the accepted
    // order is read back rather than assumed from the indexes sent.
    expect(api.getCourseOutline).toHaveBeenCalledTimes(2);
  });

  it('re-reads the outline after a lesson write', () => {
    createComponent();
    expect(api.getCourseOutline).toHaveBeenCalledTimes(1);

    button('Refresh all lesson metadata').click();
    fixture.detectChanges();

    expect(api.refreshLessonMetadata).toHaveBeenCalledWith([
      'lesson-1',
      'lesson-2',
    ]);
    expect(api.getCourseOutline).toHaveBeenCalledTimes(2);
  });

  it('sends the whole module list with an explicit courseId', () => {
    // The courseId is never inferred from the first id: a request mixing two
    // courses' modules would look valid and renumber a course nobody edited.
    createComponent();

    fixture.nativeElement
      .querySelector('button[aria-label="Move Week 2 up"]')
      .click();
    fixture.detectChanges();

    expect(api.reorderModules).toHaveBeenCalledWith('course-1', [
      'module-2',
      'module-1',
    ]);
  });

  /* ---------------------------------------------------------------------- */
  /* Bulk metadata refresh                                                   */
  /* ---------------------------------------------------------------------- */

  it('says so when the course holds more lessons than one request carries', () => {
    // `POST /admin/lessons/refresh-metadata` takes 1–100 explicit ids, not a
    // course. Reporting a partial run as a whole one would leave an admin
    // believing stale videos were fixed.
    api.getCourseOutline.mockReturnValue(
      of({
        modules: [
          courseModule({
            lessons: Array.from({ length: 101 }, (_unused, i) =>
              lesson({ id: `lesson-${i}`, title: `Lesson ${i}` }),
            ),
          }),
        ],
      }),
    );
    createComponent();

    expect(fixture.nativeElement.textContent).toContain(
      'One request carries at most 100 lessons',
    );

    button('Refresh all lesson metadata').click();
    fixture.detectChanges();

    expect(api.refreshLessonMetadata.mock.calls[0][0]).toHaveLength(100);
  });

  /* ---------------------------------------------------------------------- */
  /* Schedule — the preview IS the guard                                     */
  /* ---------------------------------------------------------------------- */

  it('echoes the confirm values from the preview response, never from its own arithmetic', () => {
    // 🔴 The server recomputes both inside the transaction. Deriving them
    // locally would defeat the guard the apply exists behind.
    const preview = schedule([entry()], {
      moduleCount: 7,
      lastReleaseDate: '2026-02-10',
    });
    api.previewModuleSchedule.mockReturnValue(of(preview));
    api.applyModuleSchedule.mockReturnValue(
      of({ ...preview, applied: true, changedCount: 1 }),
    );
    createComponent();

    const startDate: HTMLInputElement = fixture.nativeElement.querySelector(
      '#schedule-start-date',
    );
    startDate.value = '2026-02-02';
    startDate.dispatchEvent(new Event('input'));
    fixture.detectChanges();

    button('Preview').click();
    fixture.detectChanges();

    button('Apply this schedule').click();
    fixture.detectChanges();

    expect(api.applyModuleSchedule).toHaveBeenCalledWith(
      expect.objectContaining({
        confirmModuleCount: 7,
        confirmLastReleaseDate: '2026-02-10',
      }),
    );
  });

  it('offers no apply until a preview has been read', () => {
    createComponent();

    const apply = Array.from<HTMLButtonElement>(
      fixture.nativeElement.querySelectorAll('button'),
    ).find((b) => b.textContent?.trim() === 'Apply this schedule');
    expect(apply).toBeUndefined();
  });

  it('warns that the apply overwrites hand-set dates', () => {
    // Load-bearing copy: no column keeps a previous `releaseAt`, so the audit
    // log is the only record of what the dates were.
    createComponent();

    expect(fixture.nativeElement.textContent).toContain(
      'This replaces any date you set by hand',
    );
  });

  /* ---------------------------------------------------------------------- */
  /* Errors                                                                  */
  /* ---------------------------------------------------------------------- */

  it('never shows a raw HttpErrorResponse message', () => {
    api.getCourse.mockReturnValue(
      throwError(() => ({
        message:
          'Http failure response for /api/v1/admin/courses/course-1: 404 Not Found',
        error: null,
      })),
    );
    createComponent();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load this course.');
    expect(text).not.toContain('Http failure response');
  });

  it('never shows a raw HttpErrorResponse message when the outline fails', () => {
    api.getCourseOutline.mockReturnValue(
      throwError(() => ({
        message:
          'Http failure response for /api/v1/admin/courses/course-1/modules: 500 Internal Server Error',
        error: null,
      })),
    );
    createComponent();

    const text: string = fixture.nativeElement.textContent;
    expect(text).toContain('Could not load the modules.');
    expect(text).not.toContain('Http failure response');
  });

  /* ---------------------------------------------------------------------- */
  /* Two navigations in flight — the late one loses                          */
  /* ---------------------------------------------------------------------- */

  describe('overlapping navigations', () => {
    it('discards a late course response for the id the screen has left', () => {
      // Back and forward between two courses leave two `getCourse` calls in
      // flight. The slow one answers LAST; without the guard it would paint
      // course-1 under the URL of course-2, and every later write would then
      // read `course()?.id` and target course-1.
      const slowFirst = new Subject<AdminCourse>();
      api.getCourse.mockImplementation((id: string) =>
        id === 'course-1'
          ? slowFirst
          : of(course({ id, title: 'Course Two', slug: 'course-two' })),
      );
      api.getCourseOutline.mockImplementation((id: string) =>
        id === 'course-2'
          ? of({
              modules: [
                courseModule({
                  id: 'module-9',
                  courseId: 'course-2',
                  slug: 'week-9',
                  title: 'Week 9',
                }),
              ],
            })
          : of(outline()),
      );

      createComponent();
      navigateTo('course-2');

      // course-1 finally answers, after the screen already left it.
      slowFirst.next(course({ id: 'course-1', title: 'Course One' }));
      slowFirst.complete();
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('Course Two');
      expect(text).not.toContain('Course One');
      // The discarded response must not start the outline read behind it.
      expect(api.getCourseOutline).not.toHaveBeenCalledWith('course-1');
      expect(api.getCourseOutline).toHaveBeenCalledWith('course-2');
    });

    it('discards a late outline response for the id the screen has left', () => {
      // The outline envelope carries no course id, so the id the request was
      // started for is the only thing that can identify it on arrival.
      const slowOutline = new Subject<AdminCourseOutline>();
      api.getCourse.mockImplementation((id: string) =>
        of(
          course({
            id,
            title: id === 'course-1' ? 'Course One' : 'Course Two',
          }),
        ),
      );
      api.getCourseOutline.mockImplementation((id: string) =>
        id === 'course-1'
          ? slowOutline
          : of({
              modules: [
                courseModule({
                  id: 'module-9',
                  courseId: 'course-2',
                  slug: 'week-9',
                  title: 'Week 9',
                }),
              ],
            }),
      );

      createComponent();
      navigateTo('course-2');
      expect(fixture.nativeElement.textContent).toContain('Week 9');

      slowOutline.next(outline());
      slowOutline.complete();
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).toContain('Week 9');
      expect(text).not.toContain('Week 1');
    });

    it('discards a late failure for the id the screen has left', () => {
      // A stale error must not paint an error banner over a course that loaded.
      const slowFirst = new Subject<AdminCourse>();
      api.getCourse.mockImplementation((id: string) =>
        id === 'course-1'
          ? slowFirst
          : of(course({ id, title: 'Course Two', slug: 'course-two' })),
      );

      createComponent();
      navigateTo('course-2');

      slowFirst.error({ error: { message: 'Course not found' } });
      fixture.detectChanges();

      const text: string = fixture.nativeElement.textContent;
      expect(text).not.toContain('Could not load this course.');
      expect(text).not.toContain('Course not found');
      expect(text).toContain('Course Two');
    });
  });
});
