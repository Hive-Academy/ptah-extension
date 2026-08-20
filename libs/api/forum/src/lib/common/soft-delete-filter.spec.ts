import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * AD-5 AS AN EXECUTABLE ARTEFACT — the soft-delete filter, enforced.
 *
 * ⚠️ WHY THIS TEST EXISTS.
 *
 * OQ-5 offered two ways to keep soft-deleted rows out of member reads. Prisma
 * middleware (option b) would inject `deletedAt: null` automatically and would
 * WORK — which is the problem. It puts the safety property somewhere no reader
 * of the query can see it, and somewhere no test can check it. AD-5 chose
 * option (a): one exported constant, `NOT_DELETED`, spread at every member read
 * site. That choice only holds if something fails the build when a read is
 * written without it, because "remember to spread the constant" is a convention
 * and conventions are not held across thirty files and nine services.
 *
 * A comment cannot fail a build. This can. (The idiom is `route-map.spec.ts:31`
 * and `contract-boundary.spec.ts`.)
 *
 * WHAT IT CHECKS, over every `*.service.ts` under `src/lib/`:
 *
 *   RULE-FILTER  — a read on a SOFT-DELETABLE model (`topic`, `post`) must have
 *                  a `where` that mentions `NOT_DELETED`.
 *   RULE-UNIQUE  — `findUnique` / `findUniqueOrThrow` on a soft-deletable model
 *                  is banned outright. Its `where` accepts only unique fields,
 *                  so it CANNOT carry `deletedAt: null` — it is the one read
 *                  shape that can look filtered and not be. Use `findFirst`.
 *   RULE-NESTED  — a relation read that reaches a soft-deletable model
 *                  (`posts`, `topics`, `children`, `parent`, `acceptedPost`
 *                  inside an `include`/`select`) must carry the same filter.
 *                  `posts: true` reads tombstones; so does
 *                  `_count: { select: { posts: true } }`, which silently
 *                  inflates every reply count in the product.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS DELIBERATELY NOT ACCEPTED as a filter.
 * It is semantically identical and it defeats the point: AD-5's value is that
 * ONE greppable identifier answers "which reads are filtered", and that
 * changing the representation of soft deletion is one edit.
 *
 * THE EXEMPTION MECHANISM, AND WHY IT IS REQUIRED.
 *
 * The admin moderation read takes `?includeDeleted` (plan §3.3) and
 * legitimately reads tombstones — an admin deciding whether to restore a post
 * must see what was removed. A spec with no exemption mechanism gets deleted
 * the first time it is inconvenient. So there is one, and it is narrow:
 * `// AD-5-EXEMPT: <reason>` on the line directly above the read, with a
 * non-empty reason.
 *
 * ⚠️ AND THE EXEMPTIONS THEMSELVES ARE ASSERTED. {@link EXPECTED_EXEMPTIONS}
 * enumerates every one that exists. Adding an exemption fails this test until
 * the constant is updated in the same change — so a new unfiltered read cannot
 * be waved through by typing a comment; it has to be typed into a list that a
 * reviewer reads. Without that census the escape hatch would be the rule.
 *
 * ⚠️ CURRENT COVERAGE — READ THIS BEFORE TRUSTING A GREEN RUN.
 * Batch 6A landed `common/` and no services; the services arrive in Tasks
 * 6.6–6.14. So the real-tree scan below finds ZERO files today and its "no
 * violations" assertion is honestly vacuous. What is NOT vacuous is the
 * `analyze() actually detects` block: it runs fabricated sources through the
 * SAME function and proves each rule fires and — the half that is usually
 * missing — that the legal shapes are NOT flagged. The moment Task 6.6 writes
 * `categories.service.ts`, the real-tree scan starts biting with an analyser
 * that is already known to work.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Prisma client accessors for the two models carrying `deletedAt`.
 *
 * `category`, `postReaction` and `topicReadState` are NOT here: they have no
 * `deletedAt` column, so spreading the filter into a read on one of them is a
 * compile error, not a safety improvement.
 */
const SOFT_DELETABLE_MODELS = ['topic', 'post'] as const;

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

/** Relation fields that reach a soft-deletable model. */
const SOFT_DELETABLE_RELATIONS = [
  'topics',
  'posts',
  'children',
  'parent',
  'acceptedPost',
] as const;

/** The one identifier that counts as "filtered". */
const FILTER_IDENTIFIER = 'NOT_DELETED';

const EXEMPT_MARKER = 'AD-5-EXEMPT:';

/**
 * EVERY sanctioned unfiltered read in this lib, as `<file>:<what>` plus its
 * reason.
 *
 * ⚠️ ADDING AN ENTRY HERE IS A REVIEW EVENT, NOT A FORMALITY. Each one is a
 * read that can return a soft-deleted row. It belongs on an ADMIN path behind
 * `AdminGuard`; a member-path entry should be rejected in review.
 *
 * ⚠️ TWO ENTRIES, BOTH IN ONE ADMIN-ONLY FILE, AND THEY ARE ONE FEATURE.
 * Task 6.13's `GET /v1/admin/community/topics?includeDeleted` (plan §3.3, R8.2)
 * is the moderation list, and a PAGED list is two queries: the page and its
 * `total`. `Paged.total` must be computed under the SAME `where` as the page —
 * otherwise a moderator who asked to see tombstones is shown a total that
 * excludes them — and no Prisma call returns both. `count` is a filterable read,
 * so it needs its own marker.
 *
 * Batch 6C's brief anticipated ONE entry. It is two, for the reason above, and
 * both were funnelled into private methods (`findRows` / `countRows`) in a file
 * that exists for no other purpose. That is what keeps the number of places in
 * this lib capable of returning a deleted row at TWO — a constant — rather than
 * growing with each admin feature: a third admin read reuses them and adds no
 * entry here.
 *
 * ⚠️ NEITHER IS ON A WRITE PATH, DELIBERATELY. `TopicsService.restore` and
 * `PostsService.restore` (R8.5) both looked like they needed one — the obvious
 * shape is "read the tombstone, check the 30-day window, update". Both instead
 * put the window inside the `UPDATE`'s own `WHERE` (`restorableWhere`), which is
 * atomic AND exemption-free. An exemption on a write path should be refused in
 * review, and there is none to refuse.
 */
const EXPECTED_EXEMPTIONS: readonly string[] = [
  'topics/admin-topics-read.service.ts:topic.count',
  'topics/admin-topics-read.service.ts:topic.findMany',
];

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
 * Line-based rather than AST-comment-based, and deliberately so: the rule as
 * written in the task spec is "on the line above", it is what a reviewer sees,
 * and it is what `grep -rn "AD-5-EXEMPT"` finds. An AST comment range would
 * also match a comment attached three statements earlier.
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
 * idiomatic way to pass a hoisted `const where = { ...NOT_DELETED }`
 * (`packs.service.ts` writes it exactly that way). Matching only the longhand
 * would report every such call as having no `where` at all — a FALSE POSITIVE
 * on the most common correct shape, which is how a structural spec gets
 * deleted. The negative-control probe below is what caught this.
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
      // `{ where }` — the value IS the identifier, resolved one hop by the
      // caller against the file's local declarations.
      return prop.name;
    }
  }
  return null;
}

/**
 * The model accessor in `this.prisma.topic.findMany` — i.e. `topic`.
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
     * One hop of resolution, which is the pattern `packs.service.ts` uses.
     * Deeper aliasing is not resolved — and is reported as unfiltered, which
     * is the safe direction to be wrong in.
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
                  `— which silently inflates counts and puts deleted bodies in a ` +
                  `response. Write \`${field}: { where: { ...${FILTER_IDENTIFIER} } }\`, ` +
                  `or add "// ${EXEMPT_MARKER} <reason>" on the line above and ` +
                  `list it in EXPECTED_EXEMPTIONS.`,
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
                    `Use \`${model}.findFirst({ where: { id, ...${FILTER_IDENTIFIER} } })\`.`,
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

describe('AD-5 — every member read filters soft-deleted rows', () => {
  describe('the real source tree', () => {
    it('has no unfiltered read', () => {
      // toEqual on the details, not a count: the failure message NAMES the
      // file, the model, the method, and what to write instead.
      expect(REAL.violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
    });

    it('takes exactly the exemptions enumerated in EXPECTED_EXEMPTIONS', () => {
      // ⚠️ THE CENSUS. Without it the escape hatch would BE the rule: anyone
      // could silence a failure by typing a comment. This makes adding an
      // exemption a change to a list a reviewer reads.
      expect(REAL.exemptions.map((e) => e.key).sort()).toEqual(
        [...EXPECTED_EXEMPTIONS].sort(),
      );
    });

    it('scans the directory the services will land in', () => {
      // Guards against the loader silently pointing at the wrong root — the
      // failure mode that would make every assertion above vacuous FOREVER
      // rather than only until Task 6.6. `src/lib/common` is this file's own
      // directory, so it must exist.
      const dirs = readdirSync(LIB_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(LIB_ROOT.endsWith(`src${sep}lib`)).toBe(true);
      expect(dirs).toContain('common');
    });
  });

  describe('anti-vacuity — analyze() actually detects each evasion', () => {
    // Batch 6A ships NO services, so the real-tree block above is honestly
    // vacuous today (see the file docblock). Everything below runs fabricated
    // sources through the SAME analyze(). If the analyser is broken, these
    // fail — and the real-tree assertions become trustworthy the moment Task
    // 6.6 gives them something to read.

    it('flags an unfiltered findMany on a soft-deletable model', () => {
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.topic.findMany({ where: { categoryId } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a read with no `where` at all', () => {
      const found = analyze([
        probe(`class S { all() { return this.prisma.post.findMany(); } }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a `count`, which is how a tombstone reaches a total', () => {
      // R1.1.2: a member must never see a `total` that counts rows they cannot
      // read. A deleted topic is exactly such a row.
      const found = analyze([
        probe(
          `class S { n() { return this.prisma.topic.count({ where: { categoryId } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a LITERAL `deletedAt: null`, which is semantically right and structurally wrong', () => {
      // Deliberate. AD-5's value is that ONE identifier answers "which reads
      // are filtered". Accepting the literal would make the constant optional
      // and the grep incomplete.
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.topic.findMany({ where: { deletedAt: null } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags findUnique on a soft-deletable model — the read that CANNOT be filtered', () => {
      const found = analyze([
        probe(
          `class S { get(id) { return this.prisma.topic.findUnique({ where: { id } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
    });

    it('flags findUniqueOrThrow too', () => {
      const found = analyze([
        probe(
          `class S { get(id) { return this.prisma.post.findUniqueOrThrow({ where: { id } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
    });

    it('flags a nested relation read written as `posts: true`', () => {
      const found = analyze([
        probe(`class S {
          get(id) {
            return this.prisma.topic.findFirst({
              where: { id, ...NOT_DELETED },
              include: { posts: true },
            });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags an unfiltered `_count` over a relation — the silent reply-count inflator', () => {
      const found = analyze([
        probe(`class S {
          feed() {
            return this.prisma.category.findMany({
              select: { id: true, _count: { select: { topics: true } } },
            });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags a nested relation read whose `where` omits the filter', () => {
      const found = analyze([
        probe(`class S {
          get(id) {
            return this.prisma.topic.findFirst({
              where: { id, ...NOT_DELETED },
              include: { posts: { where: { parentId: null } } },
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
            return this.prisma.topic.findMany({ where: {} });
          }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-REASON']);
      expect(found.exemptions).toEqual([]);
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing,
      // and would make every "no violations" assertion unfalsifiable in the
      // other direction.
      const found = analyze([
        // 1. the ordinary filtered read
        probe(
          `class S {
             list() { return this.prisma.topic.findMany({ where: { ...NOT_DELETED, categoryId } }); }
           }`,
          'a.service.ts',
        ),
        // 2. the filter inside an AND
        probe(
          `class S {
             list() { return this.prisma.post.findMany({ where: { AND: [NOT_DELETED, { topicId }] } }); }
           }`,
          'b.service.ts',
        ),
        // 3. a hoisted `where` const — one hop of resolution
        probe(
          `class S {
             list() {
               const where = { ...NOT_DELETED, categoryId };
               return this.prisma.topic.findMany({ where });
             }
           }`,
          'c.service.ts',
        ),
        // 4. a filtered nested relation read
        probe(
          `class S {
             get(id) {
               return this.prisma.topic.findFirst({
                 where: { id, ...NOT_DELETED },
                 include: { posts: { where: { ...NOT_DELETED } } },
               });
             }
           }`,
          'd.service.ts',
        ),
        // 5. a read on a model with NO deletedAt column — the filter would not
        //    even compile there, so requiring it would be a false positive
        probe(
          `class S {
             cats() { return this.prisma.category.findMany({ where: { visibility: 'member' } }); }
             mine() { return this.prisma.postReaction.findMany({ where: { userId } }); }
             read() { return this.prisma.topicReadState.findUnique({ where: { userId_topicId } }); }
           }`,
          'e.service.ts',
        ),
        // 6. a WRITE — soft delete itself must be able to target a live row
        probe(
          `class S {
             del(id) { return this.prisma.topic.update({ where: { id }, data: { deletedAt: new Date() } }); }
           }`,
          'f.service.ts',
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
               // AD-5-EXEMPT: admin ?includeDeleted moderation read (plan 3.3)
               return this.prisma.topic.findMany({ where: { categoryId } });
             }
           }`,
          'admin-topics.service.ts',
        ),
      ]);

      expect(found.violations).toEqual([]);
      expect(found.exemptions).toEqual([
        {
          key: 'admin-topics.service.ts:topic.findMany',
          reason: 'admin ?includeDeleted moderation read (plan 3.3)',
        },
      ]);
    });

    it('an exemption is NOT silently free — the census would reject this one', () => {
      // The other half of the mechanism. The exemption above is well-formed, so
      // `analyze` accepts it; the real-tree census then fails because it is not
      // in EXPECTED_EXEMPTIONS. This asserts that pairing directly, so the
      // census cannot be weakened without a red test.
      const found = analyze([
        probe(`class S {
          list() {
            // AD-5-EXEMPT: some reason
            return this.prisma.post.findMany({ where: {} });
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
          a() { return this.prisma.topic.findMany({}); }
          b() { return this.prisma.post.count({}); }
          c() { return this.prisma.post.findUnique({ where: { id } }); }
        }`),
      ]);

      expect(found.violations).toHaveLength(3);
      expect(rulesOf(found)).toEqual(['RULE-FILTER', 'RULE-UNIQUE']);
    });
  });
});
