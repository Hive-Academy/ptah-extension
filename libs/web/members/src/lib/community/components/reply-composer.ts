import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import { MarkdownBlockComponent } from '@ptah-extension/markdown';

/** Mirrors the server's `@MaxLength(50_000)` on `CreatePostDto.bodyMarkdown`. */
const MAX_BODY_LENGTH = 50_000;

/**
 * ReplyComposer — a markdown textarea with a preview, for one reply (R1.3.1).
 *
 * ⚠️ A PLAIN MARKDOWN TEXTAREA, NOT A WYSIWYG, AND THAT IS A SECURITY DECISION
 * AS MUCH AS A SCOPE ONE. A rich-text editor introduces a SECOND content
 * representation (its own HTML) and therefore a second thing to sanitize, which
 * is directly against NFR-S2's "one renderer, one sanitizer". The stored value
 * stays raw markdown, the preview below renders it through the same
 * `<ptah-markdown-block>` the thread uses, and there is exactly one path from
 * text to DOM.
 *
 * ⚠️ THE PREVIEW GOES THROUGH `<ptah-markdown-block>` AND NOTHING ELSE. No
 * `[innerHTML]`, no `bypassSecurityTrustHtml`, no direct `marked` or `dompurify`
 * import. The component resolves the `'member'` preset from the route-level
 * injector `app.routes.ts` installs for the whole `/members` subtree (AD-1,
 * PRE-4), so a member previewing their own post is sanitized by the same
 * allowlist that will sanitize it for everyone else. `markdown-chokepoint.spec.ts`
 * fails the build if that stops being true.
 *
 * `variant="auto"` is required, not cosmetic: `MarkdownBlockComponent` defaults
 * to `'invert'` (always light-on-dark) for the dark-only webview surfaces, which
 * renders near-white body text on the near-white `base-200` of
 * `operator-member-light` — NFR-U5's exact failure mode.
 *
 * ⚠️ NO `FormsModule` / `ngModel`. The state is two signals bound with `[value]`
 * and `(input)`. `ngModel` writes its value back through a microtask, so a
 * keystroke and the derived `canSubmit()` are one tick apart — which is
 * invisible in a browser and makes every spec here race. Signals are the house
 * style anyway (NFR-U1); this is that style being the simpler option as well.
 *
 * ⚠️ PRIVATE TO `libs/web/members` (§5.3). Markdown authoring has no admin
 * equivalent: an operator moderates posts, they do not write them.
 */
@Component({
  selector: 'ptah-reply-composer',
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
          [disabled]="body().length === 0"
          (click)="togglePreview()"
        >
          {{ previewing() ? 'Edit' : 'Preview' }}
        </button>
      </div>

      @if (previewing()) {
        <div
          class="min-h-24 rounded-lg border border-hairline bg-base-100 p-3"
          data-testid="reply-preview"
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
          <button
            type="button"
            class="btn btn-ghost btn-sm normal-case"
            [disabled]="submitting()"
            (click)="cancelled.emit()"
          >
            Cancel
          </button>
          <button
            type="submit"
            class="btn btn-primary btn-sm normal-case"
            [disabled]="!canSubmit()"
          >
            {{ submitting() ? 'Posting…' : 'Post reply' }}
          </button>
        </div>
      </div>

      @if (errorMessage(); as message) {
        <p class="text-sm text-error" role="alert">{{ message }}</p>
      }
    </form>
  `,
})
export class ReplyComposer {
  /**
   * Author of the post being replied to, for the "Replying to X" line. `null`
   * for a top-level reply and for a post whose author is unknown (A-4).
   */
  public readonly replyingTo = input<string | null>(null);

  /** Whether this composer is nested under a parent post — changes the heading. */
  public readonly nested = input<boolean>(false);

  public readonly placeholder = input<string>('Share what you know…');

  /** In flight. Disables the textarea and both buttons. */
  public readonly submitting = input<boolean>(false);

  /**
   * A server-side failure the member has to see — a `403 topic_locked`, a
   * validation rejection. `null` clears it. The page owns the classification;
   * this component only displays it.
   */
  public readonly errorMessage = input<string | null>(null);

  /** The raw markdown the member wrote. Never HTML. */
  public readonly submitted = output<string>();
  public readonly cancelled = output<void>();

  protected readonly maxLength = MAX_BODY_LENGTH;

  /**
   * A stable per-instance id so the `<label for>` points at THIS textarea. Two
   * composers are open at once whenever a member replies inline while the
   * top-level one is showing, and a duplicated id sends both labels to the
   * first field.
   */
  protected readonly bodyId = `reply-body-${nextComposerId()}`;

  protected readonly body = signal('');
  protected readonly previewing = signal(false);

  protected readonly heading = computed<string>(() =>
    this.nested() ? 'Reply to this post' : 'Add a reply',
  );

  /**
   * Mirrors the server's `@MinLength(1)` / `@MaxLength(50_000)` as an
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
   * The NATIVE `submit` event, not `ngSubmit` — this component imports no
   * `FormsModule`, and `(ngSubmit)` without it binds a listener for a DOM event
   * that never fires, silently breaking Enter-to-submit. `preventDefault()`
   * stops the browser navigating away on a form with no `action`.
   */
  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;
    this.submitted.emit(this.body().trim());
  }

  /** Clears the field after the page confirms the post landed. */
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
