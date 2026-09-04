# TASK_2026_377 — Fix report F2 (community moderation)

**Scope** `libs/web/admin/src/lib/builders/community/**` and
`libs/web/admin/src/lib/services/admin-builders-api.service.ts` only. No backend
file, no `builders/courses/**`, no `admin-learning-api.service.ts`, no
`admin.routes.ts`, no `admin-nav.config.ts`. Nothing staged, nothing committed.

---

## 1. Files

### Added

| File                                                                      | Lines |
| ------------------------------------------------------------------------- | ----- |
| `builders/community/components/category-manager/category-manager.ts`      | 430   |
| `builders/community/components/category-manager/category-manager.html`    | 407   |
| `builders/community/components/category-manager/category-manager.spec.ts` | 321   |
| `builders/community/components/new-thread-modal/new-thread-modal.ts`      | 176   |
| `builders/community/components/new-thread-modal/new-thread-modal.html`    | 128   |
| `builders/community/components/new-thread-modal/new-thread-modal.spec.ts` | 171   |
| `builders/community/failure-text.ts`                                      | 54    |
| `builders/community/community-limits.ts`                                  | 48    |

### Changed

| File                                              | Before | After |
| ------------------------------------------------- | ------ | ----- |
| `builders/community/community-moderation.ts`      | 864    | 506   |
| `builders/community/community-moderation.html`    | 887    | 425   |
| `builders/community/community-moderation.spec.ts` | 772    | 792   |
| `services/admin-builders-api.service.ts`          | 940    | 947   |

The route component lost 358 lines of TypeScript and 462 lines of template. The
spec grew because five new cases were added while four moved out.

---

## 2. How each finding was closed

### Style HIGH — three concerns in one route component

`CommunityModeration` is now the route orchestrator. It owns two reads (the
category list and the moderation queue), the queue filters, the selection, the
single-row moderation writes, the drawer, and the thread `POST`. It passes data
down and reloads on an event.

- `CategoryManager` (`ptah-admin-category-manager`) owns the list, create, edit,
  reorder and delete of categories. Inputs `categories`, `loadError` and `busy`.
  One output `changed`, emitted after every successful write and on the retry —
  the route component's `loadCategories()` is the single handler. The component
  owns its writes and owns no data, which is what keeps the category filter,
  every row's move control and the new-thread select reading one list.
- `NewThreadModal` (`ptah-admin-new-thread-modal`) owns the category select, the
  title, the plain markdown textarea and the pinned/locked flags. It makes NO
  request: `submitted` carries the exact `AdminCreateTopicRequest` body and
  `cancelled` carries the discard. The route component owns the `POST`, the
  saving flag and the server's sentence.

Both are standalone, `OnPush`, signal and `input()`/`output()` based, following
`builders/packs/components/pack-form-modal`. Two small helpers were extracted so
the route component and the category section share one rule rather than two
copies: `failure-text.ts` (`describeFailure`, `refusalSentence`) and
`community-limits.ts` (the mirrored DTO limits).

There is no `[innerHTML]` anywhere in the three components, and no raw
`HttpErrorResponse.message` can reach a screen — `describeFailure` reads the
response BODY and only for the two refusal statuses.

Spec split: the four category-only cases (reorder, edit, 409 delete, 500 delete)
moved into `category-manager.spec.ts`; the textarea case moved into
`new-thread-modal.spec.ts`. The orchestration cases stayed in
`community-moderation.spec.ts` — create-then-refresh, author-then-reload, the
empty-forum cause, the failed read, the bulk run. The `'Courses'` entry in the
Builders Content label assertion is untouched and still exact.

### Logic F1 — a failed category read was swallowed

`CommunityModeration` now carries `categoriesError` and `categoriesLoading`. A
failed read records the sentence instead of setting an empty list and nothing
else. Three states are now distinct:

- read failed → `CategoryManager` renders a "We could not load the categories."
  banner with a **Retry the categories** action, the section header reads
  `Categories (unavailable)`, and the queue empty state says the category list
  did not load;
- read succeeded with zero rows → the old "The forum has no categories yet"
  copy, and **New thread** is disabled;
- read succeeded with rows → the ordinary filter copy.

**New thread** is gated on `forumHasNoCategories()` (succeeded AND empty), so it
stays reachable when the read failed.

Spec: `a FAILED category read is NOT an empty forum — it says so and retries`.

### Logic F2 — only a 409 surfaced the server sentence

`refusalSentence()` now accepts 400 and 409. Both are refusals the API composes
from caller-supplied values; every other status stays masked. A `message` that
is an array (the `ValidationPipe` shape) is not surfaced, so a decorator list
never reaches an operator.

Client guards mirror the server DTOs (`community-limits.ts`):

- title 3..200 and body 1..50000 (`CreateAdminTopicDto`) in `NewThreadModal`;
- name 1..120, description ≤2000 and slug 2..64 (`CreateCategoryDto` /
  `UpdateCategoryDto`) in `CategoryManager`.

Specs: `surfaces the SERVER SENTENCE on a 400 refusal of a thread`,
`still MASKS a 500 on the same write, because nobody wrote that body`,
`an OVER-LONG title never reaches the server` (route component);
`surfaces the SERVER SENTENCE on a 400 create refusal too`,
`refuses an OVER-LONG name before the request`, plus the moved 409/500 delete
pair (category section).

### Logic F3 — `topicCount` documented backwards

Corrected in all three places the claim appeared:

- `admin-builders-api.service.ts:301` (the Zod field docblock);
- `admin-builders-api.service.ts:750` (`deleteCommunityCategory`);
- the category row comment, now in `category-manager.html`.

All three now say what `CategoriesService.listForAdmin` does: it counts with
`NOT_DELETED`, so the number is LIVE topics only and cannot promise the delete
will succeed. The delete confirmation gained one line: "The delete can still be
refused because of deleted topics the “Topics” count does not show."

Spec: `warns that the Topics count cannot promise the delete will succeed`.

### Logic F8 — `bulkSetLocked` cleared the selection and named nothing

The selection now survives the run and is set to exactly the failed ids when
every request has answered, so the succeeded rows clear and the failed ones stay
picked. The message names the count: `1 thread could not be updated and is still
selected. Try again on the selection.` The re-read runs before the message is
set, because `load()` clears `error` as it starts.

Spec: `keeps the FAILED subset of a bulk run selected, and names the count`.

### Style MEDIUM — `reorderedResponseSchema` had no `satisfies`

`ReorderedResponse` is now an `interface` declared before the schema, and the
schema is bound with `satisfies z.ZodType<ReorderedResponse>` like every other
response schema in that section.

---

## 3. Verification

```text
npx nx run-many -t typecheck test eslint:lint -p web-admin --skip-nx-cache

  NX   Running target typecheck for project web-admin        (1 project)
  Test Suites: 16 passed, 16 total
  Tests:       225 passed, 225 total
  ✖ 8 problems (0 errors, 8 warnings)
  Successfully ran targets typecheck, test, eslint:lint for project web-admin
```

The header shows one project. All three targets are green.

The 8 lint warnings are pre-existing and outside this batch — they belong to
`admin-detail/admin-detail.html`, `components/delete-user-modal/delete-user-modal.ts`
and `components/issue-comp-license-modal/issue-comp-license-modal.ts`. No new
warning was introduced.

### Test counts

| Spec                           | Tests                           |
| ------------------------------ | ------------------------------- |
| `community-moderation.spec.ts` | 29 (was 29: 5 moved out, 5 new) |
| `category-manager.spec.ts`     | 10 (4 moved in, 6 new)          |
| `new-thread-modal.spec.ts`     | 7 (1 moved in, 6 new)           |
| **Community total**            | **46**                          |

The 225-test project total also covers `builders/courses/**`, which batch F3
owns and this batch did not touch.

---

## 4. Notes

- The category section is forced open in the two states it exists to fix (no
  category, failed read) and its toggle is disabled while forced, so the
  operator cannot collapse the remedy. It keeps its own choice otherwise.
- `NewThreadModal` resets its draft on `open` only, using `untracked()` for the
  category read, so a category created behind the drawer cannot wipe a draft.
- No file this batch touched exceeds the 700-line soft ceiling.
