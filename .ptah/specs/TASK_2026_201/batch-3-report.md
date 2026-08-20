# Batch 3 Report — Waitlist + cohort tx-aware primitives; `inviteBatch` removed

**Task**: TASK_2026_201
**Batch**: 3 — `Waitlist` + `MemberGroup` tx-aware primitives; invite path removed (C2, server half)
**Executor**: `backend-developer`
**Worktree**: `D:/projects/ptah-extension/.claude/worktrees/founding-cohort` (branch `ak/founding-cohort-free-access`)
**Status**: 🔄 IMPLEMENTED — 4/4 tasks **plus the endpoint deletion the coordinator ruled in** (§ A).
**Commits**: none. Team-leader owns commits.

---

## ⚠️ A. THE ENDPOINT DELETION — ESCALATED, RULED ON, COMPLETED

### A.1 What I escalated, and the ruling

I paused before deleting `POST /v1/admin/waitlist/invite` because the deletion breaks **four**
structural guards, not the one the dispatch brief anticipated, and because `tasks.md:413-415` and
`:1025-1026` both explicitly plan for the controller surviving into Batch 5.

**The coordinator overruled the deferral, and was right to.** The decisive fact I had underweighted:
the tree was already in a HALF-DELETED state — `inviteBatch` gone from the service, the controller
still calling it — and that half-state was blocking a **concurrent workstream's** typecheck, not
only my own. Deferring was defensible only if the service method had stayed; it had not. Batch 5's
ownership of the guard lines was explicitly overridden for the lines my deletion invalidates.

**The deletion is now complete and the whole tree is green.** § A.3 lists every guard line I touched.

### A.2 What was deleted (C2: deleted, not repointed)

A zero-route controller is not a legal resting state — `route-map.spec.ts`'s barren-controller
assertion requires every registered controller to contribute at least one route — so the class and
its registrations had to go together:

| #   | File                                                                | Op                                                                         |
| --- | ------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| 1   | `libs/api/admin/src/lib/admin-waitlist.controller.ts`               | **deleted** (whole file, 108 lines)                                        |
| 2   | `libs/api/admin/src/lib/admin.module.ts`                            | import + `controllers` entry removed; docblock `FIVE CONTROLLERS` → `FOUR` |
| 3   | `libs/api/admin/src/index.ts`                                       | barrel export removed                                                      |
| 4   | `libs/api/admin/src/lib/admin.dto.ts`                               | `InviteWaitlistDto` deleted (it existed only to serve this route)          |
| 5   | `apps/ptah-license-server/src/testing/controller-registry.ts`       | import + `admin/AdminWaitlistController` entry removed                     |
| 6   | `apps/ptah-license-server/src/common/route-map.spec.ts`             | ledger entry + prose total (§ A.3)                                         |
| 7   | `apps/ptah-license-server/src/common/controller-validation.spec.ts` | `MIN_TOTAL_PAYLOAD_PARAMS` (§ A.3)                                         |
| 8   | `libs/api/notifications/src/lib/dto/mark-notifications-read.dto.ts` | one docblock line that named `InviteWaitlistDto` by class                  |

Nothing was repointed. There is no 410, no deprecation shim, no surviving handler.

**On #4 — an accidental repair worth knowing about.** `admin.dto.ts` had a _detached_ docblock: the
`BulkEmailDto` docblock at `:105-112` was separated from its class by `InviteWaitlistDto` and its
own docblock. Removing the middle pair reunited them. No comment was lost.

**On #8 — the one edit outside the deletion's blast radius.** That docblock read "the same call
`InviteWaitlistDto` makes for waitlist keys", naming a class that no longer exists. That is a
dangling reference, not a historical note, so I reworded it to "the same call every cuid-keyed admin
DTO in this server makes" — the reasoning is preserved, the dead symbol is not. **This is distinct
from the retired-route references I deliberately left alone** (§ F).

### A.3 Every guard line I changed — and confirmation the concurrent workstream survived

TASK_2026_202 Batch 3 had already edited both guard files in the working tree to register
`POST v1/admin/course-modules/schedule/preview` and `POST v1/admin/course-modules/schedule`. I read
the on-disk content and edited around them. **Neither file was regenerated; nothing of theirs was
reverted, overwritten or reformatted.**

#### `route-map.spec.ts` — two edits

| Line                | Change                                                                                                                                                                                                                                                                                                |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `:557` (was `:521`) | Removed `'POST v1/admin/waitlist/invite'` from `EXPECTED_ROUTES`, replacing it with a comment recording the slot, the reason (C2) and that `…/approve` will reclaim it. A bare deletion in this ledger is indistinguishable from a route lost by accident — the one thing the file exists to prevent. |
| `:258-267`          | Appended one entry to the running prose total: **139 → 138**, noting that unlike the two entries above it, this one DOES move the controller census, and why.                                                                                                                                         |

**No number needed adjusting for the exact-count assertion**: it reads `EXPECTED_ROUTES.length`
(`:834-835`), so removing the array entry adjusts it automatically. The prose total is the one thing
in that file no assertion keeps honest, which is why it is re-derived by hand every time it moves.

#### `controller-validation.spec.ts` — one constant, one docblock entry

`MIN_TOTAL_PAYLOAD_PARAMS`: **80 → 79**, at `:337`.

The arithmetic composes cleanly with the concurrent workstream's rather than fighting it:

```
 78  TASK_2026_177 Phase 5 follow-up          (72 whole-object + 6 named)
+ 2  TASK_2026_202 B3 — previewSchedule, applySchedule   → 80  (74 + 6)   ← theirs, PRESERVED
− 1  TASK_2026_201 — inviteWaitlist's @Body(dtoPipe(InviteWaitlistDto))
                                                          → 79  (73 + 6)   ← mine
```

I appended my `80 -> 79` block **after** their `78 -> 80` block, in the file's established
house style, and left their block byte-identical. `NAMED_PRIMITIVE_PARAM_COUNT` stays **6** (the
deleted handler bound one whole-object `@Body` and no named primitive) and `UNVALIDATED_DEBT` stays
`[]`.

My docblock states in bold that **79 is not the new floor** — the approve endpoint restores it to 80
with `@Body(dtoPipe(ApproveWaitlistDto))`, so a later reader cannot mistake this for the end state
and "restore" it by hand. That preserves the intent of Task 5.13's warning ("do not edit the
number") even though its literal instruction ("stays 78") is now superseded twice over.

#### Confirmation their two routes survived

```
$ rg -n "course-modules/schedule" apps/ptah-license-server/src/common/route-map.spec.ts
252: * (137 + 2): `POST v1/admin/course-modules/schedule/preview` and
253: * `POST v1/admin/course-modules/schedule`, both on the EXISTING
391:  'POST v1/admin/course-modules/schedule',
392:  'POST v1/admin/course-modules/schedule/preview',

$ rg -n "78 -> 80|MIN_TOTAL_PAYLOAD_PARAMS = " apps/ptah-license-server/src/common/controller-validation.spec.ts
272: * ── 78 -> 80, TASK_2026_202 Batch 3 (C4 cohort scheduling) ────────────────
337: const MIN_TOTAL_PAYLOAD_PARAMS = 79;
```

Both routes registered, their docblock intact, and `api-learning` is **fully green** (§ F).

I touched **none** of: `libs/api/learning/**`, `libs/api-contracts/**`,
`libs/api/audit/src/lib/audit-log.types.ts`, `course-schedule.service.ts`, `weekday-schedule.ts`,
`schedule-modules.dto.ts`. Verified against `git status`.

### A.4 One correction to `tasks.md` the team-leader should make

`tasks.md:412` lists `rg "inviteBatch|resolveInviteTargets|WaitlistInviteResult" libs/api → no
matches` as a **Batch 3** gate, three lines above a note saying `libs/api/admin` will still call
`inviteBatch` until Batch 5. Those two cannot both be true. With this ruling the sweep now passes in
Batch 3, so the inconsistency resolves itself — but Batch 5's Tasks 5.6, 5.12 and 5.13 are now
**partly done**, and their text still says otherwise:

- **Task 5.6** — "Delete `inviteWaitlist:52-107`": already done. What remains for Batch 5 is
  **creating** the approve route, on a new controller (the old one no longer exists), plus its
  `admin.module.ts`, `index.ts` and `controller-registry.ts` registrations.
- **Task 5.12** — no longer a swap. The entry is gone; Batch 5 **adds** `'POST v1/admin/waitlist/approve'`
  and the count goes 138 → 139.
- **Task 5.13** — "the number STAYS 78" is superseded twice. Batch 5 takes **79 → 80** (+1).
- **Task 5.5** — `InviteWaitlistDto` is already deleted; only `ApproveWaitlistDto` remains to add.

---

## B. Files changed (12)

**Batch 3 proper (4)**

| File                                                                     | Op  | Task |
| ------------------------------------------------------------------------ | --- | ---- |
| `libs/api/marketing/src/lib/waitlist/waitlist.service.ts`                | M   | 3.1  |
| `libs/api/marketing/src/lib/waitlist/waitlist.service.spec.ts`           | M   | 3.2  |
| `libs/api/community/src/lib/member-groups/member-groups.service.ts`      | M   | 3.3  |
| `libs/api/community/src/lib/member-groups/member-groups.service.spec.ts` | M   | 3.4  |

**Endpoint deletion, per the § A ruling (8)** — the table in § A.2.

Absolute paths, all under `D:/projects/ptah-extension/.claude/worktrees/founding-cohort/`.

---

## C. Task 3.1 — `waitlist.service.ts`

### C.1 `markApproved` — KEPT, NOT DUPLICATED (confirmed)

Batch 2's commit `79a735f65` landed `markApproved` as a hard compile dependency. I verified it is
present, read it in full, and **left its body untouched**. It now sits at
`waitlist.service.ts:161-175` (it moved down only because the type block above it grew; `git diff`
shows no change inside the method).

Verification that there is exactly one definition:

```
$ rg -n "async markApproved" libs/api
libs/api/marketing/src/lib/waitlist/waitlist.service.ts:161
```

One hit. No second copy was written. Its `updateMany` + `approvedAt: null` guard is intact, which is
what makes R4.6 hold (a re-run never moves an existing stamp).

`markConverted` is likewise untouched and still exported — it remains the **only** writer of
`convertedAt` and is still called by the Paddle fan-out. I did not delete it, rename it, or change
its `where` clause.

### C.2 `claimForApproval` — the conditional claim (the contract Batch 5 consumes)

Added at `waitlist.service.ts:206-244`. Exact signature and return union:

```ts
export interface WaitlistApprovalRow {
  id: string;
  email: string;
  notifiedAt: Date | null;
  approvedAt: Date | null;
}

export type WaitlistClaimResult =
  | { outcome: 'claimed'; row: WaitlistApprovalRow }
  | { outcome: 'already_approved'; row: WaitlistApprovalRow }
  | { outcome: 'not_found' };

async claimForApproval(
  tx: Prisma.TransactionClient,
  id: string,
): Promise<WaitlistClaimResult>
```

Both types are exported through the existing `export * from './lib/waitlist/waitlist.service'`
barrel (`libs/api/marketing/src/index.ts:26`), so Batch 5 imports them from `@ptah-api/marketing`
with no barrel edit.

**The exact claim, verbatim from the implementation** (`waitlist.service.ts:225-241`):

```ts
const row = await tx.waitlist.findUnique({
  where: { id },
  select: { id: true, email: true, notifiedAt: true, approvedAt: true },
});

if (!row) {
  return { outcome: 'not_found' };
}

const { count } = await tx.waitlist.updateMany({
  where: { id, approvedAt: null },
  data: { approvedAt: new Date() },
});

if (count === 0) {
  return { outcome: 'already_approved', row };
}

return { outcome: 'claimed', row };
```

which is `implementation-plan.md:220-224`'s

```sql
UPDATE "waitlist" SET "approved_at" = $now WHERE "id" = $id AND "approved_at" IS NULL
```

**Where it sits, and why that is the whole point.** It runs on the caller-supplied
`Prisma.TransactionClient` and touches `this.prisma` **nowhere** — the method has no reference to
the base client at all. Batch 5 calls it as the first statement inside its per-row
`$transaction(async (tx) => …)` callback, making the claim the first write in that transaction, so
a rollback at any later step (cohort assign, audit, licence) releases the claim and leaves
`approvedAt` null and the row re-approvable (R5.5). A claim taken outside the transaction would
permanently poison a row whose grant then failed; the `tx` parameter is what makes that
impossible. The tx-injection shape matches `AuditLogService.write({ tx })`
(`audit-log.service.ts:73`), the server's only existing precedent.

The spec enforces the `tx`-only property directly rather than by convention: the test harness gives
`mockPrisma` and the `tx` mock **separate** spies, and the claimed-path test asserts
`mockPrisma.waitlist.updateMany` was never called. A regression that reached for `this.prisma`
would fail loudly instead of passing on a shared spy.

`count === 0` → `already_approved`. Under Prisma's Read Committed default a concurrent claimer
blocks on the row lock and, on release, re-evaluates `approved_at IS NULL` against the committed row
and reports 0 — one winner, neither side raising. That reasoning is in the method docblock so the
next reader does not have to re-derive it.

The `findUnique` is documented as **advisory only**: it distinguishes `not_found` from
`already_approved` and nothing else. The docblock states explicitly that on the `already_approved`
branch `row.approvedAt` may be `null` (a racer stamped after the read) and that callers must treat
`outcome` as the truth — with a spec case pinning that exact scenario.

### C.3 Deletions

| Symbol                      | Was at     | Status  |
| --------------------------- | ---------- | ------- |
| `inviteBatch`               | `:184-226` | deleted |
| `resolveInviteTargets`      | `:232-254` | deleted |
| `DEFAULT_INVITE_BATCH_SIZE` | `:24-28`   | deleted |
| `WaitlistInviteResult`      | `:11-22`   | deleted |

`EmailService` **stays injected** — verified before touching the constructor: `join` still calls
`this.emailService.sendWaitlistConfirmation` at `waitlist.service.ts:98`. The constructor is
unchanged.

The class docblock now records the two surviving disjoint stamps (`approvedAt` vs `convertedAt`) and
that `notifiedAt` is historical with no remaining writer, so the next reader does not reintroduce
one.

---

## D. Task 3.2 — `waitlist.service.spec.ts`

- Deleted the `inviteBatch` describe (was `:126-193`) and the `sendFoundingInvite` mock (`:18`, `:33`).
- Trimmed the now-dead `waitlist.findMany` / `waitlist.update` delegates from the prisma mock: after
  the deletion the service only uses `findUnique`, `create`, `updateMany`. Leaving unused spies in a
  harness is how a later test asserts against something the service can no longer call.
- Added `markApproved` (4 cases): stamps and lowercases; no-op on an already-stamped row with the
  `approvedAt: null` guard asserted explicitly; no-op on an unknown email; and a case asserting the
  update touches neither `data.convertedAt` nor `where.convertedAt` — R4.3's "a gift is not a
  conversion" as an executable assertion rather than a comment.
- Added `claimForApproval` (5 cases): all three outcomes; the exact `where`/`data`/`select` shapes;
  `not_found` performs **no** write; two claimers on one row yield exactly one `claimed` + one
  `already_approved`; and the advisory-read case above.

`api-marketing`: **45 tests, 5 suites, all passing.**

---

## E. Tasks 3.3 / 3.4 — `member-groups.service.ts` + spec

### E.1 `requireGroupByKey` — evidence it HARD-FAILS rather than falling back

Added at `member-groups.service.ts:198-240`. The whole method:

```ts
async requireGroupByKey(key: string): Promise<RequiredMemberGroup> {
  const group = await this.prisma.memberGroup.findUnique({
    where: { key },
    select: { id: true, key: true, name: true },
  });

  if (!group) {
    this.logger.error(
      `Member group '${key}' is not configured — refusing to fall back to the ` +
        `default cohort. Create the group with this exact key, then retry.`,
    );
    throw new InternalServerErrorException({
      code: 'COHORT_NOT_CONFIGURED',
      message:
        'The member cohort for this action is not configured. Please contact support.',
    });
  }

  return group;
}
```

**Four independent pieces of evidence that no `isDefault` fallback exists:**

1. **Structural** — the method body has exactly one query. There is no second `findFirst`, no `??`,
   no `getDefaultGroup()` call. `rg -n "isDefault" member-groups.service.ts` returns only the
   pre-existing `getDefaultGroup`, `create`, `update` and `toWithCount` sites; none is inside
   `requireGroupByKey`.
2. **Behavioural, and adversarially wired** — the spec's throw case wires the mock so that a
   fallback implementation **would pass**: `memberGroup.findFirst` is stubbed to return a real
   default group `{ id: 'grp-default', key: 'general' }`. The assertion is then
   `expect(prisma.memberGroup.findFirst).not.toHaveBeenCalled()` alongside
   `rejects.toBeInstanceOf(InternalServerErrorException)`. A fallback could not make both hold.
3. **Documented prohibition** — the docblock states why in the terms R1.5 uses: `isDefault` is the
   right answer for the Paddle fan-out (`assignDefaultGroup`) precisely because it moves; the day a
   second cohort is flagged default, a fallback here would silently retarget every founding approval
   into it, with no error and no log.
4. **Fail-early placement** — Batch 5 resolves this once per request before the row loop, so a
   mis-provisioned deployment issues no licence for **any** row (R1.5), rather than issuing licences
   with no cohort assignment. The docblock says this so Batch 5 cannot accidentally move the call
   inside the loop.

**No Prisma text, and no key-existence detail, reaches the client.** The body is a fixed
`{ code: 'COHORT_NOT_CONFIGURED', message }`, following the established
`{ code, message }`-object precedent at `admin.service.ts:627-639` and `license.service.ts:473-476`.
The diagnosable cause — including the missing key — goes to `logger.error` only. A spec case asserts
`getResponse()` equals the fixed object **and** that `JSON.stringify(body)` does not contain
`'founding'`.

### E.2 `assignInTx` — P2002 handled as "already assigned", not an error

Added at `member-groups.service.ts:390-419`:

```ts
async assignInTx(
  tx: Prisma.TransactionClient,
  params: { userId: string; groupId: string; source: MemberGroupAssignmentSource },
): Promise<{ created: boolean }> {
  const { userId, groupId, source } = params;

  const existing = await tx.memberGroupAssignment.findUnique({
    where: { userId_groupId: { userId, groupId } },
    select: { id: true },
  });

  await tx.memberGroupAssignment.upsert({
    where: { userId_groupId: { userId, groupId } },
    create: { userId, groupId, source },
    update: {},
  });

  return { created: existing === null };
}
```

The `@@unique([userId, groupId])` (`schema.prisma:132`) is handled as "already assigned" via the
`userId_groupId` upsert, which Prisma compiles to `INSERT … ON CONFLICT DO UPDATE` — so no P2002 is
raised at all, and `created: false` is a benign outcome the caller records as
`cohortAlreadyAssigned` (R5.3).

**I did NOT copy the `create` + `catch (P2002)` shape from `member-groups.service.ts:520-534`** (the
`assignMany` sites; formerly `:465-479`). The docblock records why, in the terms the plan uses: that
code runs outside any transaction, and inside one a caught P2002 aborts the session (25P02) on the
very race the catch exists to tolerate — the code would appear to tolerate the race while actually
failing the whole grant on it. A spec case asserts the shape directly:
`tx.memberGroupAssignment.create` is stubbed to reject with a real
`Prisma.PrismaClientKnownRequestError({ code: 'P2002' })` and the test asserts the call still
resolves `{ created: true }` **and** that `create` was never called at all.

Two honest caveats, both written into the docblock rather than left implicit:

- **`created` is optimistic under a race.** A racer landing between the `findUnique` and the `upsert`
  makes `created` report `true` for a row this call did not insert. That is an audit-metadata nuance
  only: the assignment exists either way, `update: {}` preserves the original `assignedAt`, and no
  control flow anywhere branches on `created`.
- **The mock cannot prove rollback.** These specs prove the writes go through `tx` (both `assignInTx`
  cases assert `prisma.memberGroupAssignment.upsert` / `.findUnique` were never called); they cannot
  prove PostgreSQL actually rolls them back. That is Task 7.3's real-database gate, still open.

Neither method audits. A spec case asserts `audit.write` is never called from `assignInTx` — the
caller's single `waitlist.approve` row carries `groupKey`, and a second `group.assign` row would
double-count one action.

`api-community`: **455 tests, 19 suites, all passing.**

---

## F. Verification

Commands as corrected by the brief (`nx lint ptah-license-server` does not exist in this repo).

**Whole-tree pass, re-run after the § A deletion.** Every command below is a fresh
`--skip-nx-cache` run against the final state.

| Command                                                                              | Result                                                                                        |
| ------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------- |
| `npx nx run ptah-license-server:typecheck`                                           | ✅ **Successfully ran**                                                                       |
| `npx nx test ptah-license-server`                                                    | ✅ 5 suites / **162 tests** — **both structural guards green**                                |
| `npx nx test api-admin`                                                              | ✅ 1 suite / **32 tests**                                                                     |
| `npx nx test api-marketing`                                                          | ✅ 5 suites / **45 tests**                                                                    |
| `npx nx test api-community`                                                          | ✅ 19 suites / **455 tests**                                                                  |
| `npx nx test api-learning` (concurrent workstream's)                                 | ✅ 22 suites / **548 tests**                                                                  |
| `npx nx run ptah-license-server:"eslint:lint"`                                       | ✅ **0 errors**, 2 warnings (`jest.config.ts`, `src/instrument.ts` — pre-existing, untouched) |
| `npx nx run-many -t typecheck -p api-admin,api-marketing,api-community,api-learning` | ✅ Successfully ran for 4 projects                                                            |
| `npx nx run-many -t "eslint:lint" -p api-admin,api-notifications`                    | ✅ Successfully ran for 2 projects                                                            |
| `npx nx run-many -t "eslint:lint" -p api-marketing,api-community`                    | ✅ **0 errors**, 11 warnings — every one in a file I did not touch                            |
| `npx tsc --noEmit -p libs/api/marketing/tsconfig.spec.json`                          | ✅ clean (see note)                                                                           |
| `npx tsc --noEmit -p libs/api/community/tsconfig.spec.json`                          | ✅ clean (see note)                                                                           |

**Nothing is red anywhere in the tree.** The `api-admin` compile error reported in the first pass of
this batch is gone — that was the half-deleted state the § A ruling closed.

**`api-learning`'s 548 tests are the concurrent workstream's and are fully green**, so my guard
edits did not disturb their two new routes or their DTO subclass assertions.

**Note on the spec typechecks**: I ran these because Batch 2's report warns that `typecheck` targets
use `tsconfig.lib.json`, which **excludes specs** — a green `typecheck` does not cover new spec
files. Both spec projects compile clean.

**Lint warnings are all pre-existing and foreign**: `marketing.service.spec.ts`,
`segment-resolver.service{,.spec}.ts`, `template-render.service.spec.ts`,
`unsubscribe-token.service.spec.ts`. None of the four files I changed produces a warning.

### Sweeps

**`rg "inviteWaitlist|InviteWaitlistDto" libs/api apps`** — 3 matches, all inside my own new
`controller-validation.spec.ts` ledger entry (`:310`, `:311`, `:319`), which names the deleted
handler and DTO to make the `−1` arithmetic auditable. **Zero executable references.**

**`rg "inviteBatch|resolveInviteTargets|WaitlistInviteResult" libs/api`** — 1 match:
`libs/api/email/src/lib/services/email.service.ts:144`, a docblock line inside `sendFoundingInvite`,
which Task **4.1** deletes wholesale (`:131-166`). Left alone deliberately: stripping one comment
out of a method about to be deleted only makes Batch 4's diff harder to read.

`resolveInviteTargets`, `WaitlistInviteResult`, `DEFAULT_INVITE_BATCH_SIZE`: **zero matches
repo-wide.**

**`rg "waitlist/invite" libs apps`** — every match is prose, and every one is expected. Per the
coordinator's instruction, **no documentation was stripped to make this grep clean**:

| Where                                                                                          | Why it is correct that it matches                                                                                                     |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| `schema.prisma:466`                                                                            | The docblock the Batch 1 team-leader flagged in advance — names the retired route as history                                          |
| `controller-registry.ts:248`, `route-map.spec.ts:258,557`, `controller-validation.spec.ts:316` | **Mine** — the four ledger entries recording the deletion. A silent deletion in these files is the failure mode they exist to prevent |
| `email.service.ts:134`                                                                         | Inside `sendFoundingInvite` — Batch 4                                                                                                 |
| `libs/web/admin/**` (5 matches), `waitlist-invite-modal.ts:21`                                 | Client half of C2 — Batch 6                                                                                                           |
| `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts:11,33,70`                 | **Unowned** — see § H.3                                                                                                               |

No server-side executable code references the invite path any more.

---

## G. Standards compliance

- `catch (error: unknown)` narrowed with `instanceof Error` — **no new catch blocks were added** in
  this batch. The existing ones in `waitlist.service.ts` (`join`) and `member-groups.service.ts`
  (`create`, `safeAudit`) already follow the rule and are unchanged.
- No `process.env` anywhere; no `ConfigService` was needed (neither primitive reads config).
- No raw library `error.message` reaches a client: the only new throw carries a fixed sentence and a
  stable code, with the diagnosable text going to `logger.error`.
- `libs/api/**` imports only `@nestjs/*`, `@ptah-api/core`, `@ptah-api/email`, `@ptah-api/audit` —
  no `libs/backend/**`, no `libs/frontend/**`.
- No `@ts-ignore`, no `any`, no stubs, no `// TODO`, no placeholder data.
- No new module edges: `api-marketing` and `api-community` dependency lists are unchanged.
- No git operations performed.

---

## H. Incomplete / carried forward

Nothing in this batch is incomplete, and nothing in the tree is red. Four items for the
team-leader:

1. **Batch 5's task text is now partly stale** — Tasks 5.5, 5.6, 5.12 and 5.13 each describe work
   that is partly done, and 5.12/5.13's "swap, do not add" and "the number stays 78" instructions no
   longer describe reality. § A.4 gives the corrected instruction for each. **Worth amending
   `tasks.md` in place before Batch 5 is dispatched**, as the team-leader already did for Batch 2's
   `nx lint` line — otherwise Batch 5 will be told to delete things that are gone and to preserve a
   count that has moved twice.
2. **R2.1 rollback is still unproven.** These specs prove every write goes through the `tx` handle;
   they cannot prove PostgreSQL rolls it back. Task 7.3's real-database gate remains open, as Batch 2
   also recorded.
3. **An e2e spec no batch owns.** `apps/ptah-landing-page-e2e/src/specs/admin-founding-invites.spec.ts`
   intercepts `**/api/v1/admin/waitlist/invite` at `:33` and `:70`. It is listed in **no** batch in
   `tasks.md` — not Batch 5 (server), not Batch 6 (`libs/web/admin` only), not Batch 7 (sweeps only).
   It does not fail today (Playwright intercepts the route rather than calling the server, and the UI
   still exists), but it will break the moment Batch 6 removes `WaitlistInviteModal`. **Recommend
   assigning it explicitly**, most naturally as an 11th task in Batch 6, before Batch 7 discovers it
   as a surprise.
4. **`AdminModule` now imports `WaitlistModule` with no consumer.** Deliberate and annotated in the
   module docblock: Batch 5's `WaitlistApprovalService` injects `WaitlistService`, so removing the
   import would only be undone next batch. A module import with no current injector is inert, not an
   error. Flagging it so a reviewer does not read it as an oversight.

---

## Task status

| Task                                                                                                                                                              | Status         |
| ----------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| 3.1 — `claimForApproval` added, `inviteBatch`/`resolveInviteTargets`/`DEFAULT_INVITE_BATCH_SIZE`/`WaitlistInviteResult` deleted, `markApproved` verified-and-kept | 🔄 IMPLEMENTED |
| 3.2 — `waitlist.service.spec.ts`                                                                                                                                  | 🔄 IMPLEMENTED |
| 3.3 — `requireGroupByKey` + `assignInTx`                                                                                                                          | 🔄 IMPLEMENTED |
| 3.4 — `member-groups.service.spec.ts`                                                                                                                             | 🔄 IMPLEMENTED |
| § A ruling — endpoint + controller deleted, 4 structural guards reconciled, concurrent workstream preserved                                                       | 🔄 IMPLEMENTED |

---

## Team-Leader Verification

**Verdict**: ✅ **APPROVED — COMMITTED as `2f9307d00`**
(`feat(api-marketing): add the tx-aware approval claim and delete the invite path`)

### 🔴 The combined-commit premise was wrong — the batches WERE split

The dispatch brief instructed me to land 201 B3 and 202 B3 as ONE commit, on the
reasoning that both edit `route-map.spec.ts` and `controller-validation.spec.ts`
and that either split order produces a knowingly-red commit. **I tested that and
it is false.** Two facts the brief missed:

1. **`MIN_TOTAL_PAYLOAD_PARAMS` is a FLOOR, not an exact count.**
   `controller-validation.spec.ts:595` asserts `toBeGreaterThanOrEqual`, not
   equality. The single line that genuinely cannot be split (`78 -> 80 -> 79`) is
   therefore not a hard constraint on intermediate states at all.
2. **Every other file partitions cleanly by task.** 201 owns `libs/api/admin`,
   `libs/api/marketing`, `libs/api/community`, `libs/api/notifications` and
   `controller-registry.ts`; 202 owns `libs/api/learning`,
   `libs/api-contracts/community`, `libs/api/audit` and the runbook. Zero
   overlap outside the two guard files.

So I reconstructed the 202-only guard-file state (constant at `80`, ledger at
`139`, invite route still listed) — **which is not a fabrication: it is the state
202's developer actually left on disk before this batch edited around it**, per
§ A.3 above — and verified it end to end:

| 202-only tree (commit `ee346fbde`)  | Result                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------ |
| `ptah-license-server:typecheck`     | ✅ Successfully ran                                                            |
| `nx test ptah-license-server`       | ✅ 5 suites / **163 tests**                                                    |
| `nx test api-admin`                 | ✅ 32 · `api-marketing` ✅ 39 · `api-community` ✅ 448 · `api-learning` ✅ 548 |
| `ptah-license-server:"eslint:lint"` | ✅ 0 errors                                                                    |

Both commits are green in isolation, and the second commit's tree was proved
**byte-identical** to the pre-split tree I had already verified (`git diff` of
the modified/deleted set against the snapshot: no difference). History is
bisectable and each commit documents exactly one task.

### The six verification points

1. **Invite path fully gone (C2)** — ✅. Sweep over `libs/ apps/` for
   `inviteBatch|resolveInviteTargets|WaitlistInviteResult|InviteWaitlistDto|AdminWaitlistController|inviteWaitlist`
   returns **zero executable server references**. All remaining hits are the four
   deliberate ledger comments, one docblock line inside `sendFoundingInvite`
   (Batch 4 deletes the method), and `libs/web/admin` (Batch 6, client half).
   Controller file, DTO, module/barrel/registry entries and the service method
   are all deleted, not repointed. No dangling caller.
2. **`markApproved` kept, not duplicated; `markConverted` intact** — ✅.
   `rg "async markApproved|async markConverted"` → exactly one of each, at
   `waitlist.service.ts:175` / `:135`, neither in the diff. **`convertedAt` has
   exactly one writer**: `waitlist.service.ts:139`, inside `markConverted`, still
   called by the Paddle fan-out at `paddle.service.ts:173`. (`admin.service.ts:342`
   is a `count`, and `admin-models.config.ts`'s `editableFields` is the
   pre-existing generic admin records editor — neither is a new writer.)
3. **Cohort lookup hard-fails, no `isDefault` fallback** — ✅. `requireGroupByKey`
   has one `findUnique({ where: { key } })` and one throw. No `findFirst`, no
   `??`, no `getDefaultGroup()` in the body. Accepted the adversarial spec wiring
   (`findFirst` stubbed to return a real default group, asserted never called) as
   genuine evidence rather than a comment.
4. **Conditional claim sits inside the row transaction** — ✅. `claimForApproval`
   takes `Prisma.TransactionClient` and references `this.prisma` **nowhere**; the
   method is structurally incapable of claiming outside the caller's transaction,
   so a rollback releases the claim. The spec's separate `mockPrisma` / `tx`
   spies enforce this rather than documenting it.
5. **Cohort assignment is `tx`-aware and tolerates the unique collision** — ✅.
   `assignInTx` upserts on `userId_groupId`, so the `@@unique([userId, groupId])`
   collision is absorbed as `{ created: false }` and no P2002 is raised inside the
   transaction. The `create` + `catch(P2002)` shape was correctly NOT copied. The
   race that would make `created` optimistic is excluded upstream anyway:
   `claimForApproval` takes the row lock before `assignInTx` runs.
6. **Whole-tree gate on the committed tree** — ✅ (table below).

### Whole-tree gate — actual output

| Command                                        | Result                                                                                    |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `npx nx run ptah-license-server:typecheck`     | ✅ Successfully ran                                                                       |
| `npx nx test ptah-license-server`              | ✅ 5 suites / **162 tests** — both structural guards green                                |
| `npx nx test api-admin`                        | ✅ 1 suite / **32**                                                                       |
| `npx nx test api-marketing`                    | ✅ 5 suites / **45**                                                                      |
| `npx nx test api-community`                    | ✅ 19 suites / **455**                                                                    |
| `npx nx test api-learning`                     | ✅ 22 suites / **548**                                                                    |
| `npx nx run ptah-license-server:"eslint:lint"` | ✅ **0 errors**, 2 warnings (`jest.config.ts`, `instrument.ts` — pre-existing, untouched) |

`162 = 163 − 1` composes exactly as § A.3 predicted.

### Carried forward for the orchestrator

The four items in § H stand, and § A.4's corrections to Batch 5's task text
(Tasks 5.5, 5.6, 5.12, 5.13 are each partly done; the count goes 79 → 80 and the
ledger 138 → 139) should be applied to `tasks.md` **before Batch 5 is
dispatched**. The unowned e2e spec `admin-founding-invites.spec.ts` still belongs
to no batch — recommend adding it to Batch 6.

**Staged by name only.** `.ptah/specs/TASK_2026_201/` and `TASK_2026_202/` remain
untracked, as instructed. No hooks bypassed.
