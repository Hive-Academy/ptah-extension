import { readFileSync } from 'node:fs';
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
