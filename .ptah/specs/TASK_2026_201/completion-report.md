# Completion Report — TASK_2026_201 + TASK_2026_202

**Branch**: `ak/founding-cohort-free-access` (worktree
`D:/projects/ptah-extension/.claude/worktrees/founding-cohort`), based on
`ak/license-server-validation-pipe` at `2ac5a8b45`.
**Date**: 2026-08-11.
**Role**: team-leader, MODE 3 — final verification and close-out.
**Carrier status at close**: TASK_2026_201 `in_review`, TASK_2026_202 `in_review`.
**Neither task is `done`, and §4 says exactly why.**

---

## 1. What shipped

### TASK_2026_201 — Founding cohort free access (FEATURE, 6 batches)

A waitlist row can now be approved to a fully entitled founding member in **one
admin action**, free, with no card and no Paddle. The paid invite path is gone,
not repointed.

| Batch | Commit      | What landed                                                                                                                                                                                                                                                           |
| ----- | ----------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | `3db831d00` | `Waitlist.approvedAt` migration (additive, nullable) + a second forward-only migration deleting the `Founding / Waitlist Invite` marketing template row. 3 files.                                                                                                     |
| B2    | `79a735f65` | Extracted the tx-aware complimentary-licence core — `grantInTx`, callable inside a caller's `$transaction`. 3 files, 610+/113-.                                                                                                                                       |
| B3    | `2f9307d00` | `WaitlistService.claimForApproval` (tx-aware claim) and deletion of `POST /v1/admin/waitlist/invite` + `WaitlistService.inviteBatch`. 12 files.                                                                                                                       |
| B4    | `8136e292d` | `EmailService.sendFoundingCohortWelcome` replaces `sendFoundingInviteEmail`, gated by the R3.6 source-text spec against `$`, `%`, `/pricing`, `promo=`, `discount`, `money-back`, `renew`. 2 files, 390+/89-.                                                         |
| B5    | `6eaae0175` | `WaitlistApprovalService` + `POST /v1/admin/waitlist/approve` — per-row transaction: claim → find-or-create user → 1y comp `builders` licence → `founding` cohort → stamp `approvedAt` → `waitlist.approve` audit row; one welcome mail post-commit. 14 files, 1791+. |
| B6    | `ede6bb2ac` | Admin UI: approve replaces invite. `WaitlistInviteModal` and the comp-modal's waitlist branch deleted; per-row and bulk approve with an outcome tally; e2e spec swapped in one commit. 16 files, 1215+/702-.                                                          |
| B7    | (no commit) | Verification gate only — `test-report.md`.                                                                                                                                                                                                                            |

**Design properties that matter and are proven, not asserted:**

- The whole grant is **one transaction**. A cohort-assignment failure rolls back
  the licence, the user row, the `approvedAt` stamp and both audit rows. Nobody
  ends up holding a licence but missing from `founding`.
- **Exactly one email** per approval, sent post-commit, carrying the licence key.
  `grantInTx` has no mail side effect structurally, not conditionally.
- **`convertedAt` keeps exactly one writer** — the Paddle fan-out. Free grants
  stamp `approvedAt` instead, so they never pollute paid-conversion metrics.
- Per-row failures are **per-row outcomes** (`approved`, `already_approved`,
  `already_paid`, `not_found`, `failed`) on a `200`, never an HTTP status — one
  bad id in a batch of 50 does not hide the fate of the other 49. The single
  exception is an unprovisioned `founding` group, which throws before any row is
  touched.

### TASK_2026_202 — Curriculum restructure (DOCUMENTATION, 3 batches)

| Batch | Commit      | What landed                                                                                                                                                                                                                                                                                                                          |
| ----- | ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| B1    | `7257cbae1` | Seed curriculum restructured from 8 weekly modules to 10 daily modules across 5 domains; `discourse-export.json` topics, `MODULE_TITLES`, `CURRICULUM_TOPIC_IDS`, `map-topics.ts`, and the course description all moved together. The pre-existing "Week 7 Hardening" / "Hardening" title defect repaired in the same pass. 5 files. |
| B2    | `bf73ba610` | Seed spec coverage for the ten-day curriculum; closed the day-10 regex trap (a `Day 1` pattern that also matched `Day 10`). 1 file, 232+/52-.                                                                                                                                                                                        |
| B3    | `ee346fbde` | **C4's new capability** — cohort scheduling. `computeWeekdaySchedule` pure helper, `CourseScheduleService`, and the preview/apply route pair. 15 files, 2741+.                                                                                                                                                                       |

---

## 2. The founder decisions that shaped this

These were taken at Checkpoint 1 (2026-08-11) and **override the PM's
recommendations where they differ**. They are the reason several things look the
way they do, and a reviewer who does not know them will misread the diff.

### TASK_2026_201

- **C1 — delete the `Founding / Waitlist Invite` marketing template row, do not
  rewrite it.** The PM recommended rewriting it to free-cohort copy, justified by
  "the campaign sender keeps a usable founding template". Rejected: the founder
  stated he will not use the admin campaign sender for this cohort at all. A
  template nobody will send is not an asset. Delivered as a new forward-only
  migration with a keyed, idempotent `DELETE` — editing the applied
  `20260806000000_fix_founding_invite_offer_copy` was forbidden (per-migration
  checksum → forced database reset).
- **C2 — delete `POST /v1/admin/waitlist/invite` entirely** (PM Option A), along
  with `WaitlistService.inviteBatch`, the invite modal and the admin controls.
  The refined reasoning: the programme needs transactional outbound ("you're in,
  here's your key") and announcement outbound ("we start Monday"). The approval
  mail owns the first completely. `inviteBatch` is a **per-row mailer being asked
  to do a group job** — the wrong shape for the only work that remained. It was
  removed, not repointed. **Nothing in this task replaces the announcement
  channel**, by decision.
- **C3 — the welcome mail uses "keeps" framing, neither PM option.** Both offered
  options framed a gift as a countdown. The mail leads with what the member
  keeps — "Founding members keep the course, the recordings and the community for
  a full year — the two-week cohort is the live part, not the whole of it" — and
  puts the literal expiry date in the licence-details block lower down. Warm at
  the top, precise at the bottom.
- Comp licence duration is **`1y`**, not `30d`: a 30-day preset expires ~2 weeks
  after a 2-week cohort ends, yanking the course and forum archive away exactly
  when founding-member goodwill matters most. It costs nothing pre-checkout.
- **No correction wave** for already-notified rows — there are no real customers
  yet.

### TASK_2026_202

- **C1 — no seeded environments exist.** The founder has never run
  `seed-community` by hand; CI runs `prisma:generate` only. The 18-module overlay
  hazard is therefore **latent, not live**, and risk R2 dropped Critical → Low.
  The FR-IDEM-2 cleanup runbook still ships because it will be needed the first
  time anyone re-seeds a persistent database. **The seed gained no delete verb.**
- **C2 — the module table was amended**, replacing `task-description.md` §4. The
  5×2 symmetry was forcing it: Day 6 (Products) was thin after Day 5 built the
  same pattern one level up, and Day 10 (OAuth + encrypted storage + refresh +
  publish + failure paths, live, as the finale) was the most optimistic session
  in the plan with nowhere for overrun to go. Products folded into Day 5; the
  integration split across Days 9–10. The two changes balance exactly — no days
  gained or lost. Domains are now **deliberately uneven** (Domain modelling gets
  one day, AI + integrations gets three); the original evenness was tidiness, not
  weighting. Consequence worth keeping: the agent (Day 8) now lands _after_
  entitlements (Day 7), so its cost control enforces real plan limits.
- **C3 — cohort start is Tuesday 1 September 2026**, with a known and accepted
  consequence (see §5's runbook). A Monday 31 August start was shown to the
  founder and he supplied 1 September anyway. Because C4 makes rescheduling a
  single admin action, this is **a decision that can be revisited without a code
  change — not an oversight to re-raise.**
- **C4 — NEW capability added at the checkpoint, explicitly requested**: "an easy
  way to set the cohort start dates for this one and for future ones as well."
  One admin action takes a start date and sets `releaseAt` on every module in day
  order on weekday offsets. Keyed on a **course id**, not on this cohort, and it
  must not assume ten modules — cohort 2 is a new course row and must need no
  code change. The seed still never writes `releaseAt`; `ModuleLockService` was
  not modified.
- **C5 — gating is off by default.** The seed produces `releaseAt = null`, all
  modules open. Recorded explicitly so no implementer "helpfully" ships the first
  cohort pre-gated.

---

## 3. Verification — what the Batch 7 gate claimed, and what I re-checked

`test-report.md` reports PASS: 992/992 tests across 8 projects, 0 lint errors,
all five acceptance sweeps clean, Task 7.3 closed. I spot-checked rather than
rubber-stamped it. **Every claim I probed held.**

| Check                                                          | Result                                                                                                                                                                    |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `isBuildersMember` has exactly one implementation              | ✅ `libs/api/membership/src/lib/membership.service.ts:69`. All 30+ other hits are call sites, jest mocks, or prose. This task did not touch it, as Out-of-Scope required. |
| `buildersCheckoutEnabled` still `false` everywhere it ships    | ✅ `environment.ts:18` false, `environment.production.ts:15` false. `environment.checkout.ts:17` is `true` — correct, that is the dedicated checkout-mode env.            |
| `environment.checkout.ts` and the `checkout` targets intact    | ✅ File present; `apps/ptah-landing-page/project.json` has a `checkout` configuration on **both** `build` and `serve`.                                                    |
| Task 7.3's database evidence is a real database run            | ✅ **Independently reproduced.** See below.                                                                                                                               |
| Both new migrations contain no `DROP INDEX` on a `_trgm` index | ✅ Read both in full: one `ALTER TABLE … ADD COLUMN IF NOT EXISTS`, one keyed `DELETE`. Nothing else.                                                                     |

**Task 7.3 re-verification, done from scratch by me.** I did not take the report's
word for it. I created a throwaway database `ptah_tl_verify` inside the running
`ptah_postgres` container and ran the real `prisma migrate deploy` pathway — the
same command CI uses — against the full migration history:

- **23 migrations applied cleanly**, including both of this task's new ones.
  `_prisma_migrations` confirms `count = 23` finished.
- `waitlist.approved_at TIMESTAMP(3)` present, nullable, sitting alongside
  `converted_at` at matching precision.
- `member_group_assignments_group_id_fkey` **exists as a real Postgres
  constraint** (defined in `20260719160000_add_member_groups`). This is the
  mechanism Task 7.3's rollback proof used to force a genuine FK violation — so
  the failure it induced was a real constraint violation, not a simulated throw.
  A mock harness could not have named this constraint correctly.
- `marketing_campaign_templates` after migration holds 7 rows and
  **`Founding / Waitlist Invite` is not among them**; no surviving row carries
  founding/promo copy. C1's acceptance criterion is met against a real database.
- Scratch database dropped afterward; `\l` shows the original four
  (`postgres`, `ptah_db`, `template0`, `template1`). **`ptah_db` was never opened
  for write.**

**One accuracy note on the gate, not a defect in the code.** `test-report.md`
§3 quotes its command as `npx prisma migrate deploy --schema=…` run from the repo
root. That exact invocation **does not work in this repo** — Prisma 7 requires
`datasource.url` from `apps/ptah-license-server/prisma.config.ts`, and run that
way it fails with "The datasource.url property is required in your Prisma config
file". The correct invocation is from `apps/ptah-license-server/` so the config is
auto-discovered. The report's _substance_ is correct and I reproduced it; only the
quoted command line is wrong. Worth fixing if anyone copies it as a runbook step.

---

## 4. Everything still open

Stated plainly. None of this is softened, and none of it was closed by the Batch 7
gate.

### Blocking-ish (a human must do these before or at merge)

1. **Both migrations have never been applied to a real environment.** There is no
   `.env` in this worktree, so `prisma:migrate` cannot run here at all. They are
   proven against a throwaway database on the full migration history — that is
   real evidence, and it is not the same as having been deployed. **CI's
   `migrate deploy` is the actual gate.** `founder-setup-checklist.md` §2.4
   (`prisma:migrate:deploy` against production) is still unchecked.
2. **TASK_2026_202's exit gate is still open.** The `prisma:reset` + double
   `seed-community` regression against a persistent database has not been run.
   This is precisely the scenario C1 identified as the **latent** 18-module
   overlay hazard: the seed has no delete verb, so re-seeding a database that
   already holds the old 8-module curriculum is the failure path. Nobody has
   re-seeded a persistent database yet, which is the only reason this is not
   already broken. **This is why 202 stays `in_review`.**
3. **Playwright was never executed.** Not in Batch 6, not in Batch 7. The new
   `admin-waitlist-approve.spec.ts` has only ever been _collected_
   (`--list` shows both its cases among 30 tests across 7 files, with zero
   reference to the deleted `admin-founding-invites.spec.ts`). No
   `E2E_ADMIN_EMAIL` is configured and no live server is wired for headless CI in
   this worktree. **The approve flow has never run end-to-end against a real
   browser and a real server.**

### Accepted non-blockers, carried forward from Batch 6

These were reviewed and consciously accepted. Listing them so nobody rediscovers
them as surprises.

4. **Invited badge is `neutral`, not `info`.** `waitlist-pipeline.ts:384-389` —
   Converted→`success`, Approved→`info`, Invited→`neutral`. Invited is now a
   historical state, so it was demoted deliberately.
5. **`refreshTick` was removed from `admin-list.ts`** as dead code. Confirmed
   gone; nothing referenced it.
6. **There is no `stage:` preset filter, so the New and Approved tabs overlap.**
   `waitlist-pipeline.ts:82` carries a docblock sentence describing the accepted
   overlap and no filter code. A row can appear under both.
7. **A type-only `@nx/enforce-module-boundaries` disable** on the
   `WaitlistApprovalResponse` import in
   `apps/ptah-landing-page-e2e/src/specs/admin-waitlist-approve.spec.ts:1-16` —
   `import type` plus one `eslint-disable-next-line` with a docblock explaining
   why.

### Console chores with no code change

8. **The dead `FOUNDING35` / `FOUNDING50` Paddle discounts still need
   deactivating in the Paddle console.** `founder-setup-checklist.md:44` (§2.1),
   still unchecked. This was explicitly out of scope for this task and is not
   blocked by anything — it is a console chore nobody has done. It matters
   because the already-sent invite wave carried
   `dsc_01kz178gb27gbe49mz0g2cbs6g`, which matches **neither** live 70% discount
   recorded in the checklist. That wave is now a dead end in both directions,
   which is fine, but the discounts themselves are still live objects in Paddle.

### By design, not open

9. **`buildersCheckoutEnabled` remains `false`** in `environment.ts` and
   `environment.production.ts`, and that is the design, not an omission. Waitlist
   mode is a supported product state, not dead code — removing the client-side
   flag was floated earlier in the session and explicitly **rejected**. The
   launch flip stays `founder-setup-checklist.md` §2.5 and belongs to the
   founder, not to this task.
10. **No announcement channel was built.** C2 removed the per-row invite mailer
    and did not replace the group-announcement capability, by decision. If the
    founder wants a "we start Monday" mail to the whole cohort, **it does not
    exist and nothing in this branch provides it.**

### ⚠️ One correction to the close-out brief

The brief stated that `docs/deploy/founder-setup-checklist.md` §2.5's launch-flip
steps "remain accurate". **They do not — not entirely.** The file was indeed not
updated by this task (confirmed: `git log 2ac5a8b45..HEAD -- docs/deploy/founder-setup-checklist.md`
is empty), and its two environment flips are still correct:

- `.env.prod`: `BUILDERS_CHECKOUT_ENABLED=true`
- `environment.production.ts`: `buildersCheckoutEnabled: true`

But §2.5's **third bullet is now stale**:

> - [ ] Admin → Waitlist → select founding wave → **Send Founding Invites**
>       (emails carry the discount checkout links; conversions stamp `convertedAt`
>       and auto-join the `founding` group).

**That control no longer exists.** Batch 6 deleted `WaitlistInviteModal` and the
invite buttons; Batch 3 deleted the endpoint behind them. An operator following
§2.5 literally at launch will look for a button that is not there. The step
should be either removed or rewritten to point at **Approve** — noting that
approve is the _free_ path and is not conditional on the checkout flip at all, so
it arguably does not belong in a launch-flip section in the first place. Left
unfixed here because the checklist was out of scope; **flagged so it is fixed
before launch rather than discovered during it.**

---

## 5. Operator runbook

Everything an operator needs, in one place.

### 5.1 Approving a founding cohort, end to end

**Prerequisite, and it is a hard one:** the `founding` member group must exist and
be provisioned. If it does not, the endpoint throws a sanitized `500`
**before any row is touched**, so no licence is issued for anyone in the batch.
This is deliberate — it fails closed. Create the group at `/admin/groups` first.

**From the admin UI** (the normal path, built in Batch 6):

1. Go to Admin → Waitlist.
2. Select rows — per-row approve, or tick a selection and bulk approve.
3. Confirm. The result is an **outcome tally**, not a success/failure banner:
   every row reports one of `approved`, `already_approved`, `already_paid`,
   `not_found`, `failed`. Read it. A batch can be partly applied and that is the
   designed behaviour, not an error.

**By API**, if you need it:

```
POST /api/v1/admin/waitlist/approve
Body: { "ids": ["<waitlistRowId>", ...] }   // 1..50 rows
```

Guards: `JwtAuthGuard` → `AdminGuard` → `AdminThrottlerGuard` (10/min per admin
email). The 50-row cap lives in the DTO, not the throttle, specifically so a
25-row cohort cannot trip a per-request limit halfway through and strand itself
half-approved. Always returns `200` once the body validates and the cohort
resolves.

**What each approved row gets, in one transaction:** the row is claimed, the user
is found or created, a **free 1-year `builders` complimentary licence** is issued
(`source: 'complimentary'`, so MRR dashboards filter it out), the `founding`
cohort is assigned, `approvedAt` is stamped, and a `waitlist.approve` audit row is
written. **After commit**, exactly one welcome email goes out carrying the licence
key. If any step fails, all of it rolls back — including the user row and both
audit rows.

The member then has the member panel, forum, course and live sessions **on
identical terms to a payer**, because `isBuildersMember` is satisfied by a
non-expired `builders` licence with no subscription.

### 5.2 Setting the ten release dates

**There is no admin UI for courses.** This is driven by `curl`. That is exactly
why the guard below exists.

**Step 1 — rehearse. This is the guard, not a convenience.**

```
POST /api/v1/admin/course-modules/schedule/preview
{
  "courseId":  "<course id>",           // NOT the slug; cohort 2 is a new course row
  "startDate": "2026-09-01",            // YYYY-MM-DD only — a datetime is rejected
  "timeOfDay": "18:00",                 // HH:mm, 24h — REQUIRED, deliberately undefaulted
  "timeZone":  "Europe/Berlin"          // IANA. The admin supplies it; it is NEVER inferred
}
```

Returns `200`, **writes nothing, audits nothing**. Run it as many times as you
like until the dates look right.

**Step 2 — apply, echoing back two values you can only get from the preview.**

```
POST /api/v1/admin/course-modules/schedule
{
  ... the same four fields ...,
  "confirmModuleCount":      10,
  "confirmLastReleaseDate":  "2026-09-14"
}
```

Both confirm fields are **required**. Sending a preview payload here is a `400`
for two missing keys; sending an apply payload to `/preview` is a `400` for two
non-whitelisted keys. The service re-compares both against a freshly computed
schedule **inside the transaction** before any write. One audit row
(`learning.module.schedule`) on success.

The failure mode this is shaped against is _a mis-typed start date silently
shifting ten member-visible dates_. A `confirm: true` boolean was rejected —
a boolean is satisfied by copy-paste. `confirmLastReleaseDate` cannot be supplied
correctly without having read a preview or done the weekday arithmetic by hand,
and **every plausible mis-typing of the start date moves the last date**: a wrong
year, a wrong month, a transposed `2026-01-09` for `2026-09-01`, an off-by-one
day. `confirmModuleCount` catches the other half: an admin who believes he is
scheduling ten modules and is in fact scheduling a course that has twelve.

**⚠️ The offsets are a function of the start weekday. They are not a constant.**
`task-description.md` §10 states them as a fixed list; that list is correct **only
for a Monday start**.

**Tuesday 1 September 2026 (C3, the current decision) yields:**

| Offset | `+0`      | `+1`  | `+2`  | `+3`  | `+6`      | `+7`  | `+8`  | `+9`   | `+10`  | `+13`          |
| ------ | --------- | ----- | ----- | ----- | --------- | ----- | ----- | ------ | ------ | -------------- |
| Day    | 1         | 2     | 3     | 4     | 5         | 6     | 7     | 8      | 9      | 10             |
| Date   | Tue 1 Sep | Wed 2 | Thu 3 | Fri 4 | **Mon 7** | Tue 8 | Wed 9 | Thu 10 | Fri 11 | **Mon 14 Sep** |

So Days 1–4 fall in week 1, Days 5–9 in week 2, and **Day 10 sits alone on Monday
14 September** — the finale isolated on a third week after a weekend. This is
**known and accepted**, not an oversight.

**A Monday 31 August 2026 start would instead give a clean 5+5 across exactly two
weeks, ending Friday 11 September.** The founder was shown this and supplied
1 September. Because scheduling is now one admin action, changing it is a
re-run of the two calls above — **no code change**. Re-scheduling is recoverable.

Weekends are skipped. A Saturday or Sunday start is **rejected outright**, not
rolled forward. A non-existent calendar date (`2026-02-30`) is rejected by the
helper even though it passes the DTO's shape regex.

To unschedule a single module afterwards: `PATCH /v1/admin/course-modules/:id`
with `releaseAt: null`. Per-module manual overrides survive and are only clobbered
by a deliberate re-schedule.

---

## 6. What a reviewer should look at first

In order:

1. **`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts`** —
   the transaction boundary is the whole design. Everything else composes
   pre-existing primitives.
2. **The two migrations** in `apps/ptah-license-server/prisma/migrations/2026091109*` —
   they are the only irreversible thing on this branch and the only part not yet
   applied to a real environment.
3. **`libs/api/learning/src/lib/common/weekday-schedule.ts`** — the offsets are a
   function of the start weekday, and the fixed table in `task-description.md`
   §10 contradicts it. The code is right and the older doc is wrong.
4. **`docs/deploy/founder-setup-checklist.md` §2.5** — stale third bullet, see
   §4's correction.

---

**Prepared by**: team-leader (MODE 3).
**Working tree**: clean at close.

---

## 7. Merge-back addendum — 2026-08-11, §4's three blockers closed

`ak/founding-cohort-free-access` was merged into
`ak/license-server-validation-pipe` (merge commit on that branch; the eight
add/add conflicts were all `.ptah/specs/TASK_2026_20{1,2}/` files created
independently on both sides — resolved in favour of this branch, which is the
only side carrying the batch, test and completion reports, then re-formatted
with prettier). **Both carriers moved `in_review` → `done`.**

### 7.1 Blocker 1 — migrations applied to a real database ✅

`npx prisma migrate deploy` from `apps/ptah-license-server/` (the invocation
§3 corrected) against the running `ptah_db`:

- Both migrations applied. `_prisma_migrations` now reports **23 finished**.
- `waitlist.approved_at TIMESTAMP(3)` present and nullable, beside
  `converted_at`.
- `marketing_campaign_templates` holds 7 rows and **`Founding / Waitlist
Invite` is not among them** — C1 met against a persistent database, not a
  throwaway one.

### 7.2 Blocker 2 — TASK_2026_202's exit gate, and a correction to C1 ⚠️→✅

**C1 was wrong, and the runbook said so in print.** "Which environments hold
the 8-week course: none" was derived from CI and deploy evidence only. Nobody
queried the running dev database — and it held `week-1` … `week-8`. The 18-module
overlay was therefore **live, not latent**, and running `seed-community`
reproduced it exactly as §2 of the runbook predicts:

| Run | Result                                                                        |
| --- | ----------------------------------------------------------------------------- |
| 1   | modules created 10 / updated 0 → **18 modules and 18 lessons in the course**  |
| 2   | modules created **0** / updated 10 — FR-IDEM-1 holds on a persistent database |
| 3   | created 0 / updated 10, after cleanup — tombstones are not resurrected        |

Cleanup used the **production** procedure, not `prisma:reset`: the eight
`week-N` modules and their lessons were soft-deleted (`deleted_at`,
`deleted_by = 'curriculum-reseed-runbook'`), leaving **10 live / 8 tombstoned**.
`prisma:reset` was rejected — it would have destroyed the dev users, licences
and the single waitlist row, none of which the gate needs. A `pg_dump` custom
backup was taken first (`tmp/ptah_db_pre_seed.dump`, gitignored).

`docs/community/curriculum-reseed-runbook.md` §1 was rewritten to state this,
with a one-line probe so the next person checks the database rather than the
pipeline.

### 7.3 Blocker 3 — Playwright executed ✅

`admin-waitlist-approve.spec.ts`, real Chromium against the dev SPA on :4200 and
the license server on :3000: **2 passed (28.5s)**. Both cases reach the real
admin surface through the real server-side `ADMIN_EMAILS` guard; only the
side-effecting `POST /approve` is route-stubbed, by design, so no licence was
issued and no mail was sent.

**It skipped on the first attempt, and that was the real finding.**
`E2E_ADMIN_EMAIL` has been in `.env` all along, but `support/env.ts` returns a
parsed object and never populates `process.env` — which is what every admin
spec guards on. The suite reported `2 skipped`, which reads as green.
`global-setup.ts` now bridges `E2E_*` keys from `.env` into `process.env`
(prefix-scoped on purpose: `.env` carries a second `DATABASE_URL` pointing at
the Neon production branch). Re-run with no shell export: **2 passed.**

### 7.4 Regression sweep

`nx run-many -t test` across the 11 projects the merge touches —
`ptah-license-server`, `api-{admin,audit,community,email,learning,licensing,marketing,notifications}`,
`api-contracts-community`, `web-admin`: **1,662 tests, 0 failures.**

### 7.5 What §4 leaves open after this pass

Unchanged and still **not** closed by any of the above:

- **Production `migrate deploy`** — `founder-setup-checklist.md` §2.4. A launch
  step, not a task gate.
- **The `FOUNDING35` / `FOUNDING50` Paddle discounts** — §2.1, still a console
  chore nobody has done.
- **No announcement channel** — C2, by decision.
- **The approve transaction has never run for real.** Every proof of it is a
  unit test or a stubbed route. The one local waitlist row is a real address, and
  approving it would issue a real licence and send real mail, so it was left
  alone. **The first genuine execution will be the founding wave itself.**

§4's stale-`§2.5` correction is now applied: the launch flip no longer lists the
deleted **Send Founding Invites** control, and approval moved to its own §2.6
with the `founding`-group prerequisite stated first.

**Addendum by**: merge-back verification pass, 2026-08-11.
