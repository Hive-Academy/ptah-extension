import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Route } from '@angular/router';

import { MEMBER_ROUTES } from './members.routes';

/**
 * R9.4 / RK-11 (Critical) — the member route table stays explicitly enumerated.
 *
 * `admin.routes.ts` deliberately keeps a `:model` / `:model/:id` catch-all: on
 * an internal operator surface, one generic table + detail pair reachable for
 * any model slug is the point of the admin panel. Copying it here would turn
 * every model the generic admin API can serve into a URL a member can type.
 *
 * A comment cannot stop that from being copied. This spec can.
 */
describe('MEMBER_ROUTES — no catch-all (R9.4, RK-11)', () => {
  /** Parameter segments a member route is permitted to declare. */
  const ALLOWED_PARAMETER_SEGMENTS = new Set([':slug', ':lessonSlug', ':id']);

  interface FlatRoute {
    readonly path: string;
    readonly full: string;
    readonly isRedirect: boolean;
    readonly guardCount: number;
  }

  function flatten(routes: readonly Route[], parent = ''): FlatRoute[] {
    const out: FlatRoute[] = [];
    for (const route of routes) {
      const path = route.path ?? '';
      const full = [parent, path].filter(Boolean).join('/');
      out.push({
        path,
        full,
        isRedirect: typeof route.redirectTo === 'string',
        guardCount:
          (route.canActivate?.length ?? 0) +
          (route.canActivateChild?.length ?? 0) +
          (route.canMatch?.length ?? 0),
      });
      if (route.children) out.push(...flatten(route.children, full));
    }
    return out;
  }

  const flat = flatten(MEMBER_ROUTES);

  it('discovers the whole tree (guards against an empty-tree false pass)', () => {
    // If `flatten` ever silently returned nothing, every assertion below would
    // vacuously pass. The count is the tripwire for that.
    expect(flat.length).toBeGreaterThanOrEqual(16);
    expect(flat.map((r) => r.full)).toContain('hub');
    expect(flat.map((r) => r.full)).toContain('account');
  });

  it('declares NO guard of its own — MemberGuard sits on /members (R7.7, R9.5)', () => {
    // This assertion used to read `expect(MEMBER_ROUTES[0].canActivate)
    // .toEqual([MemberGuard])`, back when the guard shipped in this lib and
    // could not be named on the `/members` route in `app.routes.ts` —
    // `@nx/enforce-module-boundaries` forbids statically importing a symbol out
    // of a lib the same file lazy-loads. `MemberGuard` and `MemberSessionStore`
    // have since moved into `@ptah-web/core`, so `/members` names the guard
    // itself and this tree must declare none: a second declaration here would
    // run the entitlement probe TWICE on every member navigation.
    //
    // The positive half of the wiring — that `/members` really does carry
    // `canActivate: [MemberGuard]` — is asserted in
    // `apps/ptah-landing-page/src/app/app.routes.spec.ts`, which is the file
    // that owns that route, and exercised end-to-end through a real Router in
    // `member-guard-wiring.spec.ts` beside this one.
    const guarded = flat.filter((r) => r.guardCount > 0).map((r) => r.full);
    expect(guarded).toEqual([]);
  });

  it('every member surface sits under that guarded root', () => {
    // A sibling top-level entry would be reachable without the probe running.
    expect(MEMBER_ROUTES).toHaveLength(1);
    expect(MEMBER_ROUTES[0].path).toBe('');
  });

  it("no route path's FIRST segment is a parameter", () => {
    const offenders = flat
      .filter((r) => r.path.split('/')[0].startsWith(':'))
      .map((r) => r.full);
    expect(offenders).toEqual([]);
  });

  it('every parameter segment is drawn from the allowlist', () => {
    const offenders = flat
      .flatMap((r) => r.path.split('/'))
      .filter((segment) => segment.startsWith(':'))
      .filter((segment) => !ALLOWED_PARAMETER_SEGMENTS.has(segment));
    expect(offenders).toEqual([]);
  });

  it("declares no ':model' route", () => {
    const offenders = flat
      .filter((r) => r.path.split('/').includes(':model'))
      .map((r) => r.full);
    expect(offenders).toEqual([]);
  });

  it("the literal strings ':model' and ':model/:id' appear nowhere in the source", () => {
    // The tree walk above catches a catch-all that is WIRED UP. This catches
    // one that is present but commented out or momentarily unreferenced —
    // i.e. it catches the copy-paste before it is re-enabled.
    const source = readFileSync(join(__dirname, 'members.routes.ts'), 'utf8');
    expect(source).not.toContain("':model'");
    expect(source).not.toContain("':model/:id'");
    expect(source).not.toContain('path: ":model"');
  });

  it('the only wildcard is a redirect, never a component route', () => {
    const wildcards = flat.filter((r) => r.path === '**');
    expect(wildcards).toHaveLength(1);
    expect(wildcards[0].isRedirect).toBe(true);
  });

  it('🔴 EVERY lazy route resolves a REAL component — zero placeholders remain', async () => {
    // 🔴 BATCH 15 SWAPPED THE LAST TWO (`packs`, `notifications`) AND DELETED
    // THE PLACEHOLDER COMPONENT. This assertion used to name the three live
    // routes Batch 13 swapped and was paired with an anti-vacuity test proving
    // the placeholder mechanism was still wired for the remaining two. There is
    // no remaining two, so the scope widened to the WHOLE TREE and the
    // anti-vacuity partner was replaced by the count below — a route table that
    // silently lost its children would otherwise pass this vacuously.
    //
    // Asserted by RESOLVING the lazy import rather than by reading the source,
    // because a route can point at the right file and still export the wrong
    // symbol.
    const children = MEMBER_ROUTES[0].children ?? [];
    const lazy = children.filter((route) => route.loadComponent !== undefined);

    // Every child except the two redirects (`''` and `'**'`) loads a component.
    expect(lazy).toHaveLength(children.length - 2);
    expect(lazy.length).toBeGreaterThanOrEqual(13);

    const resolved = await Promise.all(
      lazy.map(async (route) => {
        const component = await (
          route.loadComponent as () => Promise<{ name: string }>
        )();
        return { path: route.path, name: component.name };
      }),
    );

    // A real, distinctly-named component per route.
    expect(resolved.every((entry) => entry.name.length > 0)).toBe(true);
    expect(new Set(resolved.map((entry) => entry.name)).size).toBe(
      resolved.length,
    );
    expect(resolved.filter((entry) => /Placeholder/.test(entry.name))).toEqual(
      [],
    );
  });

  it('🔴 NO route carries a `data` block, and the two Batch 15 owned are real', () => {
    // The placeholder was configured ENTIRELY through route `data`
    // (`surface`/`phase`/`summary`). With the component deleted, a surviving
    // `data` block would be the residue of a half-finished swap — and would be
    // invisible to the resolution test above, because the route would still
    // load a real component while carrying dead configuration.
    const children = MEMBER_ROUTES[0].children ?? [];

    expect(children.filter((route) => route.data !== undefined)).toEqual([]);

    // Named explicitly: these are the two this batch swapped, so the assertion
    // is about them rather than about a tree that happened to be clean.
    for (const path of ['packs', 'notifications']) {
      const route = children.find((candidate) => candidate.path === path);
      expect(route).toBeDefined();
      expect(route?.loadComponent).toBeDefined();
      expect(route?.data).toBeUndefined();
    }
  });

  it('🔴 the placeholder module is DELETED from disk, not merely unreferenced', () => {
    // An unreferenced file still compiles, still ships in no bundle, and still
    // reads as "we might go back to stubs". Three docblocks promised the last
    // consumer would delete it; this is the assertion that it did.
    expect(existsSync(join(__dirname, 'placeholder'))).toBe(false);
  });

  it('matches the route table plan §5.2 specifies, exactly', () => {
    expect(flat.map((r) => r.full)).toEqual([
      '',
      '',
      'hub',
      'courses',
      'courses/:slug',
      'courses/:slug/lessons/:lessonSlug',
      'packs',
      'live',
      'live/replays',
      'live/request',
      'community',
      'community/topics/:slug',
      'community/my-threads',
      'notifications',
      'search',
      'account',
      '**',
    ]);
  });
});
