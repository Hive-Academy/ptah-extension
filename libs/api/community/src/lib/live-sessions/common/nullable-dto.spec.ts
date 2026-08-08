import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * F-2 AS AN EXECUTABLE ARTEFACT, FOR THE PHASE-4 DTOs OF
 * `libs/api/community` — an explicit `null` is a `400`, never a `500`.
 *
 * ⚠️ SIBLING FILES — a RE-ROOTED COPY of both, not a shared analyser:
 *   - `libs/api/forum/src/lib/common/nullable-dto.spec.ts`
 *   - `libs/api/learning/src/lib/common/nullable-dto.spec.ts`
 * The three must change together.
 *
 * ── 🔴 THE SCAN COVERS TWO ROOTS, AND DELIBERATELY NOT THE LIB ─────────────
 *
 * `live-sessions/**` and `google-sessions/dto/` — the two places this batch puts
 * a DTO. The lib-wide scan its two siblings perform CANNOT be copied here, and
 * the reason is a fact about the tree rather than a preference:
 *
 *   `packs/dto/pack.dto.ts`, `member-groups/dto/member-group.dto.ts` and
 *   `google-sessions/dto/admin-session.dto.ts` all predate F-2 and carry
 *   `@IsOptional()` on ~30 non-nullable fields between them. A lib-wide scan
 *   would open with a census of thirty legacy entries, which is not a census —
 *   it is a list nobody reads, and a new violation hiding in it is invisible.
 *
 * ⚠️ SO THE PRE-PHASE-4 DTOs ARE OUT OF SCOPE, AND SWEEPING THEM IS A SEPARATE
 * PIECE OF WORK. Recorded here rather than silently skipped: those endpoints
 * have the same `{"description": null} -> 500` hole Batch 6.1 swept out of the
 * forum, and closing it is ~30 decorator swaps plus a live re-check. It is not
 * this batch's file set.
 *
 * ⚠️ THE ONE LEGACY FILE INSIDE A SCANNED ROOT IS NAMED, NOT GLOBBED. Task
 * 12.10 puts the session-request DTOs in `google-sessions/dto/`, which already
 * contains `admin-session.dto.ts` (TASK_2026_169). That file is excluded BY
 * NAME in {@link LEGACY_DTO_FILES} — so a NEW file dropped into that directory
 * is covered automatically, which is the property an exclusion by glob would
 * lose.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/** The decorator that skips validation for `null` as well as `undefined`. */
const NULL_TOLERANT = 'IsOptional';

/** The decorator that does not — this directory's `optional-field.ts`. */
const NULL_STRICT = 'IsOptionalNotNull';

/**
 * Pre-Phase-4 DTO files inside a scanned root, excluded BY NAME.
 *
 * ⚠️ ONE ENTRY, AND IT IS A DEBT MARKER RATHER THAN AN EXEMPTION.
 * `admin-session.dto.ts` (TASK_2026_169) carries `@IsOptional()` on eleven
 * non-nullable fields — `description?: string`, `startsAt?: string`,
 * `attendees?: string[]` and so on — every one of which is a `{"field": null}`
 * → `500` on `PATCH /v1/admin/sessions/:eventId`. Real, pre-existing, and not
 * this batch's file. Sweeping it is a `@IsOptionalNotNull()` swap plus a live
 * re-check of that endpoint.
 *
 * 🔴 ADDING A SECOND ENTRY IS NOT AN OPTION FOR NEW WORK. This list names files
 * that existed before the rule; a file written after it belongs in the scan.
 */
const LEGACY_DTO_FILES: readonly string[] = [
  'google-sessions/dto/admin-session.dto.ts',
];

/**
 * Every field in the scanned roots where `@IsOptional()` is CORRECT because
 * `null` is a real value the endpoint must be able to receive.
 *
 * 🔴 IT IS `[]` AND IT SHOULD STAY `[]`.
 *
 * The Phase-4 write surfaces have no "clear this value" request. On
 * `UpdateLiveSessionDto` every field is either required-if-present
 * (`title`, `startsAt`, `visibility`) or has an EMPTY-STRING spelling that
 * already means "detach" — `youtubeVideoId: ''` clears the whole video block
 * through the same resolver the lessons path uses, so a `null` would be a second
 * spelling of a meaning that already has one. On the session-request DTOs
 * `declineReason` is optional-and-absent, never optional-and-null: a decline
 * with no reason omits the key.
 *
 * ⚠️ A NEW ENTRY IS A REVIEW EVENT. It means an endpoint now accepts `null` as a
 * VALUE. If the answer is "no, `null` should be rejected", the fix is
 * `@IsOptionalNotNull()`, not a line here.
 */
const EXPECTED_NULLABLE_OPTIONALS: readonly string[] = [];

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

/** `src/lib/live-sessions/` — this file lives at `live-sessions/common/`. */
const LIVE_ROOT = resolve(__dirname, '..');
/** `src/lib/` — the anchor both scanned roots hang off. */
const LIB_ROOT = resolve(LIVE_ROOT, '..');
/** The other root: Task 12.10's session-request DTOs. */
const GOOGLE_DTO_ROOT = join(LIB_ROOT, 'google-sessions', 'dto');

const SCAN_ROOTS: readonly string[] = [LIVE_ROOT, GOOGLE_DTO_ROOT];

function collectDtos(dir: string, acc: string[] = []): string[] {
  if (!existsSync(dir)) return acc;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectDtos(full, acc);
    else if (entry.name.endsWith('.dto.ts')) acc.push(full);
  }
  return acc;
}

/** Labels are relative to `src/lib/`, so they read as `<area>/dto/<file>`. */
const label = (full: string): string =>
  full.slice(LIB_ROOT.length + 1).replace(/\\/g, '/');

const ALL_DTO_FILES = SCAN_ROOTS.flatMap((root) => collectDtos(root)).map(
  label,
);

const DTO_FILES = ALL_DTO_FILES.filter(
  (file) => !LEGACY_DTO_FILES.includes(file),
);

const ALL_PROPERTIES: DtoProperty[] = DTO_FILES.flatMap((file) =>
  propertiesOf(file, readFileSync(join(LIB_ROOT, file), 'utf8')),
);

/**
 * Anti-vacuity floor for the DTO scan.
 *
 * NINE files as of Task 12.10: four under `live-sessions/dto/`
 * (create / update / the member replay query / the admin date-range query) and
 * five under `google-sessions/dto/` (create / accept / reschedule / decline /
 * the queue query), with `admin-session.dto.ts` excluded as legacy. A scan
 * finding fewer means the walk broke, and every "no violations" assertion above
 * would go silently vacuous.
 *
 * ⚠️ NINE, NOT THE TEN `tasks.md` PREDICTS. Its file list names a
 * `refresh-live-metadata.dto.ts`; `POST /v1/admin/live-sessions/:id/refresh-metadata`
 * takes NO BODY — the target is the path parameter and the metadata video is
 * resolved from the row — so a DTO for it would be an empty class bound to
 * nothing. Recorded in `batch-12-report.md` as a deviation rather than written
 * to make a number match.
 */
const MIN_DTO_FILES = 9;

/* -------------------------------------------------------------------------- */

describe('F-2 — in the Phase-4 community DTOs, an explicit `null` is a 400', () => {
  describe('the structural rule over every DTO this batch owns', () => {
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

    it('is rooted at live-sessions/ + google-sessions/dto/, and NOT at the lib', () => {
      // 🔴 THE ROOTS ARE THE DECISION THIS FILE IS ABOUT. If someone "fixes" the
      // scan to cover the whole lib, this fails immediately and names the
      // reason, rather than the suite going red on ~30 pre-F-2 fields.
      expect(LIVE_ROOT.endsWith(`lib${sep}live-sessions`)).toBe(true);
      expect(GOOGLE_DTO_ROOT.endsWith(join('google-sessions', 'dto'))).toBe(
        true,
      );

      const libDirs = readdirSync(LIB_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name)
        .sort();

      // The four out-of-scope directories exist and are NOT scanned — asserted
      // rather than described, so "out of scope" cannot quietly become "gone".
      expect(libDirs).toEqual(
        expect.arrayContaining([
          'circle',
          'google-sessions',
          'member-groups',
          'packs',
        ]),
      );
      expect(DTO_FILES.some((f) => f.startsWith('packs/'))).toBe(false);
      expect(DTO_FILES.some((f) => f.startsWith('member-groups/'))).toBe(false);
    });

    it('every LEGACY_DTO_FILES entry is real, and is really excluded', () => {
      // The exclusion list cannot rot in either direction: an entry naming a
      // file that no longer exists is dead weight, and an entry that is not
      // actually being excluded is a lie about what is covered.
      for (const legacy of LEGACY_DTO_FILES) {
        expect({ legacy, present: ALL_DTO_FILES.includes(legacy) }).toEqual({
          legacy,
          present: true,
        });
        expect(DTO_FILES).not.toContain(legacy);
      }
    });

    it(`scans at least ${MIN_DTO_FILES} real DTO files, across BOTH roots`, () => {
      // Listing the paths, not just counting them, so a failure says WHICH file
      // stopped being seen.
      const scanned = [...DTO_FILES].sort();

      expect({ count: scanned.length, scanned }).toEqual({
        count: scanned.length,
        scanned,
      });
      expect(scanned.length).toBeGreaterThanOrEqual(MIN_DTO_FILES);
      // …and the walk really did reach both roots, not just the first.
      expect(scanned.some((f) => f.startsWith('live-sessions/dto/'))).toBe(
        true,
      );
      expect(scanned.some((f) => f.startsWith('google-sessions/dto/'))).toBe(
        true,
      );
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
          key: 'live-sessions/dto/update-live-session.dto.ts:title',
          decorators: ['IsOptional', 'IsString'],
          declaredType: 'string',
        },
      ]);

      expect(flagged.map((f) => f.key)).toEqual([
        'live-sessions/dto/update-live-session.dto.ts:title',
      ]);
      expect(flagged[0]?.detail).toContain(NULL_STRICT);
    });

    it('flags an @IsOptional() with NO declared type at all', () => {
      // An untyped property cannot be shown to admit null, so it is flagged.
      // Being wrong in this direction costs an `@IsOptionalNotNull()`; being
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
        // 1. a deliberate nullable optional — `null` clears the value
        {
          key: 'p.dto.ts:releaseAt',
          decorators: ['IsOptional', 'IsISO8601'],
          declaredType: 'string | null',
        },
        // 2. the strict decorator on a non-nullable optional — the default here
        {
          key: 'live-sessions/dto/update-live-session.dto.ts:title',
          decorators: [NULL_STRICT, 'IsString'],
          declaredType: 'string',
        },
        // 3. a required field with no optionality decorator at all
        {
          key: 'live-sessions/dto/create-live-session.dto.ts:startsAt',
          decorators: ['IsISO8601'],
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
      // be weakened without a red test.
      const property: DtoProperty = {
        key: 'live-sessions/dto/update-live-session.dto.ts:replayYoutubeVideoId',
        decorators: ['IsOptional', 'IsString'],
        declaredType: 'string | null',
      };

      expect(violationsIn([property])).toEqual([]);
      expect(EXPECTED_NULLABLE_OPTIONALS).not.toContain(property.key);
    });
  });
});
