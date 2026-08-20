import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import type { CohortResolver, MembershipService } from '@ptah-api/membership';
import type { CohortBadgesService } from './cohort-badges.service';
import { MemberEntitlementController } from './member-entitlement.controller';

/**
 * Unit tests for the entitlement probe.
 *
 * The three cases named in plan §3.2 / R7.7 are the point of this file:
 *
 *   unauthenticated             -> 401  (JwtAuthGuard, asserted structurally)
 *   authenticated non-member    -> 200 { entitled: false }   NEVER 403
 *   entitled with zero cohorts  -> 200 { entitled: true, cohorts: [] }
 *
 * The 401 is the guard's job, not the handler's, so it is asserted as a
 * DECORATOR property rather than by faking an unauthenticated request through a
 * handler the guard would never have reached. Testing it any other way would
 * assert that the handler copes with a state Nest guarantees it never sees,
 * while leaving the actual mechanism — the guard being declared at all —
 * unchecked. Removing `@UseGuards(JwtAuthGuard)` turns a 401 into a 200, and
 * that is what the assertion below catches.
 */

function authenticatedRequest(
  user: { id: string; email: string } | undefined,
): Request {
  return { user } as unknown as Request;
}

interface Harness {
  controller: MemberEntitlementController;
  membership: { isBuildersMember: jest.Mock };
  cohorts: { resolveCohortKeys: jest.Mock };
  badges: { resolveBadges: jest.Mock };
}

function createController(
  opts: {
    entitled?: boolean;
    cohortKeys?: readonly string[];
    badges?: { key: string; name: string }[];
    adminEmails?: string | undefined;
  } = {},
): Harness {
  const membership = {
    isBuildersMember: jest.fn().mockResolvedValue(opts.entitled ?? true),
  };
  const cohorts = {
    resolveCohortKeys: jest.fn().mockResolvedValue(opts.cohortKeys ?? []),
  };
  const badges = {
    resolveBadges: jest.fn().mockResolvedValue(opts.badges ?? []),
  };
  const config = { get: jest.fn().mockReturnValue(opts.adminEmails) };

  const controller = new MemberEntitlementController(
    membership as unknown as MembershipService,
    cohorts as unknown as CohortResolver,
    badges as unknown as CohortBadgesService,
    config as unknown as ConfigService,
  );

  return { controller, membership, cohorts, badges };
}

describe('MemberEntitlementController — GET /v1/members/entitlement', () => {
  describe('the three states the frontend guard must tell apart (R7.7)', () => {
    it('unauthenticated -> 401: the handler is guarded by JwtAuthGuard', () => {
      // Nest stores the guards applied to a handler under `__guards__`.
      const guards = Reflect.getMetadata(
        '__guards__',
        MemberEntitlementController.prototype.getEntitlement,
      ) as Array<{ name: string }> | undefined;

      expect((guards ?? []).map((g) => g.name)).toEqual(['JwtAuthGuard']);
    });

    it('DOES NOT apply MemberGuard — a non-member must get 200, not 403', () => {
      // The deliberate asymmetry with every other member controller. If
      // MemberGuard ever appears here, a logged-in non-member receives
      // `403 { reason: 'membership_required' }` and the frontend guard can no
      // longer distinguish them from a genuine failure — R7.7's exact
      // prohibition, and a silent one, since the endpoint still "works".
      const classGuards = (Reflect.getMetadata(
        '__guards__',
        MemberEntitlementController,
      ) ?? []) as Array<{ name: string }>;
      const handlerGuards = (Reflect.getMetadata(
        '__guards__',
        MemberEntitlementController.prototype.getEntitlement,
      ) ?? []) as Array<{ name: string }>;

      expect(
        [...classGuards, ...handlerGuards].map((g) => g.name),
      ).not.toContain('MemberGuard');
    });

    it('authenticated NON-MEMBER -> 200 { entitled: false }, never a throw', async () => {
      const { controller, cohorts } = createController({ entitled: false });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_2', email: 'lapsed@example.com' }),
      );

      expect(body).toEqual({ entitled: false, cohorts: [], isAdmin: false });
      // Cheap by construction: a non-member's cohorts are never read.
      expect(cohorts.resolveCohortKeys).not.toHaveBeenCalled();
    });

    it('ENTITLED WITH NO COHORTS -> 200 { entitled: true, cohorts: [] } (R7.8, A-2)', async () => {
      // The live default: member_group_assignments is empty, so this is what
      // every real account returns today. `cohorts: []` is a success, not an
      // error path — conflating entitlement with cohort here would lock every
      // paying member out of the product.
      const { controller } = createController({
        entitled: true,
        cohortKeys: [],
        badges: [],
      });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_1', email: 'member@example.com' }),
      );

      expect(body).toEqual({ entitled: true, cohorts: [], isAdmin: false });
    });

    it('ENTITLED WITH COHORTS -> the badges are named, in key order', async () => {
      const { controller, badges } = createController({
        entitled: true,
        cohortKeys: ['founding'],
        badges: [{ key: 'founding', name: 'Founding Members' }],
      });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_1', email: 'member@example.com' }),
      );

      expect(body).toEqual({
        entitled: true,
        cohorts: [{ key: 'founding', name: 'Founding Members' }],
        isAdmin: false,
      });
      expect(badges.resolveBadges).toHaveBeenCalledWith(['founding']);
    });
  });

  describe('isAdmin is ORTHOGONAL to entitled (R7.4)', () => {
    // The same case table `member.guard.spec.ts` runs against `MemberGuard`'s
    // own private copy of this parse. Both copies exist because the probe
    // deliberately does not run the guard; pinning them to one table is the
    // control that keeps them agreeing until the shared `isAdminEmail()` helper
    // this comment argues for actually lands.
    const CASES: ReadonlyArray<
      readonly [
        label: string,
        adminEmails: string | undefined,
        email: string,
        expected: boolean,
      ]
    > = [
      ['listed', 'admin@example.com', 'admin@example.com', true],
      [
        'listed, different case',
        'Admin@Example.com',
        'admin@EXAMPLE.com',
        true,
      ],
      [
        'listed among several, padded',
        ' a@x.com , admin@example.com ',
        'admin@example.com',
        true,
      ],
      ['not listed', 'someone@example.com', 'admin@example.com', false],
      ['ADMIN_EMAILS unset', undefined, 'admin@example.com', false],
      ['ADMIN_EMAILS blank', '   ', 'admin@example.com', false],
      ['ADMIN_EMAILS separators only', ',,,', 'admin@example.com', false],
    ];

    it.each(CASES)('%s -> %s', async (_label, adminEmails, email, expected) => {
      const { controller } = createController({ entitled: false, adminEmails });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_3', email }),
      );

      expect(body.isAdmin).toBe(expected);
    });

    it('an admin who never bought Builders is { entitled: false, isAdmin: true }', async () => {
      const { controller } = createController({
        entitled: false,
        adminEmails: 'admin@example.com',
      });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_3', email: 'admin@example.com' }),
      );

      expect(body).toEqual({ entitled: false, cohorts: [], isAdmin: true });
    });

    it('being an admin never turns entitlement on', async () => {
      const { controller, membership } = createController({
        entitled: false,
        adminEmails: 'admin@example.com',
      });

      const body = await controller.getEntitlement(
        authenticatedRequest({ id: 'user_3', email: 'admin@example.com' }),
      );

      expect(body.entitled).toBe(false);
      expect(membership.isBuildersMember).toHaveBeenCalledWith('user_3');
    });
  });

  describe('defensive wiring', () => {
    it('answers { entitled: false } rather than throwing when req.user is absent', async () => {
      // Unreachable behind JwtAuthGuard. Checked so that removing the guard
      // produces a wrong-but-safe answer instead of a TypeError-shaped 500.
      const { controller, membership } = createController();

      const body = await controller.getEntitlement(
        authenticatedRequest(undefined),
      );

      expect(body).toEqual({ entitled: false, cohorts: [], isAdmin: false });
      expect(membership.isBuildersMember).not.toHaveBeenCalled();
    });

    it('resolves the admin flag through ConfigService and the SHARED allowlist, never process.env', () => {
      // Asserted on SOURCE TEXT, matching `membership.service.spec.ts`'s
      // idiom: `process.env` would still return the right value in every test
      // and in local dev, and would only diverge once config comes from
      // somewhere ConfigService knows about and the environment does not.
      // Comments stripped first — the docblocks here name `process.env` in
      // order to forbid it, and the assertion is about code.
      const source = readFileSync(
        join(__dirname, 'member-entitlement.controller.ts'),
        'utf8',
      )
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');

      // The invariant that actually matters, unchanged: config is read through
      // Nest, never off the process.
      expect(source).not.toContain('process.env');

      // This assertion USED to pin the literal `this.config.get<string>('ADMIN_EMAILS')`
      // — i.e. it required this file to parse the allowlist ITSELF. That was
      // the fifth such parse in the server, and the reason the definition of
      // "admin" could drift per surface. The invariant is now the opposite one:
      // this controller must NOT own a copy of the parse, and must delegate to
      // the single definition in `@ptah-api/identity`. Weakening this to
      // "no process.env" alone would let the private copy quietly come back.
      expect(source).not.toContain("get<string>('ADMIN_EMAILS')");
      expect(source).toContain('isAdminEmail(this.config,');
      expect(source).toMatch(
        /import\s*\{[^}]*\bisAdminEmail\b[^}]*\}\s*from\s*'@ptah-api\/identity'/,
      );
    });
  });
});
