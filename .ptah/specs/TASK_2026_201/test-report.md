# Test Report — TASK_2026_201, Batch 7 (Verification Gate)

**Role**: senior-tester, MODE — verify only, no new feature code. Fixes applied are limited to
what a failing sweep required (none did).
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access`
**Base state**: all six prior batches committed (`3db831d00` … `ede6bb2ac`), working tree clean
except the two untracked `.ptah/specs/` task folders (`TASK_2026_201`, `TASK_2026_202`).
**Commits made by this batch**: none (verification only; team-leader owns commits).

**HEADLINE: PASS. All eight full-repo gates green, all five acceptance sweeps clean, Task 7.3
(R2.1 rollback) CLOSED with real-database evidence. Nothing open, nothing at risk beyond the
already-accepted non-blockers carried forward from B1–B6.**

---

## 1. Full-repo run — actual numbers

All commands run with `--skip-nx-cache`, fresh, in this worktree.

### 1.1 Test

| Project               | Suites | Tests   | Result              |
| --------------------- | ------ | ------- | ------------------- |
| `ptah-license-server` | 5      | 163     | ✅ PASS             |
| `api-admin`           | 2      | 59      | ✅ PASS             |
| `api-licensing`       | 5      | 73      | ✅ PASS             |
| `api-marketing`       | 5      | 45      | ✅ PASS             |
| `api-community`       | 19     | 455     | ✅ PASS             |
| `api-email`           | 2      | 23      | ✅ PASS             |
| `api-audit`           | 1      | 5       | ✅ PASS             |
| `web-admin`           | 11     | 169     | ✅ PASS             |
| **Total**             | **50** | **992** | **✅ 992/992 PASS** |

Command: `npx nx run-many -t test -p ptah-license-server,api-admin,api-licensing,api-marketing,api-community,api-email,api-audit,web-admin --skip-nx-cache`

**Bonus sanity check — `api-learning` (the concurrent TASK_2026_202 workstream, named in the
dispatch prompt though not in `tasks.md`'s own Task 7.1 gate, which names `api-audit` instead)**:
22 suites / 548 tests, ✅ PASS. Not part of this task's scope; run only to confirm the two
concurrent workstreams did not corrupt each other's state in the shared worktree. `tasks.md`'s
Task 7.1 command block is the canonical gate for TASK_2026_201 and is the one reported above;
`api-audit` is directly affected by this task (Batch 5 added `'waitlist.approve'` to
`AdminAuditAction`), `api-learning` is not.

### 1.2 Typecheck

| Project                                                                                                                      | Result                                                                                                                     |
| ---------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `ptah-license-server`, `api-admin`, `api-licensing`, `api-marketing`, `api-community`, `api-email`, `api-audit`, `web-admin` | ✅ 8/8 pass (`npx nx run-many -t typecheck -p …`)                                                                          |
| `ptah-landing-page`                                                                                                          | ✅ pass (`npx nx run ptah-landing-page:typecheck`, run separately — it is an app, not in the `web-admin` lib run-many set) |

### 1.3 Lint (`eslint:lint` — the inferred target; confirmed `ptah-license-server/project.json` has

no `lint` target, only `test`/`typecheck`/`prisma:*`/`build`/`serve`/etc., so `nx lint
ptah-license-server` genuinely does not exist and `eslint:lint` is correct)

| Project               | Errors | Warnings | Notes                                                                                                                                           |
| --------------------- | ------ | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `ptah-license-server` | 0      | 2        | pre-existing, unused eslint-disable in `jest.config.ts` / `instrument.ts`                                                                       |
| `api-admin`           | 0      | 0        |                                                                                                                                                 |
| `api-licensing`       | 0      | 1        | pre-existing, `auth.controller.ts:593`                                                                                                          |
| `api-marketing`       | 0      | 11       | pre-existing, `no-explicit-any` in 4 files this task never touched                                                                              |
| `api-community`       | 0      | 0        |                                                                                                                                                 |
| `api-email`           | 0      | 3        | pre-existing, `no-explicit-any` in sibling `email.service.spec.ts`                                                                              |
| `api-audit`           | 0      | 0        |                                                                                                                                                 |
| `web-admin`           | 0      | 8        | pre-existing (`$any` in `admin-detail.html`, accessibility modifiers in `delete-user-modal.ts`, one `any` in `issue-comp-license-modal.ts:232`) |
| **Total**             | **0**  | **25**   | **0 errors anywhere; every warning traced to a file this task did not touch, or already flagged pre-existing by an earlier batch**              |

### 1.4 Build

`npx nx build ptah-landing-page --skip-nx-cache` → ✅ PASS. `waitlist-pipeline` lazy chunk
19.66 kB. Two budget warnings (initial bundle 318 kB over 1 MB budget; FullCalendar CSS 16.71 kB
over 4 kB budget) — both pre-existing, unrelated to this task's chunks, confirmed by B6's report
and re-confirmed here (they are the same two warnings, same numbers).

---

## 2. The five acceptance sweeps

### Sweep 1 — `rg -n "sendFoundingInvite|getFoundingInviteTemplate|buildFoundingCheckoutUrl" libs apps`

```
libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts:247:  'buildFoundingCheckoutUrl',
libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts:248:  'getFoundingInviteTemplate',
libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts:249:  'sendFoundingInvite',
```

**PASS.** All three hits are the R3.6 source-text guard's own needle list (the control that
proves the deletion, not a survival of the deleted code). Zero definitions, zero call sites.

### Sweep 2 — `rg -n "promo=founding" libs/api/email/src`

All hits confined to `founding-cohort-welcome.spec.ts` (the reconstructed-deleted-copy
anti-vacuity fixture, the guard needle, and the sweep-predicate string). **PASS** — no template
carries it.

### Sweep 3 — `rg -n "70%|\$87|\$8\.70|off the first year" libs/web/admin`

No matches. **PASS.**

### Sweep 4 — `rg -n "inviteWaitlist|InviteWaitlistDto|waitlist/invite" libs apps` (excepting the

historical `'waitlist.invite'` union member and migration files)

Every remaining hit is a deliberate historical comment, verified line by line:

| File                                                                                | What it is                                                                                           |
| ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `apps/ptah-license-server/src/testing/controller-registry.ts:251`                   | ledger comment recording the deletion                                                                |
| `apps/ptah-license-server/src/common/route-map.spec.ts:258,590`                     | ledger comment + slot-reservation comment                                                            |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts:310,311,316,319` | ledger comment naming the deleted DTO/handler for the arithmetic                                     |
| `apps/ptah-license-server/prisma/schema.prisma:466`                                 | the `Waitlist` docblock naming the retired route as history (flagged in advance by B1's team-leader) |
| `libs/api/admin/src/lib/admin-waitlist.controller.ts:31`                            | the re-created controller's own docblock explaining what it replaces                                 |
| `libs/api/audit/src/lib/audit-log.types.ts:24-25`                                   | comment on the `'waitlist.invite'` union member, annotated historical-with-no-writer                 |
| `libs/web/admin/src/lib/services/admin-api.service.ts:451`                          | docblock naming the retired path for context                                                         |

**Zero executable references anywhere.** `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts`
(the one prior batches flagged as unowned) is confirmed deleted — Batch 6 landed both halves of
the e2e swap in one commit — and does not appear in this sweep at all. **PASS.**

### Sweep 5 — `rg -n "isBuildersMember" libs` — R7.2's standing gate

Exactly **one implementation**: `libs/api/membership/src/lib/membership.service.ts:69`,
`async isBuildersMember(userId: string): Promise<boolean>`. Every other hit (23 total) is a call
site, a jest mock property, or prose in `README.md` — confirmed by reading each. **PASS. This
task did not touch `MembershipService.isBuildersMember`, as the Out-of-Scope line required.**

---

## 3. Task 7.3 — R2.1 rollback proof against a REAL database — **CLOSED, PASSED**

**Method.** Created a throwaway database inside the already-running `ptah_postgres` container
(`docker ps` showed it healthy; the shared `ptah_db` was never touched), following the exact
precedent Batch 1 and TASK_2026_202 Batch 2 used:

```
docker exec ptah_postgres psql -U ptah -d ptah_db -c "CREATE DATABASE ptah_b7_scratch;"
DATABASE_URL=postgresql://ptah:ptah_dev_password@localhost:5432/ptah_b7_scratch \
  npx prisma migrate deploy --schema=apps/ptah-license-server/prisma/schema.prisma
```

**All 23 migrations applied cleanly**, including both of this task's new ones
(`20260911090000_waitlist_approved_at`, `20260911090100_remove_founding_waitlist_invite_template`)
— against the **full real migration history**, not a partial scratch reconstruction. This is
strictly stronger evidence than B1 had (B1 proved the two files against a hand-seeded partial
schema); it closes the residual risk B1's team-leader named explicitly ("the pair has not been
applied through Prisma's own `migrate` pathway against a database holding the full real migration
history"). `ptah_db` — the shared, concurrently-used database — was never opened for write.

**The proof itself.** A throwaway Jest spec (`apps/ptah-license-server/src/testing/task-7-3-rollback-proof.spec.ts`,
written, run, then **deleted** — not part of any commit) instantiated the real production classes
(`PrismaService` with the real `PrismaPg` driver adapter, `LicenseService`, `WaitlistService`,
`MemberGroupsService`, `AuditLogService`, `EventsService`) directly against the scratch database,
with only `EmailService` stubbed (a jest.fn — never reachable on this failure path regardless,
since `grantInTx` has no email side effect). It called the actual private `grantInTx` method —
the same method `WaitlistApprovalService.approveOne` calls in production — wrapped in the same
`prisma.$transaction(tx => …)` shape, and forced the cohort-assignment step to fail with a
**genuine Postgres foreign-key violation**: a well-formed but non-existent `groupId` was passed to
`assignInTx`, so its `memberGroupAssignment.upsert` hit the real
`member_group_assignments_group_id_fkey` constraint — not a simulated throw.

**Result: PASSED, all assertions green, against the real database, post-rollback:**

| Assertion                                                                                                                                | Result                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| The transaction call rejected                                                                                                            | ✅ threw                                                                                                                                                                                                        |
| `License` rows for this request's user                                                                                                   | ✅ **0**                                                                                                                                                                                                        |
| `Waitlist.approvedAt`                                                                                                                    | ✅ **still `null`**                                                                                                                                                                                             |
| `admin_audit_log` rows with `action='waitlist.approve'` for this row                                                                     | ✅ **0**                                                                                                                                                                                                        |
| `admin_audit_log` rows with `action='license.complimentary.issue'` (bonus — proves the _whole_ row rolled back, not just the outer half) | ✅ **0**, despite the service's own log line ("admin audit log recorded … action: license.complimentary.issue") firing during the transaction — the log fires on write, the DB row did not survive the rollback |
| `MemberGroupAssignment` rows for this user                                                                                               | ✅ **0**                                                                                                                                                                                                        |
| `User` row created by `findOrCreateUserByEmail` (step 2, inside the same transaction)                                                    | ✅ **0** — rolled back too                                                                                                                                                                                      |
| `EmailService.sendFoundingCohortWelcome` invocations                                                                                     | ✅ **not called**                                                                                                                                                                                               |
| The row is re-approvable afterward (the claim — the FIRST write — also released)                                                         | ✅ a second `claimForApproval` call on the same row returned `outcome: 'claimed'`                                                                                                                               |

Jest run: `6 suites / 165 tests` (the 163 pre-existing plus the 2 new cases in the throwaway
spec), all passing, `--skip-nx-cache`.

**Cleanup, confirmed:** the throwaway spec file was deleted; `ptah_b7_scratch` was dropped
(`DROP DATABASE ptah_b7_scratch`); `docker exec … psql -c "\l"` afterward shows only
`postgres`, `ptah_db`, `template0`, `template1` — the pre-existing four, unchanged. `git status`
in the worktree is clean except the two untracked `.ptah/specs/` task folders. No `.env` was
created; no `prisma:reset` or `prisma:migrate dev` was run against `ptah_db`.

**R2.1 (Task 7.3) is therefore CLOSED, not open.** This was the one stated exit criterion the
mock harness could not prove (Batches 2, 3 and 5 all recorded it as the standing open item); it is
now proven against a real transactional Postgres database, on the full migration history, with
the exact production code path.

---

## 4. Carried-forward items — confirmed still true

### 4.1 B1's `prisma:migrate` was never run against the shared dev DB

**Confirmed still true** — no `.env` exists in this worktree (only `.env.example` /
`.env.prod.example`), so a bare `nx run ptah-license-server:prisma:migrate` still fails at config
load exactly as B1 described. CI's `migrate deploy` remains the real gate for the shared/prod
database. **Strengthened, not just reconfirmed**: §3 above ran the real `prisma migrate deploy`
pathway — the same command CI uses — against a database seeded with the full pre-existing
migration history, and both new migrations applied cleanly. That was the one piece B1 could not
close; it is closed now, on a throwaway database, per this batch's mandate.

**No `DROP INDEX` on any `_trgm` index, either migration** —
`rg -riE "drop[[:space:]]+index" apps/ptah-license-server/prisma/migrations/20260911090000_waitlist_approved_at/migration.sql apps/ptah-license-server/prisma/migrations/20260911090100_remove_founding_waitlist_invite_template/migration.sql`
→ no matches (exit 1). Both files were also read in full: one `ALTER TABLE … ADD COLUMN`, one
`DELETE FROM`, nothing else.

**No already-applied migration was edited** —
`git diff --stat 3db831d00^ HEAD -- .../20260806000000_fix_founding_invite_offer_copy/ .../20260902090000_packs_visibility_and_notifications/`
→ empty. Byte-identical from before this task's first commit to `HEAD`.

### 4.2 Playwright was never executed in B6 — confirm it still collects

`npx playwright test --list --grep @p0 --config=apps/ptah-landing-page-e2e/playwright.config.ts`
→ **30 tests across 7 files**, including both `admin-waitlist-approve.spec.ts` cases
(`per-row approve posts { ids } with exactly that row`,
`bulk approve posts the selection and shows every outcome in the tally`), and **zero** reference
to the deleted `admin-founding-invites.spec.ts`. Not executed against a live server — no
`E2E_ADMIN_EMAIL` is configured in this worktree, and the brief instructed against attempting a
full run unless already wired for headless CI here (it is not). Collection-only, as B6 also did.

### 4.3 The four accepted B6 non-blockers — verified in the actual code, not re-litigated

| Item                                                                                       | Verified as                                                                                    | Where                                                                      |
| ------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Invited badge `info` → `neutral`                                                           | ✅ true — `stageVariant`: Converted→`success`, Approved→`info`, Invited→`neutral`, New→`ghost` | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:384-389`             |
| `refreshTick` removed from `admin-list.ts`                                                 | ✅ true — `grep -n "refreshTick" admin-list.ts` returns nothing                                | `libs/web/admin/src/lib/admin-list/admin-list.ts`                          |
| No `stage:` preset filter, New/Approved overlap accepted                                   | ✅ true — only a docblock sentence describing the accepted overlap; no filter code             | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts:82`                  |
| Type-only `@nx/enforce-module-boundaries` disable on the `WaitlistApprovalResponse` import | ✅ true — `import type` + one `eslint-disable-next-line` with the docblock explaining why      | `apps/ptah-landing-page-e2e/src/specs/admin-waitlist-approve.spec.ts:1-16` |

All four are exactly as described in the batch reports. None reopened.

---

## 5. Success Metrics — filled in with actual values

| Metric                                                                   | Target    | Actual | Evidence                                                                                                                                                                                                                                                             |
| ------------------------------------------------------------------------ | --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live code paths that mail a founding price or a checkout link            | 0         | **0**  | Sweeps 1–2 (§2); `sendFoundingCohortWelcome` is the only outbound mail on the approval path and is source-text-gated against `$`, `%`, `/pricing`, `promo=`, `discount`, `money-back`, `renew` (R3.6, Batch 4)                                                       |
| Admin actions required to take a waitlist row to a fully entitled member | 1         | **1**  | `POST /v1/admin/waitlist/approve` is the only path; `WaitlistInviteModal` and the comp-modal's waitlist branch are both deleted (Batch 6)                                                                                                                            |
| Emails received by an approved member per approval                       | exactly 1 | **1**  | `grantInTx` has no mail side effect (structurally, not conditionally); `approveOne` sends exactly one `sendFoundingCohortWelcome` post-commit, carrying the licence key; `sendLicenseKey` is never called on this path                                               |
| Approved members holding a licence but missing from `founding`           | 0         | **0**  | R2's transaction boundary, proven against a real database in Task 7.3 (§3): a cohort-assignment failure rolls back the licence too, not just itself                                                                                                                  |
| Free grants counted in the paid-conversion metric                        | 0         | **0**  | `convertedAt`'s sole writer is `WaitlistService.markConverted`, called only from `paddle.service.ts:173` (the Paddle fan-out); `createComplimentaryLicense` and the approve path both call `markApproved` instead — confirmed by repo-wide grep, no second writer    |
| Approvals reaching the founding cohort without an audit row              | 0         | **0**  | The `waitlist.approve` audit write sits inside the transaction with no `try/catch` (R2.2); Task 7.3 proves a failed cohort assignment rolls the audit write back along with everything else, so a row can only reach the cohort with its audit row already committed |

---

## 6. Explicit list of anything open or at risk

**Nothing is open.** Every item this batch was chartered to verify passed:

- Full-repo test/typecheck/lint/build: **all 8 canonical projects green**, 992/992 tests, 0 lint
  errors.
- All five acceptance sweeps: **clean**.
- Task 7.3 (R2.1 real-database rollback): **CLOSED, PASSED** — the one item every prior batch
  (B2, B3, B5) explicitly left open is now proven.
- Migration safety (`_trgm`, no edited history, syntactic validity against the full chain):
  **confirmed, and strengthened** via a real `migrate deploy` run.
- Playwright collection: **confirmed**, still hollow-free (no reference to the deleted spec).
- The four B6 non-blockers: **confirmed as-described**, not reopened.

**Residual items that were already accepted as non-blockers in earlier batches and remain exactly
that** (not new, not reopened, listed here only because the brief asked for an explicit list):

1. Playwright was never run end-to-end against a live server in this worktree (no
   `E2E_ADMIN_EMAIL`, no running landing page / license server wired for headless CI here). This
   was the standing gate for the whole `describe` block before this task and is unchanged by it.
2. `AdminStatsResponse.attention.waitlistUninvited` still names a retired action ("uninvited"
   implied "go invite them") — cosmetic, recorded by B5 as a follow-up, out of scope here.
3. `docs/deploy/founder-setup-checklist.md`'s dead `FOUNDING35`/`FOUNDING50` Paddle-console
   discount deactivation — explicitly out of scope per `task-description.md`, unblocked but not
   performed by design.

None of these three block sign-off; they were named out-of-scope or pre-existing follow-ups by
the task description or by earlier batches, and this gate does not add anything new to the list.
