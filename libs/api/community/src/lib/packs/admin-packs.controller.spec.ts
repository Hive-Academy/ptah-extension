import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import type { Request } from 'express';
import { AdminPacksController } from './admin-packs.controller';
import type { PacksService } from './packs.service';
import { CreatePackDto, UpdatePackDto } from './dto/pack.dto';

/**
 * Unit tests for `AdminPacksController` and the pack DTO validation contract.
 *
 * Focus:
 *   - CRUD happy paths delegate to the service with the actor context the audit
 *     trail needs (`actorEmail`, `ipAddress`, `userAgent`).
 *   - The `repoUrl` GitHub regex actually rejects a `javascript:` URI and any
 *     non-GitHub host. This is leak risk L4 — the value is rendered as an
 *     `<a [href]>` in the admin console, so an unconstrained string is a
 *     stored-XSS vector against a high-value target.
 *   - Unknown properties are rejected (`forbidNonWhitelisted`).
 *
 * NOTE on how the DTO assertions are written: they run `class-validator`
 * DIRECTLY rather than through Nest's request pipeline. That is deliberate —
 * `emitDecoratorMetadata` is not emitted by esbuild, so the globally-registered
 * ValidationPipe cannot infer these DTO types at runtime. The controller works
 * around that by binding each DTO explicitly via `dtoPipe(...)`; these tests
 * assert the decorators themselves are correct, and the live smoke coverage in
 * the implementation report proves the wiring end-to-end.
 */

function buildController() {
  const packs = {
    listAll: jest.fn().mockResolvedValue([]),
    getById: jest.fn().mockResolvedValue({ id: 'pack_1' }),
    create: jest.fn().mockResolvedValue({ id: 'pack_1' }),
    update: jest.fn().mockResolvedValue({ id: 'pack_1' }),
    delete: jest.fn().mockResolvedValue({ deleted: true }),
  };
  const controller = new AdminPacksController(packs as unknown as PacksService);
  return { controller, packs };
}

function req(email = 'admin@example.com'): Request {
  return {
    user: { id: 'u1', email },
    ip: '203.0.113.7',
    get: (header: string) =>
      header === 'user-agent' ? 'jest-agent' : undefined,
  } as unknown as Request;
}

async function errorsFor<T extends object>(
  cls: new () => T,
  payload: Record<string, unknown>,
): Promise<string[]> {
  const dto = plainToInstance(cls, payload, {
    enableImplicitConversion: false,
  });
  const errors = await validate(dto as object, {
    whitelist: true,
    forbidNonWhitelisted: true,
  });
  return errors.map((e) => e.property);
}

const VALID_CREATE = {
  slug: 'saas-starter',
  title: 'SaaS Starter',
  description: 'A production-shaped SaaS codebase.',
  repoUrl: 'https://github.com/Hive-Academy/saas-starter',
};

describe('AdminPacksController', () => {
  describe('CRUD delegation', () => {
    it('lists packs with the supplied filters', async () => {
      const { controller, packs } = buildController();

      await controller.list({ search: 'saas', cohortKey: 'founding' });

      expect(packs.listAll).toHaveBeenCalledWith({
        search: 'saas',
        cohortKey: 'founding',
      });
    });

    it('threads actor email, ip and user-agent into create for the audit trail', async () => {
      const { controller, packs } = buildController();

      await controller.create(req(), VALID_CREATE as CreatePackDto);

      expect(packs.create).toHaveBeenCalledWith(
        expect.objectContaining({ slug: 'saas-starter' }),
        {
          email: 'admin@example.com',
          ipAddress: '203.0.113.7',
          userAgent: 'jest-agent',
        },
      );
    });

    it('normalises omitted optional fields on create', async () => {
      const { controller, packs } = buildController();

      await controller.create(req(), VALID_CREATE as CreatePackDto);

      expect(packs.create).toHaveBeenCalledWith(
        expect.objectContaining({ notes: null, tags: [], cohortKey: null }),
        expect.anything(),
      );
    });

    it('delegates update and delete with the actor context', async () => {
      const { controller, packs } = buildController();

      await controller.update(req(), 'pack_1', { title: 'x' } as UpdatePackDto);
      await controller.remove(req(), 'pack_1');

      expect(packs.update).toHaveBeenCalledWith(
        'pack_1',
        { title: 'x' },
        expect.objectContaining({ email: 'admin@example.com' }),
      );
      expect(packs.delete).toHaveBeenCalledWith(
        'pack_1',
        expect.objectContaining({ email: 'admin@example.com' }),
      );
    });
  });

  describe('repoUrl validation (leak risk L4 — stored XSS into the admin console)', () => {
    it('accepts a canonical GitHub repo URL', async () => {
      await expect(errorsFor(CreatePackDto, VALID_CREATE)).resolves.toEqual([]);
    });

    it.each([
      ['javascript: URI', 'javascript:alert(1)'],
      ['javascript: URI with newline evasion', 'java\nscript:alert(1)'],
      ['data: URI', 'data:text/html;base64,PHNjcmlwdD4='],
      ['non-GitHub host', 'https://evil.com/owner/repo'],
      ['GitHub lookalike host', 'https://github.com.evil.com/owner/repo'],
      ['plain http GitHub', 'http://github.com/owner/repo'],
      ['deep path beyond owner/repo', 'https://github.com/owner/repo/settings'],
    ])('rejects %s', async (_label, repoUrl) => {
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, repoUrl }),
      ).resolves.toContain('repoUrl');
    });

    it('rejects the same values on UpdatePackDto', async () => {
      await expect(
        errorsFor(UpdatePackDto, { repoUrl: 'javascript:alert(1)' }),
      ).resolves.toContain('repoUrl');
    });
  });

  describe('DTO surface', () => {
    it('rejects an unknown property (forbidNonWhitelisted)', async () => {
      // `published` was deliberately dropped from the model — if it ever
      // reappears on the wire, that is a design regression, not a new field.
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, published: true }),
      ).resolves.toContain('published');
    });

    it('rejects a non-slug slug', async () => {
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, slug: 'Not A Slug!' }),
      ).resolves.toContain('slug');
    });

    it('accepts a 64-character slug and rejects a 65-character one', async () => {
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, slug: 'a'.repeat(64) }),
      ).resolves.toEqual([]);
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, slug: 'a'.repeat(65) }),
      ).resolves.toContain('slug');
    });

    it('rejects a cohortKey that is not a member-group slug', async () => {
      await expect(
        errorsFor(CreatePackDto, { ...VALID_CREATE, cohortKey: 'NOT VALID' }),
      ).resolves.toContain('cohortKey');
    });

    it('caps tags at 20 entries', async () => {
      await expect(
        errorsFor(CreatePackDto, {
          ...VALID_CREATE,
          tags: Array.from({ length: 21 }, (_, i) => `t${i}`),
        }),
      ).resolves.toContain('tags');
    });
  });
});
