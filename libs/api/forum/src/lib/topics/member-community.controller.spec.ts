// ⚠️ FIRST IMPORT, AND IT IS NOT OPTIONAL. `class-validator` /
// `class-transformer` decorators on the DTOs reached from here call
// `Reflect.getMetadata`, and `libs/api/forum/jest.config.cts` has NO
// `setupFiles`. Without this the whole suite fails to LOAD with
// `TypeError: Reflect.getMetadata is not a function` — not a single assertion
// fails, the file never runs.
import 'reflect-metadata';

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  InternalServerErrorException,
  RequestMethod,
  ValidationPipe,
} from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  PATH_METADATA,
} from '@nestjs/common/constants';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard, type MemberContext } from '@ptah-api/membership';
import { REACTION_TYPES } from '@ptah-contracts/community';

import type { CategoriesService } from '../categories/categories.service';
import type { AcceptedAnswerService } from '../posts/accepted-answer.service';
import type { PostsService } from '../posts/posts.service';
import type { ReactionsService } from '../reactions/reactions.service';
import type { ReadStateService } from '../read-state/read-state.service';
import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
} from '../../testing/controller-reflection';

import { MemberCommunityController } from './member-community.controller';
import type { TopicsReadService } from './topics-read.service';
import type { TopicsService } from './topics.service';

/**
 * `MemberCommunityController` — §3.3's whole member surface.
 *
 * ⚠️ WHAT THIS FILE ASSERTS, AND WHY IT IS MOSTLY STRUCTURAL.
 * A controller in this lib contains no business logic by design — every
 * visibility decision, every `403`, the edit window, the lock and the depth
 * repair live in the services and already carry 254 tests from Batch 6B.
 * Re-driving them through the controller would assert the mocks. What cannot be
 * asserted anywhere else, and what actually breaks in review, is the DECORATOR
 * surface:
 *
 *   - the guard chain exists, at CLASS level, in the right ORDER. Delete
 *     `MemberGuard` and every handler test still passes, because no handler
 *     mentions it;
 *   - every payload param binds `dtoPipe` (PRE-1) — a bare `@Body()` is
 *     silently unvalidated under esbuild and nothing at runtime says so;
 *   - no named-primitive query param exists (RISK-I) — one of those fails the
 *     build in a DIFFERENT project with a diff that names a count;
 *   - the reaction toggle is `PUT` and `:type` really is pipe-validated;
 *   - the prefix is a depth-3 LITERAL (RI-1).
 *
 * Plus the DELEGATION contract: the context comes from `req.memberContext` and
 * is never re-derived (R7.3), and a create's response is composed by the READ
 * model rather than assembled here.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

interface Doubles {
  categories: { listForMember: jest.Mock };
  topics: {
    create: jest.Mock;
    updateByAuthor: jest.Mock;
    softDelete: jest.Mock;
  };
  topicsRead: { listFeed: jest.Mock; getThread: jest.Mock; getPost: jest.Mock };
  posts: {
    createReply: jest.Mock;
    updateByAuthor: jest.Mock;
    softDelete: jest.Mock;
  };
  reactions: { toggle: jest.Mock };
  readState: { markRead: jest.Mock; markCategoryRead: jest.Mock };
  acceptedAnswer: { accept: jest.Mock; clear: jest.Mock };
}

function createHarness(): {
  controller: MemberCommunityController;
  doubles: Doubles;
} {
  const doubles: Doubles = {
    categories: { listForMember: jest.fn().mockResolvedValue([]) },
    topics: {
      create: jest
        .fn()
        .mockResolvedValue({ id: 't-1', slug: 'a-slug', firstPostId: 'p-1' }),
      updateByAuthor: jest
        .fn()
        .mockResolvedValue({ id: 't-1', slug: 'a-slug' }),
      softDelete: jest.fn().mockResolvedValue({ deleted: true }),
    },
    topicsRead: {
      listFeed: jest.fn().mockResolvedValue({ items: [] }),
      getThread: jest.fn().mockResolvedValue({ id: 't-1', slug: 'a-slug' }),
      getPost: jest.fn().mockResolvedValue({ id: 'p-2' }),
    },
    posts: {
      createReply: jest
        .fn()
        .mockResolvedValue({ id: 'p-2', topicId: 't-1', postNumber: 2 }),
      updateByAuthor: jest
        .fn()
        .mockResolvedValue({ id: 'p-2', topicId: 't-1' }),
      softDelete: jest.fn().mockResolvedValue({ deleted: true }),
    },
    reactions: {
      toggle: jest.fn().mockResolvedValue({ counts: {}, mine: [] }),
    },
    readState: {
      markRead: jest.fn().mockResolvedValue({ unreadCount: 0 }),
      markCategoryRead: jest.fn().mockResolvedValue({ topicsMarked: 3 }),
    },
    acceptedAnswer: {
      accept: jest.fn().mockResolvedValue({ acceptedPostId: 'p-2' }),
      clear: jest.fn().mockResolvedValue({ acceptedPostId: null }),
    },
  };

  const controller = new MemberCommunityController(
    doubles.categories as unknown as CategoriesService,
    doubles.topics as unknown as TopicsService,
    doubles.topicsRead as unknown as TopicsReadService,
    doubles.posts as unknown as PostsService,
    doubles.reactions as unknown as ReactionsService,
    doubles.readState as unknown as ReadStateService,
    doubles.acceptedAnswer as unknown as AcceptedAnswerService,
  );

  return { controller, doubles };
}

function memberRequest(): Request {
  return asRequest(CTX);
}

/**
 * A request as it arrives when `MemberGuard` has been REMOVED from the class.
 *
 * ⚠️ A SEPARATE FUNCTION, NOT `memberRequest(undefined)`. A default parameter
 * (`ctx = CTX`) fires on an explicitly-passed `undefined`, so the "no guard"
 * case would silently have received the happy-path context and every tripwire
 * assertion below would have been testing the opposite of its name. That is
 * exactly what happened on the first run of this file.
 */
function unguardedRequest(): Request {
  return asRequest(undefined);
}

function asRequest(ctx: MemberContext | undefined): Request {
  return {
    memberContext: ctx,
    method: 'GET',
    path: '/api/v1/members/community/topics',
  } as unknown as Request;
}

describe('MemberCommunityController', () => {
  describe('the guard chain (R7.3, NFR-S8) — the part no handler test can cover', () => {
    it('declares JwtAuthGuard then MemberGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          MemberCommunityController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(MemberGuard);
      // `JwtAuthGuard` populates `req.user`; `MemberGuard` reads it to resolve
      // entitlement. Reversed, `MemberGuard` sees no user and either 403s every
      // member or resolves against `undefined`.
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(MemberGuard),
      );
    });

    it('declares NO method-level guard that could shadow the class-level chain', () => {
      const shadowed = handlersOf(MemberCommunityController).filter(
        (handler) => {
          const fn = Object.getOwnPropertyDescriptor(
            MemberCommunityController.prototype,
            handler,
          )?.value as object;
          return (
            ((Reflect.getMetadata(GUARDS_METADATA, fn) as unknown[]) ?? [])
              .length > 0
          );
        },
      );

      expect(shadowed).toEqual([]);
    });

    it('re-derives membership NOWHERE (R7.3)', () => {
      // A property of the SOURCE, because a delegation test cannot see an
      // injection that is never reached on the happy path. `MemberContext` is
      // resolved exactly once per request, by the guard; a second derivation
      // would be a second definition of who a member is (RISK-A).
      //
      // ⚠️ ASSERTED AGAINST IMPORTS AND INJECTIONS, NOT RAW SUBSTRINGS — the
      // idiom `admin-guards.spec.ts` G6 already uses, and for the identical
      // reason: this controller's docblock names `MembershipService` and
      // `CohortResolver` in PROSE to explain why they are absent, and a naive
      // `toContain` flags that documentation as the violation. (It did, on the
      // first run of this file.)
      const source = readFileSync(
        join(__dirname, 'member-community.controller.ts'),
        'utf8',
      );

      for (const pattern of [
        /import\s[^;]*\bMembershipService\b[^;]*from/,
        /import\s[^;]*\bCohortResolver\b[^;]*from/,
        /@Inject\(\s*MembershipService\s*\)/,
        /@Inject\(\s*CohortResolver\s*\)/,
        /\.resolveCohortKeys\(/,
        /\.isBuildersMember\(/,
      ]) {
        expect({
          pattern: pattern.source,
          matched: pattern.test(source),
        }).toEqual({ pattern: pattern.source, matched: false });
      }
    });
  });

  describe('the prefix (RI-1) — a depth-3 LITERAL, never a parameter', () => {
    const prefix = Reflect.getMetadata(
      PATH_METADATA,
      MemberCommunityController,
    ) as string;

    it('is exactly v1/members/community', () => {
      expect(prefix).toBe('v1/members/community');
    });

    it('has three segments and no ":param" among them', () => {
      // `v1/members` is a proper path-prefix of five sibling controllers, so a
      // parameter at segment 3 would make this class contest `v1/members/hub`
      // itself. AD-12 removed exactly that shape and RI-1 now forbids it.
      expect(prefix.split('/')).toHaveLength(3);
      expect(prefix.split('/').filter((s) => s.startsWith(':'))).toEqual([]);
    });
  });

  describe('PRE-1 — every payload param binds a ValidationPipe carrying expectedType', () => {
    // The local mirror of
    // `apps/ptah-license-server/src/common/controller-validation.spec.ts`. That
    // spec is the build gate; this one fails FIRST, in the lib that owns the
    // file, with the handler named.
    const payloadParams = handlersOf(MemberCommunityController).flatMap(
      (handler) =>
        routeArgs(MemberCommunityController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('finds the payload params at all (anti-vacuity)', () => {
      // Every assertion below is "the set of offenders is empty" and would pass
      // trivially if the reader found nothing. EIGHT: two `@Query()`
      // (`listTopics`, `getTopic`) and six `@Body()` (`createTopic`,
      // `updateTopic`, `createPost`, `updatePost`, `acceptAnswer`, `markRead`).
      // Asserted EXACTLY rather than as a floor, so a payload param that
      // vanishes — the way a binding silently disappears when a handler is
      // rewritten — is a failure and not a quieter pass.
      expect(payloadParams).toHaveLength(8);
    });

    it('binds every one of them', () => {
      const unbound = payloadParams
        .filter(
          (param) =>
            !param.pipes.some(
              (pipe) =>
                pipe instanceof ValidationPipe &&
                (pipe as ValidationPipe & { expectedType?: unknown })
                  .expectedType !== undefined,
            ),
        )
        .map((param) => param.handler);

      expect(unbound).toEqual([]);
    });

    it('declares ZERO named-primitive query params (RISK-I)', () => {
      // `NAMED_PRIMITIVE_PARAM_COUNT = 6` in the server is asserted by EXACT
      // equality, so one `@Query('q') q: string` here fails a build in another
      // project with a diff that names a number rather than this file.
      const named = payloadParams
        .filter((param) => param.data !== undefined)
        .map((param) => `${param.handler}(${String(param.data)})`);

      expect(named).toEqual([]);
    });
  });

  describe('the route table this controller declares', () => {
    it('is exactly the §3.3 member surface', () => {
      const routes = handlersOf(MemberCommunityController)
        .map((handler) => {
          const { verb, path } = routeOf(MemberCommunityController, handler);
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual(
        [
          'GET v1/members/community/categories',
          'GET v1/members/community/topics',
          'GET v1/members/community/topics/:slug',
          'POST v1/members/community/topics',
          'PATCH v1/members/community/topics/:id',
          'DELETE v1/members/community/topics/:id',
          'POST v1/members/community/topics/:id/posts',
          'PATCH v1/members/community/posts/:id',
          'DELETE v1/members/community/posts/:id',
          'PUT v1/members/community/posts/:id/reactions/:type',
          'PUT v1/members/community/topics/:id/accepted-answer',
          'DELETE v1/members/community/topics/:id/accepted-answer',
          'POST v1/members/community/topics/:id/read',
          'POST v1/members/community/categories/:id/read-all',
        ].sort(),
      );
    });

    it('toggles a reaction with PUT, not POST (§3.3 — a retry must converge)', () => {
      expect(routeOf(MemberCommunityController, 'toggleReaction').verb).toBe(
        'PUT',
      );
    });

    it('sets the accepted answer with PUT and clears it with DELETE', () => {
      expect(routeOf(MemberCommunityController, 'acceptAnswer').verb).toBe(
        'PUT',
      );
      expect(
        routeOf(MemberCommunityController, 'clearAcceptedAnswer').verb,
      ).toBe('DELETE');
    });

    it('answers 200, not 204, on the DELETE routes that return a body', () => {
      // `{ deleted: true }` / `{ acceptedPostId: null }` are bodies, and a 204
      // MUST NOT carry one — Nest's DELETE default is 200 anyway, but
      // `@HttpCode(200)` states it so a later `@HttpCode(204)` is a visible
      // decision rather than a silently dropped response.
      for (const handler of [
        'deleteTopic',
        'deletePost',
        'clearAcceptedAnswer',
      ]) {
        const fn = Object.getOwnPropertyDescriptor(
          MemberCommunityController.prototype,
          handler,
        )?.value as object;
        expect({
          handler,
          code: Reflect.getMetadata(HTTP_CODE_METADATA, fn) as unknown,
        }).toEqual({ handler, code: 200 });
      }
    });

    it('declares no route with a verb outside the five it uses', () => {
      const verbs = new Set(
        handlersOf(MemberCommunityController).map(
          (handler) => routeOf(MemberCommunityController, handler).verb,
        ),
      );

      expect([...verbs].sort()).toEqual(
        ['DELETE', 'GET', 'PATCH', 'POST', 'PUT'].sort(),
      );
      expect(verbs.has(RequestMethod[RequestMethod.ALL] as string)).toBe(false);
    });
  });

  describe(':type is pipe-validated AT THE CONTROLLER (§3.3)', () => {
    const typeParam = routeArgs(
      MemberCommunityController,
      'toggleReaction',
    ).find(
      (arg) => arg.paramtype === ROUTE_PARAMTYPES.PARAM && arg.data === 'type',
    );
    const pipe = typeParam?.pipes[0] as {
      transform: (value: unknown, meta: unknown) => Promise<unknown>;
    };

    it('binds exactly one pipe to the :type param', () => {
      expect(typeParam?.pipes).toHaveLength(1);
    });

    it.each(REACTION_TYPES.map((type) => [type]))(
      'accepts the declared reaction type %s',
      async (type) => {
        await expect(
          pipe.transform(type, { type: 'param', data: 'type' }),
        ).resolves.toBe(type);
      },
    );

    it('REJECTS a type outside the fixed four, before any service runs', async () => {
      // `PostReaction.type` is a Postgres String, not an enum (§1.3) — nothing
      // at the database layer would catch `'fire'`. This pipe is the only gate,
      // and its vocabulary is DERIVED from `REACTION_TYPES` rather than retyped.
      await expect(
        pipe.transform('fire', { type: 'param', data: 'type' }),
      ).rejects.toMatchObject({ status: 400 });
    });
  });

  describe('delegation — the context comes from the guard, and nothing else', () => {
    it.each([
      [
        'listCategories',
        (c: MemberCommunityController, r: Request) => c.listCategories(r),
      ],
      [
        'listTopics',
        (c: MemberCommunityController, r: Request) => c.listTopics(r, {}),
      ],
      [
        'getTopic',
        (c: MemberCommunityController, r: Request) => c.getTopic(r, 's', {}),
      ],
      [
        'deleteTopic',
        (c: MemberCommunityController, r: Request) => c.deleteTopic(r, 't-1'),
      ],
      [
        'deletePost',
        (c: MemberCommunityController, r: Request) => c.deletePost(r, 'p-1'),
      ],
      [
        'toggleReaction',
        (c: MemberCommunityController, r: Request) =>
          c.toggleReaction(r, 'p-1', 'like'),
      ],
      [
        'markRead',
        (c: MemberCommunityController, r: Request) =>
          c.markRead(r, 't-1', { lastReadPostNumber: 4 }),
      ],
      [
        'markCategoryRead',
        (c: MemberCommunityController, r: Request) =>
          c.markCategoryRead(r, 'c-1'),
      ],
      [
        'acceptAnswer',
        (c: MemberCommunityController, r: Request) =>
          c.acceptAnswer(r, 't-1', { postId: 'p-2' }),
      ],
      [
        'clearAcceptedAnswer',
        (c: MemberCommunityController, r: Request) =>
          c.clearAcceptedAnswer(r, 't-1'),
      ],
    ])('%s resolves against req.memberContext', async (_name, invoke) => {
      const { controller } = createHarness();

      await expect(invoke(controller, memberRequest())).resolves.toBeDefined();
    });

    it('the feed hands the WHOLE query DTO to the read model', async () => {
      const { controller, doubles } = createHarness();
      const query = { categoryId: 'c-1', sort: 'unread' as const, page: 2 };

      await controller.listTopics(memberRequest(), query);

      // Not re-defaulted here: `resolveTopicQuery` applies the defaults,
      // deliberately outside the DTO, so "omitted" and "sent the default" stay
      // distinguishable for anything that later needs the difference.
      expect(doubles.topicsRead.listFeed).toHaveBeenCalledWith(CTX, query);
    });

    it('the thread read resolves page defaults through resolveThreadPage', async () => {
      const { controller, doubles } = createHarness();

      await controller.getTopic(memberRequest(), 'a-slug', {});

      expect(doubles.topicsRead.getThread).toHaveBeenCalledWith(CTX, 'a-slug', {
        page: 1,
        pageSize: 25,
      });
    });

    it('honours an explicit page and pageSize', async () => {
      const { controller, doubles } = createHarness();

      await controller.getTopic(memberRequest(), 'a-slug', {
        page: 3,
        pageSize: 50,
      });

      expect(doubles.topicsRead.getThread).toHaveBeenCalledWith(CTX, 'a-slug', {
        page: 3,
        pageSize: 50,
      });
    });

    it('passes the validated :type straight to the toggle', async () => {
      const { controller, doubles } = createHarness();

      await controller.toggleReaction(memberRequest(), 'p-7', 'celebrate');

      expect(doubles.reactions.toggle).toHaveBeenCalledWith(
        CTX,
        'p-7',
        'celebrate',
      );
    });
  });

  describe('creates COMPOSE through the read model — they never assemble a wire shape', () => {
    it('a created topic is rendered by the same getThread that serves GET topics/:slug', async () => {
      const { controller, doubles } = createHarness();
      const detail = { id: 't-1', slug: 'a-slug' };
      doubles.topicsRead.getThread.mockResolvedValue(detail);

      const result = await controller.createTopic(memberRequest(), {
        categoryId: 'c-1',
        title: 'Hello',
        bodyMarkdown: 'body',
      });

      expect(doubles.topics.create).toHaveBeenCalledWith(CTX, {
        categoryId: 'c-1',
        title: 'Hello',
        bodyMarkdown: 'body',
      });
      // The SLUG the service allocated, not one recomputed here — the service
      // may have resolved a collision and appended `-2`.
      expect(doubles.topicsRead.getThread).toHaveBeenCalledWith(CTX, 'a-slug');
      expect(result).toBe(detail);
    });

    it('a created reply is rendered by getPost, using the id the service returned', async () => {
      const { controller, doubles } = createHarness();
      // The service may have REPAIRED the requested parent to depth 2 (RK-12);
      // composing from the returned id is what makes the response report the
      // parent the row actually got rather than the one the client asked for.
      doubles.posts.createReply.mockResolvedValue({
        id: 'p-99',
        topicId: 't-1',
        postNumber: 7,
        parentId: 'p-1',
        depthRepaired: true,
      });

      await controller.createPost(memberRequest(), 't-1', {
        bodyMarkdown: 'reply',
        parentId: 'p-deep',
      });

      expect(doubles.topicsRead.getPost).toHaveBeenCalledWith(CTX, 'p-99');
    });

    it('an edited topic re-reads by the slug the service returned, not by the :id in the URL', async () => {
      const { controller, doubles } = createHarness();
      doubles.topics.updateByAuthor.mockResolvedValue({
        id: 't-1',
        slug: 'stable-slug',
      });

      await controller.updateTopic(memberRequest(), 't-1', { title: 'New' });

      // R1.2.2 — the slug is generated once and never regenerated, so a title
      // edit must NOT change the URL. Re-reading by the RETURNED slug is what
      // proves this controller does not invent one from the new title.
      expect(doubles.topicsRead.getThread).toHaveBeenCalledWith(
        CTX,
        'stable-slug',
      );
    });
  });

  describe('the removed-guard tripwire', () => {
    it('refuses with a 500 rather than serving an UNGATED request', async () => {
      const { controller, doubles } = createHarness();

      await expect(
        controller.listCategories(unguardedRequest()),
      ).rejects.toBeInstanceOf(InternalServerErrorException);

      // The point of the check: it must not reach the service with an undefined
      // context, where the visibility builder would either throw somewhere less
      // legible or — far worse — produce a clause that matches everything.
      expect(doubles.categories.listForMember).not.toHaveBeenCalled();
    });

    it('tells the CLIENT nothing about the mechanism (NFR-S7)', async () => {
      expect.assertions(2);
      const { controller } = createHarness();

      try {
        await controller.listCategories(unguardedRequest());
      } catch (error: unknown) {
        const body =
          error instanceof InternalServerErrorException
            ? JSON.stringify(error.getResponse())
            : '';
        expect(body).not.toContain('MemberGuard');
        expect(body).not.toContain('memberContext');
      }
    });
  });
});
