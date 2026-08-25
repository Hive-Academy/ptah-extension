# Batch 12 report — P4-BE: live sessions, private sessions, migration 4

**Executor**: `backend-developer` (resumed mid-batch; the predecessor's process was killed after task 12.5)
**Date**: 2026-08-08
**Branch**: `ak/license-server-validation-pipe` — never switched, created, rebased, stashed or reset. `--no-verify` never used.
**HEAD at start**: `e82dc9802`. **HEAD at end**: `5f9572956`.
**Tasks**: 12.1 – 12.16. **All sixteen complete.** 12.1–12.5 by the predecessor, 12.6–12.16 in this session.

---

## Verdict, in one paragraph

The Phase-4 backend half is built, wired, registered and verified, and **every clause of the
exit gate passed — two of them LIVE against the real Google Calendar API rather than against a
double, because `ASSUMPTION-10 IS FALSE`**: `GOOGLE_OAUTH_*` is configured in this workspace and
in the running container, which the whole batch was planned around not being the case. An
accepted request created a real Calendar event, persisted its real Meet link, was rescheduled by
its persisted event id, and was declined — which deleted the event from Google and released the
AD-2 claim, all confirmed by re-reading the live feed (clause 1). A `LiveSession` claiming a
**real recurring master** de-duplicated **all 43 expanded instances** of that series and carried
the Calendar's Meet link onto the single `source: 'ptah'` item; an `id`-only merge would have
de-duplicated zero of the 43 (clause 3, RISK-V). The member view of that same accepted request
carried **exactly the nine `MemberSessionRequest` keys**, with `calendarEventId` and
`paymentStatus` absent rather than undefined (clause 4). `deleted_by` is on all four models and
`CoursesService` writes it (clause 5). Only **clause 2 could not be exercised as written** — the
`503 scheduling_unavailable` path is unreachable live precisely because Google IS configured; it
is asserted in the spec and [recorded as F-1](#f-1). Two things went beyond plan and both are
recorded: **a real member-visibility leak was found and fixed by a test this batch wrote**
([F-2](#f-2)), and **Batch 11's F-1 — `api-learning:eslint:lint` red at HEAD since Batch 9B — is
now CLOSED** ([§F-1 closure](#batch-11s-f-1--closed)).

---

## Exit gate — every clause, with its evidence

| #   | Clause                                                                                                                                                     | Result                    | Evidence                                                                                                                                           |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | An accepted request produces a Calendar event whose Meet link is persisted, and whose id reconciles on reschedule AND on decline                           | ✅ **LIVE**               | [The live accept](#the-live-accept--exit-gate-clause-1-against-the-real-api)                                                                       |
| 2   | Google unset ⇒ members submit, admins see the queue, accept returns `503 { reason: 'scheduling_unavailable' }` and writes nothing                          | ⚠️ **Asserted, not live** | [F-1](#f-1) — the branch is unreachable in this workspace because Google IS configured                                                             |
| 3   | The AD-3 merge emits a claimed Calendar event exactly once, `source: 'ptah'`, with the Meet link merged in — asserted **and** proven by deliberate failure | ✅ **LIVE + proof**       | [RISK-V live](#risk-v-proven-live-43-instances-one-item) · [Proof 1](#proof-1--drop-the-recurringeventid-arm-risk-v)                               |
| 4   | `MemberSessionRequest` never carries `calendarEventId`, `paymentStatus`, `paddleTransactionId`, `isFreeSession` or any requester identity                  | ✅ **LIVE + proof**       | [NFR-S4 live](#nfr-s4-verified-live-on-a-fully-populated-accepted-row) · [Proof 3](#proof-3--add-a-forbidden-key-to-tomembersessionrequest-nfr-s4) |
| 5   | F-1 closed: `Course`, `CourseModule`, `Lesson` carry `deleted_by` and `CoursesService`'s three soft deletes write it                                       | ✅                        | [V-DB](#v-db--the-schema-migration-4-actually-produced) (four tables, not three — `live_sessions` too)                                             |
| —   | `route-map` RI-1/RI-2/RI-3                                                                                                                                 | ✅                        | 15 routes added, both prefix ledgers untouched                                                                                                     |
| —   | `controller-validation`: `NAMED_PRIMITIVE_PARAM_COUNT` **exactly 6**, `MIN_TOTAL_PAYLOAD_PARAMS` re-derived                                                | ✅                        | 6 unchanged; floor 67 → **76**, [derived by the prescribed probe](#the-census-probe)                                                               |
| —   | `admin-guards` G1                                                                                                                                          | ✅                        | `ptah-license-server` 5 suites green                                                                                                               |
| —   | `app.module.spec` boots                                                                                                                                    | ✅                        | same                                                                                                                                               |
| —   | migration 4 applied and confirmed by `npx prisma migrate status`                                                                                           | ✅                        | [verbatim below](#v-mig--prisma-migrate-status-verbatim)                                                                                           |

---

## Resume point, established by reading the two commits against the 16-task list

| Task                                              | State on arrival                         | Where                                                                             |
| ------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------- |
| 12.1 Pre-flight                                   | ✅ predecessor                           | `10d5981e7`                                                                       |
| 12.2 `schema.prisma`                              | ✅ predecessor                           | `10d5981e7`                                                                       |
| 12.3 Migration 4                                  | ✅ predecessor, **applied**              | `10d5981e7`                                                                       |
| 12.4 Contracts                                    | ✅ predecessor                           | `dca2735d3`                                                                       |
| 12.5 Audit vocabulary + F-1's `deleted_by` writes | ✅ predecessor                           | `10d5981e7` (`audit-log.types.ts`, `admin-audit.ts`, `courses.service.ts` + spec) |
| **12.6 – 12.16**                                  | ⏸️ **not started — this session's work** |                                                                                   |

12.5 was **not** a separate commit: it rode `10d5981e7` alongside the migration, which is
correct — the column has to exist before `Prisma.CourseUpdateInput` accepts it. Assuming the
resume point was "task 3" would have redone the audit vocabulary.

---

## Baselines, captured BEFORE any edit

Measured at `e82dc9802` with `--skip-nx-cache`, one project at a time (a `run-many` only prints
the last project's totals, which is how a per-project baseline gets mis-attributed).

| Project                   | Baseline suites / tests | Post-batch suites / tests | Δ                                   |
| ------------------------- | ----------------------- | ------------------------- | ----------------------------------- |
| `api-community`           | 9 / 226                 | **18 / 410**              | +9 / **+184**                       |
| `api-member-hub`          | 7 / 91                  | **7 / 109**               | 0 / **+18**                         |
| `ptah-license-server`     | 5 / 151                 | **5 / 155**               | 0 / **+4**                          |
| `api-contracts-community` | 2 / 33                  | 2 / 33                    | unchanged                           |
| `api-audit`               | 1 / 5                   | 1 / 5                     | unchanged                           |
| `api-learning`            | 21 / 493                | 21 / 493                  | unchanged in count **and identity** |
| `api-membership`          | 3 / 23                  | 3 / 23                    | unchanged                           |
| `api-forum`               | 21 / 505                | 21 / 505                  | unchanged                           |

**Total: +206 tests.** `api-learning` is unchanged in count and identity, as Task 12.5's
verification requires — the only edit to it in this session was the one-line F-1 lint fix.

### Lint / typecheck

```
BASELINE (e82dc9802)
  api-learning:eslint:lint        ✖ 12 problems (12 errors, 0 warnings)   <- BATCH 11's F-1
  api-community:eslint:lint       clean
  ptah-license-server:eslint:lint ✖ 2 problems (0 errors, 2 warnings)     <- pre-existing, foreign
  all typechecks                  PASS

POST (5f9572956)
  $ npx nx run-many -t eslint:lint,typecheck \
      -p api-community,api-contracts-community,api-member-hub,api-audit,api-learning,ptah-license-server \
      --skip-nx-cache
    ptah-license-server:eslint:lint  ✖ 2 problems (0 errors, 2 warnings)  <- the SAME two
      apps/ptah-license-server/jest.config.ts:1   unused eslint-disable
      apps/ptah-license-server/src/instrument.ts:1 unused eslint-disable
    -> Successfully ran targets eslint:lint, typecheck for 6 projects
```

The two `ptah-license-server` warnings are the identical pair Batches 6, 8 and 11 recorded. The
**twelve `api-learning` errors are gone** — see below.

---

## Batch 11's F-1 — CLOSED

Batch 11 recorded `api-learning:eslint:lint` as red at HEAD with twelve
`@nx/enforce-module-boundaries` errors, all caused by ONE line
(`courses.service.spec.ts:780`):

```ts
require('@ptah-api/core').Prisma.PrismaClientKnownRequestError.prototype,
```

Nx classifies a `require()` of a workspace library as a **lazy load**, which then makes every
STATIC `import` of that library illegal elsewhere in the lib — so `learning.module.ts`,
`reorder.service.ts`, `lesson-video.service.ts` and `progress.service.ts` were all reported for
doing nothing wrong. It was cheap and clearly in scope (Task 12.5 already edits this lib), so it
is fixed: a static `import { Prisma } from '@ptah-api/core'` plus a docblock recording the trap.
Commit `5f9572956`.

🔴 **A FINDING WORTH MORE THAN THE FIX: the first re-run after the fix reported THIRTEEN errors,
not zero.** `--skip-nx-cache` skips the TASK cache, not the PROJECT GRAPH — the graph still held
the old lazy edge and now saw the new static import as a thirteenth violation. `npx nx reset`
refreshed it and the rule went green. `nx reset` itself failed with
`EPERM … .nx\workspace-data` (a concurrent Nx process holds it, exactly as Batch 11 recorded);
the graph refresh still took effect.

**That is almost certainly how Batch 9C reported "zero lint errors" while this rule was in fact
red.** A green run of `enforce-module-boundaries` against a stale graph means nothing. Both of
this batch's own specs avoid the `require()` shape and say why in a docblock.

---

## V-MIG — `prisma migrate status`, verbatim

No `prisma migrate dev`, `db push` or `migrate reset` was run. No migration was authored or
edited in this session — migration 4 was already applied by the predecessor.

```
$ DB="$(grep -m1 '^DATABASE_URL=' .env | cut -d= -f2- | sed 's/^"//; s/"$//')"
$ cd apps/ptah-license-server && DATABASE_URL="$DB" npx prisma migrate status

◇ injected env (0) from .env // tip: ⌘ multiple files { path: ['.env.local', '.env'] }
Loaded Prisma config from prisma.config.ts.

Prisma schema loaded from prisma\schema.prisma.
Datasource "db": PostgreSQL database "ptah_db", schema "public" at "localhost:5432"

20 migrations found in prisma/migrations

┌─────────────────────────────────────────────────────────┐
│  Update available 7.7.0 -> 7.9.1                        │
└─────────────────────────────────────────────────────────┘
Database schema is up to date!
```

### V-DB — the schema migration 4 actually produced

```
$ docker exec ptah_postgres psql -U ptah -d ptah_db -c "\d live_sessions"
                                     Table "public.live_sessions"
          Column           |              Type              | Nullable |      Default
---------------------------+--------------------------------+----------+-------------------
 id                        | text                           | not null |
 title                     | text                           | not null |
 description               | text                           |          |
 starts_at                 | timestamp(3) without time zone | not null |
 ends_at                   | timestamp(3) without time zone |          |
 visibility                | text                           | not null | 'member'::text
 cohort_keys               | text[]                         |          | ARRAY[]::text[]
 youtube_video_id          | text                           |          |
 replay_youtube_video_id   | text                           |          |
 video_title               | text                           |          |
 video_duration_seconds    | integer                        |          |
 video_thumbnail_url       | text                           |          |
 video_metadata_fetched_at | timestamp(3) without time zone |          |
 video_metadata_source     | text                           |          |
 calendar_event_id         | text                           |          |
 created_by                | text                           |          |
 deleted_at                | timestamp(3) without time zone |          |
 deleted_by                | text                           |          |
 created_at                | timestamp(3) without time zone | not null | CURRENT_TIMESTAMP
 updated_at                | timestamp(3) without time zone | not null |
Indexes:
    "live_sessions_pkey" PRIMARY KEY, btree (id)
    "live_sessions_calendar_event_id_key" UNIQUE, btree (calendar_event_id)   <- AD-2
    "live_sessions_starts_at_idx" btree (starts_at)

$ … "select column_name from information_schema.columns where table_name='session_requests'
     and column_name in ('calendar_event_id','meet_link','duration_minutes','decline_reason');"
 calendar_event_id
 decline_reason
 duration_minutes
 meet_link
(4 rows)

$ … "select table_name from information_schema.columns where column_name='deleted_by'
     and table_name in ('courses','course_modules','course_lessons','live_sessions');"
 course_lessons
 course_modules
 courses
 live_sessions
(4 rows)                                    <- exit-gate clause 5, plus ASSUMPTION-14
```

---

## 🔴 The environment is not what the batch was planned against

**`ASSUMPTION-10 IS FALSE.`** The plan states that `GOOGLE_OAUTH_*` is unset, that `isEnabled()`
is therefore `false`, and that "the Google happy path CANNOT be verified live in this
workspace". It is set — in the repo-root `.env` **and** in the running container:

```
$ docker exec ptah_license_server printenv | …
YOUTUBE_API_KEY=EMPTY
BUILDERS_SESSION_EVENT_ID=set(26)
GOOGLE_OAUTH_REFRESH_TOKEN=set(103)
GOOGLE_OAUTH_CLIENT_SECRET=set(35)
GOOGLE_OAUTH_CLIENT_ID=set(72)
ADMIN_EMAILS=set(28)
```

ASSUMPTION-10's own overrule condition — _"real `GOOGLE*OAUTH*_`credentials in`.env`plus one
live accept against a throwaway request"* — was therefore **already met**, and this batch took
it.`YOUTUBE_API_KEY` is genuinely empty, so ASSUMPTION-6 (the YouTube feature-off path is the
live path) **still holds** and was verified as such.

**A second environment surprise: the database has been reset since Batch 11.** `users`,
`licenses`, `courses` and every `community_*` table are at zero; only `member_groups` survives
with its one `founding` row. Batch 11's dev user `674888a2-…` and license
`DEV-BUILDERS-VALIDATION-0001` no longer exist, so `V-TOKEN` as written cannot authenticate.
A throwaway identity was created, used, and deleted — see [Residue](#residue).

---

## Task 12.16 — live verification, in order

All 15 routes are mounted in the running container:

```
$ docker logs ptah_license_server | grep -oE "Mapped \{[^}]*\}" | grep -E "live|session-request" | sort -u
Mapped {/api/v1/admin/live-sessions, GET}          Mapped {/api/v1/admin/live-sessions, POST}
Mapped {/api/v1/admin/live-sessions/:id, DELETE}   Mapped {/api/v1/admin/live-sessions/:id, GET}
Mapped {/api/v1/admin/live-sessions/:id, PATCH}
Mapped {/api/v1/admin/live-sessions/:id/refresh-metadata, POST}
Mapped {/api/v1/admin/live-sessions/:id/restore, POST}
Mapped {/api/v1/admin/session-requests, GET}
Mapped {/api/v1/admin/session-requests/:id/accept, POST}
Mapped {/api/v1/admin/session-requests/:id/decline, POST}
Mapped {/api/v1/admin/session-requests/:id/reschedule, POST}
Mapped {/api/v1/members/live, GET}
Mapped {/api/v1/members/session-requests, GET}     Mapped {/api/v1/members/session-requests, POST}
Mapped {/api/v1/members/session-requests/:id, DELETE}
```

`V-HEALTH` → `200`. Token minted per `V-TOKEN` and sent as the **`ptah_auth` cookie**, never as
an `Authorization` header (`JwtAuthGuard` reads `request.cookies['ptah_auth']`).

### The member surface

```
[1] GET /v1/members/live -> 200
    calendarAvailable = true | upcoming 50 | live 0 | replays.total 0
    keys = calendarAvailable,live,replays,upcoming
    first upcoming = {"id":"qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z","source":"calendar",
                      "state":"upcoming","title":"PRO ESTATE MEETING",
                      "startsAt":"2026-08-09T14:00:00.000Z","endsAt":"2026-08-09T15:00:00.000Z",
                      "youtubeVideoId":null,"meetLink":"https://meet.google.com/yef-rhxk-iwz",
                      "durationSeconds":null}
[2] GET /v1/members/session-requests -> 200 | body []
[3] POST /v1/members/session-requests -> 201 | status pending
    own keys = additionalNotes,createdAt,declineReason,durationMinutes,id,meetLink,
               scheduledAt,sessionTopicId,status                       <- exactly nine
[4] POST with an unknown field -> 400          (forbidNonWhitelisted is LIVE, PRE-1)
[5] POST additionalNotes:null  -> 201          (NullMeansAbsent — a 400/201, never F-2's 500)
[6] DELETE /v1/members/session-requests/:id -> 200 {"canceled":true}
```

⚠️ **`calendarAvailable` is `true`, not the gate's `false`.** The gate assumed ASSUMPTION-10.
The clause it was protecting — _"the surface renders and shows the member no error"_ — held: a
`200` with 50 merged items and no error field. R3.6's `false` branch is covered by the spec.

⚠️ **Note the `id` in `[1]`.** `qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z` is an **expanded
recurrence instance** — `singleEvents=true` in action, with a suffixed id the master never has.
This is RISK-V's exact shape, in production data, before anything was claimed.

### The admin surface

```
[7] GET /v1/admin/session-requests -> 200 | n = 2
    first = {"id":"0953532b-…","userId":"b12b12b1-…","requester":{"id":"…","email":"…",
             "firstName":"B12","lastName":"Probe"},"sessionTopicId":"b12-probe-topic",
             "additionalNotes":"Batch 12 verification probe.","isFreeSession":false,
             "status":"pending","paymentStatus":"none","paddleTransactionId":null,
             "calendarEventId":null,"meetLink":null,"scheduledAt":null,"durationMinutes":null,
             "declineReason":null,"createdAt":"…","updatedAt":"…"}
[8] ?status=bogus -> 400            (IsIn — not a silent "no requests in that state")
[9] GET /v1/admin/live-sessions -> 200 | n = 0
```

The queue carries the requester and the three billing internals; the member view of the SAME row
below carries neither. That contrast is exit-gate clause 4, observed rather than asserted.

### The DTO floor refuses before any Google call

```
[B] accept with durationMinutes=5 (below the 15 floor) -> 400
    {"message":["durationMinutes must not be less than 15"],"error":"Bad Request","statusCode":400}
$ … "select status, calendar_event_id, meet_link, duration_minutes, scheduled_at …"
pending | evt=NULL | meet=NULL | dur=NULL | at=NULL        <- nothing written, no event created
```

### The live accept — exit-gate clause 1, against the REAL API

```
[A] POST /v1/admin/session-requests/0953532b-…/accept  {startsAt: +7d, durationMinutes: 30} -> 200
    {"status":"scheduled",
     "calendarEventId":"ihfrvb2pd4rpsqubh3qbgf03ag",
     "meetLink":"https://meet.google.com/ope-zmee-szb",
     "scheduledAt":"2026-08-15T17:42:12.461Z","durationMinutes":30, …}

$ … "select status, calendar_event_id, meet_link, duration_minutes, scheduled_at, decline_reason
     from session_requests where id='0953532b-…';"
 scheduled | ihfrvb2pd4rpsqubh3qbgf03ag | https://meet.google.com/ope-zmee-szb | 30 | 2026-08-15 17:42:12.461 |

$ … "select action, target_type, target_id, actor_email, metadata from admin_audit_log …;"
 community.session_request.accept | SessionRequest | 0953532b-… | abdallah@miramarstaffing.com
   | {"startsAt": "2026-08-15T17:42:12.461Z", "durationMinutes": 30}
```

**A real Google Calendar event was created and a real Meet link resolved and persisted** — all
four migration-4 columns written in one transaction, with the PRE-6 audit row committed in it and
carrying only values the admin supplied.

Then the reconciliation, both halves:

```
[R] POST …/reschedule {startsAt: +9d} -> 200
    calendarEventId unchanged? true | scheduledAt 2026-08-17T17:43:41.819Z
    | durationMinutes 30 (from the PERSISTED column, no re-read of Google)
    | meetLink https://meet.google.com/ope-zmee-szb (preserved)

[D] POST …/decline {declineReason: "…"} -> 200
    status canceled | calendarEventId null | meetLink null | declineReason "…"
[D2] declining it again -> 409 {"reason":"session_request_already_closed", …}

[E] is the accepted event id still on the calendar?
    NO — the decline deleted it from Google
    (re-read GET /v1/members/live: 50 upcoming, `ihfrvb2pd4rpsqubh3qbgf03ag` absent)
```

**Clause 1 in full: created, persisted, reconciled on reschedule BY THE PERSISTED ID, reconciled
on decline, and the claim released so AD-2's `@unique` does not hold against a deleted event.**

### RISK-V proven LIVE: 43 instances, one item

Exit-gate clause 3, against a **real recurring series** on the founder's calendar. A
`LiveSession` was created claiming the MASTER id `qhfl5bspa1s0m6tfld2viphv35` — the id an admin
copies out of Google Calendar, which appears in **none** of the instance ids the feed returns.

```
[V1] BEFORE the claim:
     items whose id starts with the master = 43 | all source=calendar? true
     sample ids = qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z,
                  qhfl5bspa1s0m6tfld2viphv35_20260810T140000Z,
                  qhfl5bspa1s0m6tfld2viphv35_20260811T140000Z

[V2] POST /v1/admin/live-sessions -> 201
     youtubeVideoId dQw4w9WgXcQ | videoMetadataSource manual | videoMetadataFetchedAt null
     | calendarEventId qhfl5bspa1s0m6tfld2viphv35

[V3] AFTER the claim:
     calendar-sourced items for the master = 0  (was 43)
     ptah-sourced items = 1
     ptah item = {"id":"cmsknxfp60000aumfadlmmtpt","source":"ptah","state":"upcoming",
                  "title":"B12 probe — claims a real recurring master",
                  "youtubeVideoId":"dQw4w9WgXcQ",
                  "meetLink":"https://meet.google.com/yef-rhxk-iwz",   <- MERGED from Calendar
                  "durationSeconds":1800}
     >>> RISK-V: EVERY expanded instance of the claimed master was de-duplicated,
         and the claimant carries the merged Meet link
```

🔴 **An `id`-only merge would have de-duplicated ZERO of the 43.** The feed would have shown the
Ptah session plus 43 calendar copies of the same series. This is the strongest form of clause 3
available and it is live rather than fixtured.

`[V2]` also confirms **ASSUMPTION-6 live**: `YOUTUBE_API_KEY` is empty, so the id was extracted
from a full watch URL, the admin's typed title was kept, `videoMetadataSource` is `'manual'` and
`videoMetadataFetchedAt` stayed `null` — a hand-typed row is not badged as freshly fetched.

### RISK-Y live, and the live-session lifecycle

```
[Y] a SECOND session claiming the same event -> 409
    {"reason":"calendar_event_already_claimed",
     "message":"Another live session already claims that calendar event. …"}
    (no constraint name, no table name, no Prisma text — NFR-S7)

[L1] POST :id/refresh-metadata (YOUTUBE_API_KEY empty) -> 200
     refreshed = false | reason = youtube_disabled
     | videoTitle STILL "typed by hand (YOUTUBE_API_KEY is empty)"   <- nothing destroyed
[L2] DELETE -> 200 {"deleted":true}
[L3] GET after delete -> 404                    (the tombstone is invisible to the admin read)
[L4] member feed after delete: ptah items = 0 | master instances back as calendar = 43
[L5] POST :id/restore -> 200 {"restored":true}  (R8.5, window inside the UPDATE's own WHERE)
[L6] DELETE again -> 200 {"deleted":true}
```

`[L4]` is worth naming: soft-deleting the claimant **returned all 43 instances to the feed as
`source: 'calendar'`**, which proves the claim set is built from the same `NOT_DELETED` read the
feed serves — a tombstone cannot go on silently suppressing a live calendar series.

### NFR-S4 verified LIVE, on a fully-populated accepted row

```
[M] GET /v1/members/session-requests (the SAME row the admin queue showed in full) -> 200
    own keys = additionalNotes,createdAt,declineReason,durationMinutes,id,meetLink,
               scheduledAt,sessionTopicId,status
    body = {"id":"0953532b-…","sessionTopicId":"b12-probe-topic",
            "additionalNotes":"Batch 12 verification probe.","status":"scheduled",
            "scheduledAt":"2026-08-15T17:42:12.461Z","durationMinutes":30,
            "meetLink":"https://meet.google.com/ope-zmee-szb",
            "declineReason":null,"createdAt":"2026-08-08T17:41:53.146Z"}
    calendarEventId present? false
    paymentStatus present?   false
```

The row carried a real `calendarEventId`, a real `paddleTransactionId`, a `userId` and a joined
requester with an email address. **None of them reached the member.** Exit-gate clause 4.

### The hub, R6.6

```
[H] GET /v1/members/hub -> 200
    sections = community,learning,notifications,packs,sessions
    sessions = {"status":"ok","data":{"id":"qhfl5bspa1s0m6tfld2viphv35_20260809T140000Z",
                "kind":"calendar","title":"PRO ESTATE MEETING",
                "startsAt":"2026-08-09T14:00:00.000Z","endsAt":"2026-08-09T15:00:00.000Z",
                "meetLink":"https://meet.google.com/yef-rhxk-iwz","youtubeVideoId":null}}
```

`200`, every section present, the same five keys and the same `HubSectionSummary` shape as before
this batch — R6.6's "a DATA change, not a contract change", observed. The card resolved to
`kind: 'calendar'` because the 2026-08-09 calendar session is genuinely earlier than the private
session on 2026-08-15: `earliest()` computed across three sources and the right one won.

---

## Deliberate-failure proofs — four, each reverted and `diff`-confirmed

Task 12.16 asks for at least three.

### Proof 1 — drop the `recurringEventId` arm (RISK-V)

```
$ (mutate) const claimant = claims.get(event.id);
● LiveFeedService › AD-3 / RISK-V › emits a claimed RECURRING series EXACTLY ONCE …
● LiveFeedService › AD-3 / RISK-V › de-duplicates EVERY instance of a claimed series …
Tests: 2 failed, 17 passed, 19 total
$ REVERT-1 OK: live-feed.service.ts byte-identical
```

### Proof 2 — remove the compensating `deleteEvent` from `accept`'s catch (RISK-U)

```
● SessionRequestsService › accept › ROW 4 — the DB write throws AFTER a successful create ⇒ the event is DELETED
● SessionRequestsService › accept › ROW 4b — a P2002 ⇒ 409, and the orphan is deleted too (RISK-Y)
● SessionRequestsService › accept › ROW 4c — a CONCURRENT accept loses on the status guard and compensates
Tests: 3 failed, 31 passed, 34 total
$ REVERT-2 OK: session-requests.service.ts byte-identical
```

**Three failures, and the spread is the finding.** The compensation covers not only the
"database threw" row but the `P2002` and the concurrent-accept `409` as well — both of which are
database failures _after_ a successful create, and both of which leave an orphaned event if the
`catch` is narrowed to the first.

### Proof 3 — add a forbidden key to `toMemberSessionRequest` (NFR-S4)

```
$ (mutate) calendarEventId: row.calendarEventId,
● returns EXACTLY the nine MemberSessionRequest fields as own keys
● has no own key `calendarEventId` — an internal Google handle …
● leaks none of the forbidden VALUES anywhere in the serialised body
● still carries every field the member DOES need
● is an explicit object literal, not a spread-minus-a-few-keys
Tests: 5 failed, 8 passed, 13 total
$ REVERT-3 OK: session-requests.service.ts byte-identical
```

### Proof 4 — collapse the hub section back to two-state logic (Task 12.15)

```
$ (mutate) if (answered.length < 3)     // i.e. unavailable whenever ANY source is down
● the populated path › returns the NEXT upcoming session, mapped to the wire contract
● the populated path › an enabled integration with no upcoming sessions is EMPTY, not unavailable
● three-way merge › Calendar FAILS but a LiveSession exists -> ok, NOT unavailable
● three-way merge › Calendar DISABLED but a private session exists -> ok
● three-way merge › one source answered EMPTY and the others are down -> empty
  (9 failed, 20 passed, 29 total)
$ REVERT-4 OK: sessions.section.ts byte-identical
```

Six of the nine failures are **Phase 1's own tests**, which is the point: the naive
"unavailable if anything is down" rule breaks the card that already worked.

### The census probe

`MIN_TOTAL_PAYLOAD_PARAMS` was re-derived the way its own docblock prescribes rather than
counted by eye:

```
$ (set the constant to 9999)
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns=controller-validation
    Expected: >= 9999
    Received:    76
Tests: 1 failed, 47 passed, 48 total     <- the other 47 include NAMED_PRIMITIVE_PARAM_COUNT === 6
$ PROBE REVERTED: byte-identical
```

76 = 70 whole-object + 6 named. The +9 decomposes exactly: `MemberLiveController` 1,
`MemberSessionRequestsController` 1, `AdminLiveSessionsController` 3,
`AdminSessionRequestsController` 4.

---

## 🔴 A real defect this batch's own tests found

### F-2

**The first draft of `LiveFeedService` leaked every cohort and staff session to every member.**

```ts
where: {
  ...NOT_DELETED,
  ...visibility,          // -> { OR: [ …visibility branches… ] }
  OR: [ …the time window… ],   // SAME KEY. This one wins.
}
```

`buildLiveSessionVisibilityWhere` returns `{ OR: branches }`, and the "has not ended" window is
**also** an `OR`. Spread into one object literal the second key overwrites the first, and the
visibility clause vanishes — silently, with no error, no log, and a perfectly plausible feed.
Every member would have seen every `cohort` session they are not in and every `staff` session.

It was caught by the assertion that both reads carry a `hasSome` branch, written before the code
was run. The fix is an explicit `AND: [visibility, window]`, and the assertion now also checks
that a non-admin's `where` contains no `staff` branch. Both reads and the `count` are covered.

**Worth generalising**: any Prisma `where` that spreads two builders which can each emit a
top-level `OR`/`AND` has this hazard. `libs/api/forum` and `libs/api/learning` compose visibility
with `published`/`id` filters rather than with a second `OR`, so neither is affected — checked.

---

## Findings

### F-1

**🔴 Exit-gate clause 2 is UNREACHABLE in this workspace, because ASSUMPTION-10 is false.**

The clause requires `accept` to answer `503 { reason: 'scheduling_unavailable' }` with Google
unset. `GOOGLE_OAUTH_*` **is** set (see [above](#-the-environment-is-not-what-the-batch-was-planned-against)),
so `isEnabled()` is `true` and the branch cannot be reached live without unsetting three env
vars on a running container and restarting it — which would have disturbed a shared service for
a branch the spec already covers.

**What was verified instead**: the branch is asserted in
`session-requests.service.spec.ts` (`ROW 1 — Google unset ⇒ 503 …, and NOTHING is written`,
including that `createEvent`, `updateMany` and `$transaction` are all uncalled), and the same
`503` is asserted for `reschedule`. The half of clause 2 that says _"members submit, admins see
the queue"_ WAS verified live, in `[1]`–`[9]`.

**Also worth stating**: because Google is configured, `decline` on a pending request was
exercised on the path that matters — it makes no Calendar call at all, which is what lets an
admin run the queue with the integration off. That was a design decision made for the
feature-off world and it is now the only part of it this workspace can still demonstrate.

**Cheapest way to close it properly**: a throwaway container with `GOOGLE_OAUTH_*` unset, or an
e2e that stubs `GoogleAuthProvider`. Recommended for B13's e2e pass rather than a manual step.

### F-3

**The database was reset between Batch 11 and Batch 12.** `users`, `licenses`, `courses`,
`course_modules`, `course_lessons` and every `community_*` table are at **0**; `member_groups`
holds its one `founding` row. Batch 11's seeded curriculum (1 course / 8 modules / 8 lessons),
Batch 8's community seed (4 / 9 / 10) and Batch 10's probe rows are **all gone**, as are the dev
user and the `DEV-BUILDERS-VALIDATION-0001` licence every prior batch's `V-TOKEN` recipe depends
on.

**Consequence for B13 and B14**: `V-TOKEN` as written in `tasks.md` no longer works, and
`nx run ptah-license-server:seed-community` must be re-run before any batch that verifies member
content. Not this batch's to re-seed — this batch needed neither the curriculum nor the forum —
but the next one that does will lose time discovering it.

### F-4

**`tasks.md` predicts ten DTO files; there are nine.** Task 12.10's file list names
`refresh-live-metadata.dto.ts`. `POST /v1/admin/live-sessions/:id/refresh-metadata` **takes no
body** — the target is the path parameter and the metadata video is resolved from the row by
`metadataVideoOf()` — so a DTO would be an empty class bound to nothing. Recorded in
`nullable-dto.spec.ts`'s `MIN_DTO_FILES` docblock and in `controller-validation.spec.ts`'s
arithmetic rather than written to make a number match.

### F-5

**There is no bulk `POST /v1/admin/live-sessions/refresh-metadata`, unlike the lessons surface.**
`LessonVideoService.refreshMetadata` takes a `lessonIds` array; this one is single-target. A
batch refresh is the shape that grows into a cron, and the authoring-time fetch exists precisely
so there is no cron (RK-6). Reversible — it is one route, one DTO and one loop — but it should be
a decision rather than a copy.

### F-6

**One `video*` metadata block, two video ids — and the schema does not say which the block
describes.** `LiveSession` stores `youtubeVideoId` (the stream) and `replayYoutubeVideoId` (the
recording) separately, by design (R3.4), but carries a single title/duration/thumbnail block.
`metadataVideoOf()` is the one place the rule is stated: **the replay when one is attached,
otherwise the stream**. Reasoning: duration and thumbnail are properties of a finished recording,
and `LiveFeedItem.durationSeconds` is what a replay card renders — tracking the stream for ever
would leave every replayed session reporting the premiere's runtime.

**The consequence, stated**: attaching a replay REPLACES the stream's metadata. Nothing is lost
that a re-fetch could not restore, and the alternative is four more columns for a value nothing
renders. **One function to overrule.**

### F-7

**`sessions.service.ts` was refactored, which `tasks.md` did not ask for.** Task 12.8 says the
feed reads `SessionsService.readUpcomingSessions`, which returns `BuildersSession[]` — and
`BuildersSession` **drops `recurringEventId`**, reducing it to a `recurring: boolean`. Without
that field RISK-V is not solvable at all.

The fix is minimal and preserves the shipped member contract exactly: a new
`readUpcomingCalendarFeed()` returns `CalendarFeedEvent` (`BuildersSession` + `recurringEventId`),
and **both** public methods became thin views over one private `readVisibleEvents()`, so the
60-day window, the cancelled-event filter and the cohort scoping have a single implementation.
`GET /v1/members/sessions` calls the other mapper, so its response is byte-identical — and the
extra field never reaches any wire, because `LiveFeedItem` has no such key.

### F-8

**`live-sessions/common/`'s two structural specs are RE-ROOTED, not lib-wide.**
`soft-delete-filter.spec.ts` scans `live-sessions/` only: `circle/`, `packs/`, `member-groups/`
and `google-sessions/` predate AD-5 and read models with **no `deletedAt` column at all**, so a
lib-wide root would either fail on four innocent directories or be weakened to exempt them. The
spec asserts the root and asserts it _cannot_ see its siblings, so "out of scope" is structural
rather than prose.

`nullable-dto.spec.ts` scans `live-sessions/` plus `google-sessions/dto/`, with the one
pre-Phase-4 file in that directory (`admin-session.dto.ts`) excluded **by name** so a new DTO is
covered automatically.

🔴 **AND THAT EXCLUSION IS A DEBT MARKER.** `admin-session.dto.ts`, `pack.dto.ts` and
`member-group.dto.ts` carry `@IsOptional()` on ~30 non-nullable fields between them — every one
of which is a `{"field": null}` → **500** on a live admin endpoint, the exact class of defect
Batch 6.1 swept out of the forum. Real, pre-existing, and not this batch's file set. **Closing
it is ~30 decorator swaps plus a live re-check of `PATCH /v1/admin/sessions/:eventId`.**

### F-9

**`MemberHubModule` had to import `LiveSessionsModule`, and the `@Optional()` would have hidden
the omission.** `LiveSessionsModule` is not `@Global()` (unlike `GoogleSessionsModule`, which is
how the other two services reach the section), so without the import the `@Optional()` injection
resolves to `undefined` **for ever** and the live source is silently and permanently omitted from
the hub card — one `logger.warn` at first request and a perfectly plausible response after that.
The `@Optional()` is what turns a wiring mistake into one degraded card instead of a `500` on
`/hub`; the import is what makes the card correct. Both are now stated in the module docblock.

### F-10

**`SessionRequest` has no actor column of any kind, so the audit row is the sole record.** R4.10
froze its existing columns and migration 4 added only the four scheduling ones — there is no
`acceptedBy`, no `declinedBy`, no `deletedBy`. For
`community.session_request.{accept,reschedule,decline}` the PRE-6 audit row is therefore the
**only** record of which admin scheduled, moved or refused a member's private session, including
the one where the member disputes the decline reason. `LiveSession` is the easier half — it
carries `createdBy` and `deletedBy` (ASSUMPTION-14, taken).

### F-11

**A stale Nx project graph makes `enforce-module-boundaries` unfalsifiable.** See
[the F-1 closure](#batch-11s-f-1--closed). `--skip-nx-cache` does not refresh the graph, and
`nx reset` fails with `EPERM` on `.nx/workspace-data` while any Nx process holds it (Batch 11
recorded the same). This is the most likely explanation for Batch 9C reporting "zero lint errors"
against a rule that was in fact red for three batches.

---

## Deviations summary

| Spec said                                            | Done                                                                   | Why                                                                                                                                  |
| ---------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| ASSUMPTION-10: Google unset, happy path unverifiable | **Overruled — verified LIVE**                                          | Its own overrule condition was already met (F-1)                                                                                     |
| Exit-gate clause 2's `503` is "free"                 | **Unreachable live**; asserted in the spec                             | F-1                                                                                                                                  |
| `GET /v1/members/live` → `calendarAvailable: false`  | `true`, with 50 merged items and no error                              | F-1 — the clause it protected still held                                                                                             |
| Task 12.10 lists ten DTO files                       | **Nine**                                                               | F-4 — `refresh-metadata` takes no body                                                                                               |
| §2.10 admin list takes no filters                    | added `?from`/`?to` (a whole-object Query DTO)                         | Bounds an archive that grows without bound; needs no AD-5 exemption. **No `?includeDeleted`** — that would be this directory's first |
| Task 12.8 reads `readUpcomingSessions`               | added `readUpcomingCalendarFeed`; both are views over one private read | F-7 — `BuildersSession` drops the field RISK-V needs                                                                                 |
| `nullable-dto.spec.ts` "scans this directory"        | two roots, one legacy file excluded by name                            | F-8                                                                                                                                  |
| Lessons-style bulk refresh                           | single-target only                                                     | F-5 (RK-6)                                                                                                                           |
| Batch 11's F-1 is "not this batch's"                 | **Fixed**                                                              | Cheap, one line, in a lib this batch already edits; the brief invites it                                                             |

---

## Files created / modified — absolute paths

**Created**

```
D:\projects\ptah-extension\libs\api\community\src\testing\mock-community-prisma.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\admin-audit.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\member-context.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\optional-field.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\soft-delete.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\visibility.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\visibility.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\soft-delete-filter.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\common\nullable-dto.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-sessions.service.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-sessions.service.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-feed.service.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-feed.service.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-feed-state.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-feed-state.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-sessions.module.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\live-sessions.module.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\member-live.controller.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\admin-live-sessions.controller.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\dto\create-live-session.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\dto\update-live-session.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\dto\list-live.query.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\live-sessions\dto\list-admin-live.query.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\session-requests.service.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\session-requests.service.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\member-session-request-fields.spec.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\member-session-requests.controller.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\admin-session-requests.controller.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\dto\create-session-request.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\dto\accept-session-request.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\dto\reschedule-session-request.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\dto\decline-session-request.dto.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\dto\list-session-requests.query.dto.ts
```

**Modified**

```
D:\projects\ptah-extension\libs\api\community\src\index.ts
D:\projects\ptah-extension\libs\api\community\tsconfig.lib.json          (one line: exclude src/testing/**)
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\google-sessions.types.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\google-event.mapper.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\sessions.service.ts
D:\projects\ptah-extension\libs\api\community\src\lib\google-sessions\google-sessions.module.ts
D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\sessions.section.ts
D:\projects\ptah-extension\libs\api\member-hub\src\lib\sections\sessions.section.spec.ts
D:\projects\ptah-extension\libs\api\member-hub\src\lib\member-hub.module.ts
D:\projects\ptah-extension\libs\api\learning\src\lib\courses\courses.service.spec.ts   (F-1, one line)
D:\projects\ptah-extension\apps\ptah-license-server\src\app\app.module.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\testing\controller-registry.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\common\route-map.spec.ts
D:\projects\ptah-extension\apps\ptah-license-server\src\common\controller-validation.spec.ts
D:\projects\ptah-extension\.ptah\specs\TASK_2026_177\tasks.md            (.ptah is gitignored)
D:\projects\ptah-extension\.ptah\specs\TASK_2026_177\batch-12-report.md  (this file)
```

**NOT touched**: `schema.prisma`, `prisma/migrations/**`, `tsconfig.base.json`, `nx.json`,
`eslint.config.mjs`, `libs/api/audit/**`, `libs/api/forum/**`, `libs/web/**`, `libs/frontend/**`,
`libs/backend/**`, any other app. `PREFIX_EXCEPTIONS`, `KNOWN_PREFIX_DEBT` and
`UNVALIDATED_DEBT` are all byte-identical.

---

## Commits

| SHA         | Tasks           | Subject                                                                             |
| ----------- | --------------- | ----------------------------------------------------------------------------------- |
| `10d5981e7` | 12.1–12.3, 12.5 | `feat(license-server): add migration 4 for live and private sessions` (predecessor) |
| `dca2735d3` | 12.4            | `feat(license-server): add the phase 4 live session wire contracts` (predecessor)   |
| `d574f62a7` | 12.6–12.10      | `feat(license-server): add the live session and private session services`           |
| `ecf3603ec` | 12.11–12.14     | `feat(license-server): expose the phase 4 live and session-request routes`          |
| `42ce775ef` | 12.15           | `feat(license-server): fold live and private sessions into the hub card`            |
| `5f9572956` | carried item 1  | `fix(license-server): close batch 11's F-1 by dropping a require of api-core`       |

Every commit passed the pre-commit hooks and the commit-message validator without bypass.
`git status` after each showed only this batch's files.

---

## Residue

The database is back to **exactly** its pre-batch state.

```
$ … "BEGIN; delete from live_sessions where created_by='b12b12b1-…';
      delete from admin_audit_log where actor_email='…' and action like 'community.%';
      delete from session_requests where user_id='b12b12b1-…';
      delete from licenses where id='b12b12b1-…0099';
      delete from users where id='b12b12b1-…0012'; COMMIT;"
DELETE 1 / DELETE 7 / DELETE 2 / DELETE 1 / DELETE 1

$ … row census AFTER cleanup
 users | 0   licenses | 0   live_sessions | 0   session_requests | 0
 admin_audit_log | 0   member_groups | 1
```

- Every probe row was inserted with a **known id** and deleted **by that id**, inside one
  `BEGIN`/`COMMIT`. No `TRUNCATE`, no blanket `DELETE`.
- **The Google Calendar is clean.** The one real event created (`ihfrvb2pd4rpsqubh3qbgf03ag`) was
  deleted by the decline path and confirmed absent from a fresh `GET /v1/members/live`. No other
  event was created or modified; `sendUpdates` stayed at the provider default `'none'`, so **no
  email was sent to anybody**. The claimed recurring series was never written to — the
  `LiveSession` claims an event id, it does not modify the event.
- The two verification driver scripts (`tmp-b12-verify.cjs`, `tmp-b12-verify2.cjs`) and their
  three scratch id files were deleted; `git status` confirms no stray file.
- All four deliberate-failure mutations and the census probe were reverted and `diff`-confirmed
  byte-identical.

### Final `git status --porcelain`

```
 M marketing/scripts/01-open-source-announcement.md    <- FOREIGN (present at batch start)
?? libs/web/members/src/lib/__fixtures__/              <- FOREIGN, Batch 10 leftover; untouched
```

---

## Carried forward — what B13 and B14 need to know

1. 🔴 **ASSUMPTION-10 is dead. `GOOGLE_OAUTH_*` IS configured.** Any B13 plan that assumes the
   live surface renders an empty, calendar-less feed is wrong: `GET /v1/members/live` returns 50
   real events with real Meet links. **B13 should design against a POPULATED feed** — and should
   note that the founder's actual calendar is what a member sees, so the frontend will render
   real meeting titles (`PRO ESTATE MEETING`) in development.
2. 🔴 **`YOUTUBE_API_KEY` is still empty**, so ASSUMPTION-6 holds: every live session B13 renders
   has `videoMetadataSource: 'manual'`, a null thumbnail and whatever duration an admin typed.
   The no-thumbnail card is the DEFAULT case in this workspace, not an edge case.
3. 🔴 **The database was reset (F-3).** No users, no licenses, no curriculum, no forum content.
   `nx run ptah-license-server:seed-community` must be re-run, and a dev user + `builders`
   licence re-created, before any batch that verifies member content. `V-TOKEN` in `tasks.md`
   names a user id that no longer exists.
4. **Exit-gate clause 2's `503` was never exercised live (F-1).** If it matters, it belongs in
   B13's e2e pass with a stubbed `GoogleAuthProvider`, not in a manual step.
5. **~30 pre-F-2 `@IsOptional()` fields remain in `packs/`, `member-groups/` and
   `google-sessions/dto/admin-session.dto.ts` (F-8).** Each is a live `{"field": null}` → `500`.
   Out of this batch's file set; whoever next touches those DTOs owns the sweep.
6. **There is still no `?includeDeleted` admin read for live sessions**, so `POST :id/restore`
   exists with no API path to discover a restorable session — the same gap Batch 9B raised as its
   F-3 for courses. Adding one is this directory's first AD-5 exemption and needs TWO census
   entries (page + total).
7. **`LiveFeedItem` and `HubSessionSummary` stay unrelated types**, bridged only by
   `toLiveSummary` in `sessions.section.ts`. B13 should consume `MemberLiveResponse` for the feed
   and the hub envelope for the card; relating them would make a private session representable in
   a feed that must never contain another member's.
8. **The AD-6 `libs/api/community` split is now more attractive**, not less: the lib holds
   `circle/`, `packs/`, `member-groups/`, `google-sessions/` and `live-sessions/`, and two of
   those five are now Phase-4 code with their own `common/`. Still deferred, still recommended
   as a follow-up after B16.
9. **B14 owns `NotificationsModule`.** Both `LiveSessionsModule` and `GoogleSessionsModule` carry
   the RISK-L paragraph and `live-sessions.module.spec.ts` asserts BOTH the absence and the
   paragraph — so B14 must remove the assertion in the same change that adds the import.
