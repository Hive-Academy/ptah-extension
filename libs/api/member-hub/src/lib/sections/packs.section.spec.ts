import type { MemberPacksService } from '@ptah-api/community';
import type { MemberContext } from '@ptah-api/membership';
import type { MemberPack } from '@ptah-contracts/community';

import { PacksSection } from './packs.section';

/**
 * `PacksSection` — R6.1, R6.3, **R6.4**, R5.1, **F-D**.
 *
 * ── 🔴 THIS FILE EXISTS BECAUSE THE STATUS IS DERIVED, NOT PINNED ─────────
 * The coarse batch text said this section becomes `'ok'` in Phase 5. F-D caught
 * that: `HUB_SECTION_STATUSES` is `['ok','empty','unavailable']` and the status
 * is a function of the data. A resolver hard-coded to `'ok'` would report "here
 * are your packs" to a member with none, which is a NEW lie standing exactly
 * where the old hard-coded `'empty'` stood — and it would pass any test that
 * only ever seeded rows. So the three cells below are asserted as a set:
 * populated, genuinely empty, and collaborator-throws.
 *
 * ⚠️ THE THIRD CELL ASSERTS A PROPAGATION, NOT A STATUS. `hub-section.ts`'s
 * port docblock is explicit that a resolver returns `'unavailable'` only for a
 * condition it can NAME, and there is no such condition here. A `try/catch`
 * would report a Postgres outage as `'empty'` and would make the composer's
 * `Promise.allSettled` — the single R6.4 fault boundary — untestable, because
 * nothing would ever reach it.
 */

function memberContext(overrides: Partial<MemberContext> = {}): MemberContext {
  return {
    userId: 'user_1',
    email: 'member@example.com',
    entitled: true,
    cohortKeys: [],
    isAdmin: false,
    ...overrides,
  };
}

function pack(overrides: Partial<MemberPack> = {}): MemberPack {
  return {
    id: 'pack_1',
    slug: 'a-pack',
    title: 'A Pack',
    description: 'The description a member reads.',
    repoUrl: 'https://github.com/x/a',
    tags: [],
    cohortName: null,
    accessNote: null,
    ...overrides,
  };
}

/** A packs service whose read genuinely answers — with rows, or with none. */
function packsService(rows: MemberPack[]): {
  service: MemberPacksService;
  list: jest.Mock;
} {
  const list = jest.fn().mockResolvedValue(rows);
  return { service: { list } as unknown as MemberPacksService, list };
}

describe('PacksSection', () => {
  describe('🔴 F-D — the status is DERIVED from the table', () => {
    it('rows present ⇒ ok, carrying the rows', async () => {
      const { service } = packsService([
        pack({ id: 'p1', cohortName: 'Founding Members' }),
        pack({ id: 'p2' }),
      ]);

      await expect(
        new PacksSection(service).resolve(memberContext()),
      ).resolves.toEqual({
        status: 'ok',
        data: [
          expect.objectContaining({ id: 'p1' }),
          expect.objectContaining({ id: 'p2' }),
        ],
      });
    });

    it('the query ran and found NOTHING ⇒ empty, with an EMPTY ARRAY (R6.3)', async () => {
      // 🔴 THE STATE OF THIS DATABASE TODAY. `packs` holds zero rows, so this is
      // the honest post-Phase-5 answer and NOT a placeholder — which is exactly
      // what F-D said the coarse "→ 'ok'" instruction got wrong.
      const { service } = packsService([]);

      await expect(
        new PacksSection(service).resolve(memberContext()),
      ).resolves.toEqual({ status: 'empty', data: [] });
    });

    it('🔴 never `null` in either status — one client renderer, three statuses', async () => {
      for (const rows of [[], [pack()]]) {
        const { service } = packsService(rows);
        const section = await new PacksSection(service).resolve(
          memberContext(),
        );

        expect(Array.isArray(section.data)).toBe(true);
      }
    });

    it('🔴 the status is not a constant — the SAME resolver answers both ways', async () => {
      // A hard-coded `'ok'` (or `'empty'`) passes one of the two cells above and
      // fails this one, which is the point of asserting them together.
      const { service, list } = packsService([]);
      const section = new PacksSection(service);

      expect((await section.resolve(memberContext())).status).toBe('empty');
      list.mockResolvedValue([pack()]);
      expect((await section.resolve(memberContext())).status).toBe('ok');
    });
  });

  describe('R6.4 — the resolver does not catch', () => {
    it('🔴 a failing collaborator PROPAGATES; it is not reported as empty', async () => {
      const service = {
        list: jest.fn().mockRejectedValue(new Error('connection refused')),
      } as unknown as MemberPacksService;

      await expect(
        new PacksSection(service).resolve(memberContext()),
      ).rejects.toThrow('connection refused');
    });

    it('does not return `unavailable` for any condition it can reach', async () => {
      // There IS no nameable unavailable condition here: `MemberPacksModule` is
      // unconditionally registered and the read is one local table. If a future
      // change introduces one, it must be NAMED — and this assertion is what
      // forces that to be a deliberate edit.
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, 'packs.section.ts'),
        'utf8',
      ) as string;

      expect(source).not.toMatch(/status:\s*'unavailable'/);
      expect(source).not.toMatch(/\btry\s*\{/);
    });
  });

  describe('NFR-S5 — the section adds no second reader of the packs table', () => {
    it('🔴 injects MemberPacksService and never touches Prisma', () => {
      // `toMemberPack` is the field-absence chokepoint. A resolver with its own
      // query would need its own mapper, and `notes` would gain a second escape
      // route — the exact hazard exit-gate clause 1 is about.
      const source = require('node:fs').readFileSync(
        require('node:path').join(__dirname, 'packs.section.ts'),
        'utf8',
      ) as string;

      expect(source).toContain('MemberPacksService');
      expect(source).not.toContain('PrismaService');
      expect(source).not.toMatch(/prisma\./);
      // …and not the ADMIN service either, which owns every mutation.
      expect(source).not.toMatch(/\bPacksService\b(?<!MemberPacksService)/);
    });

    it('passes the member context straight through, deriving nothing from it', async () => {
      // A-1: the member's cohorts play NO part in pack visibility. The section
      // must not filter, and `MemberPacksService` deliberately ignores the
      // context — asserted in that lib. Here: it is handed over unmodified.
      const { service, list } = packsService([]);
      const ctx = memberContext({ cohortKeys: ['founding'] });

      await new PacksSection(service).resolve(ctx);

      expect(list).toHaveBeenCalledTimes(1);
      expect(list.mock.calls[0]?.[0]).toBe(ctx);
    });
  });
});
