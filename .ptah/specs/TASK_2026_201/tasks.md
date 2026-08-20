# Development Tasks — TASK_2026_201

**Founding cohort free access — approve a waitlist row to a complimentary Builders licence**

**Total Tasks**: 41 | **Batches**: 7 | **Status**: 6/7 complete

**Worktree root**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access` (based on `ak/license-server-validation-pipe` @ `2ac5a8b45`)

**Authority**: `implementation-plan.md` is THE authority for _how_. This file formalizes its
§7 file-by-file plan and §9 batch order into executable batches. Where this file and the plan
appear to differ, the plan wins — raise it, do not improvise.

**Binding founder decisions** (`context.md` §Checkpoint 1 outcomes, CLOSED — do not re-ask):

- **C1** — the `Founding / Waitlist Invite` marketing template row is **DELETED**, not rewritten (Batch 1).
- **C2** — `POST /v1/admin/waitlist/invite`, `WaitlistService.inviteBatch`, the invite modal and
  the admin UI controls are **DELETED entirely** (Batches 3, 5, 6).
- **C3** — the welcome mail leads with the **scope framing** ("Founding members keep the course,
  the recordings and the community for a full year — the two-week cohort is the live part, not
  the whole of it"), with the literal expiry date lower down in the licence-details block (Batch 4).

**CLI delegation is DISABLED** for this orchestration (Checkpoint 0.1). Every batch below names a
sub-agent developer type. No batch may be dispatched to `codex`, `ptah-cli`, `gemini` or any other
CLI agent — billing/licensing/membership logic plus customer-facing copy is exactly the tightly
coupled, shared-context case the heuristics say to keep in one sub-agent.

---

## Plan Validation Summary

**Validation Status**: PASSED WITH RISKS — no blockers. The architect resolved the one delegated
decision (R2 mechanism) explicitly and evidenced every claim with `file:line`. Decomposition
proceeds unchanged.

### Assumptions verified against the plan's own evidence

| Assumption                                                                                                                                                        | Status                                                                                                                                                                                                               |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/admin` already imports audit, community, core, email, identity, licensing, marketing — so approve needs **zero new module edges**                       | Verified, plan §0 dependency table                                                                                                                                                                                   |
| `MemberGroupsModule` is `@Global()` and exports `MemberGroupsService`                                                                                             | Verified, `member-groups.module.ts:24-31`; live injection at `admin.service.ts:143`                                                                                                                                  |
| `AuditLogService.write({ tx })` is the only tx-injection pattern in this server                                                                                   | Verified, `audit-log.service.ts:74` (`const client = tx ?? this.prisma`)                                                                                                                                             |
| `MarketingCampaign.template` FK is `onDelete: SetNull`, so deleting the template row is history-safe                                                              | Verified, `schema.prisma:451`                                                                                                                                                                                        |
| `license.service.spec.ts`'s `$transaction` mock passes the prisma mock itself as `tx` — so moving the conflict guard onto `tx` leaves existing assertions binding | Verified, `license.service.spec.ts:39-55`                                                                                                                                                                            |
| Nx project names for the verification commands                                                                                                                    | Verified in-worktree: `api-{admin,licensing,marketing,community,email,audit}`, `web-admin`, `ptah-license-server`. Lint target is `eslint:lint` (inferred by `@nx/eslint/plugin`, `nx.json:84-87`) — **not** `lint`. |

### Risks carried into the batches

| Risk                                                                                                                                                                  | Severity | Owning batch | Mitigation                                                                                                                        |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------- | ------------ | --------------------------------------------------------------------------------------------------------------------------------- |
| `prisma migrate diff` emits three unrequested `DROP INDEX` on `_trgm` GIN indexes                                                                                     | HIGH     | B1           | Task 1.2/1.3 — hand-author both files; strip any `DROP INDEX … _trgm`                                                             |
| A migration timestamp that sorts before an already-applied migration                                                                                                  | MED      | B1           | Task 1.2 — check `_prisma_migrations` before naming the folders                                                                   |
| The (b) refactor silently breaks the P2002 retry (aborted-transaction trap)                                                                                           | HIGH     | B2           | Task 2.1 — retry wraps the **whole** `$transaction`; Task 2.2 asserts one licence after a retried attempt                         |
| `route-map.spec.ts` `EXPECTED_ROUTES` + exact-count assertion fails the build on drift                                                                                | HIGH     | B5           | Task 5.12 — swap, do not add/remove                                                                                               |
| `controller-validation.spec.ts` `MIN_TOTAL_PAYLOAD_PARAMS` "fixed" by editing the number                                                                              | HIGH     | B5           | Task 5.13 — the number **stays 78**; a failure means a mis-bound route                                                            |
| `WaitlistInviteModal` has a **second consumer** at `admin-list.ts:30,49` (+ `admin-list.html:79`) gated on `supportsWaitlistInvite` (`admin-models.config.ts:75,560`) | HIGH     | B6           | Tasks 6.3 + 6.8 + 6.9 must land in the **same commit**                                                                            |
| Deleting the comp-modal `email` input breaks a surviving `[email]` binding                                                                                            | MED      | B6           | Task 6.6 — only `waitlist-pipeline.html:212` and `admin-detail.html:67` bind it; both deleted in 6.5/6.7. Grep `\[email\]=` after |
| Server/client deploy skew on the new `approved` stat                                                                                                                  | LOW      | B6           | Task 6.1 — `.optional()` + `?? 0`, following the `attention` precedent                                                            |
| Source-text sweep passes vacuously (finds no files)                                                                                                                   | MED      | B4           | Task 4.2 — assert the sweep found ≥ 1 file first, per `controller-validation.spec.ts:524-547`                                     |

### Edge cases that must be handled, and where

- [ ] `already_approved` on a second claim (`count === 0`) → Tasks 5.3, 5.4
- [ ] `already_paid` via **both** the licence clause and the subscription clause → Tasks 5.3, 5.4
- [ ] `not_found` mid-batch, remaining rows still processed, HTTP 200 → Tasks 5.3, 5.4
- [ ] Cohort assignment already present (P2002 / upsert) → Tasks 3.3, 3.4
- [ ] `founding` group missing ⇒ hard 500 **before any row is touched**, no `isDefault` fallback → Tasks 3.3, 5.3
- [ ] Post-commit mail failure ⇒ `approved` + `APPROVAL_EMAIL_FAILED`, grant intact → Tasks 5.3, 5.4
- [ ] Rollback after the claim leaves `approvedAt` null and the row re-approvable → Tasks 5.3, 5.4
- [ ] `notifiedAt` row approved identically, `notifiedAt` untouched, `wasNotified: true` audited → Tasks 5.3, 5.4
- [ ] `FRONTEND_URL` unset ⇒ CTA is `https://ptah.live/members`, never relative → Tasks 4.1, 4.2
- [ ] Tab overlap (a `filter` is one `field:value` pair) is accepted; the stage chip renders on **every** tab so the overlap self-explains → Task 6.5

### Blockers found

None. The three founder questions are closed; the architect raised none.

---

## Standing rules for every batch

1. **No git commits by the developer.** Team-leader commits after the reviewer returns APPROVED.
2. **No stubs, no `// TODO`, no placeholders, no hardcoded mock data.** Every file ships real code.
3. `catch (error: unknown)` narrowed with `instanceof Error`. No `@ts-ignore` (only `@ts-expect-error` + reason).
4. All config through `ConfigService`. Never `process.env[...]` in `libs/api/**`.
5. Angular: signals + `inject()`, `ChangeDetectionStrategy.OnPush` mandatory (B6).
6. Boundaries: `libs/api/**` must not import `libs/backend/**` or `libs/frontend/**`.
7. **Never edit an already-applied migration file.** Forward-only, new folders.
8. Licence keys never appear in a log line, in audit metadata, or in an HTTP payload.
9. Read `## Plan Validation Summary` above before writing the first line of your batch.

### Lint command shape (this repo)

The lint target is named `eslint:lint`, so `nx lint <project>` does **not** exist here. Use:

```
npx nx run-many -t eslint:lint -p <projects>
```

---

## Batch 1 — Schema and migrations ✅ COMPLETE

**Commit**: `3db831d00` — `feat(license-server): add waitlist.approvedAt and remove founding invite template`
**Open follow-up (not a Batch 1 blocker)**: Task 1.4's `prisma:migrate` was NOT run — see
`batch-1-report.md` § Team-Leader Verification. Both files are proven applied-and-re-applied on a
scratch DB; only the `_prisma_migrations` bookkeeping row is outstanding, and CI's
`prisma migrate deploy` is the real gate. Batch 2 is NOT blocked (its dependency is the regenerated
client, which is green).

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer` (re-invoked with the reviewer's issues)
**Execution Mode**: sequential
**Rationale**: Three coupled files with a hand-authoring hazard (`_trgm` drift) and an ordering
pre-check against `_prisma_migrations`. Small, but wrong-in-a-way-that-forces-a-DB-reset if split.
**Tasks**: 3 (+1 command step) | **Dependencies**: none — this is the root of the graph
**Satisfies**: R4.1, R10.1, R10.2, R10.3 (and C1)

### Task 1.1: Add `Waitlist.approvedAt` to the Prisma schema ✅ COMPLETE

**File**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort/apps/ptah-license-server/prisma/schema.prisma`
**Spec Reference**: implementation-plan.md §5 M1 · task-description.md R4
**Pattern to Follow**: the sibling `notifiedAt` / `convertedAt` fields in the same `Waitlist` block (`:463-474`)

**Quality Requirements**:

- `approvedAt DateTime? @map("approved_at")`, placed between `notifiedAt` and `convertedAt`.
- Rewrite the model docblock (`:459-462`) to state R4's **three disjoint writers**: `notifiedAt` =
  the retired paid invite, historical only, nothing writes it after this task; `approvedAt` =
  approve-to-cohort and comp-licence issuance; `convertedAt` = the Paddle fan-out only.

**Validation Notes**: no index, no default, no backfill. The table is small and
`waitlist_created_at_idx` already serves the ordering.

---

### Task 1.2: New migration — `waitlist_approved_at` ✅ COMPLETE

**File**: `…/apps/ptah-license-server/prisma/migrations/20260911090000_waitlist_approved_at/migration.sql`
**Dependencies**: Task 1.1
**Spec Reference**: implementation-plan.md §5 M1 · R4.1

**Quality Requirements**:

- `ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);` — nothing else.
- `TIMESTAMP(3)` matches `notified_at` / `converted_at` (`20260719120000_add_waitlist/migration.sql:6-8`).
- `IF NOT EXISTS` makes it re-runnable (NFR-Reliability).

**Validation Notes** (⚠️ both are build-breaking if ignored):

- **Hand-author this file.** If you generate a starting point with `prisma migrate diff`, it will
  emit three unrequested `DROP INDEX` statements on `community_posts_body_trgm`,
  `community_topics_title_trgm` and `course_lessons_title_trgm` — Prisma cannot express
  `gin_trgm_ops` and reads them as drift. `20260902090000_.../migration.sql:16-40` documents this.
  **Strip every `DROP INDEX … _trgm` line by hand.**
- Confirm against `_prisma_migrations` that nothing sorts between `20260902090000_…` and
  `20260911090000_…` before committing to the folder name.

---

### Task 1.3: New migration — delete the `Founding / Waitlist Invite` template ✅ COMPLETE

**File**: `…/apps/ptah-license-server/prisma/migrations/20260911090100_remove_founding_waitlist_invite_template/migration.sql`
**Dependencies**: Task 1.2 (ordering only)
**Spec Reference**: implementation-plan.md §5 M2 · R10 · context.md **C1**

**Quality Requirements**:

- `DELETE FROM "marketing_campaign_templates" WHERE "name" = 'Founding / Waitlist Invite';`
- Reproduce the plan's header comment verbatim in substance: why delete rather than rewrite (C1),
  why editing `20260806000000_fix_founding_invite_offer_copy/migration.sql` is FORBIDDEN
  (per-migration checksum → forced DB reset, that file's own header `:9-13`), why it is idempotent
  and uniform (`name` is UNIQUE, `schema.prisma:419` ⇒ deletes 0 or 1 rows), and why it is
  history-safe (`MarketingCampaign.template` is `onDelete: SetNull`, `schema.prisma:451`).
- Also record, in the header, why R10's "`ON CONFLICT ("name") DO UPDATE`, never `DO NOTHING`" rule
  is met in intent though not in letter: that rule exists because a `DO NOTHING` upsert cannot
  _reach_ an existing row; a keyed `DELETE` reaches it by construction, and there is no insert.
  **Say this before a reviewer reads R10 as unmet.**

**Validation Notes**: same `_trgm` hazard as 1.2. Hand-author.

---

### Task 1.4: Regenerate the client and apply ⚠️ PARTIAL — `prisma:generate` ✅, `prisma:migrate` OPEN

**Dependencies**: Tasks 1.1–1.3

```
npx nx run ptah-license-server:prisma:generate
npx nx run ptah-license-server:prisma:migrate      # dev; prisma migrate deploy in CI
```

---

**Batch 1 Verification** (each command must pass):

```
npx nx run ptah-license-server:prisma:generate
npx nx run ptah-license-server:typecheck
npx nx run ptah-license-server:test
```

- `rg -n "DROP INDEX" apps/ptah-license-server/prisma/migrations/20260911*` → **no matches**
- `git diff --stat apps/ptah-license-server/prisma/migrations/20260806000000_fix_founding_invite_offer_copy/` → **empty** (R10.3: previously-applied migrations byte-identical)
- Applying the new template migration twice is a no-op write (R10.2)

---

## Batch 2 — Licensing core: R2 mechanism (b) ✅ COMPLETE

**Commit**: `79a735f65` — `feat(license-server): extract the tx-aware complimentary licence core`
**Accepted scope bleed**: `WaitlistService.markApproved` (Task 3.1 bullet 1) landed in this commit —
`LicenseService` injects the **concrete** `WaitlistService`, so the R4.3 swap is a TS2339 without it.
Additive only; nothing Batch 3 owns was deleted. See Task 3.1's annotation.
**Correction to this block**: the verification list below said `npx nx lint ptah-license-server`.
That target does not exist in this repo — use `npx nx run-many -t eslint:lint -p api-licensing`
(the file's own "Lint command shape" section). Corrected in place.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: A single-file surgical refactor of the server's most safety-critical service, plus
its spec. The PostgreSQL aborted-transaction reasoning that rejects mechanism (a) has to be held in
one head while the code moves — this is the archetypal "keep it in shared context" batch.
**Tasks**: 2 | **Dependencies**: Batch 1 (needs the regenerated Prisma client for `approvedAt`)
**Satisfies**: R2 (mechanism), R4.3, R5.6, R7 (`userWasCreated` in metadata)

### Task 2.1: Extract the tx-aware licence-creation core ✅ COMPLETE

**File**: `…/libs/api/licensing/src/lib/license/services/license.service.ts`
**Spec Reference**: implementation-plan.md §1 · task-description.md R2 (mechanism (b)), R4.3
**Pattern to Follow**: `AuditLogService.write({ tx, … })` (`audit-log.service.ts:74`) — the only
tx-injection pattern in this server, and the one to copy.

**Quality Requirements** — four additions, exactly as §1 specifies:

- `computeComplimentaryExpiresAt(preset, customExpiresAt, now)` → **public** (was private `:406`).
  One definition of `'1y'` = `now + 365 * DAY_MS`.
- `findOrCreateUserByEmail(email, client?)` → **public**, accepts an optional
  `Prisma.TransactionClient`, returns `{ user, created }` (was private `:388`, returned `User`).
- `withLicenseKeyRetry<T>(fn)` → extracted **verbatim** from `:525-584`.
- `issueComplimentaryLicenseTx(tx, params)` → the core. In this order and nothing else:
  1. the conflict guard from `:501-524`, now reading through `tx`, unless `stackOnTopOfPaid === true`;
  2. `const licenseKey = this.generateLicenseKey()` — a **fresh key per call**;
  3. the `license.complimentary.issue` audit write via `this.auditLog.write({ tx, … })`,
     byte-for-byte the metadata at `:536-548`;
  4. `tx.license.create({ … source: 'complimentary' … })` from `:551-561`.
     It **sends no email, stamps no waitlist row, and never opens a transaction.**
- Rewrite `createComplimentaryLicense` as the thin composition in §1, preserving its observable
  contract exactly (signature, `ComplimentaryLicenseResult`, thrown `Conflict/BadRequest/NotFound`).
- Swap `markConverted` → `markApproved` at `:595` and update the comment at `:590-593`
  ("a gift is not a conversion") — **R4.3**.
- `createLicense:332` destructures: `const { user } = await this.findOrCreateUserByEmail(email)`.

**Validation Notes** (⚠️ the trap that rejects mechanism (a)):

- **The owner of the transaction owns the retry.** On PostgreSQL, a statement error inside an open
  transaction puts the session into the aborted state (`25P02`) — a P2002 caught _inside_ an
  interactive transaction cannot be retried inside it. `withLicenseKeyRetry` must therefore wrap
  the **whole `$transaction` call**, exactly as `:525-584` already does. Code that appears to retry
  but re-issues into an aborted transaction is the failure mode R5.6 would silently miss, and the
  type system cannot catch it.
- The conflict-guard read moving from `this.prisma` to `tx` is a **deliberate** improvement (closes
  a TOCTOU window) and changes no observable contract.
- Public surface of `@ptah-api/licensing` grows by four methods. Nothing removed, nothing renamed.

---

### Task 2.2: Update the licence service spec ✅ COMPLETE

**File**: `…/libs/api/licensing/src/lib/license/services/license.service.spec.ts`
**Dependencies**: Task 2.1

**Quality Requirements**:

- Rename the `markConverted` mock and assertions (`:91`, `:444-459`) → `markApproved`.
- Add: `issueComplimentaryLicenseTx` writes the audit row through the `tx` handle; the conflict
  guard now reads through `tx`; `withLicenseKeyRetry` re-enters the **whole** transaction on P2002
  and produces exactly one licence.

**Validation Notes**: the existing `$transaction` mock returns the prisma mock itself as `tx`
(`:39-55`), so moving the conflict `findFirst` inside the transaction leaves the existing
`prisma.license.findFirst` assertions binding. Do not rewrite that harness.

---

**Batch 2 Verification**:

```
npx nx run api-licensing:test
npx nx run api-licensing:typecheck
npx nx run api-admin:test          # the only caller of createComplimentaryLicense lives here
npx nx run-many -t eslint:lint -p api-licensing
```

⚠️ `typecheck` targets run `tsconfig.lib.json`, which **excludes specs**. Batches 3–5 must not read
a green `typecheck` as covering their new spec files — run the suite, or
`npx tsc --noEmit -p libs/api/<lib>/tsconfig.spec.json`, as Batch 2 did.

- `AdminLicensesController.issueComplimentaryLicense` behaviour unchanged (no spec edit needed there).

---

## Batch 3 — Waitlist + cohort tx-aware primitives; `inviteBatch` removed ✅ COMPLETE

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Two services in two libs, but one idea — make the `Waitlist` and `MemberGroup`
writes the approve transaction needs available on a `tx` handle, and delete the invite mailer's
caller (C2). The `claimForApproval` contract has to match what Batch 5 consumes exactly.
**Tasks**: 4 | **Dependencies**: Batch 1 (needs `approvedAt` on the client). Independent of Batch 2 —
may be worked in parallel with it, but both must land before Batch 5.
**Satisfies**: R1.5, R4.6, R5 (the claim), R5.3 · C2 (server half)

### Task 3.1: `WaitlistService` — add `markApproved` + `claimForApproval`, delete `inviteBatch` ✅ COMPLETE (bullet 1 ALREADY LANDED)

**File**: `…/libs/api/marketing/src/lib/waitlist/waitlist.service.ts`
**Spec Reference**: implementation-plan.md §7 3.1, §3 · R4.6, R5, C2

**Quality Requirements**:

- ✅ **ALREADY DONE — do NOT re-add.** `markApproved(email)` landed in Batch 2's commit
  `79a735f65` (`waitlist.service.ts:153`), because `LicenseService` injects the concrete
  `WaitlistService` and Task 2.1's R4.3 swap would not compile without it. **Verify and keep it;
  do not write it a second time.** It is a copy of `markConverted:113-127` on `approvedAt`:
  `updateMany` with an `approvedAt: null` guard, so a re-run never moves an existing stamp
  (**R4.6**) and an unknown email is a no-op. Its _method body is still untested_ — Task 3.2 owes
  it the three cases listed there.
- **Add** `claimForApproval(tx, id)` returning the discriminated union
  `{ outcome: 'claimed'; row } | { outcome: 'already_approved'; row } | { outcome: 'not_found' }` —
  the `findUnique` (selecting `{ id, email, notifiedAt, approvedAt }`) followed by the conditional
  `updateMany({ where: { id, approvedAt: null }, data: { approvedAt: now } })` of §3. **All
  `Waitlist` writes stay owned by this service.**
- **Delete** `inviteBatch:129-186`, `resolveInviteTargets:188-214`, `DEFAULT_INVITE_BATCH_SIZE:24-28`,
  `WaitlistInviteResult:11-22`.

**Validation Notes**:

- `EmailService` **stays injected** — `join` still calls `sendWaitlistConfirmation:90`. Verify that
  before removing anything from the constructor. (Plan §9, B3 risk row.)
- The `findUnique` is advisory only: it distinguishes `not_found` from `already_approved`. A racer
  that claims between the read and the update is caught by `count === 0`, so the read introduces
  no race.
- The claim must be the **first write** in the caller's transaction, so a rollback releases it (R5.5).

---

### Task 3.2: `WaitlistService` spec ✅ COMPLETE

**File**: `…/libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts`
**Dependencies**: Task 3.1

**Quality Requirements**:

- Delete the `inviteBatch` describe (`:126-…`) and the `sendFoundingInvite` mock (`:18`, `:33`).
- Add `markApproved`: stamps; no-ops on an already-stamped row (timestamp unmoved); no-ops on an
  unknown email.
- Add `claimForApproval`: all three outcomes; a second claim on the same row returns
  `already_approved`.

---

### Task 3.3: `MemberGroupsService` — `requireGroupByKey` + `assignInTx` ✅ COMPLETE

**File**: `…/libs/api/community/src/lib/member-groups/member-groups.service.ts`
**Dependencies**: none within the batch (may precede 3.1)
**Spec Reference**: implementation-plan.md §7 3.3, §2 · R1.5, R5.3

**Quality Requirements**:

- **Add** `requireGroupByKey(key)` — `findUnique({ where: { key } })`; on a miss, log the cause
  server-side and throw `InternalServerErrorException` carrying `{ code: 'COHORT_NOT_CONFIGURED' }`
  and a **fixed sentence**. No Prisma text reaches the client.
- **Add** `assignInTx(tx, { userId, groupId, source })` → `{ created: boolean }`, implemented as
  `findUnique` (to report `created`) followed by `upsert` on `userId_groupId` with `update: {}` —
  the shape `assignDefaultGroup` already uses at `:326-330`.
- Neither method audits. The `waitlist.approve` row records `groupKey`.

**Validation Notes** (⚠️ two explicit prohibitions):

- **No `isDefault` fallback, ever.** R1.5 and the risk register: resolving the cohort by `isDefault`
  would silently retarget the whole cohort the day a second group is made default.
- **Do not** copy the `create` + `catch (P2002)` shape from `:465-479`. That code runs _outside_ a
  transaction; inside one, the caught P2002 aborts the transaction on the very race it is trying to
  tolerate. Prisma compiles a simple non-nested upsert on a unique constraint to
  `INSERT … ON CONFLICT DO UPDATE`, so no error is raised; if it ever degrades to find-then-create,
  the whole-transaction retry in Batch 5 absorbs the P2002.

---

### Task 3.4: `MemberGroupsService` spec ✅ COMPLETE

**File**: `…/libs/api/community/src/lib/member-groups/member-groups.service.spec.ts`
**Dependencies**: Task 3.3

**Quality Requirements**: `requireGroupByKey` resolves by key and **throws** (never falls back) when
absent; `assignInTx` returns `created: true` on first assign, `created: false` on a repeat, and
never surfaces a P2002 (R5.3).

---

**Batch 3 Verification**:

```
npx nx run api-marketing:test
npx nx run api-community:test
npx nx run-many -t typecheck -p api-marketing,api-community
npx nx run-many -t eslint:lint -p api-marketing,api-community
```

- `rg -n "inviteBatch|resolveInviteTargets|WaitlistInviteResult" libs/api` → **no matches**
- ⚠️ Expected transient: `libs/api/admin` will not compile until Batch 5 deletes
  `AdminWaitlistController.inviteWaitlist`. `npx nx run api-admin:typecheck` is **not** a gate for
  this batch. Batches 3, 4 and 5 close that hole together — see the Batch 5 verification.

---

## Batch 4 — The email: delete the paid invite, add the free welcome ✅ COMPLETE

**Commit**: `8136e292d` — `feat(license-server): replace the paid founding invite with the free cohort welcome`

**Team-leader verification**: deletion proven total by repo-wide grep (the only surviving mentions of
the three deleted symbols are string needles inside the guard spec); the `PADDLE_DISCOUNT_ID_BUILDERS_*`
env **variables** correctly survive in `.env.example` and both deploy docs (only the code readers went);
C3 framing confirmed in the rendered prose with the literal expiry lower in the licence block, and the
spec asserts that ORDER; `sendLicenseKey` suppression re-confirmed structural at
`license.service.ts:582-653` (`issueComplimentaryLicenseTx` has no mail side effect and no flag was
added — the `dto.sendEmail !== false` at `:752` is the pre-existing `/licenses/complimentary` DTO field
on a different endpoint). **The R3.6 control was proven load-bearing by mutation**: injecting a `$87`
amount and a `${frontendUrl}/pricing` link into the template turned the suite red (3 failures — the
`$` pattern, the `/pricing` pattern, and the no-expiry variant); restored byte-for-byte and re-run green.

**✅ RULED — `admin-founding-invites.spec.ts` (ruling issued by the coordinator, recorded here after
Batch 5; the file itself remains untouched as of this commit)**:
`apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts` (116 lines, two tests) exercises
the retired invite flow and belongs to **no batch**. Batches 4 and 5 correctly left it untouched. It is
already hollow as of Batch 3 — it `page.route`-stubs `POST /api/v1/admin/waitlist/invite`, so it passes
green while guarding a server endpoint that no longer exists — and it drives the very UI Batch 6 deletes
(`WaitlistInviteModal`, `AdminApiService.inviteWaitlist`), so **Batch 6 will break it**.

**THE RULING: Batch 6 DELETES this spec AND adds a like-for-like approve spec in its place** — posting
`{ ids }` and asserting the per-outcome tally. Both halves are required and they land together.
Deleting tests for deleted behaviour is correct; dropping p0 e2e coverage of the admin waitlist action
without a replacement is not. The spec cannot be repointed at approve — different request and response
shapes — so this is a delete-and-rewrite, not an edit. Do this in the same change as Task 6.3, so the
modal, its client method and its coverage go in one commit rather than leaving a window where the suite
guards nothing. The response contract to assert against is `WaitlistApprovalResponse`, exported from
`@ptah-api/admin` (`requested`, `tally` keyed by all five outcomes with zeros present, `results` in
request order).

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: Deletion plus customer-facing copy under a source-text gate — the copy constraints
(C3 framing, the prohibited-substring list) and the spec that enforces them must be written by the
same agent that writes the template. Explicitly not delegable.
**Tasks**: 2 | **Dependencies**: **Task 3.1** — `inviteBatch` is the _only_ caller of
`sendFoundingInvite`; deleting the mailer before its caller breaks the build. This batch must land
**with or after** Batch 3. Independent of Batch 2.
**Satisfies**: R3.1–R3.6 · C3

### Task 4.1: Replace `sendFoundingInvite` with `sendFoundingCohortWelcome` ✅ COMPLETE

**File**: `…/libs/api/email/src/lib/services/email.service.ts`
**Spec Reference**: implementation-plan.md §6 · task-description.md R3 · context.md **C3**

**Delete (total, not retargeted)**:

- `sendFoundingInvite` — `:131-166` (method + docblock)
- `buildFoundingCheckoutUrl` — `:681-698`
- `getFoundingInviteTemplate` — `:700-798`
- the `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` reads — `:709-714`
  (the env vars themselves stay in deployment config — out of scope)

**Add**:

```ts
async sendFoundingCohortWelcome(params: {
  email: string; licenseKey: string; expiresAt: Date | null;
}): Promise<void>
private getFoundingCohortWelcomeTemplate(params: {
  licenseKey: string; expiresAt: Date | null;
}): string
```

Placed where the deleted pair was, preserving the file's senders-above-templates ordering.

**Quality Requirements**:

- Mechanics copied verbatim from the siblings: `FROM_EMAIL` / `FROM_NAME` via `ConfigService` with
  the `|| 'help@ptah.live'` / `|| 'Ptah Team'` fallbacks (`:49-50`); `await this.sendWithRetry(msg, 3)`
  (`:60`); `FRONTEND_URL` via `this.config.get<string>('FRONTEND_URL') || 'https://ptah.live'`
  (the `:707-708` pattern) — which **is** R3.4.
- **Subject**: `You're in — Ptah Builders, free for the founding cohort`.
- Body, dark/gold house style (reuse the `.container/.header/.content/.badge/.cta/.footer` block
  from `getWaitlistConfirmationTemplate:646-657` and the `.license-key` rule from
  `getLicenseKeyTemplate:341`):
  1. Header `You're in` / `Ptah Builders — Founding Cohort`; badge `Founding Member`.
  2. You are in, and it is **free** — no card, no payment now, and none when the cohort ends.
  3. What you get: the SaaS-building course, the weekly live sessions, the members' community, the packs.
  4. **The C3 scope framing, at the top, verbatim in substance**: _"Founding members keep the course,
     the recordings and the community for a full year — the two-week cohort is the live part, not
     the whole of it."_ **No countdown framing.**
  5. One primary CTA: `<a class="cta" href="${frontendUrl}/members">Open the members' area</a>`.
  6. How to get in: sign in with **this** email address.
  7. Licence-details block **lower down**: the key in the monospace `.license-key` box and the
     literal expiry date, formatted with the existing
     `toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })` from `:319-323`.
     Warm at the top, precise at the bottom (C3).
  8. Footer: reply-to-this-email + `ptah.live`, as every sibling.

**Validation Notes** — the body MUST NOT contain: any `$` or other currency symbol, any `%`, any
`/pricing` link, any `promo=` or `d=` parameter, the words `discount`, `money-back`, `renew`. No
second CTA, no billing-cycle choice. **No `process.env` anywhere** (R3.5). There is no
`sendEmail: false` flag on this path and none may be added — suppression of `sendLicenseKey` is
structural (the Batch 2 core sends nothing), and a flag would be a second, silently-flippable way
to send two mails.

---

### Task 4.2: The source-text spec ✅ COMPLETE

**File**: `…/libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts` (**new**)
**Dependencies**: Task 4.1
**Spec Reference**: implementation-plan.md §6 "R3.6" · R3.6
**Pattern to Follow**: the source-text invariant at `membership.service.spec.ts:120-126`; the
`ConfigService`/`ResendMailService` mock harness at `email.service.spec.ts:5-28`

**Quality Requirements**:

- **Rendered HTML** (call `sendFoundingCohortWelcome`, capture `mockResend.emails.send.mock.calls[0][0].html`):
  contains `/members`, the licence key and the formatted expiry date; does **not** match `/\/pricing/`,
  `/promo=/`, `/&d=/`, `/%/`, `/\$/`, `/discount/i`, `/money-?back/i`, `/renew/i`.
- **`FRONTEND_URL` mocked to `undefined`** ⇒ the CTA contains `https://ptah.live/members` (R3.4).
- **Source text** of `email.service.ts`: none of `buildFoundingCheckoutUrl`,
  `getFoundingInviteTemplate`, `sendFoundingInvite`, `promo=founding`,
  `PADDLE_DISCOUNT_ID_BUILDERS_`.
- **Directory sweep** for R3.1's second half: every `libs/api/email/src/**/*.ts` that is **not** a
  `*.spec.ts` contains no `promo=founding`. The exclusion matters — this spec file itself carries
  the needle.

**Validation Notes** (⚠️ anti-vacuity): assert the sweep discovered **≥ 1 file** before asserting the
needle is absent, in the style of `controller-validation.spec.ts:524-547`. A sweep that finds
nothing and passes is not a control.

---

**Batch 4 Verification**:

```
npx nx run api-email:test
npx nx run api-email:typecheck
npx nx run-many -t eslint:lint -p api-email
```

- `rg -n "sendFoundingInvite|getFoundingInviteTemplate|buildFoundingCheckoutUrl" libs apps` → **no matches**
- `rg -n "promo=founding" libs/api/email/src` → **no matches**

---

## Batch 5 — Approve endpoint, audit action, stats, structural guards ✅ COMPLETE

**Commit**: `6eaae0175` — `feat(admin): batch 5 - approve waitlist rows to the founding cohort`

**Team-leader verification**: the four ship-breaking invariants were each proven load-bearing by
mutating the production code and confirming the suite turned red, then reverting byte-identical.
(1) Moving `sendFoundingCohortWelcome` inside `grantInTx` failed the R2.3 post-commit test — the mail
really is outside the boundary. (2) Inverting the nesting to `$transaction(tx => withLicenseKeyRetry(…))`
failed both R5.6 tests; `withLicenseKeyRetry` also retries **only** P2002 and rethrows everything else
on the first attempt, so `SkipRow` costs one transaction, not three. (3) Swapping the row loop to
`Promise.all` failed the peak-concurrency test. (4) Swallowing the cohort-assign failure inside the
transaction failed both rollback tests — they assert the claim's release rather than passing vacuously.
Two further mutations: moving `requireGroupByKey` into the loop failed the once-per-request test, and
unbinding `@Body(dtoPipe(ApproveWaitlistDto))` to a bare `@Body()` failed two structural-guard tests
naming this exact controller. Also confirmed by reading: `stackOnTopOfPaid` never passed on this path;
audit inside the tx with no `try/catch` and none written for skipped rows; no licence key in metadata,
logs or payload (the core's `license.complimentary.issue` metadata is key-free too); client errors are
`{ code }`-only and uncompilable otherwise; `approved` is one aggregate; `notifiedAt` never written.

**Rejected once, then cleared.** The first submission's route ledger said 139 where `EXPECTED_ROUTES`
actually held 140, and claimed the figure had been "re-derived by hand" when it had been incremented.
`MIN_TOTAL_PAYLOAD_PARAMS = 80` was correct and independently re-derived by the documented `9999`
procedure (`Expected: >= 9999 / Received: 80`). On re-submission: 140 confirmed by my own count (140
entries, 140 unique, no duplicates); the drift traced to `3db831d00^` — the parent of this task's first
commit, where the array already held 138 against a prose 137 — so it was inherited whole and did not
enter with B1; closed forward with no earlier entry retro-edited, leaving the ledger reading
`… 137, 139, 138, 140` with an in-place note that the discontinuity is the finding; and §4 of the batch
report rewritten as an explicit retraction naming the false provenance claim. The re-submission diff
touched the docblock only — the sole route-literal change in the whole batch is
`+ 'POST v1/admin/waitlist/approve'`. Gate on the committed tree: 7/7 projects green
(`ptah-license-server` 163/163 with both structural guards, `api-admin` 59/59), typecheck ✅, eslint
0 errors and 2 pre-existing warnings on untouched files.

**Recommended Executor**: `backend-developer`
**Fallback Executor**: `backend-developer`
**Execution Mode**: sequential
**Rationale**: The heart of the feature — one transactional orchestrator, its DTO, its route, its
audit action, its stats aggregate, and the two structural guards whose arithmetic must be reasoned
about, not adjusted. Thirteen files that only make sense as one change. Highest-risk batch; keep it
in one context.
**Tasks**: 13 | **Dependencies**: Batches 1, 2, 3 **and** 4 (the service calls
`sendFoundingCohortWelcome`, and this batch is what makes `libs/api/admin` compile again after 3.1)
**Satisfies**: R1, R2, R4.5, R5, R6.1–R6.3, R7, R8 · C2 (server half)

### Task 5.1: Add the `waitlist.approve` audit action ✅ COMPLETE

**File**: `…/libs/api/audit/src/lib/audit-log.types.ts`

- Add `| 'waitlist.approve'` to `AdminAuditAction` (after `:23`) with a docblock giving R7's
  argument: it names the waitlist row **and** the cohort, which `license.complimentary.issue` cannot.
- **Keep** `'waitlist.invite'`, annotated `// historical — no writer remains after TASK_2026_201; rows exist in admin_audit_log`.
- `targetType: 'Waitlist'` already exists at `:155`. Do not add it twice.

---

### Task 5.2: Response types ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts` (**new**)
**Spec Reference**: implementation-plan.md §4

`WAITLIST_APPROVAL_OUTCOMES = ['approved','already_approved','already_paid','not_found','failed'] as const`,
`WaitlistApprovalOutcome`, `WaitlistApprovalErrorCode = 'GRANT_FAILED'`,
`WaitlistApprovalRowResult { id; email: string | null; outcome; licenseId?; wasNotified?; warning?: { code: 'APPROVAL_EMAIL_FAILED' }; error?: { code } }`,
`WaitlistApprovalResponse { requested; tally: Record<Outcome, number>; results[] }`.

**Validation Notes**: **no licence key appears anywhere in this payload** (R7.4). The warning is
`{ code }` only — a deliberate divergence from `ComplimentaryLicenseResult.warning.error: string`
(`license.service.ts:41`), which is a different endpoint's payload and is **not** changed here.

---

### Task 5.3: `WaitlistApprovalService` — the orchestrator ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts` (**new**)
**Dependencies**: Tasks 5.1, 5.2 (and Batches 2, 3, 4)
**Spec Reference**: implementation-plan.md §2 (the per-row algorithm, reproduce it faithfully), §3

**Quality Requirements**:

- Injects `PrismaService`, `LicenseService`, `WaitlistService`, `MemberGroupsService`,
  `EmailService`, `AuditLogService`. **`MemberGroupsService` is REQUIRED — no `@Optional()`.**
  The `@Optional()` at `admin.service.ts:143-147` exists for a _degradable stats read_; a missing
  cohort service here is precisely the half-state R2 forbids, so it must fail at boot.
- **Once per request, before the loop**: `foundingGroup = await memberGroups.requireGroupByKey('founding')`.
  It throws before any row is touched — that is R1.5's "no licence SHALL be issued for **any** row".
- **Rows processed sequentially, never `Promise.all`.** 50 concurrent interactive transactions would
  exhaust the connection pool; per-row _isolation_ is the point, not per-row parallelism.
  (50 × ~200 ms ≈ 10 s, inside the 30 s NFR budget.)
- Per row: `withLicenseKeyRetry`-style 3-attempt loop wrapping **the whole `$transaction`**, whose
  callback runs, in order: `claimForApproval` (findUnique → conditional claim, the **first write**) →
  `findOrCreateUserByEmail(row.email, tx)` → `holdsPaidEntitlement(tx, user.id)` →
  `issueComplimentaryLicenseTx` (`plan: 'builders'`, `expiresAt = computeComplimentaryExpiresAt('1y')`,
  `createdBy = actor.email`, `reason: 'Founding cohort approval (waitlist)'`, `stackOnTopOfPaid: false`) →
  `memberGroups.assignInTx` → `auditLog.write({ tx, action: 'waitlist.approve', targetType: 'Waitlist',
targetId: row.id, metadata: { email, userId, userWasCreated, licenseId, durationPreset: '1y',
expiresAt, groupKey: 'founding', wasNotified, cohortAlreadyAssigned } , ipAddress, userAgent })`.
- **The audit write is inside the transaction with no `try/catch` around it** (R2.2, PRE-6). This is
  a deliberate divergence from `admin-waitlist.controller.ts:84-104` and
  `member-groups.service.ts:599-611`, where an audit failure is swallowed _because the mail had
  already gone out_. Here nothing has gone out.
- `holdsPaidEntitlement(tx, userId)` is true when **either** an active non-complimentary `builders`
  licence exists **or** a subscription in `['active','trialing']` exists. The second clause is a
  deliberate superset (`membership.service.ts:70-76` checks the subscription first), and it never
  contradicts R5.4 — it only widens `already_paid`.
- `SkipRow` is a **private sentinel class** carrying the outcome. Throwing it is how the transaction
  is made to roll back; it is caught immediately outside `$transaction`, is never an `HttpException`,
  and **never reaches the client**.
- **Step 7, post-commit and outside the transaction**: exactly one
  `email.sendFoundingCohortWelcome({ email, licenseKey, expiresAt })`. On throw: log server-side,
  outcome stays `approved`, add `warning: { code: 'APPROVAL_EMAIL_FAILED' }` (R2.3).
- One structured log line per row (actor, waitlist id, email, outcome, licence id) and one wave
  summary line (actor, requested count, tally per outcome) — R7.5. **No log line may contain a
  licence key** (R7.4).
- `stackOnTopOfPaid` is **not set anywhere in this path** (R5.4).

**Validation Notes / edge cases this task owns**: `already_approved` (claim `count === 0`),
`already_paid` (both clauses), `not_found`, `failed` (non-P2002 throw or P2002 after 3 attempts, →
`{ code: 'GRANT_FAILED' }`), rollback releases the claim (R5.5), no audit row for any skipped
outcome (R7.3), `notifiedAt` never read as a precondition and never written (R6.1).

---

### Task 5.4: `WaitlistApprovalService` spec ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts` (**new**)
**Dependencies**: Task 5.3
**Spec Reference**: implementation-plan.md §8
**Harness**: the callback-aware `$transaction` mock from `license.service.spec.ts:39-55`, extended
with `waitlist`, `memberGroupAssignment` and `subscription` delegates.

**Must cover** (the three the requirements single out, then the rest):

1. **Rollback on cohort-assignment failure (R2.1)** — make `assignInTx` reject. Assert
   `tx.license.create` was called (we got past step 5) **but** the callback rejected; `auditLog.write`
   was never called with `action: 'waitlist.approve'`; no mail; outcome `failed` +
   `{ code: 'GRANT_FAILED' }`. ⚠️ The mock cannot roll back, so pair this with **one
   integration-style test against a real database** — or an explicit manual gate recorded in the QA
   notes — asserting `license.count === 0` and `waitlist.approvedAt === null` afterwards. R2.1 is an
   exit gate and the mock cannot prove it.
2. **Post-commit email failure (R2.3)** — outcome `approved`, `licenseId` present, callback resolved,
   `warning: { code: 'APPROVAL_EMAIL_FAILED' }`, **no** `error` field, **no** raw message, and a
   `logger.error` line containing neither the licence key nor `ptah_lic_`.
3. **Concurrent approval (R5.2)** — shared mock whose `waitlist.updateMany` returns `{ count: 1 }`
   once and `{ count: 0 }` thereafter. Exactly one `approved` + one `already_approved`, exactly one
   `license.create`, one mail, one `waitlist.approve` audit row, and **neither call throws or maps
   to a 500**.

**Plus**: double approval (sequential, R5.1) · `already_paid` via **both** clauses (R5.4) ·
already-notified row approved identically with `notifiedAt` unchanged and `wasNotified: true` in
the metadata (R6.1, R6.2) · `not_found` mid-batch with the rest still processed (R1.6, R2.4) ·
missing `founding` group throws **before any** `license.create` (R1.5) · P2002 retried once ⇒
exactly one licence (R5.6) · already-assigned cohort ⇒ still `approved` (R5.3) · the wave summary
log line (R7.5).

---

### Task 5.5: DTO swap ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin.dto.ts`

- **Delete** `InviteWaitlistDto:113-137`.
- **Add** `ApproveWaitlistDto`: `ids!: string[]` with `@IsArray() @ArrayMinSize(1) @ArrayMaxSize(50)
@IsString({ each: true }) @MaxLength(64, { each: true })` — cuid keys, so string-with-cap rather
  than `@IsUUID`, matching the deleted DTO's reasoning at `:120-122`.
- **No** `@IsOptionalNotNull` — an absent `ids` must be a 400 (R1.4).
- **Duration is not a field.** The grant is always `1y`.

---

### Task 5.6: Controller — delete invite, add approve ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin-waitlist.controller.ts`
**Dependencies**: Tasks 5.2, 5.3, 5.5

- **Delete** `inviteWaitlist:52-107` and the now-unused `WaitlistService` + `InviteWaitlistDto` imports.
- **Add** `@Post('approve') @HttpCode(200) @UseGuards(AdminThrottlerGuard)
@Throttle({ default: { limit: 10, ttl: 60_000 } })` binding **`@Body(dtoPipe(ApproveWaitlistDto))`**
  and returning `WaitlistApprovalResponse`.
- Actor resolved exactly as `admin-licenses.controller.ts:75-84` does: `req.user?.email ?? 'unknown'`,
  `req.ip`, and the `user-agent` header narrowed with `typeof … === 'string'`.
- The controller injects **only** `WaitlistApprovalService` — the audit is written inside the
  service's transaction, so no `AuditLogService` here.
- Rewrite the class docblock: keep the `dtoPipe` warning, change the stakes sentence from "outbound
  mail volume" to "grants **and** outbound mail, and `@ArrayMaxSize(50)` is the only bound on both".

**Validation Notes** (⚠️ load-bearing): a bare `@Body() dto: X` is **silently unvalidated** in this
server — esbuild emits no `design:paramtypes`, so Nest cannot infer the DTO type and the global
`ValidationPipe` short-circuits, rendering every `class-validator` decorator inert
(`dto-validation.pipe.ts:20-45,69-76`). On this route the binding is the only bound on how many
grants and outbound emails one request can produce.

---

### Task 5.7: Module wiring ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin.module.ts`

Add `WaitlistApprovalService` to `providers`. **`imports` unchanged** — `EmailModule`,
`WaitlistModule` and `forwardRef(() => LicenseModule)` are already there (`:42-48`) and
`MemberGroupsModule` is `@Global()`. Update the docblock's controller/service inventory.

---

### Task 5.8: Barrel exports ✅ COMPLETE

**File**: `…/libs/api/admin/src/index.ts` — export
`./lib/waitlist-approval/waitlist-approval.types` and `./lib/waitlist-approval/waitlist-approval.service`.

---

### Task 5.9: Stats — the `approved` aggregate ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin.service.ts` · **Satisfies R4.5**

`AdminStatsResponse.waitlist` gains `approved: number` (`:74-79`). `getStats` (`:326-367`) adds one
`this.prisma.waitlist.count({ where: { approvedAt: { not: null } } })` to the existing
`$transaction([…])` array (`:339-353`). **One aggregate — no query per row** (NFR-Performance).

---

### Task 5.10: Admin model config — server side ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin-models.config.ts`

`waitlist` entry (`:346-369`): `listFields` += `approvedAt`; `sortableFields` += `approvedAt`;
`filterableFields` += `approved: { type: 'datePresence', column: 'approvedAt' }`.
**`editableFields` unchanged** — an admin hand-stamping `approvedAt` would fake a grant and bypass
the claim; R5.5 already makes a rolled-back row re-approvable without manual editing.

---

### Task 5.11: `admin.service.spec.ts` ✅ COMPLETE

**File**: `…/libs/api/admin/src/lib/admin.service.spec.ts` — assert the new `approved` count in `getStats`.

---

### Task 5.12: ⚠️ Structural guard — `route-map.spec.ts` ✅ COMPLETE

**File**: `…/apps/ptah-license-server/src/common/route-map.spec.ts`

`EXPECTED_ROUTES`: `'POST v1/admin/waitlist/invite'` (`:521`) → `'POST v1/admin/waitlist/approve'`.
**Same alphabetical slot; the count is unchanged**, so the exact-count assertion at `:834-835` still
closes. This is a **swap**, not an add and not a remove — if the count assertion fails, the route
was registered at the wrong path or the entry was duplicated. Do not "fix" the count.

---

### Task 5.13: ⚠️ Structural guard — `controller-validation.spec.ts` ✅ COMPLETE

**File**: `…/apps/ptah-license-server/src/common/controller-validation.spec.ts`

- **`MIN_TOTAL_PAYLOAD_PARAMS` STAYS 78** (`:272`). Arithmetic: −1 whole-object `@Body` from the
  deleted `inviteWaitlist`, +1 from `approveWaitlist` ⇒ net zero ⇒ 72 whole-object + 6 named.
- Add a dated docblock entry recording that arithmetic, in the house style of the `77 -> 78` block
  at `:250-270`.
- **`NAMED_PRIMITIVE_PARAM_COUNT` stays 6.** The ids travel in a `@Body()`. A `@Query('ids')` would
  make the total read 78 against a named count of 7 and the arithmetic would not close.
- **`UNVALIDATED_DEBT` stays `[]`.**
- The controller census and `ALL_CONTROLLERS` are untouched — no controller is added or removed.

**Validation Notes** (⚠️ the trap): if this spec fails, **do not edit the number**. One of the two
routes was mis-bound. Re-derive with the documented `9999` procedure (`:217-222`) first.

---

**Batch 5 Verification** — this is the batch that closes the build hole Batch 3 opened:

```
npx nx run api-admin:test
npx nx run api-audit:test
npx nx run ptah-license-server:test          # route-map + controller-validation guards
npx nx run-many -t typecheck -p api-admin,api-audit,api-licensing,api-marketing,api-community,api-email,ptah-license-server
npx nx run-many -t eslint:lint -p api-admin,api-audit
```

Specifically green: `apps/ptah-license-server/src/common/route-map.spec.ts`,
`apps/ptah-license-server/src/common/controller-validation.spec.ts`,
`libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts`.

- `rg -n "inviteWaitlist|InviteWaitlistDto" libs/api apps` → **no matches**
- `rg -n "waitlist/invite" libs apps` → matches only migration files and the historical
  `'waitlist.invite'` union member

---

## Batch 6 — Admin UI: approve replaces invite ✅ COMPLETE

**Commit**: `ede6bb2ac` — `feat(admin): batch 6 - approve replaces invite in the admin UI`

**Team-leader verification**: R9.1 re-grepped independently rather than taken from the report —
`70%|\$87|\$8\.70|off the first year` over `libs/web/admin` returns nothing in code _or_ prose. Both
`WaitlistInviteModal` consumers land in this one commit: the pipeline (replaced by
`ApproveWaitlistModal`) and the `supportsWaitlistInvite`-gated generic list (removed with no
replacement, deliberately), and the flag itself is gone from `admin-models.config.ts`, so the gate
cannot be re-lit by config. `WaitlistInviteModal|supportsWaitlistInvite|supportsEarlyAdopterApprove|
inviteWaitlist|AdminInviteWaitlist` and every deleted handler name (`onInviteOldest`,
`onSendFoundingInvites`, `onInviteClose`, `onInviteSent`, `onWaitlistInvite*`, `quickInviteBatch`,
`onEarlyAdopterApproved`) return **no matches** across `libs/web`; `\[email\]=` likewise.
R6.4 confirmed in the template: the per-row Approve button carries **both** `@case ('new')` and
`@case ('invited')`, and `approvableTab()` is `new | invited`, so a New row no longer has to be
mailed a withdrawn paid invite first. All five outcomes render unconditionally from a fixed
`outcomeLines` array with a required (non-optional) tally schema — `already_paid` cannot be hidden by
a zero. On error the modal sets `errorMessage`, does **not** emit `submitted` and does **not** close;
`clearSelection()` lives only in `onApproveDone`, which only a returned response reaches, so a failed
request leaves the selection retryable. `IssueCompLicenseModalComponent` keeps the Users-detail
(`userId`) and Licenses-list (`mode: 'search'`) paths — verified live at `admin-detail.html:22-52`
and `user-profile.ts:228` — while the `email` input, `isWaitlistMode`, the waitlist `open()` defaults
and the bound-email arm of `confirm()` are gone. The e2e swap landed as **both** halves:
`admin-founding-invites.spec.ts` deleted and `admin-waitlist-approve.spec.ts` added in the same
commit, `@p0` retained, posting `{ ids }`, asserting the per-outcome tally, `page.route`-intercepting
`**/api/v1/admin/waitlist/approve` so no grant or email occurs, and typed against
`WaitlistApprovalResponse` from `@ptah-api/admin`.

**The one flagged decision, ruled**: the `import type { WaitlistApprovalResponse } from '@ptah-api/admin'`
with a single `@nx/enforce-module-boundaries` disable is **ACCEPTED**. The ruling required asserting
against that exact type; the import is type-only and fully erased, so nothing crosses at runtime, and
the repo already carries the identical pattern at `prisma/seed/prisma-client.ts:35` and
`vscode-shim.integration.spec.ts:30`. The rejected alternative — a locally-declared structural mirror —
would reintroduce the drift-blindness that made the deleted spec hollow.

**Gate on the committed tree**: `web-admin` 11 suites / **169 tests** green, `ptah-license-server`
5 suites / **163 tests** green (server side undisturbed); typecheck green on `web-admin`,
`ptah-landing-page` and `ptah-landing-page-e2e`; `eslint:lint` **0 errors** with 8 warnings, all
pre-existing on untouched code; `nx build ptah-landing-page` succeeds (`waitlist-pipeline` lazy chunk
19.66 kB, the two budget warnings pre-existing). Committed 16 files by name; both untracked
`.ptah/specs/` folders deliberately excluded.

**Carried to Batch 7 (not blockers)**: the Playwright suite was never executed — the new spec is
verified by collection and `tsc` only, and self-skips without `E2E_ADMIN_EMAIL`; the Invited badge
moved `info` → `neutral` to fit four stages into the closed six-name `BadgeVariant` vocabulary
(purely visual); `refreshTick` was removed from `admin-list.ts` as dead code once its only writer
went; no `stage:` preset filter was built, so the accepted New/Approved tab overlap stands, mitigated
by the always-visible stage chip.

**Recommended Executor**: `frontend-developer`
**Fallback Executor**: `frontend-developer`
**Execution Mode**: sequential
**Rationale**: Angular 21 signals/OnPush work across ten coupled files in `libs/web/admin`, with two
deletion fan-outs (the invite modal's second consumer; the comp-modal's `[email]` bindings) that
must land together or the app does not compile. Separate developer type from B1–B5 — never mixed in
one batch.
**Tasks**: 10 | **Dependencies**: Batch 5 (needs the live route and the response type)
**Satisfies**: R9.1–R9.6, R6.4 · C2 (client half)

### Task 6.1: `AdminApiService` — swap invite for approve ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/services/admin-api.service.ts`

- **Delete** `inviteWaitlist:533-543`, `AdminInviteWaitlistRequest:95-98`,
  `adminInviteWaitlistResponseSchema:261-264`, `AdminInviteWaitlistResponse:265-267`.
- **Add** `approveWaitlist(body: AdminApproveWaitlistRequest): Observable<AdminApproveWaitlistResponse>`
  → `POST ${base}/waitlist/approve`, plus `adminApproveWaitlistResponseSchema` mirroring the server
  types (outcome enum, per-row array, tally record), validated through `validate(schema, label)`
  like every sibling.
- **Add** `approved: z.number().optional()` to `adminStatsWaitlistSchema:269-274`.

**Validation Notes**: `.optional()` follows the `attention` precedent at `:293-306` — a brief
server/client deploy skew must not break the whole stats call. The house convention here is
**request bodies as plain interfaces, responses as Zod schemas with `z.infer`red types, local to
this file**; the types deliberately do **not** go in `libs/api-contracts/community` (that lib is the
community domain and has an executable boundary guard).

---

### Task 6.2: `ApproveWaitlistModal` ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/components/approve-waitlist-modal/{approve-waitlist-modal.ts,approve-waitlist-modal.html}` (**new**)
**Dependencies**: Task 6.1
**Pattern to Follow**: `waitlist-invite-modal.ts:108-119` (`extractErrorMessage`) and its DaisyUI
`<dialog class="modal modal-open">` structure — copy the shape before deleting the file in 6.3.

- Standalone, `OnPush`, signals + `inject()`. `open = input<boolean>(false)`,
  `ids = input<readonly string[]>([])`, `closeModal = output<void>()`,
  `submitted = output<AdminApproveWaitlistResponse>()`.
- Confirmation copy states the **count**, the **free 1-year** grant, the **Founding Members** cohort
  and **one email each** (R9.2).
- On success renders the per-outcome tally: approved / already approved / already paid / not found /
  failed (R9.3).
- On error surfaces the server's sanitized message and **does not clear the selection** (R9.6).
- It is the single confirmation path for **both** per-row and bulk approve — a per-row click opens
  it with one id.

---

### Task 6.3: Delete `WaitlistInviteModal` ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/components/waitlist-invite-modal/**` (whole folder — `.ts` and `.html`)
**Dependencies**: Task 6.2 (copy the patterns first)

⚠️ **This modal has TWO consumers.** Tasks 6.4 (waitlist pipeline) and **6.8 + 6.9** (the generic
admin list, gated on `supportsWaitlistInvite` at `admin-models.config.ts:75,560`) must land in the
**same commit** as this deletion or the build breaks.

---

### Task 6.4: `waitlist-pipeline.ts` ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts`
**Dependencies**: Tasks 6.1, 6.2

**Add**: `WaitlistTab` (`:40`) += `'approved'`; `normalizeTab` (`:255-259`) accepts it (**R9.5** — the
existing `?tab=` sync then works unchanged); `WaitlistRow` (`:43-50`) += `approvedAt: string | null`;
`filter` computed (`:141-152`) += `approved` → `'approved:true'`; `tabs` (`:104-109`) += the Approved
tab; `stageLabel`/`stageVariant` (`:344-354`) rank **Converted → Approved → Invited → New**; header
summary (`:216-229`) += `summaryApproved` from `stats()?.waitlist.approved ?? 0`; new signals
`approveOpen` / `approveIds` / `approveToast` and handlers `onApproveSelected()` / `onApproveRow(row)`
/ `onApproveClose()` / `onApproveDone(result)` — the last bumping `refreshTick` **and** calling
`fetchStats()` (R9.3).

**Delete**: the `WaitlistInviteModal` + `IssueCompLicenseModalComponent` imports and the
`compLicenseModal` viewChild (`:91-93`); `inviteRecipients` / `waitlistInviteOpen` / `inviteToast`
(`:124-128`); `approveEmail` / `approvedAt` (`:131-132`); `quickInviteBatch` (`:232`);
`onSendFoundingInvites` / `onInviteOldest` / `onInviteClose` / `onInviteSent` (`:287-314`);
`onApprove` / `onApproved` (`:317-328`).

---

### Task 6.5: `waitlist-pipeline.html` ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/waitlist/waitlist-pipeline.html`
**Dependencies**: Task 6.4

- **Delete** the "Invite oldest N" quick action (`:45-51`), the invite modal mount (`:203-208`), the
  comp-licence modal mount (`:211-214`) and the invite toast.
- Widen the checkbox gate (`:108-116`) and the `<ptah-selection-toolbar>` block (`:42-69`) from
  `tab() === 'new'` to `new | invited`, with the projected button reading
  **"Approve to Founding Cohort"**.
- In the per-row `@switch` (`:143-170`) add an `@case ('new')` **and keep** `@case ('invited')`, each
  carrying an **Approve** button → `onApproveRow(row)` — this is **R6.4**, closing the gate at
  `:143-144` where a New row could only be approved after being mailed the paid invite.
- Add `@case ('approved')` and an empty state for it.
- **Render the stage chip on every tab**, not only `@if (tab() === 'all')` (`:128-134`).
- Mount `<ptah-admin-approve-waitlist-modal>`.

**Validation Notes** — the accepted tab overlap: `ListQueryDto.filter` (`admin.dto.ts:53-65`) is
**one** `field:value` pair, so `new` cannot express "not notified **and** not approved". An approved
row that was never notified appears under both **New** and **Approved**. R9 asks only for
`approved` → `approved:true` plus the four-way ranking, so this is within the requirement, and the
always-rendered stage chip is what makes the overlap self-explaining rather than misleading. A
`stage:` preset filter is a recorded follow-up — **do not build it here**.

---

### Task 6.6: Retire the comp-modal's waitlist branch ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/components/issue-comp-license-modal/issue-comp-license-modal.ts`

Delete the `email` input (`:53`), `isWaitlistMode` (`:67-69`), the waitlist arm of the `open()`
defaults (`:156-163` → the non-waitlist values unconditionally), the `!email().trim()` clause in
`isSearchMode` (`:76-79`), and the bound-`email` arm of `confirm()`'s target precedence (`:198-223`).
**The `userId` (Users-detail) and `mode: 'search'` (Licenses-list) paths are retained unchanged.**

⚠️ Only two templates bind `[email]` — `waitlist-pipeline.html:212` and `admin-detail.html:67` —
and both are removed in this batch (6.5, 6.7). Run `rg -n "\[email\]=" libs/web/admin` after the
change and expect nothing.

---

### Task 6.7: `admin-detail` — delete the second half-approve path ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/admin-detail/{admin-detail.ts,admin-detail.html}`

Delete the `supportsEarlyAdopterApprove` branch (`admin-detail.html:55-71`),
`onEarlyAdopterApproved` (`admin-detail.ts:299-311`) and the `earlyAdopterApprovedAt` signal + toast.

**Rationale (R9's own)**: that detail-page button issues a comp licence with **no cohort assignment**
— the exact half-state R2 forbids. Leaving a second way to half-approve a waitlist row from the
admin panel recreates the defect this task removes.

---

### Task 6.8: `admin-list` — the invite modal's second consumer ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/admin-list/{admin-list.ts,admin-list.html}`
**Dependencies**: must land in the **same commit** as Task 6.3

Delete the `WaitlistInviteModal` import + `imports` entry (`:30`, `:49`), the "Send Founding Invites"
button (`admin-list.html:37-44`), the modal mount (`:79-86`) and its handlers. Change
`[selectable]="!!(s.supportsBulkEmail || s.supportsWaitlistInvite)"` (`:62`) →
`[selectable]="!!s.supportsBulkEmail"`. Update the selection comment at `admin-list.ts:87`.

---

### Task 6.9: `admin-models.config.ts` — client side ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/admin-models.config.ts`
**Dependencies**: Tasks 6.7, 6.8

Delete `supportsWaitlistInvite` (`:75`, `:560`) and `supportsEarlyAdopterApprove` (`:81`, `:561`)
from the interface **and** the `waitlist` entry. Add an `approvedAt` field spec
(`type: 'datetime'`, `listColumn: true`, **not** `editable`).

---

### Task 6.10: `waitlist-pipeline.spec.ts` ✅ COMPLETE

**File**: `…/libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts` (**new** — there is no spec today)
**Dependencies**: Tasks 6.4, 6.5

Cover: `normalizeTab('approved')` (R9.5); the `approved:true` filter; the four-way `stageLabel`
ranking Converted → Approved → Invited → New (R9.4); and that the tally from an approve response
reaches the toast (R9.3).

---

**Batch 6 Verification**:

```
npx nx run web-admin:test
npx nx run web-admin:typecheck
npx nx run-many -t eslint:lint -p web-admin
```

- `rg -n "70%|\$87|\$8\.70|off the first year" libs/web/admin` → **no matches** (R9.1)
- `rg -n "WaitlistInviteModal|supportsWaitlistInvite|supportsEarlyAdopterApprove" libs/web/admin` → **no matches**
- `rg -n "\[email\]=" libs/web/admin` → **no matches**

---

## Batch 7 — Verification gate ⏸️ PENDING

**Recommended Executor**: `backend-developer` (whole-repo gate; `senior-tester` if the orchestrator
prefers a QA-owned pass)
**Execution Mode**: sequential
**Rationale**: Cross-cutting sweeps and a full green run across both developer types' surfaces.
No new code — if a sweep fails, the fix belongs to the owning batch, not here.
**Tasks**: 3 | **Dependencies**: Batches 1–6
**Satisfies**: NFR-Maintainability, R3.1, R7.2's standing gate, R9.1

### Task 7.1: Full green run ⏸️ PENDING

```
npx nx run-many -t test      -p ptah-license-server,api-admin,api-licensing,api-marketing,api-community,api-email,api-audit,web-admin
npx nx run-many -t typecheck -p ptah-license-server,api-admin,api-licensing,api-marketing,api-community,api-email,api-audit,web-admin
npx nx run-many -t eslint:lint -p ptah-license-server,api-admin,api-licensing,api-marketing,api-community,api-email,api-audit,web-admin
```

### Task 7.2: The five acceptance sweeps — all must return nothing ⏸️ PENDING

- `rg -n "sendFoundingInvite|getFoundingInviteTemplate|buildFoundingCheckoutUrl" libs apps`
- `rg -n "promo=founding" libs/api/email/src`
- `rg -n "70%|\$87|\$8\.70|off the first year" libs/web/admin`
- `rg -n "inviteWaitlist|InviteWaitlistDto|waitlist/invite" libs apps` — except the historical
  `'waitlist.invite'` union member and migration files
- `rg -n "isBuildersMember" libs` must still find **exactly one** implementation
  (`membership.service.ts:69`) — **R7.2's standing gate**

### Task 7.3: Manual/integration gate for R2.1 ⏸️ PENDING

The mock harness cannot prove a rollback. Against a real database, approve a row with
`assignInTx` forced to fail and assert `license.count === 0` and `waitlist.approvedAt === null`
afterwards. If this is deferred, record it explicitly in the QA notes as an open exit gate — R2.1 is
a stated exit criterion and cannot be closed by the unit spec alone.

---

## Batch dependency graph

```
B1 schema + migrations
      │
      ├──→ B2 licensing core ──────────┐
      └──→ B3 waitlist/cohort ──┬──────┼──→ B5 approve endpoint + guards ──→ B6 admin UI ──→ B7 verify
                                └──→ B4 email
                                     (B4 must NOT land before B3.1)
```

- **B2 and B3 are independent of each other** and may be worked in parallel by the orchestrator if
  it prefers — but both must land before B5, and each is still a single sub-agent batch.
- **B4 is coupled to B3.1**: `inviteBatch` is the only caller of `sendFoundingInvite`; deleting the
  mailer before its caller breaks the build.
- **B3 opens a transient build hole in `libs/api/admin`** (the controller still calls the deleted
  `inviteBatch`). B5 closes it. Do not gate B3 on `api-admin:typecheck`.

## Executor summary

| Batch | Executor             | Mode       | Why not a CLI agent                                                         |
| ----- | -------------------- | ---------- | --------------------------------------------------------------------------- |
| B1    | `backend-developer`  | sequential | Migration hazards + checksum rules that require the plan in context         |
| B2    | `backend-developer`  | sequential | PostgreSQL aborted-transaction reasoning cannot be re-derived from a prompt |
| B3    | `backend-developer`  | sequential | The `claimForApproval` contract must match B5's consumer exactly            |
| B4    | `backend-developer`  | sequential | Customer-facing copy under a source-text gate; C3 framing is founder-set    |
| B5    | `backend-developer`  | sequential | 13 coupled files, two build-failing structural guards                       |
| B6    | `frontend-developer` | sequential | Angular signals/OnPush; two deletion fan-outs must land together            |
| B7    | `backend-developer`  | sequential | Whole-repo gate; no new code                                                |

CLI delegation is disabled for every row above (Checkpoint 0.1).

---

## Status icons

| Icon           | Meaning                               | Set by      |
| -------------- | ------------------------------------- | ----------- |
| ⏸️ PENDING     | Not started                           | team-leader |
| 🔄 IN PROGRESS | Assigned to a developer               | team-leader |
| 🔄 IMPLEMENTED | Developer done, awaiting verification | developer   |
| ✅ COMPLETE    | Reviewed and committed                | team-leader |
| ❌ FAILED      | Verification failed                   | team-leader |
