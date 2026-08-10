# Code Logic Review — TASK_2026_177 Batch 14 (Phase 5: member packs + notifications)

Reviewer: code-logic-reviewer. Scope: `libs/api/**`, `libs/api-contracts/community/**`, `apps/ptah-license-server/**` diffs introduced by dispatches 14A/14B/14C, per `batch-14a-report.md` / `batch-14b-report.md` / `batch-14c-report.md`. Excluded per instructions: `.ptah/specs/TASK_2026_173/**`, `libs/frontend/**`, `libs/shared/**`, `apps/ptah-electron*/**`, `marketing/**`, other `.ptah/specs/*` carriers, `.commitlintrc.json`, `CLAUDE.md`. `tsconfig.base.json`'s one added alias is in scope (14B's `@ptah-api/notifications`).

All findings below are from reading the actual working-tree files and from actually running the test suites — not from trusting the batch reports' narration.

## Gate output — actual, reproduced by me

```
$ npx nx test ptah-license-server --skip-nx-cache --testPathPatterns="route-map|controller-validation|admin-guards|app.module|controller-registry"
Test Suites: 4 passed, 4 total
Tests:       93 passed, 93 total

$ npx nx run-many -t eslint:lint,typecheck,test -p api-notifications,api-community,api-contracts-community,api-member-hub,api-forum,api-learning,api-core,api-audit,ptah-license-server --skip-nx-cache
 NX   Successfully ran targets eslint:lint, typecheck, test for 9 projects
 api-contracts-community   2 suites / 33 tests
 api-core                  3 suites / 26 tests
 api-audit                 1 suite  /  5 tests
 api-notifications         5 suites / 128 tests
 api-community             19 suites / 448 tests
 api-forum                 20 suites / 482 tests
 api-learning               (green)
 api-member-hub             9 suites / 125 tests
 ptah-license-server         5 suites / 158 tests
 lint: 0 errors everywhere (5 pre-existing warnings in api-forum, 1 pre-existing in api-core/sentry.module.ts, 2 pre-existing in ptah-license-server jest.config.ts/instrument.ts — none in a Batch 14 file)
```

Every count matches what the batch reports claim (14C §8.1). No red test, no lint error, anywhere in scope.

## The six exit-gate clauses — independently verified

1. **`notes` never reaches a member.** Read `packs.types.ts` (`toPackResponse` vs `toMemberPack`, two separate functions, `toMemberPack` names 8 fields explicitly, no spread). Read `member-packs.service.ts` — the only caller of `toMemberPack` is `MemberPacksService.list`. Read `packs.section.ts` (hub) — it injects `MemberPacksService` and calls `.list()`, it does **not** run its own Prisma query. Confirmed 14C's claimed resolution (§1 below) is real: the hub does not have a second query path to the `packs` table. **CLOSED, single chokepoint confirmed.**
2. **`recipientId === actorId` suppression.** `notifications.service.ts:144` is the only site with that comparison (`grep -n "actorId ===" libs/api/forum/src/lib/posts/posts.service.ts` returns nothing — confirmed no duplicate check). `posts.service.ts:288` passes `actorId: ctx.userId` straight through with a comment "PASSED, NEVER PRE-CHECKED." **CLOSED, single location confirmed.**
3. **Retention prune — 90-day READ-only, genuinely scheduled.** Read `notification-retention.service.ts` (`readAt: { not: null }` AND `createdAt: { lt: cutoff }`, `RETENTION_DAYS = 90`, `lt` exclusive). Read `notification-retention.service.spec.ts` — it does supply its own `ScheduleModule.forRoot()` (line 256) and does have the "WITHOUT ScheduleModule.forRoot() the job is registered NOWHERE" test (line 358) proving the lib-level spec alone is blind to the app's registration. Read `app.module.spec.ts` — it has a second, independent assertion (`registers ScheduleModule.forRoot() — the first cron in this server (RISK-AE)`, line 175) that reflects `AppModule`'s own `imports` metadata. Both halves exist exactly as claimed. **CLOSED.**
4. **`GET /members/packs` filters on `memberVisible: true` only.** `member-packs.service.ts:82-86` — `where: { memberVisible: true }`, nothing else. Its constructor injects only `PrismaService` (line 66). `member-packs.module.ts` provides only `MemberPacksService`; no `CohortResolver`/`MembershipService`/`MemberGroupsService` import anywhere in the module or service. **CLOSED.**
5. **Migration 5 — `member_visible` defaults false.** Read the migration SQL directly: `ADD COLUMN "member_visible" BOOLEAN NOT NULL DEFAULT false`. No backfill statement of any kind touches existing rows. **CLOSED.**
6. **B12's F-1, all three of accept/reschedule/decline.** Read `session-requests.service.ts` — all three methods check `!this.calendar.isEnabled()` and throw `503 { reason: SCHEDULING_UNAVAILABLE }` before any write; `decline`'s guard is correctly nested inside `if (request.calendarEventId !== null)` (line 567-568), matching the claim that a pending request without an event still declines successfully. Read `session-requests.service.spec.ts` — the `writesAttempted()` helper (line 180) checks all seven Prisma write verbs, not just `update`, and the `it.each(CASES)` block (line 936) asserts `writesAttempted(h)` is `[]`, `$transaction` not called, and `h.notify` not called, for all three methods against an `isEnabled() === false` double. There is also a control test (`decline of a PENDING request still WORKS with Google off`, line 974) proving the guard is conditional, not blanket. **CLOSED, and the closure is real — a mutation that made `decline` write before its 503 would fail exactly the `writesAttempted` assertion, since `update`/`updateMany` would appear in the array.**

## Specific scrutiny items — verified

- **Task 14.15 seam.** `controller-registry.ts` has both `packs/MemberPacksController` and `notifications/MemberNotificationsController` entries; `controller-validation.spec.ts` has `MIN_TOTAL_PAYLOAD_PARAMS = 77`, `NAMED_PRIMITIVE_PARAM_COUNT = 6`, `UNVALIDATED_DEBT = []`; `route-map.spec.ts` shows `EXPECTED_ROUTES` grown by 5 with `PREFIX_EXCEPTIONS`/`KNOWN_PREFIX_DEBT` untouched. All structural gates pass (93/93). Nothing fell through the 14B/14C seam.
- **14C overriding 14B's hub-injection docblock.** `member-packs.module.ts` now reads "🔴 CORRECTION, TASK 14.16" and states the hub injects `MemberPacksService`. `libs/api/community/src/index.ts` agrees (exports `MemberPacksService`; docblock explains why). `member-hub.module.ts` imports `MemberPacksModule` and `PacksSection` injects `MemberPacksService`. `grep -rn "through its own resolver"` finds it only inside the two docblocks that explicitly narrate the correction (as quoted, past-tense) — no third site still asserts the old contract. Consistent.
- **`HUB_SECTION_STATUSES` data-dependent.** `packs.section.ts:62` — `status: rows.length > 0 ? 'ok' : 'empty'`. `notifications.section.ts:67` — `status: summary.unreadCount > 0 ? 'ok' : 'empty'`. Neither resolver contains a `try`/`catch` (confirmed by reading both files in full) — matches the R6.4 "propagate, don't swallow" rule. Not pinned to `'ok'` anywhere.
- **RISK-L rewrites / `@Global()` claim.** `notifications.module.ts:78` — `@Global()` confirmed. `forum.module.spec.ts`, `learning.module.spec.ts`, `live-sessions.module.spec.ts` all contain rewritten RISK-L describe blocks asserting `NotificationsModule` absent from imports plus (for the two non-producing libs) a source-scan for `from '@ptah-api/notifications'`. `google-sessions.module.ts` docblock updated in the same terms. `app.module.ts` registers `NotificationsModule` once, globally, with the reasoning recorded inline.
- **`announcement` kind inert.** Declared in `notification-kind.ts:30`. `grep -rn "announcement"` across `libs/api/notifications`, `libs/api/forum`, `libs/api/community` (excluding specs) finds only docblock prose referencing it as having no producer — no `kind: 'announcement'` write anywhere in production code.
- **Scope boundary — no SSE/WS/email/push extended.** `libs/api/licensing/src/lib/events/events.controller.ts` is the only `@Sse` site in the repo; it was not touched by this diff (not in `git status`) and nothing in the notifications lib imports or references it. `member-notifications.controller.ts`'s own docblock records the deliberate non-use.
- **Coding standards spot-check.** No `catch (error)` without `: unknown` in any Batch 14 file (`grep` empty). No `: any` / `as any` in the new packs/notifications/hub-sections files (`grep` empty). No `process.env` in production code — the only hits are inside `notification-retention.service.spec.ts`'s hermetic test setup, matching the same pattern already used by `app.module.spec.ts`. `pack.dto.ts` decorators verified: `memberVisible` carries `@IsOptionalNotNull()` (rejects explicit `null` with 400), `accessNote` carries `@IsOptional()` (tolerates `null` as "clear the column") — opposite decorators as claimed, and correct given the schema (`member_visible NOT NULL DEFAULT false` vs `access_note` nullable).

## Non-blocking observations

- **14A's judgement call on deleting `admin_audit_log` probe rows** (batch-14a-report.md §6.3) is disclosed and reversed the table to its pre-batch state; not a code defect, but it is a manual `DELETE` against an append-only compliance ledger performed outside any application code path. Worth a one-line note in the team-leader's commit message or a follow-up decision, not a blocker — the ledger is back at its measured pre-batch state and no application code performs this deletion.
- **14A's finding that `prisma format --check` cannot pass without a 113-line unrelated reformat** is real (verified structurally by reading the migration/schema banners) and is correctly deferred as its own future task rather than folded into this diff.
- Both of the above are process/environment notes already disclosed in the reports, not code-logic defects, and neither affects the six exit-gate clauses.

## Verdict

I found no failure mode, gap, or unverified claim across the six exit-gate clauses, the specific scrutiny list, or the coding-standards checklist. Every claim I checked against the actual source and test output held. All structural and unit gates pass with the exact counts the reports state. The `notes` chokepoint, the R10.2 suppression, the RISK-AE two-part scheduler proof, and B12's F-1 closure are all real, single-sourced, and covered by assertions that would catch a regression (verified by reading the assertion mechanics, not just their existence).

APPROVED
