/**
 * Smoke spec for `mock-prisma.factory.ts`.
 *
 * Asserts the factory wires every model delegate declared in the Prisma
 * schema and that `$transaction` behaves like the real Prisma callback
 * variant.
 */

import {
  asTx,
  createMockPrisma,
  MODEL_KEYS,
  type MockPrisma,
} from './mock-prisma.factory';

describe('createMockPrisma', () => {
  it('exposes a jest.fn for every CRUD verb on every model', () => {
    const prisma = createMockPrisma();

    const verbs = [
      'findUnique',
      'findUniqueOrThrow',
      'findMany',
      'findFirst',
      'findFirstOrThrow',
      'create',
      'createMany',
      'update',
      'updateMany',
      'upsert',
      'delete',
      'deleteMany',
      'count',
      'aggregate',
      'groupBy',
    ] as const;

    for (const key of MODEL_KEYS) {
      const delegate = prisma[key as keyof MockPrisma] as unknown as Record<
        string,
        unknown
      >;
      expect(delegate).toBeDefined();
      for (const verb of verbs) {
        expect(jest.isMockFunction(delegate[verb])).toBe(true);
      }
    }
  });

  it('covers all schema models (user, subscription, license, failedWebhook, trialReminder, sessionRequest, adminAuditLog, marketingCampaignTemplate, marketingCampaign)', () => {
    expect([...MODEL_KEYS].sort()).toEqual(
      [
        'adminAuditLog',
        'failedWebhook',
        'license',
        'marketingCampaign',
        'marketingCampaignTemplate',
        'sessionRequest',
        'subscription',
        'trialReminder',
        'user',
      ].sort(),
    );
  });

  it('$transaction invokes callback with the same mock instance', async () => {
    const prisma = createMockPrisma();
    prisma.user.findMany.mockResolvedValue([{ id: 'u1' }]);

    const result = await prisma.$transaction(async (tx: MockPrisma) => {
      // tx should share state with the outer mock.
      return tx.user.findMany();
    });

    expect(result).toEqual([{ id: 'u1' }]);
    expect(prisma.user.findMany).toHaveBeenCalledTimes(1);
  });

  it('$transaction supports the array variant via Promise.all', async () => {
    const prisma = createMockPrisma();
    const p1 = Promise.resolve('a');
    const p2 = Promise.resolve('b');

    const result = await prisma.$transaction([p1, p2]);

    expect(result).toEqual(['a', 'b']);
  });

  it('overrides are applied shallow-per-model', () => {
    const customCreate = jest.fn().mockResolvedValue({ id: 'x' });
    const prisma = createMockPrisma({
      user: {
        create: customCreate as unknown as jest.Mock,
      },
    });

    expect(prisma.user.create).toBe(customCreate);
    // Other verbs preserved.
    expect(jest.isMockFunction(prisma.user.findMany)).toBe(true);
  });

  it('asTx returns the mock typed as a Prisma TransactionClient', () => {
    const prisma = createMockPrisma();
    const tx = asTx(prisma);
    // Runtime identity — the helper is a type-only cast.
    expect(tx).toBe(prisma);
  });
});
