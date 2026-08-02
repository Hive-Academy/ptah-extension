import { RequestMethod, type Type } from '@nestjs/common';
import { METHOD_METADATA, PATH_METADATA } from '@nestjs/common/constants';

import { ALL_CONTROLLERS } from '../testing/controller-registry';

/**
 * THE ROUTE MAP AS AN EXECUTABLE ARTEFACT (TASK_2026_170, plan §5.1).
 *
 * ⚠️ WHY THIS TEST EXISTS.
 * Nest resolves a request against controllers in MODULE-REGISTRATION ORDER.
 * Before TASK_2026_170, `admin/AdminController` was `@Controller('v1/admin')`
 * carrying `@Get(':model')`, `@Get(':model/:id')` and `@Patch(':model/:id')`,
 * and TEN sibling admin routes across five other controllers matched those
 * wildcards too. Every one of them worked only because its module happened to
 * sit above `AdminModule` in `app.module.ts`'s `imports` array. The entire
 * defence was a comment on an array literal — and the failure mode when it was
 * violated was not an error but a WRONG HANDLER: `GET /api/v1/admin/packs`
 * quietly 400ing with "Unknown admin model: packs".
 *
 * A comment cannot fail a build. This can.
 *
 * Deliberately dependency-free — no Postgres, no Nest bootstrap, no docker. It
 * reads `PATH_METADATA` off each controller class and off each handler
 * descriptor, and `METHOD_METADATA` off each descriptor. Booting `AppModule` to
 * ask Nest's own router would drag Prisma's `onModuleInit` in and make a cheap
 * structural test infra-dependent and flaky (TASK_2026_169 report §6(d)); the
 * REGISTERED table is instead verified out-of-band against Nest's
 * `RouterExplorer` log (plan §5.2), and this spec is what keeps it honest
 * between deploys.
 *
 * The controller list is NOT declared here. It is the shared registry in
 * `src/testing/controller-registry.ts`, also consumed by
 * `src/common/controller-validation.spec.ts`, so the two structural guards can
 * never disagree about what "every controller" means. That registry's census
 * assertion is what makes the list impossible to leave incomplete, which is
 * also what stops a new controller from sneaking a contested route past RI-2
 * below.
 *
 * FIVE GROUPS:
 *   EXPECTED_ROUTES — the whole HTTP surface, as data. A diff NAMES the route.
 *   RI-1 — prefix disjointness (the human-legible design rule)
 *   RI-2 — no cross-controller contest (THE load-bearing invariant)
 *   RI-3 — intra-controller specificity ordering
 *   anti-vacuity — the enumerator and the unifier actually work
 *
 * TWO DECORATOR QUIRKS the enumerator handles, both verified against source:
 *   - `events/events.controller.ts` uses `@Sse('subscribe')`, and Nest sets
 *     `METHOD_METADATA` to `RequestMethod.GET` for it — it is a GET route even
 *     though no `@Get` appears in the file.
 *   - `discourse/discourse.controller.ts` pairs `@Get('discourse')` with
 *     `@Redirect()`. `@Redirect` carries no method metadata; the `@Get` does.
 */

/* ------------------------------------------------------------------------- */
/* Route enumeration                                                          */
/* ------------------------------------------------------------------------- */

type Segment =
  | { readonly kind: 'literal'; readonly value: string }
  | { readonly kind: 'param' };

interface Route {
  /** `ALL_CONTROLLERS[].label` — path-qualified, unique. */
  readonly label: string;
  /** Controller prefix, normalised, no leading/trailing slash. */
  readonly prefix: string;
  readonly handler: string;
  readonly verb: string;
  /** Full path, api global prefix omitted. e.g. `v1/admin/records/:model`. */
  readonly path: string;
  readonly segments: readonly Segment[];
  /** Declaration index within the controller — the input to RI-3. */
  readonly order: number;
}

/** `'/'` → `''`; `'/a/b/'` → `'a/b'`. */
function normalize(path: string): string {
  return path.split('/').filter(Boolean).join('/');
}

/**
 * Split a normalised path into typed segments.
 *
 * ⚠️ THROWS on any segment form outside `literal | :param`. That is deliberate
 * and is the anti-vacuity guarantee for RI-2/RI-3: a wildcard (`*`), an
 * optional param (`:id?`), a regex param or a `{...}` group would make the
 * unification analysis below UNSOUND — it would compute "no contest" for paths
 * that genuinely contest. None of those forms exists in this server today. The
 * day one appears, this test must say so rather than quietly under-check.
 */
function parseSegments(path: string, where: string): Segment[] {
  return normalize(path)
    .split('/')
    .filter(Boolean)
    .map((raw): Segment => {
      if (raw.startsWith(':')) {
        if (!/^:[A-Za-z_][A-Za-z0-9_]*$/.test(raw)) {
          throw new Error(
            `route-map: unsupported param segment "${raw}" in "${path}" (${where}). ` +
              `Only plain ":name" params are analysable; optional/regex params ` +
              `would make the RI-2 contest analysis unsound. Extend parseSegments ` +
              `deliberately, do not relax this check.`,
          );
        }
        return { kind: 'param' };
      }
      if (/[*?{}()[\]+]/.test(raw)) {
        throw new Error(
          `route-map: unsupported segment form "${raw}" in "${path}" (${where}). ` +
            `Wildcards and pattern segments would make the RI-2 contest analysis ` +
            `unsound. Extend parseSegments deliberately, do not relax this check.`,
        );
      }
      return { kind: 'literal', value: raw };
    });
}

function verbOf(method: unknown, where: string): string {
  const name = RequestMethod[method as number] as string | undefined;
  if (name === undefined) {
    throw new Error(
      `route-map: unknown RequestMethod ${String(method)} (${where}).`,
    );
  }
  if (name === 'ALL') {
    throw new Error(
      `route-map: @All() at ${where}. A single handler answering every verb ` +
        `makes the per-verb contest analysis below unsound. If this is really ` +
        `wanted, teach RI-2 about it explicitly.`,
    );
  }
  return name;
}

function routesOf(label: string, controller: Type<unknown>): Route[] {
  const prefix = normalize(
    (Reflect.getMetadata(PATH_METADATA, controller) as string) ?? '',
  );
  const proto = controller.prototype as object;

  const routes: Route[] = [];
  let order = 0;
  // Declaration order. V8 preserves definition order for string-keyed own
  // properties, and Nest's own MetadataScanner relies on exactly this — which
  // is WHY intra-controller ordering (RI-3) is a real property and not a
  // stylistic preference.
  for (const handler of Object.getOwnPropertyNames(proto)) {
    if (handler === 'constructor') continue;
    const fn = Object.getOwnPropertyDescriptor(proto, handler)?.value as
      | object
      | undefined;
    if (!fn) continue;

    const method = Reflect.getMetadata(METHOD_METADATA, fn) as unknown;
    // NOTE: RequestMethod.GET === 0, so this MUST be an undefined check, never
    // a falsy check. A falsy check would silently drop every GET route and make
    // the whole spec pass vacuously.
    if (method === undefined) continue;

    const where = `${label}.${handler}`;
    const handlerPath = normalize(
      (Reflect.getMetadata(PATH_METADATA, fn) as string) ?? '',
    );
    const path = [prefix, handlerPath].filter(Boolean).join('/');

    routes.push({
      label,
      prefix,
      handler,
      verb: verbOf(method, where),
      path,
      segments: parseSegments(path, where),
      order: order++,
    });
  }
  return routes;
}

const ROUTES: readonly Route[] = ALL_CONTROLLERS.flatMap((c) =>
  routesOf(c.label, c.controller),
);

/* ------------------------------------------------------------------------- */
/* Path algebra                                                               */
/* ------------------------------------------------------------------------- */

/**
 * True when some concrete request path matches BOTH routes.
 *
 * Segment-wise unification: same segment count, and at each index either both
 * are literal and equal, or at least one is a `:param` (which matches any
 * single non-empty segment).
 */
function unifiable(a: readonly Segment[], b: readonly Segment[]): boolean {
  if (a.length !== b.length) return false;
  return a.every((s, i) => {
    const t = b[i];
    if (s.kind === 'param' || t.kind === 'param') return true;
    return s.value === t.value;
  });
}

/** True when `a` is a PROPER path-prefix of `b`, compared segment-wise. */
function isProperPathPrefix(
  a: readonly string[],
  b: readonly string[],
): boolean {
  if (a.length === 0 || a.length >= b.length) return false;
  return a.every((s, i) => s === b[i]);
}

const segmentsOfPrefix = (prefix: string): string[] =>
  prefix.split('/').filter(Boolean);

/* ------------------------------------------------------------------------- */
/* The data                                                                   */
/* ------------------------------------------------------------------------- */

/**
 * THE COMPLETE REGISTERED ROUTE TABLE, sorted `"<VERB> <path>"`.
 *
 * The global `api` prefix is OMITTED — `main.ts` prepends it to everything
 * except `webhooks/paddle` and `webhooks/resend`, and that mapping is orthogonal
 * to the invariants below.
 *
 * Counted from source on 2026-08-01: **65 routes**. Cross-checked against the
 * running container's `RouterExplorer` log
 * (`docker logs ptah_license_server | grep -oE 'Mapped \{[^}]*\}' | sort -u`),
 * which also reports 65.
 *
 * ⚠️ 65, NOT 64. The plan's prose says "64 routes before, 64 routes after"
 * (restructure-plan.md §2), but its own §2.3 per-prefix table sums to 65 and so
 * does the router log. The prose figure is an off-by-one; the table and the
 * running server agree with each other and with this list.
 *
 * ⚠️ THIS IS A LIST, NOT A COUNT, ON PURPOSE. A count tells you the surface
 * changed; a list tells you WHICH route appeared, vanished or moved, in the
 * failure diff, in review, before it ships. Any change to the server's HTTP
 * surface must show up as a diff HERE.
 */
const EXPECTED_ROUTES: readonly string[] = [
  'DELETE v1/admin/groups/:id/members/:userId',
  'DELETE v1/admin/packs/:id',
  'DELETE v1/admin/sessions/:eventId',
  'DELETE v1/admin/users/:id',
  'GET health',
  'GET resubscribe/:token',
  'GET unsubscribe/:token',
  'GET v1/admin/community/review-queue',
  'GET v1/admin/community/topics',
  'GET v1/admin/groups',
  'GET v1/admin/groups/:id/members',
  'GET v1/admin/marketing/segments',
  'GET v1/admin/packs',
  'GET v1/admin/packs/:id',
  'GET v1/admin/records/:model',
  'GET v1/admin/records/:model/:id',
  'GET v1/admin/sessions',
  'GET v1/admin/stats',
  'GET v1/admin/users/:id/deletion-preview',
  'GET v1/auth/callback',
  'GET v1/auth/login',
  'GET v1/auth/me',
  'GET v1/auth/oauth/:provider',
  'GET v1/auth/verify',
  'GET v1/community/summary',
  'GET v1/events/health',
  'GET v1/events/subscribe',
  'GET v1/licenses/me',
  'GET v1/members/sessions',
  'GET v1/sessions/eligibility',
  'GET v1/sso/discourse',
  'GET v1/subscriptions/checkout-info',
  'GET v1/subscriptions/status',
  'PATCH v1/admin/groups/:id',
  'PATCH v1/admin/packs/:id',
  'PATCH v1/admin/records/:model/:id',
  'PATCH v1/admin/sessions/:eventId',
  'POST unsubscribe/:token',
  'POST v1/admin/groups',
  'POST v1/admin/groups/:id/assign',
  'POST v1/admin/licenses/complimentary',
  'POST v1/admin/marketing/send',
  'POST v1/admin/marketing/templates',
  'POST v1/admin/packs',
  'POST v1/admin/sessions',
  'POST v1/admin/users/bulk-email',
  'POST v1/admin/waitlist/invite',
  'POST v1/auth/login/email',
  'POST v1/auth/logout',
  'POST v1/auth/magic-link',
  'POST v1/auth/resend-verification',
  'POST v1/auth/signup',
  'POST v1/auth/stream/ticket',
  'POST v1/auth/verify-email',
  'POST v1/contact',
  'POST v1/integrations/licenses',
  'POST v1/licenses/me/reveal-key',
  'POST v1/licenses/verify',
  'POST v1/sessions/request',
  'POST v1/subscriptions/portal-session',
  'POST v1/subscriptions/reconcile',
  'POST v1/subscriptions/validate-checkout',
  'POST v1/waitlist',
  'POST webhooks/paddle',
  'POST webhooks/resend',
];

/**
 * RI-1 exceptions — controllers excused from prefix disjointness, expressed as
 * DATA so the reason travels with the exception and the exception itself is
 * asserted (same shape as `controller-validation.spec.ts`'s `EXCLUDED`).
 *
 * This is for PERMANENT, designed exceptions only. Temporary debt goes in
 * `KNOWN_PREFIX_DEBT` below, which has a staleness guard this list cannot have.
 */
const PREFIX_EXCEPTIONS: ReadonlyArray<{
  readonly label: string;
  readonly prefix: string;
  readonly reason: string;
}> = [
  {
    label: 'marketing/PublicMarketingController',
    prefix: '',
    reason:
      'The empty prefix is trivially a path-prefix of every other controller, so it can ' +
      'never satisfy RI-1 — but it DOES satisfy RI-2, which is the invariant that ' +
      'actually decides whether a request reaches the wrong handler. It keeps the empty ' +
      'prefix because `/api/unsubscribe/:token` is generated into OUTBOUND MARKETING ' +
      'EMAIL (marketing/services/marketing.service.ts:348). Those links sit in ' +
      "recipients' inboxes indefinitely and a sent email cannot be updated. Under a hard " +
      'cutover with no alias, versioning this prefix silently breaks unsubscribe — a ' +
      'deliverability and CAN-SPAM/RFC-8058 problem, not a cosmetic one.',
  },
];

/**
 * RI-1 debt — prefix violations that EXIST TODAY and have a named owner.
 *
 * ⚠️ **EMPTY, AND THAT IS THE POINT OF THIS TASK.** This ledger was seeded with
 * ten entries, all owned by one controller: `license/AdminController` was
 * `@Controller('v1/admin')`, a proper path-prefix of every `v1/admin/*` sibling.
 * It was never a dashboard route at all — it is a MACHINE/OPS integration
 * authenticated by an `x-api-key` header (`AdminApiKeyGuard`), not by an admin's
 * session cookie, and the URL made two different trust models look like
 * neighbours.
 *
 * All ten were closed by R3 in one move: the controller became
 * `license/IntegrationLicensesController` at `v1/integrations/licenses`, a
 * prefix that is disjoint from every other in the server. There is nothing left
 * to list — no controller prefix now shadows another anywhere.
 *
 * They were prefix-SHAPE violations only: `POST v1/admin/licenses` never
 * CONTESTED a sibling route (RI-2 was already clean), because no sibling
 * declared a 3-segment POST that unified with it. R3 was therefore a
 * legibility fix, not a bug fix — which is exactly why it needed a ledger to
 * force it, rather than an outage.
 *
 * The mechanism is retained rather than deleted, un-rottable in both directions
 * exactly like `controller-validation.spec.ts`'s `UNVALIDATED_DEBT`:
 *   listed but no longer violating -> the staleness assertion fails
 *   violating but not listed       -> the main assertion fails
 * so the next contributor who nests one controller's prefix inside another has
 * to write the line — and justify it in review — instead of quietly restoring
 * the shape.
 */
const KNOWN_PREFIX_DEBT: readonly string[] = [];

/**
 * RI-2 debt — cross-controller route contests that EXIST TODAY.
 *
 * ⚠️ **EMPTY, AND THAT IS THE POINT OF THIS TASK.** This ledger was seeded with
 * the ten contests measured in restructure-plan.md §1, every one of them
 * arbitrated by `app.module.ts`'s array order:
 *
 *   GET   v1/admin/:model      vs  GET   v1/admin/{sessions,groups,packs}
 *   GET   v1/admin/:model/:id  vs  GET   v1/admin/{community/topics,
 *                                       community/review-queue,
 *                                       marketing/segments, packs/:id}
 *   PATCH v1/admin/:model/:id  vs  PATCH v1/admin/{packs/:id, groups/:id,
 *                                       sessions/:eventId}
 *
 * All ten were closed by R2 in one move: the three wildcards left the bare
 * `v1/admin` prefix for `v1/admin/records`, a literal segment owned exclusively
 * by `AdminRecordsController`. There is nothing left to list.
 *
 * The mechanism is retained rather than deleted, with both guard directions
 * live, so the next contributor who introduces a contest has to write the line
 * — and justify it in review — instead of shipping a wrong-handler bug.
 */
const KNOWN_CONTESTED: readonly string[] = [];

/* ------------------------------------------------------------------------- */

describe("Route map — the server's HTTP surface and its routing invariants", () => {
  describe('EXPECTED_ROUTES — the whole surface, as data', () => {
    it('the registered route table is exactly what is written down', () => {
      const actual = ROUTES.map((r) => `${r.verb} ${r.path}`).sort();

      // toEqual on sorted arrays: the failure diff NAMES the route that
      // appeared, vanished or moved. A count could not.
      expect(actual).toEqual([...EXPECTED_ROUTES].sort());
    });

    it('no two handlers declare the same verb+path', () => {
      const seen = new Map<string, string[]>();
      for (const r of ROUTES) {
        const key = `${r.verb} ${r.path}`;
        seen.set(key, [...(seen.get(key) ?? []), `${r.label}.${r.handler}`]);
      }
      const duplicates = [...seen.entries()]
        .filter(([, owners]) => owners.length > 1)
        .map(([key, owners]) => `${key} <- ${owners.join(' , ')}`);

      expect(duplicates).toEqual([]);
    });
  });

  describe('RI-1 — prefix disjointness', () => {
    // The human-legible design rule: "every :param segment sits under a literal
    // segment owned exclusively by one controller". RI-1 is not what decides
    // whether a request reaches the wrong handler (RI-2 is) — it is the cheap,
    // reviewable property that makes RI-2 easy to satisfy and easy to reason
    // about at a glance.
    const excused = new Set(PREFIX_EXCEPTIONS.map((e) => e.label));
    const prefixes = ALL_CONTROLLERS.map((c) => ({
      label: c.label,
      prefix: normalize(
        (Reflect.getMetadata(PATH_METADATA, c.controller) as string) ?? '',
      ),
    }));

    const violations: string[] = [];
    for (const a of prefixes) {
      for (const b of prefixes) {
        if (a.label === b.label) continue;
        if (excused.has(a.label) || excused.has(b.label)) continue;
        if (a.prefix === b.prefix) {
          // Emit once per unordered pair.
          if (a.label < b.label) {
            violations.push(
              `${a.label} == ${b.label} @ ${a.prefix} (IDENTICAL PREFIX)`,
            );
          }
          continue;
        }
        if (
          isProperPathPrefix(
            segmentsOfPrefix(a.prefix),
            segmentsOfPrefix(b.prefix),
          )
        ) {
          violations.push(
            `${a.label} @ ${a.prefix}  <  ${b.label} @ ${b.prefix}`,
          );
        }
      }
    }
    violations.sort();

    it('no controller prefix is identical to, or a proper path-prefix of, another', () => {
      const unexpected = violations.filter(
        (v) => !KNOWN_PREFIX_DEBT.includes(v),
      );

      expect(unexpected).toEqual([]);
    });

    it('KNOWN_PREFIX_DEBT contains no stale entry (delete the line once it is fixed)', () => {
      const stale = KNOWN_PREFIX_DEBT.filter((k) => !violations.includes(k));

      expect(stale).toEqual([]);
    });

    it.each(PREFIX_EXCEPTIONS.map((e) => [e.label, e] as const))(
      '%s is still excused for the prefix it was excused for, with a reason',
      (label, exception) => {
        const entry = prefixes.find((p) => p.label === label);

        // The exception cannot outlive its subject: if the controller is gone,
        // or has moved to a different prefix, the excuse must be re-justified.
        expect({
          found: entry !== undefined,
          prefix: entry?.prefix,
          reasonLength: exception.reason.length > 80,
        }).toEqual({
          found: true,
          prefix: exception.prefix,
          reasonLength: true,
        });
      },
    );
  });

  describe('RI-2 — no cross-controller route contest', () => {
    // ⚠️ THE LOAD-BEARING INVARIANT. Nest arbitrates a cross-controller tie by
    // module registration order, so a contest is not an error — it is a WRONG
    // HANDLER, chosen by an array literal in app.module.ts. This is the exact
    // defect TASK_2026_170 exists to close, and this is the assertion that
    // replaces `admin-guards.spec.ts`'s deleted G3 ("registers PacksModule
    // before AdminModule"): G3 froze one arbitrary array ordering, this asserts
    // the property G3 was only ever a proxy for.
    const violations: string[] = [];
    for (let i = 0; i < ROUTES.length; i++) {
      for (let j = i + 1; j < ROUTES.length; j++) {
        const a = ROUTES[i];
        const b = ROUTES[j];
        if (a.label === b.label) continue;
        if (a.verb !== b.verb) continue;
        if (!unifiable(a.segments, b.segments)) continue;

        const left = `${a.verb} ${a.path} [${a.label}.${a.handler}]`;
        const right = `${b.verb} ${b.path} [${b.label}.${b.handler}]`;
        violations.push(
          left < right ? `${left}  X  ${right}` : `${right}  X  ${left}`,
        );
      }
    }
    violations.sort();

    it('no two routes on different controllers can match the same concrete path', () => {
      const unexpected = violations.filter((v) => !KNOWN_CONTESTED.includes(v));

      expect(unexpected).toEqual([]);
    });

    it('KNOWN_CONTESTED contains no stale entry (delete the line once it is fixed)', () => {
      const stale = KNOWN_CONTESTED.filter((k) => !violations.includes(k));

      expect(stale).toEqual([]);
    });
  });

  describe('RI-3 — intra-controller specificity ordering', () => {
    // The executable form of the "route ordering: MUST be declared BEFORE"
    // comments that used to litter admin.controller.ts. WITHIN one controller,
    // Nest matches in declaration order, so if two same-verb routes unify, the
    // more specific one (fewer :param segments) must come first — otherwise the
    // wildcard swallows the literal.
    //
    // NOTE this currently finds zero unifiable pairs anywhere in the server:
    // the only one that ever existed (`GET stats` vs `GET :model` on the old
    // AdminController) was dissolved by the R2 split into two classes on two
    // prefixes. The assertion is therefore vacuous TODAY and is kept for the
    // day it is not — which is precisely why the `unifiable()` self-test in
    // anti-vacuity below is not optional.
    const paramCount = (r: Route): number =>
      r.segments.filter((s) => s.kind === 'param').length;

    const violations: string[] = [];
    for (const { label } of ALL_CONTROLLERS) {
      const routes = ROUTES.filter((r) => r.label === label);
      for (let i = 0; i < routes.length; i++) {
        for (let j = i + 1; j < routes.length; j++) {
          const first = routes[i];
          const later = routes[j];
          if (first.verb !== later.verb) continue;
          if (!unifiable(first.segments, later.segments)) continue;
          if (paramCount(first) > paramCount(later)) {
            violations.push(
              `${label}: ${first.verb} ${first.path} (${first.handler}, declared #${first.order}) ` +
                `shadows the more specific ${later.verb} ${later.path} ` +
                `(${later.handler}, declared #${later.order}) — swap them`,
            );
          }
        }
      }
    }

    it('a wildcard is never declared before a route it would shadow', () => {
      expect(violations.sort()).toEqual([]);
    });
  });

  describe('anti-vacuity — the enumerator and the unifier actually work', () => {
    // Every assertion above is of the form "the set of violations is empty".
    // All of them pass trivially if the enumerator finds no routes or the
    // unifier never returns true. These tests make that impossible.
    it('discovered at least one route for every controller in the registry', () => {
      const barren = ALL_CONTROLLERS.filter(
        (c) => !ROUTES.some((r) => r.label === c.label),
      ).map((c) => c.label);

      expect(barren).toEqual([]);
    });

    it(`discovered exactly ${EXPECTED_ROUTES.length} routes`, () => {
      expect(ROUTES.length).toBe(EXPECTED_ROUTES.length);
    });

    it('the segment parser REJECTS forms that would make the analysis unsound', () => {
      // If any of these silently parsed, RI-2 would compute "no contest" for
      // paths that genuinely contest, and every assertion above would still be
      // green. Rejecting loudly is the only safe behaviour.
      expect(() => parseSegments('v1/admin/*', 'probe')).toThrow(
        /unsupported segment form/,
      );
      expect(() => parseSegments('v1/admin/:id?', 'probe')).toThrow(
        /unsupported param segment/,
      );
      expect(() => parseSegments('v1/admin/{id}', 'probe')).toThrow(
        /unsupported segment form/,
      );
      expect(() => parseSegments('v1/admin/:id(\\d+)', 'probe')).toThrow(
        /unsupported param segment/,
      );

      // …and ACCEPTS the two forms that do exist.
      expect(parseSegments('v1/admin/records/:model/:id', 'probe')).toEqual([
        { kind: 'literal', value: 'v1' },
        { kind: 'literal', value: 'admin' },
        { kind: 'literal', value: 'records' },
        { kind: 'param' },
        { kind: 'param' },
      ]);
    });

    it('unifiable() agrees with a hand-computed table', () => {
      const p = (s: string): Segment[] => parseSegments(s, 'probe');
      const cases: ReadonlyArray<readonly [string, string, boolean]> = [
        // The exact defect this task closes.
        ['v1/admin/:model', 'v1/admin/packs', true],
        ['v1/admin/:model/:id', 'v1/admin/packs/:id', true],
        ['v1/admin/:model/:id', 'v1/admin/community/topics', true],
        // Fixed by moving the wildcard under a literal this controller owns.
        ['v1/admin/records/:model', 'v1/admin/packs', false],
        ['v1/admin/records/:model/:id', 'v1/admin/packs/:id', false],
        ['v1/admin/records/:model/:id', 'v1/admin/community/topics', false],
        // Different segment counts never unify.
        ['v1/admin/:model', 'v1/admin/packs/:id', false],
        ['v1/admin/licenses', 'v1/admin/licenses/complimentary', false],
        // Distinct literals never unify; identical ones always do.
        ['v1/admin/stats', 'v1/admin/packs', false],
        ['v1/admin/stats', 'v1/admin/stats', true],
        // A param matches any single segment, on either side.
        ['v1/admin/users/:id', 'v1/admin/users/bulk-email', true],
      ];

      const actual = cases.map(
        ([a, b]) => [a, b, unifiable(p(a), p(b))] as const,
      );

      expect(actual).toEqual(cases);
    });

    it('isProperPathPrefix() compares SEGMENTS, not characters', () => {
      const s = segmentsOfPrefix;
      // The character-wise trap: 'v1/admin' is a string prefix of
      // 'v1/administrators' but not a path prefix of it.
      expect(isProperPathPrefix(s('v1/admin'), s('v1/administrators'))).toBe(
        false,
      );
      expect(isProperPathPrefix(s('v1/admin'), s('v1/admin/records'))).toBe(
        true,
      );
      // Not PROPER: a prefix is not a proper prefix of itself.
      expect(isProperPathPrefix(s('v1/admin'), s('v1/admin'))).toBe(false);
      expect(isProperPathPrefix(s('v1/admin/records'), s('v1/admin'))).toBe(
        false,
      );
    });
  });
});
