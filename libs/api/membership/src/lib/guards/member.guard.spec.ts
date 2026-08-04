import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';
import { CohortResolver } from '../cohort-resolver.service';
import { MembershipService } from '../membership.service';
import { MEMBERSHIP_REQUIRED } from '../membership.types';
import { MemberGuard } from './member.guard';

/**
 * Unit tests for `MemberGuard` — the single server-side enforcement point for
 * the `/members` surface (NFR-S8).
 *
 * Strategy: hand-rolled collaborators plus a minimal `ExecutionContext` over a
 * plain request object, so the assertions are about the guard's decision and
 * the context it attaches, not about Nest's DI.
 */

interface MockRequest extends Partial<Request> {
  method: string;
  path: string;
}

function createContext(request: MockRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: <T>() => request as unknown as T }),
  } as unknown as ExecutionContext;
}

/** A `req.user` of the shape `JwtAuthGuard` attaches. */
function authenticated(
  id: string,
  email = 'member@example.com',
): MockRequest['user'] {
  return {
    id,
    email,
    tenantId: 'tenant_1',
    roles: [],
    permissions: [],
    tier: 'builders',
  };
}

interface Harness {
  guard: MemberGuard;
  membership: { isBuildersMember: jest.Mock };
  cohorts: { resolveCohortKeys: jest.Mock };
}

function createGuard(
  opts: {
    entitled?: boolean;
    cohortKeys?: readonly string[];
    adminEmails?: string | undefined;
  } = {},
): Harness {
  const membership = {
    isBuildersMember: jest.fn().mockResolvedValue(opts.entitled ?? true),
  };
  const cohorts = {
    resolveCohortKeys: jest.fn().mockResolvedValue(opts.cohortKeys ?? []),
  };
  const config = {
    get: jest.fn().mockReturnValue(opts.adminEmails),
  };

  const guard = new MemberGuard(
    membership as unknown as MembershipService,
    cohorts as unknown as CohortResolver,
    config as unknown as ConfigService,
  );
  jest
    .spyOn(
      (guard as unknown as { logger: { warn: (m: string) => void } }).logger,
      'warn',
    )
    .mockImplementation(() => undefined);

  return { guard, membership, cohorts };
}

describe('MemberGuard', () => {
  describe('allow', () => {
    it('entitled member WITH cohorts → allowed, context carries the keys', async () => {
      const { guard } = createGuard({
        entitled: true,
        cohortKeys: ['founding', 'arabic'],
      });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_1'),
      };

      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(request.memberContext).toEqual({
        userId: 'usr_1',
        email: 'member@example.com',
        entitled: true,
        cohortKeys: ['founding', 'arabic'],
        isAdmin: false,
      });
    });

    it('R7.8: entitled member with NO cohorts → allowed, cohortKeys is []', async () => {
      const { guard } = createGuard({ entitled: true, cohortKeys: [] });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_2'),
      };

      // The A-2 edge at the enforcement point: an admin forgetting to place a
      // paying member in a cohort must NOT deny them the panel. Empty cohorts
      // allow the request; they only narrow what content matches later.
      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(request.memberContext?.cohortKeys).toEqual([]);
      expect(request.memberContext?.entitled).toBe(true);
    });

    it('resolves entitlement and cohorts EXACTLY ONCE per request (R7.3)', async () => {
      const { guard, membership, cohorts } = createGuard({
        entitled: true,
        cohortKeys: ['founding'],
      });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_3'),
      };

      await guard.canActivate(createContext(request));

      // The context exists so no downstream service re-derives either value.
      expect(membership.isBuildersMember).toHaveBeenCalledTimes(1);
      expect(membership.isBuildersMember).toHaveBeenCalledWith('usr_3');
      expect(cohorts.resolveCohortKeys).toHaveBeenCalledTimes(1);
      expect(cohorts.resolveCohortKeys).toHaveBeenCalledWith('usr_3');
    });
  });

  describe('deny', () => {
    it('not entitled → 403 with the exact { reason: "membership_required" } body', async () => {
      const { guard, cohorts } = createGuard({ entitled: false });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_4'),
      };

      const rejection = guard.canActivate(createContext(request));

      await expect(rejection).rejects.toBeInstanceOf(ForbiddenException);
      await expect(rejection).rejects.toMatchObject({
        response: { reason: MEMBERSHIP_REQUIRED },
      });
      // The literal the frontend parses — asserted as a string, not via the
      // constant alone, so renaming the constant cannot silently change the
      // wire contract `isMembershipRequiredError()` depends on.
      expect(MEMBERSHIP_REQUIRED).toBe('membership_required');

      // Denied before any cohort work: cohorts can never influence the gate.
      expect(cohorts.resolveCohortKeys).not.toHaveBeenCalled();
      expect(request.memberContext).toBeUndefined();
    });

    it('no JWT user → 403, and entitlement is never even queried', async () => {
      const { guard, membership } = createGuard();
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(membership.isBuildersMember).not.toHaveBeenCalled();
      expect(request.memberContext).toBeUndefined();
    });

    it('an ADMIN who is not a member is denied like anyone else', async () => {
      // The security invariant: admin is a separate authorized path, never a
      // loosening of the member gate. Being on ADMIN_EMAILS must not grant a
      // member entitlement.
      const { guard } = createGuard({
        entitled: false,
        adminEmails: 'boss@example.com',
      });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_admin', 'boss@example.com'),
      };

      await expect(
        guard.canActivate(createContext(request)),
      ).rejects.toMatchObject({ response: { reason: MEMBERSHIP_REQUIRED } });
    });
  });

  describe('isAdmin — informational only', () => {
    it('flags an entitled member who is also on ADMIN_EMAILS (case-insensitive)', async () => {
      const { guard } = createGuard({
        entitled: true,
        adminEmails: ' Boss@Example.com , other@example.com ',
      });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_5', 'boss@example.com'),
      };

      await guard.canActivate(createContext(request));

      expect(request.memberContext?.isAdmin).toBe(true);
    });

    it('is false when ADMIN_EMAILS is unset — and that does NOT block the member', async () => {
      const { guard } = createGuard({ entitled: true, adminEmails: undefined });
      const request: MockRequest = {
        method: 'GET',
        path: '/api/v1/members/hub',
        user: authenticated('usr_6'),
      };

      // AdminGuard fail-closes loudly on unset ADMIN_EMAILS because it is
      // AUTHORIZING. This flag authorizes nothing, so "no allowlist" simply
      // means "nobody is flagged" and the member still gets in.
      await expect(guard.canActivate(createContext(request))).resolves.toBe(
        true,
      );
      expect(request.memberContext?.isAdmin).toBe(false);
    });
  });
});
