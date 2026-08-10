// TASK_2026_177 Phase 5 — the member-owned in-app notification inbox (R10).
//
// ⚠️ `NotificationRetentionService` IS NOT EXPORTED, AND THAT IS THE POINT OF
// THIS BARREL. Its `prune()` is a GLOBAL `deleteMany` with no `userId` in the
// `where`; a consumer that could inject it could delete rows belonging to
// members it has no relationship with, from a request handler. It is provided
// by `NotificationsModule` so the scheduler can discover it, and reachable from
// nowhere else. `PRUNE_JOB_NAME` and `RETENTION_DAYS` stay with it — the wiring
// assertion that needs them lives inside this lib.
//
// ⚠️ NOTHING FROM `@ptah-contracts/community` IS RE-EXPORTED. `NotificationKind`,
// `NotificationTargetType` and `MemberNotification` are owned there; a second
// export site for one vocabulary is a second place for it to drift.
export * from './lib/dto/list-notifications.query.dto';
export * from './lib/dto/mark-notifications-read.dto';
export * from './lib/member-notifications.controller';
export * from './lib/notification-kinds';
export * from './lib/notifications.module';
export * from './lib/notifications.service';
