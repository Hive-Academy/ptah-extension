# Batch 2 Report — Licensing core: R2 mechanism (b)

**Task**: TASK_2026_201 · **Batch**: 2 (Tasks 2.1, 2.2) · **Executor**: `backend-developer`
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort`
**Branch**: `ak/founding-cohort-free-access` (HEAD at start: `7257cbae1`)
**Status**: 🔄 IMPLEMENTED — awaiting team-leader verification. **Nothing committed, nothing staged.**

**Satisfies**: R2 (mechanism (b)), R4.3, R5.6, R7 (`userWasCreated` now obtainable)

---

## ⚠️ Read this first — one cross-batch dependency I had to satisfy

**`WaitlistService.markApproved` did not exist.** Task 2.1 requires swapping
`markConverted` → `markApproved` at `license.service.ts:595`, but the method that swap
targets is created by **Task 3.1** (Batch 3), which is still `⏸️ PENDING`. `tasks.md` and
`implementation-plan.md` §9 both assert "B2 and B3 are independent"; on this one line they
are not. Without the method, `api-licensing:typecheck` fails with TS2339 and Batch 2 is
unverifiable.

Grep evidence taken before any edit — `markApproved` appeared nowhere in `libs/api`:

```
libs/api/marketing/src/lib/waitlist/waitlist.service.ts:113: async markConverted(...)
libs/api/licensing/.../license.service.ts:595:                  await this.waitlist.markConverted(...)
libs/api/billing/.../paddle.service.ts:173:                     await this.waitlistSink.markConverted(email);
(no markApproved anywhere)
```

**What I did**: implemented **only the first bullet of Task 3.1** —
`WaitlistService.markApproved(email)` — exactly to its stated spec (a copy of
`markConverted:113-127` on `approvedAt`, `updateMany` with the `approvedAt: null` guard).
I did **not** touch `claimForApproval`, `inviteBatch`, `resolveInviteTargets`,
`DEFAULT_INVITE_BATCH_SIZE`, `WaitlistInviteResult`, or `waitlist.service.spec.ts` — all of
that remains Batch 3's.

**Action for the team-leader / Batch 3 developer**: Task 3.1's first bullet is **already
landed**. Batch 3 must *verify and keep* it, not re-add it, and Task 3.2 still owes it spec
coverage (stamps · no-op on an already-stamped row with the timestamp unmoved · no-op on an
unknown email). Flagging rather than silently duplicating.

---

## Files changed (3)

| # | File | Op | Task |
| --- | --- | --- | --- |
| 1 | `libs/api/licensing/src/lib/license/services/license.service.ts` | M | 2.1 |
| 2 | `libs/api/licensing/src/lib/license/services/license.service.spec.ts` | M | 2.2 |
| 3 | `libs/api/marketing/src/lib/waitlist/waitlist.service.ts` | M | **cross-batch (3.1 bullet 1)** |

`git diff --stat` also lists `apps/ptah-license-server/prisma/seed/community-seed.spec.ts`
— that is **TASK_2026_202's** concurrent workstream in the shared tree. I did not open,
edit, stage or revert it.

---

## 1. `license.service.ts` — file-by-file

### 1a. New exported type

```ts
export interface IssueComplimentaryLicenseTxParams {
  user: User;
  plan: PlanName;
  durationPreset: ComplimentaryDurationPreset;
  expiresAt: Date | null;
  createdBy: string;
  actor: AdminActor;
  reason: string;
  stackOnTopOfPaid?: boolean;
}
```

**Deviation from plan §1, stated explicitly**: §1 lists the core's params as
`{ user, plan, expiresAt, createdBy, actor, reason, stackOnTopOfPaid }` — no
`durationPreset`. But §1 also requires the audit metadata be *"byte-for-byte the metadata at
`:536-548`"*, and that metadata contains `durationPreset: dto.durationPreset`. The two
sentences cannot both hold without the field. I added it, because "byte-for-byte metadata"
is the load-bearing requirement (R7 audit fidelity) and the param list was illustrative.
Batch 5's call site therefore passes `durationPreset: '1y'` **twice** — once here for the
`license.complimentary.issue` row, once in its own `waitlist.approve` metadata — which is
what plan §2's pseudo-code already shows for the second one.

`plan` is typed `PlanName` (`'community' | 'builders'`, `plans.config.ts:70`) rather than the
DTO's narrower `'builders'`, so the core does not depend on `IssueComplimentaryLicenseDto`.

### 1b. The four new methods — exact signatures

```ts
computeComplimentaryExpiresAt(                       // was private :406
  preset: ComplimentaryDurationPreset,
  customExpiresAt: string | undefined,
  now: Date,
): Date | null

async findOrCreateUserByEmail(                       // was private :388, returned User
  email: string,
  client?: Prisma.TransactionClient,
): Promise<{ user: User; created: boolean }>

async withLicenseKeyRetry<T>(                        // extracted from :525-584
  fn: () => Promise<T>,
): Promise<T>

async issueComplimentaryLicenseTx(                   // the core
  tx: Prisma.TransactionClient,
  params: IssueComplimentaryLicenseTxParams,
): Promise<License>
```

`Prisma.TransactionClient` is the same type `AuditLogService` uses
(`audit-log.types.ts:226`, `audit-log.service.ts:73`), and `client ?? this.prisma` is that
file's exact `tx ?? this.prisma` shape — verified before use, not assumed.

### 1c. `issueComplimentaryLicenseTx` — the four steps, in order, and nothing else

1. conflict guard from `:501-524`, **`tx.license.findFirst`**, skipped when
   `stackOnTopOfPaid === true`; throws the identical `ConflictException`
   (`EXISTING_ACTIVE_LICENSE`, same message string, same `existingLicense` projection).
2. `const licenseKey = this.generateLicenseKey()` — **a fresh key per call**, so a
   caller-level retry re-enters with a new key rather than re-issuing the colliding one.
3. `this.auditLog.write({ tx, … })` with metadata byte-for-byte `:536-548`
   (`userId`, `userEmail`, `durationPreset`, `expiresAt`, `reason`, `plan`, `stacked`),
   plus `ipAddress` / `userAgent` from the actor.
4. `tx.license.create({ … source: 'complimentary' … })` from `:551-561`.

It **sends no email, stamps no waitlist row, opens no transaction, and does not retry.**

### 1d. `withLicenseKeyRetry` — the aborted-transaction trap, and why (a) stays rejected

Extracted verbatim in behaviour from `:525-584`: 3 attempts, `continue` only on
`Prisma.PrismaClientKnownRequestError` with `code === 'P2002'` and `attempt < maxAttempts`,
the same `License key collision on attempt N/3, retrying` warn line, everything else
rethrown on the first attempt. The docblock records the reasoning so it survives the next
reader:

> On PostgreSQL, any statement error inside an open transaction puts the session into the
> aborted state (`25P02`) and every subsequent statement fails until `ROLLBACK`. A P2002
> caught *inside* an interactive transaction cannot be retried inside it — the retry would
> issue its next statement into an aborted session while still *looking* like a retry.

The `if (!createdLicense) throw lastError` tail of the original loop is preserved as an
unreachable defensive tail (the final attempt either returns or rethrows), annotated as such.

Mechanism (a) is **not** reintroduced anywhere: `createComplimentaryLicense` has no `tx`
parameter, and no side effect of it was turned into a caller-supplied callback.

### 1e. `createComplimentaryLicense` — the thin composition

Body is now, in order: recipient resolution (unchanged, outside the tx) → `expiresAt`
(400 still thrown before any write) → `withLicenseKeyRetry(() => prisma.$transaction(tx =>
issueComplimentaryLicenseTx(tx, {…})))` → the unchanged log line →
`this.waitlist.markApproved(recipient.email)` in the unchanged best-effort try/catch →
the unchanged `dto.sendEmail !== false` block → `{ license }` / `{ license, warning }`.

Local `const recipient: User = user` after the null check — the closure needs the narrowed
form; TS does not carry the narrowing of a `let` into a callback.

### 1f. R4.3 — `markConverted` → `markApproved`

Swapped, and the comment at `:590-593` rewritten: *"A gift is not a conversion. This used to
call `markConverted`, which polluted the paid-conversion funnel with every free grant;
`convertedAt` is now written by exactly one thing, the Paddle provisioning fan-out."*
The failure log line was renamed with it (`… waitlist markApproved failed for …`).

### 1g. `createLicense:332`

`const user = await this.findOrCreateUserByEmail(email);` →
`const { user } = await this.findOrCreateUserByEmail(email);` — one line, as plan §1 predicts.

---

## 2. `waitlist.service.ts` — `markApproved` (cross-batch, see the banner above)

```ts
async markApproved(email: string): Promise<void>
```

`updateMany({ where: { email: normalized, approvedAt: null }, data: { approvedAt: new Date() } })`
plus the two log branches — structurally identical to `markConverted:113-127`. The
`approvedAt: null` guard is what makes a re-run never move an existing stamp (R4.6); an
unknown email resolves to `{ count: 0 }` rather than throwing. The docblock states the
three-disjoint-writers rule and warns that the approve-to-cohort action must **not** use
this method (it claims by id inside its own transaction, because the claim is also its
idempotency guard — R5).

`EmailService` remains injected (`join` still calls `sendWaitlistConfirmation:90`).
Nothing was deleted from this file.

---

## 3. `license.service.spec.ts` — Task 2.2

**Renames**: the `markConverted` mock (`:91`) and the `waitlist conversion` describe
(`:437-466`) → `markApproved` / `waitlist approval stamping`. Import widened to
`import { Prisma, PrismaService } from '@ptah-api/core'`.

**The `$transaction` harness at `:39-55` was NOT rewritten** — verified, not assumed: it
still returns the prisma mock itself as `tx`, which is exactly why every pre-existing
`prisma.license.findFirst` / `prisma.license.create` / `writeArg.tx === prisma` assertion
still binds after the conflict guard moved inside the transaction.

**Added — 14 tests across 3 new describes plus one in the renamed one:**

`issueComplimentaryLicenseTx (the tx-aware core)` — uses a **distinct** tx handle, because
the shared harness's `tx === prisma` identity cannot by itself prove a read went through
`tx`:
- reads the conflict guard through the tx handle and **`prisma.license.findFirst` is never
  called** (the TOCTOU closure, proven rather than asserted by comment);
- audit row and licence go through the **same** handle (`writeArg.tx === tx`), metadata
  matched field-by-field, `licenseKey` matches `/^ptah_lic_[0-9a-f]{64}$/`;
- **never opens a transaction, sends no mail, stamps no waitlist row** (the structural
  suppression R3 relies on);
- 409 `EXISTING_ACTIVE_LICENSE` from the tx-side guard, before `auditLog.write` and before
  `tx.license.create`;
- `stackOnTopOfPaid: true` skips the guard and audits `stacked: true`.

`withLicenseKeyRetry (the retry owns the WHOLE transaction)`:
- **R5.6** — P2002 on attempt 1 ⇒ `$transaction` called **twice**, the two attempts use
  **different licence keys**, exactly one licence is returned, and `markApproved` fires
  **once** (one committed grant, not one per attempt);
- 3 failed attempts ⇒ P2002 rethrown, no stamp, no mail;
- a non-P2002 failure ⇒ **one** `$transaction` call, error propagates unretried;
- the 409 raised *inside* the transaction is **not** retried (one `$transaction` call);
- a resolving `fn` passes straight through.

`findOrCreateUserByEmail`: `created: false` for an existing user (no `create` call);
`created: true` when it created one (R7 `userWasCreated`); with a supplied `tx`, **both**
the read and the create run on that handle and the base client is never touched — so a
rollback can remove a user the call created.

`waitlist approval stamping` gains **R4.3 — never stamps convertedAt**: a `markConverted`
jest.fn is attached to the mock and asserted **not called**, so a future regression back to
`convertedAt` fails rather than passing silently.

---

## 4. Evidence the observable contract of `createComplimentaryLicense` is unchanged

| Contract element | Before | After | Evidence |
| --- | --- | --- | --- |
| Signature | `(dto: IssueComplimentaryLicenseDto, actor: AdminActor)` | identical | `admin-licenses.controller.ts` untouched; `api-admin:typecheck` + `api-admin:test` green with **no spec edit there** |
| Return type | `Promise<ComplimentaryLicenseResult>` | identical — `ComplimentaryLicenseResult` not modified (incl. `warning.error: string`, left alone per plan §9) | typecheck |
| 400 `INVALID_CUSTOM_DATE` / `MISSING_RECIPIENT` | before any write | before any write — `computeComplimentaryExpiresAt` still runs **outside** `$transaction` | 4 pre-existing custom-date tests pass unchanged, incl. their `license.create`/`auditLog.write` not-called assertions |
| 404 `USER_NOT_FOUND` | unchanged block | unchanged block | untouched code |
| 409 `EXISTING_ACTIVE_LICENSE` | thrown pre-transaction | thrown inside the transaction, same code/message/`existingLicense` | pre-existing 409 test passes verbatim; new test proves it is not retried |
| `source: 'complimentary'`, `status`, `createdBy`, key format | `:551-561` | same `data` object, now in the core | pre-existing persistence tests pass |
| Audit row in the same tx as the create | `:533-549` | same, in the core | pre-existing `writeArg.tx === prisma` test passes |
| Duration presets 30d/1y/5y/never/custom | `:406-448` | same method, now public | 5 pre-existing preset tests pass |
| Best-effort mail + `LICENSE_EMAIL_FAILED` | `:603-621` | byte-identical block | untouched |
| P2002 retry semantics | 3 attempts, whole-tx | 3 attempts, whole-tx | new R5.6 test |
| **Waitlist stamp** | `markConverted` | **`markApproved`** | the one intended behaviour change — R4.3 |

**Two deliberate, contract-neutral behaviour changes**, both plan-sanctioned:
1. the conflict-guard read moved `this.prisma` → `tx` (closes a TOCTOU window);
2. a 409 now opens and rolls back one empty transaction before throwing. No client-visible
   difference; called out so a reviewer reading query logs is not surprised.

**Public surface of `@ptah-api/licensing` grew by four methods and one exported interface.
Nothing was removed or renamed.**

---

## 5. Verification — commands and results

`tasks.md`'s Batch 2 block names `npx nx lint ptah-license-server`. **That target does not
exist**; the lint target in this repo is the `@nx/eslint/plugin`-inferred `eslint:lint`
(`nx.json:84-87`), as `tasks.md`'s own "Lint command shape" section says. Commands run:

| Command | Result |
| --- | --- |
| `npx nx run api-licensing:test` | ✅ **5 suites, 73 tests passed** |
| `npx nx run api-licensing:typecheck` | ✅ pass |
| `npx tsc --noEmit -p libs/api/licensing/tsconfig.spec.json` | ✅ pass (the `typecheck` target uses `tsconfig.lib.json`, which **excludes specs** — this closes that hole) |
| `npx nx run api-admin:test` | ✅ **32 passed** — the only caller of `createComplimentaryLicense`, unedited |
| `npx nx run api-marketing:test` | ✅ pass |
| `npx nx run-many -t typecheck -p api-licensing,api-marketing,api-admin,ptah-license-server` | ✅ 4/4 pass |
| `npx nx run api-licensing:eslint:lint --skip-nx-cache` | ✅ **0 errors**, 1 warning — pre-existing, `auth-endpoints/auth.controller.ts:593`, not a file I touched |
| `npx nx run-many -t eslint:lint -p api-licensing,api-marketing` | ✅ **0 errors**, 12 warnings total — all pre-existing (`segment-resolver.service.ts:95`, `template-render.service.spec.ts:6`, `unsubscribe-token.service.spec.ts:7-8`, `auth.controller.ts:593`); **zero** in `license.service.ts`, `license.service.spec.ts`, `waitlist.service.ts` |
| `npx nx run ptah-license-server:test --skip-nx-cache` | ✅ **5 suites, 163 tests passed** (fresh, not cached) |

### On the foreign RED spec

`apps/ptah-license-server/prisma/seed/community-seed.spec.ts` is **TASK_2026_202 Batch 2's**
concurrent work. Two facts for the record: (1) it is **not** in `ptah-license-server:test`'s
suite set — that target ran 5 suites / 163 tests, all green, and the seed spec is not among
them; (2) I did not read, run, edit, stage or revert it. **No failure in any command above
is attributable to it, and none of my results required excluding it.**

---

## 6. Standards compliance

- `catch (error: unknown)` narrowed with `instanceof Error` — the `markApproved` catch keeps
  the existing shape. The two `catch (err)` blocks in `withLicenseKeyRetry` / the mail block
  are pre-existing untyped catches carried over verbatim from `:564` / `:611`; they narrow
  with `instanceof` before touching `.message`. I did not widen or change them.
- No `@ts-ignore`, no `@ts-expect-error`, no `any` added.
- No `process.env` added. (`getSigningKey:139` reads `process.env` directly — **pre-existing**,
  outside this batch, and untouched. Worth a follow-up; it is the licensing-lib twin of the
  `license.service.ts:148` item in the standing quality baseline.)
- No raw `error.message` reaches a client: the only new throw paths are `ConflictException`
  with a fixed message and the rethrown P2002, whose handling is unchanged.
- No new import crosses `libs/api/**` → `libs/backend/**` or `libs/frontend/**`; no new
  `@ptah-api/*` specifier at all. `Prisma` and `PlanName` were already imported.
- No stubs, no `// TODO`, no placeholder, no mock data in production code.
- Licence keys appear in no log line, no audit metadata and no HTTP payload — the core logs
  nothing, and the composition's log line prints `createdLicense.id`, never the key.

---

## 7. Incomplete / carried forward

1. **`WaitlistService.markApproved` has no spec yet.** Task 3.2 owes it three cases (stamps ·
   no-op on an already-stamped row with the timestamp unmoved · no-op on an unknown email).
   I stopped short of writing them to keep Batch 3's file conflict surface to one method.
   `license.service.spec.ts` covers the *call site* (`markApproved` invoked once with the
   lowercased email; `markConverted` never invoked); the *method body* is untested until 3.2.
2. **`tasks.md` Batch 2 verification block is wrong** about `nx lint ptah-license-server`.
   Recommend the team-leader correct it to `npx nx run-many -t eslint:lint -p api-licensing`
   to match the file's own "Lint command shape" section.
3. **Batch 3's Task 3.1 first bullet is already done.** Its status line should be annotated
   before Batch 3 is dispatched, or two developers will write the same method.
4. **`typecheck` targets exclude spec files** across `libs/api/**` (they run
   `tsconfig.lib.json`). Batches 3–5 should not read a green `typecheck` as covering their
   new specs; run the suite, or `tsc -p tsconfig.spec.json`, as this batch did.
5. **Not done, and correctly so** (out of batch): `claimForApproval`, `inviteBatch` deletion,
   `requireGroupByKey` / `assignInTx`, the email replacement, and the approve endpoint —
   Batches 3, 4, 5.
6. **No git operations performed.** Nothing committed, nothing staged, nothing reverted.

---

## Task status

- **Task 2.1** — Extract the tx-aware licence-creation core → ✅ COMPLETE
- **Task 2.2** — Update the licence service spec → ✅ COMPLETE

---

## Team-Leader Verification

**Verdict**: ✅ **APPROVED AND COMMITTED** — `79a735f65`
`feat(license-server): extract the tx-aware complimentary licence core`

Verified by reading the code, not the report.

### 1. Mechanism (b) is what was built — CONFIRMED

All four members exist on `LicenseService` with the signatures §1 specifies:
`computeComplimentaryExpiresAt` (public), `findOrCreateUserByEmail` (public,
`client?: Prisma.TransactionClient`, returns `{ user, created }`), `withLicenseKeyRetry<T>`,
`issueComplimentaryLicenseTx(tx, params)`.

`issueComplimentaryLicenseTx` read line-by-line: conflict guard on `tx.license.findFirst` (skipped
when `stackOnTopOfPaid === true`) → `this.generateLicenseKey()` → `this.auditLog.write({ tx, … })` →
`tx.license.create({ … source: 'complimentary' … })`, then `return`. **No `sendLicenseKey`, no
`this.emailService` reference at all; no `waitlist.*` call; no `$transaction`.** Suppression is
structural, exactly as R3 requires.

The `durationPreset` field added to `IssueComplimentaryLicenseTxParams` is accepted. §1's param list
and §1's "byte-for-byte the metadata at `:536-548`" cannot both hold without it; the metadata is the
load-bearing half (R7 audit fidelity). The deviation was declared, not smuggled.

### 2. Mechanism (a) was NOT smuggled in — CONFIRMED

`createComplimentaryLicense(dto: IssueComplimentaryLicenseDto, actor: AdminActor):
Promise<ComplimentaryLicenseResult>` (`:677-680`) — **no optional `tx` parameter**, and no side
effect turned into a caller-supplied callback. The aborted-transaction hazard is not reintroduced.

### 3. The retry wraps the whole `$transaction` — CONFIRMED

`withLicenseKeyRetry(() => this.prisma.$transaction((tx) => this.issueComplimentaryLicenseTx(tx, …)))`.
The retry sits outside the transaction boundary; the core neither retries nor opens one. The key is
generated *inside* the core, so each re-entry gets a fresh key. The spec proves it behaviourally:
`$transaction` called twice, two different `licenseKey`s, exactly one licence, `markApproved` once.

### 4. Observable contract of `createComplimentaryLicense` — UNCHANGED

Same signature, same `ComplimentaryLicenseResult` (incl. `warning.error: string`, untouched), same
400/404/409 codes and messages. `AdminLicensesController.issueComplimentaryLicense`
(`admin-licenses.controller.ts:70-85`) needed **no change** — `git diff --stat libs/api/admin` is
empty, and `api-admin:test` is green with no spec edit there.

Two contract-neutral behaviour changes, both plan-sanctioned and both declared: the conflict-guard
read moved `this.prisma` → `tx` (closes a TOCTOU window), and a 409 now opens and rolls back one
empty transaction before throwing.

### 5. R4.3 — CONFIRMED

`license.service.ts:744` calls `this.waitlist.markApproved(recipient.email)`. Repo-wide grep for
`markConverted` in production code returns exactly two hits: `paddle.service.ts:173` (the Paddle
provisioning fan-out) and the `waitlist-conversion.sink.ts` interface it is typed against.
**`convertedAt` now has exactly one writer.** The spec adds a regression guard that attaches a
`markConverted` mock and asserts it is never called, so a silent revert fails rather than passes.

### 6. Scope bleed — ACCEPTED, with reasoning

`WaitlistService.markApproved` is assigned to Batch 3, Task 3.1 bullet 1, and landed here.

**Accepted.** `LicenseService` injects the **concrete** class — `@Inject(WaitlistService) private
readonly waitlist: WaitlistService` (`license.service.ts:157`), imported from `@ptah-api/marketing`
(`:16`), not a structural sink interface. Task 2.1's mandated `markConverted` → `markApproved` swap
is therefore a hard TS2339 without the method. The claim in `tasks.md` and plan §9 that "B2 and B3
are independent" is wrong on this one line; the developer found that, stated it, and stopped at the
minimum that restores compilation.

Weighing it: the bleed is **purely additive** (40 lines, one new method), touches nothing else in
`waitlist.service.ts`, and does **not** open the transient `libs/api/admin` build hole — that hole
comes from *deleting* `inviteBatch`, correctly left to Batch 3. Rejecting would produce a commit
that does not compile standalone on the branch, which is strictly worse than a declared, minimal,
additive cross-batch landing. `tasks.md` Task 3.1 has been annotated so Batch 3 verifies and keeps
it rather than writing it twice; its **method body remains untested** and Task 3.2 still owes it
three cases (stamps · no-op on an already-stamped row with the timestamp unmoved · no-op on an
unknown email).

### 7. Commands run (in the worktree, by the team-leader)

| Command | Result |
| --- | --- |
| `npx nx run ptah-license-server:typecheck` | ✅ pass |
| `npx nx run-many -t typecheck -p api-licensing,api-marketing,api-admin` | ✅ 3/3 pass |
| `npx nx run-many -t test -p ptah-license-server,api-licensing,api-admin --skip-nx-cache` | ✅ 3/3 pass (api-licensing: 5 suites / 73 tests) |
| `npx nx run-many -t test -p api-marketing --skip-nx-cache` | ✅ pass |
| `npx tsc --noEmit -p libs/api/licensing/tsconfig.spec.json` | ✅ pass (closes the `tsconfig.lib.json` spec-exclusion hole) |
| `npx tsc --noEmit -p libs/api/marketing/tsconfig.spec.json` | ✅ pass |
| `npx nx run-many -t eslint:lint -p api-licensing,api-marketing,api-admin` | ✅ 0 errors; 1 pre-existing warning at `auth.controller.ts:593`, a file this batch never opened |

**On `nx lint ptah-license-server`**: the developer's report §7.2 is correct. That target does not
exist — `@nx/eslint/plugin` infers `eslint:lint` (`nx.json:84-87`), and `tasks.md`'s own "Lint
command shape" section already said so while its Batch 2 block contradicted it. The Batch 2
verification block has been corrected in place. This is **not** counted as a failure.

### 8. Shared-worktree discipline

`apps/ptah-license-server/prisma/seed/{community-seed.spec.ts,map-course.ts}` are TASK_2026_202's
concurrent workstream. They were **not** read, staged, reverted or commented on. Exactly three files
were staged by name; `git add -A` was never used. The commit is 3 files, 610 insertions,
113 deletions.

**Task 2.1** → ✅ COMPLETE · **Task 2.2** → ✅ COMPLETE · **Batch 2** → ✅ COMPLETE
