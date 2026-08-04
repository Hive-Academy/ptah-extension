import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  EnvironmentInjector,
  createEnvironmentInjector,
  runInInjectionContext,
} from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { provideMarkdownRendering } from '@ptah-extension/markdown';
import { SANITIZE } from 'ngx-markdown';

/**
 * AD-1, PROVEN RATHER THAN ASSERTED.
 *
 * The `/members` route in `app.routes.ts` declares
 * `providers: [provideMarkdownRendering({ extensions: 'member' })]` and rests
 * on a claim about Angular DI: that a route-level `providers` array shadows the
 * app-level `'basic'` pair for that subtree ONLY, needing no `app.config.ts`
 * change and leaking in neither direction.
 *
 * That claim holds because `provideMarkdown()` returns PLAIN providers — its
 * `MarkdownService` is a bare class provider, NOT `providedIn: 'root'` — so a
 * child environment injector genuinely re-provides it rather than resolving to
 * one root instance. If a future ngx-markdown release marked `MarkdownService`
 * as `providedIn: 'root'`, the member sanitizer would silently stop applying
 * and member-authored content would render through `'basic'`, which installs NO
 * DOMPurify override at all (NFR-S2). Nothing in the type system catches that
 * regression. This does.
 *
 * ⚠️ DELIBERATELY DOES NOT IMPORT `./app.routes`. Doing so pulls the eager
 * `LandingPageComponent` and the entire marketing component graph
 * (fullcalendar, gsap, lenis) into the Jest module graph for a test about two
 * injectors. The route's SHAPE is already proven by `nx typecheck` and
 * `nx build ptah-landing-page`, whose output emits `hub-page` as its own lazy
 * chunk; what neither proves is the DI behaviour below.
 */
describe("route-level 'member' providers shadow the app's 'basic' pair (AD-1)", () => {
  /** What ngx-markdown would call to sanitize, resolved from a given injector. */
  function sanitizerIn(injector: EnvironmentInjector): unknown {
    return runInInjectionContext(injector, () =>
      injector.get(SANITIZE, null, { optional: true }),
    );
  }

  /** The app-level pair, exactly as `app.config.ts` wires it. */
  function appInjector(): EnvironmentInjector {
    return createEnvironmentInjector(
      provideMarkdownRendering({ extensions: 'basic' }),
      TestBed.inject(EnvironmentInjector),
    );
  }

  /**
   * The `/members` route's own `providers` array on a child injector — which is
   * precisely what the router builds for a route that declares them.
   */
  function memberRouteInjector(
    parent: EnvironmentInjector,
  ): EnvironmentInjector {
    return createEnvironmentInjector(
      provideMarkdownRendering({ extensions: 'member' }),
      parent,
    );
  }

  it('the child resolves a sanitizer; the parent stays on basic', () => {
    const app = appInjector();
    const member = memberRouteInjector(app);

    // 'basic' installs no SANITIZE override at all — that is exactly why it is
    // unsafe for user-generated content, and why the member subtree must not
    // inherit it.
    expect(sanitizerIn(app)).toBeNull();
    expect(typeof sanitizerIn(member)).toBe('function');
  });

  it('the resolved member sanitizer is the allowlist one, not a pass-through', () => {
    const sanitize = sanitizerIn(memberRouteInjector(appInjector())) as (
      html: string,
    ) => string;

    // Round-trips through the RESOLVED provider rather than an imported copy of
    // its options: resolving the right token but the wrong factory would pass
    // every assertion above and still ship an unsanitized member panel.
    const cleaned = sanitize('<p>hi</p><script>alert(1)</script>');
    expect(cleaned).toContain('<p>hi</p>');
    expect(cleaned).not.toContain('<script>');
  });

  it('the member providers do not leak upward into the app injector', () => {
    const app = appInjector();
    memberRouteInjector(app);

    // Creating the child must not retroactively install SANITIZE on the parent.
    // If it did, every marketing page would start running member-content rules.
    expect(sanitizerIn(app)).toBeNull();
  });

  it('two sibling member subtrees each get a working sanitizer', () => {
    const app = appInjector();
    const first = sanitizerIn(memberRouteInjector(app));
    const second = sanitizerIn(memberRouteInjector(app));

    // Guards the `getMemberPurifier()` memoisation: it caches a DOMPurify
    // INSTANCE, not an injector-scoped value, so a second subtree must still
    // resolve a usable sanitizer rather than one bound to the first injector.
    expect(typeof first).toBe('function');
    expect(typeof second).toBe('function');
  });
});

/**
 * R9.5 — `/members` names its own guard, and can only do so because
 * `MemberGuard` lives in a lib this file does not lazy-load.
 *
 * `MEMBER_ROUTES` used to carry `canActivate: [MemberGuard]` on its root child,
 * because the guard shipped in `@ptah-web/members` and
 * `@nx/enforce-module-boundaries` errors on "Static imports of lazy-loaded
 * libraries are forbidden" for a symbol pulled statically out of the same lib a
 * file lazy-loads. That worked, but it hid the fact that `/members` was guarded
 * from every reader of this route table. The guard and `MemberSessionStore`
 * moved into `@ptah-web/core` — eagerly imported, never lazy — so the route can
 * declare its own protection the way `/admin` always has.
 *
 * ⚠️ ASSERTED OVER THE SOURCE TEXT, ON PURPOSE, for the same reason the suite
 * above refuses to import `./app.routes`: doing so pulls the eager
 * `LandingPageComponent` and the whole marketing component graph (fullcalendar,
 * gsap, lenis) into the Jest module graph. `members.routes.spec.ts` uses the
 * same `readFileSync` technique for the same trade-off. The RUNTIME behaviour
 * of this exact wiring — guard resolves before `MemberLayout` is constructed,
 * and all three probe outcomes route correctly — is proven against a real
 * Router in `libs/web/members/src/lib/member-guard-wiring.spec.ts`.
 */
describe('the /members route declares canActivate: [MemberGuard] (R9.5)', () => {
  const source = readFileSync(join(__dirname, 'app.routes.ts'), 'utf8');

  /** The `{ ... }` route object literal whose `path` is `'members'`. */
  function sliceMembersRoute(): string | null {
    const anchor = source.indexOf("path: 'members',");
    if (anchor === -1) return null;
    // Top-level route objects open at `\n  {` and close at `\n  },`.
    const start = source.lastIndexOf('\n  {', anchor);
    const end = source.indexOf('\n  },', anchor);
    return start === -1 || end === -1 ? null : source.slice(start, end);
  }

  const membersRoute = sliceMembersRoute();

  it('finds the /members route block (tripwire for a vacuous pass)', () => {
    // Every assertion below is a substring check against this slice. If the
    // slice were ever empty or null, they would all pass for the wrong reason.
    expect(membersRoute).not.toBeNull();
    expect(membersRoute).toContain('loadChildren');
  });

  it('guards it with MemberGuard, not AuthGuard', () => {
    expect(membersRoute).toContain('canActivate: [MemberGuard]');
    // AuthGuard cannot tell "logged in, not a member" from "logged out", so a
    // member whose subscription lapsed would land on /login, not /pricing.
    expect(membersRoute).not.toContain('canActivate: [AuthGuard]');
  });

  it('imports MemberGuard from @ptah-web/core, never from the lazy member lib', () => {
    expect(source).toContain("import { MemberGuard } from '@ptah-web/core';");
    // This is the whole point of the relocation. A static import from the lib
    // `loadChildren` reaches is precisely the lint error that forced the guard
    // onto MEMBER_ROUTES[0] in the first place.
    expect(source).not.toContain("from '@ptah-web/members'");
  });
});
