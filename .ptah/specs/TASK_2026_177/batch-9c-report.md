# Batch 9C report — Tasks 9.15, 9.16, 9.17 (P3-BE)

**Executor**: `backend-developer` · **Branch**: `ak/license-server-validation-pipe` (not switched, not created, not rebased)
**HEAD at start**: `4d1c57707` · **HEAD at end**: `4d1c57707` — **the concurrent process did not commit during this dispatch.**
**Verdict**: all three tasks complete. **Batch 9 is closed.** The six-project gate is green: **492 tests in `api-learning`** (21 suites, up from 369), **124 in `ptah-license-server`** (up from 111), 91 in `api-member-hub`, 119 in `api-youtube`, 33 in `api-contracts-community`, 5 in `api-audit`. **Zero lint errors**; the only two warnings are pre-existing and in files I did not touch.

**Nothing was committed and nothing was staged.**

**All four exit-gate clauses are met with pasted evidence, including the NFR-P6 deliberate-failure pair.** Every member and admin route was exercised live against the running server with a real cookie token, including the `403` on a locked module, the 90%-threshold boundary at 190 vs 191 seconds, and the `400` that refuses a client-sent `completed` flag. **All probe data was removed and the committed seed is intact.**

🔴 **Seven findings.** The sharpest three: [F-1](#f-1) — Task 9.15's header says "eight route prefixes" and its own block enumerates **five**; [F-2](#f-2) — NFR-P6's importer set is **two** files, not one, and Batch 9B's local assertion had to be corrected; [F-3](#f-3) — `EXPECTED_NULLABLE_OPTIONALS` holds **three** entries, and Batch 9A predicted zero.

---

## Contents

- [PRE-1 confirmation](#pre-1)
- [The Batch 9 exit gate — clause by clause, with evidence](#exit-gate)
- [The census constants, as landed](#census)
- [The five route prefixes and the RI-1 / RI-3 checks](#prefixes)
- [🔴 The NFR-P6 deliberate-failure proof, both runs](#deliberate)
- [The live `V-CURL` transcript](#vcurl)
- [Findings](#findings)
- [Task 9.15](#t915) · [Task 9.16](#t916) · [Task 9.17](#t917)
- [ASSUMPTION-6, stated plainly](#assumption-6)
- [Deviations from the spec's file lists and signatures](#deviations)
- [Wider verification](#wider)
- [Discipline](#discipline)
- [Final `git status --porcelain`, annotated](#git)
- [What Batch 10 should know](#handoff)

---

<a name="pre-1"></a>

## PRE-1 confirmation

I read `D:\projects\ptah-extension\libs\api\core\src\lib\common\dto-validation.pipe.ts` **in full, before writing a single controller.** It was the sixth read of the dispatch and preceded every line of controller code.

Confirmed understanding: `main.ts`'s global `ValidationPipe` is **inert**, because `@nx/esbuild` does not implement `emitDecoratorMetadata`, so `metadata.metatype` is `undefined` and `ValidationPipe.transform` short-circuits on `if (!metatype || !this.toValidate(metadata)) return value;`. `dtoPipe(TheDto)` restores validation by setting `expectedType`, which `validation.pipe.js` applies **before** that short-circuit. The rule is unconditional: every whole-object `@Body()` / `@Query()` param must bind `dtoPipe(TheDto)`; a bare `@Body() dto: X` is silently unvalidated. `passthroughDtoPipe` has exactly one legitimate call site (`AdminRecordsController.update`) and **I did not add a second.**

**All 16 whole-object payload params added by this batch bind `dtoPipe`**, asserted twice: once in `controller-validation.spec.ts` (the build gate) and once per controller in `libs/api/learning`, so a dropped binding fails in the lib that owns the file with the handler named.

It is also confirmed **live**, which is stronger than either spec:

```
$ curl -s -b "ptah_auth=$T" -X PUT -d '{"positionSeconds":1,"completed":true}' \
    .../v1/members/courses/b9c-probe-member/lessons/open-lesson/progress
{"message":["property completed should not exist"],"error":"Bad Request","statusCode":400}
```

That `400` only happens because the pipe is bound. Unbound, the flag would have been silently dropped and the response would have been a `200`.

---

<a name="exit-gate"></a>

## 🔴 The Batch 9 exit gate — clause by clause

### Gate command — actual output

```
$ npx nx run-many -t eslint:lint,typecheck,test \
    -p api-youtube,api-learning,api-contracts-community,api-member-hub,api-audit,ptah-license-server \
    --skip-nx-cache

> nx run api-contracts-community:test   Test Suites:  2 passed,  2 total   Tests:  33 passed
> nx run api-audit:test                 Test Suites:  1 passed,  1 total   Tests:   5 passed
> nx run api-youtube:test               Test Suites:  4 passed,  4 total   Tests: 119 passed
> nx run api-learning:test              Test Suites: 21 passed, 21 total   Tests: 492 passed
> nx run api-member-hub:test            Test Suites:  7 passed,  7 total   Tests:  91 passed
> nx run ptah-license-server:test       Test Suites:  5 passed,  5 total   Tests: 124 passed

> nx run ptah-license-server:"eslint:lint"
  apps/ptah-license-server/jest.config.ts   1:1  warning  Unused eslint-disable directive
  apps/ptah-license-server/src/instrument.ts 1:1 warning  Unused eslint-disable directive
✖ 2 problems (0 errors, 2 warnings)

 NX   Successfully ran targets eslint:lint, typecheck, test for 6 projects
```

**0 errors.** The two warnings are **pre-existing and in files this dispatch did not touch** — Batch 6C recorded the identical pair.

`ptah-license-server`'s five suites — `route-map`, `controller-validation`, `admin-guards`, `app.module`, `community-seed` — all pass. **`app.module.spec.ts` boots the real Nest injector with `LearningModule` registered**, which is what proves `IdentityModule`, the locally-declared guards and `YoutubeModule`'s provider are wired correctly; no unit test exercises the injector.

### `nx graph` — no cycle

```
api-learning   deps       : api-audit, api-contracts-community, api-core, api-identity,
                            api-membership, api-youtube
api-learning   dependents : api-member-hub, ptah-license-server
api-youtube    deps       : (none — RISK-Q holds: it imports nothing from libs/api)
api-youtube    dependents : api-learning
api-member-hub deps       : api-community, api-contracts-community, api-core, api-forum,
                            api-identity, api-learning, api-membership
api-member-hub dependents : ptah-license-server
```

`api-learning → api-youtube` one way; `api-member-hub → api-learning` one way. Neither appears among the other's dependents. `@nx/enforce-module-boundaries` is clean (0 lint errors across all six projects).

---

### Clause 1 — 🔴 **a locked module returns `403` from the API, not a CSS state**

**Proved live**, with a pasted HTTP status:

```
$ curl -s -o /dev/null -w '%{http_code}\n' -b "ptah_auth=$T" \
    ".../v1/members/courses/b9c-probe-member/lessons/locked-lesson"
403

$ curl -s -b "ptah_auth=$T" ".../v1/members/courses/b9c-probe-member/lessons/locked-lesson"
{"reason":"not_released","unlocksAt":"2027-12-25T09:00:00.000Z","message":"This module is not open yet."}
```

**A machine `reason` and an `unlocksAt`, not a sentence** — the UI matches on the value, so a copy edit cannot change which screen a member sees.

Three things make this more than a status code:

- **the withheld body never reaches the wire.** The locked lesson's body was seeded as `# SECRET_LOCKED_BODY_MARKER_4c1a`; `grep -c` over the `403` response returns **0**. The `403` fires _before_ the body read and _before_ the comment read, so nothing is even fetched.
- **the open lesson in the SAME course is `200`**, so the refusal is the lock and not the course.
- **the write paths are refused identically.** `PUT …/locked-lesson/progress` → `403`, `PUT …/locked-lesson/completion` → `403`, and `POST /v1/members/lesson-comments` for that lesson → `403` with the same body. That is the composition described under [Task 9.15](#t915): all four go through **one** `ModuleLockService` evaluation over one course tree.

### Clause 2 — 🔴 **completion derives from persisted duration; the client never sends a flag**

**Proved live at the threshold boundary.** The probe lesson carries `videoDurationSeconds: 212`, so the server-side threshold is `ceil(212 × 0.9) = 191`:

```
PUT …/open-lesson/progress {"positionSeconds":190}
  -> {"furthestPositionSeconds":190,"completedAt":null,"completionSource":null}

PUT …/open-lesson/progress {"positionSeconds":191}
  -> {"furthestPositionSeconds":191,"completedAt":"2026-08-05T09:08:11.872Z","completionSource":"auto"}
```

One second apart, and the verdict flips. Nothing in the request said anything about completion.

**A client-sent flag is REJECTED, not ignored** — the clause as the gate words it:

```
PUT …/open-lesson/progress {"positionSeconds":1,"completed":true}   -> HTTP 400
{"message":["property completed should not exist"],"error":"Bad Request","statusCode":400}
```

It is refused by **two independent mechanisms**, which is why it is not merely ignored:

1. `UpdateProgressDto` has **exactly one property** and `dtoPipe` runs with `forbidNonWhitelisted: true`. Asserted in `member-courses.controller.spec.ts` for `completed`, `completionSource` and `completedAt` individually — a `200` that dropped the field would leave a client author believing it works.
2. `ProgressService.updateProgress(ctx, lessonId, positionSeconds)` takes a **plain number**, so even a controller bug has no object in which to smuggle a verdict. Asserted as `expect(calls[0]).toHaveLength(3)`.

`SetCompletionDto` on the _other_ route is the member's explicit R2.3.3 control, recorded as `completionSource: 'manual'`. The two are separate endpoints so the stored row can tell "watched it" from "ticked it"; the spec asserts that sending `positionSeconds` to the completion route is also a `400`.

### Clause 3 — **with `YOUTUBE_API_KEY` unset nothing `500`s and an admin can save manual metadata**

⚠️ **This is the DEFAULT state of this workspace (ASSUMPTION-6), so the clause is nearly free — and I am saying so rather than presenting it as a hard-won pass.** `.env:259` reads `YOUTUBE_API_KEY=` with no value, so `isEnabled()` is `false` here and the feature-off branch is the **only** branch any of the live checks below could have taken.

What that branch did, live:

```
POST /v1/admin/lessons
  {"moduleId":"…","title":"Open Lesson","bodyMarkdown":"# Open lesson body",
   "youtubeVideoIdOrUrl":"https://www.youtube.com/watch?v=dQw4w9WgXcQ",
   "videoTitle":"Typed by the admin","videoDurationSeconds":212}

-> 201 {"id":"cmsfv62i40006ikqqk4wcrc7c", …,
        "youtubeVideoId":"dQw4w9WgXcQ",
        "videoTitle":"Typed by the admin",
        "videoDurationSeconds":212,
        "videoThumbnailUrl":null,
        "videoMetadataFetchedAt":null,
        "videoMetadataSource":"manual", …}
```

The id was extracted from a full URL, the admin's typed title and runtime were stored, `videoMetadataSource` is `'manual'`, and **`videoMetadataFetchedAt` is `null`** — the staleness signal §4.5 exists for. Nothing `500`d.

The bulk refresh returned §4.1's exact shape and wrote nothing:

```
POST /v1/admin/lessons/refresh-metadata {"lessonIds":["…","…"]}
-> {"refreshed":0,"skipped":2,"failed":[],"reason":"youtube_disabled"}
```

That short-circuit is the whole safety of this endpoint here: without it, the natural implementation would run each lesson through the feature-off branch and rewrite every one to `'manual'` with a null title, duration and thumbnail — a **data-loss path with a `200` on it**, and in this workspace the _only_ path the route can take. Asserted with zero write calls in `admin-lessons.controller.spec.ts`.

And the id is **still validated** with the integration off — `javascript:alert(1)/watch?v=dQw4w9WgXcQ` is refused before any write. A disabled integration must not become a hole through which an unvalidated string reaches the column the frontend builds an embed URL from.

### Clause 4 — 🔴 **no YouTube request fires on a member lesson read**

Asserted twice and **proven by deliberate failure** — see [the full transcript below](#deliberate). Summary:

- **(a) structurally** — `libs/api/learning/src/lib/no-youtube-on-read.spec.ts` walks every non-spec `.ts` under `src/lib`, strips comments with `ts.transpileModule({ removeComments: true })`, and asserts the importer set **by exact equality, by name**. Anti-vacuity: `SCANNED.length >= 25`, the known consumer really does import the package, all three member-read directories were reached, and a fabricated comment-only source is proven _not_ to be flagged while a real import in the same file _is_.
- **(b) behaviourally** — the **real** `CourseReadService.getLesson` (with its real `ModuleLockService`, `ProgressService` and `LessonCommentsService` collaborators) runs over a lesson that **has** `youtubeVideoId: 'dQw4w9WgXcQ'` and full persisted metadata, with `globalThis.fetch` spied and rejecting. The read returns the persisted values and `fetch` is never called. The "has a video and full metadata" fixture is constructed deliberately — every seeded lesson in this workspace has `youtubeVideoId: null`, which would make the assertion vacuous.
- **(c)** both halves were made to fail, then reverted, and **both runs are pasted below.**

---

<a name="census"></a>

## The census constants, as landed

```
apps/ptah-license-server/src/common/controller-validation.spec.ts
  const UNVALIDATED_DEBT: readonly string[] = [];        ← unchanged, still []
  const MIN_TOTAL_PAYLOAD_PARAMS = 67;                   ← RAISED from 51
  const NAMED_PRIMITIVE_PARAM_COUNT = 6;                 ← 🔴 UNCHANGED, still exactly 6

apps/ptah-license-server/src/common/route-map.spec.ts
  EXPECTED_ROUTES                     117 entries        ← 90 + 27
  PREFIX_EXCEPTIONS                     1 entry          ← unchanged (marketing/PublicMarketingController)
  KNOWN_PREFIX_DEBT: readonly string[] = [];             ← unchanged, still []
  KNOWN_CONTESTED:   readonly string[] = [];             ← unchanged, still []

libs/api/learning/src/lib/common/soft-delete-filter.spec.ts
  const EXPECTED_EXEMPTIONS: readonly string[] = [];     ← unchanged, still []

libs/api/learning/src/lib/common/nullable-dto.spec.ts
  const EXPECTED_NULLABLE_OPTIONALS = [3 entries];       ← see F-3
```

### 🔴 `MIN_TOTAL_PAYLOAD_PARAMS` — the derivation

I used B6C's method: set the constant to `9999`, run the suite, read the actual total out of the failure message.

```
$ (temporarily) const MIN_TOTAL_PAYLOAD_PARAMS = 9999;
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation

● Server-wide input validation — structural guard › anti-vacuity
  › discovers at least 9999 payload params server-wide

    Expected: >= 9999
    Received:    67

Tests: 1 failed, 43 passed, 44 total
```

**Raised 51 → 67**, and the arithmetic closes exactly. The per-controller breakdown is written into the docblock:

```
learning/MemberCoursesController             2   (2 @Body)
learning/MemberLessonCommentsController      3   (3 @Body)
learning/AdminCoursesController              4   (4 @Body)
learning/AdminCourseModulesController        3   (3 @Body)
learning/AdminLessonsController              4   (4 @Body)
                                           ----
                                            16      45 + 16 = 61 whole-object
                                                    61 +  6 = 67 total
```

🔴 **`NAMED_PRIMITIVE_PARAM_COUNT` is still exactly 6, asserted green and unmoved.** That is the load-bearing half (RISK-I). **Every one of the sixteen new params is a `@Body()`; this batch added no `@Query()` anywhere**, and that is a property of the surface rather than luck: the member course list is unpaged (a curriculum is tens of courses, not thousands), the admin course list takes no filters, and §3.4's admin table has no `?includeDeleted` for courses. Had one `@Query('slug') slug: string` slipped in, the total would read 68 against a named count of 7 and the arithmetic above would not close.

I also recorded in the docblock that the eight `@Param()`s on the lesson routes contribute to **neither** number, and why that is correct rather than a gap: `paramBindings` filters on `BODY | QUERY`, because a path segment has nothing for `dtoPipe` to validate against. And I wrote the `9999` recipe itself into the docblock, so the next re-derivation is mechanical rather than a recount by eye.

---

<a name="prefixes"></a>

## The five route prefixes as landed, and the RI checks

```
v1/members/courses           MemberCoursesController          ← literal segment 3
v1/members/lesson-comments   MemberLessonCommentsController   ← literal segment 3
v1/admin/courses             AdminCoursesController
v1/admin/course-modules      AdminCourseModulesController
v1/admin/lessons             AdminLessonsController
```

**Five, not eight** — see [F-1](#f-1). These are exactly what Task 9.15's own block enumerates, and nothing else.

### RI-1 — segment-wise disjointness

🔴 **`v1/admin/course-modules` was NOT "simplified" to `v1/admin/courses/modules`.** The nested form is a proper _segment-wise_ path prefix of `v1/admin/courses`, which RI-1 rejects — RISK-J's exact shape, the one that broke the plan's admin layout in Batch 6. That `v1/admin/courses` is a _string_ prefix of `v1/admin/course-modules` is irrelevant: RI-1 compares parsed segments and segment 3 differs.

That distinction is now asserted in **three** places, deliberately, because it is the thing most likely to be "tidied up" by a later contributor:

- `route-map.spec.ts` RI-1, server-wide;
- `admin-courses.controller.spec.ts` — `🔴 course-modules is a SIBLING of courses, not a child of it (RISK-J)`, which asserts the prefix is exactly `v1/admin/course-modules`, has three segments, and does **not** start with `v1/admin/courses/`;
- `admin-guards.spec.ts` G1 — `the three curriculum prefixes are disjoint SIBLINGS at depth 3 (RISK-N)`, restated so a failure names the admin-surface rule rather than only the routing invariant. It uses a **segment-wise** comparison rather than `startsWith`, because a naive check would fail on this legal layout.

`PREFIX_EXCEPTIONS` still holds its one pre-existing entry and `KNOWN_PREFIX_DEBT` is still `[]`. **I added nothing to either.**

### RI-3 — three new unifiable pairs, each with its anti-vacuity half

Batch 6 made RI-3 non-vacuous with **one** pair. This batch takes it to **four**:

| Controller                     | Pair                           | Declared first | Genuinely unifies |
| ------------------------------ | ------------------------------ | -------------- | ----------------- |
| `AdminCoursesController`       | `PATCH reorder` vs `PATCH :id` | `reorder` ✅   | asserted ✅       |
| `AdminCourseModulesController` | `PATCH reorder` vs `PATCH :id` | `reorder` ✅   | asserted ✅       |
| `AdminLessonsController`       | `PATCH reorder` vs `PATCH :id` | `reorder` ✅   | asserted ✅       |

Each is asserted **locally in its own controller spec, in both halves** — the declaration order _and_ that the two paths unify — because the ordering assertion is decoration without the second.

**The honest negatives are asserted too**, and this is the part I would not want a reader to have to take on trust:

- `POST v1/admin/lessons/refresh-metadata` and `POST v1/admin/lessons/:id/refresh-metadata` have **different segment counts and do NOT unify**. The bulk one is declared first anyway, per the task, at zero cost — but a spec claiming RI-3 protects that pair would be false, and a false assertion reads as coverage. `admin-lessons.controller.spec.ts` asserts `unifies(bulk, single) === false` **and** that the bulk one is still first.
- The two member progress routes (`PUT …/progress`, `PUT …/completion`) have the **same** segment count but differ in a **literal** at segment 7, so no concrete request can match both. `member-courses.controller.spec.ts` asserts no same-verb pair on the controller unifies, **plus** an anti-vacuity case proving the two `PUT` paths have equal length — without which `unifies` would return `false` for a trivial reason and the first assertion would say nothing.

### RI-2 and `EXPECTED_ROUTES`

**117 entries**, up from 90 (+27: 5 member course + 4 member lesson-comment + 8 admin course + 4 admin module + 6 admin lesson). The array was extended **and then the prose running total was corrected in the same change** — B6C's C-4 is the reason: a count in prose is the one thing in that file no assertion can keep honest.

All 27 confirmed **live** against the running container's `RouterExplorer` log:

```
$ docker logs ptah_license_server | grep -oE "Mapped \{[^}]*\}" \
    | grep -E "courses|lessons|course-modules|lesson-comments" | sort -u
Mapped {/api/v1/admin/course-modules, POST}
Mapped {/api/v1/admin/course-modules/:id, DELETE}
Mapped {/api/v1/admin/course-modules/:id, PATCH}
Mapped {/api/v1/admin/course-modules/reorder, PATCH}
Mapped {/api/v1/admin/courses, GET}
Mapped {/api/v1/admin/courses, POST}
Mapped {/api/v1/admin/courses/:id, DELETE}
Mapped {/api/v1/admin/courses/:id, GET}
Mapped {/api/v1/admin/courses/:id, PATCH}
Mapped {/api/v1/admin/courses/:id/published, PUT}
Mapped {/api/v1/admin/courses/:id/restore, POST}
Mapped {/api/v1/admin/courses/reorder, PATCH}
Mapped {/api/v1/admin/lessons, POST}
Mapped {/api/v1/admin/lessons/:id, DELETE}
Mapped {/api/v1/admin/lessons/:id, PATCH}
Mapped {/api/v1/admin/lessons/:id/refresh-metadata, POST}
Mapped {/api/v1/admin/lessons/refresh-metadata, POST}
Mapped {/api/v1/admin/lessons/reorder, PATCH}
Mapped {/api/v1/members/courses, GET}
Mapped {/api/v1/members/courses/:slug, GET}
Mapped {/api/v1/members/courses/:slug/lessons/:lessonSlug, GET}
Mapped {/api/v1/members/courses/:slug/lessons/:lessonSlug/completion, PUT}
Mapped {/api/v1/members/courses/:slug/lessons/:lessonSlug/progress, PUT}
Mapped {/api/v1/members/lesson-comments, POST}
Mapped {/api/v1/members/lesson-comments/:id, DELETE}
Mapped {/api/v1/members/lesson-comments/:id, PATCH}
Mapped {/api/v1/members/lesson-comments/:id/answered, PUT}
```

27 lines. The list, the spec and the running server agree.

---

<a name="deliberate"></a>

## 🔴 PROOF BY DELIBERATE FAILURE — NFR-P6, both halves, two variants

The step is part of the task and it was not skipped. `courses/course-read.service.ts` was backed up **outside the repo** (`/tmp/b9c-bak/`, md5-verified) — never with a git command.

### Variant 1 — a `fetchVideo` call, as the task words it

Added to `CourseReadService.getLesson`:

```ts
import { YouTubeMetadataProvider } from '@ptah-api/youtube';
…
if (body.youtubeVideoId !== null) {
  await new YouTubeMetadataProvider(undefined as never).fetchVideo(body.youtubeVideoId);
}
```

**Both halves failed:**

```
● NFR-P6 › (a) structurally › is EXACTLY the wiring file and the one consumer
    - Expected  - 0
    + Received  + 1
      Array [
    +   "courses/course-read.service.ts",

● NFR-P6 › (a) structurally › no file under courses/, progress/ or comments/ reaches the package
    - Array []
    + Array [
    +   "courses/course-read.service.ts",
    + ]

● NFR-P6 › (b) behaviourally › returns the PERSISTED metadata and never calls the provider
● NFR-P6 › (b) behaviourally › issues no NETWORK request of any kind
● NFR-P6 › (b) behaviourally › ANTI-VACUITY: the read path really ran

Tests: 5 failed, 7 passed, 12 total
```

Run together with Batch 9B's local half:

```
$ npx nx test api-learning --skip-nx-cache --testPathPatterns="no-youtube-on-read|lesson-video"
● NFR-P6 — this is the ONLY CONSUMER of @ptah-api/youtube in the lib › and the sibling
  directories do not reach it
… (the five above)
Test Suites: 2 failed, 2 total
Tests:       6 failed, 43 passed, 49 total
```

**But I am reporting the weakness in variant 1 rather than banking it.** Its behavioural failure message was `TypeError: Cannot read properties of undefined (reading 'get')` — the provider's constructor blew up on a missing `ConfigService`, so the read threw _before_ reaching anything YouTube-shaped. That is a failure, and it is honest, but it is not the failure the assertion is written to catch. So I ran a second variant.

### Variant 2 — an actual outbound request, which is what the requirement literally means

```ts
if (body.youtubeVideoId !== null) {
  const probe: typeof YouTubeMetadataProvider = YouTubeMetadataProvider;
  void probe;
  await globalThis.fetch(`https://www.googleapis.com/youtube/v3/videos?id=${body.youtubeVideoId}`);
}
```

**Both halves failed, and the behavioural one for the right reason:**

```
● NFR-P6 › (a) structurally › is EXACTLY the wiring file and the one consumer
    + "courses/course-read.service.ts",

● NFR-P6 › (a) structurally › no file under courses/, progress/ or comments/ reaches the package
    + Array [
    +   "courses/course-read.service.ts",
    + ]

● NFR-P6 › (b) behaviourally › issues no NETWORK request of any kind — global fetch is never touched
    NFR-P6 VIOLATION: a member read issued a network request.

Tests: 3 failed, 9 passed, 12 total
```

Both structural failures **name the real file by path**, so the loader, the directory walk, the comment stripper and the analysis are proven against the real tree rather than only against fabricated strings.

### Reverted, and green

```
$ cp /tmp/b9c-bak/course-read.service.ts libs/api/learning/src/lib/courses/course-read.service.ts
$ md5sum libs/api/learning/src/lib/courses/course-read.service.ts /tmp/b9c-bak/course-read.service.ts
3f9743c6308e1a313c9db8ecae72de69 *libs/api/learning/src/lib/courses/course-read.service.ts
3f9743c6308e1a313c9db8ecae72de69 */tmp/b9c-bak/course-read.service.ts       ← byte-identical

$ npx nx run-many -t eslint:lint,typecheck,test -p api-learning --skip-nx-cache
Test Suites: 21 passed, 21 total
Tests:       492 passed, 492 total
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-learning
```

The backup directory was deleted afterwards; `git status` below shows nothing stray.

### 🔴 What the two variants together revealed, and which assertion is actually load-bearing

Variant 2 exposed something I would rather state than leave for someone else to find: **`expect(calls).toEqual([])` — the throwing-provider double — cannot fire today.** `CourseReadService`'s constructor takes four collaborators and none of them is a YouTube provider, so there is no seam through which the double could be reached. The property is true **by construction**, which is _stronger_ than any call count — but it means that particular assertion is a tripwire for a future refactor, not evidence.

**The assertion that can and does fire is the `globalThis.fetch` spy**, and variant 2 proved it. That is written into the spec at the fixture, in terms, so a reader does not mistake the call-count line for the proof. This is the same class of correction Batch 9B recorded as F-5 — an assertion that reads as coverage and is not — caught by making the test fail rather than by review.

---

<a name="vcurl"></a>

## The live `V-CURL` transcript

⚠️ **`curl -b "ptah_auth=$TOKEN"`, not `-H "Authorization: Bearer"`** — `JwtAuthGuard` reads `request.cookies['ptah_auth']` and never looks at the header (B6C's C-3). I minted a **30-minute** token locally by signing the documented `JWTPayload` shape with `JWT_SECRET` from the workspace-root `.env`, for the dev user's real `users.id` (`674888a2-b28b-4d83-87c8-8c30d971edc1`, `abdallah@miramarstaffing.com`, who is in `ADMIN_EMAILS` and holds `DEV-BUILDERS-VALIDATION-0001`). **The token file was deleted afterwards** and its absence is verified in [git status](#git).

**What I created** (all through the real API, all removed — see [cleanup](#cleanup)): four courses (`b9c-probe-{member,cohort,staff,draft}`), two modules on the member course (one open, one with `releaseAt: 2027-12-25`), two lessons, one comment. **No `member_group_assignments` row was created** — the zero-cohort state is what makes the visibility check meaningful and it was not touched.

### Visibility — one account proving both halves of A-2 and ASSUMPTION-7

```
$ curl -s -b "ptah_auth=$T" .../v1/members/courses
  b9c-probe-member | lessons 0/2 | 0%
  b9c-probe-staff  | lessons 0/0 | 0%          ← the cohort and draft courses are ABSENT

$ …/v1/members/courses/b9c-probe-draft   -> 404   (R2.1.2, a draft is invisible to everyone)
$ …/v1/members/courses/b9c-probe-cohort  -> 404   ← 404, NEVER 403
$ …/v1/members/courses/b9c-probe-staff   -> 200   ← ASSUMPTION-7, live
$ …/v1/members/courses/b9c-probe-member  -> 200
```

**The `staff` course IS visible to this admin while the `cohort` course is NOT** — being an admin grants no cohort content. Both from one account, which is the same proof B6C ran for categories.

### The locked module — exit-gate clause 1

```
$ …/v1/members/courses/b9c-probe-member/lessons/locked-lesson   -> HTTP 403
{"reason":"not_released","unlocksAt":"2027-12-25T09:00:00.000Z","message":"This module is not open yet."}

  withheld body leaked?  grep -c SECRET_LOCKED_BODY_MARKER_4c1a  ->  0

$ …/v1/members/courses/b9c-probe-member/lessons/open-lesson     -> HTTP 200
  youtubeVideoId      : dQw4w9WgXcQ
  videoTitle          : Typed by the admin
  videoDurationSeconds: 212
  next                : {"slug":"locked-lesson","title":"Locked Lesson","moduleTitle":"Locked Module"}
```

Note `next` — **prev/next traverses THROUGH the locked module** (R2.1.5), so the outline and the player agree about what comes next; the lock is enforced when the neighbour is _requested_.

### The progress path — exit-gate clause 2

```
PUT …/open-lesson/progress {"positionSeconds":190}  -> {"furthestPositionSeconds":190,"completedAt":null,"completionSource":null}
PUT …/open-lesson/progress {"positionSeconds":191}  -> {"furthestPositionSeconds":191,"completedAt":"2026-08-05T09:08:11.872Z","completionSource":"auto"}
PUT …/open-lesson/progress {"positionSeconds":1,"completed":true}  -> 400 "property completed should not exist"
PUT …/locked-lesson/progress                                        -> 403
PUT …/locked-lesson/completion                                      -> 403
```

### Lesson comments

```
POST /v1/members/lesson-comments {"lessonId":"<open>","bodyMarkdown":"Probe question?","parentId":null}
  -> 201 {"id":"…","parentId":null,"bodyMarkdown":"Probe question?","authorName":null,"answered":false,…}
       ⚠️ `parentId: null` was accepted, not 400 — the NullMeansAbsent() transform, live.

POST /v1/members/lesson-comments {"lessonId":"<locked>", …}
  -> 403 {"reason":"not_released","unlocksAt":"2027-12-25T09:00:00.000Z", …}
       R2.5.1: locking inherits on the WRITE path, through the same lock verdict.

POST /v1/members/lesson-comments {…,"answered":true}   -> 400   (forbidNonWhitelisted)
```

### Admin authoring

```
PATCH /v1/admin/lessons/<open> {"youtubeVideoIdOrUrl":""}
  -> youtubeVideoId: null | videoTitle: null | duration: null | source: null
       🔴 the empty string DETACHES all five columns — the reason UpdateLessonDto needs no null.

POST  /v1/admin/lessons/refresh-metadata {"lessonIds":[…]}
  -> {"refreshed":0,"skipped":2,"failed":[],"reason":"youtube_disabled"}

DELETE /v1/admin/courses/<draft>          -> {"deleted":true}
GET    /v1/admin/courses/<draft>          -> 404          (the tombstone is invisible; no AD-5 exemption)
POST   /v1/admin/courses/<draft>/restore  -> {"restored":true}      (R8.5, the window inside the UPDATE)
GET    /v1/admin/courses/<draft>          -> 200

PATCH  /v1/admin/courses/reorder {"ids":[all four]}   -> {"reordered":4}
PATCH  /v1/admin/courses/reorder {"ids":[one]}        -> 400
  {"message":"ids must list every course exactly once (expected 4, received 1)", …}
       ⚠️ a COUNT, not the offending ids — echoing which are real rows turns a reorder into an
         existence probe.
```

### 🔴 PRE-6, proved in the database rather than only in a mock

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc \
  "select action, target_type, target_id, actor_email from admin_audit_log
    where action like 'learning.%' order by created_at;"

learning.course.create  |Course      |cmsfv5cfy…|abdallah@miramarstaffing.com
learning.course.create  |Course      |cmsfv5ck2…|abdallah@miramarstaffing.com
learning.course.create  |Course      |cmsfv5cmt…|abdallah@miramarstaffing.com
learning.course.create  |Course      |cmsfv5cpr…|abdallah@miramarstaffing.com
learning.module.create  |CourseModule|cmsfv5jt0…|abdallah@miramarstaffing.com
learning.module.create  |CourseModule|cmsfv5jxb…|abdallah@miramarstaffing.com
learning.course.publish |Course      |cmsfv5cfy…|abdallah@miramarstaffing.com
learning.course.publish |Course      |cmsfv5cfy…|abdallah@miramarstaffing.com
learning.course.publish |Course      |cmsfv5ck2…|abdallah@miramarstaffing.com
learning.course.publish |Course      |cmsfv5cmt…|abdallah@miramarstaffing.com
learning.lesson.create  |Lesson      |cmsfv62i4…|abdallah@miramarstaffing.com
learning.lesson.create  |Lesson      |cmsfv62mm…|abdallah@miramarstaffing.com
learning.lesson.update  |Lesson      |cmsfv62i4…|abdallah@miramarstaffing.com
```

…and after the cleanup deletions, 24 rows across ten actions:

```
learning.course.create   | 4      learning.lesson.create   | 2
learning.course.delete   | 5      learning.lesson.delete   | 2
learning.course.publish  | 4      learning.lesson.update   | 1
learning.course.reorder  | 1      learning.module.create   | 2
learning.course.restore  | 1      learning.module.delete   | 2
```

⚠️ **`learning.lesson.refresh_metadata` is deliberately absent, and that is correct.** With the integration off, `refreshMetadata` short-circuits **before** the audit hook fires, because nothing was written. An audit row claiming a refresh that wrote nothing would be a false record.

### The hub — `'empty'` → `'ok'`, envelope unchanged

```
BEFORE any course:
  top-level keys : member,sections
  section keys   : community,learning,notifications,packs,sessions
  learning       : {"status":"empty","data":null}

WITH one live course:
  top-level keys : member,sections                          ← identical
  section keys   : community,learning,notifications,packs,sessions   ← identical
  learning       : {"status":"ok","data":{
                     "courseSlug":"b9c-probe-member","courseTitle":"B9C Probe Member",
                     "nextLesson":{"slug":"locked-lesson","title":"Locked Lesson",
                                   "moduleTitle":"Locked Module"},
                     "locked":true,
                     "completedLessons":1,"totalLessons":2,"percent":50}}
  learning keys  : data,status                              ← the {status,data} shape, unchanged
  card keys      : completedLessons,courseSlug,courseTitle,locked,nextLesson,percent,totalLessons

AFTER cleanup:
  learning       : {"status":"empty","data":null}            ← back to the pre-check state
```

**`'empty'` → `'ok'` → `'empty'` observed live with the identical envelope** — two top-level keys, five section keys, `{status,data}`. `member-hub.service.ts` was not touched and the composer gained no line.

Note `"locked": true` with a non-null `nextLesson`: exactly the case `ContinueLearning.locked` exists for. `null` would mean "you finished everything"; the flag is what lets the card say "the next module opens on Tuesday" instead.

**R6.2 — the hub is still exactly one request.** Two independent `GET`s returned byte-identical envelope sizes (1942 / 1942), and `learning.section.spec.ts` asserts `listCourses` and `getCourse` are each called **exactly once** per hub request, plus that the cost does not grow with 12 visible courses (the N+1 signature a "fetch a detail per course to decide which is current" implementation would have).

<a name="cleanup"></a>

### Cleanup — exactly what I created, removed

Every probe row was first soft-deleted **through the real routes** (which is what wrote the `*.delete` audit rows), then hard-deleted with one `psql` statement, because the API only ever soft-deletes and the tables had to return to their pre-check state:

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "delete from courses where slug like 'b9c-probe-%';"
DELETE 4          ← the Cascade on modules → lessons → comments/progress cleared the rest

$ … counts
courses|0    course_modules|0    course_lessons|0    lesson_progress|0    lesson_comments|0

$ … "select (select count(*) from community_categories)||'|'||(select count(*) from community_topics)
      ||'|'||(select count(*) from community_posts);"
4|9|10                                              ← Batch 8's committed seed, INTACT

$ … "select license_key, plan, status from licenses where license_key like 'DEV-%';"
DEV-BUILDERS-VALIDATION-0001|builders|active        ← INTACT

$ … "select count(*) from member_group_assignments;"
0                                                    ← still zero, not seeded
```

> ⚠️ **The 24 `learning.*` audit rows were deliberately NOT deleted**, per this dispatch's explicit instruction: deleting audit rows to tidy a verification run is the instinct an audit log exists to defeat. They record actions that really happened, written by the mechanism under test. They are also **self-identifying as probes** — the `learning.course.create` rows carry `metadata: {"title":"B9C Probe Member","visibility":"member"}` and so on — so a later reader can tell what they are.
>
> 🔴 **This contradicts `tasks.md:6092-6094`**, which refines B6C's rule with _"but **do** delete rows referring to scratch entities that no longer exist"_ — which is exactly these 24. The dispatch brief is the more specific and more recent instruction and it says keep; keeping is also the non-destructive direction, and the reverse is not recoverable. **If the orchestrator prefers `tasks.md`'s refinement, it is one statement:**
> `delete from admin_audit_log where action like 'learning.%';`
> Flagged rather than decided silently.

**No `prisma migrate`, `db push` or `migrate reset` command of any kind was run**, no schema file was touched, and **no `deletedBy` column was added** — that belongs to migration 4 (Batch 12).

---

<a name="findings"></a>

## Findings — things that contradict `tasks.md`, the plan, or Batch 9B

<a name="f-1"></a>

### 🔴 F-1 (MED) — Task 9.15 says "eight route prefixes" and enumerates **five**

Task 9.15's heading reads _"**The eight route prefixes**, and the RI-1 check already done (RISK-N)"_, and the code block under it lists **five**. RISK-N's row repeats it: _"All **eight** new prefixes are disjoint literal siblings"_. This dispatch's own brief inherits the number: _"Land the **eight** disjoint literal sibling prefixes Task 9.15 enumerates."_

**Five is right, and it is corroborated three ways**: Task 9.15's file list names five controllers; plan §3.4 gives five prefixes; plan §2.6's file map gives five. Plan §3.7's member census lists **eleven** member controllers across all phases and notes _"plus the **seven** new admin controllers"_ — so `8` looks like a stale count from a draft that spanned phases (§3.7's seven admin controllers plus something, or the five here plus §3.5's live-session ones).

**Landing eight would have required inventing three prefixes**, which is the opposite of what RISK-N asks for. I landed exactly the five the block enumerates and nothing else.

**Recommendation**: amend Task 9.15's heading and RISK-N's row to "five".

<a name="f-2"></a>

### 🔴 F-2 (MED) — NFR-P6's importer set is **two** files, and Batch 9B's assertion said one

Batch 9B wrote `lesson-video.service.spec.ts`'s local NFR-P6 assertion as `expect(importers).toEqual(['lessons/lesson-video.service.ts'])` — correct at the time, because `learning.module.ts` did not exist yet. It went **red** the moment Task 9.16 landed the module:

```
● NFR-P6 — this is the ONLY importer of @ptah-api/youtube in the lib
    + "learning.module.ts",
      "lessons/lesson-video.service.ts",
```

`LearningModule` **must** import `YoutubeModule` to make `YouTubeMetadataProvider` injectable into `LessonVideoService`. There is no way to register a Nest provider without naming the module that exports it, and Task 9.16 explicitly requires that import (_"`LearningModule` imports `YoutubeModule` (a **normal** import, not `@Optional()`)"_). So Task 9.17's wording — _"the only importer is `lessons/lesson-video.service.ts`, asserted by name"_ — is **not satisfiable as written**.

**What I did, and why it is a strengthening rather than a relaxation.** The set is now asserted as `['learning.module.ts', 'lessons/lesson-video.service.ts']`, **plus a second assertion that closes the gap the widening opens**: the module's import clause is parsed and asserted to bind **exactly `['YoutubeModule']`**. A Nest module token has no `fetchVideo` and no `isEnabled` — importing it grants the ability to make the provider injectable somewhere else, not the ability to call it. So the property NFR-P6 actually cares about — _exactly one file in this lib can issue a YouTube request_ — is asserted **directly** rather than approximated by a file count. Both `no-youtube-on-read.spec.ts` and 9B's local half carry it.

That second assertion had to be rewritten once, for Batch 9B's F-5 reason (third occurrence in this task): my first version was `expect(source).not.toContain('YouTubeMetadataProvider')`, which flagged the module's own docblock — the paragraph explaining why it must not import the provider. Repointed at the **import clause**, which is stronger anyway: it cannot be fooled by an alias, a re-export or a second import line.

**Recommendation**: amend Task 9.17(a) to "the only file that imports the PROVIDER is `lessons/lesson-video.service.ts`; `learning.module.ts` imports the module token and nothing else".

<a name="f-3"></a>

### 🔴 F-3 (MED) — `EXPECTED_NULLABLE_OPTIONALS` holds **three** entries; Batch 9A predicted zero

9A's census docblock says _"🔴 IT IS `[]`, AND IT SHOULD STILL BE `[]` AT THE END OF BATCH 9."_ It holds three:

```
courses/dto/update-course.dto.ts:coverImageUrl
courses/dto/update-module.dto.ts:description
courses/dto/update-module.dto.ts:releaseAt
```

**Task 9.15's own text pre-authorises exactly these three** — _"`Course.coverImageUrl`, `CourseModule.description` and `CourseModule.releaseAt` are the three candidates — each one added is a line a reviewer reads"_ — so the two documents disagree with each other, not with me. This is Batch 6C's `EXPECTED_EXEMPTIONS` situation repeating: the brief predicted one entry, two were unavoidable.

Each is argued individually in the census, and the argument is the same shape each time: **`null` is the only spelling of "clear this value"**. `releaseAt: null` means "unschedule this module — open it now" (R2.4.1), which `CoursesService.updateModule` already implements; omitting the key means "leave the schedule alone", `''` is not a date, and a far-past timestamp would be a lie in the audit trail. `coverImageUrl: ''` would store an empty string in a nullable column, rendering as a broken `<img src="">` rather than as no image.

**All three are on UPDATE DTOs and none is on a CREATE DTO**, and that is the distinction holding the list at three: on a create there is nothing to clear, so `CreateCourseDto.coverImageUrl`, `CreateModuleDto.description` and `CreateModuleDto.releaseAt` all use `@IsOptionalNotNull()`.

**A fourth was predicted by Batch 9B and is deliberately absent.** `UpdateLessonDto.youtubeVideoId` (`null` = "detach the video") is a real requirement, but `resolveVideoColumns` already treats an **empty string** exactly as an absent one — it returns `NO_VIDEO` and clears all five columns in the same single `update`. So the tri-state is expressible without `null`, and adding one would be a fourth spelling of a meaning that already has three. **Verified live**: `PATCH /v1/admin/lessons/:id {"youtubeVideoIdOrUrl":""}` cleared all five.

**Recommendation**: amend 9A's docblock claim (already done in-tree) and `tasks.md`'s exit-gate wording from "`[]`" to "exactly the three clear-the-value entries Task 9.15 names".

### F-4 (MED) — §3.4 gives `GET /v1/admin/courses/:id` a route and Batch 9B left it no service method

Plan §3.4's admin row reads _"GET list, POST, GET/PATCH/DELETE `:id`, …"_. `CoursesService` after 9B had `listForAdmin()` and eleven mutations, and **no single-course read**. This is Batch 6C's C-5 recurring in the same place (a route table naming a capability no file list names).

I added `CoursesService.getForAdmin(id)` — three queries, routed through the same private `hydrateCourse` that `listForAdmin` uses, so a single-course read and a list row are produced by one mapper and cannot disagree. Filtering `listForAdmin()` in the controller was the alternative and is rejected in the method's docblock: it reads every course and their whole module and lesson trees to answer about one.

It takes **no AD-5 exemption** — a tombstoned course is a `404` here, verified live — so `EXPECTED_EXEMPTIONS` is still `[]`.

### F-5 (MED) — the two progress routes could not be composed through `getLesson` without a 5-query cost per ping

Batch 9B's handoff item 2 says the module-lock `403` must be composed at the controller and points at `CourseReadService.getLesson` as "the shape". Composing through `getLesson` **literally** would have cost **five queries plus a full markdown payload and the whole comment thread on every progress write** — and a member watching a lesson emits one write per 15 seconds plus flushes on pause and teardown, which is why the throttle tier is 60/min rather than 10/min. That is the shape that turns a working feature into an incident.

**What I did**: extracted `getLesson`'s first ~35 lines — the visibility resolution and the lock evaluation — into a private `requireOpenLesson`, and added a public `resolveWritableLesson(ctx, slug, lessonSlug): Promise<{ lessonId }>` that calls it. **Two queries**, and `getLesson` calls the same helper, so there is literally **one** implementation of "may this member open this lesson right now" and a change to the lock semantics cannot reach one caller and miss the other. Asserted in `member-courses.controller.spec.ts` as a call **order** (`['resolve', 'write']`) and as "a rejected resolve means nothing is written", for both routes.

**Recommendation for `tasks.md`**: Task 9.15's implementation details should say the lock is composed through a _narrow_ resolver sharing the read model's decision, not through the full lesson read.

### F-6 (LOW) — `PATCH /v1/admin/lessons/:id` needs the video and the text in ONE transaction, which 9B's signatures did not allow

`CoursesService.createLesson(input, video, audit?)` takes the resolved video columns; `updateLesson(id, input, audit?)` did not, and its docblock said the video columns were `LessonVideoService.resolveAndPersist`'s to write. A `PATCH` carrying a title edit **and** a video change would then have been two transactions, with a window in which the title landed and the video did not — exactly what R2.2.4 forbids.

**What I did**: added an optional `video?: LessonVideoColumns` to `UpdateLessonInput` (not a new positional parameter — so every existing 9B spec call still compiles) and spread it into the same `update`. The signature is unchanged, the atomicity is restored, and `admin-lessons.controller.spec.ts` asserts one `$transaction` and one `lesson.update` for a request carrying both.

**`resolveAndPersist` is NOT dead code** — I checked, because the composition above removes its only obvious controller call site. It is the engine behind `refreshMetadata` (`lesson-video.service.ts:289`), which is what `POST refresh-metadata` and `POST :id/refresh-metadata` both run. No action needed; recorded because a reader comparing the controller against 9B's method list will otherwise wonder.

### F-7 (LOW) — `learning.course.publish` covers both directions

Batch 9B's handoff enumerates `learning.course.{create,update,delete,publish,restore,reorder}` — one `publish`, no `unpublish`. Per-intent granularity would argue for two, and "who took this course away from members" is a real question. I followed the enumerated vocabulary exactly (adding a value `tasks.md` does not name would be a worse deviation) and put the direction in `metadata.published`, which is verified live. **Recommendation**: if the product wants the question answerable without reading `metadata`, `learning.course.unpublish` is one union member and one ternary.

---

<a name="t915"></a>

## Task 9.15 — Controllers and DTOs ✅

### Files

| Path                                                                                                                                                  |                                                                           |
| ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------- |
| `D:\projects\ptah-extension\libs\api\learning\src\lib\courses\member-courses.controller.ts`                                                           | NEW                                                                       |
| `…\src\lib\courses\member-courses.controller.spec.ts`                                                                                                 | NEW, 21 tests                                                             |
| `…\src\lib\comments\member-lesson-comments.controller.ts`                                                                                             | NEW                                                                       |
| `…\src\lib\comments\member-lesson-comments.controller.spec.ts`                                                                                        | NEW, 14 tests                                                             |
| `…\src\lib\courses\admin-courses.controller.ts`                                                                                                       | NEW                                                                       |
| `…\src\lib\courses\admin-courses.controller.spec.ts`                                                                                                  | NEW, 20 tests                                                             |
| `…\src\lib\courses\admin-course-modules.controller.ts`                                                                                                | NEW                                                                       |
| `…\src\lib\courses\admin-course-modules.controller.spec.ts`                                                                                           | NEW, 15 tests                                                             |
| `…\src\lib\courses\admin-lessons.controller.ts`                                                                                                       | NEW                                                                       |
| `…\src\lib\courses\admin-lessons.controller.spec.ts`                                                                                                  | NEW, 22 tests                                                             |
| `…\src\lib\courses\dto\{create-course,update-course,create-module,update-module,create-lesson,update-lesson,reorder,refresh-metadata,publish}.dto.ts` | NEW (9 files, 11 classes)                                                 |
| `…\src\lib\progress\dto\{update-progress,set-completion}.dto.ts`                                                                                      | NEW                                                                       |
| `…\src\lib\comments\dto\{create-comment,update-comment,set-answered}.dto.ts`                                                                          | NEW                                                                       |
| `…\src\lib\common\admin-audit.ts`                                                                                                                     | NEW — deviation D-9.15b                                                   |
| `…\src\testing\controller-reflection.ts`                                                                                                              | NEW                                                                       |
| `…\src\lib\courses\courses.service.ts`                                                                                                                | MODIFIED — `+getForAdmin`, `+UpdateLessonInput.video` (F-4, F-6)          |
| `…\src\lib\courses\course-read.service.ts`                                                                                                            | MODIFIED — `+resolveWritableLesson`, `requireOpenLesson` extraction (F-5) |

### Decisions

**D-9.15a — `reorder.dto.ts` holds THREE classes, not one with an optional parent id.** A single `ReorderDto { ids, courseId?, moduleId? }` would make `forbidNonWhitelisted` **accept** `{ ids, moduleId }` on `PATCH v1/admin/courses/reorder` — a request naming a scope the endpoint ignores, which looks honoured and is not (B6C's D-6.12a). It would also make the parent id optional on the two endpoints where it is mandatory, moving that check from the boundary into the service.

**D-9.15b — the audit seam is a shared `common/admin-audit.ts`, re-declared rather than imported from forum.** Batch 9B left an optional `AuditHook` on every mutation; this is the real writer. It is a re-declaration for the same reason as the rest of this lib's `common/` (AD-5's copy-rather-than-share decision): forum's `common/` is not barrel-exported and `forum.module.spec.ts` asserts that surface, so sharing would mean widening a public barrel for three functions. The docblock names the sibling and says the two must change together.

**D-9.15c — `requireAdminUserId` refuses rather than substituting a placeholder, even though three of the four models have no column to write it to.** Batch 9B's F-1 found that `Course`, `CourseModule` and `Lesson` carry no `deletedBy`, so the value reaches a logger and the audit row rather than a column. The refusal is what keeps that honest: `deleteCourse` still _demands_ a real actor id, so "who deleted this" can never be answered with a substituted `'unknown'` — the request simply does not happen. Asserted: an unguarded request throws, opens no transaction and writes no audit row.

**D-9.15d — throttle tiers, reading §3.1 literally** (B6C's D-6.12g, cheap to overrule and stated as such). `CONTENT_CREATION` 10/min on `POST lesson-comments`; **`PROGRESS_WRITES` 60/min** on both `PUT …/progress` and `PUT …/completion`, with the reasoning in the constant's docblock — a member watching a lesson emits ~5–6 writes a minute in ordinary playback and 10/min would rate-limit _watching a video_, presenting as "my progress stopped saving", which is the hardest kind of bug to attribute. Admin writes get `AdminThrottlerGuard` at 20/min, matching forum. §3.1 names neither edits nor deletes, so those inherit the global 100/min.

**D-9.15e — creates compose through the read model, and it is already true inside the service.** B6C's D-6.12d requires a fresh row to be byte-identical to a re-fetched one, with **the slug the SERVICE allocated** (it may have appended a suffix). `CoursesService.createCourse` already returns `toAdminCourse(...)` — the same mapper `listForAdmin` uses — so no controller-side re-read is needed and none was added. Re-deriving a slug in the controller is exactly how a stable-URL guarantee breaks; there is no slug derivation anywhere in these five files.

**D-9.15f — `MemberLessonCommentsController` declares no `GET`, and it is a decision.** A lesson's thread arrives with the lesson (`MemberLessonDetail.comments`, one read), so a standalone read would be a second visibility decision to keep in step — and the obvious way around R2.4.4's outline redaction, since the outline deliberately has no comments key at all. Asserted (`expect(routes.some(r => r.startsWith('GET '))).toBe(false)`). `AdminCourseModulesController` has no `GET` for the analogous reason, also asserted.

**D-9.15g — `releaseAt` crosses the boundary as an ISO STRING and is converted in the controller.** `@Type(() => Date)` was the alternative and is rejected: it turns an unparseable string into `Invalid Date`, which surfaces as a Prisma error four layers down instead of a `400`. `@IsISO8601()` catches it at the boundary. The **tri-state survives the conversion** (`undefined` → omitted, `null` → `null`, string → `Date`) and each branch has its own test in `admin-course-modules.controller.spec.ts`, including that a `Date` and not a string reaches the column — a string there would be a runtime error deep inside `ModuleLockService`'s `.getTime()`.

### The two spec bugs the validation notes warn about — both avoided, deliberately

1. **`memberRequest(ctx = CTX)` fires the default on an explicit `undefined`.** Every "guard removed" case uses a separate `unguardedRequest()` function, with the reason written beside it and the two prior occurrences named (B6C's Task 6.12, Batch 9A's Finding 6).
2. **An R7.3 source assertion that greps for `MembershipService` flags the controller's own docblock.** The assertion in `admin-courses.controller.spec.ts` is pointed at **import statements and `@Inject(...)` patterns**, across all four files that name those services in prose — the idiom `admin-guards.spec.ts` G6 already uses and documents.

The same class of correction was needed **twice more** and both are recorded in the tree: the `A-8 no reactions` check in `member-lesson-comments.controller.spec.ts` parses import clauses rather than text, and F-2's provider check does the same. That is Batch 9B's F-5 recurring as a class, now four times across two dispatches.

### Verification

```
$ npx nx test api-learning --skip-nx-cache --testPathPatterns=controller
Test Suites: 5 passed, 5 total   Tests: 92 passed, 92 total

$ npx nx test ptah-license-server --skip-nx-cache
Test Suites: 5 passed, 5 total   Tests: 124 passed, 124 total
```

Per controller, all present: the exact route table read off the metadata · every payload param binds `dtoPipe` and none is a named primitive · the class-level guard chain in the right order · the RI-3 ordering **and** that the pair unifies · `UpdateProgressDto` has one property.

---

<a name="t916"></a>

## Task 9.16 — `LearningModule`, the barrel, app wiring, the three registries ✅

### Files

| Path                                                                  |                                              |
| --------------------------------------------------------------------- | -------------------------------------------- |
| `…\libs\api\learning\src\lib\learning.module.ts`                      | NEW                                          |
| `…\libs\api\learning\src\lib\learning.module.spec.ts`                 | NEW, 17 tests                                |
| `…\libs\api\learning\src\index.ts`                                    | MODIFIED — `export {}` → 8 `export *` lines  |
| `…\libs\api\audit\src\lib\audit-log.types.ts`                         | MODIFIED — 15 actions, 3 target types        |
| `…\apps\ptah-license-server\src\app\app.module.ts`                    | MODIFIED                                     |
| `…\apps\ptah-license-server\src\testing\controller-registry.ts`       | MODIFIED — 5 entries                         |
| `…\apps\ptah-license-server\src\common\route-map.spec.ts`             | MODIFIED — 27 routes, RI-3 note, prose total |
| `…\apps\ptah-license-server\src\common\controller-validation.spec.ts` | MODIFIED — floor 51 → 67                     |
| `…\apps\ptah-license-server\src\admin\admin-guards.spec.ts`           | MODIFIED — G1 ×2 + two new assertions        |

### PRE-2 and the barrel — the known resolution, reused rather than rediscovered

The barrel gained **8 `export *` lines**: 1 module + 2 services + 5 controller classes. `learning.module.spec.ts` asserts the **service** surface by exact array equality, which is what makes widening it a failing test rather than an import:

- `exports` is **exactly** `[CourseReadService, ProgressService]`;
- the barrel exports **no other service** (`Object.keys(barrel).filter(n => n.endsWith('Service'))` equals those two);
- five named write/authoring services are **not** exported by any name (`CoursesService`, `ReorderService`, `LessonVideoService`, `LessonCommentsService`, `ModuleLockService`);
- **none of `common/`** — twelve names checked individually, `NOT_DELETED` and the three visibility builders above all, because a consumer that can reach them can hand-build a `where` and read the curriculum past every visibility clause and every soft-delete filter;
- **nothing from `src/testing/`** — six names checked;
- the five controller classes **are** exported, asserted by exact array equality so a sixth is a diff.

### RISK-L honoured

`NotificationsModule` is **absent**, and the omission is recorded in the module docblock with a pointer to Batch 14 and the reason (nothing here produces a `Notification` row yet — though R10.1's producers _do_ include lesson-comment replies, which this module writes, so the temptation is real). `learning.module.spec.ts` asserts **both** that the module does not import it **and** that the docblock explains why — so a future reader cannot see a missing import and "fix" it against a lib that does not exist.

### The other module decisions, each asserted

- **`AdminGuard` / `AdminThrottlerGuard` declared LOCALLY** (the `MemberGroupsModule` acyclicity idiom), asserted, together with the absence of any `AdminModule` import (both in the metadata and in the source) and the fact that `MemberGuard` is **not** re-declared.
- **`YoutubeModule` is a NORMAL import**, asserted, with the reasoning in the docblock: the feature-off posture lives _inside_ the provider, so an unset key is a supported runtime state; a missing module is a wiring mistake that should fail at boot.
- **`YoutubeModule` is NOT registered in `app.module.ts`** — a second registration would create a second provider instance and therefore a second `loggedDisabled` flag, which is how "logged exactly once" becomes "once per module that touched it". The spec asserts the module docblock records that reasoning.
- **Not `@Global()`**, asserted.
- **Imports exactly six modules**, asserted by exact array equality.

### `app.module.ts`

`LearningModule` is registered **after `MembershipModule`** (line ~69, R7.3) in the same region as `ForumModule` (~107), with a comment stating that the `MembershipModule` ordering is a **requirement** (`MemberGuard` resolves out of its `@Global` scope) while its position relative to `MemberHubModule` is **not** — nothing here is `@Global` and `MemberHubModule` names `LearningModule` explicitly, so it gets the same singleton whichever appears first.

### `audit-log.types.ts` — the vocabulary, and the framing rewritten

Added **15** `AdminAuditAction` values (`learning.course.{create,update,delete,publish,restore,reorder}`, `learning.module.{create,update,delete,reorder}`, `learning.lesson.{create,update,delete,reorder,refresh_metadata}`) and **3** `AdminAuditTargetType` values (`Course`, `CourseModule`, `Lesson`).

**I checked for a stale "Phase 3 adds …" note and there was none to rewrite** — B6C had already replaced the "not yet" framing when it added `community.*`. So rather than appending under a stale note, the new block carries its own _reason for existing_, stated as a fact about what is there:

> _"⚠️ THESE ARE THE ONLY RECORD OF WHO DELETED A COURSE, MODULE OR LESSON. `Course`, `CourseModule` and `Lesson` carry `deletedAt` and NO `deletedBy` column … So unlike the `community._`deletes above, where the row itself names the actor,`learning.course.delete` and its two siblings are the whole answer to 'who removed this'."\*

`CourseModule`, not `Module` — the Prisma model name, matching every other member of the union, and unambiguous against a Nest module. There is deliberately **no `LessonComment` target type**: lesson comments are moderated through the member surface, not an admin audit path, and that model is the one course model carrying its own `deletedBy`.

### `admin-guards.spec.ts` G1

All three admin controllers added to **both** `it.each` tables, plus the two analogues of the deleted G5 that B6C added for the forum: the three prefixes are disjoint siblings at depth 3 with nothing at `v1/admin/courses/modules` (RISK-N, using a segment-wise comparison), and the surface genuinely **declares writes** (compared against `RequestMethod.GET`, never truthiness, because `GET === 0`).

---

<a name="t917"></a>

## Task 9.17 — Hub `learning` → `'ok'`, and the NFR-P6 proof ✅

### Files

| Path                                                                    |                                                    |
| ----------------------------------------------------------------------- | -------------------------------------------------- |
| `…\libs\api\member-hub\src\lib\sections\learning.section.ts`            | MODIFIED — the body of `resolve`, and nothing else |
| `…\libs\api\member-hub\src\lib\sections\learning.section.spec.ts`       | NEW, 19 tests                                      |
| `…\libs\api\member-hub\src\lib\member-hub.module.ts`                    | MODIFIED — imports `LearningModule`                |
| `…\libs\api\member-hub\src\lib\sections\empty-sections.section.spec.ts` | MODIFIED — deviation, see below                    |
| `…\libs\api\member-hub\src\lib\sections\community.section.spec.ts`      | MODIFIED — one constructor call                    |
| `…\libs\api\learning\src\lib\no-youtube-on-read.spec.ts`                | NEW, 12 tests                                      |

**The seam was honoured literally.** `member-hub.service.ts` was **not touched** — no line added, no line changed. The response's two top-level keys and five section keys are byte-identical, verified live and asserted in the spec by comparing the working and failing envelopes key for key.

### Decisions

**D-9.17a — the section injects `CourseReadService` ONLY.** Every number the card renders — `completedLessons`, `totalLessons`, `percent`, the resume pointer and the module lock verdict — is already computed inside that service's own query budget. Injecting `ProgressService` would issue extra queries for numbers already in hand and, worse, derive the same values twice, so the card and the courses page could disagree. That is B6C's D-6.15a and the reasoning transfers unchanged. `LearningModule` still exports both, because §2.6 fixes the surface at two and Batch 14's notification badge is the obvious second reader.

**D-9.17b — the section does NOT catch, and the fault case is asserted through the REAL composer.** `learning.section.spec.ts` constructs the actual `MemberHubService` with a `CourseReadService` whose `listCourses` rejects, and asserts the hub still answers with the `member` block and the other four sections intact while `learning` degrades to `{ status: 'unavailable', data: null }`. `'empty'` and `'unavailable'` are asserted **distinct** in the same suite, and NFR-S7 is asserted too — a unique marker in the rejection reason appears nowhere in the serialised response.

**D-9.17c — which course is "the" course, and why not "the most recent".** The first course in course order that this member has not finished; if everything is complete, the first course, whose `resumeLesson` is then `null` and whose card renders a completion state rather than a dead "Resume" button. "Most recently touched" would be the nicer rule and **is not available**: `MemberCourseSummary` carries no timestamp, and `LessonProgress.updatedAt` is a per-lesson fact that would need a third query and a **second definition of "current course"** — one on this card and one on the courses page. Stated in the docblock rather than left to be discovered, with the note that recency, if wanted later, belongs in `CourseReadService` as one derivation both surfaces read.

**D-9.17d — the query accounting is stated, not rounded down.** Plan AD-4 calls this "a two-query lookup"; the real cost is **two service calls and four queries** (`listCourses` 2 + `getCourse` 2). That is the same accounting correction Batch 6B recorded as its C-5 — the plan counted conceptual lookups, not round trips. Both calls happen once per hub request and neither grows with the curriculum; asserted with 12 visible courses still costing one `getCourse`.

**D-9.17e — the card DROPS fields rather than spreading.** The seven `ContinueLearning` keys are asserted **exactly**, and `id`, `description`, `coverImageUrl`, `modules` and `resumeLesson` are asserted **absent** — including a serialised check against a unique marker planted in `description`, so a nested leak is caught too. `percent` is asserted **passed through, not recomputed**, using a deliberately _inconsistent_ fixture (1/3 with `percent: 99`) so the assertion cannot pass by coincidental agreement with a re-derivation.

**D-9.17f — `locked` is the resume lesson's OWN module, with a negative control.** A `modules.some(m => m.locked)` implementation — the obvious wrong one — would pass the positive case, so the suite asserts that a locked _other_ module leaves `locked: false`.

### `empty-sections.section.spec.ts`, kept and rewritten

Exactly B6C's D-6.15c, one section over. It constructed `new LearningSection()` with no arguments in two places. Rather than delete `LearningSection` from it, I kept it with an injected stub whose lookup **genuinely returns nothing**, and rewrote the docblock to record that the `'empty'` case is now **reached through a query** rather than returned unconditionally — which is precisely the transition worth asserting. The docblock also now states why `learning`'s empty payload is `null` while the array sections' is `[]`, so the difference reads as a rule rather than an inconsistency.

`community.section.spec.ts` needed one line changed (its composer harness constructs `LearningSection`); the stub returns nothing so the community assertions are unperturbed.

---

<a name="assumption-6"></a>

## ASSUMPTION-6 — stated plainly

**No real YouTube request was made by this dispatch, and none could be.** `.env:259` reads `YOUTUBE_API_KEY=` with no value, so `isEnabled()` is `false` in this workspace and the feature-off branch is the live path — which is why exit-gate clause 3 is nearly free and clause 4 is _easier than it should be_: a member read makes no YouTube call partly because nothing can.

That is exactly why clause 4 is asserted **two independent ways and proven by deliberate failure** rather than by observing that no request happened. The structural half would fail even with a key present; the behavioural half's `fetch` spy was proven capable of failing by variant 2.

The enabled path is asserted in `admin-lessons.controller.spec.ts` by injecting a provider double returning `{ ok: true, video }` — the exact discriminated union Batch 9A's provider produces — which proves the fetch-before-transaction ordering, the five-column write and `videoMetadataSource: 'api'` without a key.

**The one-line way to overrule this**: put a real Data API v3 key in `.env`, then re-run `POST /v1/admin/lessons` with a known unlisted video id and check that `videoMetadataSource` is `'api'` and `videoMetadataFetchedAt` is non-null. One line of `.env`, one extra check.

---

<a name="deviations"></a>

## Deviations from the spec's file lists and signatures

Six, all reported above, all additive or corrective:

1. **`libs/api/learning/src/lib/common/admin-audit.ts`** (not in Task 9.15's file list) — the shared PRE-6 writer three controllers pass in. Forum has the identical file for the identical reason.
2. **`CoursesService.getForAdmin(id)`** — [F-4](#findings). §3.4 lists the route; no file list named a method.
3. **`UpdateLessonInput.video?: LessonVideoColumns`** — [F-6](#findings). Added as an interface field rather than a positional parameter, so every 9B spec call still compiles.
4. **`CourseReadService.resolveWritableLesson` + the `requireOpenLesson` extraction** — [F-5](#findings). One implementation of the lock decision, two queries instead of five per progress ping.
5. **`libs/api/member-hub/src/lib/sections/community.section.spec.ts`** (not in Task 9.17's file list) — one constructor call, forced by `LearningSection` gaining a dependency.
6. **Three `EXPECTED_NULLABLE_OPTIONALS` entries** — [F-3](#findings). Task 9.15 pre-authorises exactly these three.

**Modifications to Batch 9A/9B files (3), each a strengthening:**

- `lesson-video.service.spec.ts` — the NFR-P6 importer set corrected from one file to two, **plus a new assertion** that the module binds only the module token ([F-2](#findings)). No rule was relaxed: the property is now asserted directly instead of approximated.
- `nullable-dto.spec.ts` — the census gained three argued entries, the stale _"finds ZERO files today and its 'no violations' assertion is honestly vacuous"_ paragraph was **rewritten** (it became false the moment the DTOs landed), and a **new anti-vacuity bound** was added: `MIN_DTO_FILES = 14`, listing the paths and asserting the walk reached all three DTO directories. That is the bound Batch 9A said it _could not_ write without lying; it can be written now.
- `courses.service.ts` / `course-read.service.ts` — the additions in items 2–4 above.

---

<a name="wider"></a>

## Wider verification

```
$ npx nx run-many -t typecheck,test \
    -p api-forum,api-core,api-community,api-admin,api-identity,api-membership,api-marketing \
    --skip-nx-cache

(api-admin)       Tests:  12 passed
(api-core)        Tests: 123 passed
(api-identity)    Tests:  23 passed
(api-community)   Tests: 226 passed
(api-membership)  Tests:  39 passed
(api-marketing / api-forum)  all suites passed
exit = 0   (7 projects)
```

`api-forum:test` did **not** exhibit Batch 9A's Finding-7 flakiness in any run this dispatch. `libs/api/core`'s `MODEL_KEYS` census is untouched — this lib uses 9A's own `mock-learning-prisma.ts`.

**Never `nx affected`** — every run used an explicit project list with `--skip-nx-cache`.

---

<a name="discipline"></a>

## Discipline

- **No `git commit`, `git add`, `git rm`, `git stash`, `git reset`, `git checkout <path>` or `git restore`.** Nothing was committed and nothing was staged; `git diff --cached --name-only` is **empty**. The deliberate-failure revert was done with `cp` from a scratch copy at `/tmp/b9c-bak/`, md5-verified, never with a git command.
- **Never `--no-verify`**; no hook was bypassed because nothing was committed. No gate failed on a path I did not touch, so the question never arose.
- **Never `nx affected`** — always an explicit project list with `--skip-nx-cache`.
- **No `prisma migrate`, `db push` or `migrate reset` of any kind, and no `prisma` command at all.** No migration authored, no schema file touched. **No `deletedBy` column was added** — 9B's F-1 belongs to migration 4 in Batch 12, and the recommendation is restated in `admin-courses.controller.ts`'s `DELETE` docblock rather than acted on.
- **The committed data is intact**: Batch 8's seed reads `4|9|10`, `DEV-BUILDERS-VALIDATION-0001` is `builders`/`active`, `member_group_assignments` is still **0 rows** — I did not seed one to make anything pass.
- **No test, census or boundary rule was weakened.** `EXPECTED_EXEMPTIONS`, `UNVALIDATED_DEBT`, `KNOWN_PREFIX_DEBT` and `KNOWN_CONTESTED` are all still `[]`; `PREFIX_EXCEPTIONS` still holds its one pre-existing entry; `NAMED_PRIMITIVE_PARAM_COUNT` is untouched at 6; `MIN_TOTAL_PAYLOAD_PARAMS` was **raised** with the arithmetic written down; the one bound I added (`MIN_DTO_FILES`) is a new floor, not a relaxation; and the two structural assertions I changed were made **stronger** (import-clause parsing beats substring matching in both).
- **CLI delegation disabled**: no `ptah_agent_spawn`, no sub-agents.
- **Foreign territory**: I did not read, edit, stage or run anything against `libs/backend/**`, `libs/frontend/**`, `libs/shared/**`, `libs/web/**`, `apps/ptah-extension-vscode/**`, `apps/ptah-electron/**`, `apps/ptah-landing-page-e2e/**`, `content-manifest.json` or `skills-lock.json`.
- **Scope**: Batch 10 (frontend) and Batch 11 (the course seed) were **not started**.

---

<a name="git"></a>

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/src/admin/admin-guards.spec.ts            ← MINE (9.16)
 M apps/ptah-license-server/src/app/app.module.ts                     ← MINE (9.16)
 M apps/ptah-license-server/src/common/controller-validation.spec.ts  ← MINE (9.16, floor 51→67)
 M apps/ptah-license-server/src/common/route-map.spec.ts              ← MINE (9.16, +27 routes)
 M apps/ptah-license-server/src/testing/controller-registry.ts        ← MINE (9.16, +5 entries)
 M libs/api/audit/src/lib/audit-log.types.ts                          ← MINE (9.16, +15/+3)
 M libs/api/learning/src/index.ts                                     ← MINE (9.16, the real barrel)
 M libs/api/learning/src/lib/common/nullable-dto.spec.ts              ← MINE (census + bound + prose)
 M libs/api/learning/src/lib/courses/course-read.service.ts           ← MINE (F-5)
 M libs/api/learning/src/lib/courses/courses.service.ts               ← MINE (F-4, F-6)
 M libs/api/learning/src/lib/lessons/lesson-video.service.spec.ts     ← MINE (F-2)
 M libs/api/member-hub/src/lib/member-hub.module.ts                   ← MINE (9.17)
 M libs/api/member-hub/src/lib/sections/community.section.spec.ts     ← MINE (9.17, 1 line)
 M libs/api/member-hub/src/lib/sections/empty-sections.section.spec.ts← MINE (9.17)
 M libs/api/member-hub/src/lib/sections/learning.section.ts           ← MINE (9.17, the seam)
 M libs/frontend/tasks-ui/src/index.ts                                ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/board/task-board.component.spec.ts   ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/board/task-board.component.ts        ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/board/task-card.component.spec.ts    ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/board/task-card.component.ts         ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/board/task-column.component.ts       ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.spec.ts      ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/palette/palette-entries.ts           ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.spec.ts         ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/components/tasks-view.component.ts              ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/services/tasks-store.service.spec.ts            ← 🔴 FOREIGN
 M libs/frontend/tasks-ui/src/lib/services/tasks-store.service.ts                 ← 🔴 FOREIGN
?? libs/api/learning/src/lib/comments/dto/                            ← MINE (9.15, 3 DTOs)
?? libs/api/learning/src/lib/comments/member-lesson-comments.controller.spec.ts   ← MINE (9.15)
?? libs/api/learning/src/lib/comments/member-lesson-comments.controller.ts        ← MINE (9.15)
?? libs/api/learning/src/lib/common/admin-audit.ts                    ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-course-modules.controller.spec.ts      ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-course-modules.controller.ts           ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-courses.controller.spec.ts             ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-courses.controller.ts                  ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-lessons.controller.spec.ts             ← MINE (9.15)
?? libs/api/learning/src/lib/courses/admin-lessons.controller.ts                  ← MINE (9.15)
?? libs/api/learning/src/lib/courses/dto/                             ← MINE (9.15, 9 DTO files)
?? libs/api/learning/src/lib/courses/member-courses.controller.spec.ts            ← MINE (9.15)
?? libs/api/learning/src/lib/courses/member-courses.controller.ts                 ← MINE (9.15)
?? libs/api/learning/src/lib/learning.module.spec.ts                  ← MINE (9.16)
?? libs/api/learning/src/lib/learning.module.ts                       ← MINE (9.16)
?? libs/api/learning/src/lib/no-youtube-on-read.spec.ts               ← MINE (9.17)
?? libs/api/learning/src/lib/progress/dto/                            ← MINE (9.15, 2 DTOs)
?? libs/api/learning/src/testing/controller-reflection.ts             ← MINE (9.15)
?? libs/frontend/tasks-ui/src/lib/components/bulk/                    ← 🔴 FOREIGN

$ git diff --cached --name-only
(empty)

$ git rev-parse --short HEAD
4d1c57707        ← unchanged from the start of this dispatch
```

### Mine — 15 modified + 19 untracked entries, **34 files**

**New (33)**: 5 controllers + 5 controller specs · 14 DTO files (16 classes) · `common/admin-audit.ts` · `testing/controller-reflection.ts` · `learning.module.ts` + spec · `no-youtube-on-read.spec.ts` · `learning.section.spec.ts`.
**Modified (15)**: 5 server registries/wiring · `audit-log.types.ts` · the learning barrel · 4 learning files · 4 member-hub files.

### Foreign — the concurrent process

**HEAD did not move during this dispatch** — `4d1c57707` at start and at end. The concurrent process's working set is entirely `libs/frontend/tasks-ui/**` (12 modified + 1 untracked directory). **None of it is reachable from `scope:api`**, so none of it can affect this batch's gate, and none of it was read, edited, staged or run against.

⚠️ **The orchestrator must stage path-by-path.** `git add -A` would sweep that unrelated, half-finished feature into this batch's commit. The safe set for Batch 9C is:

```
apps/ptah-license-server/src/admin/admin-guards.spec.ts
apps/ptah-license-server/src/app/app.module.ts
apps/ptah-license-server/src/common/controller-validation.spec.ts
apps/ptah-license-server/src/common/route-map.spec.ts
apps/ptah-license-server/src/testing/controller-registry.ts
libs/api/audit/src/lib/audit-log.types.ts
libs/api/learning/
libs/api/member-hub/
```

### No scratch files remain

```
$ find libs/api/learning libs/api/member-hub apps/ptah-license-server \
    -name "*.tmp" -o -name "tmp-proof*" -o -name ".tmp-*"
(no output)

$ ls -la .tmp-b9c-token b9c-graph-tmp.json
ls: cannot access '.tmp-b9c-token': No such file or directory
ls: cannot access 'b9c-graph-tmp.json': No such file or directory
```

The minted token, the `nx graph` JSON and the deliberate-failure backup (`/tmp/b9c-bak/`) were all deleted.

---

<a name="handoff"></a>

## What Batch 10 should know

1. **The wire is live and it works.** Every member and admin route was exercised against `http://localhost:3000` with real data — but **use a cookie, not a Bearer header** (`curl -b "ptah_auth=$TOKEN"`). B6C's C-3 is still unfixed in `tasks.md`.
2. 🔴 **A locked module is `403 { reason, unlocksAt }` and an invisible/draft course is `404`. Do not unify them, and do not render the lock client-side.** The `403` is the enforcement; `MemberModuleSummary.locked` exists so the outline can render the padlock **without** a request that is going to fail. A client that ignored `locked` would still be refused.
3. 🔴 **`nextLesson` is not `null` for a locked next lesson.** `ContinueLearning.locked` is the flag; `null` means "you finished everything". "You are done" and "the next module opens on Tuesday" are different cards and the contract distinguishes them deliberately.
4. **prev/next traverses THROUGH locked modules** (R2.1.5), so the player's "Next" and the outline agree. Do not filter them out client-side — the lock is enforced when the neighbour is requested.
5. **The client never sends a completion flag, and `{"completed":true}` is a `400`.** Send `{ positionSeconds }` to `…/progress` and let the server derive it. The explicit member control is a _different_ route, `PUT …/completion` with `{ complete }`, and it records `completionSource: 'manual'`.
6. **`videoDurationSeconds: null` means manual-completion-only**, even when `youtubeVideoId` is set — the R2.2.6 feature-off path, which is the live path in this workspace. Render a runtime chip only when it is non-null.
7. 🔴 **RISK-S: `bypassSecurityTrustResourceUrl` appears nowhere in this repository.** Batch 10 introduces the workspace's first trusted-URL construction. The persisted `youtubeVideoId` is validated server-side on write **including with the integration off**, and `VIDEO_ID_PATTERN` is exported from `@ptah-api/youtube` with `.global === false` asserted (a `/g` regex holds `lastIndex` between calls) — re-validate anyway, in one chokepoint.
8. **Slugs are the URL, ids are not.** Member routes are `courses/:slug/lessons/:lessonSlug`; admin routes are `:id`. A course slug never changes (`UpdateCourseDto` has no `slug`). ⚠️ **Batch 9B's F-2 is still open**: `@@unique([moduleId, slug])` is module-scoped while the route is course-scoped. The create path mitigates it with a course-wide taken set; a direct database insert or an import path could still produce an ambiguous URL.
9. **The hub's `learning` section reports `'ok'` with one card.** `'unavailable'` means the query FAILED; `'empty'` means this member has no visible course. **Render them differently** or the fault signal R6.4 exists for is lost.
10. **`403` on a comment write means the module is locked; `404` means the lesson is invisible.** Editing someone else's comment is `403` (they can see it); a comment on a lesson they can no longer see is `404` **even for its author**.
11. **A tombstoned comment with live children is returned** with `bodyMarkdown` set to a stated placeholder and `authorName: null`. Do not render `''` — Batch 7 found that a blank row reads as a rendering bug rather than a removal.
12. **A depth-3 reply is REPAIRED to depth 2, not rejected.** The response reports the parent it actually got; render two levels and trust the returned `parentId`.
13. **RISK-T applies: you are the first real consumer of this API.** Batch 7 found an off-by-one, a 500 and a missing filter that were invisible from inside the backend's own tests. **Report, do not work around** — a `9.1` follow-up dispatch is budgeted.
