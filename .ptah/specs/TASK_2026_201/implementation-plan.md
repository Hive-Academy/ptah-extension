# Implementation Plan — TASK_2026_201

**Founding cohort free access — approve a waitlist row to a complimentary Builders licence**

Surface: `apps/ptah-license-server` + `libs/api/{admin,licensing,marketing,community,email,audit}` + `libs/web/admin`.
Contract: `task-description.md` R1–R10, with `context.md` §"Checkpoint 1 outcomes" C1/C2/C3 binding and closed.

---

## 0. Codebase investigation summary

Everything below was read before any decision was made. Every claim in this plan carries a `file:line`.

### Libraries and the dependency edges that already exist

| Lib                  | Alias                 | Depends on (production imports, verified by grep over `libs/api/*/src`)   |
| -------------------- | --------------------- | ------------------------------------------------------------------------- |
| `libs/api/admin`     | `@ptah-api/admin`     | audit, **community**, core, email, identity, **licensing**, **marketing** |
| `libs/api/licensing` | `@ptah-api/licensing` | audit, community, core, email, identity, marketing                        |
| `libs/api/marketing` | `@ptah-api/marketing` | audit, core, email, identity                                              |
| `libs/api/community` | `@ptah-api/community` | audit, core, email, identity, membership, notifications, youtube          |
| `libs/api/email`     | `@ptah-api/email`     | _(nothing — leaf)_                                                        |
| `libs/api/audit`     | `@ptah-api/audit`     | core                                                                      |

**Load-bearing consequence:** `libs/api/admin` already imports every lib this feature needs. The approve orchestration can be built there with **zero new module edges and zero new `@ptah-api/*` import specifiers**.

### Verified primitives

| Primitive                                                             | Source                                                                                                                                                                                                                                                                                     | Behaviour verified                                                                                                                             |
| --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `AuditLogService.write({ tx, … })`                                    | `libs/api/audit/src/lib/audit-log.service.ts:39-88`, param at `audit-log.types.ts:212-227`                                                                                                                                                                                                 | `const client = tx ?? this.prisma` at `:74`. This is the _only_ tx-injection pattern in the server, and it is the one this plan copies.        |
| PRE-6 (audit inside the mutation's own transaction)                   | `audit-log.types.ts:45-48`, `:76-82`                                                                                                                                                                                                                                                       | Standing rule; `license.service.ts:533-534` is a live call site.                                                                               |
| Whole-transaction P2002 retry                                         | `license.service.ts:525-584`                                                                                                                                                                                                                                                               | The retry loop wraps `this.prisma.$transaction(...)` — it does **not** retry inside the transaction. Confirmed by reading `:529-562`.          |
| Complimentary conflict guard                                          | `license.service.ts:501-524`                                                                                                                                                                                                                                                               | Filters `source: { not: 'complimentary' }` at `:506` — a second comp licence stacks silently (the gap R5 names).                               |
| Expiry presets                                                        | `license.service.ts:406-448`                                                                                                                                                                                                                                                               | `'1y'` → `now + 365 * DAY_MS` at `:416-417`.                                                                                                   |
| Find-or-create user                                                   | `license.service.ts:388-399`                                                                                                                                                                                                                                                               | Lowercases, `findUnique` then `create`. Returns `User`, does **not** report whether it created.                                                |
| Cohort assignment idempotence                                         | `member-groups.service.ts:326-330` (`upsert` on `userId_groupId`), `:465-480` (create + P2002→skip)                                                                                                                                                                                        | Both shapes exist. Unique at `schema.prisma:132`.                                                                                              |
| `MemberGroupsModule` is `@Global()` and exports `MemberGroupsService` | `libs/api/community/src/lib/member-groups/member-groups.module.ts:24-31`                                                                                                                                                                                                                   | Injectable anywhere with no import edge. `admin.service.ts:143-147` already injects it (as `@Optional()`).                                     |
| `markConverted` idempotence                                           | `waitlist.service.ts:113-127`                                                                                                                                                                                                                                                              | `updateMany` with a `convertedAt: null` guard — never moves an existing stamp.                                                                 |
| `dtoPipe` is the only thing validating input                          | `libs/api/core/src/lib/common/dto-validation.pipe.ts:20-45, 69-76`                                                                                                                                                                                                                         | esbuild emits no `design:paramtypes`; a bare `@Body()` is inert.                                                                               |
| Structural guards                                                     | `controller-validation.spec.ts` (`MIN_TOTAL_PAYLOAD_PARAMS = 78` at `:272`, `NAMED_PRIMITIVE_PARAM_COUNT = 6` at `:298`, `UNVALIDATED_DEBT = []` at `:78`), `route-map.spec.ts` (`EXPECTED_ROUTES` incl. `'POST v1/admin/waitlist/invite'` at `:521`, exact-count assertion at `:834-835`) | Both fail the build on drift.                                                                                                                  |
| Source-text invariant pattern                                         | `membership.service.spec.ts:120-126`                                                                                                                                                                                                                                                       | `readFileSync(join(__dirname, 'x.ts'))` then `expect(source).not.toContain(needle)`. This is the model for R3.6.                               |
| Campaign→template FK is `onDelete: SetNull`                           | `schema.prisma:451`, documented `:434`                                                                                                                                                                                                                                                     | **Deleting the template row is safe**: historical `marketing_campaigns` rows survive with `template_id = NULL`.                                |
| Waitlist timestamp columns are `TIMESTAMP(3)`                         | `migrations/20260719120000_add_waitlist/migration.sql:6-8`                                                                                                                                                                                                                                 | `approved_at` must match.                                                                                                                      |
| Migration hazard                                                      | `migrations/20260902090000_.../migration.sql:16-40`                                                                                                                                                                                                                                        | `prisma migrate diff` unconditionally proposes `DROP INDEX` on the three `_trgm` GIN indexes. Every new migration in this app must strip them. |

### UI facts

`libs/web/admin/src/lib/waitlist/` holds exactly two files (`waitlist-pipeline.ts` 355 lines, `waitlist-pipeline.html` 231 lines). The Approve button lives at `waitlist-pipeline.html:148-155` inside `@case ('invited')` only (`:143-144`) — the gate R6.4 closes. `AdminApiService` (`libs/web/admin/src/lib/services/admin-api.service.ts`) declares **outbound request bodies as plain interfaces and inbound responses as Zod schemas whose types are `z.infer`red** (`inviteWaitlist` `:533-543` + `adminInviteWaitlistResponseSchema:261-264`; `getStats` `:546-550` + `adminStatsResponseSchema:302-308`). `WaitlistInviteModal` has a **second consumer**: `admin-list.ts:30,49` + `admin-list.html:79`, gated on `supportsWaitlistInvite` (`libs/web/admin/src/lib/admin-models.config.ts:75, 560`).

---

## 1. THE DELEGATED DECISION (R2) — mechanism **(b)**, refined

### Choice

**(b): extract the licence-creation core into a `tx`-aware method that both `createComplimentaryLicense` and the approve action call.** Mechanism (a) is rejected. Mechanism (c) is forbidden by R2 and is not considered.

### Why (a) fails, concretely — and it is not a style preference

`createComplimentaryLicense`'s P2002 retry (`license.service.ts:525-584`) wraps **the whole `$transaction` call**, not statements inside it. That is not incidental: on PostgreSQL, any statement error inside an open transaction puts the session into the aborted state (`25P02`), and every subsequent statement fails until `ROLLBACK`. So a P2002 caught _inside_ an interactive transaction cannot be retried inside it.

Under (a), `createComplimentaryLicense` would take an optional `tx`. When a caller supplies one, the method's own retry loop can no longer roll back and re-enter — it would catch the P2002, `continue`, and issue the next statement into an aborted transaction, which fails with a message that has nothing to do with a key collision. **The code would still look like it retries.** The type system cannot catch that, and R5.6 (`the existing 3-attempt P2002 retry SHALL still apply`) would be silently unmet on the new path. (a) also turns `markConverted` and `sendLicenseKey` into caller-supplied callbacks, giving one public method two lifecycles selected by a parameter.

### What (b) looks like, precisely

The extraction line is drawn where the retry can live: **the owner of the transaction owns the retry.**

Three additions to `LicenseService` (`libs/api/licensing/src/lib/license/services/license.service.ts`):

```
public  computeComplimentaryExpiresAt(preset, customExpiresAt, now): Date | null   // was private :406
public  findOrCreateUserByEmail(email, client?): Promise<{ user: User; created: boolean }>   // was private :388, returned User
public  withLicenseKeyRetry<T>(fn: () => Promise<T>): Promise<T>                   // extracted verbatim from :525-584
public  issueComplimentaryLicenseTx(tx, params): Promise<License>                  // the core
```

`issueComplimentaryLicenseTx(tx, { user, plan, expiresAt, createdBy, actor, reason, stackOnTopOfPaid })` does, in this order and nothing else:

1. the conflict guard from `:501-524`, **now reading through `tx`** — unless `stackOnTopOfPaid === true`;
2. `const licenseKey = this.generateLicenseKey()` — a fresh key per call, so a caller-level retry gets a fresh key;
3. the `license.complimentary.issue` audit write via `this.auditLog.write({ tx, … })`, byte-for-byte the metadata at `:536-548`;
4. `tx.license.create({ … source: 'complimentary' … })` from `:551-561`.

It **sends no email, stamps no waitlist row, and never opens a transaction.** Suppression of `sendLicenseKey` for the approval path (R3) is therefore _structural, not conditional_: the core has no mail side effect to suppress, and each caller owns its own outbound message.

`createComplimentaryLicense` is rewritten as a thin composition that preserves its observable contract exactly:

```
resolve recipient (:477-495, unchanged, outside the tx)
expiresAt = computeComplimentaryExpiresAt(...)         // 400 still thrown before any write
license = await withLicenseKeyRetry(() =>
            this.prisma.$transaction(tx => this.issueComplimentaryLicenseTx(tx, {...})))
log line (:586-588, unchanged)
await this.waitlist.markApproved(user.email)            // R4.3 — was markConverted
if (dto.sendEmail !== false) sendLicenseKey(...)        // :603-621, unchanged
return { license } | { license, warning }
```

### Blast radius on existing callers

| Call site                                                                                                                                        | Impact                                                                                                                                                                                                                                                                                                                                     |
| ------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `AdminLicensesController.issueComplimentaryLicense` (`admin-licenses.controller.ts:80-85`) — the **only** caller of `createComplimentaryLicense` | **None.** Signature, `ComplimentaryLicenseResult` return type, thrown `Conflict/BadRequest/NotFound` and HTTP behaviour all unchanged.                                                                                                                                                                                                     |
| `LicenseService.createLicense` (`:332`)                                                                                                          | One line: `const user = await this.findOrCreateUserByEmail(email)` → `const { user } = await …`.                                                                                                                                                                                                                                           |
| `license.service.spec.ts`                                                                                                                        | Mock rename `markConverted` → `markApproved` (`:91`, `:444-459`). Everything else passes unchanged **because the spec's `$transaction` mock returns the prisma mock itself as `tx`** (`:48-53`), so moving the conflict `findFirst` inside the transaction leaves `prisma.license.findFirst` assertions intact. Verified against `:39-55`. |
| Public surface of `@ptah-api/licensing`                                                                                                          | Grows by four methods. Nothing removed, nothing renamed.                                                                                                                                                                                                                                                                                   |

**One deliberate behaviour change:** the conflict guard read moves from `this.prisma` (`:502`) to `tx`. That is strictly better — it closes a TOCTOU window between "no active paid licence" and the create — and changes no observable contract.

---

## 2. Transaction design (R1, R2)

### The boundary

**One `prisma.$transaction(async tx => …)` per waitlist row.** Steps 1–6 of R1 are inside it. Step 7 (email) is outside, after commit. Rows are processed **sequentially**, never `Promise.all`: 50 concurrent interactive transactions would exhaust the connection pool, and per-row isolation is the point, not per-row parallelism. (50 rows × ~200 ms ≈ 10 s, inside the 30 s NFR budget.)

### Per-row algorithm

Resolved **once per request, before the loop**: `foundingGroup = await memberGroups.requireGroupByKey('founding')`. It throws a sanitized 500 if absent, before any row is touched — which is exactly R1.5's "no licence SHALL be issued for **any** row". A fallback to `isDefault` is forbidden and is not written.

```
for (const id of dto.ids) {                       // sequential
  for (attempt = 1..3) {                          // retry ONLY on P2002 (withLicenseKeyRetry)
    try {
      committed = await prisma.$transaction(async (tx) => {
        // ── 1. read ────────────────────────────────────────────────────────
        row = await tx.waitlist.findUnique({
          where: { id },
          select: { id: true, email: true, notifiedAt: true, approvedAt: true },
        });
        if (!row) throw new SkipRow('not_found');

        // ── 2. THE CONDITIONAL CLAIM (R5) — first WRITE in the transaction ─
        const { count } = await tx.waitlist.updateMany({
          where: { id, approvedAt: null },
          data:  { approvedAt: now },
        });
        if (count === 0) throw new SkipRow('already_approved', row);

        // ── 3. recipient ──────────────────────────────────────────────────
        const { user, created } = await license.findOrCreateUserByEmail(row.email, tx);

        // ── 4. already-paid guard (R5.4) ──────────────────────────────────
        if (await this.holdsPaidEntitlement(tx, user.id)) throw new SkipRow('already_paid', row);

        // ── 5. licence (the shared core) ──────────────────────────────────
        const lic = await license.issueComplimentaryLicenseTx(tx, {
          user, plan: 'builders',
          expiresAt: license.computeComplimentaryExpiresAt('1y', undefined, now),
          createdBy: actor.email, actor,
          reason: 'Founding cohort approval (waitlist)',
          stackOnTopOfPaid: false,
        });

        // ── 6a. cohort ────────────────────────────────────────────────────
        const { created: cohortCreated } =
          await memberGroups.assignInTx(tx, {
            userId: user.id, groupId: foundingGroup.id, source: 'admin',
          });

        // ── 6b. audit, INSIDE the boundary (PRE-6) ────────────────────────
        await auditLog.write({
          tx, actorEmail: actor.email,
          action: 'waitlist.approve', targetType: 'Waitlist', targetId: row.id,
          metadata: { email: row.email, userId: user.id, userWasCreated: created,
                      licenseId: lic.id, durationPreset: '1y',
                      expiresAt: lic.expiresAt?.toISOString() ?? null,
                      groupKey: 'founding', wasNotified: row.notifiedAt !== null,
                      cohortAlreadyAssigned: !cohortCreated },
          ipAddress: actor.ip, userAgent: actor.userAgent,
        });

        return { row, license: lic };
      });
      break;                                       // committed
    } catch (e) {
      if (e instanceof SkipRow)                    // tx rolled back — nothing persisted
        → record e.outcome, no audit row (R7.3), no mail, next row
      if (isP2002(e) && attempt < 3)  continue;    // fresh key / fresh tx
      → outcome 'failed', log server-side, record { error: { code: 'GRANT_FAILED' } }
    }
  }
  // ── 7. POST-COMMIT, OUTSIDE THE TRANSACTION ──────────────────────────────
  try { await email.sendFoundingCohortWelcome({ email, licenseKey, expiresAt }); }
  catch (error: unknown) { log; outcome stays 'approved'; warning = { code: 'APPROVAL_EMAIL_FAILED' } }
}
```

### Why the retry wraps the whole transaction rather than the create

Same PostgreSQL fact as §1: a P2002 inside an open transaction aborts it. Retrying the whole transaction is therefore the **only** correct shape — and it is already the shape `license.service.ts:529-562` uses, so this is consistency, not invention. It also gives R5.6 for free: attempt 1 rolls back entirely (including the claim), so a retried attempt can never produce two licences.

### Why the cohort assignment is an `upsert`, not `create` + `catch (P2002)`

`member-groups.service.ts:465-479` catches P2002 and counts it as skipped — but that code runs **outside** any transaction. Copying it inside our transaction would abort the transaction on the very race it is trying to tolerate. `assignInTx` therefore does a `findUnique` (to report `created`) followed by `upsert` on `userId_groupId` with `update: {}`, exactly the shape `assignDefaultGroup` already uses at `:326-330`. Prisma compiles a simple non-nested upsert on a unique constraint to `INSERT … ON CONFLICT DO UPDATE`, so no error is raised. If Prisma ever degrades to find-then-create, a concurrent racer produces a P2002 that the whole-transaction retry above absorbs. R5.3's outcome ("already assigned", not an error) holds under both.

### Rollback semantics, stated against each acceptance criterion

| Criterion                                                                     | Mechanism                                                                                                                                                                                                                                                                     |
| ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R2.1 cohort-create failure ⇒ no licence, `approvedAt` null, no audit, no mail | Steps 2, 5, 6a, 6b are one transaction; mail is after commit.                                                                                                                                                                                                                 |
| R2.2 audit failure rolls the row back                                         | 6b is inside the transaction, no `try/catch` around it. This is the deliberate divergence from `admin-waitlist.controller.ts:84-104` and `member-groups.service.ts:599-611`, where the audit is swallowed _because the mail had already gone out_. Here nothing has gone out. |
| R2.3 commit + mail throws ⇒ `approved` + `APPROVAL_EMAIL_FAILED`              | Step 7's `catch`.                                                                                                                                                                                                                                                             |
| R2.4 row 3 of 10 throws ⇒ 1–2 and 4–10 commit, HTTP 200                       | Per-row transaction + per-row `catch`; the loop never rethrows.                                                                                                                                                                                                               |
| R2.5 stable code only, no raw `error.message`                                 | See §4.                                                                                                                                                                                                                                                                       |
| R5.5 rollback after the claim leaves `approvedAt` null                        | The claim is _inside_ the transaction, so a rollback releases it.                                                                                                                                                                                                             |

### Isolation-level note (do not skip this)

Prisma runs PostgreSQL transactions at **Read Committed**. The claim's `updateMany … WHERE approved_at IS NULL` takes a row lock; a concurrent transaction on the same row **blocks** on that lock and, on release, re-evaluates the predicate against the committed row — sees a non-null `approved_at` — and reports `count = 0`. Exactly one winner, no `500` on either side (R5.2). No `SERIALIZABLE` escalation and no advisory lock is required, and none should be added.

---

## 3. Idempotency and the outcome taxonomy (R5)

### The exact claim statement

```sql
UPDATE "waitlist" SET "approved_at" = $now WHERE "id" = $id AND "approved_at" IS NULL
```

expressed as `tx.waitlist.updateMany({ where: { id, approvedAt: null }, data: { approvedAt: now } })`.

**It is the first write in the transaction**, immediately after the `findUnique` that distinguishes `not_found` from `already_approved`. The `findUnique` is advisory only — a racer that claims between the read and the update is caught by `count === 0`, so the read cannot introduce a race.

**The waitlist row is the idempotency key, not the licence table.** `createComplimentaryLicense`'s conflict guard explicitly excludes complimentary licences (`license.service.ts:506`), so "does this user already have a licence?" would return _no_ for someone who already holds a comp grant and would issue a second one silently. That hole is why the claim lives on `Waitlist.approvedAt`.

### `already_paid` — the guard, and one deliberate superset

`holdsPaidEntitlement(tx, userId)` returns true when **either**:

- `tx.license.findFirst({ where: { userId, status: 'active', plan: 'builders', source: { not: 'complimentary' } } })`, or
- `tx.subscription.findFirst({ where: { userId, status: { in: ['active', 'trialing'] } } })`.

The first clause is R5.4 verbatim. The second is a deliberate superset, and it is justified: `MembershipService.isBuildersMember` checks the **subscription first** (`membership.service.ts:70-76`), so a Paddle subscriber whose licence row is missing or mis-sourced is already a paying member. Without the second clause, that person receives a free 1-year grant and a "you're in, it's free" email on top of a subscription they are paying for. The clause never contradicts R5.4 (it only widens `already_paid`), costs one indexed read per row, and `stackOnTopOfPaid` is not set anywhere in this path.

### The taxonomy and where each value is produced

| Outcome            | Produced at                                | Persisted effect                             | Audit                                                                 | Mail                |
| ------------------ | ------------------------------------------ | -------------------------------------------- | --------------------------------------------------------------------- | ------------------- |
| `approved`         | transaction commits                        | licence + assignment + `approvedAt` + audit  | ✅ `waitlist.approve` (+ `license.complimentary.issue` from the core) | ✅ one welcome mail |
| `already_approved` | claim returns `count = 0` → `SkipRow`      | none (rolled back)                           | ❌ (R7.3)                                                             | ❌                  |
| `already_paid`     | `holdsPaidEntitlement` → `SkipRow`         | none (rolled back — `approvedAt` stays null) | ❌                                                                    | ❌                  |
| `not_found`        | `findUnique` returns null → `SkipRow`      | none                                         | ❌                                                                    | ❌                  |
| `failed`           | non-P2002 throw, or P2002 after 3 attempts | none (rolled back)                           | ❌ (R7.2)                                                             | ❌                  |

`SkipRow` is a private sentinel class in `waitlist-approval.service.ts` carrying the outcome. It is **never** thrown out of the service — throwing it is how the transaction is made to roll back, and it is caught immediately outside `$transaction`. It is not an `HttpException` and cannot reach the client.

---

## 4. Response contract, and where the type lives

### Shape

```ts
// libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts
export const WAITLIST_APPROVAL_OUTCOMES = ['approved', 'already_approved', 'already_paid', 'not_found', 'failed'] as const;
export type WaitlistApprovalOutcome = (typeof WAITLIST_APPROVAL_OUTCOMES)[number];

/** Stable, client-safe failure codes. Never a Prisma or provider message. */
export type WaitlistApprovalErrorCode = 'GRANT_FAILED';

export interface WaitlistApprovalRowResult {
  id: string;
  /** Null only for `not_found` — the address was never learned. */
  email: string | null;
  outcome: WaitlistApprovalOutcome;
  /** Present iff `outcome === 'approved'`. Never the licence KEY. */
  licenseId?: string;
  /** R6.2 — absent for `not_found`. */
  wasNotified?: boolean;
  /** R2.3 — grant persisted, mail did not. Code only; the cause is logged server-side. */
  warning?: { code: 'APPROVAL_EMAIL_FAILED' };
  /** R2.5 / R8.6 — code only. */
  error?: { code: WaitlistApprovalErrorCode };
}

export interface WaitlistApprovalResponse {
  requested: number;
  tally: Record<WaitlistApprovalOutcome, number>;
  results: WaitlistApprovalRowResult[];
}
```

**No licence key appears anywhere in this payload, in the audit metadata, or in any log line** (R7.4, NFR-Security). The key travels only in the email.

**Deliberate divergence from `ComplimentaryLicenseResult`:** that type carries `warning.error: string` (`license.service.ts:41`), i.e. a raw provider message. R2.5 forbids that here, so the approve warning is `{ code }` only. `ComplimentaryLicenseResult` is **not** changed — it belongs to a different endpoint and is out of scope; noted in §9.

### Where the type lives — investigated, not assumed

**It does NOT go in `libs/api-contracts/community`.** Evidence:

- That lib's entire surface is the **community** domain: `shared/` (visibility, reactions, notification kinds, session-request status, paging) plus `member/` (hub, topic, search, course, lesson-comment, live, pack, notification, session-request) and `admin/` (pack, session-request, live, topic, course). There is **no** waitlist, licensing, stats or user contract anywhere in it.
- Its stated invariant (`src/index.ts` docblock, mirrored in `admin-pack.contract.ts`, enforced by `src/lib/contract-boundary.spec.ts`) is that `member/` and `admin/` never reference each other and the lib imports nothing else. Widening it to a non-community admin workflow dilutes a boundary that has an executable guard on it.
- The **established convention for this exact surface** is the opposite: every waitlist/stats/licence admin call declares its request body as a plain interface and its response as a **Zod schema validated at the boundary, local to `admin-api.service.ts`** — `adminInviteWaitlistResponseSchema:261-264`, `adminStatsResponseSchema:302-308`, `IssueComplimentaryLicenseRequest:57-66`. `AdminStatsResponse` is already declared twice (server `admin.service.ts:73-99`, client Zod-inferred) and that duplication is the deliberate pattern for the admin panel.

**Decision:**

- **Server:** `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts`, re-exported from `libs/api/admin/src/index.ts`, used directly as `AdminWaitlistController.approveWaitlist`'s return type — exactly how `AdminStatsResponse` is used by `AdminStatsController:38`.
- **Client:** `adminApproveWaitlistResponseSchema` + `AdminApproveWaitlistResponse = z.infer<…>` and `AdminApproveWaitlistRequest { ids: string[] }` in `admin-api.service.ts`, replacing the invite pair at `:95-98` / `:261-267`, and validated through `validate(schema, label)` like every sibling.

---

## 5. Migrations

Two **new** migration folders. **No applied migration file is edited** (R10.3) — `20260806000000_fix_founding_invite_offer_copy/migration.sql` stays byte-identical, and its header `:9-13` is the reason.

Both must be **hand-authored**. If `prisma migrate diff` is used to generate a starting point, it will emit three unrequested `DROP INDEX` statements on `community_posts_body_trgm`, `community_topics_title_trgm` and `course_lessons_title_trgm` — Prisma cannot express `gin_trgm_ops` and reads them as drift. `20260902090000_.../migration.sql:16-40` documents this and instructs the next migration to run the same check. **Strip them.**

### M1 — `apps/ptah-license-server/prisma/migrations/20260911090000_waitlist_approved_at/migration.sql`

```sql
-- TASK_2026_201 R4 — additive: `Waitlist.approvedAt`.
-- Nullable, no backfill, no default, no index. Re-runnable.
ALTER TABLE "waitlist" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
```

`TIMESTAMP(3)` matches `notified_at` / `converted_at` (`20260719120000_add_waitlist/migration.sql:6-8`). `IF NOT EXISTS` satisfies NFR-Reliability ("migrations are additive and re-runnable"). **No index**: the table is small, the only reads are one `count` aggregate and a `datePresence` filter, and `waitlist_created_at_idx` already serves the ordering.

Paired schema edit (`schema.prisma`, `Waitlist` block `:463-474`):

```prisma
  notifiedAt  DateTime? @map("notified_at")
  approvedAt  DateTime? @map("approved_at")
  convertedAt DateTime? @map("converted_at")
```

…and the model docblock at `:459-462` must be rewritten to name the **three disjoint writers** from R4's table (`notifiedAt` = the retired paid invite, historical only; `approvedAt` = approve-to-cohort and comp-licence issuance; `convertedAt` = the Paddle fan-out only).

### M2 — `apps/ptah-license-server/prisma/migrations/20260911090100_remove_founding_waitlist_invite_template/migration.sql`

Per **C1: delete the row, do not rewrite it.**

```sql
-- TASK_2026_201 R10 / context.md C1 — DELETE the `Founding / Waitlist Invite`
-- marketing template.
--
-- Rewriting it was the PM's recommendation and was REJECTED: the founder will
-- not use the admin campaign sender for this cohort, so a rewritten template is
-- not an asset. Nothing in this task replaces the announcement channel.
--
-- FORBIDDEN, AND WHY: editing `20260806000000_fix_founding_invite_offer_copy/
-- migration.sql` breaks Prisma's per-migration checksum and forces a database
-- RESET (that file's own header, lines 9-13). This is a NEW forward-only file.
--
-- IDEMPOTENT AND UNIFORM. `name` is UNIQUE (schema.prisma:419), so this deletes
-- 0 or 1 rows: a database holding the 70% copy, one holding the older
-- "price locked in" copy, and one that never seeded the row all end in the same
-- state (R10.1), and a second run is a no-op (R10.2).
--
-- SAFE FOR HISTORY. `MarketingCampaign.template` is `onDelete: SetNull`
-- (schema.prisma:451, documented :434), so past campaign rows survive with
-- `template_id = NULL`.
DELETE FROM "marketing_campaign_templates" WHERE "name" = 'Founding / Waitlist Invite';
```

**On R10's "`ON CONFLICT (\"name\") DO UPDATE`, never `DO NOTHING`" rule:** that rule exists because a `DO NOTHING` upsert cannot _reach_ a row that already exists — the exact bug `20260806000000` was written to fix (`migration.sql:16-23`). C1 replaces the upsert with an unconditional keyed `DELETE`, which reaches the existing row by construction. The rule's intent is met; its letter no longer applies because there is no insert. Say this in review before someone reads R10 as unmet.

### Application

`nx run ptah-license-server:prisma:generate` after the schema edit; `prisma migrate deploy` (or `prisma:migrate` in dev) for both files. Confirm against `_prisma_migrations` that nothing sorts between `20260902090000_…` and `20260911090000_…` before writing the timestamps — the same pre-check `20260902090000`'s header records.

---

## 6. The email (R3)

### Deletions (total, not retargeted)

`libs/api/email/src/lib/services/email.service.ts`:

- `sendFoundingInvite` — `:131-166` (method + docblock)
- `buildFoundingCheckoutUrl` — `:681-698`
- `getFoundingInviteTemplate` — `:700-798`, which carries every prohibited string: `promo=founding` (`:696`), `70% founding discount` (`:765`), `$290/year` / `$87` (`:771`), `$29/month` / `$8.70/month` (`:777`), `30-day money-back guarantee` (`:784`), `Renewals are at the list price` (`:788`)
- the `PADDLE_DISCOUNT_ID_BUILDERS_MONTHLY` / `_YEARLY` reads — `:709-714`

The env vars themselves stay in deployment config (task-description Out of Scope).

### Addition

```ts
async sendFoundingCohortWelcome(params: {
  email: string;
  licenseKey: string;
  expiresAt: Date | null;
}): Promise<void>
private getFoundingCohortWelcomeTemplate(params: {
  licenseKey: string; expiresAt: Date | null;
}): string
```

Placed where `sendFoundingInvite` / `getFoundingInviteTemplate` were, so the file's ordering convention (senders at the top, templates below) is preserved. Mechanics copied verbatim from the siblings: `FROM_EMAIL` / `FROM_NAME` via `ConfigService` with the `|| 'help@ptah.live'` / `|| 'Ptah Team'` fallbacks (`:49-50`), `await this.sendWithRetry(msg, 3)` (`:60`), `FRONTEND_URL` via `this.config.get<string>('FRONTEND_URL') || 'https://ptah.live'` (`:707-708` pattern) — which is R3.4: an unset var yields `https://ptah.live/members`, never a relative or malformed URL. **No `process.env` anywhere** (R3.5).

**Subject:** `You're in — Ptah Builders, free for the founding cohort`.

**Body**, dark/gold house style (reuse the `.container/.header/.content/.badge/.cta/.footer` block from `getWaitlistConfirmationTemplate:646-657`, plus the `.license-key` rule from `getLicenseKeyTemplate:341` for the key box):

1. Header `You're in` / `Ptah Builders — Founding Cohort`; badge `Founding Member`.
2. You are in, and it is **free** — no card, no payment now, and none when the cohort ends.
3. What you get: the SaaS-building course, the weekly live sessions, the members' community, the packs.
4. **The C3 scope framing, verbatim in substance, at the top:** _"Founding members keep the course, the recordings and the community for a full year — the two-week cohort is the live part, not the whole of it."_ No countdown framing.
5. One primary CTA: `<a class="cta" href="${frontendUrl}/members">Open the members' area</a>`.
6. How to get in: sign in with **this** email address (the address the mail was sent to).
7. **Licence-details block, lower down** — the key in the monospace `.license-key` box, and the literal expiry date rendered with the existing `toLocaleDateString('en-US', { year:'numeric', month:'long', day:'numeric' })` formatting from `:319-323`. Warm at the top, precise at the bottom (C3).
8. Footer: reply-to-this-email + `ptah.live`, as every sibling.

**Must not contain:** any `$` or other currency symbol, any `%`, any `/pricing` link, any `promo=` or `d=` parameter, the words `discount`, `money-back`, `renew`. There is no second CTA and no billing-cycle choice.

### How the key travels, and how `sendLicenseKey` is suppressed

The key is a parameter of `sendFoundingCohortWelcome`, read from the committed `License.licenseKey` **after** the transaction commits. Suppression is structural: `issueComplimentaryLicenseTx` sends nothing at all (§1), and `WaitlistApprovalService` calls only `sendFoundingCohortWelcome`. There is no `sendEmail: false` flag on this path and none should be added — a flag would be a second, silently-flippable way to get two mails. Exactly one outbound message per approval (R3.3).

### R3.6 — the source-text spec

New file `libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts` (a sibling of `email.service.spec.ts`, whose `ConfigService`/`ResendMailService` mock harness at `:5-28` it reuses).

**Assertions on the rendered HTML** (call `sendFoundingCohortWelcome`, capture `mockResend.emails.send.mock.calls[0][0].html`):

- contains `/members`, contains the licence key, contains the formatted expiry date;
- does **not** match `/\/pricing/`, `/promo=/`, `/&d=/`, `/%/`, `/\$/`, `/discount/i`, `/money-?back/i`, `/renew/i`;
- with `FRONTEND_URL` mocked to `undefined`, contains `https://ptah.live/members` (R3.4).

**Assertions on source text** (the `membership.service.spec.ts:120-126` pattern):

```ts
const source = readFileSync(join(__dirname, 'email.service.ts'), 'utf8');
for (const needle of ['buildFoundingCheckoutUrl', 'getFoundingInviteTemplate', 'sendFoundingInvite', 'promo=founding', 'PADDLE_DISCOUNT_ID_BUILDERS_']) {
  expect(source).not.toContain(needle);
}
```

**Plus a directory sweep for R3.1's second half:** read every `libs/api/email/src/**/*.ts` that is not a `*.spec.ts` and assert none contains `promo=founding`. (The exclusion matters — this spec file itself contains the needle.)

---

## 7. File-by-file change plan

Legend: **C**reate · **M**odify · **D**elete.

### Batch 1 — schema and migrations

| #   | File                                                                                        | Op  | What and why                                                                                                                                           |
| --- | ------------------------------------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1.1 | `apps/ptah-license-server/prisma/schema.prisma`                                             | M   | Add `approvedAt DateTime? @map("approved_at")` to `Waitlist` (`:463-474`); rewrite the model docblock `:459-462` to R4's three-disjoint-writers table. |
| 1.2 | `…/prisma/migrations/20260911090000_waitlist_approved_at/migration.sql`                     | C   | §5 M1.                                                                                                                                                 |
| 1.3 | `…/prisma/migrations/20260911090100_remove_founding_waitlist_invite_template/migration.sql` | C   | §5 M2 (C1).                                                                                                                                            |
| 1.4 | —                                                                                           | —   | `nx run ptah-license-server:prisma:generate`, then `prisma migrate deploy`.                                                                            |

### Batch 2 — licensing core (R2 mechanism (b), R4.3)

| #   | File                                                                  | Op  | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| --- | --------------------------------------------------------------------- | --- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 2.1 | `libs/api/licensing/src/lib/license/services/license.service.ts`      | M   | `findOrCreateUserByEmail` → public, takes optional `client: Prisma.TransactionClient`, returns `{ user, created }` (R7's `userWasCreated`). `computeComplimentaryExpiresAt` → public (one definition of `'1y'`). Add `withLicenseKeyRetry<T>` (extracted from `:525-584`). Add `issueComplimentaryLicenseTx` (conflict guard from `:501-524` now on `tx`, key gen, audit via `tx`, `tx.license.create`). Rewrite `createComplimentaryLicense` as the composition in §1. Swap `markConverted` → `markApproved` at `:595`, and update the comment at `:590-593` ("a gift is not a conversion"). Update `createLicense:332` to destructure. |
| 2.2 | `libs/api/licensing/src/lib/license/services/license.service.spec.ts` | M   | Rename the `markConverted` mock/assertions (`:91`, `:444-459`) → `markApproved`. Add: `issueComplimentaryLicenseTx` writes the audit row through the `tx` handle; the conflict guard now reads through `tx`; `withLicenseKeyRetry` re-enters the whole transaction on P2002 and produces exactly one licence.                                                                                                                                                                                                                                                                                                                            |

### Batch 3 — waitlist + cohort tx-aware primitives; invite path removed (C2)

| #   | File                                                                     | Op  | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| --- | ------------------------------------------------------------------------ | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 3.1 | `libs/api/marketing/src/lib/waitlist/waitlist.service.ts`                | M   | **Add** `markApproved(email)` — a copy of `markConverted:113-127` on `approvedAt`, `updateMany` with the `approvedAt: null` guard (R4.6). **Add** `claimForApproval(tx, id)` returning the discriminated `{ outcome: 'claimed'; row } \| { outcome: 'already_approved'; row } \| { outcome: 'not_found' }` — the `findUnique` + conditional `updateMany` of §3, so all `Waitlist` writes stay owned by this service. **Delete** `inviteBatch:129-186`, `resolveInviteTargets:188-214`, `DEFAULT_INVITE_BATCH_SIZE:24-28`, `WaitlistInviteResult:11-22`. `EmailService` stays injected (used by `join`'s `sendWaitlistConfirmation:90`). |
| 3.2 | `libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts`           | M   | Delete the `inviteBatch` describe (`:126-…`) and the `sendFoundingInvite` mock (`:18`, `:33`). Add `markApproved` (stamps, no-ops on an already-stamped row, no-ops on an unknown email) and `claimForApproval` (three outcomes; second claim on the same row returns `already_approved`).                                                                                                                                                                                                                                                                                                                                              |
| 3.3 | `libs/api/community/src/lib/member-groups/member-groups.service.ts`      | M   | **Add** `requireGroupByKey(key)` — `findUnique({ where: { key } })`, and on miss log the cause and throw `InternalServerErrorException({ code: 'COHORT_NOT_CONFIGURED', message: <fixed sentence> })`. Explicitly **no** `isDefault` fallback (R1.5, risk row "cohort key resolved by `isDefault`"). **Add** `assignInTx(tx, { userId, groupId, source })` → `{ created: boolean }` using `findUnique` + `upsert` (§2). Neither method audits — `waitlist.approve` records `groupKey`.                                                                                                                                                  |
| 3.4 | `libs/api/community/src/lib/member-groups/member-groups.service.spec.ts` | M   | Add: `requireGroupByKey` resolves by key and throws (never falls back) when absent; `assignInTx` returns `created: true` on first assign and `created: false` on a repeat, and never throws P2002 (R5.3).                                                                                                                                                                                                                                                                                                                                                                                                                               |

### Batch 4 — email replacement (R3). **Must land with or after 3.1**, which removes `inviteBatch`, the only caller of `sendFoundingInvite`.

| #   | File                                                              | Op  | What and why                                                                                                                                                                               |
| --- | ----------------------------------------------------------------- | --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 4.1 | `libs/api/email/src/lib/services/email.service.ts`                | M   | Delete `sendFoundingInvite:131-166`, `buildFoundingCheckoutUrl:681-698`, `getFoundingInviteTemplate:700-798`. Add `sendFoundingCohortWelcome` + `getFoundingCohortWelcomeTemplate` per §6. |
| 4.2 | `libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts` | C   | R3.6 — rendered-HTML assertions, `email.service.ts` source-text assertions, and the `libs/api/email/src/**/*.ts` sweep for `promo=founding`.                                               |

### Batch 5 — approve endpoint, audit action, stats, structural guards (R1, R2, R6, R7, R8; C2)

| #    | File                                                                         | Op  | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| ---- | ---------------------------------------------------------------------------- | --- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 5.1  | `libs/api/audit/src/lib/audit-log.types.ts`                                  | M   | Add `\| 'waitlist.approve'` to `AdminAuditAction` (after `:23`), with a docblock naming the R7 argument (it names the waitlist row and the cohort, which `license.complimentary.issue` cannot). **Keep** `'waitlist.invite'`, annotated `// historical — no writer remains after TASK_2026_201; rows exist in admin_audit_log`. `targetType: 'Waitlist'` already exists at `:155`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5.2  | `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.types.ts`        | C   | §4's types + `WAITLIST_APPROVAL_OUTCOMES`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 5.3  | `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.ts`      | C   | The orchestrator of §2. Constructor injects `PrismaService`, `LicenseService`, `WaitlistService`, `MemberGroupsService` (**required — no `@Optional()`**, per the NFR-Boundaries bullet; the `@Optional()` at `admin.service.ts:143-147` exists for a _degradable stats read_, and a missing cohort service here is precisely the half-state R2 forbids), `EmailService`, `AuditLogService`. Owns `SkipRow`, `holdsPaidEntitlement`, the per-row loop, the per-row structured log line and the wave summary line (R7.5), and never lets a licence key reach a log (R7.4).                                                                                                                                                                                                                                                                                                                                 |
| 5.4  | `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts` | C   | See §8.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 5.5  | `libs/api/admin/src/lib/admin.dto.ts`                                        | M   | **Delete** `InviteWaitlistDto:113-137`. **Add** `ApproveWaitlistDto`: `ids!: string[]` with `@IsArray() @ArrayMinSize(1) @ArrayMaxSize(50) @IsString({ each: true }) @MaxLength(64, { each: true })` — cuid keys, so string-with-cap rather than `@IsUUID`, matching the deleted DTO's reasoning at `:120-122`. No `@IsOptionalNotNull`, so an absent `ids` is a 400 (R1.4). Duration is **not** a field: the grant is always `1y`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| 5.6  | `libs/api/admin/src/lib/admin-waitlist.controller.ts`                        | M   | **Delete** `inviteWaitlist:52-107` and the `WaitlistService` + `InviteWaitlistDto` imports. **Add** `@Post('approve') @HttpCode(200) @UseGuards(AdminThrottlerGuard) @Throttle({ default: { limit: 10, ttl: 60_000 } })` binding `@Body(dtoPipe(ApproveWaitlistDto))` and returning `WaitlistApprovalResponse`. Actor resolved as `admin-licenses.controller.ts:75-84` does (`req.user?.email ?? 'unknown'`, `req.ip`, the `user-agent` header narrowed with `typeof … === 'string'`). Constructor now injects `WaitlistApprovalService` + keeps `AuditLogService`? — **no**: the audit is written inside the service's transaction, so the controller injects only `WaitlistApprovalService`. Rewrite the class docblock: the `dtoPipe` warning stays, but the stakes sentence changes from "outbound mail volume" to "grants **and** outbound mail, and `@ArrayMaxSize(50)` is the only bound on both". |
| 5.7  | `libs/api/admin/src/lib/admin.module.ts`                                     | M   | Add `WaitlistApprovalService` to `providers`. `imports` unchanged: `EmailModule`, `WaitlistModule` and `forwardRef(() => LicenseModule)` are already there (`:42-48`) and `MemberGroupsModule` is `@Global()`. Update the docblock's controller/service inventory.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| 5.8  | `libs/api/admin/src/index.ts`                                                | M   | `export * from './lib/waitlist-approval/waitlist-approval.types';` and `'./lib/waitlist-approval/waitlist-approval.service'`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| 5.9  | `libs/api/admin/src/lib/admin.service.ts`                                    | M   | `AdminStatsResponse.waitlist` gains `approved: number` (`:74-79`). `getStats` (`:326-367`) adds one `this.prisma.waitlist.count({ where: { approvedAt: { not: null } } })` to the existing `$transaction([…])` array (`:339-353`) — one aggregate, no per-row query (NFR-Performance).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| 5.10 | `libs/api/admin/src/lib/admin-models.config.ts`                              | M   | `waitlist` entry (`:346-369`): `listFields` += `approvedAt`; `sortableFields` += `approvedAt`; `filterableFields` += `approved: { type: 'datePresence', column: 'approvedAt' }`. **`editableFields` unchanged** — an admin hand-stamping `approvedAt` would fake a grant and bypass the claim; R5.5 already makes a rolled-back row re-approvable without manual editing.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| 5.11 | `libs/api/admin/src/lib/admin.service.spec.ts`                               | M   | Assert the new `approved` count in `getStats`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| 5.12 | `apps/ptah-license-server/src/common/route-map.spec.ts`                      | M   | `EXPECTED_ROUTES`: `'POST v1/admin/waitlist/invite'` (`:521`) → `'POST v1/admin/waitlist/approve'`. Same alphabetical slot; count unchanged, so the exact-count assertion at `:834-835` still closes.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 5.13 | `apps/ptah-license-server/src/common/controller-validation.spec.ts`          | M   | **`MIN_TOTAL_PAYLOAD_PARAMS` stays 78** (`:272`): −1 whole-object `@Body` from the deleted `inviteWaitlist`, +1 from `approveWaitlist` ⇒ net zero, 72 whole-object + 6 named. Add a dated docblock entry recording that arithmetic, in the house style of the `77 -> 78` block at `:250-270`. `NAMED_PRIMITIVE_PARAM_COUNT` stays **6** — the ids travel in a `@Body()`, and a `@Query('ids')` would make the total read 78 against a named count of 7 and the arithmetic would not close. `UNVALIDATED_DEBT` stays `[]`. The controller census and `ALL_CONTROLLERS` are untouched (no controller added or removed).                                                                                                                                                                                                                                                                                     |

### Batch 6 — admin UI (R9)

| #    | File                                                                                         | Op  | What and why                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| ---- | -------------------------------------------------------------------------------------------- | --- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 6.1  | `libs/web/admin/src/lib/services/admin-api.service.ts`                                       | M   | **Delete** `inviteWaitlist:533-543`, `AdminInviteWaitlistRequest:95-98`, `adminInviteWaitlistResponseSchema:261-264`, `AdminInviteWaitlistResponse:265-267`. **Add** `approveWaitlist(body: AdminApproveWaitlistRequest): Observable<AdminApproveWaitlistResponse>` → `POST ${base}/waitlist/approve`, plus `adminApproveWaitlistResponseSchema` mirroring §4 (outcome enum, per-row array, tally record) and validated with `validate(…)` like every sibling. **Add** `approved: z.number().optional()` to `adminStatsWaitlistSchema:269-274` — `.optional()` follows the `attention` precedent at `:293-306`, so a brief server/client deploy skew cannot break the whole stats call.                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| 6.2  | `libs/web/admin/src/lib/components/approve-waitlist-modal/{approve-waitlist-modal.ts,.html}` | C   | Standalone, `OnPush`, signals + `inject()`. `open = input<boolean>(false)`, `ids = input<readonly string[]>([])`, `closeModal = output<void>()`, `submitted = output<AdminApproveWaitlistResponse>()`. Confirmation copy states the count, the free **1-year** grant, the **Founding Members** cohort and **one email each** (R9.2). On success renders the per-outcome tally (approved / already approved / already paid / not found / failed) (R9.3). On error surfaces the server's sanitized message and does **not** clear the selection (R9.6). Reuse `waitlist-invite-modal.ts:108-119`'s `extractErrorMessage` and its DaisyUI `<dialog class="modal modal-open">` structure. It is the single confirmation path for both per-row and bulk approve (a per-row click opens it with one id).                                                                                                                                                                                                                                                                                                                               |
| 6.3  | `libs/web/admin/src/lib/components/waitlist-invite-modal/**`                                 | D   | C2 — the whole folder (`waitlist-invite-modal.ts`, `.html`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| 6.4  | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.ts`                                       | M   | `WaitlistTab` (`:40`) += `'approved'`; `normalizeTab` (`:255-259`) accepts it (R9.5 — the existing `?tab=` sync then works unchanged). `WaitlistRow` (`:43-50`) += `approvedAt: string \| null`. `filter` computed (`:141-152`) += `approved` → `'approved:true'`. `tabs` (`:104-109`) += the Approved tab. `stageLabel`/`stageVariant` (`:344-354`) rank **Converted → Approved → Invited → New**. Header summary (`:216-229`) += `summaryApproved` from `stats()?.waitlist.approved ?? 0`. **Delete** `WaitlistInviteModal` + `IssueCompLicenseModalComponent` imports and the `compLicenseModal` viewChild (`:91-93`), `inviteRecipients`/`waitlistInviteOpen`/`inviteToast` (`:124-128`), `approveEmail`/`approvedAt` (`:131-132`), `quickInviteBatch` (`:232`), `onSendFoundingInvites`/`onInviteOldest`/`onInviteClose`/`onInviteSent` (`:287-314`), `onApprove`/`onApproved` (`:317-328`). **Add** `approveOpen`, `approveIds`, `approveToast` signals and `onApproveSelected()` / `onApproveRow(row)` / `onApproveClose()` / `onApproveDone(result)` — the last bumping `refreshTick` and calling `fetchStats()` (R9.3). |
| 6.5  | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.html`                                     | M   | Delete the "Invite oldest N" quick action (`:45-51`) and the invite modal (`:203-208`) and the comp-licence modal (`:211-214`) and the invite toast. Widen the checkbox gate (`:108-116`) and the `<ptah-selection-toolbar>` block (`:42-69`) from `tab() === 'new'` to `new \| invited`, with the projected button now **"Approve to Founding Cohort"**. In the per-row `@switch` (`:143-170`) add an `@case ('new')` **and** keep `@case ('invited')`, each carrying an **Approve** button → `onApproveRow(row)` (R6.4, R9.2). Add `@case ('approved')` and an empty state for it. **Render the stage chip on every tab**, not only `@if (tab() === 'all')` (`:128-134`) — see the overlap note below. Mount `<ptah-admin-approve-waitlist-modal>`.                                                                                                                                                                                                                                                                                                                                                                            |
| 6.6  | `libs/web/admin/src/lib/components/issue-comp-license-modal/issue-comp-license-modal.ts`     | M   | Retire the waitlist-mode branch (R9): delete `email` input (`:53`), `isWaitlistMode` (`:67-69`), the waitlist arm of the `open()` defaults (`:156-163` → the non-waitlist values unconditionally), the `!email().trim()` clause in `isSearchMode` (`:76-79`), and the bound-`email` arm of `confirm()`'s target precedence (`:198-223`). The `userId` (Users-detail) and `mode: 'search'` (Licenses-list) paths are **retained unchanged**. ⚠️ Verify no other template still binds `[email]` — `users-list.ts`, `user-profile.ts` and `admin-detail.ts` use `userId`/`search`; the two `[email]` bindings are `waitlist-pipeline.html:212` and `admin-detail.html:67`, both removed in this batch.                                                                                                                                                                                                                                                                                                                                                                                                                              |
| 6.7  | `libs/web/admin/src/lib/admin-detail/{admin-detail.ts,admin-detail.html}`                    | M   | Delete the `supportsEarlyAdopterApprove` branch (`admin-detail.html:55-71`), `onEarlyAdopterApproved` (`admin-detail.ts:299-311`) and the `earlyAdopterApprovedAt` signal + toast. **Rationale, and it is R9's own:** leaving a second way to half-approve a waitlist row from the admin panel recreates the defect this task removes — that detail-page button issues a comp licence with **no cohort assignment**, which is the exact half-state R2 forbids.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| 6.8  | `libs/web/admin/src/lib/admin-list/{admin-list.ts,admin-list.html}`                          | M   | Delete the `WaitlistInviteModal` import + `imports` entry (`:30`, `:49`), the "Send Founding Invites" button (`admin-list.html:37-44`), the modal mount (`:79-86`) and its handlers. `[selectable]="!!(s.supportsBulkEmail \|\| s.supportsWaitlistInvite)"` (`:62`) → `[selectable]="!!s.supportsBulkEmail"`. Update the selection comment at `admin-list.ts:87`.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| 6.9  | `libs/web/admin/src/lib/admin-models.config.ts`                                              | M   | Delete `supportsWaitlistInvite` (`:75`, `:560`) and `supportsEarlyAdopterApprove` (`:81`, `:561`) from the interface and the `waitlist` entry. Add an `approvedAt` field spec (`type: 'datetime'`, `listColumn: true`, **not** `editable`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| 6.10 | `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts`                                  | C   | There is no spec for this component today. Add one covering: `normalizeTab('approved')`, the `approved:true` filter, the four-way `stageLabel` ranking, and that the tally from an approve response reaches the toast.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |

### Cross-cutting acceptance sweeps (R3.1, R9.1)

After Batch 6, these must return nothing:

- `rg -n "sendFoundingInvite|getFoundingInviteTemplate|buildFoundingCheckoutUrl" libs apps`
- `rg -n "promo=founding" libs/api/email/src`
- `rg -n "70%|\\$87|\\$8\\.70|off the first year" libs/web/admin`
- `rg -n "inviteWaitlist|InviteWaitlistDto|waitlist/invite" libs apps` (except the historical `'waitlist.invite'` union member and migration files)
- `rg -n "isBuildersMember" libs` must still find **exactly one** implementation (R7.2's standing gate — `membership.service.ts:69`).

---

## 8. Test strategy

### New specs

| Spec                                                                         | Covers                                                                                                                                                                                                                    |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `libs/api/admin/src/lib/waitlist-approval/waitlist-approval.service.spec.ts` | The whole taxonomy and every rollback case (below). Harness: the callback-aware `$transaction` mock from `license.service.spec.ts:39-55`, extended with `waitlist`, `memberGroupAssignment` and `subscription` delegates. |
| `libs/api/email/src/lib/services/founding-cohort-welcome.spec.ts`            | R3.1–R3.6 (§6).                                                                                                                                                                                                           |
| `libs/web/admin/src/lib/waitlist/waitlist-pipeline.spec.ts`                  | R9.3–R9.5.                                                                                                                                                                                                                |

### Modified specs

`license.service.spec.ts` (`markApproved`, tx-aware core, whole-tx retry) · `waitlist.service.spec.ts` (`inviteBatch` describe deleted; `markApproved` + `claimForApproval` added) · `member-groups.service.spec.ts` (`requireGroupByKey`, `assignInTx`) · `admin.service.spec.ts` (`approved` stat) · `controller-validation.spec.ts` (§7 5.13) · `route-map.spec.ts` (§7 5.12).

### The three cases the requirements single out

**Rollback on cohort-assignment failure (R2.1).** Make `memberGroups.assignInTx` reject. Then assert, in one test: `tx.license.create` was called (proving we got past step 5) **but** the transaction callback rejected; `auditLog.write` was never called with `action: 'waitlist.approve'`; `emailService.sendFoundingCohortWelcome` was never called; and the row's outcome is `failed` with `{ code: 'GRANT_FAILED' }`. The _persistence_ of the rollback is asserted by the `$transaction` mock rethrowing rather than by inspecting the DB — the mock harness cannot roll back, so the executable claim is "the callback threw out of `$transaction`", which is what Prisma turns into a `ROLLBACK`. Pair it with **one integration-style test against a real database** (or an explicit manual gate in the QA notes) asserting `license.count === 0` and `waitlist.approvedAt === null` afterwards — the mock cannot prove that, and R2.1 is an exit gate.

**Post-commit email failure (R2.3).** `sendFoundingCohortWelcome` rejects. Assert: outcome is `approved` (not `failed`); `licenseId` is present; the transaction callback resolved (so licence + assignment + audit persisted); the result carries `warning: { code: 'APPROVAL_EMAIL_FAILED' }` and **no** `error` field and **no** raw message; a `logger.error` line was emitted containing neither the licence key nor the word `ptah_lic_`.

**Concurrent approval (R5.2).** Two service calls for the same id against a shared mock whose `waitlist.updateMany` returns `{ count: 1 }` on the first invocation and `{ count: 0 }` on every later one (the Read-Committed behaviour §2 describes). Assert exactly one `approved` and one `already_approved`, exactly one `license.create`, exactly one `sendFoundingCohortWelcome`, exactly one `waitlist.approve` audit row, and that **neither** call throws or maps to a 500.

### Remaining required coverage (NFR-Maintainability list)

Double approval (sequential — same expectations as concurrent, R5.1) · already-paid skip via **both** the licence clause and the subscription clause (R5.4) · already-notified row approved identically with `notifiedAt` unchanged and `wasNotified: true` in the audit metadata (R6.1, R6.2) · `not_found` mid-batch with the remaining rows still processed and HTTP 200 (R1.6, R2.4) · missing `founding` group ⇒ throws before any `license.create` (R1.5) · licence-key P2002 retried once ⇒ exactly one licence (R5.6) · `already_assigned` cohort ⇒ still `approved` (R5.3) · the wave summary log line (R7.5).

---

## 9. Sequencing, risks, and what is deliberately not changed

### Batch order and dependencies

```
B1 schema + migrations
      ↓
B2 licensing core ──┐
B3 waitlist/cohort ─┼──→ B5 approve endpoint + audit + stats + structural guards ──→ B6 admin UI ──→ B7 verify
B4 email  ──────────┘        (B4 must not land before B3.1)
```

B2 and B3 are independent of each other and can be worked in parallel; both need B1's column. **B4 is coupled to B3.1**: `inviteBatch` is the only caller of `sendFoundingInvite`, so deleting the mailer before deleting its caller breaks the build. B5 needs all three. B6 needs B5's route and response type.

### What can go wrong, per batch

| Batch | Risk                                                                                                  | Mitigation                                                                                                                                                                                                           |
| ----- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| B1    | `prisma migrate diff` silently proposes dropping the three `_trgm` GIN indexes                        | Hand-author both files; the tell is a `DROP INDEX` on a name ending `_trgm` that no task asked for (`20260902090000_.../migration.sql:16-40`).                                                                       |
| B1    | A timestamp that sorts _before_ an already-applied migration                                          | Check `_prisma_migrations` before choosing the folder names.                                                                                                                                                         |
| B2    | The refactor quietly breaks the P2002 retry                                                           | The retry moves _out_ of the core by design (§1); the new spec asserts a retried attempt produces exactly one licence.                                                                                               |
| B2    | Moving the conflict guard inside the transaction changes `createComplimentaryLicense`'s 409 behaviour | It does not: the same `findFirst`, the same `ConflictException`; only the client handle changes. The existing spec's `$transaction` mock passes `prisma` itself as `tx`, so existing assertions still bind.          |
| B3    | Deleting `inviteBatch` orphans `EmailService` in `WaitlistService`                                    | It does not — `join` still calls `sendWaitlistConfirmation:90`. Verify before removing the injection.                                                                                                                |
| B4    | The source-text spec passes vacuously because the sweep finds no files                                | Assert the sweep discovered ≥ 1 file before asserting the needle is absent, in the anti-vacuity style of `controller-validation.spec.ts:524-547`.                                                                    |
| B5    | `MIN_TOTAL_PAYLOAD_PARAMS` edited "because it failed"                                                 | It must **not** change. If it does, one of the two routes was mis-bound. Re-derive with the documented `9999` procedure (`controller-validation.spec.ts:217-222`) before touching it.                                |
| B5    | `MemberGroupsService` injected but `MemberGroupsModule` not reachable                                 | It is `@Global()` (`member-groups.module.ts:24-31`) and already injected in `admin.service.ts:143`. The dependency here is **required**, so a wiring mistake fails at boot rather than silently skipping the cohort. |
| B5    | 50 rows × 3 attempts each exhausting the connection pool                                              | Rows are sequential; only one interactive transaction is open at a time.                                                                                                                                             |
| B6    | Deleting `WaitlistInviteModal` breaks the generic admin list                                          | It has a **second consumer** — `admin-list.ts:30,49`, `admin-list.html:79`. Both are in the plan (6.8); do them in the same commit as 6.3.                                                                           |
| B6    | Deleting the `email` input from the comp-licence modal breaks a surviving binding                     | Only two templates bind it, both removed here (6.5, 6.7). Grep `\[email\]=` under `libs/web/admin` after the change.                                                                                                 |
| B6    | Server/client deploy skew on the new `approved` stat                                                  | `.optional()` on the client Zod field + `?? 0`, following the `attention` precedent (`admin-api.service.ts:293-306`).                                                                                                |

### Known, accepted consequence — tab overlap

`ListQueryDto.filter` (`admin.dto.ts:53-65`) is **one** `field:value` pair; `AdminService.list` parses exactly one. So `new` cannot express "not notified **and** not approved". An approved row that was never notified therefore appears under both **New** and **Approved**, and a notified-but-unapproved row under both **Invited** and **New**'s complement. R9 asks only for `approved` → `approved:true` and the four-way stage ranking, so this is within the requirement. Mitigation, and the reason 6.5 renders the stage chip on **every** tab rather than only on `all`: the chip states the row's true stage wherever it appears, so the overlap is self-explaining rather than misleading. A `stage:` preset filter (reusing the existing `relationPreset` "closed set of hard-coded `where` fragments" mechanism, `admin-models.config.ts:68-75`) is the clean fix and is recorded as a follow-up, not built here.

### Deliberately not changed

- `MembershipService.isBuildersMember` (`membership.service.ts:69-93`) — a comp licence already satisfies it; R7.2's gate must still find exactly one implementation.
- `buildersCheckoutEnabled`, `environment.checkout.ts`, the `checkout` build/serve targets.
- `IssueComplimentaryLicenseDto.email` and the comp endpoint's XOR — R4.3 keeps the comp path's waitlist stamping, which only the email arm exercises. The endpoint is retained for the Users-detail and Licenses-list paths.
- `ComplimentaryLicenseResult.warning.error: string` (`license.service.ts:41`) — a different endpoint's payload; leaving raw text on an admin-only route is pre-existing and out of scope. Flagged, not fixed.
- `AdminStatsResponse.attention.waitlistUninvited` (`admin.service.ts:89-90`) — now points at a retired action ("uninvited" implied "go invite them"). The field and its consumers are untouched; relabelling the Overview's Needs-Attention tile is a follow-up.
- `'waitlist.invite'` in `AdminAuditAction` — retained as a historical value because rows exist; annotated as having no writer.
- The `FOUNDING35` / `FOUNDING50` Paddle-console deactivation (`docs/deploy/founder-setup-checklist.md` §2.1) — a console chore, unblocked by this change, not performed here.

### Verification gate (B7)

`nx lint`, `nx typecheck`, `nx test` green for `ptah-license-server` and every touched lib: `admin`, `licensing`, `marketing`, `community`, `email`, `audit`, and `libs/web/admin`. `catch (error: unknown)` narrowed with `instanceof Error` throughout; no `@ts-ignore`; every config read through `ConfigService`; the five acceptance sweeps in §7 return nothing.
