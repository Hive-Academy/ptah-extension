import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  input,
  output,
  signal,
  untracked,
} from '@angular/core';

import { DetailDrawer } from '@ptah-web/panel-ui';

import {
  type AdminCategory,
  type AdminCreateTopicRequest,
} from '../../../../services/admin-builders-api.service';
import {
  BODY_MAX_LENGTH,
  BODY_MIN_LENGTH,
  TITLE_MAX_LENGTH,
  TITLE_MIN_LENGTH,
} from '../../community-limits';

/**
 * NewThreadModal — the admin authoring form for `POST /admin/community/topics`.
 *
 * ⚠️ IT AUTHORS MARKDOWN AND RENDERS NONE. The body is a plain `<textarea>`
 * with no preview and there is no `[innerHTML]` here. Previewing the draft
 * would put a second consumer on the member markdown chokepoint from an admin
 * surface; the admin reads it back through the member thread view, where it is
 * sanitized once.
 *
 * ⚠️ IT MAKES NO REQUEST. {@link submitted} carries the exact
 * `AdminCreateTopicRequest` body and the route component owns the write, the
 * saving flag and the server's sentence — the response is `{ id, slug }` and
 * the queue has to be re-read, which is the route component's data.
 *
 * The guards below mirror `CreateAdminTopicDto` (`community-limits.ts`). They
 * are not the boundary: they exist so the common mistake never becomes a 400
 * whose `message: string[]` body the screen has to mask.
 */
@Component({
  selector: 'ptah-admin-new-thread-modal',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [DetailDrawer],
  templateUrl: './new-thread-modal.html',
})
export class NewThreadModal {
  /** Show/hide the drawer. The route component owns the signal. */
  public readonly open = input<boolean>(false);

  /**
   * EVERY category, with no visibility filter — an admin authoring a thread
   * sees the same list they moderate, including `staff` ones.
   */
  public readonly categories = input.required<readonly AdminCategory[]>();

  /** True while the route component's `POST` is in flight. */
  public readonly saving = input<boolean>(false);

  /** The route component's sentence for a failed `POST`, or `null`. */
  public readonly errorMessage = input<string | null>(null);

  /** The exact body for `POST /admin/community/topics`. */
  public readonly submitted = output<AdminCreateTopicRequest>();

  /** The operator discarded the draft. */
  public readonly cancelled = output<void>();

  protected readonly titleMaxLength = TITLE_MAX_LENGTH;
  protected readonly bodyMaxLength = BODY_MAX_LENGTH;

  protected readonly categoryId = signal('');
  protected readonly title = signal('');
  protected readonly body = signal('');
  protected readonly pinned = signal(false);
  protected readonly locked = signal(false);

  /** This form's own refusal. Cleared the moment a submit is attempted. */
  private readonly formError = signal<string | null>(null);

  /**
   * The form's own refusal wins over the server's: it is the newer one, and it
   * is the one the operator can act on without another round trip.
   */
  protected readonly visibleError = computed<string | null>(
    () => this.formError() ?? this.errorMessage(),
  );

  public constructor() {
    effect(() => {
      if (!this.open()) return;
      // ⚠️ THE RESET TRACKS `open` AND NOTHING ELSE. Reading `categories`
      // tracked would re-run this whenever the route component re-reads the
      // list, and a category created in the section behind the drawer would
      // wipe the draft the operator is typing.
      untracked(() => {
        this.formError.set(null);
        this.title.set('');
        this.body.set('');
        this.pinned.set(false);
        this.locked.set(false);
        this.categoryId.set(this.categories()[0]?.id ?? '');
      });
    });
  }

  protected onCategory(event: Event): void {
    this.categoryId.set((event.target as HTMLSelectElement).value);
  }

  protected onTitle(event: Event): void {
    this.title.set((event.target as HTMLInputElement).value);
  }

  protected onBody(event: Event): void {
    this.body.set((event.target as HTMLTextAreaElement).value);
  }

  protected togglePinned(): void {
    this.pinned.update((value) => !value);
  }

  protected toggleLocked(): void {
    this.locked.update((value) => !value);
  }

  protected onCancel(): void {
    this.cancelled.emit();
  }

  protected submit(event: Event): void {
    event.preventDefault();

    const categoryId = this.categoryId();
    const title = this.title().trim();
    const body = this.body().trim();

    const invalid = guardBody(categoryId, title, body);
    if (invalid !== null) {
      this.formError.set(invalid);
      return;
    }

    this.formError.set(null);
    this.submitted.emit({
      categoryId,
      title,
      body,
      pinned: this.pinned(),
      locked: this.locked(),
    });
  }
}

/** Mirrors `CreateAdminTopicDto`, field by field, in the order it declares. */
function guardBody(
  categoryId: string,
  title: string,
  body: string,
): string | null {
  if (categoryId === '') return 'Pick a category for the thread.';
  if (title.length < TITLE_MIN_LENGTH) {
    return `A title needs at least ${TITLE_MIN_LENGTH} characters.`;
  }
  if (title.length > TITLE_MAX_LENGTH) {
    return `A title is at most ${TITLE_MAX_LENGTH} characters.`;
  }
  if (body.length < BODY_MIN_LENGTH) return 'The first post cannot be empty.';
  if (body.length > BODY_MAX_LENGTH) {
    return `The first post is at most ${BODY_MAX_LENGTH} characters.`;
  }
  return null;
}
