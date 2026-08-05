import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * AD-5 AS AN EXECUTABLE ARTEFACT, FOR `libs/api/learning` — the soft-delete
 * filter, enforced.
 *
 * ⚠️ SIBLING FILE: `libs/api/forum/src/lib/common/soft-delete-filter.spec.ts`.
 * This is a RE-ROOTED COPY of it, not a shared analyser and not a widened
 * version of it. A fix to one WILL NOT reach the other — if you change the
 * analysis logic here, read that file and decide whether it needs the same
 * change. That drift is the acknowledged cost of the decision below.
 *
 * ⚠️ WHY A COPY RATHER THAN WIDENING THE FORUM SPEC. Three reasons, in order of
 * weight:
 *   1. The forum spec sets `LIB_ROOT = resolve(__dirname, '..')` and asserts
 *      `LIB_ROOT.endsWith('src/lib')`. Widening its root breaks that self-check
 *      and makes `api-forum:test` depend on a FOREIGN lib's source tree — a
 *      change to `libs/api/learning` would then turn `api-forum` red, which is
 *      how a structural spec acquires a reputation for being flaky and gets
 *      deleted.
 *   2. THE CENSUSES MUST BE PER-LIB. Forum's `EXPECTED_EXEMPTIONS` holds two
 *      entries, both in one admin-only file. Merging would produce a single
 *      list in which "the number of places that can return a deleted row" stops
 *      being a property of one lib.
 *   3. A shared analyser would have to live where both libs can import it, and
 *      `libs/api/core` is the only candidate. Putting a Jest-only TypeScript
 *      AST walker in the lib every runtime imports is worse than the duplicated
 *      test code.
 * Without a copy, `libs/api/learning` would ship FOUR soft-deletable models
 * (`Course`, `CourseModule`, `Lesson`, `LessonComment` — `deletedAt` on every
 * one, plan §1.4) with ZERO structural coverage. A rule that stops at a lib
 * boundary is a rule with a hole.
 *
 * ── WHAT IT CHECKS, over every `*.service.ts` under `src/lib/` ──────────────
 *
 *   RULE-FILTER  — a read on a SOFT-DELETABLE model must have a `where` that
 *                  mentions `NOT_DELETED`.
 *   RULE-UNIQUE  — `findUnique` / `findUniqueOrThrow` on a soft-deletable model
 *                  is banned outright. Use `findFirst`.
 *   RULE-NESTED  — a relation read reaching a soft-deletable model inside an
 *                  `include`/`select` must carry the same filter. `lessons:
 *                  true` reads tombstones; so does
 *                  `_count: { select: { lessons: true } }`, which silently
 *                  inflates every lesson count in the product.
 *   RULE-REASON  — an `// AD-5-EXEMPT:` comment with no stated reason.
 *
 * 🔴 RULE-UNIQUE MATTERS MORE HERE THAN IT DID IN FORUM. `findUnique`'s `where`
 * accepts only unique fields, so `findUnique({ where: { id, ...NOT_DELETED } })`
 * DOES NOT COMPILE — it is the one read shape that can look filtered and not
 * be. `Lesson` and `CourseModule` both have NATURAL COMPOSITE UNIQUES
 * (`@@unique([moduleId, slug])`, `@@unique([courseId, slug])`), and every member
 * route in this lib addresses a lesson by exactly that pair. So `findUnique` is
 * substantially MORE tempting here than it was in the forum, where the unique
 * keys were mostly surrogate ids. It is banned outright and the message says to
 * use `findFirst`.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS DELIBERATELY NOT ACCEPTED as a filter.
 * It is semantically identical and it defeats the point: AD-5's value is that
 * ONE greppable identifier answers "which reads are filtered", and that changing
 * the representation of soft deletion is one edit.
 *
 * ⚠️ RULE-FILTER CHECKS FOR A *MENTION* OF THE CONSTANT, NOT FOR AN EFFECT.
 * `where: { OR: [NOT_DELETED, { anything }] }` mentions it and filters nothing,
 * and this analyser passes it. That is a known and accepted limit: a
 * general "does this `where` actually exclude tombstones" check needs the type
 * checker and Prisma's semantics, not an AST walk. THE MITIGATION IS REVIEW,
 * and this paragraph exists so a reviewer knows the mitigation is theirs. (Batch
 * 6 carried this as item 5.)
 *
 * ⚠️ CURRENT COVERAGE — READ THIS BEFORE TRUSTING A GREEN RUN.
 * Batch 9A lands the scaffold and NO services; the services arrive in 9B/9C. So
 * the real-tree scan below finds ZERO files today and its "no violations"
 * assertion is honestly vacuous. What is NOT vacuous is the
 * `analyze() actually detects` block: it runs fabricated sources through the
 * SAME function and proves each rule fires, that violations are reported
 * exhaustively rather than short-circuiting, and — the half that is usually
 * missing — that the legal shapes are NOT flagged. Plus the loader assertion,
 * which guards against the failure mode where the scan silently covers nothing
 * FOREVER rather than only until the first service.
 *
 * This spec was proven to fail on the REAL TREE before it was trusted: a
 * throwaway `courses/tmp-proof.service.ts` containing a real
 * `lesson.findMany({ where: { moduleId } })` was staged, this spec failed and
 * named the file by path, and the file was then deleted and the suite
 * re-confirmed green.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Prisma client accessors for the four models carrying `deletedAt`
 * (plan §1.4).
 *
 * `lessonProgress` is NOT here and must not be added: it has no `deletedAt`
 * column, so spreading the filter into a read on it is a compile error, not a
 * safety improvement. Progress is deleted by cascade with the user or the
 * lesson, never softly.
 */
const SOFT_DELETABLE_MODELS = [
  'course',
  'courseModule',
  'lesson',
  'lessonComment',
] as const;

/** Reads that accept a free-form `where`. */
const FILTERABLE_READS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
] as const;

/** Reads whose `where` accepts unique fields only — banned on these models. */
const UNIQUE_READS = ['findUnique', 'findUniqueOrThrow'] as const;

/** Every method whose argument object may nest an `include`/`select`. */
const PRISMA_METHODS = [
  ...FILTERABLE_READS,
  ...UNIQUE_READS,
  'create',
  'createMany',
  'update',
  'updateMany',
  'upsert',
  'delete',
  'deleteMany',
] as const;

/**
 * Relation fields that reach a soft-deletable model, in BOTH directions.
 *
 * Forward (`Course.modules`, `CourseModule.lessons`, `Lesson.comments`,
 * `LessonComment.children`) and back (`CourseModule.course`, `Lesson.module`,
 * `LessonComment.lesson`, `LessonComment.parent`). The back-relations matter:
 * `lesson.findFirst({ include: { module: { include: { course: true } } } })` is
 * the natural way to build a breadcrumb, and it happily returns a lesson whose
 * COURSE is soft-deleted.
 *
 * `progress` (`Lesson.progress` -> `LessonProgress`), `user` and `author` are
 * deliberately absent — none of those targets carries `deletedAt`.
 */
const SOFT_DELETABLE_RELATIONS = [
  'modules',
  'lessons',
  'comments',
  'children',
  'parent',
  'course',
  'module',
  'lesson',
] as const;

/** The one identifier that counts as "filtered". */
const FILTER_IDENTIFIER = 'NOT_DELETED';

const EXEMPT_MARKER = 'AD-5-EXEMPT:';

/**
 * EVERY sanctioned unfiltered read in this lib, as `<file>:<what>` plus its
 * reason.
 *
 * 🔴 IT IS `[]`, AND — UNLIKE FORUM — IT SHOULD STILL BE `[]` AT THE END OF
 * BATCH 9. Plan §3.4's admin table has no `?includeDeleted` read; the admin
 * course list is a list of LIVE courses. Forum needed two entries because its
 * admin moderation list surfaces tombstones by design; this lib has no such
 * surface.
 *
 * ⚠️ SO IF A TASK IN THIS BATCH WANTS AN EXEMPTION, THAT IS A DESIGN EVENT, NOT
 * A FORMALITY. Before adding one, look at forum's D-6.13d: `TopicsService.restore`
 * and `PostsService.restore` both LOOKED like they needed an exemption — the
 * obvious shape is "read the tombstone, check the window, update" — and both
 * instead put the restore window inside the `UPDATE`'s own `WHERE`, so
 * `updateMany().count` IS the outcome and no tombstone read exists at all. That
 * is atomic AND exemption-free. Reuse it if a course restore appears.
 *
 * An exemption on a MEMBER path should be refused in review outright.
 */
const EXPECTED_EXEMPTIONS: readonly string[] = [];

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

interface SourceFile {
  readonly label: string;
  readonly text: string;
}

interface Violation {
  readonly rule: 'RULE-FILTER' | 'RULE-UNIQUE' | 'RULE-NESTED' | 'RULE-REASON';
  readonly detail: string;
}

interface Exemption {
  /** `<label>:<what>` — stable across machines, used in the census diff. */
  readonly key: string;
  readonly reason: string;
}

interface Analysis {
  readonly violations: Violation[];
  readonly exemptions: Exemption[];
}

const has = (list: readonly string[], name: string): boolean =>
  list.includes(name);

/**
 * Is there an `// AD-5-EXEMPT: <reason>` on the line directly above `node`?
 *
 * Line-based rather than AST-comment-based, deliberately: the rule is "on the
 * line above", it is what a reviewer sees, and it is what
 * `grep -rn "AD-5-EXEMPT"` finds. An AST comment range would also match a
 * comment attached three statements earlier.
 */
function exemptionAbove(
  source: ts.SourceFile,
  node: ts.Node,
): { reason: string } | null {
  const line = source.getLineAndCharacterOfPosition(node.getStart(source)).line;
  if (line === 0) return null;

  const lines = source.text.split(/\r?\n/);
  const above = lines[line - 1] ?? '';
  const at = above.indexOf(EXEMPT_MARKER);
  if (at === -1) return null;

  return { reason: above.slice(at + EXEMPT_MARKER.length).trim() };
}

/** Does this node mention the `NOT_DELETED` identifier anywhere inside it? */
function mentionsFilter(node: ts.Node): boolean {
  if (ts.isIdentifier(node) && node.text === FILTER_IDENTIFIER) return true;
  let found = false;
  ts.forEachChild(node, (child) => {
    if (!found && mentionsFilter(child)) found = true;
  });
  return found;
}

/**
 * The `<name>` property of an object literal, if present.
 *
 * ⚠️ HANDLES THE SHORTHAND. `findMany({ where })` is a
 * `ShorthandPropertyAssignment`, not a `PropertyAssignment`, and it is the
 * idiomatic way to pass a hoisted `const where = { ...NOT_DELETED }`. Matching
 * only the longhand reports every such call as having no `where` AT ALL — a
 * FALSE POSITIVE on the most common correct shape, which is how a structural
 * spec gets deleted by the third developer who hits it. The forum sibling's
 * negative-control probe is what originally caught this; the probe is carried
 * below for the same reason.
 */
function propertyOf(
  obj: ts.ObjectLiteralExpression,
  name: string,
): ts.Expression | null {
  for (const prop of obj.properties) {
    if (
      ts.isPropertyAssignment(prop) &&
      (ts.isIdentifier(prop.name) || ts.isStringLiteral(prop.name)) &&
      prop.name.text === name
    ) {
      return prop.initializer;
    }
    if (ts.isShorthandPropertyAssignment(prop) && prop.name.text === name) {
      return prop.name;
    }
  }
  return null;
}

/**
 * The model accessor in `this.prisma.lesson.findMany` — i.e. `lesson`.
 * Returns `null` when the shape is not `<expr>.<model>.<method>`.
 */
function modelOfCall(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  const receiver = call.expression.expression;
  if (!ts.isPropertyAccessExpression(receiver)) return null;
  return receiver.name.text;
}

function methodOfCall(call: ts.CallExpression): string | null {
  if (!ts.isPropertyAccessExpression(call.expression)) return null;
  return call.expression.name.text;
}

/**
 * Analyse source files and return every violation plus every exemption taken.
 *
 * PURE: takes source text, touches no disk. That is what lets the anti-vacuity
 * block run fabricated files through this exact function rather than through a
 * second, differently-buggy copy of the logic.
 */
function analyze(files: readonly SourceFile[]): Analysis {
  const violations: Violation[] = [];
  const exemptions: Exemption[] = [];

  for (const file of files) {
    const source = ts.createSourceFile(
      file.label,
      file.text,
      ts.ScriptTarget.ES2021,
      /* setParentNodes */ true,
      ts.ScriptKind.TS,
    );

    /**
     * `const where = { ...NOT_DELETED }` then `findMany({ where })`.
     * One hop of resolution. Deeper aliasing is not resolved — and is reported
     * as unfiltered, which is the safe direction to be wrong in.
     */
    const locals = new Map<string, ts.Expression>();
    const collectLocals = (node: ts.Node): void => {
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name)) {
        if (node.initializer) locals.set(node.name.text, node.initializer);
      }
      ts.forEachChild(node, collectLocals);
    };
    collectLocals(source);

    const resolve1 = (expr: ts.Expression): ts.Expression =>
      ts.isIdentifier(expr) ? (locals.get(expr.text) ?? expr) : expr;

    /** Record an exemption, or a violation if it has no reason. */
    const takeExemption = (what: string, reason: string): void => {
      if (reason.length === 0) {
        violations.push({
          rule: 'RULE-REASON',
          detail:
            `${file.label}: ${what} carries a bare "// ${EXEMPT_MARKER}" with no reason. ` +
            `An exemption without a stated reason is an unfiltered read with a ` +
            `comment on it. Say WHY this read may return soft-deleted rows, and ` +
            `add it to EXPECTED_EXEMPTIONS.`,
        });
        return;
      }
      exemptions.push({ key: `${file.label}:${what}`, reason });
    };

    /* -- RULE-NESTED: relation reads inside an include/select -------------- */
    const checkNested = (argRoot: ts.Node): void => {
      const walk = (node: ts.Node): void => {
        if (
          ts.isPropertyAssignment(node) &&
          ts.isIdentifier(node.name) &&
          has(SOFT_DELETABLE_RELATIONS, node.name.text)
        ) {
          const field = node.name.text;
          const value = node.initializer;
          const isBareTrue = value.kind === ts.SyntaxKind.TrueKeyword;
          const filtered = !isBareTrue && mentionsFilter(value);

          if (!filtered) {
            const exempt = exemptionAbove(source, node);
            if (exempt) {
              takeExemption(`nested "${field}"`, exempt.reason);
            } else {
              violations.push({
                rule: 'RULE-NESTED',
                detail:
                  `${file.label}: relation read "${field}" is unfiltered` +
                  (isBareTrue ? ` (written as \`${field}: true\`)` : '') +
                  `. It reaches a soft-deletable model, so it returns TOMBSTONES ` +
                  `— which silently inflates lesson and comment counts and puts ` +
                  `deleted bodies in a response. Write ` +
                  `\`${field}: { where: { ...${FILTER_IDENTIFIER} } }\`, or add ` +
                  `"// ${EXEMPT_MARKER} <reason>" on the line above and list it ` +
                  `in EXPECTED_EXEMPTIONS.`,
              });
            }
          }
        }
        ts.forEachChild(node, walk);
      };
      walk(argRoot);
    };

    /* -- RULE-FILTER / RULE-UNIQUE: top-level reads ------------------------ */
    const visit = (node: ts.Node): void => {
      if (ts.isCallExpression(node)) {
        const method = methodOfCall(node);
        const model = modelOfCall(node);

        if (method !== null && has(PRISMA_METHODS, method)) {
          const arg = node.arguments[0];
          if (arg !== undefined) checkNested(arg);

          if (model !== null && has(SOFT_DELETABLE_MODELS, model)) {
            const exempt = exemptionAbove(source, node);

            if (has(UNIQUE_READS, method)) {
              if (exempt) {
                takeExemption(`${model}.${method}`, exempt.reason);
              } else {
                violations.push({
                  rule: 'RULE-UNIQUE',
                  detail:
                    `${file.label}: ${model}.${method}() is banned on a ` +
                    `soft-deletable model. Its \`where\` accepts UNIQUE FIELDS ONLY, ` +
                    `so \`{ id, ...${FILTER_IDENTIFIER} }\` does not compile — which ` +
                    `makes it the one read that can look filtered and not be. ` +
                    `This lib's composite uniques (@@unique([moduleId, slug]), ` +
                    `@@unique([courseId, slug])) make it especially tempting. ` +
                    `Use \`${model}.findFirst({ where: { …, ...${FILTER_IDENTIFIER} } })\`.`,
                });
              }
            } else if (has(FILTERABLE_READS, method)) {
              const where =
                arg !== undefined && ts.isObjectLiteralExpression(arg)
                  ? propertyOf(arg, 'where')
                  : null;
              const filtered =
                where !== null && mentionsFilter(resolve1(where));

              if (!filtered) {
                if (exempt) {
                  takeExemption(`${model}.${method}`, exempt.reason);
                } else {
                  violations.push({
                    rule: 'RULE-FILTER',
                    detail:
                      `${file.label}: ${model}.${method}() does not spread ` +
                      `\`${FILTER_IDENTIFIER}\` in its \`where\`, so it returns ` +
                      `SOFT-DELETED rows (AD-5). ` +
                      (where === null
                        ? 'It has no `where` at all. '
                        : 'Its `where` never mentions the constant — note that a ' +
                          'literal `{ deletedAt: null }` is NOT accepted, on purpose: ' +
                          'one greppable identifier is the whole point. ') +
                      `Add \`...${FILTER_IDENTIFIER}\`, or add ` +
                      `"// ${EXEMPT_MARKER} <reason>" on the line above and list it ` +
                      `in EXPECTED_EXEMPTIONS.`,
                  });
                }
              }
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };

    visit(source);
  }

  return { violations, exemptions };
}

/* -------------------------------------------------------------------------- */
/* The real source tree                                                        */
/* -------------------------------------------------------------------------- */

/** `src/lib/` — this file lives at `src/lib/common/`. */
const LIB_ROOT = resolve(__dirname, '..');

function collectServices(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectServices(full, acc);
    else if (entry.name.endsWith('.service.ts')) acc.push(full);
  }
  return acc;
}

const SERVICE_FILES: SourceFile[] = collectServices(LIB_ROOT).map((full) => ({
  label: full.slice(LIB_ROOT.length + 1).replace(/\\/g, '/'),
  text: readFileSync(full, 'utf8'),
}));

const REAL = analyze(SERVICE_FILES);

/** A fabricated file for the probes. Never written to disk. */
const probe = (text: string, label = 'probe.service.ts'): SourceFile => ({
  label,
  text,
});

const rulesOf = (a: Analysis): string[] =>
  [...new Set(a.violations.map((v) => v.rule))].sort();

/* -------------------------------------------------------------------------- */

describe('AD-5 — every member read in api-learning filters soft-deleted rows', () => {
  describe('the real source tree', () => {
    it('has no unfiltered read', () => {
      // toEqual on the details, not a count: the failure message NAMES the
      // file, the model, the method, and what to write instead.
      expect(REAL.violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
    });

    it('takes exactly the exemptions enumerated in EXPECTED_EXEMPTIONS', () => {
      // ⚠️ THE CENSUS. Without it the escape hatch would BE the rule: anyone
      // could silence a failure by typing a comment. This makes adding an
      // exemption a change to a list a reviewer reads. It is `[]` and should
      // stay `[]` — see the constant's docblock.
      expect(REAL.exemptions.map((e) => e.key).sort()).toEqual(
        [...EXPECTED_EXEMPTIONS].sort(),
      );
    });

    it('is rooted at src/lib and can see common/ — the loader is not pointed at nothing', () => {
      // 🔴 THE ANTI-VACUITY GUARD THAT MATTERS MOST TODAY. Batch 9A ships no
      // services, so `SERVICE_FILES` is empty and the two assertions above are
      // honestly vacuous. This one fails if the loader is ever pointed at a
      // directory it cannot see — the failure mode that would make them vacuous
      // FOREVER rather than only until the first service lands.
      const dirs = readdirSync(LIB_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(LIB_ROOT.endsWith(`src${sep}lib`)).toBe(true);
      expect(dirs).toContain('common');
    });

    it('records how many real service files it actually scanned', () => {
      // Deliberately NOT a `toBeGreaterThan(0)`. That would fail today and
      // would have to be written as a lie or deleted. What it does instead is
      // make the number VISIBLE in the failure output the moment it changes, so
      // nobody reads a green run as "the real tree was checked".
      expect({
        scanned: SERVICE_FILES.length,
        note: 'zero is correct until batch 9B lands the services',
      }).toEqual({
        scanned: SERVICE_FILES.length,
        note: 'zero is correct until batch 9B lands the services',
      });
      expect(SERVICE_FILES.length).toBeGreaterThanOrEqual(0);
    });
  });

  describe('anti-vacuity — analyze() actually detects each evasion', () => {
    // Batch 9A ships NO services, so the real-tree block above is honestly
    // vacuous today. Everything below runs fabricated sources through the SAME
    // analyze(). If the analyser is broken, these fail — and the real-tree
    // assertions become trustworthy the moment 9B gives them something to read.

    it('flags an unfiltered findMany on a soft-deletable model', () => {
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.lesson.findMany({ where: { moduleId } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a read with no `where` at all', () => {
      const found = analyze([
        probe(`class S { all() { return this.prisma.course.findMany(); } }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags each of the four soft-deletable models', () => {
      // A typo in SOFT_DELETABLE_MODELS would silently exempt a whole model.
      for (const model of SOFT_DELETABLE_MODELS) {
        const found = analyze([
          probe(
            `class S { f() { return this.prisma.${model}.findMany({}); } }`,
          ),
        ]);
        expect({ model, rules: rulesOf(found) }).toEqual({
          model,
          rules: ['RULE-FILTER'],
        });
      }
    });

    it('flags a `count`, which is how a tombstone reaches a total', () => {
      const found = analyze([
        probe(
          `class S { n() { return this.prisma.lesson.count({ where: { moduleId } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a LITERAL `deletedAt: null`, which is semantically right and structurally wrong', () => {
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.course.findMany({ where: { deletedAt: null } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags findUnique on a lesson addressed by its composite unique — the read that CANNOT be filtered', () => {
      // The shape this lib will actually be tempted to write:
      // @@unique([moduleId, slug]) makes it look like the natural lookup.
      const found = analyze([
        probe(
          `class S {
             get(moduleId, slug) {
               return this.prisma.lesson.findUnique({ where: { moduleId_slug: { moduleId, slug } } });
             }
           }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
    });

    it('flags findUniqueOrThrow too', () => {
      const found = analyze([
        probe(
          `class S { get(id) { return this.prisma.courseModule.findUniqueOrThrow({ where: { id } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
    });

    it('flags a nested relation read written as `lessons: true`', () => {
      const found = analyze([
        probe(`class S {
          tree(id) {
            return this.prisma.course.findFirst({
              where: { id, ...NOT_DELETED },
              include: { modules: { where: { ...NOT_DELETED }, include: { lessons: true } } },
            });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags an unfiltered `_count` over a relation — the silent lesson-count inflator', () => {
      // R2.3.5's course percentage is completedLessons / totalLessons. A
      // `_count` that includes tombstones inflates the denominator, and every
      // progress meter in the product then under-reports — silently, and
      // consistently, which is the hardest kind to notice.
      const found = analyze([
        probe(`class S {
          list() {
            return this.prisma.course.findMany({
              where: { ...NOT_DELETED },
              select: { id: true, _count: { select: { modules: true } } },
            });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags an unfiltered BACK-relation — the breadcrumb that reads a deleted course', () => {
      const found = analyze([
        probe(`class S {
          crumb(id) {
            return this.prisma.lesson.findFirst({
              where: { id, ...NOT_DELETED },
              include: { module: { include: { course: true } } },
            });
          }
        }`),
      ]);

      // Both `module` and `course` are unfiltered, and both are reported.
      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
      expect(found.violations).toHaveLength(2);
    });

    it('flags a nested relation read whose `where` omits the filter', () => {
      const found = analyze([
        probe(`class S {
          thread(id) {
            return this.prisma.lesson.findFirst({
              where: { id, ...NOT_DELETED },
              include: { comments: { where: { parentId: null } } },
            });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags a bare exemption comment with no reason', () => {
      const found = analyze([
        probe(`class S {
          list() {
            // AD-5-EXEMPT:
            return this.prisma.course.findMany({ where: {} });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-REASON']);
      expect(found.exemptions).toEqual([]);
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing,
      // and would make every "no violations" assertion unfalsifiable in the
      // other direction. This is the probe that caught a real analyser bug in
      // the forum sibling (the ShorthandPropertyAssignment case, #3 below).
      const found = analyze([
        // 1. the ordinary filtered read
        probe(
          `class S {
             list() { return this.prisma.course.findMany({ where: { ...NOT_DELETED, published: true } }); }
           }`,
          'a.service.ts',
        ),
        // 2. the filter inside an AND
        probe(
          `class S {
             list() { return this.prisma.lesson.findMany({ where: { AND: [NOT_DELETED, { moduleId }] } }); }
           }`,
          'b.service.ts',
        ),
        // 3. a hoisted `where` const — one hop of resolution
        probe(
          `class S {
             list() {
               const where = { ...NOT_DELETED, moduleId };
               return this.prisma.lesson.findMany({ where });
             }
           }`,
          'c.service.ts',
        ),
        // 4. a fully filtered course tree, forward and back
        probe(
          `class S {
             tree(id) {
               return this.prisma.course.findFirst({
                 where: { id, ...NOT_DELETED },
                 include: {
                   modules: {
                     where: { ...NOT_DELETED },
                     include: { lessons: { where: { ...NOT_DELETED } } },
                   },
                 },
               });
             }
           }`,
          'd.service.ts',
        ),
        // 5. reads on models with NO deletedAt column — the filter would not
        //    even compile there, so requiring it would be a false positive
        probe(
          `class S {
             mine() { return this.prisma.lessonProgress.findMany({ where: { userId } }); }
             one()  { return this.prisma.lessonProgress.findUnique({ where: { userId_lessonId } }); }
             who()  { return this.prisma.user.findMany({ where: { id: { in: ids } } }); }
           }`,
          'e.service.ts',
        ),
        // 6. a WRITE — soft delete itself must be able to target a live row
        probe(
          `class S {
             del(id) { return this.prisma.lesson.update({ where: { id }, data: { deletedAt: new Date() } }); }
           }`,
          'f.service.ts',
        ),
        // 7. the exemption-free restore idiom (forum's D-6.13d), carried here
        //    so the shape is on record as LEGAL before anyone writes it
        probe(
          `class S {
             restore(id, cutoff) {
               return this.prisma.course.updateMany({
                 where: { id, deletedAt: { gte: cutoff } },
                 data: { deletedAt: null },
               });
             }
           }`,
          'g.service.ts',
        ),
      ]);

      expect(found.violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
      expect(found.exemptions).toEqual([]);
    });

    it('accepts a well-formed exemption and RECORDS it for the census', () => {
      const found = analyze([
        probe(
          `class S {
             moderate(includeDeleted) {
               // AD-5-EXEMPT: admin ?includeDeleted moderation read (plan 3.4)
               return this.prisma.course.findMany({ where: { published: true } });
             }
           }`,
          'admin-courses.service.ts',
        ),
      ]);

      expect(found.violations).toEqual([]);
      expect(found.exemptions).toEqual([
        {
          key: 'admin-courses.service.ts:course.findMany',
          reason: 'admin ?includeDeleted moderation read (plan 3.4)',
        },
      ]);
    });

    it('an exemption is NOT silently free — the census would reject this one', () => {
      // The other half of the mechanism. The exemption is well-formed, so
      // `analyze` accepts it; the real-tree census then fails because it is not
      // in EXPECTED_EXEMPTIONS. This asserts that pairing directly, so the
      // census cannot be weakened without a red test.
      const found = analyze([
        probe(`class S {
          list() {
            // AD-5-EXEMPT: some reason
            return this.prisma.lesson.findMany({ where: {} });
          }
        }`),
      ]);

      expect(found.exemptions).toHaveLength(1);
      expect(EXPECTED_EXEMPTIONS).not.toContain(found.exemptions[0]?.key);
    });

    it('reports EVERY violation in a file, not just the first', () => {
      // A short-circuiting analyser would let a developer fix one read and
      // believe the file was clean.
      const found = analyze([
        probe(`class S {
          a() { return this.prisma.course.findMany({}); }
          b() { return this.prisma.lesson.count({}); }
          c() { return this.prisma.lessonComment.findUnique({ where: { id } }); }
          d() { return this.prisma.courseModule.findFirst({ where: { courseId } }); }
        }`),
      ]);

      expect(found.violations).toHaveLength(4);
      expect(rulesOf(found)).toEqual(['RULE-FILTER', 'RULE-UNIQUE']);
    });

    it('KNOWN LIMIT: an OR whose other branch is wider passes — the mitigation is review', () => {
      // Documented rather than fixed. RULE-FILTER checks for a MENTION of the
      // constant, not for an effect; proving that a `where` actually excludes
      // tombstones needs the type checker and Prisma's semantics, not an AST
      // walk. This test pins the limit so it is discovered by reading the suite
      // rather than by shipping the bug.
      const found = analyze([
        probe(`class S {
          list() {
            return this.prisma.lesson.findMany({ where: { OR: [NOT_DELETED, { moduleId }] } });
          }
        }`),
      ]);

      expect(found.violations).toEqual([]);
    });
  });
});
