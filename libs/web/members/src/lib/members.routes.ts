import { Routes } from '@angular/router';

import { MemberLayout } from './member-layout/member-layout';
import { MemberNotificationsStore } from './state/member-notifications.store';

/**
 * Member Routes — lazy-loaded child tree mounted at `/members` by
 * `app.routes.ts`, behind the `MemberGuard` that route declares.
 *
 * ⚠️ THERE IS NO `:model` / `:model/:id` CATCH-ALL HERE, AND ONE MUST NEVER BE
 * ADDED (R9.4, RK-11 — Critical). `admin.routes.ts:174-183` keeps exactly that
 * pattern and documents why: on an internal operator surface, a generic
 * table/detail route reachable for any model slug is a feature. On a
 * member-facing surface it is a data-exposure hazard — it turns every future
 * model the generic admin API can serve into a URL a member can type. The
 * member route table is enumerated in full instead, and
 * `members.routes.spec.ts` fails the build if that stops being true.
 *
 * Shape:
 *   /members                              -> redirects to /members/hub
 *   /members/hub                          -> HubPage (one request, R6.2)
 *   /members/courses                      -> CoursesPage          (phase 3)
 *   /members/courses/:slug                -> CoursePage            (phase 3)
 *   /members/courses/:slug/lessons/:lessonSlug -> LessonPage       (phase 3)
 *   /members/packs                        -> PacksPage            (phase 5)
 *   /members/live                         -> LivePage             (phase 4)
 *   /members/live/replays                 -> ReplaysPage          (phase 4)
 *   /members/live/request                 -> RequestSessionPage   (phase 4)
 *   /members/community                    -> FeedPage             (phase 2)
 *   /members/community/topics/:slug       -> ThreadPage           (phase 2)
 *   /members/community/my-threads         -> MyThreadsPage         (phase 2)
 *   /members/notifications                -> NotificationsPage    (phase 5)
 *   /members/search                       -> SearchPage           (phase 2)
 *   /members/account                      -> AccountPage
 *
 * Every route renders INSIDE {@link MemberLayout}, which binds the shared
 * `PanelLayout` shell. Children use `loadComponent` so no sibling surface is in
 * the hub's bundle.
 */
export const MEMBER_ROUTES: Routes = [
  {
    /**
     * ⚠️ NO `canActivate` HERE, AND RE-ADDING ONE WOULD RUN THE ENTITLEMENT
     * PROBE TWICE PER NAVIGATION. `MemberGuard` guards the parent `/members`
     * route in `app.routes.ts`, where a reader of the app's route table can see
     * that the member panel is protected at all.
     *
     * It used to sit here instead, because the guard shipped in THIS lib and
     * `@nx/enforce-module-boundaries` forbids `app.routes.ts` from statically
     * importing a symbol out of a lib the same file lazy-loads ("Static imports
     * of lazy-loaded libraries are forbidden"). The fix was to move the guard —
     * with `MemberSessionStore`, the only thing that tied it here — into
     * `@ptah-web/core`, which the app imports eagerly and never lazy-loads,
     * exactly as `AdminAuthGuard` already did for `/admin`.
     * `members.routes.spec.ts` fails if a guard reappears anywhere in this tree.
     *
     * The move also stops an unentitled visitor from downloading this chunk
     * before being bounced to `/pricing`: the probe now resolves before
     * `loadChildren` runs at all.
     */
    path: '',
    component: MemberLayout,
    /**
     * 🔴 `MemberNotificationsStore` IS PROVIDED HERE, AT THE PANEL ROUTE, AND
     * NOWHERE ELSE (RISK-AM, R9.3).
     *
     * TWO properties come from this one line and neither is available any other
     * way:
     *
     * 1. **LIFETIME.** The store holds a 60 s `setInterval`. Root-provided, it
     *    would outlive sign-out (a `401` loop against an endpoint that can
     *    never succeed again), outlive the member leaving `/members`, and leave
     *    an open handle in Jest. Provided here it is destroyed with the panel,
     *    and `member-notifications.store.spec.ts` asserts that a destroyed
     *    store makes no request when the clock is advanced past 60 s.
     *
     * 2. **IDENTITY.** `MemberLayout` (the nav badge) and `NotificationsPage`
     *    (the inbox) must resolve THE SAME INSTANCE — that is what makes the
     *    count have one writer. A `providers` array on either component would
     *    give that component its own copy, and the badge would then be reading
     *    a different object from the one the member just acted on. That is
     *    precisely the second source of truth R9.3 forbids, arriving through
     *    dependency injection instead of through a second template chip.
     *
     * `providedIn: 'any'` would be worse than `'root'` for both: it silently
     * gives each lazy route its own copy — its own poll, its own count — while
     * looking global.
     */
    providers: [MemberNotificationsStore],
    children: [
      {
        path: '',
        pathMatch: 'full',
        redirectTo: 'hub',
      },
      {
        path: 'hub',
        loadComponent: () => import('./hub/hub-page').then((m) => m.HubPage),
      },
      {
        /**
         * ⚠️ THESE THREE WERE PLACEHOLDERS FOR TWO PHASES, AND THE REASON IS
         * WORTH KEEPING. Phase 3 needed the whole `libs/api/learning` domain —
         * five tables, five controllers and the `@ptah-contracts/community`
         * course contracts — before a member surface could render anything but
         * a stub. Batch 9 landed that; Batch 10 swapped these three.
         *
         * ⚠️ THE LESSON ROUTE IS THE ONLY MEMBER ROUTE WITH TWO PARAMETER
         * SEGMENTS. `members.routes.spec.ts` asserts every parameter segment
         * comes from an allowlist, and `:lessonSlug` was already in it — added
         * with the placeholder in Batch 4 rather than with the real component,
         * so nothing had to change here.
         *
         * `loadComponent` on each, so no sibling surface enters the hub's
         * bundle: three new lazy chunks, not one shared one.
         */
        path: 'courses',
        loadComponent: () =>
          import('./learning/courses-page').then((m) => m.CoursesPage),
      },
      {
        path: 'courses/:slug',
        loadComponent: () =>
          import('./learning/course-page').then((m) => m.CoursePage),
      },
      {
        path: 'courses/:slug/lessons/:lessonSlug',
        loadComponent: () =>
          import('./learning/lesson-page').then((m) => m.LessonPage),
      },
      {
        /**
         * ⚠️ THE LAST TWO PLACEHOLDERS IN THE TREE WERE THIS AND
         * `notifications`, AND BATCH 15 SWAPPED BOTH. Phase 5 needed the
         * `packs` table's `member_visible` column and `GET /v1/members/packs`
         * before a member surface could render anything but a stub — A-1 makes
         * `cohortKey` a LABEL that gates nothing, so there was no client-side
         * way to decide what a member may see. Batch 14 landed the endpoint.
         *
         * With these two gone, the shared phase stand-in component and its two
         * route helpers were DELETED, exactly as that component's own docblock
         * and this file's promised: "the last one to do so deletes this file".
         * `members.routes.spec.ts` asserts none remains.
         */
        path: 'packs',
        loadComponent: () =>
          import('./packs/packs-page').then((m) => m.PacksPage),
      },
      {
        /**
         * ⚠️ THESE THREE WERE PLACEHOLDERS FOR THREE PHASES, AND THE REASON IS
         * WORTH KEEPING. The Live surface is a MERGE (AD-3) of two systems
         * neither of which existed here until Phase 4: `LiveSession` rows we
         * own, and the Google Calendar cohort sessions
         * `SessionsService.readUpcomingCalendarFeed` resolves. Until Batch 12
         * shipped `GET /v1/members/live`, the only honest render was a stub —
         * the hub's next-session card was the whole of what could be said.
         * Batch 13 swapped these three.
         *
         * ⚠️ NONE OF THEM TAKES A PARAMETER, so `members.routes.spec.ts`'s
         * parameter allowlist (`:slug`, `:lessonSlug`, `:id`) is unchanged by
         * this batch. `live/replays` and `live/request` are LITERAL second
         * segments under `live`, not a `live/:id` that would make every future
         * session id a URL a member could type (R9.4, RK-11).
         *
         * `loadComponent` on each, so no sibling surface enters another's
         * bundle: three new lazy chunks, not one shared one.
         */
        path: 'live',
        loadComponent: () => import('./live/live-page').then((m) => m.LivePage),
      },
      {
        path: 'live/replays',
        loadComponent: () =>
          import('./live/replays-page').then((m) => m.ReplaysPage),
      },
      {
        path: 'live/request',
        loadComponent: () =>
          import('./live/request-session-page').then(
            (m) => m.RequestSessionPage,
          ),
      },
      {
        path: 'community',
        loadComponent: () =>
          import('./community/feed-page').then((m) => m.FeedPage),
      },
      {
        path: 'community/topics/:slug',
        loadComponent: () =>
          import('./community/thread-page').then((m) => m.ThreadPage),
      },
      {
        /**
         * ⚠️ THIS ROUTE WAS A PLACEHOLDER FOR ONE BATCH, AND THE REASON IS
         * WORTH KEEPING. "My Threads" is the feed with an AUTHOR FILTER (R9.2),
         * and Batch 6 shipped no way to express one: `ListTopicsQueryDto`
         * accepted `categoryId`, `sort`, `page` and `pageSize` and nothing else,
         * while the global `ValidationPipe` runs `forbidNonWhitelisted: true`,
         * so an invented `?authorId=me` was a `400` rather than an ignored
         * parameter. Nothing on the client could substitute — `MemberSessionStore`
         * carries no user id, and matching `authorName` would be identity by
         * string comparison — so the screen was reported blocked instead of
         * being faked with a list of everyone's threads.
         *
         * The server closed it with a `mine?: boolean` on that same whole-object
         * DTO plus one conditional `authorId: ctx.userId` spread into the feed's
         * existing `where`. It is a CLAUSE, NOT A ROUTE:
         * `GET .../community/my-threads` is still a 404, the endpoint is the
         * shared `GET .../community/topics`, and the filter costs no extra query.
         */
        path: 'community/my-threads',
        loadComponent: () =>
          import('./community/my-threads-page').then((m) => m.MyThreadsPage),
      },
      {
        /**
         * ⚠️ THIS ROUTE RESOLVES THE SAME STORE INSTANCE THE NAV BADGE READS,
         * and that is the `providers` array above rather than anything here.
         * A `providers: [MemberNotificationsStore]` on this route — or on
         * `NotificationsPage` — would give the inbox its own count and its own
         * poll, and the badge would then be reading a different object from the
         * one the member just acted on (R9.3, RISK-AM).
         */
        path: 'notifications',
        loadComponent: () =>
          import('./notifications/notifications-page').then(
            (m) => m.NotificationsPage,
          ),
      },
      {
        path: 'search',
        loadComponent: () =>
          import('./search/search-page').then((m) => m.SearchPage),
      },
      {
        path: 'account',
        loadComponent: () =>
          import('./account/account-page').then((m) => m.AccountPage),
      },
      {
        // A mistyped member URL lands on the hub. This is a REDIRECT, not a
        // component route — it can never resolve a parameter, so it is not the
        // catch-all R9.4 forbids.
        path: '**',
        redirectTo: 'hub',
      },
    ],
  },
];

/*
 * ⚠️ 🔴 THE SHARED "SHIPS IN PHASE N" STAND-IN COMPONENT AND ITS TWO ROUTE
 * HELPERS ARE GONE, AND NOTHING SHOULD BRING THEM BACK.
 *
 * Every route in this tree now renders a real surface. The stand-in existed so
 * a nav item Batch 4 shipped would not be a broken link while its backend was
 * built, and it was deleted the moment its last two consumers were swapped —
 * which is what its own docblock and this file both promised would happen: "the
 * last one to do so deletes this file". Eight consumers became three, became
 * two, became none.
 *
 * A future surface that is not ready is a route that is NOT DECLARED, or a
 * component rendering its own honest empty state. Re-introducing a shared stub
 * would mean carrying a component whose entire purpose is to be deleted, and
 * the last one took three batches to go.
 *
 * `members.routes.spec.ts` asserts every lazy route resolves a real component,
 * that no route carries a `data` block, and that the module is gone from disk.
 */
