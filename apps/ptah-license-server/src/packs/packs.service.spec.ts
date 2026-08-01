import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated-prisma-client/client';
import type { PrismaService } from '../prisma/prisma.service';
import type { AuditLogService } from '../audit/audit-log.service';
import { PacksService } from './packs.service';

/**
 * Unit tests for `PacksService` — the ADMIN-ONLY Builders pack registry.
 *
 * Focus:
 *   - `listAll` ordering, cohort include, and the FIXED search columns.
 *   - The registry gates nothing: `cohortKey` is a label, `null` is legal, and
 *     an unknown cohort filter simply yields `[]`.
 *   - Prisma failure translation: duplicate slug → 409, unknown cohort → 400,
 *     missing id → 404 — and never a raw Prisma message reaching the client.
 *   - Audit rows are written INSIDE the caller's transaction (`tx` threaded),
 *     so a pack mutation can never commit without its audit trail.
 *
 * Strategy mirrors `member-groups.service.spec.ts`: a hand-rolled Prisma mock
 * whose `$transaction(cb)` runs the callback inline with the same mock as `tx`.
 */

interface PackDelegate {
  findMany: jest.Mock;
  findUnique: jest.Mock;
  create: jest.Mock;
  update: jest.Mock;
  delete: jest.Mock;
}
interface MockPrisma {
  pack: PackDelegate;
  $transaction: jest.Mock;
}

const ROW = {
  id: 'pack_1',
  slug: 'saas-starter',
  title: 'SaaS Starter',
  description: 'A production-shaped SaaS codebase.',
  repoUrl: 'https://github.com/Hive-Academy/saas-starter',
  notes: null,
  tags: ['nestjs'],
  cohortKey: 'founding',
  createdBy: 'admin@example.com',
  createdAt: new Date('2026-08-01T10:00:00.000Z'),
  updatedAt: new Date('2026-08-01T10:00:00.000Z'),
  cohort: { name: 'Founding Members' },
};

const ACTOR = {
  email: 'admin@example.com',
  ipAddress: '203.0.113.7',
  userAgent: 'jest',
};

function createMockPrisma(): MockPrisma {
  const prisma: MockPrisma = {
    pack: {
      findMany: jest.fn().mockResolvedValue([ROW]),
      findUnique: jest.fn().mockResolvedValue(ROW),
      create: jest.fn().mockResolvedValue(ROW),
      update: jest.fn().mockResolvedValue(ROW),
      delete: jest.fn().mockResolvedValue(ROW),
    },
    $transaction: jest.fn(),
  };
  prisma.$transaction.mockImplementation(async (arg: unknown) => {
    if (typeof arg === 'function') {
      return (arg as (tx: MockPrisma) => Promise<unknown>)(prisma);
    }
    return Promise.all(arg as Promise<unknown>[]);
  });
  return prisma;
}

function build(prisma: MockPrisma) {
  const audit = { write: jest.fn().mockResolvedValue('audit-id') };
  const service = new PacksService(
    prisma as unknown as PrismaService,
    audit as unknown as AuditLogService,
  );
  return { service, audit };
}

function prismaError(code: string): Prisma.PrismaClientKnownRequestError {
  return new Prisma.PrismaClientKnownRequestError('Prisma internals', {
    code,
    clientVersion: 'test',
  });
}

describe('PacksService', () => {
  describe('listAll', () => {
    it('orders newest-first and includes the cohort name', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      const result = await service.listAll({});

      expect(prisma.pack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          orderBy: { createdAt: 'desc' },
          include: { cohort: { select: { name: true } } },
        }),
      );
      expect(result[0].cohortName).toBe('Founding Members');
      expect(result[0].createdAt).toBe('2026-08-01T10:00:00.000Z');
    });

    it('narrows by cohortKey when supplied', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      await service.listAll({ cohortKey: 'founding' });

      expect(prisma.pack.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { cohortKey: 'founding' } }),
      );
    });

    it('yields an empty list for an unknown cohort rather than erroring', async () => {
      const prisma = createMockPrisma();
      prisma.pack.findMany.mockResolvedValue([]);
      const { service } = build(prisma);

      await expect(
        service.listAll({ cohortKey: 'no-such-cohort' }),
      ).resolves.toEqual([]);
    });

    it('searches ONLY the fixed title/slug columns, never a caller-named field', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      await service.listAll({ search: 'starter' });

      const where = prisma.pack.findMany.mock.calls[0][0].where;
      expect(where.OR).toEqual([
        { title: { contains: 'starter', mode: 'insensitive' } },
        { slug: { contains: 'starter', mode: 'insensitive' } },
      ]);
      // Exactly two branches — no third column can be reached from the query.
      expect(where.OR).toHaveLength(2);
    });
  });

  describe('getById', () => {
    it('throws 404 when the pack does not exist', async () => {
      const prisma = createMockPrisma();
      prisma.pack.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(service.getById('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('create', () => {
    it('persists the row and writes the audit inside the SAME transaction', async () => {
      const prisma = createMockPrisma();
      const { service, audit } = build(prisma);

      await service.create(
        {
          slug: 'saas-starter',
          title: 'SaaS Starter',
          description: 'd',
          repoUrl: 'https://github.com/Hive-Academy/saas-starter',
        },
        ACTOR,
      );

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pack.create',
          targetType: 'Pack',
          actorEmail: 'admin@example.com',
          ipAddress: '203.0.113.7',
          userAgent: 'jest',
          // The transaction client is threaded through, so the audit row
          // commits or rolls back with the pack itself.
          tx: prisma,
        }),
      );
    });

    it('accepts a null cohortKey (an unlabelled pack is legal)', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      await service.create(
        {
          slug: 's',
          title: 't',
          description: 'd',
          repoUrl: 'https://github.com/a/b',
          cohortKey: null,
        },
        ACTOR,
      );

      expect(prisma.pack.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cohortKey: null }),
        }),
      );
    });

    it('maps a duplicate slug (P2002) to 409 without leaking the Prisma message', async () => {
      const prisma = createMockPrisma();
      prisma.pack.create.mockRejectedValue(prismaError('P2002'));
      const { service } = build(prisma);

      const promise = service.create(
        {
          slug: 'saas-starter',
          title: 't',
          description: 'd',
          repoUrl: 'https://github.com/a/b',
        },
        ACTOR,
      );

      await expect(promise).rejects.toBeInstanceOf(ConflictException);
      await expect(promise).rejects.toThrow(
        "A pack with slug 'saas-starter' already exists",
      );
      await expect(promise).rejects.not.toThrow(/Prisma internals/);
    });

    it('maps an unknown cohort FK violation (P2003) to 400', async () => {
      const prisma = createMockPrisma();
      prisma.pack.create.mockRejectedValue(prismaError('P2003'));
      const { service } = build(prisma);

      await expect(
        service.create(
          {
            slug: 's',
            title: 't',
            description: 'd',
            repoUrl: 'https://github.com/a/b',
            cohortKey: 'ghost-cohort',
          },
          ACTOR,
        ),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('update', () => {
    it('throws 404 when the pack does not exist', async () => {
      const prisma = createMockPrisma();
      prisma.pack.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(
        service.update('missing', { title: 'x' }, ACTOR),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('disconnects the cohort when cohortKey is explicitly null', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      await service.update('pack_1', { cohortKey: null }, ACTOR);

      expect(prisma.pack.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ cohort: { disconnect: true } }),
        }),
      );
    });

    it('connects the cohort label when cohortKey is supplied', async () => {
      const prisma = createMockPrisma();
      const { service } = build(prisma);

      await service.update('pack_1', { cohortKey: 'founding' }, ACTOR);

      expect(prisma.pack.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            cohort: { connect: { key: 'founding' } },
          }),
        }),
      );
    });

    it('records only the keys the admin actually supplied in the audit row', async () => {
      const prisma = createMockPrisma();
      const { service, audit } = build(prisma);

      await service.update(
        'pack_1',
        { title: 'New', description: undefined },
        ACTOR,
      );

      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pack.update',
          metadata: expect.objectContaining({ fields: ['title'] }),
        }),
      );
    });

    it('maps an unknown cohort connect (P2025) to 400', async () => {
      const prisma = createMockPrisma();
      prisma.pack.update.mockRejectedValue(prismaError('P2025'));
      const { service } = build(prisma);

      await expect(
        service.update('pack_1', { cohortKey: 'ghost-cohort' }, ACTOR),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('delete', () => {
    it('deletes and audits inside the same transaction', async () => {
      const prisma = createMockPrisma();
      prisma.pack.findUnique.mockResolvedValue({
        id: 'pack_1',
        slug: 'saas-starter',
        repoUrl: 'https://github.com/a/b',
        cohortKey: 'founding',
      });
      const { service, audit } = build(prisma);

      await expect(service.delete('pack_1', ACTOR)).resolves.toEqual({
        deleted: true,
      });
      expect(audit.write).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'pack.delete',
          targetType: 'Pack',
          tx: prisma,
        }),
      );
    });

    it('throws 404 for a missing pack rather than silently reporting success', async () => {
      const prisma = createMockPrisma();
      prisma.pack.findUnique.mockResolvedValue(null);
      const { service } = build(prisma);

      await expect(service.delete('missing', ACTOR)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(prisma.pack.delete).not.toHaveBeenCalled();
    });
  });
});
