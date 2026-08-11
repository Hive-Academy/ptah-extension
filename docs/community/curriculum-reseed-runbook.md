# Curriculum re-seed and cohort scheduling — operator runbook

TASK_2026_202 restructured the Builders course from **8 weekly modules** into a
**10-day intensive**. This document covers the two operational questions that
change creates:

1. What happens if you re-seed a database that already holds the old course.
2. How you set a cohort's release dates — for cohort 1, and for every cohort
   after it.

Sections 1–4 are about the seed. Sections 5–6 are the ones you will actually
use.

---

## 1. Which environments hold the 8-week course: **none**

Verified at the TASK_2026_202 checkpoint, three independent ways:

| Evidence                                      | What it shows                                                                           |
| --------------------------------------------- | --------------------------------------------------------------------------------------- |
| `.github/workflows/ci.yml:89`                 | Runs `ptah-license-server:prisma:generate` only — client typegen, no migration, no seed |
| `.github/workflows/nightly-coverage.yml:62`   | Same: `prisma:generate` only                                                            |
| `docs/deploy/founder-setup-checklist.md` §2.4 | `prisma:migrate:deploy` against the production database is still **unchecked**          |

No CI job and no deploy step has ever run `seed-community`, and the founder
confirmed he has never run it by hand. **No cleanup is performed by this task,
and none is needed.**

Sections 2–4 are therefore written as _correct and currently unused_. They are
here because they will be needed the first time anyone re-seeds a persistent
database, and working them out under pressure is how a course page gets broken.

---

## 2. What a re-seed onto the OLD course would actually do

Stated as fact, from the seed's own source, because it is not obvious and it is
not an error:

- The `Course` row is **updated in place** — matched on `COURSE_SLUG`
  (`ptah-builders-cohort-1`), so title and description move to the new
  ten-day wording.
- The **10 new modules and 10 new lessons are created**. Their slugs are
  `day-01` … `day-10`, which are disjoint from the old `week-1` … `week-8`, so
  nothing collides and nothing is overwritten.
- 🔴 **The 8 old `week-N` modules are left exactly where they are — published
  and member-visible.** The seed has no delete verb (`community-seed.ts:105-109`
  exposes only `findUnique`, `create` and `update`). It cannot remove them, and
  it is not supposed to be able to.

**Net observable: an 18-module course page.** `sortOrder` 100–800 on the old
modules collides with 100–1000 on the new ones, and
`DETERMINISTIC_ORDER_BY` breaks the ties by `createdAt` — so the eight old
modules interleave with the ten new ones in creation order. There is **no crash
and no error**; the seed exits 0 and reports success. That is precisely why this
is written down: the failure is silent and cosmetic-looking, and a member sees
it before you do.

---

## 3. Cleanup, if it ever applies

**Non-production** — reset and re-seed:

```bash
npx nx run ptah-license-server:prisma:reset
npx nx run ptah-license-server:seed-community
```

**Production or staging** — never reset. Soft-delete the eight old modules one
at a time through the admin API:

```bash
curl -X DELETE https://<host>/api/v1/admin/course-modules/<moduleId> \
  -H "Authorization: Bearer <admin-jwt>"
```

That route is an audited soft delete, and every member read filters tombstones
at the nested `where`, so the module and its lessons disappear from the course
page without any row being destroyed.

---

## 4. The seed gains no delete verb — ever

This is a standing rule, not an omission. A seed that can delete is a seed that
can destroy member progress on a bad run, and the whole point of the
create-or-update shape is that re-running it is safe. Removing curriculum is an
**audited admin action** (section 3), never a side effect of seeding.

The same rule is why the seed **never writes `releaseAt`**
(`community-seed.ts:589-592`). Modules are created **open**, and a re-run can
never silently unschedule modules an admin has date-gated. The seed and the
scheduler below are two writers of one column, and only one of them owns it.

---

## 5. Setting the cohort schedule

One admin action takes a cohort start date and writes `releaseAt` on every live
module of a course, in day order, on consecutive weekdays with the weekend
skipped. Ten dates from one input.

### 5.1 The inputs you choose

| Input       | Meaning                                                                              |
| ----------- | ------------------------------------------------------------------------------------ |
| `courseId`  | The course being scheduled. **Not a slug** — get it from `GET /api/v1/admin/courses` |
| `startDate` | Day 1's local calendar date, `YYYY-MM-DD`. Must be a **weekday**                     |
| `timeOfDay` | The local wall-clock time each module opens, `HH:mm`, 24-hour                        |
| `timeZone`  | IANA identifier — `Europe/Berlin`, `UTC`. **Required, never inferred**               |

`timeOfDay` and `timeZone` are **per-cohort operator inputs**. They have no
default on purpose: a default is a decision about when a member's module unlocks,
taken by whoever wrote the constant rather than by you. The zone is required for
the same reason — if the server guessed, a container timezone change would move
every release date with no diff anywhere to show it happened.

⚠️ **A weekend start date is rejected, not rolled forward to Monday.** If you
type a Saturday you get a `400`, because silently changing the date you typed
only moves who made the mistake.

### 5.2 Step 1 — preview (writes nothing)

```bash
curl -X POST https://<host>/api/v1/admin/course-modules/schedule/preview \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "<courseId>",
    "startDate": "2026-09-01",
    "timeOfDay": "09:00",
    "timeZone": "Europe/Berlin"
  }'
```

This computes the whole schedule, **writes nothing, and records no audit row**.
Run it as many times as you like.

For the cohort-1 decision — **Tuesday 1 September 2026** — the ten dates are:

| Day | Date       | Weekday |
| --- | ---------- | ------- |
| 1   | 2026-09-01 | Tue     |
| 2   | 2026-09-02 | Wed     |
| 3   | 2026-09-03 | Thu     |
| 4   | 2026-09-04 | Fri     |
| 5   | 2026-09-07 | Mon     |
| 6   | 2026-09-08 | Tue     |
| 7   | 2026-09-09 | Wed     |
| 8   | 2026-09-10 | Thu     |
| 9   | 2026-09-11 | Fri     |
| 10  | 2026-09-14 | Mon     |

🔴 **The offsets are a function of the start weekday, not a constant.** For this
Tuesday start they are `+0 +1 +2 +3 +6 · +7 +8 +9 +10 +13`. A **Monday** start
would give the clean `+0 +1 +2 +3 +4 · +7 +8 +9 +10 +11`. Any fixed table you
find elsewhere is describing the Monday case only.

⚠️ **Day 10 alone on Monday 14 September is known and accepted.** A Monday 31
August start would give a clean 5 + 5 ending Friday 11 September; the founder
was shown that and supplied 1 September. Because the schedule is one admin
action, this can be revisited at any time without a code change.

**Read the response before continuing.** Two fields matter:

- `moduleCount` — how many live modules the course actually has.
- `lastReleaseDate` — Day 10's local date.

Each entry also carries `currentReleaseAt` and `changed`, so you can see exactly
which existing dates are about to move.

### 5.3 Step 2 — apply

The apply takes the same payload **plus two fields you copy from the preview**:

```bash
curl -X POST https://<host>/api/v1/admin/course-modules/schedule \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "courseId": "<courseId>",
    "startDate": "2026-09-01",
    "timeOfDay": "09:00",
    "timeZone": "Europe/Berlin",
    "confirmModuleCount": 10,
    "confirmLastReleaseDate": "2026-09-14"
  }'
```

🔴 **`confirmModuleCount` and `confirmLastReleaseDate` are required, and they
are the guard — not paperwork.** They are compared against the schedule computed
from the rows this request reads, and a mismatch is a `400` with **nothing
written**.

The failure being designed against is _a mis-typed start date silently shifting
ten member-visible dates_. Every plausible mis-typing moves the last date — a
wrong year, a wrong month, an off-by-one day, or a transposed `2026-01-09` for
`2026-09-01` — so `confirmLastReleaseDate` cannot be supplied correctly unless
you actually read a preview. `confirmModuleCount` catches the other half: you
believe you are scheduling ten modules and the course in fact has twelve.

A `confirm: true` checkbox was deliberately rejected. A boolean is satisfied by
copy-paste; a date is not.

### 5.4 What the apply does to dates that already exist

**It is a total re-schedule. It overwrites, and it shows you what it will
overwrite first.**

- Every live module gets a date. Modules are **not** skipped just because
  somebody set a date by hand — that would leave the course on two different
  schedules at once, half yours and half from an old edit.
- Only the rows whose date actually **changes** are written. Running the same
  apply twice reports `changedCount: 0` and touches nothing the second time.
- The audit row records `{ slug, from, to }` for every module that moved. There
  is no column holding a previous `releaseAt`, so **that audit row is the only
  record of the old dates** — and therefore the only way to undo a wrong
  re-schedule. If you get it wrong, read the audit log before doing anything
  else.

A per-module override through `PATCH /api/v1/admin/course-modules/:id` keeps
working afterwards, and is only ever replaced by the next deliberate
re-schedule.

### 5.5 Unscheduling

To open one module immediately:

```bash
curl -X PATCH https://<host>/api/v1/admin/course-modules/<moduleId> \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{ "releaseAt": null }'
```

There is no "unschedule the whole course" action, because that is this call per
module and it already exists.

### 5.6 ⚠️ The default is OPEN — do not pre-gate the first cohort

The seed produces `releaseAt = null` on every module: **all modules open, no
date gating at all.** That is the intended shipping state. Scheduling is
something the founder applies when and if he wants it, per cohort. Nobody should
"helpfully" apply a schedule to the first cohort because the capability exists.

---

## 6. Cohort 2, cohort 3, and after — no code change

The course slug is `ptah-builders-cohort-1`, so a future cohort is a **new
course row**, not an edit of this one. The scheduling action is keyed on a
course id and reads the module count from the database, so it works unchanged:

1. Create the new course (`POST /api/v1/admin/courses`) and author or seed its
   modules.
2. Get its `courseId` from `GET /api/v1/admin/courses`.
3. Run the preview from section 5.2 with the new `courseId` and the new start
   date.
4. Copy `moduleCount` and `lastReleaseDate` into the apply from section 5.3.

That is the whole procedure. It does not assume ten modules — a twelve-module
cohort gets twelve dates, and a three-module pilot gets three. It does not assume
a start weekday, a time of day, or a time zone. And it correctly handles a cohort
that runs across a daylight-saving transition: the release time stays fixed on
the **local** clock, which is what a member experiences, rather than on UTC.

---

## Related files

- `apps/ptah-license-server/prisma/seed/community-seed.ts` — the seed, and its
  `releaseAt` exclusion
- `apps/ptah-license-server/prisma/seed/map-course.ts` — module titles, `day-NN`
  slugs, and the offset tables
- `libs/api/learning/src/lib/common/weekday-schedule.ts` — the date arithmetic
- `libs/api/learning/src/lib/courses/course-schedule.service.ts` — the
  transaction, the echo guard, and the audit metadata
