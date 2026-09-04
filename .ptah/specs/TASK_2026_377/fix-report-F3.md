# TASK_2026_377 — review-fix batch F3

**Scope** the four findings assigned to F3: logic F5, logic F4, style MEDIUM
(`admin-learning-api.service.ts:316`) and style LOW (the `AdminCoursesController`
citation). **Date** 2026-09-04.

---

## 1. Files changed

| File                                                                                             | Change                                                                                                     |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `libs/web/admin/src/lib/builders/courses/course-detail.ts`                                       | Stale-response guard on the course read and the outline read. Route change now clears the previous course. |
| `libs/web/admin/src/lib/builders/courses/course-detail.spec.ts`                                  | Route `paramMap` is now a controllable `BehaviorSubject`. Three new tests for overlapping navigations.     |
| `libs/web/admin/src/lib/builders/courses/components/module-form-modal/module-form-modal.ts`      | `releaseAt` baseline. The edit path omits the key when the control is unchanged.                           |
| `libs/web/admin/src/lib/builders/courses/components/module-form-modal/module-form-modal.spec.ts` | **New file.** Six tests over the three-state `releaseAt` patch.                                            |
| `libs/web/admin/src/lib/services/admin-learning-api.service.ts`                                  | Five response schemas bound with `satisfies z.ZodType<T>`. Three new local response types.                 |
| `libs/web/admin/src/lib/builders/courses/courses-list.ts`                                        | Removed the false controller citation.                                                                     |
| `libs/web/admin/src/lib/admin.routes.ts`                                                         | Removed the false controller citation.                                                                     |
| `libs/web/admin/src/lib/admin-layout/admin-nav.config.ts`                                        | Removed the false controller citation.                                                                     |

No file outside the four permitted paths was touched. No backend file, no
`builders/community/**` file and no `admin-builders-api.service.ts` change.

---

## 2. How each finding was closed

### Logic F5 — the last response wins on `course-detail.ts`

I used the second remedy the review offered: discard the late response.

- `staleFor(id)` returns `true` when `courseId()` is non-null and is not `id`.
  A `null` route id means the screen is leaving, so nothing is stale against it
  and the in-flight read is allowed to settle.
- `fetchCourse` drops a `next` whose `course.id` is stale and drops a stale
  `error`. A dropped response writes no signal, does not flip `loading`, and
  does not start the outline read behind it. The request that superseded it owns
  those flags.
- `loadModules` carries the same guard, keyed to the `courseId` the request was
  started for. The outline envelope holds no course id of its own, so the
  request argument is the only identity available on arrival.
- The route effect now calls `clearCourse()` before the new read starts. This
  closes the second half of the finding: every write reads its target from
  `course()?.id`, so leaving the previous course's rows on screen during the
  load would let a click write to the course the admin navigated away from.

I chose the discard guard over `toObservable(courseId).pipe(switchMap(...))`
because `fetchCourse` is also the retry entry point from the template and the
re-read path after every write. A `switchMap` over the route id alone would not
cover those two callers, and adding a second trigger subject to feed them would
be more machinery for the same result.

**Tests added** (`course-detail.spec.ts`, `describe('overlapping navigations')`):

1. `discards a late course response for the id the screen has left` — starts
   navigation 1 with a pending `Subject`, navigates to course 2, then lets
   course 1 answer. Asserts the screen shows course 2, never course 1, and that
   `getCourseOutline` was never called with `course-1`.
2. `discards a late outline response for the id the screen has left` — the same
   race one level down.
3. `discards a late failure for the id the screen has left` — a stale error must
   not paint an error banner over a course that loaded.

The route provider changed from `of(convertToParamMap(...))` to a
`BehaviorSubject<ParamMap>`, so a navigation is a second emission on one stream
rather than a second component. The 13 pre-existing tests in the suite are
unchanged and still pass.

### Logic F4 — a title-only edit shifted the release instant

- `releaseAtBaseline: string | null` keeps the module's stored ISO string as the
  server sent it.
- `releaseAtPatch()` compares in **control space**: it pushes the baseline
  through `toLocalInput`, the same function that filled the box, and returns
  `{}` when the two strings agree. Comparing the ISO strings directly would call
  every reopened form "changed", because `datetime-local` is minute precision.
- The edit branch spreads `...this.releaseAtPatch()` in place of the
  unconditional `releaseAt`. The create branch is unchanged.
- The class docblock's three-state promise is now true, and it names the new
  method.

**Tests added** (`module-form-modal.spec.ts`, new file, 6 tests):

1. `sends no releaseAt key when the admin edited only the title` — the finding's
   own case, with a stored `2026-09-10T09:00:45.000Z`.
2. `sends no releaseAt key when the module never had a release date`.
3. `sends the new instant when the admin retypes the date`.
4. `sends an explicit null when the admin clears the date` — the third state
   stays reachable.
5. `prefills the control from the stored instant in the operator zone`.
6. `sends the typed date on create and omits it when the box is empty`.

### Style MEDIUM — the five unbound schemas

Each schema now carries `satisfies z.ZodType<T>`, so the file's line-42
guarantee holds without exception.

- `coursesEnvelopeSchema` → `satisfies z.ZodType<AdminCourse[]>`, against the
  contract type.
- `reorderResultSchema`, `deletedResponseSchema`, `restoredResponseSchema` and
  `refreshMetadataResultSchema` needed a type first. The contracts lib ships
  response **models** only, and the api ⇄ web wall forbids importing the
  server's own result types, so I declared `ReorderResult`, `DeletedResponse`,
  `RestoredResponse`, `RefreshFailure` and `RefreshMetadataResult` locally as
  interfaces above their schemas.

Three of those names were previously `export type X = z.infer<typeof schema>`.
Replacing an inferred alias with a hand-written interface is what makes the
`satisfies` proof load-bearing: the direction of the check is now type → schema,
not schema → type. `RefreshFailure` kept its meaning and is now the element type
of `RefreshMetadataResult['failed']` by declaration rather than by index lookup.
No consumer signature changed.

I also moved the metadata-refresh docblock down onto `RefreshMetadataResult`,
where it belongs, and gave `RefreshFailure` its own one-line comment.

### Style LOW — the false controller citation

The quote "there is no admin course UI in `libs/web/admin` — this is driven by
`curl`" does not appear in `AdminCoursesController`. I removed the attribution
from all three sites and kept the factual claim that the learning admin
endpoints shipped complete and audited before any client existed.

- `courses-list.ts` — "THE FIRST CLIENT THIS API HAS EVER HAD. Every endpoint
  behind this screen shipped complete and audited, reachable only by hand-built
  requests…"
- `admin.routes.ts` — "The learning admin endpoints were complete and audited
  before any client existed."
- `admin-nav.config.ts` — "The learning API shipped complete and audited with no
  client at all…"

`grep -rn "AdminCoursesController\|driven by \`curl\`" libs/web/admin/src/`
returns nothing. I did not touch the controller or the DTO comments the same
finding names — they are backend files and out of this batch's scope.

---

## 3. Verification

```text
npx nx run-many -t typecheck test eslint:lint -p web-admin --skip-nx-cache
```

The first full run, taken before the parallel F2 batch landed its next edit, was
green end to end:

```text
NX   Running targets typecheck, test, eslint:lint for project web-admin:
- web-admin

Test Suites: 14 passed, 14 total
Tests:       208 passed, 208 total

NX   Successfully ran targets typecheck, test, eslint:lint for project web-admin
```

The header shows one project. Test counts moved from **13 suites / 199 tests**
(the figure the logic review recorded) to **14 suites / 208 tests**: one new
suite and nine new tests, which is 6 in `module-form-modal.spec.ts` plus 3 in
`course-detail.spec.ts`.

`eslint:lint` reports 8 warnings and 0 errors. All 8 are pre-existing and none
is in a file this batch touched:

```text
libs/web/admin/src/lib/admin-detail/admin-detail.html            3 × no-any
libs/web/admin/src/lib/components/delete-user-modal/…            4 warnings
libs/web/admin/src/lib/components/issue-comp-license-modal/…     1 × no-explicit-any
```

`typecheck` (`npx ngc --noEmit --project libs/web/admin/tsconfig.lib.json`)
passes.

### Current state of the test target — an F2 file, not an F3 one

A later re-run of the test target fails, entirely inside the file the parallel
F2 batch is editing. Per this batch's instruction I report it verbatim and leave
it alone:

```text
FAIL   web-admin  libs/web/admin/src/lib/builders/community/community-moderation.spec.ts (6.886 s)
  ● CommunityModeration › CREATES a category and refreshes the list so every control sees it
    TypeError: Cannot set properties of null (setting 'value')

      549 |     const name: HTMLInputElement =
      550 |       fixture.nativeElement.querySelector('#category-name');
    > 551 |     name.value = 'Announcements';
          |               ^
      552 |     name.dispatchEvent(new Event('input'));
      553 |     fixture.detectChanges();

      at src/lib/builders/community/community-moderation.spec.ts:551:15

Test Suites: 1 failed, 13 passed, 14 total
Tests:       5 failed, 203 passed, 208 total
```

The five failures are:

```text
● CommunityModeration › CREATES a category and refreshes the list so every control sees it
● CommunityModeration › REORDERS with the COMPLETE id list, never the pair that moved
● CommunityModeration › EDITS a category without ever sending a slug
● CommunityModeration › surfaces the SERVER SENTENCE on a 409 delete, not a generic failure
● CommunityModeration › still refuses a raw transport message on a 500 delete
```

The cause is visible in the working tree: F2 has added
`builders/community/components/`, `community-limits.ts` and `failure-text.ts`,
so `#category-name` has moved out of `community-moderation.html` into an
extracted child component while the spec still queries the parent's DOM. That is
F2's HIGH style finding being closed. No F3 file appears in the trace.

The three courses suites were re-run in isolation against the same tree and are
green:

```text
libs/web/admin/src/lib/builders/courses/course-detail.spec.ts                       16 passed
libs/web/admin/src/lib/builders/courses/courses-list.spec.ts                         9 passed
.../courses/components/module-form-modal/module-form-modal.spec.ts                   6 passed
Test Suites: 3 passed, 3 total
Tests:       31 passed, 31 total
```

`typecheck` and `eslint:lint` were also re-run after the F2 edits landed and both
still pass with the same 8 pre-existing warnings.

---

## 4. Constraints observed

- No `[innerHTML]` was added. The courses screens still render no markdown.
- No raw `HttpErrorResponse` message can reach a screen. The stale-error guard
  only drops messages, it never adds a path that surfaces one, and the three new
  race tests assert the discarded error text is absent from the DOM.
- Nothing was committed and nothing was staged.
