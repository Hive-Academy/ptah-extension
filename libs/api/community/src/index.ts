export * from './lib/circle/circle-provisioning.service';
export * from './lib/circle/circle.module';
export * from './lib/circle/circle.provider';
export * from './lib/circle/circle.types';
export * from './lib/circle/waitlist-conversion.sink';
export * from './lib/google-sessions/admin-session-requests.controller';
export * from './lib/google-sessions/admin-sessions.controller';
export * from './lib/google-sessions/admin-sessions.service';
export * from './lib/google-sessions/dto/admin-session.dto';
export * from './lib/google-sessions/member-session-requests.controller';
export * from './lib/google-sessions/session-requests.service';
export * from './lib/google-sessions/google-auth.provider';
export * from './lib/google-sessions/google-calendar.provider';
export * from './lib/google-sessions/google-event.mapper';
export * from './lib/google-sessions/google-sessions.module';
export * from './lib/google-sessions/google-sessions.types';
export * from './lib/google-sessions/members.controller';
export * from './lib/google-sessions/sessions.service';
// TASK_2026_177 Phase 4 — the Ptah-authored live schedule (`live-sessions/`).
//
// ⚠️ THE FOUR CONTROLLER CLASSES ARE EXPORTED AND THE WRITE SERVICE IS NOT.
// PRE-2 requires every controller to appear in
// `apps/ptah-license-server/src/testing/controller-registry.ts`, which imports
// each BY PACKAGE NAME — a controller the barrel hides cannot be registered and
// the census assertion fails the build. A controller class is inert without an
// instance and cannot be constructed outside Nest, because its constructor
// dependencies are precisely the services the barrel does not export, so the
// capability rule survives. `LiveSessionsService` therefore stays internal;
// `LiveFeedService` is exported because the hub's `sessions` section composes it
// (Task 12.15), and it is a READ model with no mutation on it.
//
// ⚠️ `live-sessions/common/**` IS DELIBERATELY NOT EXPORTED, for the reason
// forum's and learning's `common/` are not: a consumer that can reach
// `NOT_DELETED` or `buildLiveSessionVisibilityWhere` can hand-build a `where`
// and read past every visibility clause. `live-sessions.module.spec.ts` asserts
// this surface by exact array equality.
export * from './lib/live-sessions/admin-live-sessions.controller';
export * from './lib/live-sessions/live-feed-state';
export * from './lib/live-sessions/live-feed.service';
export * from './lib/live-sessions/live-sessions.module';
export * from './lib/live-sessions/member-live.controller';
export * from './lib/member-groups/dto/member-group.dto';
export * from './lib/member-groups/member-groups.controller';
export * from './lib/member-groups/member-groups.module';
export * from './lib/member-groups/member-groups.service';
export * from './lib/packs/admin-packs.controller';
export * from './lib/packs/dto/pack.dto';
export * from './lib/packs/packs.module';
export * from './lib/packs/packs.service';
export * from './lib/packs/packs.types';
