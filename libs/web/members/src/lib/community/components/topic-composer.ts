import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
  signal,
} from '@angular/core';

import type { MemberCategory } from '@ptah-contracts/community';
import { MarkdownBlockComponent } from '@ptah-extension/markdown';

/** Mirror the server's `CreateTopicDto` bounds — affordances, not validation. */
const MIN_TITLE_LENGTH = 3;
const MAX_TITLE_LENGTH = 200;
const MAX_BODY_LENGTH = 50_000;

/** What `POST /v1/members/community/topics` takes. */
export interface TopicDraft {
  categoryId: string;
  title: string;
  bodyMarkdown: string;
}

/**
 * TopicComposer — start a new thread (R1.2.1).
 *
 * ⚠️ THERE IS NO SEPARATE "BODY" FIELD ON A TOPIC. Post #1 IS the body (AD-9):
 * `Topic` has no `body` column, `MemberTopicDetail` has no `bodyMarkdown`, and
 * the server writes the topic and post #1 in one transaction. So the field below
 * named `bodyMarkdown` is the first POST's text, and that is why this composer
 * and the reply composer share the same 50 000-character bound — they are
 * writing the same kind of row.
 *
 * ⚠️ A PLAIN MARKDOWN TEXTAREA WITH A PREVIEW, NOT A WYSIWYG. A rich-text
 * editor is a second content representation and therefore a second sanitization
 * path, directly against NFR-S2. See {@link ReplyComposer}'s docblock — the two
 * make the same decision for the same reason.
 *
 * ⚠️ THE PREVIEW RENDERS THROUGH `<ptah-markdown-block>` AND NOTHING ELSE (AD-1,
 * PRE-4). `variant="auto"` because this surface has a light theme; the component
 * default is `'invert'` for the dark-only webview and would put near-white text
 * on the near-white `base-200` of `operator-member-light`.
 *
 * ⚠️ THE CATEGORY LIST IS PASSED IN, ALREADY FILTERED. `MemberCategory[]` from
 * `GET categories` has already passed `buildCategoryVisibilityWhere` in the SQL.
 * This component does no visibility filtering and must not: a category a member
 * cannot see is one they never learn exists (R1.1.3), not one this dropdown
 * hides. `visibility` is a LABEL here, rendered as a suffix beside the name.
 *
 * ⚠️ NO `FormsModule` / `ngModel` — see {@link ReplyComposer}. The selected
 * option is driven by `[selected]` on each `<option>` rather than by `[value]`
 * on the `<select>`: the options are rendered by an `@for` in the same change
 * detection pass, and a `<select>` whose `value` is set before its options exist
 * silently resets to the first one.
 */
@Component({
  selector: 'ptah-topic-composer',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MarkdownBlockComponent],
  template: `
    <form
      class="flex flex-col gap-4 rounded-xl border border-hairline bg-base-200 p-5"
      (submit)="submit($event)"
    >
      <h2 class="text-lg font-semibold text-base-content">Start a thread</h2>

      <div class="flex flex-col gap-1">
        <label
          class="text-sm font-medium text-base-content"
          [attr.for]="categoryFieldId"
        >
          Category
        </label>
        <select
          [id]="categoryFieldId"
          class="select select-bordered w-full bg-base-100 text-sm"
          [disabled]="submitting()"
          (change)="onCategoryChange($event)"
        >
          <option value="" [selected]="category() === ''">
            Choose a category…
          </option>
          @for (option of categories(); track option.id) {
            <option [value]="option.id" [selected]="option.id === category()">
              {{ option.name }}{{ visibilitySuffix(option) }}
            </option>
          }
        </select>
      </div>

      <div class="flex flex-col gap-1">
        <label
          class="text-sm font-medium text-base-content"
          [attr.for]="titleFieldId"
        >
          Title
        </label>
        <input
          [id]="titleFieldId"
          type="text"
          class="input input-bordered w-full bg-base-100 text-sm"
          placeholder="What do you want to ask or share?"
          [attr.maxlength]="maxTitleLength"
          [disabled]="submitting()"
          [value]="title()"
          (input)="onTitleInput($event)"
        />
        <p class="text-xs text-base-content/60">
          {{ minTitleLength }}-{{ maxTitleLength }} characters.
        </p>
      </div>

      <div class="flex flex-col gap-1">
        <div class="flex items-center justify-between gap-2">
          <label
            class="text-sm font-medium text-base-content"
            [attr.for]="bodyFieldId"
          >
            First post
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
            class="min-h-32 rounded-lg border border-hairline bg-base-100 p-3"
            data-testid="topic-preview"
          >
            <ptah-markdown-block [content]="body()" variant="auto" />
          </div>
        } @else {
          <textarea
            [id]="bodyFieldId"
            class="textarea textarea-bordered min-h-32 w-full bg-base-100 font-mono text-sm"
            placeholder="Markdown supported."
            [attr.maxlength]="maxBodyLength"
            [disabled]="submitting()"
            [value]="body()"
            (input)="onBodyInput($event)"
          ></textarea>
        }
        <p class="text-xs text-base-content/60">
          Markdown supported. {{ body().length }} / {{ maxBodyLength }}
        </p>
      </div>

      <div class="flex flex-wrap items-center justify-end gap-2">
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
          {{ submitting() ? 'Posting…' : 'Post thread' }}
        </button>
      </div>

      @if (errorMessage(); as message) {
        <p class="text-sm text-error" role="alert">{{ message }}</p>
      }
    </form>
  `,
})
export class TopicComposer {
  /** Already visibility-filtered by the server — see the class docblock. */
  public readonly categories = input.required<readonly MemberCategory[]>();

  /** Preselects the rail's current category so the member does not re-pick it. */
  public readonly initialCategoryId = input<string | null>(null);

  public readonly submitting = input<boolean>(false);
  public readonly errorMessage = input<string | null>(null);

  public readonly submitted = output<TopicDraft>();
  public readonly cancelled = output<void>();

  protected readonly minTitleLength = MIN_TITLE_LENGTH;
  protected readonly maxTitleLength = MAX_TITLE_LENGTH;
  protected readonly maxBodyLength = MAX_BODY_LENGTH;

  private readonly instance = nextComposerId();
  protected readonly categoryFieldId = `topic-category-${this.instance}`;
  protected readonly titleFieldId = `topic-title-${this.instance}`;
  protected readonly bodyFieldId = `topic-body-${this.instance}`;

  private readonly chosenCategory = signal<string | null>(null);
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly previewing = signal(false);

  /**
   * The member's explicit choice wins; otherwise the rail's current category.
   *
   * An OVERRIDE signal read through a `computed`, rather than a signal seeded
   * once from the input: seeding once would ignore a rail that settled after the
   * composer opened, and mirroring the input outright would silently move a
   * draft the member had already retargeted.
   */
  protected readonly category = computed<string>(
    () => this.chosenCategory() ?? this.initialCategoryId() ?? '',
  );

  protected readonly canSubmit = computed<boolean>(() => {
    const title = this.title().trim();
    const body = this.body().trim();
    return (
      !this.submitting() &&
      this.category().length > 0 &&
      title.length >= MIN_TITLE_LENGTH &&
      title.length <= MAX_TITLE_LENGTH &&
      body.length > 0 &&
      body.length <= MAX_BODY_LENGTH
    );
  });

  /** `(cohort only)` / `(staff)` beside a name — a LABEL, never a gate. */
  protected visibilitySuffix(option: MemberCategory): string {
    if (option.visibility === 'cohort') return ' (cohort only)';
    if (option.visibility === 'staff') return ' (staff)';
    return '';
  }

  protected onCategoryChange(event: Event): void {
    this.chosenCategory.set((event.target as HTMLSelectElement).value);
  }

  protected onTitleInput(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  protected onBodyInput(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  protected togglePreview(): void {
    this.previewing.update((value) => !value);
  }

  /** Native `submit`, not `ngSubmit` — see {@link ReplyComposer.submit}. */
  protected submit(event: Event): void {
    event.preventDefault();
    if (!this.canSubmit()) return;
    this.submitted.emit({
      categoryId: this.category(),
      title: this.title().trim(),
      bodyMarkdown: this.body().trim(),
    });
  }

  /** Clears the draft after the page confirms the topic landed. */
  public reset(): void {
    this.chosenCategory.set(null);
    this.title.set('');
    this.body.set('');
    this.previewing.set(false);
  }
}

let composerSequence = 0;
function nextComposerId(): number {
  composerSequence += 1;
  return composerSequence;
}
