import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  AdminLearningApiService,
  type AdminLesson,
} from '../../../../services/admin-learning-api.service';

/**
 * LessonFormModal — create or edit one lesson of a module.
 *
 * Dual mode driven by the `lesson` input: `null` → create
 * (`POST /api/v1/admin/lessons`, with the `moduleId` supplied by the parent),
 * non-null → edit (`PATCH .../lessons/:id`).
 *
 * 🔴 THE VIDEO IS A TRI-STATE ON EDIT AND THIS FORM SENDS ALL THREE STATES.
 * The server touches the five video columns only if the request MENTIONS the
 * video: omitting all three video keys leaves them alone, and
 * `youtubeVideoIdOrUrl: ''` DETACHES the video and clears every one of them.
 * So the form sends the video keys only when the admin actually changed
 * something about the video, and sends the empty string when they cleared the
 * field on a lesson that had one. A form that always sent the video keys would
 * rewrite `videoMetadataSource` to `'manual'` on every title fix.
 *
 * ⚠️ `youtubeVideoIdOrUrl` ACCEPTS AN ID OR A URL. The server extracts the
 * 11-character id, so a pasted watch URL, a share link and a bare id are all
 * accepted and there is no client-side parse to drift from the server's.
 *
 * ⚠️ `videoDurationSeconds` IS A DURATION, NEVER A POSITION. It is what member
 * completion is derived from (90 % of it), and a lesson that has a video but no
 * duration is manual-completion-only. With `YOUTUBE_API_KEY` unset nothing is
 * fetched, so the duration typed here is the only one there will be — the form
 * says so rather than leaving an admin to discover it.
 *
 * ⚠️ THE BODY IS MARKDOWN AND IS NEVER PREVIEWED HERE. It is edited as plain
 * text in a textarea; rendering it would put a second consumer on the member
 * panel's sanitizer, which the NFR-S2 chokepoint spec does not police outside
 * `libs/web/members`.
 */
@Component({
  selector: 'ptah-admin-lesson-form-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lesson-form-modal.html',
})
export class LessonFormModal {
  private readonly api = inject(AdminLearningApiService);

  public readonly open = input<boolean>(false);

  /** The module a created lesson belongs to. Ignored in edit mode. */
  public readonly moduleId = input.required<string>();

  /** `null` = create mode. Non-null = edit mode. */
  public readonly lesson = input<AdminLesson | null>(null);

  public readonly closeModal = output<void>();
  public readonly saved = output<AdminLesson>();

  protected readonly title = signal<string>('');
  protected readonly bodyMarkdown = signal<string>('');
  protected readonly videoIdOrUrl = signal<string>('');
  protected readonly videoTitle = signal<string>('');
  /** Raw text so an empty box is distinguishable from a typed zero. */
  protected readonly videoDurationText = signal<string>('');

  protected readonly saving = signal<boolean>(false);
  protected readonly errorMessage = signal<string | null>(null);

  /** What the video fields held when the modal opened — the change baseline. */
  private videoBaseline = { idOrUrl: '', title: '', duration: '' };

  protected readonly isEdit = computed<boolean>(() => this.lesson() !== null);

  protected readonly durationValue = computed<number | null>(() => {
    const raw = this.videoDurationText().trim();
    if (raw.length === 0) return null;
    const parsed = Number(raw);
    if (!Number.isInteger(parsed) || parsed < 0) return null;
    return parsed;
  });

  protected readonly durationValid = computed<boolean>(
    () =>
      this.videoDurationText().trim().length === 0 ||
      this.durationValue() !== null,
  );

  /** True when a video id is set but no duration is — manual completion only. */
  protected readonly manualCompletionOnly = computed<boolean>(
    () =>
      this.videoIdOrUrl().trim().length > 0 && this.durationValue() === null,
  );

  protected readonly canSubmit = computed<boolean>(() => {
    if (this.saving()) return false;
    if (this.title().trim().length < 3) return false;
    if (this.bodyMarkdown().trim().length === 0) return false;
    return this.durationValid();
  });

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      const l = this.lesson();
      this.title.set(l?.title ?? '');
      this.bodyMarkdown.set(l?.bodyMarkdown ?? '');
      const idOrUrl = l?.youtubeVideoId ?? '';
      const vTitle = l?.videoTitle ?? '';
      const duration =
        l?.videoDurationSeconds === null ||
        l?.videoDurationSeconds === undefined
          ? ''
          : String(l.videoDurationSeconds);
      this.videoIdOrUrl.set(idOrUrl);
      this.videoTitle.set(vTitle);
      this.videoDurationText.set(duration);
      this.videoBaseline = { idOrUrl, title: vTitle, duration };
      this.saving.set(false);
      this.errorMessage.set(null);
    });
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onBodyInput(event: Event): void {
    this.bodyMarkdown.set(
      (event.target as HTMLTextAreaElement | null)?.value ?? '',
    );
  }

  protected onVideoIdInput(event: Event): void {
    this.videoIdOrUrl.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onVideoTitleInput(event: Event): void {
    this.videoTitle.set((event.target as HTMLInputElement | null)?.value ?? '');
  }

  protected onVideoDurationInput(event: Event): void {
    this.videoDurationText.set(
      (event.target as HTMLInputElement | null)?.value ?? '',
    );
  }

  protected onCloseClick(): void {
    if (this.saving()) return;
    this.closeModal.emit();
  }

  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;

    this.saving.set(true);
    this.errorMessage.set(null);

    const existing = this.lesson();
    const request$ = existing
      ? this.api.updateLesson(existing.id, {
          title: this.title().trim(),
          bodyMarkdown: this.bodyMarkdown(),
          ...this.videoPatch(),
        })
      : this.api.createLesson({
          moduleId: this.moduleId(),
          title: this.title().trim(),
          bodyMarkdown: this.bodyMarkdown(),
          youtubeVideoIdOrUrl: this.optional(this.videoIdOrUrl()),
          videoTitle: this.optional(this.videoTitle()),
          videoDurationSeconds: this.durationValue() ?? undefined,
        });

    request$.subscribe({
      next: (result) => {
        this.saving.set(false);
        this.saved.emit(result);
      },
      error: (err: unknown) => {
        this.saving.set(false);
        this.errorMessage.set(this.extractErrorMessage(err));
      },
    });
  }

  /**
   * The video half of a `PATCH` body — EMPTY when nothing about the video
   * changed.
   *
   * That emptiness is the point. Any of the three keys makes the server
   * re-resolve all five video columns, which with `YOUTUBE_API_KEY` unset means
   * rewriting a previously fetched row to `videoMetadataSource: 'manual'`.
   * Sending them unconditionally would destroy fetched metadata every time an
   * admin fixed a typo in the title.
   */
  private videoPatch(): {
    youtubeVideoIdOrUrl?: string;
    videoTitle?: string;
    videoDurationSeconds?: number;
  } {
    const idOrUrl = this.videoIdOrUrl().trim();
    const vTitle = this.videoTitle().trim();
    const duration = this.videoDurationText().trim();
    const unchanged =
      idOrUrl === this.videoBaseline.idOrUrl.trim() &&
      vTitle === this.videoBaseline.title.trim() &&
      duration === this.videoBaseline.duration.trim();
    if (unchanged) return {};

    // An emptied id is the DETACH signal and must be sent as `''`, not dropped.
    return {
      youtubeVideoIdOrUrl: idOrUrl,
      videoTitle: vTitle.length > 0 ? vTitle : undefined,
      videoDurationSeconds: this.durationValue() ?? undefined,
    };
  }

  private optional(value: string): string | undefined {
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  }

  /** Never surfaces a raw `HttpErrorResponse` — see `CoursesList` for why. */
  private extractErrorMessage(err: unknown): string {
    if (typeof err === 'string') return err;
    if (err && typeof err === 'object') {
      const body = (err as { error?: { message?: string | string[] } }).error;
      const msg = body?.message;
      if (Array.isArray(msg)) return msg.join(', ');
      if (typeof msg === 'string' && msg.length > 0) return msg;
    }
    return 'Could not save the lesson. Please try again.';
  }
}
