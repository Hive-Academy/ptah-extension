/**
 * `@ptah-api/forum` — the native community forum: categories, topics, posts,
 * reactions, read state and search (R1, R1.7, R8 moderation).
 *
 * ⚠️ THE SERVICE SURFACE IS DELIBERATELY NARROW (plan §2.5). Exactly TWO
 * services leave this lib:
 *
 *   - `TopicsReadService`  — the ONLY read model `member-hub` composes.
 *   - `ReadStateService`   — the unread-count source `member-hub` composes.
 *
 * Not `TopicsService`, not `PostsService`, not `CategoriesService`, not
 * `SearchService`, not `AcceptedAnswerService`, not `ReactionsService`, not
 * `AdminTopicsReadService`, and none of `common/`. Those carry the WRITE paths,
 * the visibility where-builder and the one sanctioned tombstone read, and they
 * are reachable only through this lib's own controllers — i.e. only behind
 * `JwtAuthGuard` + `MemberGuard` (member) or `JwtAuthGuard` + `AdminGuard`
 * (admin). Exporting one would let a future consumer call a forum mutation, or
 * read a deleted body, having passed through none of that chain: the guard
 * chain would still exist and would simply not be on the path taken.
 * `forum.module.spec.ts` asserts this surface, so widening it is a visible
 * change rather than an import.
 *
 * ⚠️ THE FIVE CONTROLLER CLASSES ARE EXPORTED, AND THAT IS NOT A WIDENING OF
 * THE RULE ABOVE. PRE-2 requires every controller in the server to appear in
 * `apps/ptah-license-server/src/testing/controller-registry.ts` — the shared
 * ledger consumed by `route-map.spec.ts` (RI-1/RI-2/RI-3) and
 * `controller-validation.spec.ts` (the `dtoPipe` census). That registry imports
 * each class BY PACKAGE NAME, so a controller this barrel hides is a controller
 * that cannot be registered, and the census assertion fails the build. Every
 * other api lib — `@ptah-api/community`, `@ptah-api/member-hub`,
 * `@ptah-api/admin`, `@ptah-api/licensing`, `@ptah-api/marketing` — exports its
 * controllers for exactly this reason.
 *
 * It costs nothing the paragraph above protects. A controller class is inert
 * without an instance, and it cannot be constructed outside Nest: its
 * constructor dependencies are precisely the services this barrel does NOT
 * export. Its guards travel with the class as decorator metadata, so a
 * reflective consumer SEES the chain rather than bypassing it — which is
 * literally what `admin-guards.spec.ts` G1 does with three of these five.
 *
 * ⚠️ WIRE TYPES ARE NOT RE-EXPORTED HERE. They live in
 * `@ptah-contracts/community` and both this server and the member panel import
 * them from there. Mirroring that barrel would give the frontend a second,
 * server-flavoured import path for the same declaration — the drift the
 * contracts lib exists to prevent (the same rule `@ptah-api/member-hub`'s
 * barrel states).
 */

export * from './lib/forum.module';
export * from './lib/topics/topics-read.service';
export * from './lib/read-state/read-state.service';

export * from './lib/topics/member-community.controller';
export * from './lib/search/member-search.controller';
export * from './lib/categories/admin-community-categories.controller';
export * from './lib/topics/admin-community-topics.controller';
export * from './lib/posts/admin-community-posts.controller';
