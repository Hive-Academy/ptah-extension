// ⚠️ FIRST IMPORT — the comment DTOs carry `class-validator` decorators and
// this lib has no jest `setupFiles`.
import 'reflect-metadata';

import { ValidationPipe } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import type { Request } from 'express';
import { JwtAuthGuard } from '@ptah-api/identity';
import { MemberGuard, type MemberContext } from '@ptah-api/membership';

import {
  ROUTE_PARAMTYPES,
  handlersOf,
  routeArgs,
  routeOf,
  unifies,
} from '../../testing/controller-reflection';

import { CreateCommentDto } from './dto/create-comment.dto';
import type { LessonCommentsService } from './lesson-comments.service';
import { MemberLessonCommentsController } from './member-lesson-comments.controller';

/**
 * `MemberLessonCommentsController` — §3.4's lesson-comment surface, R2.5.
 *
 * What this file asserts that nothing else can:
 *
 *   - the route table, including the ABSENCE of a `GET` (a decision, not an
 *     omission — the thread arrives with the lesson);
 *   - PRE-1 on all three bodies;
 *   - `CreateCommentDto.parentId`'s `NullMeansAbsent()` transform, which is the
 *     one call site of that decorator in the lib;
 *   - A-8 — no reaction vocabulary reaches this surface.
 */

const CTX: MemberContext = {
  userId: 'user-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};

function memberRequest(): Request {
  return {
    memberContext: CTX,
    method: 'POST',
    path: '/api/v1/members/lesson-comments',
  } as unknown as Request;
}

/** @see the courses spec — a separate function, never a default parameter. */
function unguardedRequest(): Request {
  return {
    method: 'POST',
    path: '/api/v1/members/lesson-comments',
  } as unknown as Request;
}

interface Harness {
  controller: MemberLessonCommentsController;
  comments: {
    create: jest.Mock;
    update: jest.Mock;
    remove: jest.Mock;
    setAnswered: jest.Mock;
  };
}

function createHarness(): Harness {
  const comments = {
    create: jest
      .fn()
      .mockResolvedValue({ comment: { id: 'lc-1' }, depthRepaired: false }),
    update: jest.fn().mockResolvedValue({ id: 'lc-1' }),
    remove: jest.fn().mockResolvedValue({ deleted: true }),
    setAnswered: jest.fn().mockResolvedValue({ id: 'lc-1', answered: true }),
  };

  const controller = new MemberLessonCommentsController(
    comments as unknown as LessonCommentsService,
  );

  return { controller, comments };
}

describe('MemberLessonCommentsController', () => {
  describe('the guard chain', () => {
    it('declares JwtAuthGuard then MemberGuard at CLASS level, in that order', () => {
      const guards =
        (Reflect.getMetadata(
          GUARDS_METADATA,
          MemberLessonCommentsController,
        ) as unknown[]) ?? [];

      expect(guards).toContain(JwtAuthGuard);
      expect(guards).toContain(MemberGuard);
      expect(guards.indexOf(JwtAuthGuard)).toBeLessThan(
        guards.indexOf(MemberGuard),
      );
    });

    it('refuses loudly when the guard has been removed, before any write', async () => {
      const harness = createHarness();

      await expect(
        harness.controller.create(unguardedRequest(), {
          lessonId: 'l-1',
          bodyMarkdown: 'Question?',
        }),
      ).rejects.toThrow();

      expect(harness.comments.create).not.toHaveBeenCalled();
    });
  });

  describe('the route table', () => {
    it('is exactly the §3.4 lesson-comment surface — and has NO GET', () => {
      const routes = handlersOf(MemberLessonCommentsController)
        .map((handler) => {
          const { verb, path } = routeOf(
            MemberLessonCommentsController,
            handler,
          );
          return `${verb} ${path}`;
        })
        .sort();

      expect(routes).toEqual([
        'DELETE v1/members/lesson-comments/:id',
        'PATCH v1/members/lesson-comments/:id',
        'POST v1/members/lesson-comments',
        'PUT v1/members/lesson-comments/:id/answered',
      ]);
      // The absence is the decision: a lesson's thread arrives with the lesson
      // (`MemberLessonDetail.comments`), so a standalone read would be a second
      // visibility decision to keep in step — and the obvious way around
      // R2.4.4's outline redaction.
      expect(routes.some((route) => route.startsWith('GET '))).toBe(false);
    });

    it('no two same-verb routes unify — RI-3 has nothing to arbitrate', () => {
      const routes = handlersOf(MemberLessonCommentsController).map((handler) =>
        routeOf(MemberLessonCommentsController, handler),
      );

      const collisions: string[] = [];
      for (const a of routes) {
        for (const b of routes) {
          if (a === b) continue;
          if (a.verb !== b.verb) continue;
          if (unifies(a.path, b.path)) collisions.push(`${a.path} ~ ${b.path}`);
        }
      }

      expect(collisions).toEqual([]);
    });
  });

  describe('PRE-1 — payload params', () => {
    const payloadParams = handlersOf(MemberLessonCommentsController).flatMap(
      (handler) =>
        routeArgs(MemberLessonCommentsController, handler)
          .filter(
            (arg) =>
              arg.paramtype === ROUTE_PARAMTYPES.BODY ||
              arg.paramtype === ROUTE_PARAMTYPES.QUERY,
          )
          .map((arg) => ({ handler, ...arg })),
    );

    it('has exactly three bodies: create, update, setAnswered', () => {
      expect(payloadParams.map((p) => p.handler).sort()).toEqual([
        'create',
        'setAnswered',
        'update',
      ]);
    });

    it('binds all three, and none is a named primitive (RISK-I)', () => {
      for (const param of payloadParams) {
        expect({
          handler: param.handler,
          named: param.data !== undefined,
          bound: param.pipes.some(
            (pipe) =>
              pipe instanceof ValidationPipe &&
              (pipe as ValidationPipe & { expectedType?: unknown })
                .expectedType !== undefined,
          ),
        }).toEqual({ handler: param.handler, named: false, bound: true });
      }
    });
  });

  describe('CreateCommentDto — the one NullMeansAbsent() call site in the lib', () => {
    it('an explicit parentId: null becomes undefined, not a 400', () => {
      // `MemberLessonComment.parentId` is `string | null` on the wire, so a
      // client that holds one and hands it straight back is doing a reasonable
      // thing. A comment with no parent IS a top-level comment — exactly what
      // omitting the key means.
      const instance = plainToInstance(CreateCommentDto, {
        lessonId: 'l-1',
        bodyMarkdown: 'Question?',
        parentId: null,
      });

      expect(instance.parentId).toBeUndefined();
      expect(validateSync(instance)).toEqual([]);
    });

    it('a parentId of the WRONG TYPE is still a 400', () => {
      // Anti-vacuity for the transform: it must normalise `null` only, not
      // soften the property into accepting anything.
      const instance = plainToInstance(CreateCommentDto, {
        lessonId: 'l-1',
        bodyMarkdown: 'Question?',
        parentId: 42,
      });

      expect(validateSync(instance).map((e) => e.property)).toEqual([
        'parentId',
      ]);
    });

    it('an omitted parentId validates vacuously', () => {
      const instance = plainToInstance(CreateCommentDto, {
        lessonId: 'l-1',
        bodyMarkdown: 'Question?',
      });

      expect(validateSync(instance)).toEqual([]);
    });

    it('an `answered` field on a create is REJECTED — R2.5.3 owns that', () => {
      const errors = validateSync(
        plainToInstance(CreateCommentDto, {
          lessonId: 'l-1',
          bodyMarkdown: 'Question?',
          answered: true,
        }),
        { whitelist: true, forbidNonWhitelisted: true },
      );

      expect(errors.map((e) => e.property)).toContain('answered');
    });
  });

  describe('the handlers compose and do not decide', () => {
    it('create returns the composed comment and passes the ctx through', async () => {
      const harness = createHarness();

      const result = await harness.controller.create(memberRequest(), {
        lessonId: 'l-1',
        bodyMarkdown: 'Question?',
      });

      expect(result).toEqual({ id: 'lc-1' });
      expect(harness.comments.create).toHaveBeenCalledWith(CTX, {
        lessonId: 'l-1',
        bodyMarkdown: 'Question?',
      });
    });

    it('the RK-12 depthRepaired flag is NOT on the wire response', async () => {
      // Nothing depends on it and a client that ignored it renders a correct
      // thread; putting it on the response would make it a contract.
      const harness = createHarness();
      harness.comments.create.mockResolvedValue({
        comment: { id: 'lc-1', parentId: 'lc-parent' },
        depthRepaired: true,
      });

      const result = await harness.controller.create(memberRequest(), {
        lessonId: 'l-1',
        bodyMarkdown: 'Reply',
        parentId: 'lc-deep',
      });

      expect(result).toEqual({ id: 'lc-1', parentId: 'lc-parent' });
      expect('depthRepaired' in (result as object)).toBe(false);
    });

    it('update, remove and setAnswered all pass the guard-resolved ctx', async () => {
      const harness = createHarness();
      const req = memberRequest();

      await harness.controller.update(req, 'lc-1', { bodyMarkdown: 'Edited' });
      await harness.controller.remove(req, 'lc-1');
      await harness.controller.setAnswered(req, 'lc-1', { answered: true });

      expect(harness.comments.update).toHaveBeenCalledWith(
        CTX,
        'lc-1',
        'Edited',
      );
      expect(harness.comments.remove).toHaveBeenCalledWith(CTX, 'lc-1');
      expect(harness.comments.setAnswered).toHaveBeenCalledWith(
        CTX,
        'lc-1',
        true,
      );
    });
  });

  describe('A-8 — there are no reactions on a lesson comment', () => {
    it('this controller declares no reaction route and imports no reaction type', () => {
      // ⚠️ IMPORT STATEMENTS AND ROUTES, NOT RAW TEXT (Batch 9B's F-5): the
      // class docblock NAMES the forum's reaction vocabulary in prose to explain
      // why it is absent, and a substring check would read that documentation as
      // the violation.
      const { readFileSync } = require('node:fs') as typeof import('node:fs');
      const { join } = require('node:path') as typeof import('node:path');

      const source = readFileSync(
        join(__dirname, 'member-lesson-comments.controller.ts'),
        'utf8',
      );

      const importedNames = [
        ...source.matchAll(/import\s*(?:type\s*)?\{([^}]*)\}\s*from/g),
      ].flatMap((match) =>
        (match[1] ?? '').split(',').map((binding) => binding.trim()),
      );

      for (const banned of [
        'REACTION_TYPES',
        'ReactionType',
        'ReactionCounts',
        'isReactionType',
        'REACTION_TYPE_ENUM',
      ]) {
        expect(importedNames).not.toContain(banned);
      }

      const routes = handlersOf(MemberLessonCommentsController).map(
        (handler) => routeOf(MemberLessonCommentsController, handler).path,
      );
      expect(routes.some((route) => route.includes('reaction'))).toBe(false);
    });
  });
});
