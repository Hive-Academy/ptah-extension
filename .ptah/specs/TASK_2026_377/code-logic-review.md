# TASK_2026_377 — Logic review

**Reviewer** code-logic-reviewer · **Date** 2026-09-04 · **Scope** the uncommitted
working-tree changes of B1, B2, B3, B5 and B6 only.

**Score** 8 / 10
**Verdict** APPROVE WITH NITS

---

## 1. What I ran

```text
npx nx run-many -t test -p web-admin api-forum api-learning --skip-nx-cache
  api-forum    21 suites, 543 tests passed
  web-admin    13 suites, 199 tests passed
  api-learning           passed (3/3 projects, exit 0)

npx nx test ptah-license-server --skip-nx-cache
  7 suites, 172 tests passed  (route census green at 142 routes)
```

The reported gates are real. No batch report overstates its result.

---

## 2. What I checked and found correct

- **PRE-1.** `POST v1/admin/community/topics` binds its body with
  `@Body(dtoPipe(CreateAdminTopicDto))`
  (`libs/api/forum/src/lib/topics/admin-community-topics.controller.ts:115`). The
  controller's own PRE-1 census now expects three payload params and passes.
  `GET v1/admin/courses/:id/modules` carries no payload param.
- **PRE-6 atomicity.** `TopicsService.createAsAdmin` calls `audit?.(tx, topic.id)`
  inside the same `$transaction` that writes the topic and post #1
  (`libs/api/forum/src/lib/topics/topics.service.ts:507-580`).
  `AuditLogService.write` throws on a failed insert
  (`libs/api/audit/src/lib/audit-log.service.ts:73`), so the mutation rolls back
  with it. The controller spec pins the `tx` identity.
- **AD-5.** `createAsAdmin` reads `category.findUnique`, and `Category` carries no
  `deletedAt` column, so it is not a tombstone read — `SOFT_DELETABLE_MODELS` in
  `libs/api/forum/src/lib/common/soft-delete-filter.spec.ts:80` is
  `['topic','post']`. The topic slug scan spreads `NOT_DELETED`.
  `getOutlineForAdmin` filters course, module, lesson and comment with
  `NOT_DELETED` and uses `findFirst`, not `findUnique`, on the soft-deletable
  course. Both libs keep `EXPECTED_EXEMPTIONS` unchanged.
- **Member visibility is not touched.** `createAsAdmin` takes no `MemberContext`,
  never calls `categories.requireVisible`, and adds no `isAdmin` branch.
  `member-community.controller.ts` and `libs/api/membership` are unmodified. The
  member create path performs no side effect the admin path skips — forum
  notifications fire on replies and accepted answers only, never on topic create.
- **RI-3 and route ordering.** `@Post()` sits between `@Get()` and `@Patch(':id')`
  on a different verb. `@Get(':id/modules')` is two segments and cannot be
  swallowed by `@Get(':id')`. Both admin route additions are in `EXPECTED_ROUTES`,
  and the census spec is green. `builders/courses` and `builders/courses/:id` are
  declared above both `:model` and `:model/:id` in
  `libs/web/admin/src/lib/admin.routes.ts:194-221`.
- **Throttle on writes.** The new `POST` carries `@UseGuards(AdminThrottlerGuard)`
  and `@Throttle(ADMIN_WRITES)`. The controller spec asserts the throttled set is
  `['create','moderate','remove','restore']`. The new `GET` is read-only and uses
  the global throttle, matching its sibling `@Get(':id')`.
- **Zod on every response.** `admin-learning-api.service.ts` makes 21 HTTP calls
  and applies `validate(...)` to all of them. Every new method in
  `admin-builders-api.service.ts` does the same. Every schema is bound with
  `satisfies z.ZodType<T>` against the contract type, and the response shapes match
  the server (`{deleted}`, `{restored}`, `{reordered}`, and the full
  `toAdminCourseModule` / `toAdminLesson` projections).
- **Optimistic reorder rollback.** All three reorder paths
  (`courses-list.ts:209`, `course-detail.ts:284`, `module-lessons.ts:142`) capture
  `previous` before the write and restore it on refusal. The servers renumber
  inside one transaction and refuse a partial sibling set with no writes, so the
  rollback is accurate. `ModuleLessons.order` is a `linkedSignal` over the
  `lessons` input, so the parent's re-read resets it.
- **Re-read after write.** `CourseDetail.reload()` refetches the course and the
  outline together after every module write, schedule apply, bulk refresh and
  forwarded lesson write. The schedule apply echoes `confirmModuleCount` and
  `confirmLastReleaseDate` from the preview response, never from local arithmetic.
- **Raw `HttpErrorResponse` messages.** No screen renders one. `describe()` relies
  on `HttpErrorResponse implements Error` without extending it, and the four
  `extractErrorMessage` copies read `err.error.message` (the server's body), never
  `err.message`. Two specs pin it.
- **Requirements in `batches.md`.** Every item of B1, B2, B3, B5 and B6 is
  implemented. I found no requirement quietly dropped. The two stated gaps (no
  `?includeDeleted` for courses, no restore affordance) were declared, not hidden.

---

## 3. Findings, most severe first

### F1 — MEDIUM — `libs/web/admin/src/lib/builders/community/community-moderation.ts:407`

**What breaks.** A failed category read is swallowed. The error handler sets
`categories.set([])` and raises no error signal, so a transport failure and a
genuinely empty forum are indistinguishable to every consumer of `categories()`.

**Concrete failing state.** `GET /api/v1/admin/community/categories` answers 500
(or its Zod parse fails) while `GET .../topics` succeeds and returns zero rows.
The screen then:

- asserts `The forum has no categories yet, so it cannot hold a thread.`
  (`community-moderation.html:514`) — a false statement about the data;
- disables **New thread** with the tooltip
  `Create a category before authoring a thread.` (`community-moderation.html:16`);
- empties the category filter and every row's move `<select>`, so a topic cannot
  be moved;
- invites a create whose slug then collides with a category that already exists,
  producing a 409 the admin cannot explain.

No test covers this path. The eight new B2 tests cover the empty-forum cause and
never a failed read.

**Suggested fix.** Add a `categoriesError` signal. Render a distinct "could not
load the categories — retry" state, keep **New thread** reachable, and show the
"no categories yet" copy only when the read succeeded with zero rows.

---

### F2 — MEDIUM — `libs/web/admin/src/lib/builders/community/community-moderation.ts:818-844`

**What breaks.** `describe()` surfaces the server's sentence for a 409 and for no
other status. Several 400 refusals on this exact screen carry the only actionable
text in the response, and all of them are replaced by a generic sentence.

**Concrete failing inputs.**

1. Create a cohort category with the key `alumni` when no `MemberGroup` has that
   key. `CategoriesService` answers 400
   `Unknown cohort key(s): alumni — create the member group first`
   (`libs/api/forum/src/lib/categories/categories.service.ts:476`). The admin sees
   `We could not create the category.`
2. Reorder while another admin adds a category. The server answers 400
   `ids must list every category exactly once (expected 4, received 3)`
   (`categories.service.ts:427`). The admin sees
   `We could not reorder the categories.` and has no reason to reload.
3. Author a thread with a 250-character title. `CreateAdminTopicDto` has
   `@MaxLength(200)` and the form checks only `length >= 3`
   (`community-moderation.ts:737`), so the validation pipe answers 400 and the
   admin sees `We could not create the thread.` with no indication of the field.

The courses screens do the opposite — `extractErrorMessage` surfaces
`err.error.message` for every status — so the two halves of this task disagree on
the rule.

**Suggested fix.** Extend `conflictSentence` to accept 400 as well as 409 (both are
refusals the API composes from caller-supplied values, never from a Prisma
message), or add a `badRequestSentence` sibling. Separately, mirror the
`@MaxLength(200)` and `@MaxLength(50_000)` limits in the client guard so the common
case never reaches the server.

---

### F3 — LOW/MEDIUM — `libs/web/admin/src/lib/services/admin-builders-api.service.ts:741` and `libs/web/admin/src/lib/builders/community/community-moderation.html:206`

**What breaks.** Both comments state a load-bearing invariant backwards:

> `AdminCategory.topicCount` INCLUDES TOMBSTONES, deliberately — it is the number
> the constraint will actually enforce on.

`CategoriesService.listForAdmin` computes `topicCount` with `...NOT_DELETED`
(`libs/api/forum/src/lib/categories/categories.service.ts:226-232`), and its own
docblock says the opposite: "`topicCount` COUNTS LIVE TOPICS ONLY. It is therefore
NOT the number that decides whether a delete succeeds"
(`categories.service.ts:207`).

**Concrete failing state.** A category holding one soft-deleted topic and no live
one renders `Topics: 0`. The delete prompt says only
`Delete "<name>" permanently?` with no caveat. The delete then fails with the 409
the row's own count said could not happen. Behaviour degrades gracefully — the 409
sentence is surfaced — but the documented invariant is inverted, and the next
maintainer will reason from it.

**Suggested fix.** Correct both comments to match the server, and add one line to
the delete prompt: a category can still refuse deletion because of topics this
count does not show.

---

### F4 — LOW — `libs/web/admin/src/lib/builders/courses/components/module-form-modal/module-form-modal.ts:155` and `:184-203`

**What breaks.** In edit mode `releaseAt` is always sent, and the round trip
through the `datetime-local` control is minute-precision. The class docblock
promises three states ("omitting the key leaves whatever is there alone"), but the
edit path never omits the key.

**Concrete failing input.** A module stored with
`releaseAt = 2026-09-10T09:00:45.000Z`. The admin fixes a typo in the title and
saves. `toLocalInput` slices to `…T09:00`, `toIso` returns `09:00:00.000Z`, and the
`PATCH` moves the release instant back 45 seconds. The audit row records a
release-date change the admin never made.

**Suggested fix.** Keep the original ISO string as a baseline. Send `releaseAt`
only when `toLocalInput(baseline) !== releaseAtLocal()`.

---

### F5 — LOW — `libs/web/admin/src/lib/builders/courses/course-detail.ts:162-167`

**What breaks.** The constructor effect refetches on every `courseId` change with
no in-flight cancellation, no request-sequence guard and no `takeUntilDestroyed`.
The last response to arrive wins.

**Concrete failing state.** The component is reused across `builders/courses/:id`,
so browser back and forward between `/admin/builders/courses/a` and `/…/b` start
two `getCourse` requests. If `a` is slow, its response lands second and the screen
shows course `a` while the URL and the outline read say `b`. Every subsequent write
then targets `a`, because `reload()` and `applyOrder` read `this.course()?.id`.

**Suggested fix.** Drive the fetch from
`toObservable(courseId).pipe(switchMap(...))`, or discard a response whose
`course.id !== this.courseId()`.

---

### F6 — LOW — `libs/api/forum/src/lib/topics/topics.service.ts:610`, reached from `createAsAdmin`

**What breaks.** `mapPrismaError` turns a `P2003` foreign-key violation into
`404 'Topic not found'`. On the create path there is no topic to not find, and the
constraint that failed is the category (or author) foreign key.

**Concrete failing input.** Two admins. The first opens the New-thread form. The
second deletes the category. The first submits: `category.findUnique` still
resolves in the read, the insert then violates
`Topic.categoryId → Category (onDelete: Restrict)`, and the author is told
`Topic not found` for a topic that was never created.

**Suggested fix.** On the create path map `P2003` to `404 'Category not found'`
(or a 409 naming the race). The existing mapping is correct for the update and
delete paths and should stay there.

---

### F7 — LOW — `libs/api/learning/src/lib/courses/courses.service.ts:243-250`

**What breaks.** `getOutlineForAdmin` materializes every live `LessonComment` row
of the course into memory only to count them per lesson. The B5 report calls this
"four fixed queries, no N+1", which is true of the query count and not of the row
count.

**Concrete failing state.** A course with 20,000 live comments transfers 20,000
rows per outline read. B6 re-reads the outline after **every** module and lesson
write, so an authoring session multiplies it.

**Suggested fix.**
`lessonComment.groupBy({ by: ['lessonId'], where: { lessonId: { in: … }, ...NOT_DELETED }, _count: true })`
— one query, one row per lesson, same filter.

---

### F8 — NIT — `libs/web/admin/src/lib/builders/community/community-moderation.ts:277-303`

`bulkSetLocked` clears the selection before the requests resolve and reports a
partial failure as `One or more updates failed.` with no topic named. The admin
cannot retry the failed subset without re-selecting by hand. Keep the failed ids
selected, or name them in the message.

---

## 4. Summary

The backend work (B1, B5) is careful and matches the lib's existing invariants: one
transaction, an in-transaction audit row, the soft-delete filter discipline intact
and the route census updated. The courses screens (B3, B6) close their own declared
gap honestly and re-read after every write. The two medium findings both sit in the
community screen's error handling: a swallowed read failure that makes the screen
assert a false cause (F1), and a masking rule that discards the only actionable
sentence in several 400 refusals (F2). Neither loses data. Fixing F1 and F2 would
take this to a clean approval.
