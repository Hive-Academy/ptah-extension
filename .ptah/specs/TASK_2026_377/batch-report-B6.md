# TASK_2026_377 — Batch B6 report

**Lane** A (ptah-extension admin portal) · **Scope** the Courses screen switches
to B5's outline read · **Backend touched** none · **Status** complete.

---

## 1. Result

B3's two workarounds are gone. `CourseDetail` reads
`GET /v1/admin/courses/:id/modules` for the modules AND their lessons.
`ModuleLessons` renders the lessons the server returned instead of the ones the
browser session happened to write, and its standing notice is deleted. The
schedule preview now runs only inside the schedule panel, where the admin
supplied the start date, time and zone it answers about.

Every module and lesson write is followed by a re-read of the course and the
outline. Nothing on the screen is patched from a write response any more.

The gate is green:

```
NX  Running targets typecheck, test, eslint:lint for project web-admin
✖ 8 problems (0 errors, 8 warnings)     ← all 8 pre-existing, none in B6 files
Test Suites: 13 passed, 13 total
Tests:       199 passed, 199 total
NX  Successfully ran targets typecheck, test, eslint:lint for project web-admin
```

The header names one project (`web-admin`, from `libs/web/admin/project.json`).

---

## 2. Files changed

| File                                                                   | Change                                                                                                    |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `services/admin-learning-api.service.ts`                               | New `getCourseOutline`. New outline schemas. Lead docblock and `previewModuleSchedule` docblock corrected |
| `builders/courses/course-detail.ts`                                    | `loadModules` reads the outline. `reload()` after every write. Bulk refresh over the whole course         |
| `builders/courses/course-detail.html`                                  | `[lessons]` passed down, `(lessonsChanged)` up. Refresh panel relabelled with the 100-lesson note         |
| `builders/courses/components/module-lessons/module-lessons.ts`         | `lessons` is an input, `lessonsChanged` an output. Local lesson state removed                             |
| `builders/courses/components/module-lessons/module-lessons.html`       | Notice deleted, real empty state added, list reads `order()`                                              |
| `builders/courses/components/module-form-modal/module-form-modal.ts`   | Third description state removed                                                                           |
| `builders/courses/components/module-form-modal/module-form-modal.html` | "cannot be read back from the API" hint deleted                                                           |
| `builders/courses/course-detail.spec.ts`                               | Rewritten — 13 tests (was 9)                                                                              |

No file outside `builders/courses/**` and `services/admin-learning-api.service.ts`
was touched. Nothing was staged or committed.

---

## 3. Behaviour changes

### 3.1 The module read

`loadModules()` calls `api.getCourseOutline(courseId)`. The
`moduleCount === 0` skip is gone: the outline route answers `{ modules: [] }`
for a course with no modules rather than the `400` the schedule preview answers,
so there is no count to check first.

`ModuleRow` is deleted. The list holds `AdminCourseModuleWithLessons` straight
from the contract, so `description`, `lessonCount` and `lessons` are all real
server values.

### 3.2 The lesson read

`ModuleLessons` no longer owns lesson state. `lessons` is an
`input.required<readonly AdminLesson[]>()` fed from `m.lessons`, and every write
emits `lessonsChanged`. The `knownLessonsChanged` output, the `remember()` and
`publish()` bookkeeping and the `knownLessonIds` map on the parent are all gone.

`order` is a `linkedSignal` over that input. It exists for one reason: a reorder
must show on screen before the round-trip finishes, and it must reset from the
input when the parent re-reads. On a refusal it is restored to the previous
order, which stays accurate because the server writes nothing when the sibling
set does not match.

### 3.3 Re-read after every write

`reload()` refetches the course AND the outline — both, because the header
counts come from `AdminCourse` and the list under them comes from the outline,
so reading one without the other would leave the screen contradicting itself.
It runs after a module create, edit, reorder, delete, a schedule apply, a bulk
metadata refresh, and every lesson write forwarded by a panel.

`bumpModuleCount()` is deleted with it, as is the local `releaseAt` patch that
followed a schedule apply. The reorder keeps its optimistic set for
responsiveness and then re-reads, because `PATCH .../reorder` renumbers
`sortOrder` inside its own transaction and does not store the indexes it was
sent.

### 3.4 The bulk refresh

"Refresh listed lessons" is now **"Refresh all lesson metadata"** and its ids
come from every lesson in the outline. The `@ArrayMaxSize(100)` slice stays,
lifted to a named `REFRESH_BATCH_LIMIT`. A course with more than 100 lessons
shows a warning line above the button naming both numbers and pointing at the
per-lesson Refresh buttons for the rest — a partial run reported as a whole one
would leave an admin believing stale videos were fixed.

### 3.5 The schedule preview

`previewModuleSchedule` is called from `previewSchedule()` only. Its docblock in
the service now says it is not a module read. Nothing else about the schedule
panel changed: the apply still echoes `confirmModuleCount` and
`confirmLastReleaseDate` from the preview response it is showing.

### 3.6 `ModuleFormModal` — simplified, as invited

The task allowed leaving the third description state alone. It was removed
instead, because the simplification is four lines and provably safe:
`ModuleFormTarget.description` is now `string | null` rather than optional,
`descriptionBaseline` is a plain `string`, the `descriptionUnknown` computed and
its template hint are deleted, and `descriptionPatch()` loses its unknown-field
branch. The remaining rule is unchanged and still load-bearing: an untouched box
sends no `description` key, an emptied box sends `null`. The only producer of a
`ModuleFormTarget` is `CourseDetail.openEditModule`, which now reads the field
from the outline, so `undefined` is unreachable and the compiler enforces it.

---

## 4. Service addition

```ts
public getCourseOutline(courseId: string): Observable<AdminCourseOutline>
```

`GET /admin/courses/:id/modules`, parsed with

```ts
const adminCourseModuleWithLessonsSchema = adminCourseModuleSchema.extend({
  lessons: z.array(adminLessonSchema),
}) satisfies z.ZodType<AdminCourseModuleWithLessons>;

const adminCourseOutlineSchema = z.object({
  modules: z.array(adminCourseModuleWithLessonsSchema),
}) satisfies z.ZodType<AdminCourseOutline>;
```

Built by extending the existing `adminCourseModuleSchema` and reusing
`adminLessonSchema`, not by restating either. The server composes the response
from the same `toAdminCourseModule` and `toAdminLesson` mappers its write
handlers use, so a restatement here would let the two drift silently.

`AdminCourseOutline` and `AdminCourseModuleWithLessons` are imported from
`@ptah-contracts/community` and re-exported alongside the service's other type
re-exports. Every existing method is unchanged.

---

## 5. Test summary

`course-detail.spec.ts` — **13 tests, all passing**. Four are new, three replace
the removed workaround tests, six are carried over unchanged.

**The outline is the read**

1. The modules are read from `getCourseOutline('course-1')`, and both module
   titles render.
2. `previewModuleSchedule` is **not** called on load. (Replaces B3's "reads the
   module list through the schedule preview".)
3. Lessons from the server render — both `Set up the repo` and `Ship it` — and
   the string `The API has no lesson read endpoint` is absent. (Replaces B3's
   "states on the face of each module that lessons cannot be listed".)
4. The outline is requested even for a course with `moduleCount: 0`, and the
   empty state shows. (Replaces B3's "does NOT call the preview for a course
   with no live modules".)

**Writes re-read**

5. A module reorder calls `reorderModules` and then reads the outline a second
   time.
6. A bulk refresh sends `['lesson-1', 'lesson-2']` and then reads the outline a
   second time.
7. The reorder sends the whole list with an explicit `courseId`.

**Bulk refresh**

8. A 101-lesson course shows `One request carries at most 100 lessons` and the
   request carries exactly 100 ids.

**Schedule (carried over)**

9. The confirm values are echoed from the preview response.
10. No apply control exists before a preview.
11. The overwrite warning is present.

**Errors**

12. A failed `getCourse` shows `Could not load this course.` and never
    `Http failure response`.
13. A failed `getCourseOutline` shows `Could not load the modules.` and never
    `Http failure response`.

Suite-scoped run:

```
npx nx test web-admin course-detail --skip-nx-cache
Test Suites: 1 passed, 1 total
Tests:       13 passed, 13 total
```

No `module-lessons` spec existed before this batch and none was added: the panel
is driven entirely by its inputs and outputs, and tests 3, 5 and 6 exercise it
through `CourseDetail`, which is where its wiring can actually break.

---

## 6. B2 failures observed

**None.** The gate ran the whole `web-admin` project, including B2's
`builders/community/**` and `admin-builders-api.service.ts`, and reported
`0 errors` with 13 suites and 199 tests green. The eight lint warnings are the
same eight B3 recorded, and all sit in files neither batch owns:

- `admin-detail/admin-detail.html` — 3 × `@angular-eslint/template/no-any`
- `components/delete-user-modal/delete-user-modal.ts` — 3 ×
  `explicit-member-accessibility`, 1 × `no-explicit-any`
- `components/issue-comp-license-modal/issue-comp-license-modal.ts` — 1 ×
  `no-explicit-any`

No B6 file produces a warning.

---

## 7. Constraints honored

- `builders/community/**`, `admin-builders-api.service.ts`, `admin.routes.ts`,
  `admin-nav.config.ts`, `libs/api/**`, `libs/api-contracts/**` — all untouched.
- No `[innerHTML]` anywhere in the batch.
- No raw `HttpErrorResponse` message reaches the user; the two error tests pin
  it on both read paths.
- Nothing staged, nothing committed.

---

## 8. Gaps

`?includeDeleted` was deliberately not added by B5, so a soft-deleted module or
lesson stays undiscoverable from this screen. B3 §6.2 (no restore affordance for
a soft-deleted course) is likewise unchanged — both need a server change.

WROTE: batch-report-B6.md
