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
// TASK_2026_177 Phase 5 — the member-facing half of the pack registry.
//
// THE CONTROLLER, THE MODULE **AND** `MemberPacksService` ARE EXPORTED — on the
// same terms `live-sessions` exports `LiveFeedService` above. PRE-2 needs the
// controller (`controller-registry.ts` imports each BY PACKAGE NAME) and
// `app.module.ts` needs the module class.
//
// 🔴 THE SERVICE IS EXPORTED FOR THE HUB, AND TASK 14.16 CHANGED THIS LINE.
// It previously said the service stayed internal and that the hub's `packs`
// section would read the table through its own resolver. That is the wrong
// design and `member-packs.module.ts`'s docblock argues it in full: the
// `toMemberPack` mapper — the thing that makes exit-gate clause 1 structural
// rather than tested — lives in this service, and a hub resolver with its own
// query would need its own copy of it. `PacksService` (every pack MUTATION and
// every audit write) is what must stay unreachable, and it still is: it is
// exported only because `PacksModule` needs it, and `MemberPacksModule` imports
// nothing from that module in either direction.
//
// ⚠️ `MemberPacksModule` IS STILL NOT `@Global()`, so the export widens nothing
// by itself: a consumer has to IMPORT the module, which is visible on the graph
// and in `member-hub.module.ts`. Today there is exactly one such consumer.
//
// ⚠️ `MemberPacksModule` IS A DIFFERENT MODULE FROM `PacksModule` AND THE TWO
// LINES BEING ADJACENT HERE IS NOT AN INVITATION TO MERGE THEM (RISK-AG).
// `admin-guards.spec.ts` G6 asserts every controller in `PacksModule` is
// mounted under `v1/admin/`; co-location is not co-registration.
export * from './lib/packs/member-packs.controller';
export * from './lib/packs/member-packs.module';
export * from './lib/packs/member-packs.service';
export * from './lib/packs/packs.module';
export * from './lib/packs/packs.service';
export * from './lib/packs/packs.types';
