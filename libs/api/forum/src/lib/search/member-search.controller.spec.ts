// ⚠️ FIRST IMPORT. `SearchQueryDto` carries `class-validator` /
// `class-transformer` decorators that call `Reflect.getMetadata`, and this lib's
// `jest.config.cts` has NO `setupFiles`. Without it the file fails to LOAD.
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA, PATH_METADATA } from '@nestjs/common/constants';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard, type MemberContext } from '@ptah-api/membership';

import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
} from '../../testing/controller-reflection';
import { MemberCommunityController } from '../topics/member-community.controller';

import { MemberSearchController } from './member-search.controller';
import { SearchQueryDto } from './dto/search.query.dto';
import type { SearchService } from './search.service';

/**
 * `MemberSearchController` — `GET /api/v1/members/search` (R1.7, §3.3).
 *
 * The search SERVICE already carries 32 tests, including the ones that matter
 * most here: the term is bound as a SQL PARAMETER, LIKE metacharacters are
 * escaped, and visibility is a `WHERE` clause inside the query rather than a
 * post-filter. This file asserts the things only the decorator surface can be
 * wrong about — the guard chain, the whole-object binding, and the RI-1 prefix
 * relationship with its sibling controller.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: ['founding'],
  isAdmin: false,
};

function harness(): {
  controller: MemberSearchController;
  search: { search: jest.Mock };
} {
  const search = {
    search: jest.fn().mockResolvedValue({ topics: {}, posts: {}, lessons: {} }),
  };
  return {
    controller: new MemberSearchController(search as unknown as SearchService),
    search,
  };
}

const memberRequest = (): Request => asRequest(CTX);

/**
 * ⚠️ A SEPARATE FUNCTION, NOT `memberRequest(undefined)`. A default parameter
 * fires on an explicitly-passed `undefined`, which would have handed the
 * "guard removed" case the happy-path context and made the tripwire test below
 * assert the opposite of its name.
 */
const unguardedRequest = (): Request => asRequest(undefined);

function asRequest(ctx: MemberContext | undefined): Request {
  return {
    memberContext: ctx,
    method: 'GET',
    path: '/api/v1/members/search',
  } as unknown as Request;
}

describe('MemberSearchController', () => {
  describe('RI-1 — a disjoint depth-3 literal sibling', () => {
    const prefix = Reflect.getMetadata(
      PATH_METADATA,
      MemberSearchController,
    ) as string;
    const communityPrefix = Reflect.getMetadata(
      PATH_METADATA,
      MemberCommunityController,
    ) as string;

    it('is mounted at v1/members/search', () => {
      expect(prefix).toBe('v1/members/search');
    });

    it('is neither a path-prefix of, nor prefixed by, the community controller', () => {
      // RI-1 rejects a prefix relationship in EITHER direction, and both
      // ledgers it could be excused through (`PREFIX_EXCEPTIONS`,
      // `KNOWN_PREFIX_DEBT`) are empty arrays at HEAD — that emptiness is the
      // current invariant, not an accident.
      expect(prefix.startsWith(`${communityPrefix}/`)).toBe(false);
      expect(communityPrefix.startsWith(`${prefix}/`)).toBe(false);
      expect(prefix).not.toBe(communityPrefix);
    });

    it('declares no parameter at segment 3', () => {
      expect(prefix.split('/')).toHaveLength(3);
      expect(prefix.split('/').filter((s) => s.startsWith(':'))).toEqual([]);
    });

    it('declares exactly one route: GET v1/members/search', () => {
      const routes = handlersOf(MemberSearchController).map((handler) => {
        const { verb, path } = routeOf(MemberSearchController, handler);
        return `${verb} ${path}`;
      });

      expect(routes).toEqual(['GET v1/members/search']);
    });
  });

  describe('the guard chain', () => {
    it('declares JwtAuthGuard then MemberGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          MemberSearchController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(MemberGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(MemberGuard),
      );
    });
  });

  describe('PRE-1 / RISK-I — the one query param', () => {
    const args = routeArgs(MemberSearchController, 'searchAll');
    const query = args.find((arg) => arg.paramtype === ROUTE_PARAMTYPES.QUERY);

    it('exists (anti-vacuity)', () => {
      expect(query).toBeDefined();
    });

    it('is a WHOLE-OBJECT bind, never @Query("q")', () => {
      // `data` holds the key name for a named param and is `undefined` for a
      // whole-object bind. `NAMED_PRIMITIVE_PARAM_COUNT = 6` is asserted by
      // exact equality in the server, so `@Query('q') q: string` here would
      // fail a build in a different project.
      expect(query?.data).toBeUndefined();
    });

    it('binds a ValidationPipe carrying SearchQueryDto as its expectedType', () => {
      const bound = query?.pipes.find(
        (pipe): pipe is ValidationPipe => pipe instanceof ValidationPipe,
      ) as (ValidationPipe & { expectedType?: unknown }) | undefined;

      // The DTO class itself, not merely "a ValidationPipe": under esbuild the
      // global pipe short-circuits on a missing metatype, so `expectedType` is
      // the ONLY thing making `@MinLength(2)` on `q` and `@Max(50)` on
      // `pageSize` do anything at all.
      expect(bound?.expectedType).toBe(SearchQueryDto);
    });
  });

  describe('delegation', () => {
    it('hands the guard-resolved context and the whole DTO to the service', async () => {
      const { controller, search } = harness();
      const query = { q: 'ptah', page: 2 };

      await controller.searchAll(memberRequest(), query);

      // R7.3 — the cohort keys come from the guard's single resolution. The
      // service builds its visibility `IN` list from exactly this object.
      expect(search.search).toHaveBeenCalledWith(CTX, query);
    });

    it('does not re-default the query (resolveSearchQuery owns that)', async () => {
      const { controller, search } = harness();

      await controller.searchAll(memberRequest(), { q: 'ptah' });

      expect(search.search).toHaveBeenCalledWith(CTX, { q: 'ptah' });
    });

    it('re-derives membership NOWHERE', () => {
      const source = readFileSync(
        join(__dirname, 'member-search.controller.ts'),
        'utf8',
      );

      // Import statements and injections, not raw substrings — the docblock
      // names both in prose (G6's idiom, same reason).
      expect(/import\s[^;]*\bMembershipService\b[^;]*from/.test(source)).toBe(
        false,
      );
      expect(/import\s[^;]*\bCohortResolver\b[^;]*from/.test(source)).toBe(
        false,
      );
    });
  });

  describe('the removed-guard tripwire', () => {
    it('refuses rather than searching with no visibility context', async () => {
      const { controller, search } = harness();

      await expect(
        controller.searchAll(unguardedRequest(), { q: 'ptah' }),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      // Searching with an undefined context is the worst version of this bug:
      // the visibility `IN` list would be built from nothing and the natural
      // failure mode of "no categories" is an `IN ()`, which is a Postgres
      // syntax error — a 500 that looks like a database fault rather than a
      // missing guard.
      expect(search.search).not.toHaveBeenCalled();
    });
  });
});
