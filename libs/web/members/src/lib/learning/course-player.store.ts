import {
  DestroyRef,
  Injectable,
  computed,
  inject,
  signal,
} from '@angular/core';

import type { MemberLessonProgress } from '@ptah-contracts/community';

import {
  MemberLearningApiService,
  isLockedModuleError,
} from '../services/member-learning-api.service';

/**
 * How often the clock is READ. Cheap and local — no network.
 */
const POLL_INTERVAL_MS = 1_000;

/**
 * The minimum gap between two `PUT …/progress` requests (R2.3.1, §4.6.4).
 *
 * At one write per 15 s a lesson costs 4 writes a minute, well inside the
 * server's `PROGRESS_WRITES` tier of 60/min. That headroom is NOT the reason
 * for the throttle — a store that wrote on every change-detection cycle would
 * exhaust the whole budget in seconds, and the assertion that catches it is a
 * WRITE COUNT, not a value check. Batch 7 made the same call for the forum's
 * read marker: "a progress write per change detection would spend the member's
 * 60/min budget on scrolling".
 */
const WRITE_INTERVAL_MS = 15_000;

/**
 * CoursePlayerStore — the lesson page's progress state and the ONLY thing that
 * decides when a position reaches the server (R2.3.1–R2.3.3, §4.6.4–§4.6.6).
 *
 * ⚠️ 🔴 THE CLIENT NEVER SENDS A COMPLETION FLAG, AND THIS FILE CONTAINS NO
 * THRESHOLD ARITHMETIC AT ALL (§4.6.6, RISK-O). It sends `{ positionSeconds }`
 * and reads `{ furthestPositionSeconds, completedAt, completionSource }` back;
 * the completion state the UI shows is THE SERVER'S ANSWER, reconciled
 * wholesale from the response. The moment this store computed a percentage of a
 * duration there would be two implementations of R2.3.2 and they would disagree
 * at the boundary — which is exactly what the server refuses anyway: sending a
 * second key is a `400`, measured live, not a silent drop.
 * `course-player.store.spec.ts` asserts the comment-stripped source contains no
 * threshold constant.
 *
 * ⚠️ THE THREE UNITS, KEPT APART (RISK-O). This store handles ONE of them: a
 * POSITION IN SECONDS. It never reads `videoDurationSeconds` and never touches
 * `MemberCourseSummary.percent`. A duration reaching a variable named
 * `position` here would type-check perfectly and be invisible to any
 * single-site test — so the safest arrangement is for the duration never to
 * arrive.
 *
 * ⚠️ PER-LESSON, AND PROVIDED BY THE LESSON PAGE — not `providedIn: 'root'`.
 * Navigating lesson → lesson REUSES the page component instance, so
 * {@link bind} RESETS every field rather than accumulating. A store that kept
 * the previous lesson's pending position would write it against the new
 * lesson's slug.
 *
 * ⚠️ A FAILED WRITE KEEPS THE POSITION AND RETRIES WITH THE LATEST VALUE ONLY.
 * A member who watches twenty minutes through a flaky connection and loses all
 * of it is the failure this guards. But the queue holds exactly ONE value: the
 * server takes `max(stored, submitted)`, so every intermediate position is
 * worthless and a growing queue would be a memory leak that buys nothing.
 *
 * ⚠️ A LOCKED-MODULE `403` IS TERMINAL. `PUT …/progress` on a locked lesson
 * answers `403 { reason, unlocksAt }` (measured live), and retrying it forever
 * would burn the write budget on a request that can never succeed. Any other
 * failure is treated as transient.
 */
/*
 * ⚠️ NO `providedIn`, DELIBERATELY, AND THE RULE IS DISABLED FOR ONE LINE RATHER
 * THAN LOOSENED. `@angular-eslint/use-injectable-provided-in` exists to stop a
 * service being registered in an NgModule out of habit. This store is the
 * legitimate exception the rule cannot express: it holds ONE LESSON'S playback
 * state, is listed in `LessonPage`'s own `providers: [CoursePlayerStore]`, and
 * is destroyed with that component. `providedIn: 'root'` would make it a
 * singleton shared across every lesson a member opens — the accumulating store
 * this file's docblock forbids — and `providedIn: 'any'` is worse, because it
 * would silently give each lazy route its own copy while looking global.
 */
// eslint-disable-next-line @angular-eslint/use-injectable-provided-in -- per-lesson, provided by LessonPage; see the note above.
@Injectable()
export class CoursePlayerStore {
  private readonly api = inject(MemberLearningApiService);

  private courseSlug = '';
  private lessonSlug = '';

  /** The 1 s poll. `null` when no clock is attached. */
  private pollHandle: ReturnType<typeof setInterval> | null = null;

  /** Supplied by the player once its iframe API is ready. */
  private clock: (() => number) | null = null;

  /**
   * The latest position not yet accepted by the server, or `null` when there is
   * nothing to send. Exactly one value — see the class docblock.
   */
  private pending: number | null = null;

  /**
   * The highest position already accepted (or already queued), so a backward
   * seek writes nothing.
   *
   * ⚠️ THE SERVER CLAMPS MONOTONICALLY ANYWAY. Sending a lower value would be
   * harmless and useless — it would spend a write on a no-op and make the
   * network tab misdescribe what the member did.
   */
  private highWater = 0;

  /** `Date.now()` of the last write ATTEMPT, successful or not. */
  private lastWriteAt = 0;

  /** True while a `PUT` is in flight — one at a time, never overlapping. */
  private writing = false;

  /** Set when the server says this lesson is locked. Stops all writing. */
  private blocked = false;

  private readonly _progress = signal<MemberLessonProgress>({
    furthestPositionSeconds: 0,
    completedAt: null,
    completionSource: null,
  });

  /** THIS member's progress, as the server last reported it. */
  public readonly progress = this._progress.asReadonly();

  /** The server's completion verdict. Never a local derivation. */
  public readonly completed = computed<boolean>(
    () => this._progress().completedAt !== null,
  );

  /** `'auto'` (watched it) or `'manual'` (ticked it), or `null`. */
  public readonly completionSource = computed(
    () => this._progress().completionSource,
  );

  /** A manual completion round-trip is in flight. */
  public readonly savingCompletion = signal(false);

  public constructor() {
    // ⚠️ TEARDOWN FLUSHES AND CLEARS THE INTERVAL. A leaked 1 s poll is how a
    // member moving through five lessons ends up with five pollers writing
    // progress for lessons they are no longer watching.
    inject(DestroyRef).onDestroy(() => {
      this.flush();
      this.detachClock();
    });
  }

  /**
   * Points the store at a lesson and seeds it from the server's progress.
   *
   * ⚠️ IT FLUSHES THE PREVIOUS LESSON FIRST, THEN RESETS EVERYTHING. Navigating
   * away mid-lesson must not lose the last unwritten position, and must not
   * carry it into the next lesson either.
   */
  public bind(
    courseSlug: string,
    lessonSlug: string,
    progress: MemberLessonProgress,
  ): void {
    const changed =
      courseSlug !== this.courseSlug || lessonSlug !== this.lessonSlug;

    if (changed) {
      this.flush();
      this.detachClock();
    }

    this.courseSlug = courseSlug;
    this.lessonSlug = lessonSlug;
    this.pending = null;
    this.blocked = false;
    this.highWater = progress.furthestPositionSeconds;
    this.lastWriteAt = Date.now();
    this._progress.set(progress);
  }

  /**
   * Starts the 1 s poll against the player's clock.
   *
   * ⚠️ THE STORE OWNS THE TIMING, NOT THE PLAYER (§4.6.4). The player hands
   * over a getter and nothing else; if it also owned a cadence there would be
   * two things deciding when a write happens.
   */
  public attachClock(clock: () => number): void {
    this.detachClock();
    this.clock = clock;
    this.lastWriteAt = Date.now();
    this.pollHandle = setInterval(() => this.tick(), POLL_INTERVAL_MS);
  }

  /** Stops the poll. Safe to call when none is running. */
  public detachClock(): void {
    if (this.pollHandle !== null) {
      clearInterval(this.pollHandle);
      this.pollHandle = null;
    }
    this.clock = null;
  }

  /**
   * Writes any pending position immediately — `pause`, `ended`, teardown.
   *
   * ⚠️ IT IS A NO-OP WHEN THERE IS NOTHING PENDING, which is what stops a pause
   * landing one tick after a scheduled write from double-writing.
   */
  public flush(): void {
    if (this.pending === null) return;
    this.write(this.pending);
  }

  /**
   * R2.3.3 — the member's explicit completion control, and its reverse.
   *
   * A SEPARATE ROUTE from progress, so the stored row records WHICH happened.
   * The response is authoritative: reversing clears `completedAt` and
   * `completionSource` and leaves `furthestPositionSeconds` untouched.
   */
  public setCompletion(complete: boolean): void {
    if (this.lessonSlug === '') return;

    this.savingCompletion.set(true);
    this.api
      .putCompletion(this.courseSlug, this.lessonSlug, complete)
      .subscribe({
        next: (progress) => {
          this.savingCompletion.set(false);
          this.reconcile(progress);
        },
        error: () => this.savingCompletion.set(false),
      });
  }

  /* ---------------------------------------------------------------------- */

  /**
   * One 1 s poll: read the clock, note the position, write if the cadence says
   * so.
   *
   * ⚠️ READING IS CHEAP AND WRITING IS NOT. Everything expensive is behind the
   * {@link WRITE_INTERVAL_MS} gate; the poll itself never touches the network.
   */
  private tick(): void {
    const clock = this.clock;
    if (clock === null || this.blocked) return;

    const position = Math.floor(clock());
    if (!Number.isFinite(position) || position < 0) return;

    // A backward seek — or no movement at all — queues nothing.
    if (position > this.highWater) {
      this.highWater = position;
      this.pending = position;
    }

    if (this.pending === null) return;
    if (Date.now() - this.lastWriteAt < WRITE_INTERVAL_MS) return;

    this.write(this.pending);
  }

  /** One `PUT`, with the latest value. Never overlapping, never queued. */
  private write(positionSeconds: number): void {
    if (this.writing || this.blocked || this.lessonSlug === '') return;

    this.writing = true;
    this.lastWriteAt = Date.now();
    const submitted = positionSeconds;

    this.api
      .putProgress(this.courseSlug, this.lessonSlug, submitted)
      .subscribe({
        next: (progress) => {
          this.writing = false;
          // Only clear the queue if nothing newer arrived while in flight.
          if (this.pending === submitted) this.pending = null;
          this.reconcile(progress);
        },
        error: (error: unknown) => {
          this.writing = false;
          // ⚠️ `pending` IS DELIBERATELY NOT CLEARED — the position survives and
          // the next cadence window retries it, with whatever the LATEST value
          // is by then rather than with this stale one.
          if (isLockedModuleError(error)) {
            // Terminal. The module closed under the member; nothing this store
            // can send will be accepted.
            this.blocked = true;
            this.pending = null;
            this.detachClock();
          }
        },
      });
  }

  /**
   * Replaces the progress state WHOLESALE from a response.
   *
   * ⚠️ NEVER A MERGE. Batch 7's reaction lesson: a merge keeps a
   * locally-guessed value alive when the two disagree, and the server's answer
   * is the only one that matters here — it is the one that decided completion.
   */
  private reconcile(progress: MemberLessonProgress): void {
    this._progress.set(progress);
    this.highWater = Math.max(this.highWater, progress.furthestPositionSeconds);
  }
}
