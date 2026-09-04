import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  output,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { VISIBILITIES, type Visibility } from '@ptah-contracts/community';
import { TagChip } from '@ptah-web/panel-ui';

import {
  AdminBuildersApiService,
  CATEGORY_SLUG_REGEX,
  type AdminCategory,
} from '../../../../services/admin-builders-api.service';
import {
  CATEGORY_DESCRIPTION_MAX_LENGTH,
  CATEGORY_NAME_MAX_LENGTH,
  CATEGORY_NAME_MIN_LENGTH,
  CATEGORY_SLUG_MAX_LENGTH,
  CATEGORY_SLUG_MIN_LENGTH,
} from '../../community-limits';
import { describeFailure } from '../../failure-text';

/**
 * CategoryManager — the category write surface of `/admin/builders/community`.
 *
 * ⚠️ THIS SECTION IS THE FIX FOR "0 THREADS". `Topic.categoryId` is a required
 * foreign key, so a forum with no category cannot hold a thread — "0 threads"
 * was a missing WRITE surface, not a filter. It lives inside the moderation
 * screen rather than at its own route because the two are the same operator
 * task, and because the moderation empty state has to be able to point at it.
 *
 * ⚠️ IT OWNS ITS WRITES AND OWNS NO DATA. `categories` is an input the route
 * component reads, and every successful write emits {@link changed} rather than
 * patching a local copy: the category filter, every row's move control and the
 * new-thread select all read that same list, so a create that appended here
 * would leave the other three blind to it.
 */
@Component({
  selector: 'ptah-admin-category-manager',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TagChip],
  templateUrl: './category-manager.html',
})
export class CategoryManager {
  private readonly api = inject(AdminBuildersApiService);
  private readonly destroyRef = inject(DestroyRef);

  /** The current list, owned and re-read by the route component. */
  public readonly categories = input.required<readonly AdminCategory[]>();

  /**
   * The route component's sentence for a FAILED category read, or `null`.
   *
   * ⚠️ NOT THE SAME THING AS AN EMPTY LIST, AND THE DIFFERENCE IS LOAD-BEARING.
   * A swallowed read failure makes an empty `categories` input mean either "the
   * forum has no category" or "we do not know", and the screen then asserts the
   * first one.
   */
  public readonly loadError = input<string | null>(null);

  /** True while the route component re-reads the list. Disables the writes. */
  public readonly busy = input<boolean>(false);

  /**
   * The list must be re-read. Emitted after every successful write and when the
   * operator retries a failed read.
   */
  public readonly changed = output<void>();

  protected readonly visibilities = VISIBILITIES;

  /** The operator's own choice. Irrelevant while {@link forcedOpen} holds. */
  private readonly manuallyOpened = signal(false);

  /**
   * ⚠️ FORCED OPEN IN THE TWO STATES THIS SECTION EXISTS TO FIX: a forum with
   * no category cannot hold a thread, and a failed read has to offer the retry.
   * Collapsing the remedy is not a useful choice, so the toggle is disabled
   * rather than silently ignored.
   */
  protected readonly forcedOpen = computed<boolean>(
    () => this.categories().length === 0 || this.loadError() !== null,
  );

  protected readonly open = computed<boolean>(
    () => this.forcedOpen() || this.manuallyOpened(),
  );

  protected readonly error = signal<string | null>(null);
  /** The category with a write in flight, so its row's controls disable. */
  protected readonly busyId = signal<string | null>(null);
  protected readonly creating = signal(false);

  protected readonly hasCategories = computed<boolean>(
    () => this.categories().length > 0,
  );

  protected readonly draftName = signal('');
  protected readonly draftSlug = signal('');
  /**
   * True once the admin types in the slug field. The name-to-slug suggestion
   * stops overwriting it from that point, because a slug is long-lived
   * navigation an admin should be able to choose.
   */
  private readonly slugEdited = signal(false);
  protected readonly draftDescription = signal('');
  protected readonly draftVisibility = signal<Visibility>('member');
  /** Comma- or space-separated `MemberGroup.key` values. */
  protected readonly draftCohortKeys = signal('');

  protected readonly editingId = signal<string | null>(null);
  protected readonly editName = signal('');
  protected readonly editDescription = signal('');
  protected readonly editVisibility = signal<Visibility>('member');
  protected readonly editCohortKeys = signal('');

  /** The category awaiting a delete confirmation, by id. */
  protected readonly pendingDeleteId = signal<string | null>(null);

  protected toggleOpen(): void {
    this.manuallyOpened.update((open) => !open);
  }

  /** Asks the route component to read the list again after a failed read. */
  protected retryLoad(): void {
    this.changed.emit();
  }

  protected onDraftName(event: Event): void {
    const name = (event.target as HTMLInputElement).value;
    this.draftName.set(name);
    if (!this.slugEdited()) this.draftSlug.set(slugify(name));
  }

  protected onDraftSlug(event: Event): void {
    this.slugEdited.set(true);
    this.draftSlug.set((event.target as HTMLInputElement).value);
  }

  protected onDraftDescription(event: Event): void {
    this.draftDescription.set((event.target as HTMLTextAreaElement).value);
  }

  protected onDraftVisibility(event: Event): void {
    this.draftVisibility.set(
      (event.target as HTMLSelectElement).value as Visibility,
    );
  }

  protected onDraftCohortKeys(event: Event): void {
    this.draftCohortKeys.set((event.target as HTMLInputElement).value);
  }

  /**
   * Creates a category and asks for a RELOAD rather than appending the response.
   *
   * The reload is what makes the filter select, every row's move control and
   * the new-thread select see the category. It also picks up the `sortOrder`
   * the server chose, which a client that did not send one cannot know.
   */
  protected createCategory(event: Event): void {
    event.preventDefault();

    const name = this.draftName().trim();
    const slug = this.draftSlug().trim();
    const visibility = this.draftVisibility();
    const cohortKeys = splitKeys(this.draftCohortKeys());
    const description = this.draftDescription().trim();
    const invalid = this.formError(
      name,
      description,
      visibility,
      cohortKeys,
      slug,
    );
    if (invalid !== null) {
      this.error.set(invalid);
      return;
    }

    this.creating.set(true);
    this.error.set(null);

    this.api
      .createCommunityCategory({
        slug,
        name,
        description: description === '' ? null : description,
        visibility,
        cohortKeys,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.creating.set(false);
          this.resetDraft();
          this.changed.emit();
        },
        error: (failure: unknown) => {
          this.creating.set(false);
          this.error.set(
            describeFailure(failure, 'We could not create the category.'),
          );
        },
      });
  }

  protected startEdit(category: AdminCategory): void {
    this.editingId.set(category.id);
    this.editName.set(category.name);
    this.editDescription.set(category.description ?? '');
    this.editVisibility.set(category.visibility);
    this.editCohortKeys.set(category.cohortKeys.join(', '));
    this.pendingDeleteId.set(null);
    this.error.set(null);
  }

  protected cancelEdit(): void {
    this.editingId.set(null);
  }

  protected onEditName(event: Event): void {
    this.editName.set((event.target as HTMLInputElement).value);
  }

  protected onEditDescription(event: Event): void {
    this.editDescription.set((event.target as HTMLTextAreaElement).value);
  }

  protected onEditVisibility(event: Event): void {
    this.editVisibility.set(
      (event.target as HTMLSelectElement).value as Visibility,
    );
  }

  protected onEditCohortKeys(event: Event): void {
    this.editCohortKeys.set((event.target as HTMLInputElement).value);
  }

  /** Saves an inline edit. `slug` is never sent — the server rejects it. */
  protected saveEdit(id: string): void {
    const name = this.editName().trim();
    const visibility = this.editVisibility();
    const cohortKeys = splitKeys(this.editCohortKeys());
    const description = this.editDescription().trim();
    const invalid = this.formError(name, description, visibility, cohortKeys);
    if (invalid !== null) {
      this.error.set(invalid);
      return;
    }

    this.busyId.set(id);
    this.error.set(null);

    this.api
      .updateCommunityCategory(id, {
        name,
        description: description === '' ? null : description,
        visibility,
        cohortKeys,
      })
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.editingId.set(null);
          this.changed.emit();
        },
        error: (failure: unknown) => {
          this.busyId.set(null);
          this.error.set(
            describeFailure(failure, 'We could not update the category.'),
          );
        },
      });
  }

  /**
   * Moves one category up or down.
   *
   * ⚠️ SENDS EVERY ID, NOT THE PAIR THAT MOVED. `sortOrder` is a total ordering
   * and the server refuses a partial list with a 400 and no writes, because
   * renumbering a subset onto the sparse scale would interleave it with the
   * untouched rows at values nobody chose. So the swap happens in a local copy
   * and the whole resulting order is submitted.
   */
  protected moveCategory(id: string, delta: -1 | 1): void {
    const ids = this.categories().map((category) => category.id);
    const from = ids.indexOf(id);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= ids.length) return;

    const reordered = [...ids];
    reordered[from] = ids[to];
    reordered[to] = ids[from];

    this.busyId.set(id);
    this.error.set(null);

    this.api
      .reorderCommunityCategories(reordered)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.changed.emit();
        },
        error: (failure: unknown) => {
          this.busyId.set(null);
          this.error.set(
            describeFailure(failure, 'We could not reorder the categories.'),
          );
        },
      });
  }

  protected askDelete(id: string): void {
    this.pendingDeleteId.set(id);
    this.editingId.set(null);
    this.error.set(null);
  }

  protected cancelDelete(): void {
    this.pendingDeleteId.set(null);
  }

  /**
   * Deletes a category. This one is a HARD delete, unlike every other delete on
   * this screen, and the database refuses it while the category holds topics.
   *
   * ⚠️ THE 409 CARRIES THE ONLY ACTIONABLE SENTENCE IN THE RESPONSE — it names
   * the remedy ("Move or delete its topics first"). `describeFailure()`
   * surfaces a 400 and a 409 body for exactly this reason.
   */
  protected confirmDelete(id: string): void {
    this.busyId.set(id);
    this.error.set(null);

    this.api
      .deleteCommunityCategory(id)
      .pipe(takeUntilDestroyed(this.destroyRef))
      .subscribe({
        next: () => {
          this.busyId.set(null);
          this.pendingDeleteId.set(null);
          this.changed.emit();
        },
        error: (failure: unknown) => {
          this.busyId.set(null);
          this.pendingDeleteId.set(null);
          this.error.set(
            describeFailure(failure, 'We could not delete the category.'),
          );
        },
      });
  }

  /**
   * The client-side guard on a category form.
   *
   * A cohort category with no keys is accepted by the server and is then
   * INVISIBLE TO EVERYONE, silently — the same failure mode the DTO's
   * `visibility` validator exists to prevent, one field along. The length
   * checks mirror the DTO decorators (`community-limits.ts`) so an over-long
   * field is refused here rather than coming back as a masked 400. `slug` is
   * checked only on create, because it is not patchable.
   */
  private formError(
    name: string,
    description: string,
    visibility: Visibility,
    cohortKeys: readonly string[],
    slug?: string,
  ): string | null {
    if (name.length < CATEGORY_NAME_MIN_LENGTH) {
      return 'A category needs a name.';
    }
    if (name.length > CATEGORY_NAME_MAX_LENGTH) {
      return `A category name is at most ${CATEGORY_NAME_MAX_LENGTH} characters.`;
    }
    if (description.length > CATEGORY_DESCRIPTION_MAX_LENGTH) {
      return `A category description is at most ${CATEGORY_DESCRIPTION_MAX_LENGTH} characters.`;
    }
    if (slug !== undefined && !CATEGORY_SLUG_REGEX.test(slug)) {
      return `The slug must be ${CATEGORY_SLUG_MIN_LENGTH}–${CATEGORY_SLUG_MAX_LENGTH} characters of a–z, 0–9 and hyphens.`;
    }
    if (visibility === 'cohort' && cohortKeys.length === 0) {
      return 'A cohort category needs at least one cohort key, or no member can see it.';
    }
    return null;
  }

  private resetDraft(): void {
    this.draftName.set('');
    this.draftSlug.set('');
    this.slugEdited.set(false);
    this.draftDescription.set('');
    this.draftVisibility.set('member');
    this.draftCohortKeys.set('');
  }
}

/**
 * Suggests a slug from a category name. A SUGGESTION ONLY — the field stays
 * editable and stops being rewritten the moment the admin touches it, because
 * a category slug is its permanent public URL and there is no redirect table.
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, CATEGORY_SLUG_MAX_LENGTH);
}

/** Splits a comma- or space-separated cohort-key field into keys. */
function splitKeys(raw: string): string[] {
  return raw
    .split(/[\s,]+/)
    .map((key) => key.trim())
    .filter((key) => key !== '');
}
