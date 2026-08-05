import { Routes } from '@angular/router';

import { MemberLayout } from './member-layout/member-layout';
import type { MemberPlaceholderData } from './placeholder/member-phase-placeholder';

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
 *   /members/courses                      -> course list          (phase 3)
 *   /members/courses/:slug                -> course detail        (phase 3)
 *   /members/courses/:slug/lessons/:lessonSlug -> lesson player   (phase 3)
 *   /members/packs                        -> member packs         (phase 5)
 *   /members/live                         -> upcoming sessions    (phase 4)
 *   /members/live/replays                 -> replays              (phase 4)
 *   /members/live/request                 -> request a session    (phase 4)
 *   /members/community                    -> FeedPage             (phase 2)
 *   /members/community/topics/:slug       -> ThreadPage           (phase 2)
 *   /members/community/my-threads         -> MyThreadsPage         (phase 2)
 *   /members/notifications                -> inbox                (phase 5)
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
        path: 'courses',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Courses',
          phase: 3,
          summary: 'The cohort curriculum is not published yet.',
        }),
      },
      {
        path: 'courses/:slug',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Course',
          phase: 3,
          summary: 'Course detail opens with the curriculum.',
        }),
      },
      {
        path: 'courses/:slug/lessons/:lessonSlug',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Lesson',
          phase: 3,
          summary: 'The lesson player opens with the curriculum.',
        }),
      },
      {
        path: 'packs',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Packs',
          phase: 5,
          summary: 'No packs have been published to members yet.',
        }),
      },
      {
        path: 'live',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Sessions',
          phase: 4,
          summary:
            'Your next session already shows on the hub. The full schedule lands with live sessions.',
        }),
      },
      {
        path: 'live/replays',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Replays',
          phase: 4,
          summary: 'Session recordings are published from phase 4 onward.',
        }),
      },
      {
        path: 'live/request',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Request a session',
          phase: 4,
          summary: 'Private one-to-one session requests open in phase 4.',
        }),
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
        path: 'notifications',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Notifications',
          phase: 5,
          summary: 'Your notification inbox opens in phase 5.',
        }),
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

function loadPlaceholder() {
  return import('./placeholder/member-phase-placeholder').then(
    (m) => m.MemberPhasePlaceholder,
  );
}

/** Typed passthrough so a malformed placeholder `data` block fails to compile. */
function placeholder(data: MemberPlaceholderData): MemberPlaceholderData {
  return data;
}
