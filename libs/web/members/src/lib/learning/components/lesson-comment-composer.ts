import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { MarkdownBlockComponent } from '@ptah-extension/markdown';

/** Mirrors the server's `@MaxLength(10_000)` on `CreateCommentDto.bodyMarkdown`. */
const MAX_BODY_LENGTH = 10_000;

/**
 * LessonCommentComposer — a markdown textarea with a preview, for one lesson
 * comment (R2.5.1).
 *
 * ⚠️ A PLAIN MARKDOWN TEXTAREA, NOT A WYSIWYG, AND THAT IS A SECURITY DECISION.
 * A rich-text editor introduces a SECOND content representation (its own HTML)
 * and therefore a second thing to sanitize, directly against NFR-S2's "one
 * renderer, one sanitizer". The stored value stays raw markdown and the preview
 * renders through the same `<ptah-markdown-block>` the thread uses.
 *
 * ⚠️ `variant="auto"` IS LOAD-BEARING, NOT COSMETIC. `MarkdownBlockComponent`
 * defaults to `'invert'` for the dark-only webview surfaces, which renders
 * near-white body text on the near-white `base-200` of `operator-member-light`
 * — NFR-U5's exact failure mode.
 *
 * ⚠️ NO `FormsModule` / `ngModel`, DELIBERATELY. `ngModel` writes its value back
 * through a microtask, so a keystroke and the derived `canSubmit()` are one tick
 * apart — invisible in a browser and it made every Batch 7 spec race. Two
 * consequences that cost Batch 7 time and are honoured here: `(submit)` is the
 * NATIVE event (`(ngSubmit)` without `FormsModule` binds a listener for a DOM
 * event that never fires, silently breaking Enter-to-submit), and `maxlength` is
 * `[attr.maxlength]` (`[maxlength]` is a `FormsModule` directive input and fails
 * with `NG0303`).
 *
 * ⚠️ 🔴 A-8 — NO REACTIONS ON THIS SURFACE. There is no `ReactionBar` here and
 * no `REACTION_TYPES` import in this file or in `lesson-comments.ts`. Lesson
 * comments get the "Answered" treatment INSTEAD of reactions, and the absence is
 * asserted precisely because "add it for consistency with the forum" is the
 * obvious next change.
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3). Markdown authoring has no admin
 * equivalent — an operator moderates comments, they do not write them.
 */
@Component({
  selector: 'ptah-lesson-comment-composer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    <form
      class="flex flex-col gap-3 rounded-xl border border-hairline bg-base-200 p-4"
      (submit)="submit($event)"
    >
      @if (replyingTo(); as name) {
        <p class="text-xs text-base-content-muted">
          Replying to <span class="font-semibold">{{ name }}</span>
        </p>
      }

      <div class="flex items-center justify-between gap-2">
        <label
          class="text-sm font-semibold text-base-content"
          [attr.for]="bodyId"
        >
          {{ heading() }}
        </label>
        <button
          type="button"
          class="btn btn-ghost btn-xs normal-case"
          [attr.aria-pressed]="previewing()"
          [attr.aria-label]="
            previewing() ? 'Back to editing' : 'Preview your comment'
          "
          [disabled]="body().length === 0"
          (click)="togglePreview()"
        >
          {{ previewing() ? 'Edit' : 'Preview' }}
        </button>
      </div>

      @if (previewing()) {
        <div
          class="min-h-24 rounded-lg border border-hairline bg-base-100 p-3"
          data-testid="comment-preview"
        >
          <ptah-markdown-block [content]="body()" variant="auto" />
        </div>
      } @else {
        <textarea
          [id]="bodyId"
          class="textarea textarea-bordered min-h-24 w-full bg-base-100 font-mono text-sm"
          [placeholder]="placeholder()"
          [attr.maxlength]="maxLength"
          [disabled]="submitting()"
          [value]="body()"
          (input)="onInput($event)"
        ></textarea>
      }

      <div class="flex flex-wrap items-center justify-between gap-2">
        <p class="text-xs text-base-content-muted">
          Markdown supported. {{ body().length }} / {{ maxLength }}
        </p>
        <div class="flex items-center gap-2">
          @if (cancellable()) {
            <button
              type="button"
              class="btn btn-ghost btn-sm normal-case"
              [disabled]="submitting()"
              (click)="cancelled.emit()"
            >
              Cancel
            </button>
          }
          <button
            type="submit"
            class="btn btn-primary btn-sm normal-case"
            [disabled]="!canSubmit()"
          >
            {{ submitting() ? 'Posting…' : submitLabel() }}
          </button>
        </div>
      </div>

      @if (errorMessage(); as message) {
        <p class="text-sm text-error" role="alert">{{ message }}</p>
      }
    </form>
  `,
})
export class LessonCommentComposer {
  /** Author of the comment being replied to. `null` for a top-level question. */
  public readonly replyingTo = input<string | null>(null);

  /** Nested under a parent comment — changes the heading and the button. */
  public readonly nested = input<boolean>(false);

  public readonly placeholder = input<string>(
    'Ask about this lesson, or share what worked…',
  );

  /** In flight. Disables the textarea and both buttons. */
  public readonly submitting = input<boolean>(false);

  /** Shows a Cancel button. The page-level composer has nothing to cancel to. */
  public readonly cancellable = input<boolean>(true);

  /**
   * A server-side failure the member has to see. The page owns the
   * classification; this component only displays it.
   */
  public readonly errorMessage = input<string | null>(null);

  /** The raw markdown the member wrote. Never HTML. */
  public readonly submitted = output<string>();
  public readonly cancelled = output<void>();

  protected readonly maxLength = MAX_BODY_LENGTH;

  /**
   * A stable per-instance id so `<label for>` points at THIS textarea. Two
   * composers are open at once whenever a member replies inline while the
   * page-level one is showing, and a duplicated id sends both labels to the
   * first field.
   */
  protected readonly bodyId = `lesson-comment-body-${nextComposerId()}`;

  protected readonly body = signal('');
  protected readonly previewing = signal(false);

  protected readonly heading = computed<string>(() =>
    this.nested() ? 'Reply to this comment' : 'Ask a question',
  );

  protected readonly submitLabel = computed<string>(() =>
    this.nested() ? 'Post reply' : 'Post question',
  );

  /**
   * Mirrors the server's `@MinLength(1)` / `@MaxLength(10_000)` as an
   * AFFORDANCE — a disabled button, not a rejection. The server is the
   * boundary; this only stops the member finding out via a round trip.
   */
  protected readonly canSubmit = computed<boolean>(() => {
    const length = this.body().trim().length;
    return !this.submitting() && length > 0 && length <= MAX_BODY_LENGTH;
  });

  protected onInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  protected togglePreview(): void {
    this.previewing.update((value) => !value);
  }

  /**
   * The NATIVE `submit` event — see the class docblock. `preventDefault()` stops
   * the browser navigating away on a form with no `action`.
   */
  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;
    this.submitted.emit(this.body().trim());
  }

  /** Clears the field after the page confirms the comment landed. */
  public reset(): void {
    this.body.set('');
    this.previewing.set(false);
  }
}

let composerSequence = 0;
function nextComposerId(): number {
  composerSequence += 1;
  return composerSequence;
}
