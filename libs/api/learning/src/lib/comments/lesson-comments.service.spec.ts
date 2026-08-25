import type { MemberContext } from '@ptah-api/membership';

import {
  asPrismaService,
  createMockPrisma,
  type MockLearningPrisma,
} from '../../testing/mock-learning-prisma';
import { ModuleLockService } from '../courses/module-lock.service';
import { ProgressService } from '../progress/progress.service';

import {
  DELETED_COMMENT_PLACEHOLDER,
  LessonCommentsService,
} from './lesson-comments.service';

/**
 * R2.5.1 – R2.5.5, A-8, AD-5, RK-12, NFR-S4.
 *
 * ⚠️ THE LOCK SERVICE IS THE **REAL** ONE, NOT A DOUBLE. R2.5.1 says locking
 * INHERITS from the lesson, and the value of that statement is that the write
 * path and the read path reach the same verdict. A stubbed lock would assert
 * that this service calls something, not that a member is actually refused —
 * and the two-independent-checks drift is precisely the failure mode: one of
 * them silently allowing writes into a module the outline shows as closed.
 * `ProgressService` is real for the same reason: the completion set the lock
 * consumes is produced by the code that will produce it in production.
 */

const CTX: MemberContext = {
  userId: 'member-1',
  email: 'member@example.com',
  entitled: true,
  cohortKeys: [],
  isAdmin: false,
};
const ADMIN: MemberContext = { ...CTX, userId: 'admin-1', isAdmin: true };
const OTHER: MemberContext = { ...CTX, userId: 'member-2' };

const AN_HOUR = 60 * 60 * 1000;

interface Wired {
  prisma: MockLearningPrisma;
  service: LessonCommentsService;
}

function wire(): Wired {
  const prisma = createMockPrisma();

  // A visible lesson in an unlocked module of a non-sequential course.
  prisma.lesson.findFirst.mockResolvedValue({
    id: 'lesson-1',
    moduleId: 'module-1',
  });
  prisma.course.findFirst.mockResolvedValue({
    sequential: false,
    createdBy: null,
    modules: [
      { id: 'module-1', releaseAt: null, lessons: [{ id: 'lesson-1' }] },
    ],
  });
  prisma.lessonProgress.findMany.mockResolvedValue([]);
  prisma.lessonComment.create.mockImplementation(
    async (args: { data: Record<string, unknown> }) =>
      commentRow({ ...args.data, id: 'new-comment' }),
  );
  prisma.lessonComment.update.mockImplementation(
    async (args: { data: Record<string, unknown> }) =>
      commentRow({ ...args.data }),
  );
  prisma.lessonComment.findMany.mockResolvedValue([]);
  prisma.user.findMany.mockResolvedValue([]);

  return {
    prisma,
    service: new LessonCommentsService(
      asPrismaService(prisma),
      new ModuleLockService(),
      new ProgressService(asPrismaService(prisma)),
    ),
  };
}

function commentRow(
  overrides: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    id: 'comment-1',
    lessonId: 'lesson-1',
    parentId: null,
    bodyMarkdown: 'A question about the video',
    authorId: 'member-1',
    answeredAt: null,
    deletedAt: null,
    createdAt: new Date('2026-08-05T12:00:00.000Z'),
    editedAt: null,
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe('R2.5.1 — visibility and locking INHERIT, on the write path too', () => {
  it('🔴 a comment on an INVISIBLE lesson is 404, not 403', async () => {
    // A 403 would confirm the lesson exists, which is the membership oracle
    // R1.1.3's posture forbids and R2.1.2 extends to drafts. Batch 6C proved
    // this holds on the write path as well as the read for categories.
    const { prisma, service } = wire();
    prisma.lesson.findFirst.mockResolvedValue(null);

    await expect(
      service.create(CTX, { lessonId: 'lesson-1', bodyMarkdown: 'hi' }),
    ).rejects.toMatchObject({ status: 404 });
    expect(prisma.lessonComment.create).not.toHaveBeenCalled();
  });

  it('the lesson read composes the visibility clause AND the soft-delete filter', async () => {
    const { prisma, service } = wire();

    await service.create(CTX, { lessonId: 'lesson-1', bodyMarkdown: 'hi' });

    expect(prisma.lesson.findFirst.mock.calls[0]?.[0]?.where).toMatchObject({
      id: 'lesson-1',
      deletedAt: null,
      module: { deletedAt: null, course: { deletedAt: null, published: true } },
    });
  });

  it('🔴 a comment on a LOCKED module is 403 WITH THE MACHINE REASON', async () => {
    // Visible-but-forbidden. The member has already been shown this module and
    // its lesson titles in the outline (R2.4.4), so 404 would contradict the
    // response they just received.
    const { prisma, service } = wire();
    prisma.course.findFirst.mockResolvedValue({
      sequential: false,
      modules: [
        {
          id: 'module-1',
          releaseAt: new Date(Date.now() + 24 * AN_HOUR),
          lessons: [{ id: 'lesson-1' }],
        },
      ],
    });

    const failure = await service
      .create(CTX, { lessonId: 'lesson-1', bodyMarkdown: 'hi' })
      .catch((e) => e);

    expect(failure.status).toBe(403);
    expect(failure.response.reason).toBe('not_released');
    expect(failure.response.unlocksAt).toEqual(expect.any(String));
    expect(prisma.lessonComment.create).not.toHaveBeenCalled();
  });

  it('a sequential lock also refuses, with its own reason and a null unlocksAt', async () => {
    const { prisma, service } = wire();
    prisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-2',
      moduleId: 'module-2',
    });
    prisma.course.findFirst.mockResolvedValue({
      sequential: true,
      modules: [
        { id: 'module-1', releaseAt: null, lessons: [{ id: 'lesson-1' }] },
        { id: 'module-2', releaseAt: null, lessons: [{ id: 'lesson-2' }] },
      ],
    });

    const failure = await service
      .create(CTX, { lessonId: 'lesson-2', bodyMarkdown: 'hi' })
      .catch((e) => e);

    expect(failure.status).toBe(403);
    expect(failure.response.reason).toBe('previous_module_incomplete');
    expect(failure.response.unlocksAt).toBeNull();
  });

  it('and it lets the comment through once the predecessor is complete', async () => {
    // The negative control: a lock that refused unconditionally would pass
    // every assertion above.
    const { prisma, service } = wire();
    prisma.lesson.findFirst.mockResolvedValue({
      id: 'lesson-2',
      moduleId: 'module-2',
    });
    prisma.course.findFirst.mockResolvedValue({
      sequential: true,
      modules: [
        { id: 'module-1', releaseAt: null, lessons: [{ id: 'lesson-1' }] },
        { id: 'module-2', releaseAt: null, lessons: [{ id: 'lesson-2' }] },
      ],
    });
    prisma.lessonProgress.findMany.mockResolvedValue([
      {
        lessonId: 'lesson-1',
        furthestPositionSeconds: 100,
        completedAt: new Date(),
        completionSource: 'manual',
      },
    ]);

    await expect(
      service.create(CTX, { lessonId: 'lesson-2', bodyMarkdown: 'hi' }),
    ).resolves.toMatchObject({ comment: { id: 'new-comment' } });
  });

  it('the completion set is scoped to ctx.userId (NFR-S4)', async () => {
    const { prisma, service } = wire();

    await service.create(CTX, { lessonId: 'lesson-1', bodyMarkdown: 'hi' });

    expect(
      prisma.lessonProgress.findMany.mock.calls[0]?.[0]?.where,
    ).toMatchObject({ userId: CTX.userId });
  });
});

describe('RK-12 — depth is capped at 2 by REPAIR, not by rejection', () => {
  it('a depth-3 reply attempt attaches at DEPTH 2 AND THE BODY IS SAVED', async () => {
    // The same wording as `comment-depth.spec.ts` and as
    // `posts.service.spec.ts`, deliberately — a grep for the requirement finds
    // all three. A 400 here would lose a member's writing over an
    // implementation detail they cannot see.
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'depth-2-comment',
      parentId: 'depth-1-comment',
    });

    const result = await service.create(CTX, {
      lessonId: 'lesson-1',
      bodyMarkdown: 'My reply, which must survive',
      parentId: 'depth-2-comment',
    });

    expect(prisma.lessonComment.create).toHaveBeenCalledTimes(1);
    const data = prisma.lessonComment.create.mock.calls[0]?.[0]?.data;
    expect(data.parentId).toBe('depth-1-comment');
    expect(data.bodyMarkdown).toBe('My reply, which must survive');
    expect(result.depthRepaired).toBe(true);
  });

  it('a reply to a top-level comment is not moved', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'depth-1-comment',
      parentId: null,
    });

    const result = await service.create(CTX, {
      lessonId: 'lesson-1',
      bodyMarkdown: 'reply',
      parentId: 'depth-1-comment',
    });

    expect(prisma.lessonComment.create.mock.calls[0]?.[0]?.data?.parentId).toBe(
      'depth-1-comment',
    );
    expect(result.depthRepaired).toBe(false);
  });

  it('a parent in ANOTHER LESSON is a 404 — not a depth question', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue(null);

    await expect(
      service.create(CTX, {
        lessonId: 'lesson-1',
        bodyMarkdown: 'x',
        parentId: 'foreign',
      }),
    ).rejects.toMatchObject({ status: 404 });

    // The parent read is scoped to the lesson AND filtered — a tombstoned
    // parent is the same 404.
    expect(
      prisma.lessonComment.findFirst.mock.calls[0]?.[0]?.where,
    ).toMatchObject({ id: 'foreign', lessonId: 'lesson-1', deletedAt: null });
  });

  it('a null or absent parentId creates a top-level comment with no extra query', async () => {
    const { prisma, service } = wire();

    await service.create(CTX, {
      lessonId: 'lesson-1',
      bodyMarkdown: 'x',
      parentId: null,
    });

    expect(prisma.lessonComment.findFirst).not.toHaveBeenCalled();
    expect(
      prisma.lessonComment.create.mock.calls[0]?.[0]?.data?.parentId,
    ).toBeNull();
  });
});

describe('R2.5.4 — edit and delete', () => {
  it('a member may edit their OWN comment', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: CTX.userId,
    });

    await expect(
      service.update(CTX, 'comment-1', 'edited'),
    ).resolves.toMatchObject({ bodyMarkdown: 'edited' });
    expect(
      prisma.lessonComment.update.mock.calls[0]?.[0]?.data?.editedAt,
    ).toBeInstanceOf(Date);
  });

  it('🔴 editing ANOTHER member`s comment is 403, not 404', async () => {
    // Not in tension with the visibility rule: the member can already SEE this
    // comment — it is in the thread they just read — so its existence is not a
    // secret and 404 would be a lie about something on their screen.
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: OTHER.userId,
    });

    await expect(
      service.update(CTX, 'comment-1', 'edited'),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.lessonComment.update).not.toHaveBeenCalled();
  });

  it('deleting another member`s comment is 403', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: OTHER.userId,
    });

    await expect(service.remove(CTX, 'comment-1')).rejects.toMatchObject({
      status: 403,
    });
  });

  it('an ADMIN may edit and delete another member`s comment', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: OTHER.userId,
    });

    await expect(
      service.update(ADMIN, 'comment-1', 'moderated'),
    ).resolves.toBeDefined();
    await expect(service.remove(ADMIN, 'comment-1')).resolves.toEqual({
      deleted: true,
    });
  });

  it('delete is SOFT and writes deletedBy — the one model that has the column', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      authorId: CTX.userId,
    });

    await service.remove(CTX, 'comment-1');

    expect(prisma.lessonComment.update.mock.calls[0]?.[0]?.data).toMatchObject({
      deletedBy: CTX.userId,
    });
    expect(prisma.lessonComment.delete).not.toHaveBeenCalled();
    expect(prisma.lessonComment.deleteMany).not.toHaveBeenCalled();
  });

  it('a comment on a lesson the member can no longer see is 404 even for its AUTHOR', async () => {
    // Otherwise a member whose cohort assignment was revoked could keep probing
    // the course by editing their old comments.
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue(null);

    await expect(service.update(CTX, 'comment-1', 'x')).rejects.toMatchObject({
      status: 404,
    });
    expect(
      prisma.lessonComment.findFirst.mock.calls[0]?.[0]?.where,
    ).toMatchObject({ deletedAt: null, lesson: { deletedAt: null } });
  });
});

describe('R2.5.3 — setAnswered: admin OR the lesson author', () => {
  it('an admin may mark it answered', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      lessonId: 'lesson-1',
    });

    await service.setAnswered(ADMIN, 'comment-1', true);

    expect(prisma.lessonComment.update.mock.calls[0]?.[0]?.data).toMatchObject({
      answeredBy: ADMIN.userId,
    });
    // An admin short-circuits the author lookup entirely.
    expect(prisma.course.findFirst).not.toHaveBeenCalled();
  });

  it('🔴 the "lesson author" resolves through Course.createdBy — Lesson has no authorId', async () => {
    // Plan §1.4 gives `authorId` to `LessonComment` and to nothing else in the
    // course tree. Inventing a `Lesson.authorId` would need migration 4's slot,
    // for a distinction no current data expresses.
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      lessonId: 'lesson-1',
    });
    prisma.course.findFirst.mockResolvedValue({ createdBy: CTX.userId });

    await expect(
      service.setAnswered(CTX, 'comment-1', true),
    ).resolves.toBeDefined();
  });

  it('a non-admin non-author is 403', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      lessonId: 'lesson-1',
    });
    prisma.course.findFirst.mockResolvedValue({ createdBy: 'someone-else' });

    await expect(
      service.setAnswered(CTX, 'comment-1', true),
    ).rejects.toMatchObject({ status: 403 });
    expect(prisma.lessonComment.update).not.toHaveBeenCalled();
  });

  it('⚠️ a null Course.createdBy means ADMIN-ONLY — the live behaviour on seeded data', async () => {
    // Batch 11 writes no author, so this is the state of the seeded curriculum.
    // Said rather than discovered.
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      lessonId: 'lesson-1',
    });
    prisma.course.findFirst.mockResolvedValue({ createdBy: null });

    await expect(
      service.setAnswered(CTX, 'comment-1', true),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      service.setAnswered(ADMIN, 'comment-1', true),
    ).resolves.toBeDefined();
  });

  it('un-answering clears both columns', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findFirst.mockResolvedValue({
      id: 'comment-1',
      lessonId: 'lesson-1',
    });

    await service.setAnswered(ADMIN, 'comment-1', false);

    expect(prisma.lessonComment.update.mock.calls[0]?.[0]?.data).toEqual({
      answeredAt: null,
      answeredBy: null,
    });
  });
});

describe('listForLesson — the thread', () => {
  it('returns a tombstone WITH live children and omits a childless one', async () => {
    // Expressed in the `where` as `OR: [NOT_DELETED, { children: { some:
    // NOT_DELETED } }]` — plan §1.3's exact rule, and what makes this read
    // satisfy AD-5 honestly rather than needing an exemption.
    const { prisma, service } = wire();

    await service.listForLesson('lesson-1');

    expect(prisma.lessonComment.findMany.mock.calls[0]?.[0]?.where).toEqual({
      lessonId: 'lesson-1',
      OR: [{ deletedAt: null }, { children: { some: { deletedAt: null } } }],
    });
  });

  it('🔴 a tombstone renders a PLACEHOLDER, not an empty body', async () => {
    // Batch 7's thread page found that passing `''` to the renderer produces a
    // silently blank row that reads as a rendering bug rather than a removal.
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({
        id: 'gone',
        bodyMarkdown: 'the removed text',
        deletedAt: new Date(),
      }),
    ]);

    const [comment] = await service.listForLesson('lesson-1');

    expect(comment?.deleted).toBe(true);
    expect(comment?.bodyMarkdown).toBe(DELETED_COMMENT_PLACEHOLDER);
    expect(comment?.bodyMarkdown).not.toBe('');
    expect(comment?.authorName).toBeNull();
  });

  it('the removed text appears NOWHERE in the serialised thread', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({
        bodyMarkdown: 'UNIQUE_REMOVED_MARKER',
        deletedAt: new Date(),
      }),
    ]);

    const thread = await service.listForLesson('lesson-1');

    expect(JSON.stringify(thread)).not.toContain('UNIQUE_REMOVED_MARKER');
  });

  it('resolves author names in ONE batched, deduplicated query — never one per comment', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({ id: 'a', authorId: 'u1' }),
      commentRow({ id: 'b', authorId: 'u1' }),
      commentRow({ id: 'c', authorId: 'u2' }),
    ]);
    prisma.user.findMany.mockResolvedValue([
      { id: 'u1', firstName: 'Ada', lastName: 'Lovelace' },
      { id: 'u2', firstName: 'Alan', lastName: null },
    ]);

    const thread = await service.listForLesson('lesson-1');

    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
    expect(prisma.user.findMany.mock.calls[0]?.[0]?.where?.id?.in).toEqual([
      'u1',
      'u2',
    ]);
    expect(thread.map((c) => c.authorName)).toEqual([
      'Ada Lovelace',
      'Ada Lovelace',
      'Alan',
    ]);
  });

  it('NFR-S4 — the author lookup selects NAME ONLY, never an email', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({ authorId: 'u1' }),
    ]);

    await service.listForLesson('lesson-1');
    const select = prisma.user.findMany.mock.calls[0]?.[0]?.select;

    expect(Object.keys(select).sort()).toEqual(['firstName', 'id', 'lastName']);
    expect(select.email).toBeUndefined();
  });

  it('issues NO author query for a thread of tombstones', async () => {
    // A tombstone withholds its author, so fetching a name for one would be a
    // disclosure with a query attached to it.
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({ authorId: 'u1', deletedAt: new Date() }),
    ]);

    await service.listForLesson('lesson-1');

    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('issues no query at all for an empty thread', async () => {
    const { prisma, service } = wire();

    expect(await service.listForLesson('lesson-1')).toEqual([]);
    expect(prisma.user.findMany).not.toHaveBeenCalled();
  });

  it('R2.5.5 — the count of a thread EXCLUDES tombstones, and no counter is stored', async () => {
    // AD-11 permits exactly one denormalised counter in this task
    // (`Topic.postCount`) and this is not it: the live count is derived from
    // the rows, so there is no second number to drift.
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({ id: 'a' }),
      commentRow({ id: 'b', deletedAt: new Date() }),
      commentRow({ id: 'c' }),
    ]);

    const thread = await service.listForLesson('lesson-1');

    expect(thread.filter((c) => !c.deleted)).toHaveLength(2);
    expect(prisma.lessonComment.update).not.toHaveBeenCalled();
    expect(prisma.lesson.update).not.toHaveBeenCalled();
  });
});

describe('A-8 — no reaction vocabulary anywhere in this lib', () => {
  it('nothing under src/lib imports or mentions REACTION_TYPES', () => {
    // Lesson comments get the "Answered" treatment INSTEAD of reactions. A
    // stray import would be the first step toward a second engagement model on
    // one screen.
    const { readdirSync, readFileSync } =
      require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const libRoot = join(__dirname, '..');

    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) walk(full, acc);
        else if (entry.name.endsWith('.ts')) acc.push(full);
      }
      return acc;
    };

    // ⚠️ IT CHECKS **IMPORT STATEMENTS**, NOT ANY OCCURRENCE OF THE WORD. A raw
    // text search fails on the docblocks that explain WHY there are no
    // reactions — i.e. the more carefully a file documents the rule, the louder
    // the check breaks, which is how a structural spec earns a reputation for
    // false positives and gets deleted. Batch 6B hit exactly this with the
    // `AD-5-EXEMPT` marker in a `posts.service.ts` docblock. The identifiers
    // below can only ENTER this lib through an import, so the import is the
    // honest thing to look at.
    const BANNED = [
      'REACTION_TYPES',
      'isReactionType',
      'ReactionCounts',
      'ReactionType',
    ];
    const offenders = walk(libRoot).filter((f) => {
      const text = readFileSync(f, 'utf8');
      const imports = text.match(/import[\s\S]*?from\s+'[^']+';/g) ?? [];
      return imports.some((stmt) =>
        BANNED.some((name) => new RegExp(`\\b${name}\\b`).test(stmt)),
      );
    });

    expect(offenders).toEqual([]);
  });

  it('the wire type carries `answered`, not a count', async () => {
    const { prisma, service } = wire();
    prisma.lessonComment.findMany.mockResolvedValue([
      commentRow({ answeredAt: new Date() }),
    ]);

    const [comment] = await service.listForLesson('lesson-1');

    expect(comment?.answered).toBe(true);
    expect(Object.keys(comment ?? {})).not.toContain('reactions');
    expect(Object.keys(comment ?? {})).not.toContain('myReactions');
  });
});
