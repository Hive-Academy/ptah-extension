# Batch 9A report — Tasks 9.1 – 9.6 (P3-BE)

**Executor**: backend-developer · **Branch**: `ak/license-server-validation-pipe` (not switched, not rebased)
**HEAD at start**: `09d94be9b` · **HEAD at end**: `ed840f9d2` (moved twice by the concurrent process; neither move touched my territory)
**Verdict**: all six tasks complete and green. **Three graded items all met.** One HIGH-severity finding: `prisma migrate diff` proposed to **DROP both trigram indexes from migration 2**, and applying it would have silently destroyed community search performance.

**Nothing was committed and nothing was staged.**

---

## Contents

- [The three graded items](#the-three-graded-items)
- [Findings that contradict `tasks.md` or the plan](#findings)
- [Task 9.1](#task-91) · [9.2](#task-92) · [9.3](#task-93) · [9.4](#task-94) · [9.5](#task-95) · [9.6](#task-96)
- [RISK-Q, as verified in the tree](#risk-q)
- [RISK-O and the unit naming](#risk-o)
- [ASSUMPTION-6 statement](#assumption-6)
- [Wider verification](#wider-verification)
- [Final `git status`, annotated](#final-git-status)
- [What 9B and 9C should know](#handoff)

---

<a name="the-three-graded-items"></a>

## 🔴 The three graded items

### 1. Migration 3 applied cleanly, trigram index present, Batch 8's seed intact ✅

Applied as `20260819090000_courses`. Five tables, the GIN trigram index with `gin_trgm_ops`, the dev entitlement intact, the Batch-8 seed intact at 4/9/10, health 200. **And the two migration-2 trigram indexes survived** — which they would not have if I had applied the generated SQL as produced. Full outputs in [Task 9.5](#task-95).

> 🔴 **I read the generated SQL before applying it and it contained two statements beyond the five `CREATE TABLE`s: `DROP INDEX "community_posts_body_trgm"` and `DROP INDEX "community_topics_title_trgm"`.** I removed them, documented the removal in the migration's own header, and applied the rest. See [Finding 1](#finding-1) — this is the single most consequential thing in the batch.

### 2. `YouTubeMetadataProvider` never throws ✅

Every branch of §4.4's table returns a discriminated result, asserted against a **stubbed `fetch`** with a real `videos.list` body: success · `not_found` · `private` · `not_embeddable` · `malformed_response` (Zod failure, non-JSON 2xx, **and** an unparseable duration) · `unavailable` (HTTP 404, HTTP 403 quota, transport failure, **and the 10 s timeout aborted at exactly 10,000 ms under fake timers**) · `skipped` (feature-off, logged exactly once across three calls). Plus a `never throws, for any upstream behaviour` case over six hostile behaviours. Native `fetch` + `AbortController`, no `googleapis`. **119 tests green.**

### 3. Both structural specs ARMED and PROVEN TO FAIL before any service exists ✅

Both deliberate-failure runs and both reverted-green runs are pasted in [Task 9.6](#task-96). Each failure **named the throwaway file by path**, which is what proves the loader, the discovery walk and the analysis on the **real tree** rather than only on fabricated strings.

---

<a name="findings"></a>

## Findings — things that contradict `tasks.md`, the plan, or the environment

<a name="finding-1"></a>

### 🔴 Finding 1 (HIGH) — `migrate diff` proposed to drop migration 2's trigram indexes, and the spec's audit command would have caught it only by luck

Task 9.5 step 4 says to audit with:

```
grep -nE "^(ALTER|DROP)" .../migration.sql | grep -v "ADD CONSTRAINT"   # expect none
```

Run against the **generated** output, that command returns two lines:

```
DROP INDEX "community_posts_body_trgm";
DROP INDEX "community_topics_title_trgm";
```

**Batch 6A ran the same command on the same kind of output and got "(none)".** That is not because 6A was more careful — it is because at that moment the trigram indexes **did not yet exist**; migration 2 was the migration creating them. Migration 3 is the **first** migration authored _after_ they exist, so it is the first to see this, and every migration from here on will see it too.

The mechanism: `migrate diff --from-config-datasource --to-schema` compares the **live database** against `schema.prisma`. The trigram indexes are real, live and correct, but Prisma has no syntax for `gin_trgm_ops`, so `schema.prisma` cannot declare them — and the diff therefore reads them as "indexes the schema does not want" and proposes deletion.

**Why this is severe rather than merely annoying**: applying it destroys nothing visible. Community search keeps returning **correct** results, by sequential scan. No test fails, no error is raised, no alert fires. It is a pure, silent performance regression that becomes visible only when the corpus is large — by which point the cause is several migrations in the past.

**What I did**: removed both lines, applied the remaining DDL, and wrote a 40-line header into `migration.sql` recording the exact statements removed, why they are not drift, and that **migrations 4 and 5 will each see THREE proposed drops** (the two above plus this migration's own `course_lessons_title_trgm`). I also carried the warning into the `schema.prisma` banner, where a model reader will see it.

Verified after applying: all three trigram indexes present with the correct `indexdef`.

I did not treat this as a "stop and report, do not apply" event in the sense of halting the batch, because it is not drift between schema and database — it is the documented, expected consequence of an index Prisma cannot express, and the spec's own step 5 anticipates exactly this class of thing ("a later migration can silently drop it"). What the instruction protects against is _committing it inside this migration_, and it is not committed inside this migration. **Flagging it here because the spec's expected output was "expect none" and the actual output was two lines — an executor following the letter of step 4 would stop, and should know why.**

### 🔴 Finding 2 (MED) — the migration folder name cannot be a Prisma-generated timestamp here, because the workspace clock is _behind_ two already-applied migrations

Task 9.5 step 2 says to use a Prisma-generated timestamp and keep only the `_courses` suffix, because §1.8's hand-picked `20260819090000` is a future date that "would sort after a real migration authored in the interim, silently inverting the order".

**In this workspace the opposite is true.** Today is 2026-08-05, so `prisma migrate dev --create-only` would name the folder `20260805xxxxxx_courses` — which sorts **before** two migrations that are already applied:

```
20260806000000_fix_founding_invite_offer_copy
20260812090000_community_forum
```

That is the ordering inversion step 2 exists to prevent, produced by following step 2 literally. On a fresh database, migration 3 would replay before migration 2.

I verified there is **no** real migration authored in the interim — the applied list ends at `20260812090000`, so §1.8's concern does not apply either. I therefore used **§1.8's documented name, `20260819090000_courses`**, which is the only option that (a) sorts strictly after every applied migration and (b) keeps §1.8 and the Migration Authority table accurate. Recording it because it is a deliberate deviation from step 2's literal wording.

### Finding 3 (MED) — `libs/api-contracts/community/src/lib/member/member-course.contract.ts` already exists; Task 9.7 marks it `(NEW)`

It was created in commit `6349c4b3e` ("add api-contracts/community wire types") and already declares `ContinueLearning` + `continueLearningSchema`. Its own docblock says: _"PHASE 1 SCOPE. Only `ContinueLearning` is declared … `MemberCourseSummary`, `MemberCourseDetail`, `MemberLessonDetail` and the comment types are added by Batch 9 (P3-BE), in THIS file."_

So the intent is right and only the `(NEW)` marker is wrong — **dispatch 9B must EXTEND this file, not create it.** Creating it would clobber `ContinueLearning`, which the hub's `learning` section already depends on.

Usefully, it also **confirms RISK-O's third unit independently**: `ContinueLearning.percent` is documented as _"DERIVED from the two counts above"_ (`completedLessons` / `totalLessons`), with `totalLessons: 0` yielding `0` and never `NaN`. That is the counts-not-seconds rule already fixed on the wire.

### 🔴 Finding 4 (MED, hand forward to Task 9.13) — `PT0S` reproduces the zero-threshold bug that ASSUMPTION-8 was written to prevent

`tasks.md` requires `parseIso8601Duration` to return `null` rather than `0` on an unrecognised form, with the stated reason that "`0` is a legal duration and would silently make the 90% threshold `0`, marking every lesson complete on the first frame".

The reasoning is right and the mitigation is incomplete. **`PT0S` is a form the parser DOES understand** — YouTube emits it for a video that is still processing — and the honest parse is `0`. So a lesson can legitimately persist `videoDurationSeconds = 0`, and then:

```
furthestPositionSeconds >= 0.9 * 0   →   0 >= 0   →   true
```

Every such lesson is complete the instant a member opens it. **ASSUMPTION-8 keys manual-only on `null`, so it does not catch this.**

I did not change ASSUMPTION-8's semantics — that is Task 9.13's decision, not mine — but I have:

- documented the gap at length in `parse-iso8601-duration.ts`'s module docblock, addressed explicitly to Task 9.13;
- put a spec case on `PT0S → 0` that says in its comment where the guard belongs;
- put a provider spec case on the same.

**The fix is one predicate in `progress/completion.ts`: treat `duration === null || duration <= 0` as "no usable duration".**

### Finding 5 (LOW) — RISK-R confirmed exactly as stated

Verified in the tree. `google-auth.provider.ts:52` has only `loggedScopeVerdict`, which guards a _scope verdict_ (`recordGrantedScopes`), not a disabled notice. The disabled-log-once idiom is `sessions.service.ts:60` (`private loggedDisabled = false`) and `:427-438` (`private isEnabledOrLogOnce()`). §4.1's citation of `:396-407` is stale — the real range is `:427-438`, so the drift is ~31 lines. I copied `isEnabledOrLogOnce()`'s shape.

### Finding 6 (LOW) — the spec's own test helper pattern hid four feature-off failures on first run

Not a repo defect but worth recording as method. My first `youtube-metadata.provider.spec.ts` used `providerWithKey(key: string | undefined = API_KEY)`. A JS default parameter **fires on an explicit `undefined`**, so `providerWithKey(undefined)` — the entire feature-off suite — silently constructed an **enabled** provider. Four assertions failed loudly, which is the good outcome; had the assertions been weaker (`expect(result.ok).toBe(false)` alone, which is true for `unavailable` too) they would have passed against the wrong provider and exit-gate clause 3 would have been proved by a test that never exercised it. The helper now takes a required parameter and carries a docblock saying why.

### Finding 7 (LOW) — `api-forum:test` failed once inside a `run-many`, and is not reproducible

During wider verification, `nx run-many -t test -p api-forum,api-core,api-contracts-community,api-member-hub` reported `api-forum:test` failed with no test-level failure output. Re-run standalone: **21 suites, 505 tests, all pass.** Re-run as the same 4-project `run-many`: **all four green.** Nx itself printed `NX detected a flaky task: api-learning:test` on a separate run. Every Jest project in this area prints `A worker process has failed to exit gracefully…`, which is a pre-existing teardown leak across the api libs and the likely cause. **Not caused by this batch** (nothing here touches `libs/api/forum`), but it is real flakiness in the gate and is worth its own follow-up.

### Finding 8 (INFO) — `prisma validate` and every Prisma command emit an "Update available 7.7.0 -> 7.9.1" banner

Cosmetic, but it lands on stdout alongside the dotenv banner. Do not upgrade mid-task; noting it because Prisma-7-specific command shapes (C-1/C-2) are version-sensitive and a silent bump would invalidate them.

---

<a name="task-91"></a>

## Task 9.1 — Scaffold `libs/api/youtube` ✅

### Files created

- `D:\projects\ptah-extension\libs\api\youtube\project.json`
- `D:\projects\ptah-extension\libs\api\youtube\package.json`
- `D:\projects\ptah-extension\libs\api\youtube\eslint.config.mjs`
- `D:\projects\ptah-extension\libs\api\youtube\jest.config.cts`
- `D:\projects\ptah-extension\libs\api\youtube\tsconfig.json`
- `D:\projects\ptah-extension\libs\api\youtube\tsconfig.lib.json`
- `D:\projects\ptah-extension\libs\api\youtube\tsconfig.spec.json`
- `D:\projects\ptah-extension\libs\api\youtube\README.md`
- `D:\projects\ptah-extension\libs\api\youtube\src\index.ts`

### Files modified

- `D:\projects\ptah-extension\tsconfig.base.json` (one line)

### Decisions

**D-1 — `eslint.config.mjs` and `package.json` were created, per Batch 6A's D-1.** Neither is in the plan's file list. Without `eslint.config.mjs`, Nx does not infer an `eslint:lint` target and this task's own verification command does not exist. `package.json` is what puts `packageName` into the project's `js` metadata and the `npm:private` tag on it. 6A had to add both after Task 6.1's list omitted them; the instruction said not to repeat the omission, and I did not.

**D-2 — the barrel starts at `export {};`** (6A's D-2 idiom) with a docblock naming the intended end state and stating that `youtube.schemas.ts` is deliberately _not_ on that list. Task 9.3 replaced it with the real barrel.

**D-3 — alias placement.** `@ptah-api/youtube` sits between `@ptah-api/membership` and `@ptah-api/member-hub` — i.e. at the end of the `type:util` run, before the `type:feature` ones start. That matches the file's existing grouping (6A put `forum` between `member-hub` and `community` for the same reason).

### Verification — actual output

```
$ npx nx reset && npx nx show project api-youtube

{"root":"libs/api/youtube",
 "targets":{"eslint:lint":{...,"options":{"cwd":"libs/api/youtube","command":"eslint ."},...},
            "test":{"executor":"@nx/jest:jest","options":{"jestConfig":"libs/api/youtube/jest.config.cts","passWithNoTests":true},...},
            "typecheck":{"executor":"nx:run-commands","options":{"command":"npx tsc --noEmit --project libs/api/youtube/tsconfig.lib.json"},...}},
 "name":"api-youtube",
 "tags":["npm:private","scope:api","type:util"],
 "metadata":{"js":{"packageName":"@ptah-api/youtube","packageVersion":"0.0.1",...}},
 "sourceRoot":"libs/api/youtube/src","projectType":"library","implicitDependencies":[]}
```

Exactly the expected result: `tags: ["npm:private","scope:api","type:util"]` · `metadata.js.packageName: "@ptah-api/youtube"` · targets include **`eslint:lint`**, `test`, `typecheck`.

`npx nx show project` worked on the first attempt after `nx reset`; the ground-truth item 17 failure did not occur here (it did occur once later, before `api-learning` — also fixed by `nx reset`).

```
$ npx nx run-many -t eslint:lint,typecheck -p api-youtube --skip-nx-cache
 NX   Successfully ran targets eslint:lint, typecheck for project api-youtube
```

Zero boundary violations.

---

<a name="task-92"></a>

## Task 9.2 — pure core: id extraction, ISO-8601 duration, the Zod boundary ✅

### Files created

- `D:\projects\ptah-extension\libs\api\youtube\src\lib\extract-video-id.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\extract-video-id.spec.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\parse-iso8601-duration.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\parse-iso8601-duration.spec.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.schemas.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.schemas.spec.ts`
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.types.ts`

All three implementation modules follow `slug.ts`'s pattern of stating what they are **not**.

### Decisions

**D-4 — `extractVideoId` checks the HOSTNAME.** The spec lists the accepted URL forms but not whether the host is validated. I validate against a closed set (`youtube.com`, `www.`, `m.`, `music.`, `youtube-nocookie.com` + `www.`, and `youtu.be`), so `https://evil.example.com/watch?v=<id>` returns `null`. Nothing downstream is compromised by a wrong id — the id is re-fetched against the Data API and the embed is built from the id alone — but silently accepting an arbitrary host means an admin who pasted the wrong link gets a lesson that looks saved and points elsewhere. `youtube-nocookie.com` is included because §4.6.2 makes it _our own_ embed host, so it is what an admin copying out of our player will paste back.

**D-5 — a missing scheme is supplied only when the input has no scheme.** `youtu.be/<id>` (a mobile share sheet) is accepted; `javascript:alert(1)/watch?v=<id>` is not re-schemed and is refused deliberately rather than by accident. Spec case included.

**D-6 — `/v/` (the legacy Flash path) is accepted** in addition to the six forms the spec names. One array entry; old bookmarks and old course material still carry it.

**D-7 — `parseIso8601Duration` rejects years, months, weeks and fractional seconds.** `P1Y`/`P1M` have no fixed length in seconds, so any constant chosen would be wrong for most inputs and wrong _silently_. YouTube never emits them. `PT1.5S` is rejected because the column is `Int` and rounding it here would hide the rounding from the call site. The two `(?!$)` guards in the regex are what reject the degenerate `P` and `PT`.

**D-8 — a duration outside the safe-integer range returns `null`.** Persisting a number that has already lost precision is worse than refusing it.

**D-9 — `resolveThumbnailUrl` lives in `youtube.schemas.ts`.** The spec requires the `high ?? medium ?? default ?? null` resolver but does not place it. It takes **already-parsed** input (its parameter type is derived from the schema, so it is unreachable without a successful `safeParse`), which is why it is not the "parse or default" helper the spec forbids. Its docblock says so explicitly.

**D-10 — `YouTubeVideoMetadata.durationSeconds` is `number`, not `number | null`.** §4.4 has no row for "parsed fine but the duration is unconvertible". Making it nullable would let a fetch half-succeed and produce a lesson with a title, an id and no duration — which by ASSUMPTION-8 is silently manual-only, with no signal to the admin. I map it to `malformed_response` instead, which is the loud option and matches the same class of defect one layer in (a Zod failure). The nullable **column** still exists, for the feature-off path where an admin typed a title and no runtime — which is what ASSUMPTION-8 is actually about.

**D-11 — `skipped` is structurally exclusive from `error`.** The union carries `error?: undefined` on the skipped arm and `skipped?: undefined` on the error arm. That is not decoration: it makes it impossible for a producer to build an object with both, and it makes `if (r.error)` narrow correctly. Exit-gate clause 3 depends on a caller being unable to fold "the integration is off" into "the video is broken".

### Verification — actual output

```
$ npx nx test api-youtube --skip-nx-cache --testPathPatterns="extract-video-id|parse-iso8601|youtube.schemas"

Test Suites: 3 passed, 3 total
Tests:       90 passed, 90 total
Time:        12.461 s
 NX   Successfully ran target test for project api-youtube
```

Every required case is present: all URL forms → the same id · 10-char and 12-char → `null` · an 11-char id containing `+`, `/`, `=` or a space → `null` (asserted with a `toHaveLength(11)` first, so the case cannot pass for the wrong reason) · `PT0S` → `0` · `P1DT2H` → `93600` · `"5 minutes"` → `null` · the §4.3 schema accepts a real `videos.list` body pasted verbatim · it **rejects** the same body with `contentDetails` removed · `privacyStatus: 'unlisted'` parses.

Three cases beyond the required set that earn their keep:

- **the fixture proves Zod STRIPS rather than rejects** — asserted on `pageInfo`, `etag`, `channelId`, `madeForKids` and the `maxres` thumbnail. A fixture invented to satisfy the schema would carry only the eight named fields and would pass whether or not stripping worked. Without `.strict()` being _proved_ absent, every additive change YouTube ships becomes a `malformed_response`.
- **`privacyStatus: 'private'` parses at the schema layer.** §4.4 maps it to `error: 'private'`, which requires the body to parse first. A schema-level rejection would collapse it into `malformed_response`, and the admin would be told "YouTube is unavailable" instead of "that video is private".
- **`VIDEO_ID_PATTERN.global === false`.** A module-level `RegExp` with `/g` holds `lastIndex` between calls, so the second `.test()` of the same string returns `false`. Batch 10 imports this constant and calls it once per render, immediately before a trusted-URL construction.

---

<a name="task-93"></a>

## Task 9.3 — `YouTubeMetadataProvider` + `YoutubeModule` ✅

### Files

- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube-metadata.provider.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube-metadata.provider.spec.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\lib\youtube.module.ts` (NEW)
- `D:\projects\ptah-extension\libs\api\youtube\src\index.ts` (MODIFIED — the real barrel)
- `.env.example` / `.env.prod.example` — **VERIFIED ONLY, not modified**

### Decisions

**D-12 — the log-once mechanism is `isEnabledOrLogOnce()`, copied in shape from `sessions.service.ts:427-438`,** per RISK-R. A private method that returns the boolean _and_ owns the flag: no call site can forget the check and no call site can log twice. Neither failure is expressible.

**D-13 — a non-JSON 2xx body maps to `malformed_response`, not `unavailable`.** The spec lists "unparseable JSON" among the paths that must fold into an `ok: false` arm but does not say which. Both are defensible; "we reached YouTube and its answer made no sense" is more precise than "we could not reach YouTube", and it matches what the Zod branch says for the same class of defect one layer in. Task 9.12 maps them to different admin messages, so the distinction is not academic. My first draft got this wrong — the JSON parse sat inside the outer `catch` and produced `unavailable` — and I moved it into its own `try` with a comment recording the reasoning.

**D-14 — upstream text is redacted before logging, not merely omitted from the result.** NFR-S7 only requires that the raw body never reach the caller. I additionally pass every logged string through a `redact()` that replaces the API key with `[REDACTED]`. Google does not echo the key in an error body today; this exists so that "the key is in no log line" does not depend on an upstream service's discretion. The request URL is never logged at all, because the key is a query parameter on it — asserted.

**D-15 — `YoutubeModule` is not `@Global()` and does not import `ConfigModule`.** Two consumers import it explicitly, which is what keeps "which modules can reach YouTube" answerable by reading imports — precisely the question NFR-P6 asks. `ConfigModule.forRoot({ isGlobal: true })` is registered by the app, so re-importing it in a library module would let this lib carry its own configuration posture.

**D-16 — the barrel exports `VIDEO_ID_PATTERN` but not `youtube.schemas.ts` or `resolveThumbnailUrl`.** Exactly as specified, with the reasons in the barrel docblock.

### `.env` verification — actual output (nothing was added)

```
$ grep -n "YOUTUBE_API_KEY" .env.example .env.prod.example
.env.example:285:YOUTUBE_API_KEY=
.env.prod.example:76:YOUTUBE_API_KEY=CHANGE_ME_youtube_data_api_v3_key

$ for f in .env .env.example .env.prod.example; do grep -c "^YOUTUBE_API_KEY" $f; done
1
1
1
```

Present at the documented lines, **exactly one occurrence each** — I checked the count as well as the presence, because a duplicate key silently keeps the last one. Batch 5's work is discharged; nothing re-added.

### Verification — actual output

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-youtube --skip-nx-cache

> nx run api-youtube:"eslint:lint"   > eslint .
> nx run api-youtube:typecheck       > npx tsc --noEmit --project libs/api/youtube/tsconfig.lib.json
> nx run api-youtube:test

Test Suites: 4 passed, 4 total
Tests:       119 passed, 119 total
Time:        7.41 s

 NX   Successfully ran targets eslint:lint, typecheck, test for project api-youtube
```

Zero lint warnings (an interim run had 14 `no-non-null-assertion` warnings from the spec fixtures; replaced with a throwing `firstItem()` helper, which also fails loudly if a future edit empties the fixture rather than silently mutating nothing).

**The required cases, all present and green:**

| Required                                                           | Where                                                                                                                                                                                                                    |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| one per §4.4 row                                                   | `describe('the §4.4 outcome table')` + `describe('success')`                                                                                                                                                             |
| disabled ⇒ `{ ok:false, skipped:true }`                            | `returns { ok: false, skipped: true } and makes NO request` — also asserts `fetch` was never called                                                                                                                      |
| **exactly one log line across two calls**                          | `logs the disabled notice EXACTLY ONCE across two calls` — actually runs **three** calls, two with the same id and one with a different id                                                                               |
| timeout ⇒ `unavailable`, aborted at 10 s                           | `aborts at exactly 10,000 ms and returns unavailable` — fake timers; asserts the captured `AbortSignal` is **not** aborted at 9,999 ms and **is** aborted at 10,000 ms                                                   |
| a 403 quota body ⇒ `unavailable` + `status: 403`, no upstream text | `a 403 quota body => ...` — asserts the serialised result contains neither `UNIQUE_UPSTREAM_MARKER_9f3a2b` nor `quotaExceeded` nor `quota`                                                                               |
| the api key appears in no logger argument                          | `the api key appears in no logger argument, even when upstream echoes it` — stubs a 400 whose body _contains_ the key, then asserts every `Logger.log`/`Logger.warn` argument excludes it and that `[REDACTED]` appeared |
| `unlisted` succeeds                                                | `accepts privacyStatus "unlisted" — the Checkpoint-0 delivery model`                                                                                                                                                     |

Beyond the required set: a `surfaces no fabricated upstream error text in ANY error arm` case sweeping four different arms with one marker; `never logs the request URL`; `never puts the api key in a successful result`; `clears the timer on a fast success` (asserts `jest.getTimerCount() === 0`, so the abort timer cannot hold the process open); and `never throws, for any upstream behaviour` over six hostile behaviours including a non-`Error` rejection and a 204.

---

<a name="task-94"></a>

## Task 9.4 — Prisma schema: the five course models ✅

### File

`D:\projects\ptah-extension\apps\ptah-license-server\prisma\schema.prisma` (MODIFIED)

### What landed

The five models **verbatim from §1.4** — every `@@index`, every `@@unique`, every `onDelete`, and **all three rejection comments** carried in word for word:

- `@@unique([courseId, sortOrder])` **deliberately not declared** (R8.8 bulk reorder)
- `@@index([lessonId])` on `LessonProgress` **REJECTED**, including the sentence about enforcing NFR-S4/R2.3.7 **by shape** — there is no efficient way to ask "who else completed this lesson", so no member endpoint accidentally can
- `LessonComment` is a **DISTINCT model**, never polymorphic with `Post`

`LessonProgress` has the composite PK and no surrogate id. `userId` and `authorId` are `@db.Uuid`.

### Decisions

**D-17 — TWO `User` back-relations were added, not four.** The task text says "exactly four", shows two lines, and then instructs me to count what §1.4 actually requires and state the number. §1.4's five models name `User` in exactly two relation fields — `LessonProgress.user` and `LessonComment.author` — so **two** is correct:

```prisma
lessonProgress   LessonProgress[]
lessonComments   LessonComment[]  @relation("LessonCommentAuthor")
```

`Course.createdBy`, `LessonComment.answeredBy` and `LessonComment.deletedBy` are **plain `String?` columns, not relations** — they record who acted for audit display and deliberately carry no FK. I recorded that in the comment above the pair, because it is the most likely thing for a later reader to "fix". The Phase-5 `notifications`/`actedNotifications` pair was held back for 6A's D-7 reason: it names a model that does not exist and would not validate.

**D-18 — appended after the last model, under a banner, no interleaving** — which is what keeps the diff at two hunks with zero incidental reformatting.

**D-19 — the banner carries two warnings, not one.** The required one (the trigram index exists only in SQL and a later migration can silently drop it) plus the RISK-O unit banner — see [RISK-O](#risk-o).

### Verification — actual output

```
$ cd apps/ptah-license-server && DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" npx prisma validate --schema prisma/schema.prisma

Loaded Prisma config from prisma.config.ts.
Prisma schema loaded from prisma\schema.prisma.
The schema at prisma\schema.prisma is valid 🚀
```

```
$ git diff --stat apps/ptah-license-server/prisma/schema.prisma
 apps/ptah-license-server/prisma/schema.prisma | 211 ++++++++++++++++++++++++++
 1 file changed, 211 insertions(+)
```

```
$ git diff -U0 apps/ptah-license-server/prisma/schema.prisma | grep -E "^@@|^-[^-]"
@@ -50,0 +51,17 @@ model User {
@@ -484,0 +502,194 @@ model TopicReadState {
```

**Two hunks, zero deletions**, exactly as specified. No migration folder was created by this task and no `prisma migrate` command was run in it.

> Method note: my first attempt to append the block used a bash heredoc, which aborted on an apostrophe inside the `@@index([lessonId])` rejection comment (`"this member's progress"`). It failed **before writing anything** — verified with `git diff --stat`, which still showed only the 17-line `User` hunk — and I re-did the append with the `Edit` tool. Recording it because a partially-written schema would have been an easy thing to miss.

---

<a name="task-95"></a>

## Task 9.5 — Migration 3: `20260819090000_courses` ✅

### File

`D:\projects\ptah-extension\apps\ptah-license-server\prisma\migrations\20260819090000_courses\migration.sql` (NEW, 213 lines, 9251 bytes)

### Step 1 — privilege pre-flight, run BEFORE writing anything

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select current_user, rolsuper from pg_roles where rolname = current_user;"
ptah|t

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select extname from pg_extension where extname='pg_trgm';"
pg_trgm

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select table_name from information_schema.tables where table_name in ('courses','course_modules','course_lessons','lesson_progress','lesson_comments') order by 1;"
(no rows)

$ docker exec ptah_postgres psql -U ptah -d ptah_db -tAc "select version();"
PostgreSQL 16.13 on x86_64-pc-linux-musl, compiled by gcc (Alpine 15.2.0) 15.2.0, 64-bit
```

Matches the stated expectation exactly: `ptah|t` · `pg_trgm` already installed by migration 2 (so this migration does **not** re-`CREATE EXTENSION`) · no pre-existing course tables.

**Baseline captured before touching anything**, so the "did it behave like a diff or like a reset" question has a before as well as an after:

```
$ select (select count(*) from community_categories), (select count(*) from community_topics), (select count(*) from community_posts);
4|9|10

$ select license_key, plan, status from licenses where license_key like 'DEV-%';
DEV-BUILDERS-VALIDATION-0001|builders|active

$ select count(*) from member_group_assignments;
0
```

**Production was NOT verified this session.** The production `DATABASE_URL` is not in this workspace. Because the container CMD is `prisma migrate deploy && node main.cjs`, a migration that cannot apply in production is a **process that never starts**. Re-run the privilege and extension checks against production before the deploy that carries this migration. This is a **pre-deploy gate, not a passed check** — same status 6A gave it.

### Step 2 — RISK-K re-verified independently (it remains CLOSED)

The instruction was to re-run the comparison anyway. I compared all 18 recorded checksums against `sha256sum` of their files:

```
OK    20260125093705_init
OK    20260125133600_add_workos_fields
OK    20260126192229_add_trial_end
OK    20260127112300_add_failed_webhooks
OK    20260127170000_add_paddle_customer_id_to_user
OK    20260205173347_add_trial_reminder
OK    20260228222255_add_session_requests
OK    20260423_admin_panel_enhancements
OK    20260607000000_seed_marketing_templates
OK    20260719120000_add_waitlist
OK    20260719140000_remove_legacy_pro_trial_add_circle
OK    20260719160000_add_member_groups
OK    20260724120000_seed_marketing_templates_v2
OK    20260801120000_add_packs
OK    20260801170000_add_member_group_session_event
OK    20260805090000_drop_discourse_group
OK    20260806000000_fix_founding_invite_offer_copy
OK    20260812090000_community_forum
=== MISMATCH FLAG: 0 (0 = all match, RISK-K stays closed) ===
```

**18/18 match.** RISK-K is closed, verified in this session rather than inherited.

### Step 3 — generate the DDL (the safer habit)

Used `migrate diff` rather than `migrate dev --create-only`, per the dispatch instruction:

```
$ cd apps/ptah-license-server && DATABASE_URL="postgresql://ptah:ptah_dev_password@localhost:5432/ptah_db" \
    npx prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script
exit=0
```

**C-2 confirmed live.** Prisma 7 wrote its dotenv banner to **stdout**, ahead of the script:

```
$ head -1 raw_diff.txt | cat -A
M-bM-^WM-^G injected env (0) from .env // tip: M-bM-^WM-^H encrypted .env [www.dotenvx.com]$
```

(`Loaded Prisma config from prisma.config.ts.` went to **stderr** and is harmless.) Stripped, and the assembled file's first SQL line is `-- CreateTable` at line 41, after the header comment block.

C-1 was not re-triggered — I used the correct Prisma 7 flags from the outset.

### Step 4 — reading the generated SQL BEFORE applying it 🔴

```
$ grep -c "^CREATE TABLE" raw_diff.txt
5

$ grep -nE "^(ALTER|DROP)" raw_diff.txt | grep -v "ADD CONSTRAINT"
2:-- DropIndex
3:DROP INDEX "community_posts_body_trgm";
5:-- DropIndex
6:DROP INDEX "community_topics_title_trgm";
```

**Two unrelated `DROP INDEX` statements.** See [Finding 1](#finding-1) for the full analysis — they are migration 2's live, correct trigram indexes, proposed for deletion because Prisma cannot express `gin_trgm_ops` and the diff therefore reads them as unwanted. Applying them would have been a **silent** performance regression: search keeps returning correct results by sequential scan.

**I removed both**, kept everything else, and documented the removal in a 40-line header inside `migration.sql` that names the exact statements, explains why they are not drift, and warns that migrations 4 and 5 will each see **three** proposed drops.

Post-assembly audit of the actual migration file:

```
$ grep -c "^CREATE TABLE" .../migration.sql
5
$ grep -nE "^(ALTER|DROP)" .../migration.sql | grep -v "ADD CONSTRAINT"
(none)
$ grep -c "ADD CONSTRAINT" .../migration.sql
7
$ grep -c "^CREATE.*INDEX" .../migration.sql
8
```

Five tables · 8 indexes (7 generated + the hand-written trigram) · 7 FK constraints · **zero** unrelated `ALTER`/`DROP`.

### Step 5 — the hand-written block

Below a `-- ---` separator, with a comment block stating: the index is invisible to Prisma's model; `migrate diff` will never mention it and **will** propose to drop it; the generated SQL of every subsequent migration must be read; and that losing it is a _silent performance_ failure rather than an error. Also records why `pg_trgm` is **not** re-created (migration 2 already did; a no-op line that claims to do something is worse than its absence) and the privilege caveat.

```sql
CREATE INDEX "course_lessons_title_trgm" ON "course_lessons" USING gin (title gin_trgm_ops);
```

**Not** wrapped in a `DO $$ … EXCEPTION` block, per RISK-H's explicit instruction, with the reason recorded in the file.

### Step 6 — apply and regenerate

```
$ npx prisma migrate deploy
19 migrations found in prisma/migrations
Applying migration `20260819090000_courses`
The following migration(s) have been applied:
migrations/
  └─ 20260819090000_courses/
    └─ migration.sql
All migrations have been successfully applied.

$ npx prisma generate
✔ Generated Prisma Client (7.7.0) to .\..\..\libs\api\core\src\lib\generated-prisma-client in 240ms
```

**`prisma migrate reset`, `prisma db push` and `prisma migrate dev` were NOT run.**

### 🔴 THE SIX VERIFICATION OUTPUTS, VERBATIM

**V1 — `npx prisma migrate status`**

```
Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

19 migrations found in prisma/migrations

Database schema is up to date!
```

**V2 — the five tables**

```
course_lessons
course_modules
courses
lesson_comments
lesson_progress
```

**V3 — the trigram `indexdef`** (not just the name — an index that merely carries the name is not a GIN index with `gin_trgm_ops`)

```
CREATE INDEX course_lessons_title_trgm ON public.course_lessons USING gin (title gin_trgm_ops)
```

**V4 — the dev entitlement**

```
DEV-BUILDERS-VALIDATION-0001|builders|active
```

**V5 — Batch 8's seed** (`categories | topics | posts`)

```
4|9|10
```

**V6 — health**

```
200
```

All six match the expected result: up to date and nothing pending · **five** tables · a GIN index with `gin_trgm_ops` · the dev license intact · `4|9|10` · `200`.

### 🔴 The extra check that matters most: migration 2's indexes survived

This is the proof that stripping the two `DROP INDEX` lines worked, and it is the check that would have caught the failure had I missed it:

```
$ select indexname from pg_indexes where indexname like '%_trgm' order by indexname;
community_posts_body_trgm
community_topics_title_trgm
course_lessons_title_trgm

$ select indexdef from pg_indexes where indexname like '%_trgm' order by indexname;
CREATE INDEX community_posts_body_trgm ON public.community_posts USING gin (body_markdown gin_trgm_ops)
CREATE INDEX community_topics_title_trgm ON public.community_topics USING gin (title gin_trgm_ops)
CREATE INDEX course_lessons_title_trgm ON public.course_lessons USING gin (title gin_trgm_ops)
```

**All three present, all three genuinely GIN with `gin_trgm_ops`.**

The recorded checksum matches the file on disk, so the migration is not born drifted:

```
$ select checksum from _prisma_migrations where migration_name='20260819090000_courses';
c70d6a0eb30f131a2d455cbba52bd09a1d3e6dfeac5d12627fbb9fb5cb47b1c3
$ sha256sum .../migration.sql
c70d6a0eb30f131a2d455cbba52bd09a1d3e6dfeac5d12627fbb9fb5cb47b1c3
```

### The `EXPLAIN` check, and why the unforced half is uninformative

`course_lessons` holds **0 rows**. As instructed, I report the unforced plan as **uninformative — neither a pass nor a failure**:

```
$ explain select id from course_lessons where title ilike '%intro%';
Seq Scan on course_lessons  (cost=0.00..12.75 rows=1 width=32)
  Filter: (title ~~* '%intro%'::text)
```

At 0 rows the planner **correctly** prefers a sequential scan, and it would print this same output whether the index existed, had the wrong operator class, or had been dropped. It will still be uninformative after Batch 11, which brings `course_lessons` to 8 rows. It needs thousands of rows to mean anything.

The forced form does carry information:

```
$ set enable_seqscan = off; explain select id from course_lessons where title ilike '%intro%';
Bitmap Heap Scan on course_lessons  (cost=17.41..21.42 rows=1 width=32)
  Recheck Cond: (title ~~* '%intro%'::text)
  ->  Bitmap Index Scan on course_lessons_title_trgm  (cost=0.00..17.41 rows=1 width=0)
        Index Cond: (title ~~* '%intro%'::text)
```

The planner **can** use `course_lessons_title_trgm` for an `ILIKE '%…%'` predicate — which is the property A-7 actually depends on, and the one a name check cannot establish.

---

<a name="task-96"></a>

## Task 9.6 — Scaffold `libs/api/learning` + ARM its two structural specs ✅

### Files created

- `D:\projects\ptah-extension\libs\api\learning\project.json`
- `D:\projects\ptah-extension\libs\api\learning\package.json`
- `D:\projects\ptah-extension\libs\api\learning\eslint.config.mjs`
- `D:\projects\ptah-extension\libs\api\learning\jest.config.cts`
- `D:\projects\ptah-extension\libs\api\learning\tsconfig.json` / `.lib.json` / `.spec.json`
- `D:\projects\ptah-extension\libs\api\learning\README.md`
- `D:\projects\ptah-extension\libs\api\learning\src\index.ts`
- `D:\projects\ptah-extension\libs\api\learning\src\testing\mock-learning-prisma.ts`
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\soft-delete-filter.spec.ts`
- `D:\projects\ptah-extension\libs\api\learning\src\lib\common\nullable-dto.spec.ts`

### Files modified

- `D:\projects\ptah-extension\tsconfig.base.json` (one line — the batch's second edit to it)

### Decisions

**D-20 — the AD-5 decision, implemented as specified: own copies, re-rooted, not a widened forum spec.** Both files carry the three reasons in their docblocks, **and the counter-argument** (two analysers can drift, and a fix to one will not reach the other) with a one-line pointer at the sibling in each — so a reader of either knows the other exists. The forum specs were left completely untouched.

**D-21 — `SOFT_DELETABLE_MODELS` is four, and `SOFT_DELETABLE_RELATIONS` includes the BACK-relations.** `course`, `courseModule`, `lesson`, `lessonComment` all carry `deletedAt`; `lessonProgress` does not and is deliberately excluded (spreading the filter there is a compile error, not a safety improvement — there is a negative-control probe on it). For relations I included both directions: forward (`modules`, `lessons`, `comments`, `children`) **and back** (`course`, `module`, `lesson`, `parent`). The back-relations matter and forum had no equivalent: `lesson.findFirst({ include: { module: { include: { course: true } } } })` is the natural way to build a breadcrumb and happily returns a lesson whose **course** is soft-deleted. There is a probe on exactly that shape, asserting **two** violations from it.

**D-22 — `RULE-UNIQUE`'s probe uses the composite-unique shape, not an id.** The spec flags that `findUnique` is more tempting here than in forum because `Lesson` and `CourseModule` have natural composite uniques. The probe is therefore `lesson.findUnique({ where: { moduleId_slug: { moduleId, slug } } })` — the shape this lib will actually be tempted to write — rather than the `{ id }` shape forum used. The failure message names the two `@@unique` declarations.

**D-23 — `optional-field.ts` was NOT created, and the decision is recorded in the tree rather than only here.** Task 9.6 settles _where_ `IsOptionalNotNull` lives (re-declared in `libs/api/learning/src/lib/common/optional-field.ts`, not imported from forum, because widening forum's barrel for two decorators is a worse trade than ~20 duplicated lines — and forum's `common/` being non-exported is load-bearing for `NOT_DELETED`). It is not in 9.6's file list and nothing in 9A needs it: the spec references the decorator by **name**, as a string used in failure messages. Creating an unused decorator file would be scope creep into 9B/9C. **I put the full decision, with its reasoning, in `nullable-dto.spec.ts`'s docblock** — which is where the person writing the first DTO will actually look — rather than only in this report.

**D-24 — the Prisma double is lib-local, exactly as specified.** `src/testing/mock-learning-prisma.ts`, following `mock-forum-prisma.ts`: excluded by `tsconfig.lib.json`, type-checked by `ts-jest` under `tsconfig.spec.json`, **not** barrel-exported, with a working callback-variant `$transaction` stub. `LEARNING_MODEL_KEYS` is the five course models plus `user` (the batched author-name lookup on a comment thread) and `memberGroup` (the `cohortKeys` write-time validation). I confirmed the reason for going lib-local rather than inheriting it: `mock-prisma.factory.spec.ts:51` does assert `MODEL_KEYS` by exact equality, so extending the shared factory would turn `api-core:test` red. `libs/api/core` was not touched. The shared factory's stale "every model in schema.prisma" docblock claim is noted in the new file as a follow-up that is not this batch's.

**D-25 — the anti-vacuity assertion the forum spec uses could not be copied, so it was replaced rather than dropped.** `nullable-dto.spec.ts` in forum asserts `DTO_FILES.length >= 10` and `ALL_PROPERTIES.length >= 30`. Neither can be written here without being a lie. I replaced both with (a) the loader assertion (`LIB_ROOT.endsWith('src/lib')` and `dirs` contains `common`), and (b) a **parser-is-wired** probe that runs a fabricated DTO through the real `propertiesOf()` and asserts it finds the decorated properties and their declared types — which guards the specific failure where a TypeScript API change makes `getDecorators()` return nothing and every assertion goes green on an empty set. `soft-delete-filter.spec.ts` got the loader assertion plus a `scanned` count that is visible in output without being a false claim.

**D-26 — `EXPECTED_EXEMPTIONS` and `EXPECTED_NULLABLE_OPTIONALS` are both `[]`,** and both docblocks say they should still be `[]` at the end of Batch 9, with the reason (§3.4's admin table has no `?includeDeleted` read) and the escape route if a restore appears (forum's D-6.13d: put the restore window inside the `UPDATE`'s own `WHERE`, so `updateMany().count` _is_ the outcome and no tombstone read exists). There is a legal probe on that exact shape, so it is on record as permitted before anyone writes it.

**D-27 — the `RULE-FILTER` known limit is pinned by a test, not just a comment.** Batch 6's carried item 5 notes that `RULE-FILTER` checks for a _mention_ of the constant, not an effect, so an `OR` whose other branch is wider passes while filtering nothing. I carried the sentence into the docblock **and** added a test asserting the limit, so it is discovered by reading the suite rather than by shipping the bug.

### Verification — actual output

```
$ npx nx reset && npx nx show project api-learning

{"root":"libs/api/learning",
 "targets":{"eslint:lint":{...},"test":{...},"typecheck":{...}},
 "name":"api-learning",
 "tags":["npm:private","scope:api","type:feature"],
 "metadata":{"js":{"packageName":"@ptah-api/learning","packageVersion":"0.0.1",...}},
 "sourceRoot":"libs/api/learning/src","projectType":"library"}
```

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-learning --skip-nx-cache

Test Suites: 2 passed, 2 total
Tests:       32 passed, 32 total
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-learning
```

Both structural specs green on their probe blocks, zero boundary violations.

> Ground-truth item 17 did occur here: `npx nx show project api-learning` failed once with a stale graph. `npx nx reset` fixed it, as documented. Not a scaffolding error.

---

### 🔴 PROOF BY DELIBERATE FAILURE #1 — `soft-delete-filter.spec.ts`

**Step A — staged a real throwaway service** at
`libs/api/learning/src/lib/courses/tmp-proof.service.ts`, containing a real
`this.prisma.lesson.findMany({ where: { moduleId } })`.

**Step B — the spec FAILED, and named the file by path:**

```
$ npx nx test api-learning --skip-nx-cache --testPathPatterns="soft-delete-filter"

FAIL api-learning libs/api/learning/src/lib/common/soft-delete-filter.spec.ts
  ● AD-5 — every member read in api-learning filters soft-deleted rows › the real source tree › has no unfiltered read

    expect(received).toEqual(expected) // deep equality
    - Expected  - 1
    + Received  + 3
    - Array []
    + Array [
    +   "RULE-FILTER: courses/tmp-proof.service.ts: lesson.findMany() does not spread
    +    `NOT_DELETED` in its `where`, so it returns SOFT-DELETED rows (AD-5). Its `where`
    +    never mentions the constant — note that a literal `{ deletedAt: null }` is NOT
    +    accepted, on purpose: one greppable identifier is the whole point. Add
    +    `...NOT_DELETED`, or add \"// AD-5-EXEMPT: <reason>\" on the line above and list
    +    it in EXPECTED_EXEMPTIONS.",
    + ]

      at src/lib/common/soft-delete-filter.spec.ts:497:68

Test Suites: 1 failed, 1 total
Tests:       1 failed, 20 passed, 21 total
```

The failure names the **real file by path** (`courses/tmp-proof.service.ts`), so the loader, the directory walk and the analysis are all proven **on the real tree** — not just on fabricated strings.

**Step C — file deleted, reverted GREEN:**

```
$ rm -rf libs/api/learning/src/lib/courses
$ npx nx test api-learning --skip-nx-cache --testPathPatterns="soft-delete-filter"
 NX   Successfully ran target test for project api-learning

$ find libs/api/learning/src -type f | sort
libs/api/learning/src/index.ts
libs/api/learning/src/lib/common/nullable-dto.spec.ts
libs/api/learning/src/lib/common/soft-delete-filter.spec.ts
libs/api/learning/src/testing/mock-learning-prisma.ts
```

The `courses/` directory was removed with the file; nothing remains.

---

### 🔴 PROOF BY DELIBERATE FAILURE #2 — `nullable-dto.spec.ts`

**Step A — staged a real throwaway DTO** at
`libs/api/learning/src/lib/courses/dto/tmp-proof.dto.ts`, carrying
`@IsOptional() @IsString() name?: string`.

**Step B — the spec FAILED, and BOTH halves fired** — the rule _and_ the census:

```
$ npx nx test api-learning --skip-nx-cache --testPathPatterns="nullable-dto"

● F-2 … › the structural rule over every DTO in the lib › no @IsOptional() sits on a field whose type cannot be null

    - Array []
    + Array [
    +   "courses/dto/tmp-proof.dto.ts:name is declared `string` — which cannot be null —
    +    but carries @IsOptional(), and class-validator's @IsOptional() skips validation
    +    for null AS WELL AS undefined. An explicit {\"name\": null} therefore passes every
    +    other validator on this property untouched and throws below the DTO as an
    +    unhandled exception — a 500 on a request that should be a 400 (NFR-S7,
    +    TASK_2026_177 F-2). Use @IsOptionalNotNull() instead, or declare the type
    +    nullable and list it in EXPECTED_NULLABLE_OPTIONALS.",
    + ]
      at src/lib/common/nullable-dto.spec.ts:214:65

● F-2 … › takes exactly the nullable optionals enumerated in the census

    - Array []
    + Array [
    +   "courses/dto/tmp-proof.dto.ts:name",
    + ]
      at src/lib/common/nullable-dto.spec.ts:224:22

Test Suites: 1 failed, 1 total
Tests:       2 failed, 9 passed, 11 total
```

Both assertions name the property by path. That **two** tests failed rather than one is the census mechanism working: even if someone "fixed" the violation by declaring the type nullable, the census would still refuse it until it is typed into a list a reviewer reads.

**Step C — file deleted, reverted GREEN (full gate):**

```
$ rm -rf libs/api/learning/src/lib/courses
$ npx nx run-many -t eslint:lint,typecheck,test -p api-learning --skip-nx-cache

Test Suites: 2 passed, 2 total
Tests:       32 passed, 32 total
 NX   Successfully ran targets eslint:lint, typecheck, test for project api-learning

$ find libs/api/learning/src -type f | sort
libs/api/learning/src/index.ts
libs/api/learning/src/lib/common/nullable-dto.spec.ts
libs/api/learning/src/lib/common/soft-delete-filter.spec.ts
libs/api/learning/src/testing/mock-learning-prisma.ts
```

**Neither spec was ever trusted without being seen to fail.**

---

<a name="risk-q"></a>

## RISK-Q — verified in the tree, not inherited

**The census, re-run rather than assumed:**

```
$ for p in core identity audit membership; do printf "%s: " "$p"; grep -o '"tags":[^]]*]' libs/api/$p/project.json; done
core:       "tags": ["scope:api", "type:util"]
identity:   "tags": ["scope:api", "type:util"]
audit:      "tags": ["scope:api", "type:util"]
membership: "tags": ["scope:api", "type:util"]
```

**The rule, read from `eslint.config.mjs:201-203`:**

```js
{
  sourceTag: 'type:util',
  onlyDependOnLibsWithTags: ['type:util'],
},
```

**Finding A — the tag permits reaching `api-core`.** All four candidate libs are `["scope:api","type:util"]`, so a `type:util` source may depend on any of them. `type:util` is _not_ a dead end here. The plan is right and `api-youtube` keeps `type:util`.

**Finding B — and nothing needed it.** `api-youtube` imports nothing from `libs/api/*`. Verified two ways:

```
$ grep -rhoE "from '[^']+'" libs/api/youtube/src --include="*.ts" | sort -u
from './extract-video-id'      from './lib/extract-video-id'
from './lib/parse-iso8601-duration'   from './lib/youtube-metadata.provider'
from './lib/youtube.module'    from './lib/youtube.types'
from './parse-iso8601-duration'  from './youtube-metadata.provider'
from './youtube.schemas'       from './youtube.types'
from '@nestjs/common'
from '@nestjs/config'
from 'zod'
```

Every non-relative import is an **npm package**: `@nestjs/common` (`Logger`, `Injectable`, `Inject`, `Module`), `@nestjs/config` (`ConfigService`), and `zod`. All three are outside the Nx tag graph entirely — exactly how `GoogleAuthProvider` is built. The three `@ptah-api/` hits in a `grep` are **docblock prose**, not imports.

Confirmed independently by the Nx graph:

```
api-youtube  -> []
api-learning -> ["api-core"]
api-youtube tags:  ["npm:private","scope:api","type:util"]
api-learning tags: ["npm:private","scope:api","type:feature"]
```

**`api-youtube` has ZERO workspace dependencies.** `api-learning`'s single `api-core` edge comes from `mock-learning-prisma.ts` importing `PrismaService`; `api-core` is `type:util` and `api-learning` is `type:feature`, which permits it. `eslint:lint` passes on both, so `@nx/enforce-module-boundaries` agrees.

**Both findings are stated in `libs/api/youtube/README.md`**, so the next reader does not re-litigate this.

---

<a name="risk-o"></a>

## RISK-O — what I did about the unit naming in the schema

The constraint is that §1.4's models are to be carried **verbatim**, so renaming columns was not on the table — and the existing names already carry the unit suffix (`furthestPositionSeconds`, `videoDurationSeconds`). The gap those names do **not** close is that the third unit — the percentage — has **no column at all**, and is derived from lesson _counts_, not seconds. That is the part a schema reader cannot infer.

What landed in `schema.prisma`:

1. **A `🔴 RISK-O` banner above the whole Phase-3 block**, naming all three units explicitly, saying where each lives, and stating that the percentage deliberately has no column and must never be computed from a sum of seconds. It ends with the operational consequence: (1) and (2) are both `Int` and both end in `Seconds`, so swapping the operands of `furthest >= 0.9 * duration` yields a plausible boolean rather than a compile error — which is why the comparison belongs in exactly one named file (`progress/completion.ts`) and never as a bare `* 0.9` at a call site. It names the `postCount` / `lastReadPostNumber` precedent as the same class of defect.
2. **A per-field note on `Lesson.videoDurationSeconds`**: "A DURATION IN SECONDS, NOT A POSITION", plus ASSUMPTION-8's meaning of the `null`.
3. **A per-field note on `LessonProgress.furthestPositionSeconds`**: "A POSITION IN SECONDS, NOT A DURATION", plus the fact that it is compared against a same-typed different quantity.

The same three-unit warning is repeated in `libs/api/learning/README.md`, and `YouTubeVideoMetadata.durationSeconds` in `youtube.types.ts` carries it too — because that is where the number is born.

**Independent confirmation**: `member-course.contract.ts` (which already exists — see Finding 3) documents `ContinueLearning.percent` as _"DERIVED from the two counts above"_, with `totalLessons: 0` yielding `0` and never `NaN`. The counts-not-seconds rule is already fixed on the wire, which makes the schema banner consistent with the contract rather than merely asserted.

**Handed to Task 9.13**: [Finding 4](#findings) — the `PT0S` zero-duration case, which reproduces the zero-threshold bug through a route ASSUMPTION-8 does not cover.

---

<a name="assumption-6"></a>

## ASSUMPTION-6 — stated plainly

**No real YouTube request was made by this batch, and none could be.** `.env:259` reads `YOUTUBE_API_KEY=` with no value, so `isEnabled()` is `false` in this workspace and the feature-off branch is the live path.

**What I did instead**: every §4.4 outcome is asserted against a **stubbed `fetch`** (`jest.spyOn(globalThis, 'fetch')`), and the success case's stub body is a **real `videos.list` response pasted verbatim** into both `youtube.schemas.spec.ts` and `youtube-metadata.provider.spec.ts` — carrying the ~18 fields the schema does not read (`kind`, `etag`, `pageInfo`, `publishedAt`, `channelId`, `standard`/`maxres` thumbnails, `dimension`, `licensedContent`, `uploadStatus`, `madeForKids`, …). That matters: a fixture invented to satisfy the schema would carry only the eight named fields and would pass whether or not Zod strips unknown keys. The pasted one proves stripping works, which is the property that stops every additive change YouTube ships from becoming a `malformed_response`.

The stubs use real `Response` objects (`new Response(JSON.stringify(body), { status })`) rather than hand-rolled shapes, so `response.ok`, `response.json()` and `response.text()` behave as they will in production.

The fixture is duplicated across the two spec files rather than shared, because the spec asks for it "pasted into the spec" in both places and a cross-import between spec files would register one file's `describe` blocks twice.

**The one-line way to overrule this**: put a real Data API v3 key in `.env`, and have Task 9.12 add one live `V-CURL` against a known unlisted video id. One line of `.env`, one extra check.

---

<a name="wider-verification"></a>

## Wider verification — nothing else broke

`tsconfig.base.json` is a global Nx input and `prisma generate` rewrote the client that `libs/api/core` exports, so both changes reach far. I ran my whole territory explicitly (never `nx affected`, always `--skip-nx-cache`):

```
$ npx nx run-many -t typecheck -p api-youtube,api-learning,api-forum,api-contracts-community,
    api-core,api-member-hub,api-membership,api-community,api-admin,api-audit,api-identity,
    api-licensing,api-billing,api-marketing,api-email,ptah-license-server --skip-nx-cache

 NX   Successfully ran target typecheck for 16 projects
```

The batch gate:

```
$ npx nx run-many -t eslint:lint,typecheck,test -p api-youtube,api-learning,ptah-license-server --skip-nx-cache

 (api-youtube)          Tests: 119 passed, 119 total
 (api-learning)         Tests:  32 passed,  32 total
 (ptah-license-server)  Tests: 111 passed, 111 total   (5 suites)

 NX   Successfully ran targets eslint:lint, typecheck, test for 3 projects
```

Downstream test suites:

```
$ npx nx run-many -t test -p api-forum,api-core,api-contracts-community,api-member-hub --skip-nx-cache

 (api-core)                 23 passed
 (api-contracts-community)  12 passed
 (api-forum)               505 passed (21 suites)
 (api-member-hub)           72 passed  (6 suites)

 NX   Successfully ran target test for 4 projects
```

`api-forum:test` failed once on the first attempt at this command with no test-level output, and passes on every subsequent run — see [Finding 7](#findings). Nothing in this batch touches `libs/api/forum`.

Server still healthy and migrations still clean at the end of the batch:

```
$ curl -s -o /dev/null -w '%{http_code}\n' http://localhost:3000/api/health
200

$ npx prisma migrate status
19 migrations found in prisma/migrations
Database schema is up to date!
```

---

<a name="final-git-status"></a>

## Final `git status --porcelain`, annotated

```
 M apps/ptah-license-server/prisma/schema.prisma            ← MINE (Task 9.4)
 M libs/backend/rpc-handlers/.../tasks-rpc.handlers.spec.ts ← FOREIGN
 M libs/backend/rpc-handlers/.../tasks-rpc.handlers.ts      ← FOREIGN
 M libs/backend/rpc-handlers/.../tasks-rpc.schema.ts        ← FOREIGN
 M libs/backend/task-specs/.../task-writer.conflict.integration.spec.ts ← FOREIGN
 M libs/shared/src/lib/types/rpc.types.ts                   ← FOREIGN
 M libs/shared/src/lib/types/rpc/rpc-tasks.types.ts         ← FOREIGN
 M libs/shared/src/lib/types/task-view.types.ts             ← FOREIGN
 M tsconfig.base.json                                       ← MINE (Tasks 9.1 + 9.6, two lines)
?? apps/ptah-license-server/prisma/migrations/20260819090000_courses/  ← MINE (Task 9.5)
?? libs/api/learning/                                       ← MINE (Task 9.6)
?? libs/api/youtube/                                        ← MINE (Tasks 9.1–9.3)
```

### Mine — 5 entries

`apps/ptah-license-server/prisma/schema.prisma` · `tsconfig.base.json` ·
`apps/ptah-license-server/prisma/migrations/20260819090000_courses/` ·
`libs/api/learning/` · `libs/api/youtube/`

**32 files** in total (9 for `api-youtube` scaffold+core+provider, 13 for `api-learning`, 1 migration, plus the two modified files). No `.tmp` files, no `tmp-proof` files, no stray directories — verified:

```
$ find libs/api/youtube libs/api/learning .../20260819090000_courses -name "*.tmp" -o -name "tmp-proof*"
(no output)
```

**`tsconfig.base.json` carries exactly my two lines and nothing else:**

```diff
       "@ptah-api/membership": ["./libs/api/membership/src/index.ts"],
+      "@ptah-api/youtube": ["./libs/api/youtube/src/index.ts"],
       "@ptah-api/member-hub": ["./libs/api/member-hub/src/index.ts"],
       "@ptah-api/forum": ["./libs/api/forum/src/index.ts"],
+      "@ptah-api/learning": ["./libs/api/learning/src/index.ts"],
       "@ptah-api/community": ["./libs/api/community/src/index.ts"],
```

I re-read the file immediately before each of the two edits; the concurrent process did not touch it at any point.

### Foreign — the concurrent process

7 modified files, all under `libs/backend/**` and `libs/shared/**` (the tasks-RPC / task-specs / saved-views work). **HEAD moved twice during this batch**: `09d94be9b` → `a2d36a24c`-lineage → `ed840f9d2` ("feat(vscode): batch 10 — the command palette, board keyboard nav and the r11 ratchet"). The foreign working set also changed completely mid-batch (it started on `libs/frontend/tasks-ui/**` and ended on `libs/backend/rpc-handlers/**`). **None of it overlaps my territory**, and no gate failure in this batch traced to it.

### Discipline

- **No `git commit`, `git add`, `git rm`, `git stash`, `git reset`, `git checkout <path>`, `git restore`** — nothing was committed and nothing was staged.
- **Never `--no-verify`**; no hook was bypassed because nothing was committed.
- **Never `nx affected`** — every run used an explicit project list with `--skip-nx-cache`.
- **`prisma migrate reset` and `prisma db push` were never run.** `prisma migrate dev` was never run either (I used `migrate diff` + `migrate deploy`).
- **No already-applied migration was edited.**
- No sub-agents, no `ptah_agent_*`.
- Nothing written outside `libs/api/youtube/**`, `libs/api/learning/**`, `apps/ptah-license-server/prisma/**`, `tsconfig.base.json`, and this report.
- **No test, census or boundary rule was weakened.** Every census in this batch (`EXPECTED_EXEMPTIONS`, `EXPECTED_NULLABLE_OPTIONALS`) is `[]` and every structural rule is stricter than its forum equivalent in at least one respect (the back-relations).

---

<a name="handoff"></a>

## What dispatch 9B / 9C should know

1. 🔴 **`member-course.contract.ts` ALREADY EXISTS.** Task 9.7 marks it `(NEW)`. **Extend it** — creating it clobbers `ContinueLearning`, which the hub's `learning` section already consumes. ([Finding 3](#findings))
2. 🔴 **Every future migration in this app will propose to DROP three trigram indexes.** Read the generated SQL and strip them. The header inside `20260819090000_courses/migration.sql` documents the exact statements. ([Finding 1](#finding-1))
3. 🔴 **Task 9.13 must treat `videoDurationSeconds <= 0` as "no usable duration", not just `null`.** `PT0S` is a legitimate parse and reproduces the zero-threshold bug. ([Finding 4](#findings))
4. **`optional-field.ts` does not exist yet in `libs/api/learning`.** The decision (re-declare, do not import from forum) and its reasoning are in `nullable-dto.spec.ts`'s docblock. Create it with the first DTO. ([D-23](#task-96))
5. **Both structural specs are armed and will bite from the first service.** `EXPECTED_EXEMPTIONS` and `EXPECTED_NULLABLE_OPTIONALS` are both `[]` and should stay `[]`. If a task wants an exemption, that is a design event — read the constant's docblock first; the exemption-free restore idiom is already recorded as a legal probe.
6. **`RULE-UNIQUE` bans `findUnique` outright on all four soft-deletable models**, including the composite-unique form `{ moduleId_slug: { moduleId, slug } }` that the member lesson route makes tempting. Use `findFirst`.
7. **`createMockPrisma()` for this lib is `@ptah-api/learning`'s own** (`src/testing/mock-learning-prisma.ts`), with `countQueries()` / `queryBreakdown()` for any query budget. Do not extend `libs/api/core`'s factory — its `MODEL_KEYS` census would go red.
8. **The barrel is `export {}`.** `src/index.ts`'s docblock already records what may and may not be exported and why; NFR-P6's one-importer rule is stated there too.
9. **`libs/api/youtube` is finished and needs nothing further from 9B/9C** beyond being imported by `lessons/lesson-video.service.ts` — and by that file only.
10. **`api-forum:test` is intermittently flaky inside `run-many`.** Re-run before believing it. ([Finding 7](#findings))
