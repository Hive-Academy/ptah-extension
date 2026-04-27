/**
 * Smoke spec for `nest-module-builder.ts`.
 *
 * Verifies that the harness wires MockPrisma + a mock ConfigService by
 * default, honours `config` seeds, resolves `@Inject()` tokens, and
 * applies `.overrides` per-token.
 */

import 'reflect-metadata';
import { Injectable, Inject } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createTestingNestModule } from './nest-module-builder';
import { PrismaService } from '../prisma/prisma.service';
import { createMockPrisma } from './mock-prisma.factory';

const SAMPLE_TOKEN = 'SAMPLE_TOKEN_STRING';

@Injectable()
class SampleService {
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(SAMPLE_TOKEN) private readonly extra: { tag: string },
  ) {}

  configValue(): string | undefined {
    return this.config.get<string>('HELLO');
  }

  extraTag(): string {
    return this.extra.tag;
  }

  async countUsers(): Promise<number> {
    return this.prisma.user.count();
  }
}

describe('createTestingNestModule', () => {
  it('compiles a module with Prisma + ConfigService pre-mocked and resolves @Inject tokens', async () => {
    const { module, prisma } = await createTestingNestModule({
      providers: [
        SampleService,
        { provide: SAMPLE_TOKEN, useValue: { tag: 'default' } },
      ],
      config: { HELLO: 'world' },
    });

    prisma.user.count.mockResolvedValue(42);

    const svc = module.get<SampleService>(SampleService);
    expect(svc.configValue()).toBe('world');
    await expect(svc.countUsers()).resolves.toBe(42);
    expect(svc.extraTag()).toBe('default');
  });

  it('unknown config keys fall through to the provided default', async () => {
    const { module } = await createTestingNestModule({});
    const config = module.get<ConfigService>(ConfigService);
    expect(config.get('UNSET_KEY')).toBeUndefined();
    expect(config.get<string>('UNSET_KEY', 'fallback')).toBe('fallback');
  });

  it('overrides replace providers by token', async () => {
    const { module } = await createTestingNestModule({
      providers: [
        SampleService,
        { provide: SAMPLE_TOKEN, useValue: { tag: 'default' } },
      ],
      overrides: [{ token: SAMPLE_TOKEN, useValue: { tag: 'overridden' } }],
    });

    const svc = module.get<SampleService>(SampleService);
    expect(svc.extraTag()).toBe('overridden');
  });

  it('re-uses a caller-supplied MockPrisma instance', async () => {
    const prisma = createMockPrisma();
    prisma.user.count.mockResolvedValue(7);

    const { module, prisma: returnedPrisma } = await createTestingNestModule({
      providers: [
        SampleService,
        { provide: SAMPLE_TOKEN, useValue: { tag: 'x' } },
      ],
      prisma,
    });

    expect(returnedPrisma).toBe(prisma);
    const svc = module.get<SampleService>(SampleService);
    await expect(svc.countUsers()).resolves.toBe(7);
  });

  it('factory providers receive injected deps in order', async () => {
    const BUILT = 'BUILT_TOKEN';
    const { module } = await createTestingNestModule({
      providers: [
        {
          provide: BUILT,
          useFactory: (...args: unknown[]) => {
            const cfg = args[0] as ConfigService;
            return { built: cfg.get<string>('HELLO') };
          },
          inject: [ConfigService],
        },
      ],
      config: { HELLO: 'world' },
    });

    const built = module.get<{ built: string }>(BUILT);
    expect(built.built).toBe('world');
  });

  it('throws a helpful error when a token has no provider', async () => {
    const { module } = await createTestingNestModule({});
    expect(() => module.get('NONEXISTENT_TOKEN')).toThrow(/No provider/);
  });
});
