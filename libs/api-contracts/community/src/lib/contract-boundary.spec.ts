import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';
import { z } from 'zod';

import {
  hubSectionSchema,
  memberHubResponseSchema,
} from './member/member-hub.contract';
import type {
  HubSection,
  MemberHubResponse,
} from './member/member-hub.contract';
import { memberPackSchema } from './member/member-pack.contract';
import type { MemberPack } from './member/member-pack.contract';
import { pagedSchema } from './shared/paged';
import type { Paged } from './shared/paged';

/**
 * THE MEMBER/ADMIN CONTRACT BOUNDARY AS AN EXECUTABLE ARTEFACT.
 * NFR-S4, NFR-S5, R5.2, RK-8, AD-6, plan §2.10.
 *
 * ⚠️ WHY THIS TEST EXISTS.
 * `google-sessions.types.ts` declares `AdminSession extends BuildersSession`.
 * Its own docblock is unusually candid about why the two are separate types at
 * all: `description` and `attendees` are admin-only *specifically* so that
 * widening the member-facing response cannot leak every other member's email
 * address. That inheritance is safe only because `BuildersSession` — the BASE —
 * is frozen. Nothing structural enforces that freeze. The next contributor who
 * adds a field to the base widens the admin type harmlessly, and the one after
 * that adds a field to the base "because both need it" and ships a member-facing
 * leak in one line.
 *
 * This task authors SIX such pairs across five phases. At that count the
 * convention "please re-declare admin fields instead of extending" is not a
 * convention anyone will hold. So it is not a convention here — `member/` and
 * `admin/` are structurally incapable of referring to each other, and this spec
 * is what makes that true.
 *
 * A comment cannot fail a build. This can.
 *
 * The concrete leak it prevents: `Pack.notes` is a freeform ADMIN-INTERNAL note
 * (`packs.types.ts`). One `extends` puts it on `GET /v1/members/packs` for every
 * Builders member. R5.2 requires a test asserting its absence; this is the
 * compile-time half of that assertion, and it fires before the endpoint exists.
 *
 * FOUR RULES:
 *   R-CONTAIN  — no `member/` file references `admin/`, or vice versa, by ANY
 *                mechanism: import, re-export, `import type`, `import('...')`
 *                type, `import x = require(...)`, or a bare string literal.
 *                THIS IS THE LOAD-BEARING ONE. You cannot `extend`, intersect,
 *                pick from, or alias a type you cannot name.
 *   R-LEAF     — no `shared/` file references `member/` or `admin/`. Closes the
 *                laundering path: without it, `shared/x.ts` could re-export
 *                `MemberPack` and `admin/` could import it from there,
 *                satisfying R-CONTAIN while defeating its purpose.
 *   R-HERITAGE — the rule the lib is NAMED for: no `extends`/`implements`
 *                clause names a type that came from the other side. Made
 *                unreachable in practice by R-CONTAIN, and asserted anyway so
 *                the failure message says *inheritance* when someone tries.
 *   R-NOTES    — no declaration under `member/` has a property named exactly
 *                `notes`. The member-facing "how do I get access" field is
 *                `accessNote` (R5.5) and is a different field with a different
 *                audience.
 *
 * ⚠️ ANTI-VACUITY IS NOT OPTIONAL HERE. Every assertion below is of the form
 * "the set of violations is empty", and the real source tree contains zero
 * heritage clauses — so R-HERITAGE passes today no matter what `analyze()`
 * does. The `analyze() actually detects` block feeds fabricated sources through
 * the SAME function and asserts it flags each evasion and, critically, that it
 * does NOT flag the legal shapes. Without that block this file would be
 * decoration.
 */

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

const LIB_ROOT = __dirname;

/** The three directories under `src/lib/`. Anything else is a hard error. */
const SIDES = ['member', 'admin', 'shared'] as const;
type Side = (typeof SIDES)[number];

interface ContractFile {
  /** `member/member-pack.contract.ts` — stable across machines, used in diffs. */
  readonly label: string;
  readonly side: Side;
  /** Absolute directory, for resolving relative specifiers. */
  readonly dir: string;
  readonly text: string;
}

interface Violation {
  readonly rule: 'R-CONTAIN' | 'R-LEAF' | 'R-HERITAGE' | 'R-NOTES';
  readonly detail: string;
}

/** Which of the three directories does an absolute path fall in? */
function sideOfPath(absPath: string): Side | null {
  const rel = resolve(absPath).slice(resolve(LIB_ROOT).length);
  const head = rel.split(sep).filter(Boolean)[0];
  return (SIDES as readonly string[]).includes(head) ? (head as Side) : null;
}

/** The identifier at the root of a heritage expression (`A`, or `A` in `A.B`). */
function rootIdentifierName(expr: ts.Expression): string | null {
  let node: ts.Expression = expr;
  while (ts.isPropertyAccessExpression(node)) node = node.expression;
  return ts.isIdentifier(node) ? node.text : null;
}

/**
 * Local binding names introduced by one import declaration.
 * Covers `import D from`, `import * as N from`, `import { a, b as c } from`.
 */
function localBindings(clause: ts.ImportClause | undefined): string[] {
  if (!clause) return [];
  const names: string[] = [];
  if (clause.name) names.push(clause.name.text);
  const bindings = clause.namedBindings;
  if (bindings && ts.isNamespaceImport(bindings))
    names.push(bindings.name.text);
  if (bindings && ts.isNamedImports(bindings)) {
    for (const el of bindings.elements) names.push(el.name.text);
  }
  return names;
}

/**
 * Analyse a set of contract files and return every boundary violation.
 *
 * PURE: takes source text, touches no disk. That is what lets the anti-vacuity
 * block below run fabricated files through this exact function rather than
 * through a second, differently-buggy copy of the logic.
 */
function analyze(files: readonly ContractFile[]): Violation[] {
  const violations: Violation[] = [];

  for (const file of files) {
    const source = ts.createSourceFile(
      file.label,
      file.text,
      ts.ScriptTarget.ES2021,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    /** local identifier -> the side it was imported from. */
    const importedFrom = new Map<string, Side>();

    /**
     * R-CONTAIN / R-LEAF, applied to one module-specifier-shaped string.
     *
     * ⚠️ Applied to EVERY string literal in the file, not only to the ones in
     * an `import` position. `require('../member/x')`, `await import('../member/x')`
     * and `import('../member/x').MemberPack` are all module references the
     * narrower check would miss, and a contracts lib has no legitimate reason to
     * hold a string that resolves across the boundary in any other position.
     */
    const checkSpecifier = (spec: string, where: string): Side | null => {
      if (!spec.startsWith('.')) return null;
      const target = sideOfPath(resolve(file.dir, spec));
      if (target === null || target === file.side) return null;
      if (file.side === 'shared') {
        violations.push({
          rule: 'R-LEAF',
          detail:
            `${file.label} references ${target}/ ("${spec}", ${where}). ` +
            `shared/ must be a leaf: if it could re-export a member type, ` +
            `admin/ could import that type from shared/ and satisfy R-CONTAIN ` +
            `while defeating it. Vocabularies (string unions, enums) live in ` +
            `shared/; payload shapes live on their own side and are re-declared.`,
        });
        return target;
      }
      if (target === 'shared') return null;
      violations.push({
        rule: 'R-CONTAIN',
        detail:
          `${file.label} references ${target}/ ("${spec}", ${where}). ` +
          `member/ and admin/ never reference each other, in either direction, ` +
          `with no exceptions. Re-declare the fields (RK-8): an inheritance or ` +
          `intersection link is how Pack.notes reaches a member response.`,
      });
      return target;
    };

    const visit = (node: ts.Node): void => {
      // Bare string literals — the catch-all containment sweep.
      if (
        (ts.isStringLiteral(node) ||
          ts.isNoSubstitutionTemplateLiteral(node)) &&
        node.text.startsWith('.')
      ) {
        checkSpecifier(node.text, 'string literal');
      }

      // Named imports, so R-HERITAGE can resolve an identifier to a side.
      if (ts.isImportDeclaration(node)) {
        const spec = node.moduleSpecifier;
        if (ts.isStringLiteral(spec)) {
          const target = spec.text.startsWith('.')
            ? sideOfPath(resolve(file.dir, spec.text))
            : null;
          if (target !== null && target !== file.side) {
            for (const name of localBindings(node.importClause)) {
              importedFrom.set(name, target);
            }
          }
        }
      }

      // R-HERITAGE — `extends` / `implements` on an interface or class.
      if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
        for (const clause of node.heritageClauses ?? []) {
          const keyword =
            clause.token === ts.SyntaxKind.ExtendsKeyword
              ? 'extends'
              : 'implements';
          for (const typeExpr of clause.types) {
            const name = rootIdentifierName(typeExpr.expression);
            if (name === null) continue;
            const origin = importedFrom.get(name);
            if (origin !== undefined && origin !== file.side) {
              violations.push({
                rule: 'R-HERITAGE',
                detail:
                  `${file.label}: ${node.name?.text ?? '<anonymous>'} ` +
                  `${keyword} ${name}, which came from ${origin}/. ` +
                  `This is the AdminSession-extends-BuildersSession shape ` +
                  `inverted into a hazard: a field added to the base widens the ` +
                  `other side's response as a side effect. Re-declare the ` +
                  `fields instead (RK-8, NFR-S4).`,
              });
            }
          }
        }
      }

      // R-NOTES — the admin-internal field, banned from every member shape.
      if (
        file.side === 'member' &&
        (ts.isPropertySignature(node) || ts.isPropertyDeclaration(node)) &&
        ts.isIdentifier(node.name) &&
        node.name.text === 'notes'
      ) {
        violations.push({
          rule: 'R-NOTES',
          detail:
            `${file.label} declares a property named "notes". ` +
            `Pack.notes is a freeform ADMIN-INTERNAL note and must never appear ` +
            `in a member response under any circumstance (R5.2, NFR-S5). The ` +
            `member-facing field describing how repo access is granted is ` +
            `"accessNote" (R5.5) — a different field, for a different audience.`,
        });
      }

      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return violations;
}

/* -------------------------------------------------------------------------- */
/* The real source tree                                                        */
/* -------------------------------------------------------------------------- */

/** Every `.ts` under `dir`, recursively, excluding specs. */
function collectTs(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectTs(full, acc);
    else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.spec.ts')) {
      acc.push(full);
    }
  }
  return acc;
}

function loadSide(side: Side): ContractFile[] {
  return collectTs(join(LIB_ROOT, side)).map((full) => ({
    label: `${side}/${full.slice(join(LIB_ROOT, side).length + 1)}`.replace(
      /\\/g,
      '/',
    ),
    side,
    dir: full.slice(0, full.lastIndexOf(sep)),
    text: readFileSync(full, 'utf8'),
  }));
}

const MEMBER_FILES = loadSide('member');
const ADMIN_FILES = loadSide('admin');
const SHARED_FILES = loadSide('shared');
const ALL_FILES = [...MEMBER_FILES, ...ADMIN_FILES, ...SHARED_FILES];

/**
 * Top-level DECLARATIONS in the barrel — R-BARREL.
 *
 * ⚠️ `src/index.ts` lives OUTSIDE `src/lib/`, so `analyze()` never sees it, and
 * it is the one file in the workspace that legitimately names both sides. That
 * combination is a hole: `export interface AdminPack extends MemberPack {}`
 * written there would leak exactly as badly as it would in `admin/`, and every
 * rule above would stay green.
 *
 * It is closed by forbidding the barrel from declaring ANYTHING. Re-exports
 * only. That is a stronger rule than "no cross-heritage" and a much cheaper one
 * to check, and it costs nothing: a barrel has no business declaring types.
 */
function barrelDeclarations(text: string): string[] {
  const source = ts.createSourceFile(
    'index.ts',
    text,
    ts.ScriptTarget.ES2021,
    true,
    ts.ScriptKind.TS,
  );
  const declared: string[] = [];
  for (const statement of source.statements) {
    if (
      ts.isImportDeclaration(statement) ||
      ts.isExportDeclaration(statement)
    ) {
      continue;
    }
    if (ts.isVariableStatement(statement)) {
      for (const decl of statement.declarationList.declarations) {
        declared.push(
          ts.isIdentifier(decl.name) ? decl.name.text : '<destructured>',
        );
      }
      continue;
    }
    const named = statement as { name?: ts.Identifier };
    // The fallback names the SyntaxKind so an unanticipated statement form is
    // reported rather than silently dropped.
    declared.push(named.name?.text ?? `<${ts.SyntaxKind[statement.kind]}>`);
  }
  return declared;
}

/** A fabricated file, for the anti-vacuity probes. Never written to disk. */
const probe = (side: Side, name: string, text: string): ContractFile => ({
  label: `${side}/${name}`,
  side,
  dir: join(LIB_ROOT, side),
  text,
});

const rulesOf = (vs: readonly Violation[]): string[] =>
  [...new Set(vs.map((v) => v.rule))].sort();

/* -------------------------------------------------------------------------- */

describe('Contract boundary — member/ and admin/ are structurally disjoint', () => {
  describe('the real source tree', () => {
    it('has no boundary violation of any rule', () => {
      // toEqual on the details, not a count: the failure message NAMES the file,
      // the specifier and the rule, and explains what to do instead.
      expect(analyze(ALL_FILES).map((v) => `${v.rule}: ${v.detail}`)).toEqual(
        [],
      );
    });

    it('puts every contract in member/, admin/ or shared/ — nothing escapes the scan', () => {
      // ⚠️ NOT COSMETIC. `analyze()` only sees files under the three side
      // directories, and `sideOfPath` returns `null` for anything else. A
      // fourth directory, or a loose `src/lib/leak.ts`, would be scanned by NO
      // rule — the analysis would silently stop covering it rather than fail,
      // and every "no violations" assertion above would still be green.
      //
      // `*.spec.ts` is the one permitted loose file: this file is one.
      const stray = readdirSync(LIB_ROOT, { withFileTypes: true })
        .filter(
          (e) =>
            !(SIDES as readonly string[]).includes(e.name) &&
            !(e.isFile() && e.name.endsWith('.spec.ts')),
        )
        .map((e) => e.name)
        .sort();

      expect(stray).toEqual([]);
    });

    it('R-BARREL: src/index.ts re-exports only — it declares nothing', () => {
      const barrel = readFileSync(join(LIB_ROOT, '..', 'index.ts'), 'utf8');

      expect(barrelDeclarations(barrel)).toEqual([]);
    });

    it('R-BARREL is not vacuous — a declaration in the barrel IS detected', () => {
      // Without this probe, `barrelDeclarations` returning `[]` unconditionally
      // would leave the assertion above passing forever.
      expect(
        barrelDeclarations(
          `export { MemberPack } from './lib/member/member-pack.contract';
           import type { MemberPack } from './lib/member/member-pack.contract';
           export interface AdminPack extends MemberPack { notes: string | null }
           export const LEAK = 1;`,
        ),
      ).toEqual(['AdminPack', 'LEAK']);
    });
  });

  describe('anti-vacuity — the scanner actually reads something', () => {
    // Every assertion above passes trivially if `collectTs` finds no files.
    it('found source files on all three sides', () => {
      expect({
        member: MEMBER_FILES.length > 0,
        admin: ADMIN_FILES.length > 0,
        shared: SHARED_FILES.length > 0,
      }).toEqual({ member: true, admin: true, shared: true });
    });

    it('found the RK-8 pair it exists to keep apart', () => {
      const labels = ALL_FILES.map((f) => f.label);

      expect({
        member: labels.includes('member/member-pack.contract.ts'),
        admin: labels.includes('admin/admin-pack.contract.ts'),
      }).toEqual({ member: true, admin: true });
    });

    it('parsed real type declarations, not empty files', () => {
      // If ts.createSourceFile were mis-configured, every rule would find
      // nothing to inspect and every assertion would still be green.
      const declared = (files: readonly ContractFile[]): number => {
        let count = 0;
        for (const file of files) {
          const source = ts.createSourceFile(
            file.label,
            file.text,
            ts.ScriptTarget.ES2021,
            true,
            ts.ScriptKind.TS,
          );
          ts.forEachChild(source, (node) => {
            if (
              ts.isInterfaceDeclaration(node) ||
              ts.isTypeAliasDeclaration(node)
            ) {
              count++;
            }
          });
        }
        return count;
      };

      expect({
        member: declared(MEMBER_FILES) > 0,
        admin: declared(ADMIN_FILES) > 0,
      }).toEqual({ member: true, admin: true });
    });
  });

  describe('anti-vacuity — analyze() actually detects each evasion', () => {
    // The real tree has ZERO heritage clauses and ZERO cross-references, so
    // every assertion above is green whatever analyze() does. These probes run
    // fabricated sources through the SAME function. If analyze() is broken,
    // these fail and the "no violation" assertions become trustworthy again.

    it('flags the exact violation this lib exists to prevent: extends across the boundary', () => {
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `import type { MemberPack } from '../member/member-pack.contract';
           export interface AdminPack extends MemberPack {
             notes: string | null;
           }`,
        ),
      ]);

      // BOTH rules fire: the import is the containment breach, the extends is
      // the leak. Reporting both is deliberate — the fix is to delete the
      // import, and a report naming only the `extends` invites the wrong fix.
      expect(rulesOf(found)).toEqual(['R-CONTAIN', 'R-HERITAGE']);
    });

    it('flags the reverse direction — a member type extending an admin type', () => {
      const found = analyze([
        probe(
          'member',
          '__probe.ts',
          `import type { AdminPack } from '../admin/admin-pack.contract';
           export interface MemberPack extends AdminPack {}`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN', 'R-HERITAGE']);
    });

    it('flags `implements`, not only `extends`', () => {
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `import type { MemberPack } from '../member/member-pack.contract';
           export class AdminPackDto implements MemberPack {}`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN', 'R-HERITAGE']);
    });

    it('flags an INTERSECTION, which is `extends` wearing a different hat', () => {
      // `type AdminPack = MemberPack & { notes: string | null }` leaks exactly
      // as badly as an extends and contains no `extends` token at all. R-CONTAIN
      // is what catches it, which is why R-CONTAIN and not R-HERITAGE is the
      // load-bearing rule.
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `import type { MemberPack } from '../member/member-pack.contract';
           export type AdminPack = MemberPack & { notes: string | null };`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN']);
    });

    it('flags a re-export, which needs no local binding at all', () => {
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `export type { MemberPack } from '../member/member-pack.contract';`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN']);
    });

    it('flags an inline `import(...)` type, which bypasses every import statement', () => {
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `export interface AdminPack
             extends import('../member/member-pack.contract').MemberPack {}`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN']);
    });

    it('flags `Omit`/`Pick` laundering, which is a reference like any other', () => {
      const found = analyze([
        probe(
          'admin',
          '__probe.ts',
          `import type { MemberPack } from '../member/member-pack.contract';
           export type AdminPack = Omit<MemberPack, 'accessNote'>;`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-CONTAIN']);
    });

    it('flags the shared/ laundering path — the way around R-CONTAIN', () => {
      // Without R-LEAF: shared/leak.ts re-exports MemberPack, admin/ imports it
      // from shared/, R-CONTAIN sees only an admin -> shared edge and passes.
      const found = analyze([
        probe(
          'shared',
          '__probe.ts',
          `export type { MemberPack } from '../member/member-pack.contract';`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-LEAF']);
    });

    it('flags `notes` on a member shape even with no cross-reference at all', () => {
      const found = analyze([
        probe(
          'member',
          '__probe.ts',
          `export interface MemberPack {
             id: string;
             notes: string | null;
           }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['R-NOTES']);
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing,
      // and would make every assertion in this file unfalsifiable in the other
      // direction. These five are all legal and must stay legal.
      const found = analyze([
        // 1. importing a vocabulary from shared/ — the sanctioned path
        probe(
          'admin',
          '__probe-a.ts',
          `import type { SessionRequestStatus } from '../shared/session-request-status';
           export interface AdminSessionRequest { status: SessionRequestStatus; }`,
        ),
        // 2. extending a type declared in the SAME file
        probe(
          'admin',
          '__probe-b.ts',
          `interface Base { id: string }
           export interface AdminThing extends Base { notes: string | null }`,
        ),
        // 3. an npm import
        probe(
          'member',
          '__probe-c.ts',
          `import { z } from 'zod';
           export const s = z.object({ id: z.string() });`,
        ),
        // 4. a sibling import within the same side
        probe(
          'member',
          '__probe-d.ts',
          `import type { MemberPack } from './member-pack.contract';
           export interface HubPacks { packs: MemberPack[] }`,
        ),
        // 5. `additionalNotes` is NOT `notes` — the ban is exact-match
        probe(
          'member',
          '__probe-e.ts',
          `export interface MemberSessionRequest { additionalNotes: string | null }`,
        ),
      ]);

      expect(found.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
    });
  });

  describe('schema/type correspondence — the generic factories are not casts', () => {
    // `pagedSchema` and `hubSectionSchema` return an INFERRED type with no cast,
    // because Zod 4 cannot reduce a still-generic schema inside an object shape
    // and annotating the return would require an assertion instead of a check.
    // These are where the check actually happens: at a CONCRETE instantiation
    // the inference resolves, so each `satisfies` below is a real compile-time
    // proof that the factory's output shape is the declared interface. If a
    // field is renamed on one side only, this file stops compiling.

    it('pagedSchema(item) produces exactly Paged<item>', () => {
      const schema = pagedSchema(memberPackSchema) satisfies z.ZodType<
        Paged<MemberPack>
      >;
      const parsed = schema.parse({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      } satisfies Paged<MemberPack>);

      expect(parsed).toEqual({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
        hasMore: false,
      });
    });

    it('pagedSchema rejects a body missing an envelope field', () => {
      // Anti-vacuity for the schema itself: a `z.object` that validated
      // anything would make the parse above meaningless.
      const result = pagedSchema(memberPackSchema).safeParse({
        items: [],
        page: 1,
        pageSize: 25,
        total: 0,
      });

      expect(result.success).toBe(false);
    });

    it('hubSectionSchema(data) produces exactly HubSection<data>', () => {
      const schema = hubSectionSchema(
        z.array(memberPackSchema),
      ) satisfies z.ZodType<HubSection<MemberPack[]>>;

      expect(schema.parse({ status: 'unavailable', data: [] })).toEqual({
        status: 'unavailable',
        data: [],
      });
    });

    it('the hub envelope parses the Phase-1 all-empty response', () => {
      // The literal below is typed `MemberHubResponse`, so this asserts the
      // TYPE and the SCHEMA agree on the Phase-1 shape — the one every later
      // phase must extend without changing (R6.6).
      const phase1: MemberHubResponse = {
        member: { firstName: null, cohorts: [] },
        sections: {
          learning: { status: 'empty', data: null },
          community: { status: 'empty', data: [] },
          sessions: { status: 'empty', data: null },
          packs: { status: 'empty', data: [] },
          notifications: { status: 'empty', data: { unreadCount: 0 } },
        },
      };

      expect(memberHubResponseSchema.parse(phase1)).toEqual(phase1);
    });

    it('the hub envelope rejects a response missing a section (R6.6)', () => {
      // A later phase that drops a section — or renames one — must fail here,
      // not in a browser. `z.object` strips unknown keys but REQUIRES declared
      // ones, which is the asymmetry this assertion depends on.
      const result = memberHubResponseSchema.safeParse({
        member: { firstName: null, cohorts: [] },
        sections: {
          learning: { status: 'empty', data: null },
          community: { status: 'empty', data: [] },
          sessions: { status: 'empty', data: null },
          packs: { status: 'empty', data: [] },
        },
      });

      expect(result.success).toBe(false);
    });

    it('MemberPack carries no `notes`, at runtime as well as in the type', () => {
      // R5.2 / NFR-S5, the other half of R-NOTES: even if an admin row were
      // passed to the member schema by mistake, `z.object` STRIPS the unknown
      // key rather than forwarding it.
      const parsed = memberPackSchema.parse({
        id: 'p1',
        slug: 'starter',
        title: 'Starter Pack',
        description: 'desc',
        repoUrl: 'https://github.com/x/y',
        tags: [],
        cohortName: null,
        accessNote: null,
        notes: 'ADMIN INTERNAL — must not survive',
      });

      expect(Object.keys(parsed).sort()).toEqual([
        'accessNote',
        'cohortName',
        'description',
        'id',
        'repoUrl',
        'slug',
        'tags',
        'title',
      ]);
    });
  });
});
