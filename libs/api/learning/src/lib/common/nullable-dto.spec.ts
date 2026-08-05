import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * NFR-S7 AS AN EXECUTABLE ARTEFACT, FOR `libs/api/learning` — `@IsOptional()` ON
 * A NON-NULLABLE FIELD IS A 500 WAITING TO HAPPEN.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/nullable-dto.spec.ts`. This is
 * a RE-ROOTED COPY of it, not a shared analyser. A fix to one WILL NOT reach the
 * other — if you change the analysis logic here, read that file and decide
 * whether it needs the same change. See `soft-delete-filter.spec.ts` in this
 * directory for the full argument for copying rather than widening; it applies
 * verbatim.
 *
 * ── THE DEFECT THIS FILE EXISTS FOR (TASK_2026_177 F-2) ─────────────────────
 * class-validator's `@IsOptional()` skips validation for BOTH `undefined` AND
 * `null`. So on a field declared `releaseAt?: string`, an explicit
 * `{"releaseAt": null}` passes every `@IsString()` / `@IsDateString()` on the
 * property UNTOUCHED — the decorators are not merely satisfied, they are never
 * run — and the `null` then reaches a service typed as though it cannot exist.
 * It throws there, below the boundary, as an UNHANDLED exception. The client
 * gets `500 {"statusCode":500,"message":"Internal server error"}`.
 *
 * A `null` on a member or admin write path must be a `400` at worst. A `500` is
 * exactly the raw, uncontrolled error surface NFR-S7 exists to prevent, and in
 * a log it is indistinguishable from a real outage.
 *
 * ⚠️ IN THE FORUM IT WAS NEVER ONE FIELD. Measured live against the running
 * server, TWELVE fields across FIVE DTOs answered `500` to an explicit `null`,
 * and Batch 6.1 swept them. Fixing one and leaving eleven would have been worse
 * than useless: it makes the pattern look inspected. THIS LIB HAS NOT WRITTEN
 * ITS DTOS YET, which is the whole reason this file lands BEFORE them rather
 * than after.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * `@IsOptional()` is permitted ONLY on a property whose declared type includes
 * `null` — i.e. where accepting `null` is a deliberate part of the contract
 * (`description?: string | null` clears the stored value). Every other optional
 * field uses `@IsOptionalNotNull()`, which skips only `undefined` and lets
 * `null` fall through to the remaining validators, where it becomes a `400`
 * naming the property.
 *
 * 🔴 WHERE `IsOptionalNotNull` COMES FROM IN THIS LIB — A DECISION, RECORDED
 * HERE BECAUSE THIS IS WHERE THE NEXT PERSON WILL LOOK.
 * It is **re-declared** in `libs/api/learning/src/lib/common/optional-field.ts`,
 * NOT imported from `@ptah-api/forum`. The forum's copy lives in its
 * `common/`, which `forum.module.spec.ts` asserts is NOT barrel-exported — and
 * that assertion is load-bearing, because `NOT_DELETED` leaving that lib would
 * let a consumer hand-build a `where` and read the forum past every visibility
 * clause. Widening the forum's public barrel for two decorators is a worse
 * trade than ~20 duplicated lines. The file was created by Batch 9B (which
 * needed it for nothing but recorded the decision in the tree) and is used by
 * every DTO Batch 9C wrote.
 *
 * ⚠️ AND THE PERMITTED ONES ARE ENUMERATED. {@link EXPECTED_NULLABLE_OPTIONALS}
 * lists every `@IsOptional()` in the lib. Adding one fails this test until the
 * constant is updated in the same change, so "accept null here" becomes a line
 * in a list a reviewer reads rather than a decorator nobody looks at twice.
 *
 * ⚠️ CURRENT COVERAGE — READ THIS BEFORE TRUSTING A GREEN RUN.
 * Batch 9C landed this lib's sixteen DTO classes across fourteen `*.dto.ts`
 * files, so the real-tree scan is no longer vacuous: it walks every one of them,
 * finds {@link MIN_DTO_FILES} or more, and takes exactly THREE nullable
 * optionals — every other optional field in the lib uses `@IsOptionalNotNull()`.
 *
 * (Batch 9A's version of this paragraph said the scan "finds ZERO files today
 * and its 'no violations' assertion is honestly vacuous". That became false the
 * moment the DTOs landed. It is rewritten rather than appended to: a count in
 * prose that no assertion keeps honest is exactly the hazard `EXPECTED_ROUTES`'s
 * docblock is called out for.)
 *
 * This spec was proven to fail on the REAL TREE before it was trusted: a
 * throwaway `courses/dto/tmp-proof.dto.ts` carrying `@IsOptional() @IsString()
 * name?: string` was staged, this spec failed and named the property by path,
 * and the file was then deleted and the suite re-confirmed green.
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
 * 🔴 IT HOLDS **THREE** ENTRIES AFTER BATCH 9C, AND BATCH 9A EXPECTED ZERO.
 * That prediction was wrong in the same shape Batch 6C's `EXPECTED_EXEMPTIONS`
 * prediction was wrong (it said one entry; two were unavoidable). Task 9.15's
 * own text names the three candidates — `Course.coverImageUrl`,
 * `CourseModule.description`, `CourseModule.releaseAt` — and says "each one
 * added is a line a reviewer reads". These are those three, and each is argued
 * individually below rather than accepted as a group.
 *
 * ⚠️ ALL THREE ARE ON **UPDATE** DTOs, AND NONE IS ON A CREATE DTO. That is the
 * distinction that keeps the list at three: on a create, "no cover image" and
 * "the key was omitted" are the same request and there is nothing to clear, so
 * `CreateCourseDto.coverImageUrl`, `CreateModuleDto.description` and
 * `CreateModuleDto.releaseAt` all use `@IsOptionalNotNull()`. `null` only earns
 * an entry where CLEARING AN EXISTING VALUE is a request the endpoint must be
 * able to express.
 *
 * ⚠️ A FOURTH WAS PREDICTED BY BATCH 9B AND IS DELIBERATELY NOT HERE.
 * `UpdateLessonDto.youtubeVideoId` (`null` = "detach the video") is a real
 * requirement, but `LessonVideoService.resolveVideoColumns` already treats an
 * EMPTY string exactly as it treats an absent one — it returns `NO_VIDEO` and
 * clears all five video columns — so the tri-state is expressible without
 * `null`, and adding one would be a fourth spelling of a meaning that already
 * has three. See `UpdateLessonDto`'s docblock.
 *
 * ⚠️ A NEW ENTRY IS A REVIEW EVENT. It means an endpoint now accepts `null` as
 * a VALUE. If the answer is "no, `null` should be rejected", the fix is
 * `@IsOptionalNotNull()`, not a line here. `UpdateCourseDto.title` is the
 * archetypal refusal: `null` there would have to mean "clear the title", which
 * is not a state a course may be in.
 */
const EXPECTED_NULLABLE_OPTIONALS: readonly string[] = [
  // `null` = "remove the cover image I set last week". `''` is not a substitute:
  // an empty string in a nullable column renders as a broken `<img src="">`
  // rather than as no image.
  'courses/dto/update-course.dto.ts:coverImageUrl',
  // `null` = "remove this module's description". `''` renders as an empty
  // paragraph rather than as no paragraph, and the two are visibly different in
  // the outline.
  'courses/dto/update-module.dto.ts:description',
  // 🔴 The clearest of the three. `null` = "UNSCHEDULE this module — open it
  // now" (R2.4.1), which `CoursesService.updateModule` already implements. There
  // is no other spelling: omitting the key means "leave the schedule alone",
  // `''` is not a date, and a far-past timestamp would be a lie in the audit
  // trail about when the module was actually opened.
  'courses/dto/update-module.dto.ts:releaseAt',
];

/**
 * Anti-vacuity floor for the DTO scan.
 *
 * 🔴 THIS REPLACES BATCH 9A's "the loader can see `common/`" GUARD AS THE THING
 * THAT MAKES A GREEN RUN MEAN SOMETHING. While the lib had no DTOs, `>= 0` was
 * the only honest bound and the loader check was all there was. Now that twelve
 * `*.dto.ts` files exist, a scan finding none of them means the walk broke — and
 * every "no violations" assertion above would go silently vacuous again, which
 * is precisely how a census stops covering the surface it was written for.
 *
 * FOURTEEN files as of Batch 9C: nine under `courses/dto/`, two under
 * `progress/dto/`, three under `comments/dto/`. They declare SIXTEEN classes,
 * because `reorder.dto.ts` holds three — one per parent scope; see its docblock
 * for why they are not one class with an optional parent id.
 */
const MIN_DTO_FILES = 14;

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

describe('F-2 — in api-learning, an explicit `null` is a 400, never a 500', () => {
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

    it('is rooted at src/lib and can see common/ — the loader is not pointed at nothing', () => {
      // Batch 9A wrote this when the lib had no DTOs at all: the forum sibling
      // asserts `DTO_FILES.length >= 10`, which could not be written here
      // without being a lie, so this replaced it. It fails if the loader is ever
      // pointed at a directory it cannot see — the failure mode that would make
      // the scan cover nothing FOREVER rather than only until 9B/9C.
      const dirs = readdirSync(LIB_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(LIB_ROOT.endsWith(`src${sep}lib`)).toBe(true);
      expect(dirs).toContain('common');
    });

    it(`scans at least ${MIN_DTO_FILES} real DTO files (the bound 9A could not write)`, () => {
      // 🔴 THE ANTI-VACUITY GUARD THAT MATTERS NOW. Batch 9C landed the DTOs, so
      // the forum sibling's bound is finally expressible here — and it is the
      // one that catches the real failure: a walk that silently matches nothing
      // turns every "no violations" assertion above green on an empty set.
      // Listing the paths, not just counting them, so a failure says WHICH file
      // stopped being seen.
      const scanned = DTO_FILES.map((full) =>
        full.slice(LIB_ROOT.length + 1).replace(/\\/g, '/'),
      ).sort();

      expect({ count: scanned.length, scanned }).toEqual({
        count: scanned.length,
        scanned,
      });
      expect(scanned.length).toBeGreaterThanOrEqual(MIN_DTO_FILES);
      // …and the walk really did reach all three DTO directories, not just the
      // first one it found.
      expect(scanned.some((f) => f.startsWith('courses/dto/'))).toBe(true);
      expect(scanned.some((f) => f.startsWith('progress/dto/'))).toBe(true);
      expect(scanned.some((f) => f.startsWith('comments/dto/'))).toBe(true);
    });

    it('the AST walk can actually see a decorated property (the parser is wired)', () => {
      // Without this, a TypeScript API change that made `getDecorators` return
      // nothing would turn every assertion above green on an empty set, and
      // there would be no real DTO in the tree to notice.
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
        'probe.dto.ts:name',
        'probe.dto.ts:slug',
      ]);
      expect(parsed[0]?.decorators).toEqual(['IsOptional', 'IsString']);
      expect(parsed[0]?.declaredType).toBe('string');
    });
  });

  describe('anti-vacuity — violationsIn() actually detects each evasion', () => {
    it('flags @IsOptional() on a non-nullable field', () => {
      const flagged = violationsIn([
        {
          key: 'courses/dto/update-course.dto.ts:title',
          decorators: ['IsOptional', 'IsString'],
          declaredType: 'string',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'courses/dto/update-course.dto.ts:title',
      ]);
      expect(flagged[0]?.detail).toContain(NULL_STRICT);
    });

    it('flags an @IsOptional() with NO declared type at all', () => {
      // An untyped property cannot be shown to admit null, so it is flagged.
      // Being wrong in this direction costs a `@IsOptionalNotNull()`; being
      // wrong in the other costs a 500.
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:mystery',
          decorators: ['IsOptional'],
          declaredType: '',
        },
      ]);

      expect(flagged).toHaveLength(1);
    });

    it('flags every violation in a file, not just the first', () => {
      const flagged = violationsIn([
        {
          key: 'p.dto.ts:a',
          decorators: ['IsOptional'],
          declaredType: 'string',
        },
        {
          key: 'p.dto.ts:b',
          decorators: ['IsOptional'],
          declaredType: 'number',
        },
        {
          key: 'p.dto.ts:c',
          decorators: ['IsOptional'],
          declaredType: 'boolean',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'p.dto.ts:a',
        'p.dto.ts:b',
        'p.dto.ts:c',
      ]);
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing.
      const clean = violationsIn([
        // 1. the deliberate nullable optional — `null` clears the value
        {
          key: 'courses/dto/update-module.dto.ts:releaseAt',
          decorators: ['IsOptional', 'IsDateString'],
          declaredType: 'string | null',
        },
        // 2. the strict decorator on a non-nullable optional — the default
        {
          key: 'courses/dto/update-course.dto.ts:title',
          decorators: [NULL_STRICT, 'IsString'],
          declaredType: 'string',
        },
        // 3. a required field with no optionality decorator at all
        {
          key: 'courses/dto/create-course.dto.ts:slug',
          decorators: ['IsString', 'MaxLength'],
          declaredType: 'string',
        },
        // 4. nullable written the other way round
        {
          key: 'p.dto.ts:x',
          decorators: ['IsOptional'],
          declaredType: 'null | string',
        },
        // 5. a nullable array
        {
          key: 'p.dto.ts:cohortKeys',
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
          key: 'p.dto.ts:mode',
          decorators: ['IsOptional'],
          declaredType: "'nullish' | 'strict'",
        },
        {
          key: 'p.dto.ts:thing',
          decorators: ['IsOptional'],
          declaredType: 'Annullable',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'p.dto.ts:mode',
        'p.dto.ts:thing',
      ]);
    });

    it('a census entry is NOT silently free — a nullable optional still has to be listed', () => {
      // The other half of the mechanism, asserted directly so the census cannot
      // be weakened without a red test. `violationsIn` clears this property
      // (its type admits null), and the real-tree census would then fail
      // because it is absent from EXPECTED_NULLABLE_OPTIONALS.
      const property: DtoProperty = {
        key: 'courses/dto/update-lesson.dto.ts:youtubeVideoId',
        decorators: ['IsOptional', 'IsString'],
        declaredType: 'string | null',
      };

      expect(violationsIn([property])).toEqual([]);
      expect(EXPECTED_NULLABLE_OPTIONALS).not.toContain(property.key);
    });
  });
});
