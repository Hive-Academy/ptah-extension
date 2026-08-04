/**
 * `@ptah-web/members` — public surface of the Ptah Builders member panel.
 *
 * Deliberately ONE symbol. `app.routes.ts` needs exactly the lazy route tree;
 * everything else — the layout, the hub, the sections, the theme service — is
 * reached through `MEMBER_ROUTES` and has no business being importable from
 * outside this lib. A wider barrel is how a member component ends up rendered
 * on a marketing page with no guard in front of it.
 *
 * ⚠️ AND IT MUST STAY ONE SYMBOL, BECAUSE THIS LIB IS LAZY-LOADED.
 * `app.routes.ts` reaches it through `loadChildren`, and
 * `@nx/enforce-module-boundaries` errors — "Static imports of lazy-loaded
 * libraries are forbidden" — on any file that lazy-loads a lib and also
 * statically imports from it. `MEMBER_ROUTES` is safe only because it is
 * consumed inside the `import()` callback; anything else exported here would
 * have to be imported statically to be useful, which is the error.
 *
 * That constraint is why `MemberGuard` and `MemberSessionStore` are NOT here.
 * They live in `@ptah-web/core`, which the app imports eagerly, so
 * `app.routes.ts` can write `canActivate: [MemberGuard]` on the `/members`
 * route itself — the same arrangement `AdminAuthGuard` has always had for
 * `/admin`. Moving them was the fix; widening this barrel was not.
 */
export { MEMBER_ROUTES } from './lib/members.routes';
