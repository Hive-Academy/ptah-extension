# Batch 5 — Approve endpoint, audit action, stats, structural guards

**Task**: TASK_2026_201 · **Branch**: `ak/founding-cohort-free-access`
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Satisfies**: R1, R2, R4.5, R5, R6.1–R6.3, R7, R8 · C2 (server half), C3 (the fixed `1y` grant)
**Status**: complete, **uncommitted** — the team-leader owns commits.

Every path below is relative to the worktree root above.

---

## 1. File-by-file

### Created (4)

| File                                                                         | What it is                                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts`        | The response contract (§4 of the plan): `WAITLIST_APPROVAL_OUTCOMES`, `WaitlistApprovalOutcome`, `WaitlistApprovalErrorCode`, `WaitlistApprovalRowResult`, `WaitlistApprovalResponse`. Carries the argument for why it does **not** live in `libs/api-contracts/community`. |
| `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts`      | The orchestrator. Owns `SkipRow`, `holdsPaidEntitlement`, the per-row loop, the transaction boundary, the post-commit mail, the per-row log line and the wave summary.                                                                                                      |
| `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts` | 27 tests over the whole taxonomy and every rollback case (§5).                                                                                                                                                                                                              |
| `libs/api/admin/src/lib/admin-waitlist.controller.ts`                        | **Re-created.** The class Batch 3 deleted carried `POST /waitlist/invite`; this one carries `POST /waitlist/approve` and shares nothing with it but the URL prefix.                                                                                                         |

### Modified (10)

| File                                                                | Change                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/audit/src/lib/audit-log.types.ts`                         | `+ \| 'waitlist.approve'` on `AdminAuditAction`, with the R7 argument (it names the waitlist row **and** the cohort, which `license.complimentary.issue` structurally cannot). `'waitlist.invite'` **kept** and annotated as historical-with-no-writer. `targetType: 'Waitlist'` already existed and was not re-added. |
| `libs/api/admin/src/lib/admin.dto.ts`                               | `+ ApproveWaitlistDto`. (`InviteWaitlistDto` was already deleted in Batch 3 — nothing to remove.)                                                                                                                                                                                                                      |
| `libs/api/admin/src/lib/admin.module.ts`                            | `AdminWaitlistController` back in `controllers`; `WaitlistApprovalService` added to `providers`. `imports` **unchanged**. Docblock: `FOUR CONTROLLERS, ONE SERVICE` → `FIVE CONTROLLERS, TWO SERVICES`; the "`WaitlistModule` has no consumer" note is deleted because it now has one.                                 |
| `libs/api/admin/src/index.ts`                                       | `+ admin-waitlist.controller`, `+ waitlist-approval.service`, `+ waitlist-approval.types`.                                                                                                                                                                                                                             |
| `libs/api/admin/src/lib/admin.service.ts`                           | R4.5: `AdminStatsResponse.waitlist.approved: number`; one extra `waitlist.count({ where: { approvedAt: { not: null } } })` in the existing `$transaction([…])`, positioned between `notified` and `converted`.                                                                                                         |
| `libs/api/admin/src/lib/admin-models.config.ts`                     | `waitlist`: `listFields` += `approvedAt`; `sortableFields` += `approvedAt`; `filterableFields` += `approved: { type: 'datePresence', column: 'approvedAt' }`. **`editableFields` unchanged** — reasoning inline (see §7).                                                                                              |
| `libs/api/admin/src/lib/admin.service.spec.ts`                      | `build()` gains a required `approved`; the positional `waitlist.count` mock gains a fifth stage; new test `counts the free-grant stage as ONE aggregate, disjoint from converted`. **One latent bug fixed** — see §8.                                                                                                  |
| `apps/ptah-license-server/src/testing/controller-registry.ts`       | `admin/AdminWaitlistController` entry restored (+ import). The deletion comment is rewritten rather than removed, so the register/deregister/re-register history stays readable.                                                                                                                                       |
| `apps/ptah-license-server/src/common/route-map.spec.ts`             | `EXPECTED_ROUTES` += `'POST v1/admin/waitlist/approve'` in the same alphabetical slot the invite route vacated (array **139 → 140**); prose ledger set to **140**, counted from the array, which also closes an off-by-one inherited from before this task (§4).                                                       |
| `apps/ptah-license-server/src/common/controller-validation.spec.ts` | `MIN_TOTAL_PAYLOAD_PARAMS` **79 → 80** with a new dated ledger block.                                                                                                                                                                                                                                                  |

**Not touched**, deliberately: `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` (§9), `libs/web/admin/**` (Batch 6), `docs/deploy/e2e-test-handoff.md`, `ComplimentaryLicenseResult`, `MembershipService`.

---

## 2. The transaction boundary — exactly what is inside and what is outside

```
approve(ids, actor)
│
├─ requireGroupByKey('founding')          ← ONCE PER REQUEST, OUTSIDE, BEFORE THE LOOP
│                                            hard-fails ⇒ no licence for ANY row (R1.5)
│
└─ for (const id of ids)                  ← SEQUENTIAL. never Promise.all.
   │
   ├─ computeComplimentaryExpiresAt('1y') ← OUTSIDE the tx (a 400 must precede every write)
   │
   ├─ withLicenseKeyRetry(               ← the retry wraps the WHOLE transaction
   │    () => prisma.$transaction(tx => { ══════════ INSIDE ══════════
   │           1. waitlist.claimForApproval(tx, id)   ← FIRST WRITE, the idempotency key
   │           2. license.findOrCreateUserByEmail(email, tx)
   │           3. holdsPaidEntitlement(tx, userId)
   │           4. license.issueComplimentaryLicenseTx(tx, …)
   │           5. memberGroups.assignInTx(tx, …)
   │           6. auditLog.write({ tx, action: 'waitlist.approve', … })  ← NO try/catch
   │         })                            ═══════════════════════════
   │  )
   │
   └─ email.sendFoundingCohortWelcome(…)  ← POST-COMMIT, OUTSIDE. one message. best-effort.
```

**Why each line sits where it does**

- **The group lookup is outside and before the loop.** Inside the loop it would issue licences for rows 1..k−1 and then fail — the partial cohort R1.5 exists to prevent. `requireGroupByKey` has no `isDefault` fallback and the spec proves it adversarially (§5, test 2).
- **The claim is the first write inside.** So a rollback at step 4, 5 or 6 releases it and leaves `approvedAt` null and the row re-approvable (R5.5). A claim taken outside would permanently poison a row whose grant then failed.
- **The audit is inside with no `try/catch`** (R2.2, PRE-6). This is the deliberate inversion of the deleted invite writer, which swallowed audit failures _because the invite mail had already gone out_. Here nothing has gone out when the audit runs, so an unrecorded grant has no upside.
- **The retry is around `$transaction`, never inside it.** On PostgreSQL a statement error inside an open transaction aborts the session (`25P02`); a P2002 caught inside could not be retried there — the next statement would fail for an unrelated reason while the code still _looked_ like it retried. Wrapping the whole transaction also buys R5.6 free: a re-entered attempt starts from a fully rolled-back predecessor, so two licences are unreachable.
- **The mail is outside, after commit.** Resend cannot un-accept a message, and holding the transaction across `sendWithRetry`'s three attempts would pin a connection for the retry window. Grant authoritative, mail advisory.
- **Rows are sequential.** 50 concurrent interactive transactions would exhaust the connection pool. Per-row _isolation_ is the requirement; per-row parallelism is not. This is asserted, not asserted-in-prose: the harness tracks peak concurrent `$transaction` calls and pins it at 1.

---

## 3. The outcome taxonomy — where each value is produced

| Outcome            | Produced by                                                                           | Persists                                    | Audit row                                                             | Mail           |
| ------------------ | ------------------------------------------------------------------------------------- | ------------------------------------------- | --------------------------------------------------------------------- | -------------- |
| `approved`         | the transaction commits                                                               | licence + assignment + `approvedAt` + audit | ✅ `waitlist.approve` (+ `license.complimentary.issue` from the core) | ✅ exactly one |
| `already_approved` | `claimForApproval` returns `count = 0` → `throw new SkipRow('already_approved', row)` | nothing (rolled back)                       | ❌                                                                    | ❌             |
| `already_paid`     | `holdsPaidEntitlement(tx, userId)` true → `SkipRow('already_paid', row)`              | nothing (`approvedAt` stays null)           | ❌                                                                    | ❌             |
| `not_found`        | `findUnique` returns null → `SkipRow('not_found')`                                    | nothing                                     | ❌                                                                    | ❌             |
| `failed`           | any non-`SkipRow` throw out of the retry (incl. P2002 after 3 attempts)               | nothing                                     | ❌                                                                    | ❌             |

**`SkipRow` is a private sentinel class in `waitlist-approval.service.ts`.** Throwing it is the _mechanism_ by which the transaction is rolled back — Prisma rolls back iff the callback rejects, so a skip decided _inside_ the callback has to leave by throwing or the claim would commit on a row we then report as skipped (R5.5 inverted). It is never an `HttpException`, is caught immediately outside `$transaction`, and cannot reach the client.

**The claim, not the licence table, is the idempotency key.** `issueComplimentaryLicenseTx`'s conflict guard filters `source: { not: 'complimentary' }`, so "does this user already hold a licence?" answers _no_ for someone already holding a comp grant and would issue a second one silently. That is why the guard lives on `Waitlist.approvedAt`.

**`already_paid` has two clauses.** (1) an active non-complimentary `builders` licence — R5.4 verbatim; (2) a subscription in `('active','trialing')` — a deliberate superset, because `MembershipService.isBuildersMember` checks the subscription _first_, so a Paddle subscriber with a missing or mis-sourced licence row is already a paying member and would otherwise get a free year plus a "you're in, it's free" mail on top of a subscription they pay for. It only widens `already_paid`; it never contradicts R5.4. A `past_due` or `canceled` subscriber is deliberately _not_ caught — that is who a grant is for, and there is a test for it.

**`stackOnTopOfPaid` is never passed on this path.** Verified by a spy on `issueComplimentaryLicenseTx` asserting the param is `undefined`, not by grepping (the identifier appears in explanatory comments).

**Errors carry a code only.** `error: { code: 'GRANT_FAILED' }` and `warning: { code: 'APPROVAL_EMAIL_FAILED' }` — no `message` field exists on either. Tests assert the underlying text (`'deadlock'`, `'member_group_assignments'`, `'Resend'`) is absent from `JSON.stringify(response)` **and** present in the server-side error log.

---

## 4. The `dtoPipe` binding, and the guard numbers

```ts
@Post('approve')
@HttpCode(200)
@UseGuards(AdminThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })
async approveWaitlist(
  @Req() req: Request,
  @Body(dtoPipe(ApproveWaitlistDto)) body: ApproveWaitlistDto,
): Promise<WaitlistApprovalResponse>
```

Class-level `@UseGuards(JwtAuthGuard, AdminGuard)` is inherited. Actor resolved exactly as `admin-licenses.controller.ts:75-84` does: `req.user?.email ?? 'unknown'`, `req.ip`, and the `user-agent` header narrowed with `typeof … === 'string'`. The controller injects **only** `WaitlistApprovalService` — no `AuditLogService`, because the audit row belongs inside the service's transaction.

`ApproveWaitlistDto` = `ids!: string[]` with `@IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })`. No `@IsOptionalNotNull` (an absent `ids` must be a 400, R1.4). **No duration field** — the grant is always `1y`.

### Guard numbers before → after

| Guard                                                      | Before            | After   | Why                                                                                                                                                                                                                                                  |
| ---------------------------------------------------------- | ----------------- | ------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `route-map.spec.ts` `EXPECTED_ROUTES` (**the array**)      | 139               | **140** | `+ 'POST v1/admin/waitlist/approve'`. Counted from the literals: 140 entries, 140 unique, no duplicates. The exact-count assertion reads `EXPECTED_ROUTES.length`, so it tracks the array automatically.                                             |
| `route-map.spec.ts` prose ledger figure                    | 138 (one **low**) | **140** | Corrected to match the array. See the provenance note below — this closes an inherited off-by-one, and the +1 delta and the absolute figure are two different claims.                                                                                |
| `controller-registry.ts` `ALL_CONTROLLERS`                 | 4 admin entries   | **5**   | `admin/AdminWaitlistController` restored — required, because `route-map.spec.ts`'s barren-controller assertion demands every registered controller contribute ≥ 1 route, and conversely a route with no registry entry would leave the census wrong. |
| `controller-validation.spec.ts` `MIN_TOTAL_PAYLOAD_PARAMS` | 79                | **80**  | `+1` whole-object `@Body`. `73 + 1 = 74` whole-object, `74 + 6 = 80` total.                                                                                                                                                                          |
| `NAMED_PRIMITIVE_PARAM_COUNT`                              | 6                 | **6**   | The ids travel in a `@Body()`. A `@Query('ids')` would make the total read 80 against a named count of 7 and the arithmetic would not close.                                                                                                         |
| `UNVALIDATED_DEBT`                                         | `[]`              | `[]`    | Unchanged.                                                                                                                                                                                                                                           |

**80 was re-derived by the documented `9999` procedure, not assumed.** Setting the constant to `9999` and running the suite produced `Expected: >= 9999 / Received: 80`; the constant was then restored. Net effect of TASK_2026_201 on this constant is zero (80 → 79 → 80), but the two ledger entries are kept separate because they landed as separate commits and each had to be green alone — as the Batch 3 verification established, the assertion is `toBeGreaterThanOrEqual`, a floor rather than an exact count.

### ⚠️ Correction: the route-ledger figure, and a false claim in the first version of this report

**The first version of this report said the route total "was re-derived by hand" and gave 139. That was wrong on both counts, and the second half is the part that matters: the figure was not re-derived, it was incremented from the previous entry's 138.** `EXPECTED_ROUTES` actually holds **140**. The claim of provenance was stated in a file whose entire purpose is to be the honest census, in the block that carries the ⚠️ demanding re-derivation. Recorded here rather than quietly fixed, because a provenance claim that turns out to be untrue is worth more as a correction than as a deletion.

**What the count actually is**, verified three ways before the number was changed:

```
array   = 140   unique = 140   duplicates = []
prose   = 140   (agrees)
```

**The delta was right; the absolute was wrong.** The off-by-one is inherited, not introduced here — verified against git history:

| Commit                                                           | `EXPECTED_ROUTES` array | prose figure | gap   |
| ---------------------------------------------------------------- | ----------------------- | ------------ | ----- |
| `3db831d00^` (parent of this task's first commit — **pre-task**) | 138                     | 137          | −1    |
| `3db831d00` (B1)                                                 | 138                     | 137          | −1    |
| `8136e292d` (B4, immediately before this batch)                  | 139                     | 138          | −1    |
| this batch                                                       | **140**                 | **140**      | **0** |

So the prose had been running one low since before TASK*2026_201 touched the file. Every earlier entry recorded its \_delta* correctly; only the running absolute was short. `+1` for this batch was therefore correct and `139` was still the wrong answer.

**Closed forward, and earlier entries are deliberately NOT retro-edited.** Those entries were accurate statements about a then-miscounted array. Rewriting them would erase the record of when the drift existed and how long it survived — which is the only evidence that the file's own ⚠️ is a rule worth keeping rather than a platitude. The ledger now reads `… 137, 139, 138, 140`, and that discontinuity is intentional: it is the finding, not a typo to tidy. The new block says so at the point where someone would "fix" it.

**Why no test caught it, stated plainly.** The exact-count assertion reads `EXPECTED_ROUTES.length`, so it is structurally immune to the prose being wrong — the suite was green at 137, at 138 and at 140 alike. Nothing mechanical protects this figure; only the re-derivation the file demands. That is precisely how it drifted before (the 68-vs-64 incident the file already records) and how it drifted again here.

**Re-verified after the correction**: `npx nx test ptah-license-server` → **5 suites / 163 tests, unchanged**. The count not moving is the expected result and the confirmation that no assertion reads the prose figure. Prettier clean; the only change to the file is the docblock — no route literal was touched.

---

## 5. Tests — 27 new cases in `waitlist-approval.service.spec.ts`

**Harness**: real `LicenseService`, `WaitlistService` and `MemberGroupsService` over one shared Prisma mock whose `$transaction` runs the callback inline with the mock as `tx` (the `license.service.spec.ts:39-55` shape, extended with `waitlist`, `subscription`, `memberGroup` and `memberGroupAssignment` delegates). Only `EmailService` and `AuditLogService` are stubbed. Real collaborators are the point: the claims under test are "how many licence rows", "was the claim before the create", "did the retry make one licence or two" — all statements about _delegate_ calls, which a stubbed service cannot make.

`approveAuditCalls()` filters to `action === 'waitlist.approve'`, so the core's own `license.complimentary.issue` row is never miscounted as the approve row.

| Scenario (requirement)                            | Result | What it asserts                                                                                                                                                                                              |
| ------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Happy path (R1.1)                                 | ✅     | licence `builders`/`active`/`complimentary`/`createdBy`, expiry 365 d ± 1, the exact claim `where`/`data`, the exact cohort upsert, one mail with the key, `sendLicenseKey` **not** called                   |
| Audit row + metadata (R7.1)                       | ✅     | exactly one `waitlist.approve`, `arg.tx === prisma` (PRE-6), full R7 metadata incl. `userWasCreated`, `groupKey`, `wasNotified`, `cohortAlreadyAssigned`                                                     |
| Existing `User`                                   | ✅     | `user.create` not called, `userWasCreated: false`                                                                                                                                                            |
| `stackOnTopOfPaid` never passed (R5.4)            | ✅     | spy on `issueComplimentaryLicenseTx`, param `undefined`                                                                                                                                                      |
| **Sequential processing**                         | ✅     | peak concurrent `$transaction` = **1** across 3 rows (under `Promise.all` it would be 3)                                                                                                                     |
| Missing `founding` group (R1.5)                   | ✅     | throws `InternalServerErrorException`; **zero** `$transaction`, `license.create`, `waitlist.updateMany`, mail; `memberGroup.findFirst` **never called** although a usable default was wired in adversarially |
| Group resolved once per request                   | ✅     | `memberGroup.findUnique` called once for 3 rows, with the exact `where: { key: 'founding' }`                                                                                                                 |
| **Rollback on cohort-assign failure (R2.1)**      | ✅     | `license.create` **was** called (past step 5), the callback still threw out of `$transaction`, **no** `waitlist.approve` audit, **no** mail, outcome `failed` + `GRANT_FAILED`                               |
| …and it does not leak the cause                   | ✅     | `'deadlock'` / `'member_group_assignments'` absent from the payload, present in `logger.error`                                                                                                               |
| **Audit-write failure rolls the row back (R2.2)** | ✅     | outcome `failed`, no mail — proving the audit has no `try/catch` around it                                                                                                                                   |
| **Post-commit email failure (R2.3)**              | ✅     | outcome `approved`, `licenseId` present, `warning: { code: 'APPROVAL_EMAIL_FAILED' }`, **no** `error`, licence + cohort + audit all persisted, `'Resend'` absent from the payload and present in the log     |
| No licence key in any log or payload (R7.4)       | ✅     | neither the literal key nor `ptah_lic_` appears in `logs ∪ errorLogs`, in `JSON.stringify(response)`, or in the audit metadata                                                                               |
| **Double approval, sequential (R5.1)**            | ✅     | second call `already_approved`; exactly one licence, one assignment, one audit row, one mail                                                                                                                 |
| **Concurrent approval (R5.2)**                    | ✅     | outcomes sort to `['already_approved', 'approved']`; one `license.create`, one audit, one mail; **neither call throws**                                                                                      |
| No audit row for a skipped row (R7.3)             | ✅     | `audit.write` never called at all                                                                                                                                                                            |
| **`already_paid` via the licence clause (R5.4)**  | ✅     | outcome `already_paid`, no licence, no audit, no mail; the exact `findFirst` predicate incl. `source: { not: 'complimentary' }`                                                                              |
| **`already_paid` via the subscription clause**    | ✅     | run for both `active` and `trialing`; exact predicate asserted                                                                                                                                               |
| `past_due` is **not** `already_paid`              | ✅     | outcome `approved`                                                                                                                                                                                           |
| **Already-notified row (R6.1, R6.2)**             | ✅     | approved identically, `wasNotified: true` in the payload and the metadata, the only waitlist update names exactly `['approvedAt']` and its `where` has no `notifiedAt`                                       |
| `not_found` mid-batch (R1.6, R2.4)                | ✅     | `['approved','not_found','approved']`, `email: null`, no `wasNotified`, 2 licences, 2 mails                                                                                                                  |
| Hard failure on row 3 of 5 (R2.4)                 | ✅     | `['approved','approved','failed','approved','approved']`, 4 mails, 4 audit rows                                                                                                                              |
| **P2002 retried once (R5.6)**                     | ✅     | 2 `$transaction` calls, 2 `create` **attempts**, exactly **one** `waitlist.approve` audit row and **one** mail, and the two attempts used **different keys** (`new Set(keys).size === 2`)                    |
| P2002 exhausted after 3 attempts                  | ✅     | 3 `$transaction` calls, outcome `failed` + `GRANT_FAILED`, no mail — not a 500                                                                                                                               |
| Cohort already assigned (R5.3)                    | ✅     | still `approved`, `cohortAlreadyAssigned: true`, one upsert, no P2002 raised                                                                                                                                 |
| Wave summary + row lines (R7.5)                   | ✅     | one row line per row with `waitlistId` / `outcome` / `licenseId`; one summary with actor, `requested=2` and all five tallies                                                                                 |
| Tally always has five keys                        | ✅     | zeros included                                                                                                                                                                                               |

### Verification commands — all green

| Command                                                                                                                   | Result                                                                                                                           |
| ------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `npx nx test api-admin --skip-nx-cache`                                                                                   | ✅ 2 suites / **59 tests** (32 pre-existing + 27 new)                                                                            |
| `npx nx test ptah-license-server --skip-nx-cache`                                                                         | ✅ 5 suites / **163 tests** — **both structural guards green** (162 → 163: the new route adds one enumerated case)               |
| `npx nx run-many -t test -p api-audit,api-marketing,api-community,api-licensing,api-email --skip-nx-cache`                | ✅ Successfully ran for 5 projects (api-email 23 · api-audit 5 · api-community 455 · api-marketing 45 · api-licensing all green) |
| `npx nx run ptah-license-server:typecheck --skip-nx-cache`                                                                | ✅                                                                                                                               |
| `npx nx run-many -t typecheck -p api-admin,api-audit,api-licensing,api-marketing,api-community,api-email --skip-nx-cache` | ✅ 6 projects                                                                                                                    |
| `npx nx run ptah-license-server:"eslint:lint" --skip-nx-cache`                                                            | ✅ **0 errors**, 2 warnings (`jest.config.ts`, `instrument.ts` — pre-existing, untouched)                                        |
| `npx nx run-many -t "eslint:lint" -p api-admin,api-audit --skip-nx-cache`                                                 | ✅ **0 errors, 0 warnings**                                                                                                      |
| `npx prettier --check` on all 14 changed/created files                                                                    | ✅ (one reformat applied to the new spec, then re-tested green)                                                                  |

### Acceptance sweeps

- `inviteWaitlist|InviteWaitlistDto` — **zero executable server references.** Three ledger-comment hits in `controller-validation.spec.ts`, one in the new `audit-log.types.ts` annotation, and two in `libs/web/admin` (Batch 6's scope).
- `waitlist/invite` — every hit is prose or Batch 6/e2e scope: four deliberate ledger comments (`controller-registry.ts`, `route-map.spec.ts` ×2, `controller-validation.spec.ts`), the `schema.prisma` docblock, the new controller's own docblock explaining what it replaces, `libs/web/admin` (Batch 6), `apps/ptah-landing-page-e2e` (§9) and `docs/deploy/e2e-test-handoff.md`. **No server-side executable code references it.**
- `isBuildersMember` — exactly **one** implementation (`libs/api/membership/src/lib/membership.service.ts:69`). R7.2's standing gate holds.

---

## 6. Corrections to `tasks.md` this batch confirms

The Batch 3 report's § A.4 was right on every point, and the dispatch brief's corrections were the ones actually needed:

- **5.5** — `InviteWaitlistDto` was already gone; only `ApproveWaitlistDto` was added.
- **5.6** — `inviteWaitlist` was already gone, and so was the whole controller file. This batch **created** `admin-waitlist.controller.ts` from scratch and re-registered it in `admin.module.ts`, `index.ts` and `controller-registry.ts` — three registrations Task 5.6 does not mention because it assumed the class survived.
- **5.12** — an **add**, not a swap. The array goes 139 → **140**; the prose ledger is set to **140** by counting, not by incrementing (§4), because it had been one low since before this task.
- **5.13** — 79 → **80**, not "stays 78". Verified by the `9999` procedure.

---

## 7. Two judgement calls worth a reviewer's attention

**`approvedAt` is deliberately NOT in `editableFields`** (Task 5.10 said so; the reason is now inline in `admin-models.config.ts`). `notifiedAt` and `convertedAt` are _records_ of things that happened elsewhere, so hand-correcting them fixes bookkeeping. `approvedAt` is not a record — it **is** the idempotency claim. An admin stamping it by hand would fake a grant with no licence, no cohort placement and no audit row, _and_ would make the real approval report `already_approved` forever. Clearing it by hand is equally unnecessary: a rolled-back attempt already leaves it null (R5.5).

**`WaitlistApprovalService` is a second service, not a method on `AdminService`.** `AdminService` is generic model CRUD plus bulk email over nine models; this owns one transactional workflow spanning four libs and a five-value taxonomy. Folding it in would give `AdminService` a second reason to change and put a transaction boundary inside a class whose other methods have none. Recorded in the module docblock.

---

## 8. One latent bug found and fixed while touching `admin.service.spec.ts`

The `counts active members by plan and recent signups by a 7-day window` test located the `last7Days` query as `prisma.waitlist.count.mock.calls[3]` — **by index**. Inserting the `approved` stage moved that call to index 4, and the test failed with `Cannot read properties of undefined (reading 'gte')`.

Bumping `3` to `4` would have been the wrong fix: the next stage inserted anywhere before it would silently make the assertion bind to a _different_ count rather than fail. It now locates the call **by predicate** (`arg.where.createdAt.gte instanceof Date`) and asserts the match was found. The reason is recorded at the call site so the next person does not re-index it.

---

## 9. Open / carried forward

1. **R2.1's database-level gate is still open, and this batch does not close it.** The harness proves every write goes through the `tx` handle and that the callback rejects out of `$transaction` — which is precisely what Prisma turns into a `ROLLBACK` — but a mock cannot roll back. The literal assertions R2.1 names (`license.count === 0` and `waitlist.approvedAt === null` afterwards) need a real Postgres. This is stated in the spec's own header docblock so no reader mistakes the mock claim for the database claim. Same item Batches 2 and 3 carried.

2. **`apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` — untouched, as instructed, and NOT broken by this batch.** Confirmed by `git status`: the file is not modified. Precisely:
   - It drives the **admin UI** and intercepts `**/api/v1/admin/waitlist/invite` with `page.route` at `:33` and `:70`, asserting the request _shape_ against a stubbed `{ invited, skipped }` response.
   - Because it stubs the route rather than calling the server, **nothing this batch did can affect it.** It was already hollow as of Batch 3 (the endpoint it guards has not existed since then) and it is still green for the same reason: it is a passing test guarding the wire shape of a deleted endpoint.
   - It will fail at **Batch 6**, which deletes `WaitlistInviteModal` and the `inviteWaitlist` client method it drives. Batch 4's recommendation stands and I concur: delete it in the same change that deletes the modal. It cannot be repointed — the approve flow has different request and response shapes and its own coverage here.

3. **`AdminStatsResponse.attention.waitlistUninvited` now points at a retired action** ("uninvited" implied "go invite them"). Untouched and out of scope, as the plan records; relabelling the Overview tile is a follow-up.

4. **Batch 6 inherits a live route and a live response type.** `POST /api/v1/admin/waitlist/approve` returns `WaitlistApprovalResponse`, exported from `@ptah-api/admin`. The client mirror belongs in `admin-api.service.ts` as a Zod schema per the house convention, and `adminStatsWaitlistSchema` needs `approved: z.number().optional()` for the new stat.

**Nothing in this batch is incomplete.** No stubs, no TODOs, no placeholder data. No git operations performed.

---

## 10. Standards compliance

- Every `catch` is `catch (error: unknown)` narrowed with `instanceof Error` before `.message`. Three added, all in `waitlist-approval.service.ts`.
- No `process.env` anywhere; no config read was needed on this path (the group key and the duration preset are compile-time constants, not configuration — making either configurable would put the cohort's identity behind an env var, which is the failure R1.5 forbids).
- No raw library `error.message` reaches a client: both client-facing shapes are `{ code }`-only, asserted by test.
- No licence key in any log line, response payload or audit metadata — asserted by test.
- `libs/api/**` imports only `@nestjs/*` and `@ptah-api/*`; no `libs/backend/**`, no `libs/frontend/**`. **No new module edges**: `libs/api/admin` already depended on audit, community, core, email, identity, licensing and marketing, and `MemberGroupsModule` is `@Global()`.
- No `@ts-ignore`, no `@ts-expect-error`, no `any` in production code. The spec's mock casts are `as unknown as X`, which is why `api-admin` lints at zero warnings.

---

## Team-Leader Verification

**Verdict: REJECTED** — on exactly one item (§4's route ledger). Every functional
invariant in this batch is correct and is proven load-bearing by mutation. Nothing
below asks for a code change; the single defect is a prose count in a file whose
stated purpose is being the honest census.

### The four ship-breaking invariants — verified by reading AND by mutation

Six mutations were applied to the production code one at a time, each run against
`api-admin` / `ptah-license-server`, each reverted byte-identical afterwards
(`diff` against a pre-mutation copy, confirmed clean).

| #   | Mutation applied                                                                                 | Should break             | Result                                                                                                                         |
| --- | ------------------------------------------------------------------------------------------------ | ------------------------ | ------------------------------------------------------------------------------------------------------------------------------ |
| M1  | `try/catch` swallowing the cohort-assign failure inside `grantInTx`, so the grant commits anyway | rollback (R2.1)          | ✅ **2 tests failed** — `reaches the licence create, then rolls the whole row back…` + `does not leak the underlying message…` |
| M2  | `sendFoundingCohortWelcome` moved INSIDE `grantInTx`; post-commit send removed                   | post-commit email (R2.3) | ✅ **1 test failed** — `keeps the grant, reports approved with an APPROVAL_EMAIL_FAILED warning`                               |
| M3  | row loop swapped to `Promise.all(ids.map(…))`                                                    | sequential processing    | ✅ **2 tests failed** — `processes rows SEQUENTIALLY — never more than one transaction open` + the R7.5 observability line     |
| M4  | `requireGroupByKey` moved inside the row loop                                                    | R1.5                     | ✅ **1 test failed** — `resolves the cohort ONCE per request, not once per row`                                                |
| M5  | `@Body(dtoPipe(ApproveWaitlistDto))` → bare `@Body()`                                            | the validation guard     | ✅ **2 tests failed** in `ptah-license-server` — `admin/AdminWaitlistController` + the aggregate unbound-payload view          |
| M6  | nesting inverted to `$transaction(tx => withLicenseKeyRetry(…))`                                 | R5.6                     | ✅ **2 tests failed** — `retries the WHOLE transaction on P2002…` + `gives up after 3 attempts and reports failed, not a 500`  |

**Neither of the two hardest tests is cosmetic.** M1 and M2 each fail them, and each
fails them for the stated reason rather than incidentally.

1. **Transaction boundary (R2)** — CONFIRMED by reading `grantInTx`
   (`waitlist-approval.service.ts:287-376`): claim → find-or-create user → paid guard
   → licence → cohort → audit, every one on `tx`, `this.prisma` touched nowhere inside.
   The email is in `approveOne` at `:248-264`, after `withLicenseKeyRetry` has returned.
   M2 proves the ordering is enforced, not merely documented.
2. **`withLicenseKeyRetry` wraps `$transaction`** — CONFIRMED at `:199-203`. Additionally
   verified in `license.service.ts:523-551` that it retries **only** `P2002` and rethrows
   everything else on the first attempt — so `SkipRow` is never retried and a skip costs
   exactly one transaction, not three. M6 proves the nesting is pinned.
3. **Sequential** — CONFIRMED: `for (const id of ids) { results.push(await …) }` at
   `:160-162`. No `Promise.all` / `allSettled` / `race` anywhere in the production path
   (the three grep hits are the spec harness and the explanatory comment). M3 proves it.
4. **Idempotency key is the waitlist row** — CONFIRMED. `claimForApproval` is the first
   statement in `grantInTx`, and `waitlist.service.ts:242-245` is a conditional
   `updateMany({ where: { id, approvedAt: null } })`. M1 proves a rollback releases the
   claim: with the cohort failure swallowed the row commits and the rollback tests fail,
   so those tests are genuinely asserting the release rather than passing vacuously.

### Also verified

5. **R1.5** — `requireGroupByKey(FOUNDING_GROUP_KEY)` at `:152-153`, once, before the
   loop. `member-groups.service.ts:194-213` has **no `isDefault` fallback** — it throws
   `InternalServerErrorException({ code: 'COHORT_NOT_CONFIGURED' })` with a static
   sanitized message. M4 pins the once-per-request property.
6. **`stackOnTopOfPaid`** — never passed on this path. The only production hits in
   `libs/api/admin` are `admin-licenses.controller.ts` (a different endpoint) and the
   explanatory comment at `:319`. The core's `EXISTING_ACTIVE_LICENSE` guard is left
   armed as the second line of defence.
7. **`dtoPipe` binding** — bound at the parameter decorator itself,
   `admin-waitlist.controller.ts:94`. `@ArrayMaxSize(50)` present; **no duration field**
   on the DTO — `'1y'` is the module constant `APPROVAL_DURATION_PRESET`. M5 proves the
   structural guard actually catches an unbind on this specific controller.
8. **Audit (R7)** — written inside the row transaction via `tx`, no `try/catch`
   (`:347-368`). Skipped rows throw `SkipRow` _before_ the audit statement is reached, so
   no row is written for them. Metadata carries `licenseId`, never `licenseKey`. No log
   line interpolates the key: `logRow` takes `licenseId`, the send-failure log takes
   address + cause, the wave summary takes neither. The core's own
   `license.complimentary.issue` metadata (`license.service.ts:624-638`) is likewise
   key-free.
9. **Client-facing errors** — `WaitlistApprovalRowResult.error` / `.warning` have no
   `message` member at the type level, so a leak would not compile. Both `error.message`
   reads (`:219`, `:255`) terminate in `logger.error`.
10. **R4.5** — one `waitlist.count({ where: { approvedAt: { not: null } } })` added to the
    existing `$transaction([…])` in `admin.service.ts`. One aggregate, not a query per row.
11. **R6** — `claimForApproval` writes `data: { approvedAt: new Date() }` and nothing else;
    no other waitlist write exists on this path. `notifiedAt` is read for `wasNotified`
    (payload + audit metadata) and never modified.

### Whole-tree gate — all green

- `nx run-many -t test -p ptah-license-server,api-admin,api-marketing,api-community,api-licensing,api-email,api-audit` → **7/7 projects**, `api-admin` 59/59, `ptah-license-server` 163/163 with both structural guards green.
- `nx run ptah-license-server:typecheck` → ✅
- `nx run ptah-license-server:"eslint:lint"` → ✅ 0 errors, 2 warnings, both unused-disable directives in `jest.config.ts` and `instrument.ts`, neither touched by this batch.

### The one defect — §4's route ledger is 140, not 139

`MIN_TOTAL_PAYLOAD_PARAMS = 80` **is** correct and the report's derivation claim holds:
setting it to `9999` and running the suite produced `Expected: >= 9999 / Received: 80`,
reproduced here. That number is accepted.

The route-map prose total is not. `EXPECTED_ROUTES` actually holds **140** elements after
this batch, not 139. Counted three independent ways — bracket-matched parse of the array
body with `//` comments stripped, a line-start `'<VERB> ` match, and a duplicate check
(none; no block comments inside the array to confuse either parse).

Array length across this task's commits:

| Commit             | `EXPECTED_ROUTES.length` | prose ledger    |
| ------------------ | ------------------------ | --------------- |
| `3db831d00` B1     | 138                      | 137             |
| `79a735f65` B2     | 138                      | 137             |
| `ee346fbde` 202 B3 | 140                      | 139             |
| `2f9307d00` 201 B3 | 139                      | 138             |
| `8136e292d` B4     | 139                      | 138             |
| worktree B5        | **140**                  | **139** ← wrong |

The −1 **predates TASK_2026_201**: at B1 the array already held 138 against a prose figure
of 137. Every entry since, this one included, has applied a correct delta to a stale base.
So Batch 5's arithmetic (138 + 1) is right and its _result_ is wrong.

Why this is a rejection rather than a note: §4 of this report states the total "was
re-derived by hand," and it was not — a hand re-derivation from the array yields 140 and
would have closed the inherited drift. This is the same failure this file already suffered
once (it read 68 against an actual 64 until TASK_2026_177 Batch 6 caught it), and the
docblock Batch 5 edited carries the ⚠️ demanding re-derivation in every batch that moves
the number. Committing as-is writes a false provenance claim into history and hands Batch 6
a base that is still one low.

### To clear this rejection

1. In `apps/ptah-license-server/src/common/route-map.spec.ts`, change the new ledger entry
   from **139** to **140**, and state that the figure is a re-derivation from the array
   rather than `138 + 1`.
2. Record in that entry that the running total had been one low since before this task —
   the array held 138 at `3db831d00` while the prose read 137 — so the correction is
   `139 + 1 = 140` against the array, and closes an inherited off-by-one rather than
   introducing a jump. Do not retro-edit the earlier entries; this file's convention is to
   record corrections forward, not overwrite history.
3. Correct §4 of this report to match.
4. Re-run `nx test ptah-license-server` (expected: still 163/163 — no assertion reads the
   prose figure, which is precisely why it drifted).

No other change is requested. `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts`
was confirmed unmodified and remains a Batch 6 ruling. No commit was made.

---

## Rejection resolved — route ledger corrected to 140

**All four items addressed. No code changed; the edit is confined to one docblock.**

1. **`route-map.spec.ts` ledger entry: 139 → 140.** Done.
2. **Stated as a re-derivation FROM THE ARRAY.** The entry now says so explicitly, records
   the counted result (140 entries, 140 unique, no duplicates), and names `138 + 1 = 139`
   as the wrong method that produced the wrong answer — so the next reader can see which of
   the two procedures is authoritative.
3. **Inherited off-by-one closed FORWARD; no earlier entry retro-edited.** Verified against
   git that the drift predates the task: at `3db831d00^` — the parent of this task's first
   commit — the array already held 138 against a prose figure of 137. The ledger now reads
   `… 137, 139, 138, 140`, and the new block states in place that the discontinuity is the
   finding and must not be tidied away.
4. **§4 of this report corrected**, including an explicit retraction: the first version
   claimed the figure "was re-derived by hand" when it was incremented from 138. That is
   written as a correction rather than a silent overwrite, since the report is the
   provenance record and a false provenance claim is the thing being fixed.
5. **`npx nx test ptah-license-server` → 5 suites / 163 tests, unchanged**, exactly as
   predicted. The count not moving is the confirmation that no assertion reads the prose
   figure — which is why it could drift undetected in the first place.

Also re-checked: `npx prettier --check` on the file passes, the diff touches no route
literal (docblock only), and `git status` shows the same ten modified and four new paths as
the accepted batch — nothing else moved.
`apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` remains **unmodified**
and still needs its Batch 6 ruling. No commit made.
