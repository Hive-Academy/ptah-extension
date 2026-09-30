/**
 * `@ptah-web/members` — public surface of the Ptah Builders member panel.
 *
 * Deliberately NARROW: the lazy route tree and the panel's translation scopes.
 * `app.routes.ts` needs exactly the route tree, plus the scopes for its `/members`
 * route resolver (TASK_2026_575); everything else — the layout, the hub, the
 * sections, the theme service — is reached through `MEMBER_ROUTES` and has no
 * business being importable from outside this lib. A wider barrel is how a
 * member component ends up rendered on a marketing page with no guard in front
 * of it.
 *
 * ⚠️ AND EVERY EXPORT MUST BE CONSUMABLE INSIDE AN `import()` CALLBACK, BECAUSE
 * THIS LIB IS LAZY-LOADED. `app.routes.ts` reaches it through `loadChildren`,
 * and `@nx/enforce-module-boundaries` errors — "Static imports of lazy-loaded
 * libraries are forbidden" — on any file that lazy-loads a lib and also
 * statically imports from it. `MEMBER_ROUTES` is safe only because it is
 * consumed inside the `import()` callback, and the scopes the same way
 * (`() => import('@ptah-web/members').then((m) => m.MEMBERS_I18N_SCOPES)`);
 * anything that would have to be imported statically to be useful is the error.
 *
 * That constraint is why `MemberGuard` and `MemberSessionStore` are NOT here.
 * They live in `@ptah-web/core`, which the app imports eagerly, so
 * `app.routes.ts` can write `canActivate: [MemberGuard]` on the `/members`
 * route itself — the same arrangement `AdminAuthGuard` has always had for
 * `/admin`. Moving them was the fix; widening this barrel was not.
 */
export { MEMBER_ROUTES } from './lib/members.routes';
export {
  MEMBERS_I18N_SCOPE,
  MEMBERS_I18N_SCOPES,
} from './lib/i18n/members.i18n-scope';
