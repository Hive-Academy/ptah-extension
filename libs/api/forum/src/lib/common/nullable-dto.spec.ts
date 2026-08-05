import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import * as ts from 'typescript';

import { CreateCategoryDto } from '../categories/dto/create-category.dto';
import { UpdateCategoryDto } from '../categories/dto/update-category.dto';
import { CreatePostDto } from '../posts/dto/create-post.dto';
import { ModerateTopicDto } from '../topics/dto/moderate-topic.dto';
import { UpdateTopicDto } from '../topics/dto/update-topic.dto';

/**
 * NFR-S7 AS AN EXECUTABLE ARTEFACT — `@IsOptional()` ON A NON-NULLABLE FIELD IS
 * A 500 WAITING TO HAPPEN.
 *
 * ── THE DEFECT THIS FILE EXISTS FOR (TASK_2026_177 F-2) ─────────────────────
 * class-validator's `@IsOptional()` skips validation for BOTH `undefined` AND
 * `null`. So on a field declared `parentId?: string`, an explicit
 * `{"parentId": null}` passes every `@IsString()` / `@MinLength()` /
 * `@MaxLength()` on the property untouched and then fails somewhere below —
 * inside Prisma, or on a `.length` of `null` — as an UNHANDLED exception. The
 * client gets `500 {"statusCode":500,"message":"Internal server error"}`.
 *
 * A `null` on a member write path must be a `400` at worst. A `500` is exactly
 * the raw, uncontrolled error surface NFR-S7 exists to prevent, and it is
 * indistinguishable from a real outage in the logs.
 *
 * ⚠️ IT WAS NEVER ONE FIELD. Measured live against the running server before the
 * fix, TWELVE fields across FIVE DTOs answered `500` to an explicit `null`:
 *
 *   posts/dto/create-post.dto.ts       parentId
 *   topics/dto/update-topic.dto.ts     title, bodyMarkdown
 *   topics/dto/moderate-topic.dto.ts   pinned, locked, categoryId, title, bodyMarkdown
 *   categories/dto/update-category.dto.ts  name, visibility, cohortKeys, sortOrder
 *
 * Fixing one and leaving eleven would be worse than useless: it makes the
 * pattern look safe. That is why this file has a STRUCTURAL half as well as a
 * behavioural one — the behavioural cases pin today's twelve, the structural
 * census makes the thirteenth impossible to add.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * `@IsOptional()` is permitted ONLY on a property whose declared type includes
 * `null` — i.e. where accepting `null` is a deliberate part of the contract
 * (`description?: string | null` clears the stored value; that is the
 * `packs.service.ts` PATCH idiom and it is correct). Every other optional field
 * uses `@IsOptionalNotNull()` from `common/optional-field.ts`, which skips only
 * `undefined` and lets `null` fall through to the remaining validators — where
 * it becomes a `400` naming the property.
 *
 * ⚠️ AND THE PERMITTED ONES ARE ENUMERATED. {@link EXPECTED_NULLABLE_OPTIONALS}
 * lists every `@IsOptional()` in the lib. Adding one fails this test until the
 * constant is updated in the same change, so "accept null here" becomes a line
 * in a list a reviewer reads rather than a decorator nobody looks at twice.
 * Without the census the escape hatch would be the rule — the same reasoning
 * `soft-delete-filter.spec.ts` gives for `EXPECTED_EXEMPTIONS`.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** The decorator that skips `null` as well as `undefined`. */
const NULL_TOLERANT = 'IsOptional';

/** Its strict counterpart — skips `undefined` only. */
const NULL_STRICT = 'IsOptionalNotNull';

/**
 * EVERY property in this lib allowed to carry `@IsOptional()`, with the reason
 * its type genuinely includes `null`.
 *
 * ⚠️ BOTH ENTRIES ARE THE SAME FEATURE. `description` is the one field on a
 * category that a PATCH may CLEAR, and `null` is how a client says "clear it" —
 * distinguishable from "not supplied" only because `@IsOptional()` leaves the
 * key present. `UpdateCategoryDto`'s own docblock states this; `CreateCategoryDto`
 * mirrors it so the two shapes do not diverge.
 *
 * ⚠️ A NEW ENTRY IS A REVIEW EVENT. It means an endpoint now accepts `null` as a
 * VALUE. If the answer is "no, `null` should be rejected", the fix is
 * `@IsOptionalNotNull()`, not a line here.
 */
const EXPECTED_NULLABLE_OPTIONALS: readonly string[] = [
  'categories/dto/create-category.dto.ts:description',
  'categories/dto/update-category.dto.ts:description',
];

/**
 * Anti-vacuity floor. If the AST walk ever stops finding decorated properties —
 * a TypeScript API change, a wrong root — every assertion below passes on an
 * empty set. Counted from source on 2026-08-05: 33 decorated properties across
 * the lib's 12 DTO files. A floor, not a target.
 */
const MIN_DECORATED_PROPERTIES = 30;

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

interface DtoProperty {
  /** `<file>:<property>` — stable across machines, used in the census diff. */
  readonly key: string;
  readonly decorators: readonly string[];
  /** The declared type as written, e.g. `string | null`. `''` when untyped. */
  readonly declaredType: string;
}

interface Finding {
  readonly key: string;
  readonly detail: string;
}

function decoratorNames(node: ts.PropertyDeclaration): string[] {
  return (ts.getDecorators(node) ?? []).flatMap((decorator) => {
    const expr = decorator.expression;
    const callee = ts.isCallExpression(expr) ? expr.expression : expr;
    return ts.isIdentifier(callee) ? [callee.text] : [];
  });
}

/** Every decorated property in a DTO source file. */
function propertiesOf(label: string, text: string): DtoProperty[] {
  const source = ts.createSourceFile(
    label,
    text,
    ts.ScriptTarget.ES2021,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const found: DtoProperty[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isPropertyDeclaration(node) && ts.isIdentifier(node.name)) {
      const decorators = decoratorNames(node);
      if (decorators.length > 0) {
        found.push({
          key: `${label}:${node.name.text}`,
          decorators,
          declaredType: node.type?.getText(source) ?? '',
        });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  return found;
}

/**
 * The rule: `@IsOptional()` requires a type that includes `null`.
 *
 * PURE — takes properties, touches no disk, so the anti-vacuity block below can
 * run fabricated DTOs through this exact function rather than a second,
 * differently-buggy copy of it.
 */
function violationsIn(properties: readonly DtoProperty[]): Finding[] {
  return properties
    .filter(
      (property) =>
        property.decorators.includes(NULL_TOLERANT) &&
        !/\bnull\b/.test(property.declaredType),
    )
    .map((property) => ({
      key: property.key,
      detail:
        `${property.key} is declared \`${property.declaredType}\` — which cannot be ` +
        `null — but carries @${NULL_TOLERANT}(), and class-validator's ` +
        `@${NULL_TOLERANT}() skips validation for null AS WELL AS undefined. An ` +
        `explicit {"${property.key.split(':')[1]}": null} therefore passes every ` +
        `other validator on this property untouched and throws below the DTO as ` +
        `an unhandled exception — a 500 on a request that should be a 400 ` +
        `(NFR-S7, TASK_2026_177 F-2). Use @${NULL_STRICT}() instead, or declare ` +
        `the type nullable and list it in EXPECTED_NULLABLE_OPTIONALS.`,
    }));
}

/* -------------------------------------------------------------------------- */
/* The real source tree                                                        */
/* -------------------------------------------------------------------------- */

/** `src/lib/` — this file lives at `src/lib/common/`. */
const LIB_ROOT = resolve(__dirname, '..');

function collectDtos(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectDtos(full, acc);
    else if (entry.name.endsWith('.dto.ts')) acc.push(full);
  }
  return acc;
}

const DTO_FILES = collectDtos(LIB_ROOT);

const ALL_PROPERTIES: DtoProperty[] = DTO_FILES.flatMap((full) =>
  propertiesOf(
    full.slice(LIB_ROOT.length + 1).replace(/\\/g, '/'),
    readFileSync(full, 'utf8'),
  ),
);

/* -------------------------------------------------------------------------- */

describe('F-2 — an explicit `null` is a 400, never a 500', () => {
  describe('the structural rule over every DTO in the lib', () => {
    it('no @IsOptional() sits on a field whose type cannot be null', () => {
      // toEqual on the details, not a count: the failure NAMES the file, the
      // property and what to write instead.
      expect(violationsIn(ALL_PROPERTIES).map((v) => v.detail)).toEqual([]);
    });

    it('takes exactly the nullable optionals enumerated in the census', () => {
      const actual = ALL_PROPERTIES.filter((p) =>
        p.decorators.includes(NULL_TOLERANT),
      )
        .map((p) => p.key)
        .sort();

      expect(actual).toEqual([...EXPECTED_NULLABLE_OPTIONALS].sort());
    });

    it('every census entry really does declare a nullable type', () => {
      // The census cannot outlive its subject: if a field is narrowed to
      // non-nullable later, its entry here is dead weight and must go.
      for (const key of EXPECTED_NULLABLE_OPTIONALS) {
        const property = ALL_PROPERTIES.find((p) => p.key === key);
        expect({
          key,
          nullable: /\bnull\b/.test(property?.declaredType ?? ''),
        }).toEqual({ key, nullable: true });
      }
    });

    it('scans the DTO tree it thinks it scans (anti-vacuity)', () => {
      expect(DTO_FILES.length).toBeGreaterThanOrEqual(10);
      expect(ALL_PROPERTIES.length).toBeGreaterThanOrEqual(
        MIN_DECORATED_PROPERTIES,
      );
    });

    it('the analyser flags a fabricated violation — and clears a legal one', () => {
      // A rule that flags everything is as useless as one that flags nothing.
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:title',
          decorators: ['IsOptional', 'IsString'],
          declaredType: 'string',
        },
      ]);
      const clean = violationsIn([
        {
          key: 'p.dto.ts:description',
          decorators: ['IsOptional', 'IsString'],
          declaredType: 'string | null',
        },
        {
          key: 'p.dto.ts:title',
          decorators: [NULL_STRICT, 'IsString'],
          declaredType: 'string',
        },
        {
          key: 'p.dto.ts:name',
          decorators: ['IsString'],
          declaredType: 'string',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual(['p.dto.ts:title']);
      expect(clean).toEqual([]);
    });
  });

  /* ------------------------------------------------------------------------ */
  /* Behaviour — the twelve fields that answered 500, one case each            */
  /* ------------------------------------------------------------------------ */

  describe('the twelve fields measured at 500 now reject null at the DTO', () => {
    const invalidProps = async (
      cls: new () => object,
      payload: Record<string, unknown>,
    ): Promise<string[]> =>
      (await validate(plainToInstance(cls, payload))).map((e) => e.property);

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

  /* ------------------------------------------------------------------------ */
  /* CreatePostDto.parentId — the one field where null MEANS something         */
  /* ------------------------------------------------------------------------ */

  describe('CreatePostDto.parentId — null means "no parent", not "bad request"', () => {
    it('normalises an explicit null to undefined at the DTO boundary', () => {
      // `MemberPost.parentId` is `string | null` on the wire, so a client that
      // holds one and hands it straight back is doing a REASONABLE thing. It is
      // also the literal truth of the request: a post with no parent is a
      // top-level reply, which is precisely what omitting the key means. So this
      // is normalised rather than refused — and it is normalised HERE, once, so
      // no service below ever sees a null it was not typed to expect.
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
