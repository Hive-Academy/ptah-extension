import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { CreateCategoryDto } from '../categories/dto/create-category.dto';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { ModerateTopicDto } from '../topics/dto/moderate-topic.dto';
import { UpdateTopicDto } from '../topics/dto/update-topic.dto';

/**
 * NFR-S7 AS BEHAVIOUR — the forum DTOs that were MEASURED at `500` on an
 * explicit `null` now reject it at the boundary. TASK_2026_177 F-2, Batch 6.1.
 *
 * ⚠️ THE STRUCTURAL CENSUS MOVED. The "no `@IsOptional()` on a non-nullable
 * field, anywhere" scan is no longer re-rooted per lib; it lives ONCE in
 * `@ptah-api/core` (`libs/api/core/src/lib/common/nullable-dto.spec.ts`) and
 * walks every `*.dto.ts` under `libs/api`, this lib included (TASK_2026_188).
 * What stays here is the half that cannot move: BEHAVIOURAL proof against the
 * real forum DTO classes, which `core` cannot import without inverting the
 * dependency direction. These are the twelve fields Phase 2 measured returning
 * `500`, pinned one case each, plus the one field where `null` is normalised
 * rather than refused.
 */

describe('F-2 — the forum DTOs reject (or normalise) an explicit null', () => {
  const invalidProps = async (
    cls: new () => object,
    payload: Record<string, unknown>,
  ): Promise<string[]> =>
    (await validate(plainToInstance(cls, payload))).map((e) => e.property);

  describe('the twelve fields measured at 500 now reject null at the DTO', () => {
    it.each([
      [UpdateTopicDto, 'title'],
      [UpdateTopicDto, 'bodyMarkdown'],
      [ModerateTopicDto, 'pinned'],
      [ModerateTopicDto, 'locked'],
      [ModerateTopicDto, 'categoryId'],
      [ModerateTopicDto, 'title'],
      [ModerateTopicDto, 'bodyMarkdown'],
      [UpdateCategoryDto, 'name'],
      [UpdateCategoryDto, 'visibility'],
      [UpdateCategoryDto, 'cohortKeys'],
      [UpdateCategoryDto, 'sortOrder'],
    ] as ReadonlyArray<readonly [new () => object, string]>)(
      '%p.%s: null is a validation error, not an unhandled exception',
      async (cls, field) => {
        expect(await invalidProps(cls, { [field]: null })).toEqual([field]);
      },
    );

    it('an OMITTED field is still accepted — the rule rejects null, not optionality', async () => {
      expect(
        await invalidProps(UpdateTopicDto, { title: 'a new title' }),
      ).toEqual([]);
      expect(await invalidProps(ModerateTopicDto, { pinned: true })).toEqual(
        [],
      );
      expect(
        await invalidProps(UpdateCategoryDto, { name: 'General' }),
      ).toEqual([]);
    });

    it('`description: null` still CLEARS on both category DTOs (the deliberate case)', async () => {
      // The census entries, asserted as behaviour rather than as source text.
      expect(
        await invalidProps(UpdateCategoryDto, { description: null }),
      ).toEqual([]);
      expect(
        await invalidProps(CreateCategoryDto, {
          slug: 'general',
          name: 'General',
          visibility: 'member',
          description: null,
        }),
      ).toEqual([]);
    });
  });

  describe('CreatePostDto.parentId — null means "no parent", not "bad request"', () => {
    it('normalises an explicit null to undefined at the DTO boundary', () => {
      // A post with no parent is a top-level reply, which is precisely what
      // omitting the key means — so this is normalised once, here, rather than
      // refused, and no service below ever sees a null it was not typed for.
      const dto = plainToInstance(CreatePostDto, {
        bodyMarkdown: 'a top-level reply',
        parentId: null,
      });

      expect(dto.parentId).toBeUndefined();
    });

    it('the normalised body validates cleanly', async () => {
      const errors = await validate(
        plainToInstance(CreatePostDto, {
          bodyMarkdown: 'a top-level reply',
          parentId: null,
        }),
      );

      expect(errors.map((e) => e.property)).toEqual([]);
    });

    it('a real parentId is untouched', () => {
      const dto = plainToInstance(CreatePostDto, {
        bodyMarkdown: 'a nested reply',
        parentId: 'post-1',
      });

      expect(dto.parentId).toBe('post-1');
    });

    it('an omitted parentId stays undefined — indistinguishable from an explicit null', () => {
      const omitted = plainToInstance(CreatePostDto, { bodyMarkdown: 'x' });
      const explicitNull = plainToInstance(CreatePostDto, {
        bodyMarkdown: 'x',
        parentId: null,
      });

      expect(omitted.parentId).toBe(explicitNull.parentId);
    });

    it('a non-string parentId is still a 400 — normalising null did not open the field', async () => {
      const errors = await validate(
        plainToInstance(CreatePostDto, { bodyMarkdown: 'x', parentId: 42 }),
      );

      expect(errors.map((e) => e.property)).toEqual(['parentId']);
    });

    it('an empty-string parentId is still a 400', async () => {
      const errors = await validate(
        plainToInstance(CreatePostDto, { bodyMarkdown: 'x', parentId: '' }),
      );

      expect(errors.map((e) => e.property)).toEqual(['parentId']);
    });
  });
});
