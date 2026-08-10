import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * NFR-S7 AS AN EXECUTABLE ARTEFACT, FOR THE WHOLE OF `libs/api` — an explicit
 * `null` on a non-nullable field is a `400`, never a `500`. TASK_2026_177 F-2,
 * TASK_2026_188.
 *
 * ── WHY THIS FILE, AND WHY HERE ─────────────────────────────────────────────
 * class-validator's `@IsOptional()` skips validation for BOTH `undefined` AND
 * `null`. On a field declared `title?: string`, an explicit `{"title": null}`
 * passes every `@IsString()` / `@MinLength()` on the property UNTOUCHED — the
 * decorators are never run — and the `null` then reaches a service typed as
 * though it cannot exist, throwing there as an unhandled `500` on a request that
 * should have been a `400`. In a log that `500` is indistinguishable from a real
 * outage.
 *
 * There used to be THREE re-rooted copies of this analysis — one in `forum`, one
 * in `learning`, one inside `community/live-sessions` that scanned two hand-named
 * roots and excluded `admin-session.dto.ts` BY NAME. That per-lib shape left
 * `admin`, `identity`, `licensing`, `marketing`, `billing` and the
 * `packs` / `member-groups` / `google-sessions` corners of `community` guarded
 * by NOTHING, and a re-count found 59 live defects in exactly those blind spots.
 * TASK_2026_188 promoted the two decorators to `@ptah-api/core`
 * (`optional-field.ts`, beside `dtoPipe`) and replaced the three partial scans
 * with this ONE census that walks EVERY `*.dto.ts` under `libs/api`. There are
 * no by-name exclusions and no per-lib blind spots left.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * `@IsOptional()` is permitted ONLY on a property whose declared type includes
 * `null` — i.e. where accepting `null` is a deliberate part of the contract
 * (`description?: string | null` clears the stored column; that is the
 * `packs.service.ts` PATCH idiom and it is correct). Every other optional field
 * uses `@IsOptionalNotNull()` from `@ptah-api/core`, which skips only `undefined`
 * and lets `null` fall through to the remaining validators — where it becomes a
 * `400` naming the property.
 *
 * ⚠️ AND THE PERMITTED ONES ARE ENUMERATED. {@link EXPECTED_NULLABLE_OPTIONALS}
 * lists every `@IsOptional()` left in `libs/api`, keyed as
 * `<file>:<Class>.<property>`. Adding one fails this test until the constant is
 * updated in the same change, so "accept null here" becomes a line in a list a
 * reviewer reads rather than a decorator nobody looks at twice.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** The decorator that skips validation for `null` as well as `undefined`. */
const NULL_TOLERANT = 'IsOptional';

/** Its strict counterpart — skips `undefined` only. `@ptah-api/core`. */
const NULL_STRICT = 'IsOptionalNotNull';

/**
 * EVERY property in `libs/api` allowed to carry `@IsOptional()`, because its
 * declared type genuinely includes `null` and the endpoint uses `null` to mean
 * "clear this stored column".
 *
 * ⚠️ A NEW ENTRY IS A REVIEW EVENT. It means an endpoint now accepts `null` as a
 * VALUE. If the answer is "no, `null` should be rejected", the fix is
 * `@IsOptionalNotNull()`, not a line here.
 *
 * The first eleven were verified against source on 2026-08-09. The six under
 * `community/` were previously censused NOWHERE — the per-lib scan that owned
 * `community` did not reach `packs/` or `member-groups/` at all — and were
 * enumerated here for the first time. TASK_2026_177 Batch 14 added the
 * twelfth and thirteenth (`pack.dto.ts`'s `accessNote` pair), taking the list
 * to THIRTEEN.
 */
const EXPECTED_NULLABLE_OPTIONALS: readonly string[] = [
  // community/member-groups — `null` clears the column on PATCH groups/:id.
  'community/src/lib/member-groups/dto/member-group.dto.ts:UpdateMemberGroupDto.description',
  'community/src/lib/member-groups/dto/member-group.dto.ts:UpdateMemberGroupDto.sessionEventId',
  // community/packs — `notes` / `cohortKey` are nullable bookkeeping columns.
  'community/src/lib/packs/dto/pack.dto.ts:CreatePackDto.notes',
  'community/src/lib/packs/dto/pack.dto.ts:CreatePackDto.cohortKey',
  'community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.notes',
  'community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.cohortKey',
  // community/packs — TASK_2026_177 Batch 14 / migration 5. `access_note` is a
  // NULLABLE member-facing column (R5.5), so `null` means "clear the note I
  // wrote", the same idiom `notes` next door uses. It is NOT the same shape as
  // its Phase-5 twin: `memberVisible` is `boolean` over a `NOT NULL DEFAULT
  // false` column with no third state, so it takes `@IsOptionalNotNull()` and
  // is DELIBERATELY ABSENT from this census — a `{"memberVisible": null}` that
  // silently skipped validation would leave a pack's visibility unchanged while
  // the admin believed they had changed it, which is A-1's failure mode.
  'community/src/lib/packs/dto/pack.dto.ts:CreatePackDto.accessNote',
  'community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.accessNote',
  // forum/categories — `description` is the one field a category PATCH may clear.
  'forum/src/lib/categories/dto/create-category.dto.ts:CreateCategoryDto.description',
  'forum/src/lib/categories/dto/update-category.dto.ts:UpdateCategoryDto.description',
  // learning/courses — clear the cover image, the module blurb, the schedule.
  'learning/src/lib/courses/dto/update-course.dto.ts:UpdateCourseDto.coverImageUrl',
  'learning/src/lib/courses/dto/update-module.dto.ts:UpdateModuleDto.description',
  'learning/src/lib/courses/dto/update-module.dto.ts:UpdateModuleDto.releaseAt',
];

/**
 * Anti-vacuity floor. If the walk ever stops finding DTO files — a wrong root, a
 * TypeScript API change — every "no violations" assertion below would pass on an
 * empty set. 58 `*.dto.ts` files across eight libs as of 2026-08-09; this is a
 * floor well beneath that, not a target.
 */
const MIN_DTO_FILES = 50;

/**
 * The `libs/api` libraries that actually contain `*.dto.ts` files today.
 * Asserted individually so that "the walk reached every corner" is a checked
 * fact rather than a hope — a walk that silently stopped after the first lib
 * would still clear the file-count floor, but not this.
 *
 * `billing` is here deliberately: it carries ZERO `@IsOptional()` today, so it
 * needs COVERAGE (a future null-hole in a billing DTO must fail this suite), not
 * a sweep. Its two DTO files are what prove the root reaches it.
 *
 * 🔴 `notifications` IS THE NINTH, ADDED BY TASK_2026_177 Task 14.15 — AND THE
 * SUITE DID NOT FORCE IT.
 *
 * The per-lib reach assertion below is ONE-DIRECTIONAL: it fails when a listed
 * lib is NOT reached, and says nothing about a lib that exists and is missing
 * from this list. So `libs/api/notifications` and its
 * `list-notifications.query.dto.ts` were already being scanned for null-holes
 * from the moment Batch 14B created them — the walk is rooted at `libs/api`
 * itself and has no by-name exclusions. Adding the entry does not fix a build
 * and did not close a hole.
 *
 * What it adds is that the WALK REACHING that lib becomes a checked fact. If a
 * future refactor moved the root, renamed the directory, or made the recursion
 * skip a lib with no `lib/dto/` at the depth it expects, the new lib would drop
 * out of the census SILENTLY and every "no violations" assertion would keep
 * passing over one fewer library. A reviewer would otherwise reasonably assume
 * the suite demanded this line; it did not, and that is why the line is here.
 */
const LIBS_WITH_DTOS: readonly string[] = [
  'admin',
  'billing',
  'community',
  'forum',
  'identity',
  'learning',
  'licensing',
  'marketing',
  'notifications',
];

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

interface DtoProperty {
  /** `<file>:<Class>.<property>` — stable across machines, used in the census. */
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

/**
 * Every decorated property in a DTO source file, keyed by its enclosing class.
 *
 * Class-qualified keys matter here in a way they did not in the per-lib copies:
 * `pack.dto.ts` declares `notes` on BOTH `CreatePackDto` and `UpdatePackDto`, so
 * a `<file>:<property>` key would collide and hide one behind the other.
 */
function propertiesOf(label: string, text: string): DtoProperty[] {
  const source = ts.createSourceFile(
    label,
    text,
    ts.ScriptTarget.ES2021,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const found: DtoProperty[] = [];
  const visitClass = (cls: ts.ClassDeclaration): void => {
    const className = cls.name?.text ?? '<anonymous>';
    for (const member of cls.members) {
      if (ts.isPropertyDeclaration(member) && ts.isIdentifier(member.name)) {
        const decorators = decoratorNames(member);
        if (decorators.length > 0) {
          found.push({
            key: `${label}:${className}.${member.name.text}`,
            decorators,
            declaredType: member.type?.getText(source) ?? '',
          });
        }
      }
    }
  };
  const visit = (node: ts.Node): void => {
    if (ts.isClassDeclaration(node)) visitClass(node);
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
        `explicit {"${property.key.split('.').pop()}": null} therefore passes every ` +
        `other validator on this property untouched and reaches the service below ` +
        `the DTO unchecked — a 500 on a request that should be a 400 ` +
        `(NFR-S7, TASK_2026_177 F-2). Use @${NULL_STRICT}() from @ptah-api/core, ` +
        `or declare the type nullable and list it in EXPECTED_NULLABLE_OPTIONALS.`,
    }));
}

/* -------------------------------------------------------------------------- */
/* The real source tree — every *.dto.ts under libs/api                        */
/* -------------------------------------------------------------------------- */

/** This file lives at `libs/api/core/src/lib/common/`; four up is `libs/api`. */
const API_ROOT = resolve(__dirname, '..', '..', '..', '..');

/** Build output and dependencies are not source — never scan them. */
const SKIP_DIRS = new Set(['node_modules', 'dist', 'generated-prisma-client']);

function collectDtos(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (!SKIP_DIRS.has(entry.name)) collectDtos(join(dir, entry.name), acc);
    } else if (entry.name.endsWith('.dto.ts')) {
      acc.push(join(dir, entry.name));
    }
  }
  return acc;
}

/** Labels are relative to `libs/api`, e.g. `forum/src/lib/.../create.dto.ts`. */
const label = (full: string): string =>
  full.slice(API_ROOT.length + 1).replace(/\\/g, '/');

const DTO_FILES = collectDtos(API_ROOT).map(label);

const ALL_PROPERTIES: DtoProperty[] = DTO_FILES.flatMap((file) =>
  propertiesOf(file, readFileSync(join(API_ROOT, file), 'utf8')),
);

/* -------------------------------------------------------------------------- */

describe('F-2 — across all of libs/api, an explicit `null` is a 400, never a 500', () => {
  describe('the structural rule over every DTO under libs/api', () => {
    it('no @IsOptional() sits on a field whose type cannot be null', () => {
      // toEqual on the details, not a count: the failure NAMES the file, the
      // class, the property and what to write instead.
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
          found: property !== undefined,
          nullable: /\bnull\b/.test(property?.declaredType ?? ''),
        }).toEqual({ key, found: true, nullable: true });
      }
    });
  });

  describe('anti-vacuity — the walk really reaches the whole tree', () => {
    it(`scans at least ${MIN_DTO_FILES} real DTO files`, () => {
      // Listing the paths, not just counting them, so a failure says WHICH file
      // stopped being seen.
      const scanned = [...DTO_FILES].sort();

      expect({ count: scanned.length, scanned }).toEqual({
        count: scanned.length,
        scanned,
      });
      expect(scanned.length).toBeGreaterThanOrEqual(MIN_DTO_FILES);
    });

    it('reaches every libs/api library that contains DTOs — no per-lib blind spot', () => {
      // 🔴 THE ASSERTION THE OLD PER-LIB SCANS COULD NOT MAKE. A walk that
      // silently stopped after the first lib would clear the file-count floor
      // but fail here, naming the lib it never reached.
      for (const lib of LIBS_WITH_DTOS) {
        expect({
          lib,
          reached: DTO_FILES.some((f) => f.startsWith(`${lib}/`)),
        }).toEqual({ lib, reached: true });
      }
    });

    it('is rooted at libs/api itself, not at a single lib', () => {
      expect(API_ROOT.endsWith(`libs${sep}api`)).toBe(true);
    });

    it('the AST walk can actually see a decorated property (the parser is wired)', () => {
      // Without this, a TypeScript API change that made `getDecorators` return
      // nothing would turn every assertion above green on an empty set.
      const parsed = propertiesOf(
        'probe.dto.ts',
        `import { IsOptional, IsString } from 'class-validator';
         export class ProbeDto {
           @IsOptional()
           @IsString()
           name?: string;

           @IsString()
           slug!: string;

           notDecorated?: number;
         }`,
      );

      expect(parsed.map((p) => p.key)).toEqual([
        'probe.dto.ts:ProbeDto.name',
        'probe.dto.ts:ProbeDto.slug',
      ]);
      expect(parsed[0]?.decorators).toEqual(['IsOptional', 'IsString']);
      expect(parsed[0]?.declaredType).toBe('string');
    });

    it('keys are class-qualified, so a name reused across two DTOs does not collide', () => {
      const parsed = propertiesOf(
        'pack.dto.ts',
        `import { IsOptional } from 'class-validator';
         export class CreatePackDto { @IsOptional() notes?: string | null; }
         export class UpdatePackDto { @IsOptional() notes?: string | null; }`,
      );

      expect(parsed.map((p) => p.key)).toEqual([
        'pack.dto.ts:CreatePackDto.notes',
        'pack.dto.ts:UpdatePackDto.notes',
      ]);
    });
  });

  describe('anti-vacuity — violationsIn() actually detects each evasion', () => {
    it('flags @IsOptional() on a non-nullable field', () => {
      const flagged = violationsIn([
        {
          key: 'admin/src/lib/admin.dto.ts:ListQueryDto.search',
          decorators: ['IsOptional', 'IsString'],
          declaredType: 'string',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'admin/src/lib/admin.dto.ts:ListQueryDto.search',
      ]);
      expect(flagged[0]?.detail).toContain(NULL_STRICT);
    });

    it('flags an @IsOptional() with NO declared type at all', () => {
      // An untyped property cannot be shown to admit null, so it is flagged.
      // Being wrong in this direction costs a `@IsOptionalNotNull()`; being
      // wrong in the other costs a 500.
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:D.mystery',
          decorators: ['IsOptional'],
          declaredType: '',
        },
      ]);

      expect(flagged).toHaveLength(1);
    });

    it('flags every violation, not just the first', () => {
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:D.a',
          decorators: ['IsOptional'],
          declaredType: 'string',
        },
        {
          key: 'p.dto.ts:D.b',
          decorators: ['IsOptional'],
          declaredType: 'number',
        },
        {
          key: 'p.dto.ts:D.c',
          decorators: ['IsOptional'],
          declaredType: 'boolean',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'p.dto.ts:D.a',
        'p.dto.ts:D.b',
        'p.dto.ts:D.c',
      ]);
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing.
      const clean = violationsIn([
        // 1. a deliberate nullable optional — `null` clears the value
        {
          key: 'p.dto.ts:D.releaseAt',
          decorators: ['IsOptional', 'IsISO8601'],
          declaredType: 'string | null',
        },
        // 2. the strict decorator on a non-nullable optional — the default
        {
          key: 'p.dto.ts:D.title',
          decorators: [NULL_STRICT, 'IsString'],
          declaredType: 'string',
        },
        // 3. a required field with no optionality decorator at all
        {
          key: 'p.dto.ts:D.startsAt',
          decorators: ['IsISO8601'],
          declaredType: 'string',
        },
        // 4. nullable written the other way round
        {
          key: 'p.dto.ts:D.x',
          decorators: ['IsOptional'],
          declaredType: 'null | string',
        },
        // 5. a nullable array
        {
          key: 'p.dto.ts:D.cohortKeys',
          decorators: ['IsOptional', 'IsArray'],
          declaredType: 'string[] | null',
        },
      ]);

      expect(clean).toEqual([]);
    });

    it('does not mistake a type merely CONTAINING the letters "null"', () => {
      // `\bnull\b` and not `.includes('null')`: a type named `Annullable` or a
      // string literal union member `'nullish'` must not buy an exemption.
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:D.mode',
          decorators: ['IsOptional'],
          declaredType: "'nullish' | 'strict'",
        },
        {
          key: 'p.dto.ts:D.thing',
          decorators: ['IsOptional'],
          declaredType: 'Annullable',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'p.dto.ts:D.mode',
        'p.dto.ts:D.thing',
      ]);
    });

    it('a census entry is NOT silently free — a nullable optional still has to be listed', () => {
      // The other half of the mechanism, asserted directly so the census cannot
      // be weakened without a red test.
      const property: DtoProperty = {
        key: 'community/src/lib/packs/dto/pack.dto.ts:UpdatePackDto.notes',
        decorators: ['IsOptional', 'IsString'],
        declaredType: 'string | null',
      };

      expect(violationsIn([property])).toEqual([]);
      expect(EXPECTED_NULLABLE_OPTIONALS).toContain(property.key);
    });
  });
});
