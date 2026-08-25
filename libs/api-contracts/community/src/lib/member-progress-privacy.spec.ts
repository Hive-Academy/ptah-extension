import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';

import * as ts from 'typescript';

/**
 * NFR-S4 / R2.3.7 AS AN EXECUTABLE ARTEFACT — NO MEMBER TYPE CARRIES ANOTHER
 * MEMBER'S IDENTITY OR PROGRESS.
 *
 * ⚠️ WHY A SEPARATE SPEC FROM `contract-boundary.spec.ts`. That file polices the
 * member/admin BOUNDARY: it stops an admin field arriving on a member type by
 * inheritance or import. This one polices something the boundary cannot see — a
 * member type declaring a per-user field ITSELF, in `member/`, with no admin
 * type involved. `MemberLessonProgress` is the shape at risk: it is "one
 * member's progress on one lesson", and the single edit that turns it into a
 * disclosure is adding a `userId` so the client can tell whose it is.
 *
 * ⚠️ THE SCHEMA WAS ALREADY SHAPED AROUND THIS, AND THIS IS THE OTHER HALF.
 * Plan §1.4 REJECTED `@@index([lessonId])` on `LessonProgress` with the stated
 * reason that there is then no efficient way to ask "who else completed this
 * lesson", so no member endpoint accidentally can. That makes the query
 * expensive; this makes the ANSWER unrepresentable. Both should exist —
 * "expensive" is a speed bump and "there is no field to put it in" is not.
 *
 * ── THE RULE ────────────────────────────────────────────────────────────────
 * No declaration under `member/` may have a property whose name identifies
 * ANOTHER person, or aggregates people. The banned names are enumerated below
 * rather than pattern-matched, so adding one is a change to a list a reviewer
 * reads.
 *
 * ⚠️ IT IS A STRUCTURAL CHECK, NOT A `grep`. `tasks.md` Task 9.7 asks for "a
 * spec that greps the member contract files for `userId` and finds none", and a
 * literal grep would fail on the WORD `userId` inside the docblock that
 * explains why there is no such field — i.e. the more carefully a file
 * documents the rule, the louder the grep breaks. Walking property names
 * instead reads exactly what ships on the wire and ignores prose. The check is
 * strictly stronger: it also catches `user_id`, a nested `progress.userId`, and
 * a property added to a Zod-only shape.
 */

/** `src/lib/` — this file lives at `src/lib/`. */
const LIB_ROOT = __dirname;

/**
 * Property names that would put another person on a member response.
 *
 * 🔴 EACH ONE IS A CONCRETE LEAK, NOT A STYLE PREFERENCE:
 *   - `userId` / `user_id` / `authorId` / `memberId` — an account identifier a
 *     member can correlate across responses to build a roster.
 *   - `email` / `authorEmail` — the field the whole member/admin split most
 *     exists to keep apart (`admin-topic.contract.ts`).
 *   - `completedBy` / `learners` / `completionCount` / `viewerCount` — cohort
 *     analytics. §5 ships none, and plan §1.4 rejected the index that would
 *     make them efficient.
 */
const BANNED_PROPERTIES = [
  'userId',
  'user_id',
  'authorId',
  'memberId',
  'email',
  'authorEmail',
  'completedBy',
  'completionCount',
  'learners',
  'viewerCount',
] as const;

/* -------------------------------------------------------------------------- */
/* Analysis                                                                    */
/* -------------------------------------------------------------------------- */

interface SourceFile {
  readonly label: string;
  readonly text: string;
}

/**
 * Every property NAME declared anywhere in a file — interface members, type
 * literals and object-literal keys (which is what a Zod schema is).
 *
 * PURE: takes source text, touches no disk, so the anti-vacuity probes below
 * run through this exact function rather than a second copy of the logic.
 */
function propertyNamesIn(file: SourceFile): string[] {
  const source = ts.createSourceFile(
    file.label,
    file.text,
    ts.ScriptTarget.ES2021,
    /* setParentNodes */ true,
    ts.ScriptKind.TS,
  );

  const names: string[] = [];

  const nameOf = (node: ts.PropertyName | undefined): string | null => {
    if (!node) return null;
    if (ts.isIdentifier(node) || ts.isStringLiteral(node)) return node.text;
    return null;
  };

  const walk = (node: ts.Node): void => {
    if (ts.isPropertySignature(node)) {
      const name = nameOf(node.name);
      if (name !== null) names.push(name);
    }
    if (ts.isPropertyAssignment(node)) {
      const name = nameOf(node.name);
      if (name !== null) names.push(name);
    }
    if (ts.isShorthandPropertyAssignment(node)) {
      names.push(node.name.text);
    }
    ts.forEachChild(node, walk);
  };

  walk(source);
  return names;
}

function violationsIn(files: readonly SourceFile[]): string[] {
  const found: string[] = [];
  for (const file of files) {
    for (const name of propertyNamesIn(file)) {
      if ((BANNED_PROPERTIES as readonly string[]).includes(name)) {
        found.push(
          `${file.label}: declares a property named "${name}". A member ` +
            `response must carry the CALLER's own progress and identity and ` +
            `nobody else's (NFR-S4, R2.3.7). If this is genuinely the ` +
            `caller's own, it is redundant — the caller knows who they are — ` +
            `and if it is not, it is a disclosure. Remove it, or move the ` +
            `shape to admin/ and re-declare it there.`,
        );
      }
    }
  }
  return found;
}

/* -------------------------------------------------------------------------- */
/* The real source tree                                                        */
/* -------------------------------------------------------------------------- */

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

const MEMBER_DIR = join(LIB_ROOT, 'member');

const MEMBER_FILES: SourceFile[] = collectTs(MEMBER_DIR).map((full) => ({
  label: `member/${full.slice(MEMBER_DIR.length + 1)}`.replace(/\\/g, '/'),
  text: readFileSync(full, 'utf8'),
}));

const probe = (
  text: string,
  label = 'member/probe.contract.ts',
): SourceFile => ({
  label,
  text,
});

/* -------------------------------------------------------------------------- */

describe('NFR-S4 — no member contract carries another member', () => {
  describe('the real source tree', () => {
    it('declares none of the banned properties', () => {
      // toEqual on the details, not a count: the failure names the file and the
      // property and says what to do instead.
      expect(violationsIn(MEMBER_FILES)).toEqual([]);
    });

    it('is actually reading the course contracts — the loader is not pointed at nothing', () => {
      // 🔴 THE ANTI-VACUITY GUARD. "No violations" is trivially true of an empty
      // file list, and the failure mode this guards is a loader that silently
      // stops covering the very files Batch 9 added.
      const labels = MEMBER_FILES.map((f) => f.label).sort();

      expect(labels).toContain('member/member-course.contract.ts');
      expect(labels).toContain('member/member-lesson-comment.contract.ts');
      expect(MEMBER_FILES.length).toBeGreaterThanOrEqual(8);
    });

    it('really does declare the progress shape it is policing', () => {
      // Without this, the rule above would pass just as well against a lib that
      // had never shipped a progress type at all.
      const names = MEMBER_FILES.filter((f) =>
        f.label.endsWith('member-course.contract.ts'),
      ).flatMap(propertyNamesIn);

      expect(names).toContain('furthestPositionSeconds');
      expect(names).toContain('completionSource');
      expect(names).toContain('completedAt');
    });
  });

  describe('anti-vacuity — violationsIn() actually detects each shape', () => {
    it('flags a bare `userId` on an interface', () => {
      const found = violationsIn([
        probe(
          `export interface P { userId: string; positionSeconds: number; }`,
        ),
      ]);

      expect(found).toHaveLength(1);
      expect(found[0]).toContain('"userId"');
    });

    it('flags a NESTED one, which a top-level scan would miss', () => {
      const found = violationsIn([
        probe(
          `export interface D { progress: { userId: string; furthestPositionSeconds: number } }`,
        ),
      ]);

      expect(found).toHaveLength(1);
    });

    it('flags one that appears only in the Zod schema', () => {
      // A schema key with no matching interface field still ships on the wire
      // for anyone constructing the object from the schema's inferred type.
      const found = violationsIn([
        probe(`export const s = z.object({ userId: z.string() });`),
      ]);

      expect(found).toHaveLength(1);
    });

    it('flags each banned name — a typo in the list would silently exempt one', () => {
      for (const name of BANNED_PROPERTIES) {
        const found = violationsIn([probe(`interface P { ${name}: string }`)]);
        expect({ name, count: found.length }).toEqual({ name, count: 1 });
      }
    });

    it('does NOT flag the legal shapes — the negative control', () => {
      // A rule that flags everything is as useless as one that flags nothing.
      // `authorName` is the permitted display field; `lessonId` and `parentId`
      // identify CONTENT, not people.
      const found = violationsIn([
        probe(
          `export interface C {
             id: string;
             lessonId: string;
             parentId: string | null;
             authorName: string | null;
             completedAt: string | null;
             furthestPositionSeconds: number;
           }`,
        ),
      ]);

      expect(found).toEqual([]);
    });

    it('does NOT flag the WORD userId when it appears only in a docblock', () => {
      // 🔴 THE REASON THIS IS NOT A `grep`. The files that document the rule
      // best are the ones a text search breaks on, which is how a structural
      // spec earns a reputation for false positives and gets deleted.
      const found = violationsIn([
        probe(`/** There is no \`userId\` here, and there must not be. */
               export interface P { furthestPositionSeconds: number }`),
      ]);

      expect(found).toEqual([]);
    });
  });

  it('lives at src/lib and the member directory is where it thinks it is', () => {
    expect(LIB_ROOT.endsWith(`src${sep}lib`)).toBe(true);
  });
});
