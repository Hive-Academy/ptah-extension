import { Routes } from '@angular/router';

import { MemberGuard } from './guards/member.guard';
import { MemberLayout } from './member-layout/member-layout';
import type { MemberPlaceholderData } from './placeholder/member-phase-placeholder';

/**
 * Member Routes — lazy-loaded child tree mounted at `/members` by
 * `app.routes.ts`, behind `MemberGuard`.
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
 *   /members/community                    -> feed                 (phase 2)
 *   /members/community/topics/:slug       -> thread               (phase 2)
 *   /members/community/my-threads         -> my threads           (phase 2)
 *   /members/notifications                -> inbox                (phase 5)
 *   /members/search                       -> search               (phase 2)
 *   /members/account                      -> AccountPage
 *
 * Every route renders INSIDE {@link MemberLayout}, which binds the shared
 * `PanelLayout` shell. Children use `loadComponent` so no sibling surface is in
 * the hub's bundle.
 */
export const MEMBER_ROUTES: Routes = [
  {
    /**
     * ⚠️ `MemberGuard` SITS HERE, NOT ON THE `/members` ROUTE IN
     * `app.routes.ts`, AND THAT IS A LINT CONSTRAINT, NOT A PREFERENCE.
     *
     * `@nx/enforce-module-boundaries` errors on "static imports of lazy-loaded
     * libraries": `app.routes.ts` lazy-loads `@ptah-web/members` via
     * `loadChildren`, so it may not ALSO statically import a symbol from it —
     * the static import is what defeats the lazy boundary. `/admin` avoids this
     * because `AdminAuthGuard` lives in `@ptah-web/core`, a lib that is never
     * lazy-loaded; `MemberGuard` lives in this lib because it seeds
     * `MemberSessionStore`, which lives here too.
     *
     * Behaviourally identical to guarding the parent `/members` route: this is
     * an ancestor route of every member surface, so `canActivate` runs on entry
     * to the panel and not again while navigating inside it — exactly what the
     * app-level placement would have done. The one difference is that an
     * unentitled visitor downloads this chunk before being redirected to
     * `/pricing`, which costs a wasted request and leaks nothing: the guard is
     * cosmetic by design (NFR-S8) and every member endpoint is enforced
     * server-side regardless of what the client managed to load.
     */
    path: '',
    canActivate: [MemberGuard],
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
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Community feed',
          phase: 2,
          summary: 'The native community replaces the old forum in phase 2.',
        }),
      },
      {
        path: 'community/topics/:slug',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Thread',
          phase: 2,
          summary: 'Discussion threads arrive with the community.',
        }),
      },
      {
        path: 'community/my-threads',
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'My threads',
          phase: 2,
          summary: 'Your own topics and replies arrive with the community.',
        }),
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
        loadComponent: loadPlaceholder,
        data: placeholder({
          surface: 'Search',
          phase: 2,
          summary: 'Search covers community content, so it lands with it.',
        }),
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
