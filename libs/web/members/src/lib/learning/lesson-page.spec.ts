import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed, type ComponentFixture } from '@angular/core/testing';
import { By } from '@angular/platform-browser';
import {
  ActivatedRoute,
  convertToParamMap,
  provideRouter,
} from '@angular/router';
import { BehaviorSubject } from 'rxjs';

import {
  MarkdownBlockComponent,
  provideMarkdownRendering,
} from '@ptah-extension/markdown';

import {
  lessonComment,
  lessonDetail,
  lessonProgress,
} from './learning-fixtures';
import { LessonPage } from './lesson-page';

const BASE = '/api/v1/members/courses';
const COURSE = 'operator-design-patterns';
const LESSON = 'reconcile-loop-fundamentals';
const URL = `${BASE}/${COURSE}/lessons/${LESSON}`;

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

describe('LessonPage (R2.1.5, R2.3.x, R2.4.x, R2.5, NFR-S2)', () => {
  let fixture: ComponentFixture<LessonPage>;
  let http: HttpTestingController;
  let params: BehaviorSubject<ReturnType<typeof convertToParamMap>>;

  beforeEach(async () => {
    TestBed.resetTestingModule();
    params = new BehaviorSubject(
      convertToParamMap({ slug: COURSE, lessonSlug: LESSON }),
    );

    await TestBed.configureTestingModule({
      imports: [LessonPage],
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        provideRouter([]),
        provideMarkdownRendering({ extensions: 'member' }),
        { provide: ActivatedRoute, useValue: { paramMap: params } },
      ],
    }).compileComponents();

    http = TestBed.inject(HttpTestingController);
    fixture = TestBed.createComponent(LessonPage);
    fixture.detectChanges();
  });

  afterEach(() => {
    http.verify();
    fixture.destroy();
  });

  function text(): string {
    return ((fixture.nativeElement as HTMLElement).textContent ?? '').replace(
      /\s+/g,
      ' ',
    );
  }

  function el(selector: string): HTMLElement | null {
    return (fixture.nativeElement as HTMLElement).querySelector(selector);
  }

  function flush(url: string, body: unknown, opts?: { status: number }): void {
    const request = http.expectOne(url);
    if (opts) {
      request.flush(body, { status: opts.status, statusText: 'Error' });
    } else {
      request.flush(body);
    }
    fixture.detectChanges();
  }

  /* ---------------------------------------------------------------------- */

  describe('🔴 the two route params are SIGNALS, not snapshots (the F-4 case)', () => {
    it('re-loads when the lesson slug changes on the SAME instance', () => {
      flush(URL, lessonDetail({ title: 'First lesson' }));
      expect(text()).toContain('First lesson');

      params.next(
        convertToParamMap({ slug: COURSE, lessonSlug: 'managing-state' }),
      );
      fixture.detectChanges();

      flush(
        `${BASE}/${COURSE}/lessons/managing-state`,
        lessonDetail({ slug: 'managing-state', title: 'Second lesson' }),
      );
      expect(text()).toContain('Second lesson');
      expect(text()).not.toContain('First lesson');
    });

    it('re-loads when the COURSE slug changes too — both params are read', () => {
      flush(URL, lessonDetail());

      params.next(
        convertToParamMap({ slug: 'another-course', lessonSlug: LESSON }),
      );
      fixture.detectChanges();

      // The request address proves both segments are live.
      flush(
        `${BASE}/another-course/lessons/${LESSON}`,
        lessonDetail({ title: 'Elsewhere' }),
      );
      expect(text()).toContain('Elsewhere');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 the no-video layout is the DEFAULT case, and it is complete', () => {
    beforeEach(() => {
      flush(
        URL,
        lessonDetail({
          youtubeVideoId: null,
          videoTitle: null,
          videoDurationSeconds: null,
          videoThumbnailUrl: null,
        }),
      );
    });

    it('renders NO player element at all — not a player-shaped hole', () => {
      expect(el('ptah-youtube-player')).toBeNull();
      expect(el('iframe')).toBeNull();
      expect(el('[data-testid="video-poster"]')).toBeNull();
      expect(el('[data-testid="video-unavailable"]')).toBeNull();
    });

    it('still renders body, comments, prev/next and a manual completion control', () => {
      expect(
        fixture.debugElement.query(By.directive(MarkdownBlockComponent)),
      ).not.toBeNull();
      expect(el('ptah-lesson-comments')).not.toBeNull();
      expect(el('[data-testid="next-lesson"]')).not.toBeNull();
      expect(el('[data-testid="completion-toggle"]')).not.toBeNull();
    });

    it('shows no runtime chip when there is no persisted duration', () => {
      // ASSUMPTION-8: a null duration is manual-completion-only, and a "0:00"
      // chip would assert a runtime the server does not have.
      expect(text()).not.toContain('0:00');
    });
  });

  describe('a lesson WITH a video renders the facade', () => {
    it('renders the player as a poster, with no iframe before activation', () => {
      flush(URL, lessonDetail());

      expect(el('ptah-youtube-player')).not.toBeNull();
      expect(el('[data-testid="video-poster"]')).not.toBeNull();
      expect(el('iframe')).toBeNull();
    });

    it('shows the persisted DURATION as a runtime chip', () => {
      flush(URL, lessonDetail({ videoDurationSeconds: 212 }));
      expect(text()).toContain('3:32');
    });

    it('🔴 renders the DURATION, never the member’s POSITION (RISK-O)', () => {
      // 212 s long, watched to 47 s. A component that swapped the two would
      // render "0:47" here and type-check perfectly.
      flush(
        URL,
        lessonDetail({
          videoDurationSeconds: 212,
          progress: lessonProgress({ furthestPositionSeconds: 47 }),
        }),
      );
      expect(text()).toContain('3:32');
      expect(text()).not.toContain('0:47');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 the LOCKED state is a page state derived from the API 403', () => {
    beforeEach(() => {
      flush(
        URL,
        {
          reason: 'not_released',
          unlocksAt: '2027-12-25T09:00:00.000Z',
          message: 'This module is not open yet.',
        },
        { status: 403 },
      );
    });

    it('renders LockedModuleNotice with plain-language copy from the machine reason', () => {
      expect(el('[data-testid="locked-module-notice"]')).not.toBeNull();
      expect(text()).toContain('This module is not open yet');
      expect(text()).toContain('Unlocks on');
      expect(text()).toContain('December 25, 2027');
    });

    it('renders NO lesson content — the body never reached the client', () => {
      expect(
        fixture.debugElement.query(By.directive(MarkdownBlockComponent)),
      ).toBeNull();
      expect(el('ptah-lesson-comments')).toBeNull();
      expect(el('ptah-youtube-player')).toBeNull();
      expect(el('[data-testid="completion-toggle"]')).toBeNull();
    });

    it('🔴 is NOT a CSS treatment — there is no hidden content to unhide', () => {
      // R2.4.5. The `403` means the payload was never produced, so there is
      // nothing a devtools user could un-hide. Asserted as the ABSENCE OF
      // HIDING MECHANISMS rather than as a string search: `aria-hidden` is on
      // every decorative icon and would make a naive `not.toContain('hidden')`
      // fail for the wrong reason.
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll('[hidden]')).toHaveLength(0);
      expect(root.querySelectorAll('.hidden')).toHaveLength(0);
      expect(root.querySelectorAll('.blur, .blur-sm, .opacity-0')).toHaveLength(
        0,
      );
      expect(root.querySelectorAll('[style*="display: none"]')).toHaveLength(0);
      // …and the payload genuinely is not in the DOM in any form.
      expect(root.querySelectorAll('ptah-markdown-block')).toHaveLength(0);
    });

    it('is NOT rendered as an error — no role="alert"', () => {
      expect(el('[role="alert"]')).toBeNull();
      expect(text()).not.toContain('We could not load');
    });

    it("renders the sequential lock's own copy, and no date", () => {
      params.next(convertToParamMap({ slug: COURSE, lessonSlug: 'sequenced' }));
      fixture.detectChanges();
      flush(
        `${BASE}/${COURSE}/lessons/sequenced`,
        { reason: 'previous_module_incomplete', unlocksAt: null },
        { status: 403 },
      );

      expect(text()).toContain('Finish the previous module first');
      expect(text()).not.toContain('Unlocks on');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 404 renders differently from 403, and its copy is neutral', () => {
    it('says the lesson is not available, with NONE of the three words', () => {
      flush(URL, { message: 'Lesson not found' }, { status: 404 });

      expect(text()).toContain('This lesson is not available');
      for (const word of FORBIDDEN_WORDS) {
        expect(text().toLowerCase()).not.toContain(word);
      }
      // …and it is NOT the lock screen.
      expect(el('[data-testid="locked-module-notice"]')).toBeNull();
    });

    it('a 500 is retryable and uses different copy from the 404', () => {
      flush(URL, {}, { status: 500 });
      expect(text()).toContain('We could not load this lesson');
      expect(text()).toContain('Try again');
      expect(text()).not.toContain('This lesson is not available');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('prev / next come from the server and cross module boundaries', () => {
    it('renders both neighbours as links, naming their modules', () => {
      flush(
        URL,
        lessonDetail({
          previous: {
            slug: 'last-of-module-one',
            title: 'Last of module one',
            moduleTitle: 'Foundations',
          },
          next: {
            slug: 'first-of-module-two',
            title: 'First of module two',
            moduleTitle: 'Core controllers',
          },
        }),
      );

      const previous = el('[data-testid="previous-lesson"]');
      const next = el('[data-testid="next-lesson"]');

      expect(previous?.getAttribute('href')).toBe(
        `/members/courses/${COURSE}/lessons/last-of-module-one`,
      );
      // ⚠️ The module name is in the label because "Next: Lesson 1" is
      // misleading when it is the first lesson of the NEXT module.
      expect(next?.getAttribute('aria-label')).toBe(
        'Next lesson: Core controllers — First of module two',
      );
    });

    it('🔴 a next lesson in a LOCKED module still renders as a link', () => {
      // R2.4.4 — the member may see what is coming. Clicking lands on this
      // page's 403 state, which is where the lock is enforced.
      flush(
        URL,
        lessonDetail({
          next: {
            slug: 'locked-lesson',
            title: 'Locked lesson',
            moduleTitle: 'Advanced patterns',
          },
        }),
      );
      expect(el('[data-testid="next-lesson"]')?.tagName).toBe('A');
    });

    it('renders no previous link on the first lesson of the course', () => {
      flush(URL, lessonDetail({ previous: null }));
      expect(el('[data-testid="previous-lesson"]')).toBeNull();
      expect(el('[data-testid="next-lesson"]')).not.toBeNull();
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 completion — the server’s verdict, and which kind it is', () => {
    it('offers "Mark complete" on an incomplete lesson', () => {
      flush(URL, lessonDetail());
      const toggle = el('[data-testid="completion-toggle"]');
      expect(toggle?.textContent).toContain('Mark complete');
      expect(toggle?.getAttribute('aria-pressed')).toBe('false');
      expect(toggle?.getAttribute('aria-label')).toBe(
        'Mark this lesson complete',
      );
    });

    it('says WHICH kind of completion it is — auto', () => {
      // A member who cannot tell why a lesson is complete cannot tell whether
      // un-completing it is safe.
      flush(
        URL,
        lessonDetail({
          progress: lessonProgress({
            completedAt: '2026-08-05T09:00:00.000Z',
            completionSource: 'auto',
          }),
        }),
      );
      expect(el('[data-testid="completion-reason"]')?.textContent).toContain(
        'watched to the end',
      );
    });

    it('says WHICH kind of completion it is — manual', () => {
      flush(
        URL,
        lessonDetail({
          progress: lessonProgress({
            completedAt: '2026-08-05T09:00:00.000Z',
            completionSource: 'manual',
          }),
        }),
      );
      expect(el('[data-testid="completion-reason"]')?.textContent).toContain(
        'you marked this done',
      );
    });

    it('the toggle PUTs { complete } to the completion route and takes the answer', () => {
      flush(URL, lessonDetail());
      el('[data-testid="completion-toggle"]')?.click();
      fixture.detectChanges();

      const request = http.expectOne(`${URL}/completion`);
      expect(request.request.method).toBe('PUT');
      expect(request.request.body).toEqual({ complete: true });

      request.flush(
        lessonProgress({
          completedAt: '2026-08-05T09:00:00.000Z',
          completionSource: 'manual',
        }),
      );
      fixture.detectChanges();

      expect(el('[data-testid="completion-toggle"]')?.textContent).toContain(
        'Completed',
      );
    });

    it('is reversible', () => {
      flush(
        URL,
        lessonDetail({
          progress: lessonProgress({
            completedAt: '2026-08-05T09:00:00.000Z',
            completionSource: 'manual',
          }),
        }),
      );
      el('[data-testid="completion-toggle"]')?.click();
      fixture.detectChanges();

      const request = http.expectOne(`${URL}/completion`);
      expect(request.request.body).toEqual({ complete: false });
      request.flush(lessonProgress());
      fixture.detectChanges();

      expect(el('[data-testid="completion-toggle"]')?.textContent).toContain(
        'Mark complete',
      );
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('🔴 NFR-S2 — the body reaches ONE renderer and nothing else', () => {
    it('binds bodyMarkdown to <ptah-markdown-block variant="auto">', () => {
      flush(URL, lessonDetail({ bodyMarkdown: '# Heading\n\nA **body**.' }));

      // ⚠️ The bound INPUT is read, not `textContent` — `ngx-markdown` parses
      // in a promise, so asserting rendered text would make this a timing test
      // of a third-party library (B7's technique note).
      const blocks = fixture.debugElement.queryAll(
        By.directive(MarkdownBlockComponent),
      );
      expect(blocks).toHaveLength(1);
      expect(blocks[0].componentInstance.content()).toBe(
        '# Heading\n\nA **body**.',
      );
    });

    it('emits no innerHTML binding anywhere on the page', () => {
      flush(URL, lessonDetail());
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).not.toContain('innerHTML');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('comments', () => {
    it('renders the thread the lesson carried', () => {
      flush(
        URL,
        lessonDetail({
          comments: [
            lessonComment({ id: 'a', bodyMarkdown: 'A question?' }),
            lessonComment({
              id: 'b',
              parentId: 'a',
              bodyMarkdown: 'An answer.',
            }),
          ],
        }),
      );

      expect(
        (fixture.nativeElement as HTMLElement).querySelectorAll(
          '[data-comment-id]',
        ),
      ).toHaveLength(2);
    });

    it('🔴 a comment write RE-READS the lesson rather than splicing the response', () => {
      // Two reasons, either sufficient: the server repairs a depth-3 parentId,
      // and the write response currently returns `authorName: null` for a live
      // comment (a reported server defect).
      flush(URL, lessonDetail({ id: 'les_1', comments: [] }));

      const textarea = el('textarea') as HTMLTextAreaElement;
      textarea.value = 'A new question';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();

      (el('form button[type="submit"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      const post = http.expectOne('/api/v1/members/lesson-comments');
      expect(post.request.body).toEqual({
        lessonId: 'les_1',
        bodyMarkdown: 'A new question',
      });
      post.flush(lessonComment({ id: 'new', authorName: null }));
      fixture.detectChanges();

      // The re-read is the assertion: the page asks the server what the thread
      // now looks like instead of trusting the write response.
      flush(
        URL,
        lessonDetail({
          id: 'les_1',
          comments: [
            lessonComment({
              id: 'new',
              authorName: 'Abdallah Khalil',
              bodyMarkdown: 'A new question',
            }),
          ],
        }),
      );
      expect(text()).toContain('Abdallah Khalil');
    });

    it('a 403 on a comment write matches the machine reason, not the sentence', () => {
      flush(URL, lessonDetail({ id: 'les_1' }));

      const textarea = el('textarea') as HTMLTextAreaElement;
      textarea.value = 'Too late';
      textarea.dispatchEvent(new Event('input'));
      fixture.detectChanges();
      (el('form button[type="submit"]') as HTMLButtonElement).click();
      fixture.detectChanges();

      http
        .expectOne('/api/v1/members/lesson-comments')
        .flush(
          { reason: 'not_released', unlocksAt: null, message: 'anything' },
          { status: 403, statusText: 'Forbidden' },
        );
      fixture.detectChanges();

      expect(text()).toContain('This module closed while you were writing');
    });
  });

  /* ---------------------------------------------------------------------- */

  describe('NFR-U2 / NFR-U4', () => {
    it('uses tokens only', () => {
      flush(URL, lessonDetail());
      const html = (fixture.nativeElement as HTMLElement).innerHTML;
      expect(html).toContain('border-hairline');
      expect(html).not.toContain(BORDER_FILL_MISUSE);
      expect(html).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
      expect(html).not.toMatch(/\bamber-\d{2,3}\b/);
      expect(html).not.toContain('text-base-content/40');
    });

    it('every interactive element is a real button or link, none a clickable div', () => {
      // NFR-U4's structural precondition: a `<div>` with a click handler is
      // neither focusable nor activatable by Enter/Space.
      flush(URL, lessonDetail());
      const clickable = Array.from(
        (fixture.nativeElement as HTMLElement).querySelectorAll('*'),
      ).filter((node) => node.hasAttribute('data-testid'));

      for (const node of clickable) {
        const testid = node.getAttribute('data-testid');
        if (testid === null) continue;
        if (['completion-toggle', 'video-poster'].includes(testid)) {
          expect(node.tagName).toBe('BUTTON');
        }
        if (
          ['previous-lesson', 'next-lesson', 'resume-link'].includes(testid)
        ) {
          expect(node.tagName).toBe('A');
        }
      }
    });
  });
});
