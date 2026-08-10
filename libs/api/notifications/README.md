# api-notifications

The member-owned in-app notification inbox — R10, TASK_2026_177 Phase 5.

One table (`member_notifications`, migration
`20260902090000_packs_visibility_and_notifications`), one member controller at
`v1/members/notifications`, one write facade, and the first scheduled job in
this server.

## What is in here

| File                                  | Role                                                                               |
| ------------------------------------- | ---------------------------------------------------------------------------------- |
| `notifications.service.ts`            | THE write facade + the three member reads. Owns the R10.2 self-suppression         |
| `notification-retention.service.ts`   | `@Cron` daily 04:00 — deletes READ notifications older than 90 days (R10.6)        |
| `notification-kinds.ts`               | `buildNotificationRoute` — the ONE place a stored `route` is constructed (RISK-AJ) |
| `member-notifications.controller.ts`  | `GET /`, `GET unread-count`, `POST :id/read`, `POST read-all`                      |
| `dto/list-notifications.query.dto.ts` | Whole-object query DTO; `pageSize > 50` is a `400`, not a clamp                    |
| `notifications.module.ts`             | `@Global()`; exports `NotificationsService` and nothing else                       |

## Why the suppression is a SERVICE and not four inline `create` calls

R10.2 — _a member never gets a notification for their own action_ — is the whole
reason this lib has a facade instead of four producers each calling
`prisma.notification.create`. With four call sites, "check that the recipient is
not the actor" is four chances to forget, and forgetting is invisible: the
notification looks correct to everyone except the one person who receives it.

`NotificationsService.create()` returns `null` without writing when
`recipientId === actorId`. **A producer must never pre-check the equality
itself** — a second copy of the rule is a second place for it to drift, and the
copy that drifts is the one that stops suppressing.

It returns `null` rather than throwing because self-action is the NORMAL case for
three of the four producers. An exception would make every producer wrap the call
in a `try`, and one of them would eventually swallow a real failure with it.

## Why this module is `@Global()` when `PacksModule` refuses to be

The two decisions look contradictory and are the same decision applied to
opposite shapes.

`PacksModule` refuses `@Global()` because `PacksService` has exactly ONE consumer
in its own module, and a global export would make a member-facing injection
possible from anywhere — the shape that design excludes.

`NotificationsService` has four consumers in three other libs. An explicit import
in each would put an edge from every producer lib into this one for a service
whose entire public surface is "write one row, unless the actor is the
recipient". What makes the global export safe is that it **grants no authority a
producer does not already have**: it writes to a table the producer could write
to anyway, and the only thing it adds is a rule producers must not be able to
skip.

## This lib copies NO `common/` helpers (ASSUMPTION-19)

`forum`, `learning` and `community` each carry their own `member-context.ts`,
`admin-audit.ts` and `soft-delete.ts`. The symmetric move here would be a fourth
set. There is nothing for them to do:

- **no visibility rule** — a notification is owned by exactly one user and read
  by exactly that user. `userId: ctx.userId` IS the whole rule;
- **no soft delete** — `Notification` has no `deletedAt`. Rows leave by the
  retention prune and by `onDelete: Cascade` when the recipient's account goes. A
  tombstone would be an inbox entry a member cannot dismiss;
- **no admin mutation** — nothing here is an admin action, so no
  `AuditLogService` and no `AuditModule` import. R10 is a member-owned inbox and
  there is deliberately no admin surface over it.

`MemberContext` is imported as a **type** from `@ptah-api/membership`.
`notifications.module.spec.ts` asserts there is no `common/` directory, so the
symmetry cannot quietly reassert itself.

## 🔴 The cron is the highest-risk thing in this lib

`@nestjs/schedule` was a dependency of this repo for months and was imported
**nowhere** — zero `ScheduleModule`, zero `@Cron`. `NotificationRetentionService`
is the first scheduled job in this server.

A `@Cron` without `ScheduleModule.forRoot()` compiles, passes every test that
calls `prune()` directly, and **never runs**. The failure is silent and
unit-test-green forever.

- `ScheduleModule.forRoot()` is registered **once**, in
  `apps/ptah-license-server/src/app/app.module.ts`. Not here: this module is
  `@Global()` and imported by the producer libs, so a `forRoot()` inside it would
  register the scheduler root more than once.
- `notification-retention.service.spec.ts` boots a real injector, calls
  `.init()` (not just `.compile()` — the explorer registers in `onModuleInit` and
  the orchestrator mounts in `onApplicationBootstrap`), resolves
  `SchedulerRegistry`, and asserts a cron job named `PRUNE_JOB_NAME` is
  **registered**. Firing it asserts the two-clause `where` actually reaches
  Prisma.

## The prune's `where` has two clauses and both are the requirement

```ts
{ readAt: { not: null }, createdAt: { lt: cutoff } }
```

R10.6 says "older than a retention window **and already read**". Dropping the
`readAt` clause deletes a member's unread backlog — the one thing the inbox
exists to hold — on a schedule, at 4am, with no request to trace it to. The
cutoff is **exclusive**: a row created exactly at it survives.

## `route` is stored, frozen, and navigated to verbatim

Plan §1.6 stores `route` at write time rather than deriving it at read time, so a
routing change never orphans historical notifications. The cost is that a bad
value written today is still in the table years later and no deploy fixes it —
and the client calls `router.navigateByUrl` on it.

`buildNotificationRoute` is therefore the single construction site. The
`/members/` prefix is a literal in every branch, every caller-supplied segment
goes through `encodeURIComponent`, and the return type is the template-literal
type `` `/members/${string}` ``, so a branch returning anything else does not
compile. The client (Task 15.4) additionally refuses a stored `route` that does
not start with `/members/` — defence at both ends.

## Not in scope, by decision

No websocket, no SSE, no email, no push, no digest — the badge is a plain `GET`
on a ≥60 s client timer (AD-14, R10.5). `libs/api/licensing`'s `@Sse` endpoint is
not imported, extended or referenced. There are no notification preferences, no
mute settings and no per-kind opt-out. There is no admin surface: R10 describes a
member-owned inbox, and if one is ever added it goes in `admin/`, re-declared.

**Four of the five `NOTIFICATION_KINDS` have a producer.** `announcement` is
declared, accepted by the service, and written by nothing — R10.1's admin-publish
action has no admin surface in this task (RK-1), and a producer for an action
nobody can take is dead code (ASSUMPTION-20).
