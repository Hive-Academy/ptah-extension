/**
 * `@ptah-web/members` — public surface of the Ptah Builders member panel.
 *
 * Deliberately ONE symbol. `app.routes.ts` needs exactly the lazy route tree;
 * everything else — the layout, the hub, the sections, the theme service, the
 * session store — is reached through `MEMBER_ROUTES` and has no business being
 * importable from outside this lib. A wider barrel is how a member component
 * ends up rendered on a marketing page with no guard in front of it.
 *
 * ⚠️ `MemberGuard` IS NOT EXPORTED, ON PURPOSE. It is tempting to export it so
 * `app.routes.ts` can write `canActivate: [MemberGuard]` next to its
 * `loadChildren`, and that is exactly what `@nx/enforce-module-boundaries`
 * rejects: "static imports of lazy-loaded libraries are forbidden" — the static
 * import pulls this lib back across the lazy boundary the `loadChildren` just
 * drew. The guard is declared on the root route inside `MEMBER_ROUTES` instead,
 * which is an ancestor of every member surface and therefore equivalent. If a
 * future change needs the guard at app level, the fix is to relocate it (with
 * `MemberSessionStore`) into `@ptah-web/core` the way `AdminAuthGuard` already
 * is — NOT to widen this barrel.
 */
export { MEMBER_ROUTES } from './lib/members.routes';
