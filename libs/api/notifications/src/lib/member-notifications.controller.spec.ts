import 'reflect-metadata';

import { InternalServerErrorException, ValidationPipe } from '@nestjs/common';
import {
  GUARDS_METADATA,
  HTTP_CODE_METADATA,
  METHOD_METADATA,
  PATH_METADATA,
  ROUTE_ARGS_METADATA,
} from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard } from '@ptah-api/membership';
import type { MemberContext } from '@ptah-api/membership';
import {
  DEFAULT_PAGE_SIZE,
  FIRST_PAGE,
  MAX_BULK_MARK_READ_IDS,
  MAX_PAGE_SIZE,
} from '@ptah-contracts/community';

import {
  ListNotificationsQueryDto,
  resolveNotificationPage,
} from './dto/list-notifications.query.dto';
import { MarkNotificationsReadDto } from './dto/mark-notifications-read.dto';
import { MemberNotificationsController } from './member-notifications.controller';
import { NotificationsService } from './notifications.service';

/**
 * `MemberNotificationsController` + `ListNotificationsQueryDto` — §3.6, R10.3,
 * R10.4, R10.5, PRE-1, ground truth 10 and 11.
 *
 * The handlers are one line each. What is asserted is the SHAPE:
 *
 *   - the guard chain is at CLASS level, in order (leak risk L1 / G1);
 *   - `page`/`pageSize` arrive inside a DTO bound with `dtoPipe`, so there is
 *     no named primitive `@Query` (`NAMED_PRIMITIVE_PARAM_COUNT` is an EXACT
 *     equality at 6) and nothing is silently unvalidated (PRE-1);
 *   - `pageSize=51` is a `400`, not a clamp (NFR-P5);
 *   - the bulk `ids` array is CAPPED, non-empty and string-typed, and the cap
 *     is DERIVED from `MAX_PAGE_SIZE` rather than copied;
 *   - `POST read` is one segment and `POST :id/read` is two, so `read` can
 *     never be swallowed as an id (RI-3);
 *   - all three `@Post`s answer `200`, not Nest's default `201`;
 *   - there is no `@Sse` and no long-poll anywhere (AD-14, R10.5).
 */

const CTX: MemberContext = {
  userId: '00000000-0000-4000-8000-000000000001',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function guardedRequest(): Request {
  return {
    memberContext: CTX,
    method: 'GET',
    path: '/x',
  } as unknown as Request;
}

function unguardedRequest(): Request {
  return { method: 'GET', path: '/x' } as unknown as Request;
}

function build() {
  const notifications = {
    list: jest.fn().mockResolvedValue({
      items: [],
      page: 1,
      pageSize: 25,
      total: 0,
      hasMore: false,
    }),
    unreadCount: jest.fn().mockResolvedValue({ unreadCount: 3 }),
    markRead: jest
      .fn()
      .mockResolvedValue({ readAt: '2026-08-10T00:00:00.000Z' }),
    markManyRead: jest.fn().mockResolvedValue({ marked: 2 }),
    markAllRead: jest.fn().mockResolvedValue({ marked: 4 }),
  };
  const controller = new MemberNotificationsController(
    notifications as unknown as NotificationsService,
  );
  return { controller, notifications };
}

/** The `dtoPipe(...)` instance bound at a parameter, if any. */
function paramPipes(method: string): unknown[][] {
  const meta = (Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    MemberNotificationsController,
    method,
  ) ?? {}) as Record<string, { pipes?: unknown[]; data?: unknown }>;

  return Object.values(meta).map((entry) => entry.pipes ?? []);
}

function paramData(method: string): unknown[] {
  const meta = (Reflect.getMetadata(
    ROUTE_ARGS_METADATA,
    MemberNotificationsController,
    method,
  ) ?? {}) as Record<string, { data?: unknown }>;

  return Object.values(meta).map((entry) => entry.data);
}

describe('MemberNotificationsController', () => {
  describe('the four handlers', () => {
    it('GET delegates with the resolved paging', async () => {
      const { controller, notifications } = build();

      await controller.list(guardedRequest(), { page: 2, pageSize: 10 });

      expect(notifications.list).toHaveBeenCalledWith(CTX, {
        page: 2,
        pageSize: 10,
      });
    });

    it('GET applies the contract defaults when the query is empty', async () => {
      const { controller, notifications } = build();

      await controller.list(guardedRequest(), {});

      expect(notifications.list).toHaveBeenCalledWith(CTX, {
        page: FIRST_PAGE,
        pageSize: DEFAULT_PAGE_SIZE,
      });
    });

    it('GET unread-count returns the envelope', async () => {
      const { controller } = build();

      await expect(controller.unreadCount(guardedRequest())).resolves.toEqual({
        unreadCount: 3,
      });
    });

    it('POST :id/read delegates the ownership decision to the service', async () => {
      const { controller, notifications } = build();

      await controller.markRead(guardedRequest(), 'n_1');

      // The controller performs NO ownership check of its own — the clause is
      // in the service's `where` (RISK-AH), so there is one place for it.
      expect(notifications.markRead).toHaveBeenCalledWith(CTX, 'n_1');
    });

    it('POST read-all returns the marked count', async () => {
      const { controller } = build();

      await expect(controller.markAllRead(guardedRequest())).resolves.toEqual({
        marked: 4,
      });
    });
  });

  describe('the removed-guard tripwire', () => {
    it.each([
      'list',
      'unreadCount',
      'markRead',
      'markManyRead',
      'markAllRead',
    ] as const)(
      '%s refuses to serve without a memberContext',
      async (method) => {
        // 🔴 THE DEGRADED STATE IS NOT AN EMPTY LIST. Every `where` on this
        // surface carries `userId: ctx.userId`, and Prisma treats an
        // `undefined` filter as NO CONSTRAINT — `list` would return every
        // member's notifications and `markAllRead` would mark every member's
        // notifications read, both with a `200`.
        const { controller, notifications } = build();
        const call =
          method === 'list'
            ? controller.list(unguardedRequest(), {})
            : method === 'unreadCount'
              ? controller.unreadCount(unguardedRequest())
              : method === 'markRead'
                ? controller.markRead(unguardedRequest(), 'n_1')
                : method === 'markManyRead'
                  ? controller.markManyRead(unguardedRequest(), {
                      ids: ['n_1'],
                    })
                  : controller.markAllRead(unguardedRequest());

        await expect(call).rejects.toBeInstanceOf(InternalServerErrorException);
        expect(notifications.list).not.toHaveBeenCalled();
        expect(notifications.markAllRead).not.toHaveBeenCalled();
        expect(notifications.markManyRead).not.toHaveBeenCalled();
      },
    );
  });

  describe('leak risk L1 / G1 — guards at CLASS level, in order', () => {
    it('declares JwtAuthGuard then MemberGuard on the class', () => {
      expect(
        Reflect.getMetadata(GUARDS_METADATA, MemberNotificationsController),
      ).toEqual([JwtAuthGuard, MemberGuard]);
    });

    it.each([
      'list',
      'unreadCount',
      'markRead',
      'markManyRead',
      'markAllRead',
    ] as const)('%s declares no method-level guard', (method) => {
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;
      expect(
        Reflect.getMetadata(GUARDS_METADATA, proto[method]),
      ).toBeUndefined();
    });
  });

  describe('PRE-1 / ground truth 10 — validation and the param census', () => {
    it('binds a real ValidationPipe with an expectedType on the query', () => {
      // A bare `@Query() q: X` is SILENTLY UNVALIDATED: esbuild emits no
      // `emitDecoratorMetadata`, so `metadata.metatype` is `undefined` and
      // `ValidationPipe.transform` short-circuits before any decorator runs.
      const pipes = paramPipes('list').flat();
      const validationPipes = pipes.filter(
        (p) => p instanceof ValidationPipe,
      ) as ValidationPipe[];

      expect(validationPipes).toHaveLength(1);
      expect(
        (validationPipes[0] as unknown as { expectedType?: unknown })
          .expectedType,
      ).toBe(ListNotificationsQueryDto);
    });

    it('🔴 declares NO named primitive @Query anywhere on this controller', () => {
      // `NAMED_PRIMITIVE_PARAM_COUNT` is asserted by EXACT EQUALITY at 6 in
      // `controller-validation.spec.ts`. One `@Query('page') page: string` here
      // makes the server-wide total 7 and fails the build — deliberately, so
      // the carve-out for the six pre-existing OAuth/ticket params cannot grow.
      //
      // The whole-object `@Query()` carries `data: undefined`; the only named
      // route arg on this controller is `@Param('id')`, which is a PATH
      // segment and is how every other member controller addresses a row.
      expect(paramData('list')).toEqual([undefined, undefined]);
      expect(paramData('unreadCount')).toEqual([undefined]);
      expect(paramData('markRead').sort()).toEqual(['id', undefined]);
      // 🔴 The bulk ids arrive in a `@Body()`, NOT `@Query('ids')`. A query
      // string is bounded by the server's URL limit rather than by anything
      // this code controls, it is logged by every proxy in the path, and it
      // would make the server-wide named count 7 against an EXACT 6.
      expect(paramData('markManyRead')).toEqual([undefined, undefined]);
      expect(paramData('markAllRead')).toEqual([undefined]);
    });

    it('binds a real ValidationPipe with an expectedType on the bulk body', () => {
      // Same trap as the query, with a worse blast radius: unbound, the array
      // cap, the per-id length cap and `forbidNonWhitelisted` are ALL inert,
      // and an arbitrary JSON body reaches the service.
      const pipes = paramPipes('markManyRead').flat();
      const validationPipes = pipes.filter(
        (p) => p instanceof ValidationPipe,
      ) as ValidationPipe[];

      expect(validationPipes).toHaveLength(1);
      expect(
        (validationPipes[0] as unknown as { expectedType?: unknown })
          .expectedType,
      ).toBe(MarkNotificationsReadDto);
    });

    it('binds no pipe it does not need — the payload-less writes take none', () => {
      expect(paramPipes('markRead').flat()).toEqual([]);
      expect(paramPipes('markAllRead').flat()).toEqual([]);
      expect(paramPipes('unreadCount').flat()).toEqual([]);
    });
  });

  describe('🔴 POST read — the bulk write, and the cap that bounds it', () => {
    async function validateBody(raw: Record<string, unknown>) {
      const dto = plainToInstance(MarkNotificationsReadDto, raw, {
        enableImplicitConversion: false,
      });
      return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    }

    it('delegates the ids and the ownership decision to the service', async () => {
      const { controller, notifications } = build();

      await expect(
        controller.markManyRead(guardedRequest(), { ids: ['n_1', 'n_2'] }),
      ).resolves.toEqual({ marked: 2 });

      // The controller performs NO ownership check of its own — the clause is
      // in the service's `where` (RISK-AH), so there is exactly one place for
      // it and it cannot be bypassed by a second caller.
      expect(notifications.markManyRead).toHaveBeenCalledWith(CTX, [
        'n_1',
        'n_2',
      ]);
    });

    it('🔴 REJECTS an empty array rather than treating it as a no-op', async () => {
      // "these, where these is empty" is the ONE phrasing that could ever be
      // re-read as "all", and that conflation is the irreversible mistake this
      // endpoint exists to make impossible. Refusing it closes the door instead
      // of documenting it shut.
      const errors = await validateBody({ ids: [] });

      expect(errors.map((e) => e.property)).toEqual(['ids']);
      expect(JSON.stringify(errors)).toContain('arrayNotEmpty');
    });

    it(`accepts exactly ${MAX_BULK_MARK_READ_IDS} ids, the documented ceiling`, async () => {
      const ids = Array.from({ length: MAX_BULK_MARK_READ_IDS }, (_, i) =>
        String(i),
      );

      await expect(validateBody({ ids })).resolves.toEqual([]);
    });

    it('rejects one id past the ceiling — an unbounded array is a DoS vector', async () => {
      const ids = Array.from({ length: MAX_BULK_MARK_READ_IDS + 1 }, (_, i) =>
        String(i),
      );
      const errors = await validateBody({ ids });

      expect(errors.map((e) => e.property)).toEqual(['ids']);
      expect(JSON.stringify(errors)).toContain('arrayMaxSize');
    });

    it('derives its ceiling from MAX_PAGE_SIZE rather than copying a number', () => {
      // The only honest way a member produces a selection is by ticking rows
      // that are on screen, and the inbox cannot render more than one page.
      // Deriving means raising the page ceiling cannot leave the two in
      // disagreement.
      expect(MAX_BULK_MARK_READ_IDS).toBe(MAX_PAGE_SIZE);
    });

    it('rejects a bare string — it must never be spread into characters', async () => {
      // `[...'n_1']` is `['n','_','1']`, and `in: ['n','_','1']` matches
      // nothing — so without `@IsArray()` the failure is a silent
      // `{ marked: 0 }` rather than an error anyone sees.
      const errors = await validateBody({ ids: 'n_1' });

      expect(errors.map((e) => e.property)).toEqual(['ids']);
    });

    it('rejects a non-string element, an empty one, and an over-long one', async () => {
      for (const ids of [[1, 2], [''], ['x'.repeat(65)]]) {
        const errors = await validateBody({ ids });
        expect({ ids, properties: errors.map((e) => e.property) }).toEqual({
          ids,
          properties: ['ids'],
        });
      }
    });

    it('rejects an unknown property (forbidNonWhitelisted)', async () => {
      const errors = await validateBody({ ids: ['n_1'], all: true });

      expect(errors.map((e) => e.property)).toEqual(['all']);
    });

    it('accepts a well-formed cuid-shaped selection', async () => {
      await expect(
        validateBody({ ids: ['cmsnaworh0001u0bi8w9c0yv8'] }),
      ).resolves.toEqual([]);
    });
  });

  describe('NFR-P5 — pageSize > 50 is a 400, not a clamp', () => {
    async function validateQuery(raw: Record<string, unknown>) {
      const dto = plainToInstance(ListNotificationsQueryDto, raw, {
        enableImplicitConversion: false,
      });
      return validate(dto, { whitelist: true, forbidNonWhitelisted: true });
    }

    it('rejects pageSize=51 and names the property', async () => {
      const errors = await validateQuery({ pageSize: '51' });

      expect(errors.map((e) => e.property)).toEqual(['pageSize']);
      expect(JSON.stringify(errors)).toContain('max');
    });

    it('accepts pageSize=50, the documented ceiling', async () => {
      await expect(validateQuery({ pageSize: '50' })).resolves.toEqual([]);
    });

    it('rejects page=0 — pages are 1-based', async () => {
      const errors = await validateQuery({ page: '0' });

      expect(errors.map((e) => e.property)).toEqual(['page']);
    });

    it('rejects an explicit null rather than skipping validation', async () => {
      // `@IsOptional()` would skip BOTH `undefined` and `null`, letting a
      // `null` reach the service typed as a `number` — a `500` on a request
      // that should be a `400`. `@IsOptionalNotNull()` skips `undefined` only.
      const errors = await validateQuery({ page: null });

      expect(errors.map((e) => e.property)).toEqual(['page']);
    });

    it('rejects an unknown property (forbidNonWhitelisted)', async () => {
      const errors = await validateQuery({ authorId: 'me' });

      expect(errors.map((e) => e.property)).toEqual(['authorId']);
    });

    it('transforms the query STRINGS Express delivers into numbers', async () => {
      // `@Type(() => Number)` is load-bearing: `@IsInt()` on a bare `'2'`
      // fails.
      const dto = plainToInstance(ListNotificationsQueryDto, {
        page: '2',
        pageSize: '10',
      });

      expect(resolveNotificationPage(dto)).toEqual({ page: 2, pageSize: 10 });
    });

    it('resolves defaults OUTSIDE the DTO, not as class-field initialisers', () => {
      // `plainToInstance` runs field initialisers BEFORE the whitelist, so a
      // defaulted field survives a request that never sent it.
      const dto = plainToInstance(ListNotificationsQueryDto, {});

      expect(dto.page).toBeUndefined();
      expect(dto.pageSize).toBeUndefined();
      expect(resolveNotificationPage(dto)).toEqual({
        page: FIRST_PAGE,
        pageSize: DEFAULT_PAGE_SIZE,
      });
    });
  });

  describe('the routes', () => {
    it('is mounted at the one depth-3 literal prefix', () => {
      expect(
        Reflect.getMetadata(PATH_METADATA, MemberNotificationsController),
      ).toBe('v1/members/notifications');
    });

    it('declares the five method paths plan §3.6 gives it', () => {
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;
      const route = (method: string) => ({
        path: Reflect.getMetadata(PATH_METADATA, proto[method]) as string,
        verb: Reflect.getMetadata(METHOD_METADATA, proto[method]) as number,
      });

      expect(route('list')).toEqual({ path: '/', verb: RequestMethod.GET });
      expect(route('unreadCount')).toEqual({
        path: 'unread-count',
        verb: RequestMethod.GET,
      });
      expect(route('markRead')).toEqual({
        path: ':id/read',
        verb: RequestMethod.POST,
      });
      expect(route('markManyRead')).toEqual({
        path: 'read',
        verb: RequestMethod.POST,
      });
      expect(route('markAllRead')).toEqual({
        path: 'read-all',
        verb: RequestMethod.POST,
      });
    });

    it('🔴 RI-3 — `read` cannot be swallowed by `:id/read`', () => {
      // Different SEGMENT COUNTS never unify: `read` is one segment under the
      // controller prefix, `:id/read` is two. `POST .../read` therefore cannot
      // reach `markRead` with `id === 'read'` — that would require the path
      // `.../read/read`. Asserted structurally here and proven live against a
      // running server, because the consequence of being wrong is that a bulk
      // request silently marks ONE row and reports success.
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;
      const segments = (method: string) =>
        (Reflect.getMetadata(PATH_METADATA, proto[method]) as string)
          .split('/')
          .filter(Boolean).length;

      expect(segments('markManyRead')).toBe(1);
      expect(segments('markAllRead')).toBe(1);
      expect(segments('markRead')).toBe(2);
    });

    it('🔴 there is no un-read route — the writes are one / these / all', () => {
      // The reason `read` had to exist. Nothing here can mark a notification
      // UNREAD, so serving a partial selection with `read-all` would destroy
      // unread state the member never selected, permanently. A route added
      // later that could reverse a read would change that calculus, and it
      // should be a conscious decision rather than a quiet one.
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;
      const posts = Object.getOwnPropertyNames(proto)
        .filter(
          (name) =>
            Reflect.getMetadata(METHOD_METADATA, proto[name]) ===
            RequestMethod.POST,
        )
        .map((name) => Reflect.getMetadata(PATH_METADATA, proto[name]))
        .sort();

      expect(posts).toEqual([':id/read', 'read', 'read-all']);
    });

    it("🔴 all three POSTs answer 200, not Nest's default 201", () => {
      // Nothing is created: this is idempotent state on a row that already
      // exists. A client branching on the status would be reading a lie, and
      // the lie would be a framework default rather than anyone's decision.
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;

      expect(Reflect.getMetadata(HTTP_CODE_METADATA, proto['markRead'])).toBe(
        200,
      );
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, proto['markManyRead']),
      ).toBe(200);
      expect(
        Reflect.getMetadata(HTTP_CODE_METADATA, proto['markAllRead']),
      ).toBe(200);
    });

    it('is segment-wise disjoint from every existing member prefix (RI-1)', () => {
      const mine = 'v1/members/notifications';
      for (const other of [
        'v1/members/entitlement',
        'v1/members/hub',
        'v1/members/sessions',
        'v1/members/session-requests',
        'v1/members/live',
        'v1/members/community',
        'v1/members/courses',
        'v1/members/lesson-comments',
        'v1/members/search',
        'v1/members/packs',
      ]) {
        expect({
          other,
          nested: mine.startsWith(`${other}/`) || other.startsWith(`${mine}/`),
        }).toEqual({ other, nested: false });
      }
    });

    it('unread-count and read-all are METHOD paths, not sibling controllers', () => {
      // RI-1 sees ONE prefix. Split into three controllers they would be three
      // prefixes, two of which are proper path-prefixes of nothing — but the
      // split would also give the badge its own guard chain to keep in step.
      const proto =
        MemberNotificationsController.prototype as unknown as Record<
          string,
          object
        >;
      for (const method of ['unreadCount', 'markManyRead', 'markAllRead']) {
        const path = Reflect.getMetadata(
          PATH_METADATA,
          proto[method],
        ) as string;
        expect(path.startsWith('/')).toBe(false);
        expect(path).not.toContain('v1/');
      }
    });
  });

  describe('AD-14 / R10.5 — poll only', () => {
    const { readFileSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const SOURCE = readFileSync(
      join(__dirname, 'member-notifications.controller.ts'),
      'utf8',
    );

    it('declares no @Sse and imports nothing from @ptah-api/licensing', () => {
      // `libs/api/licensing` carries an `@Sse` endpoint. The cheapest way to
      // keep a forbidden transport out is to never take the dependency.
      //
      // ⚠️ ASSERTED AGAINST THE DECORATOR APPLICATION AND THE IMPORT LIST, NOT
      // RAW TEXT — the class docblock names `@Sse` in prose to explain why it
      // is absent, and a `toContain` reads that documentation as the violation.
      // The same idiom `admin-guards.spec.ts` G6 uses, for the same reason.
      expect(SOURCE).not.toMatch(/^\s*@Sse\(/m);
      expect(SOURCE).not.toMatch(/import\s[^;]*\bSse\b[^;]*from/);
      expect(SOURCE).not.toMatch(/from\s+'@ptah-api\/licensing'/);
      expect(SOURCE).not.toMatch(/import\s[^;]*\bObservable\b[^;]*from/);
    });

    it('plays no Cache-Control games and opens no long-poll', () => {
      expect(SOURCE).not.toContain('Cache-Control');
      expect(SOURCE).not.toContain('setTimeout');
      expect(SOURCE).not.toContain('WebSocket');
    });
  });
});
