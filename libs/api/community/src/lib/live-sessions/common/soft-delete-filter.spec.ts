import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * AD-5 AS AN EXECUTABLE ARTEFACT, FOR THE PHASE-4 SURFACES OF
 * `libs/api/community` — the soft-delete filter, enforced.
 *
 * ⚠️ SIBLING FILES — a RE-ROOTED COPY of both, not a shared analyser:
 *   - `libs/api/forum/src/lib/common/soft-delete-filter.spec.ts`
 *   - `libs/api/learning/src/lib/common/soft-delete-filter.spec.ts`
 * A fix to one WILL NOT reach the others. If you change the analysis logic here,
 * read those two and decide whether they need the same change. That drift is the
 * acknowledged cost of ASSUMPTION-11.
 *
 * ── 🔴 THE SCAN ROOT IS `live-sessions/`, NOT THE LIB ───────────────────────
 *
 * The lib-local convention in forum and learning is
 * `LIB_ROOT = resolve(__dirname, '..')` plus an `endsWith('src/lib')`
 * self-check. Copied verbatim here it would point at `src/lib/live-sessions`
 * anyway — this file sits one level deeper than its siblings do, because the
 * Phase-4 code is a DIRECTORY inside an existing lib rather than a lib of its
 * own. That is not a coincidence to be tidied away; it is the correct root, and
 * the root ABOVE it would be actively wrong:
 *
 *   `circle/`, `packs/`, `member-groups/` and `google-sessions/` predate AD-5
 *   and read models with NO `deletedAt` COLUMN AT ALL (`Pack`, `MemberGroup`,
 *   `SessionRequest`, and Google Calendar events, which are not rows). Widening
 *   the root would either fail on four innocent directories or force the rule to
 *   be weakened to exempt them — and a weakened rule is how a structural spec
 *   acquires a reputation for being noise and gets deleted.
 *
 * ⚠️ SO THE REST OF THE LIB IS DELIBERATELY OUT OF SCOPE, and the assertion
 * below pins that the root really is this directory rather than drifting upward.
 * `session-requests.service.ts` lives in `google-sessions/` and is NOT scanned:
 * it reads `SessionRequest`, which has no `deletedAt` and never gains one (a
 * request is `canceled` or `declined` — a lifecycle state on a row both sides
 * keep seeing, not a tombstone). Spreading `NOT_DELETED` into a read on it is a
 * COMPILE ERROR, not a safety improvement.
 *
 * ── WHAT IT CHECKS, over every `*.service.ts` under `live-sessions/` ────────
 *
 *   RULE-FILTER  — a read on a SOFT-DELETABLE model must have a `where` that
 *                  mentions `NOT_DELETED`.
 *   RULE-UNIQUE  — `findUnique` / `findUniqueOrThrow` on a soft-deletable model
 *                  is banned outright. Use `findFirst`.
 *   RULE-NESTED  — a relation read reaching a soft-deletable model inside an
 *                  `include`/`select` must carry the same filter.
 *   RULE-REASON  — an `// AD-5-EXEMPT:` comment with no stated reason.
 *
 * 🔴 RULE-UNIQUE IS THE ONE THAT MATTERS MOST HERE, AND FOR A REASON THE OTHER
 * TWO LIBS DID NOT HAVE. `LiveSession.calendarEventId` is `@unique` (AD-2), so
 * `findUnique({ where: { calendarEventId } })` is the obvious way to answer "does
 * a live session already claim this Google event?" — and its `where` accepts
 * unique fields only, so `{ calendarEventId, ...NOT_DELETED }` DOES NOT COMPILE.
 * A soft-deleted session would then still be found to claim an event, which
 * would silently remove that event from the member feed for ever. Banned
 * outright; the message says to use `findFirst`.
 *
 * ⚠️ A LITERAL `{ deletedAt: null }` IS DELIBERATELY NOT ACCEPTED as a filter.
 * It is semantically identical and it defeats the point: AD-5's value is that
 * ONE greppable identifier answers "which reads are filtered".
 *
 * ⚠️ RULE-FILTER CHECKS FOR A *MENTION* OF THE CONSTANT, NOT FOR AN EFFECT.
 * `where: { OR: [NOT_DELETED, { anything }] }` mentions it and filters nothing,
 * and this analyser passes it. A known and accepted limit — proving that a
 * `where` actually excludes tombstones needs the type checker and Prisma's
 * semantics, not an AST walk. THE MITIGATION IS REVIEW, and this paragraph
 * exists so a reviewer knows the mitigation is theirs.
 */

/* -------------------------------------------------------------------------- */
/* Configuration                                                               */
/* -------------------------------------------------------------------------- */

/**
 * The Prisma client accessors for the models carrying `deletedAt` in this
 * directory's reach — plan §1.5.
 *
 * 🔴 `sessionRequest` IS NOT HERE AND MUST NOT BE ADDED. It has no `deletedAt`
 * column (migration 4 added four scheduling columns and no tombstone), so
 * spreading the filter into a read on it is a compile error. Its lifecycle is
 * `pending | scheduled | completed | canceled` on a row that stays visible.
 *
 * `memberGroup` is likewise absent: `LiveSessionsService` reads it to validate
 * `cohortKeys`, and it has no `deletedAt` either.
 */
const SOFT_DELETABLE_MODELS = ['liveSession'] as const;

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
 * Relation fields that reach a soft-deletable model.
 *
 * 🔴 `LiveSession` HAS NO RELATIONS AT ALL — plan §1.5 gives it `createdBy` /
 * `deletedBy` as plain `String?` admin ids with no `User` back-relation, and
 * `calendarEventId` is a Google handle, not a foreign key. So this list is
 * EMPTY, and that is a fact about the schema rather than an oversight.
 *
 * ⚠️ IT IS STILL DECLARED, AND RULE-NESTED IS STILL WIRED, because the moment
 * anyone gives `LiveSession` a relation the rule must already exist — adding the
 * relation and remembering to also add the rule is exactly the sequence that
 * does not happen. The anti-vacuity block below proves RULE-NESTED fires against
 * a fabricated relation, so the rule is demonstrably alive on an empty list.
 */
const SOFT_DELETABLE_RELATIONS: readonly string[] = [];

/** The one identifier that counts as "filtered". */
const FILTER_IDENTIFIER = 'NOT_DELETED';

const EXEMPT_MARKER = 'AD-5-EXEMPT:';

/**
 * EVERY sanctioned unfiltered read in this directory, as `<file>:<what>` plus
 * its reason.
 *
 * 🔴 IT IS `[]` AND IT SHOULD STAY `[]`. Plan §2.10's admin table has no
 * `?includeDeleted` read for live sessions, so the admin list is a list of LIVE
 * sessions, and `restore` evaluates the 30-day window INSIDE the `UPDATE`'s own
 * `WHERE` (forum's D-6.13d idiom, carried into `soft-delete.ts`), so there is no
 * tombstone read on the write path either.
 *
 * ⚠️ SO IF A LATER TASK WANTS AN EXEMPTION, THAT IS A DESIGN EVENT, NOT A
 * FORMALITY. An exemption on a MEMBER path should be refused in review outright.
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
 * `grep -rn "AD-5-EXEMPT"` finds.
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
 * spec gets deleted by the third developer who hits it.
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
 * The model accessor in `this.prisma.liveSession.findMany` — i.e. `liveSession`.
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
function analyze(
  files: readonly SourceFile[],
  relations: readonly string[] = SOFT_DELETABLE_RELATIONS,
): Analysis {
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
          has(relations, node.name.text)
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
                  `. It reaches a soft-deletable model, so it returns ` +
                  `TOMBSTONES. Write ` +
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
                    `\`LiveSession.calendarEventId\` is @unique, which makes this ` +
                    `especially tempting for the AD-3 claim lookup. ` +
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

/** `src/lib/live-sessions/` — this file lives at `live-sessions/common/`. */
const SCAN_ROOT = resolve(__dirname, '..');

function collectServices(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) collectServices(full, acc);
    else if (entry.name.endsWith('.service.ts')) acc.push(full);
  }
  return acc;
}

const SERVICE_FILES: SourceFile[] = collectServices(SCAN_ROOT).map((full) => ({
  label: full.slice(SCAN_ROOT.length + 1).replace(/\\/g, '/'),
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

/**
 * The minimum number of real services this directory holds — the anti-vacuity
 * bound. Two today: `live-sessions.service.ts` (Task 12.7) and
 * `live-feed.service.ts` (Task 12.8). A scan finding fewer means the loader
 * broke and every "no violations" assertion above is silently vacuous.
 */
const MIN_SERVICE_FILES = 2;

/* -------------------------------------------------------------------------- */

describe('AD-5 — every live-session read filters soft-deleted rows', () => {
  describe('the real source tree', () => {
    it('has no unfiltered read', () => {
      // toEqual on the details, not a count: the failure message NAMES the
      // file, the model, the method, and what to write instead.
      expect(REAL.violations.map((v) => `${v.rule}: ${v.detail}`)).toEqual([]);
    });

    it('takes exactly the exemptions enumerated in EXPECTED_EXEMPTIONS', () => {
      // ⚠️ THE CENSUS. Without it the escape hatch would BE the rule: anyone
      // could silence a failure by typing a comment.
      expect(REAL.exemptions.map((e) => e.key).sort()).toEqual(
        [...EXPECTED_EXEMPTIONS].sort(),
      );
    });

    it('is rooted at live-sessions/ and NOT at the lib — the four pre-AD-5 directories are out of scope', () => {
      // 🔴 THE ROOT IS THE DECISION THIS FILE IS ABOUT. If someone "fixes" it to
      // `src/lib`, this fails immediately and names the reason, rather than the
      // suite going red on `circle/`, `packs/`, `member-groups/` and
      // `google-sessions/` — none of which reads a model with a `deletedAt`.
      const dirs = readdirSync(SCAN_ROOT, { withFileTypes: true })
        .filter((e) => e.isDirectory())
        .map((e) => e.name);

      expect(SCAN_ROOT.endsWith(`lib${sep}live-sessions`)).toBe(true);
      expect(dirs).toContain('common');
      // …and it can NOT see its siblings, which is what "out of scope" means
      // structurally rather than in prose.
      expect(dirs).not.toContain('packs');
      expect(dirs).not.toContain('google-sessions');
    });

    it(`scans at least ${MIN_SERVICE_FILES} real service files`, () => {
      // Listing the paths, not just counting them, so a failure says WHICH file
      // stopped being seen.
      const scanned = SERVICE_FILES.map((f) => f.label).sort();

      expect({ count: scanned.length, scanned }).toEqual({
        count: scanned.length,
        scanned,
      });
      expect(scanned.length).toBeGreaterThanOrEqual(MIN_SERVICE_FILES);
    });
  });

  describe('anti-vacuity — analyze() actually detects each evasion', () => {
    it('flags an unfiltered findMany on liveSession', () => {
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.liveSession.findMany({ where: { visibility } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a read with no `where` at all', () => {
      const found = analyze([
        probe(
          `class S { all() { return this.prisma.liveSession.findMany(); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags each model in SOFT_DELETABLE_MODELS', () => {
      // A typo in the list would silently exempt a whole model.
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
          `class S { n() { return this.prisma.liveSession.count({ where: { visibility } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags a LITERAL `deletedAt: null`, which is semantically right and structurally wrong', () => {
      const found = analyze([
        probe(`class S {
          list() { return this.prisma.liveSession.findMany({ where: { deletedAt: null } }); }
        }`),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-FILTER']);
    });

    it('flags findUnique on the @unique calendarEventId — the AD-3 claim lookup that CANNOT be filtered', () => {
      // 🔴 The exact shape this directory is tempted to write. `@unique
      // calendar_event_id` makes it look like the natural lookup, and its
      // `where` cannot carry `deletedAt`.
      const found = analyze([
        probe(
          `class S {
             claimed(calendarEventId) {
               return this.prisma.liveSession.findUnique({ where: { calendarEventId } });
             }
           }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
      expect(found.violations[0]?.detail).toContain('calendarEventId');
    });

    it('flags findUniqueOrThrow too', () => {
      const found = analyze([
        probe(
          `class S { get(id) { return this.prisma.liveSession.findUniqueOrThrow({ where: { id } }); } }`,
        ),
      ]);

      expect(rulesOf(found)).toEqual(['RULE-UNIQUE']);
    });

    it('RULE-NESTED is ALIVE even though LiveSession has no relations today', () => {
      // 🔴 THE POINT OF THIS TEST. `SOFT_DELETABLE_RELATIONS` is `[]` because the
      // schema gives `LiveSession` no relation — so the rule cannot fire on the
      // real tree, and a rule that cannot fire is indistinguishable from a rule
      // that is broken. Running the analyser with a fabricated relation list
      // proves the machinery works, so the day someone adds a relation the only
      // change needed is one entry in the constant.
      const found = analyze(
        [
          probe(`class S {
            tree(id) {
              return this.prisma.liveSession.findFirst({
                where: { id, ...NOT_DELETED },
                include: { replays: true },
              });
            }
          }`),
        ],
        ['replays'],
      );

      expect(rulesOf(found)).toEqual(['RULE-NESTED']);
    });

    it('flags a bare exemption comment with no reason', () => {
      const found = analyze([
        probe(`class S {
          list() {
            // AD-5-EXEMPT:
            return this.prisma.liveSession.findMany({ where: {} });
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
             list(ctx) {
               return this.prisma.liveSession.findMany({
                 where: { ...NOT_DELETED, ...buildLiveSessionVisibilityWhere(ctx) },
               });
             }
           }`,
          'a.service.ts',
        ),
        // 2. the filter inside an AND
        probe(
          `class S {
             list() { return this.prisma.liveSession.findMany({ where: { AND: [NOT_DELETED, { startsAt }] } }); }
           }`,
          'b.service.ts',
        ),
        // 3. a hoisted `where` const — one hop of resolution
        probe(
          `class S {
             list() {
               const where = { ...NOT_DELETED, startsAt: { gte: now } };
               return this.prisma.liveSession.findMany({ where });
             }
           }`,
          'c.service.ts',
        ),
        // 4. reads on models with NO deletedAt column — the filter would not
        //    even compile there, so requiring it would be a false positive.
        //    `sessionRequest` is the one that matters: the whole Phase-4 private
        //    session path reads it, and none of those reads is a violation.
        probe(
          `class S {
             mine(userId) { return this.prisma.sessionRequest.findMany({ where: { userId } }); }
             queue(status) { return this.prisma.sessionRequest.findMany({ where: { status } }); }
             groups(keys) { return this.prisma.memberGroup.findMany({ where: { key: { in: keys } } }); }
           }`,
          'e.service.ts',
        ),
        // 5. a WRITE — soft delete itself must be able to target a live row
        probe(
          `class S {
             del(id, deletedBy) {
               return this.prisma.liveSession.update({
                 where: { id },
                 data: { deletedAt: new Date(), deletedBy },
               });
             }
           }`,
          'f.service.ts',
        ),
        // 6. the exemption-free restore idiom (forum's D-6.13d), carried here
        probe(
          `class S {
             restore(id, cutoff) {
               return this.prisma.liveSession.updateMany({
                 where: { id, deletedAt: { gte: cutoff } },
                 data: { deletedAt: null, deletedBy: null },
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
               // AD-5-EXEMPT: admin ?includeDeleted moderation read (plan 2.10)
               return this.prisma.liveSession.findMany({ where: { visibility } });
             }
           }`,
          'admin-live-sessions.service.ts',
        ),
      ]);

      expect(found.violations).toEqual([]);
      expect(found.exemptions).toEqual([
        {
          key: 'admin-live-sessions.service.ts:liveSession.findMany',
          reason: 'admin ?includeDeleted moderation read (plan 2.10)',
        },
      ]);
    });

    it('an exemption is NOT silently free — the census would reject this one', () => {
      // The other half of the mechanism. The exemption is well-formed, so
      // `analyze` accepts it; the real-tree census then fails because it is not
      // in EXPECTED_EXEMPTIONS.
      const found = analyze([
        probe(`class S {
          list() {
            // AD-5-EXEMPT: some reason
            return this.prisma.liveSession.findMany({ where: {} });
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
          a() { return this.prisma.liveSession.findMany({}); }
          b() { return this.prisma.liveSession.count({}); }
          c() { return this.prisma.liveSession.findUnique({ where: { id } }); }
          d() { return this.prisma.liveSession.findFirst({ where: { startsAt } }); }
        }`),
      ]);

      expect(found.violations).toHaveLength(4);
      expect(rulesOf(found)).toEqual(['RULE-FILTER', 'RULE-UNIQUE']);
    });

    it('KNOWN LIMIT: an OR whose other branch is wider passes — the mitigation is review', () => {
      // Documented rather than fixed. RULE-FILTER checks for a MENTION of the
      // constant, not for an effect.
      const found = analyze([
        probe(`class S {
          list() {
            return this.prisma.liveSession.findMany({ where: { OR: [NOT_DELETED, { startsAt }] } });
          }
        }`),
      ]);

      expect(found.violations).toEqual([]);
    });
  });
});
