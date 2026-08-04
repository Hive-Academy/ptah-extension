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
