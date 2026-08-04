/**
 * `.ptah/specs/` contract CI ratchet (TASK_2026_179, step 9).
 *
 * This suite is a GUARD, not a unit test. It exists because the failure it
 * prevents is silent: a divergent per-task document name, a dead spec root, or
 * a carrier that no longer round-trips does not crash — it makes a task folder
 * quietly invisible to the Tasks board and to the skill harvester. Four duties:
 *
 *  1. Per-task filename string literals in TypeScript live in ONE place. A new
 *     hand-written list cannot appear without a deliberate allowlist edit.
 *  2. No agent template or orchestration skill asset may name a per-task `*.md`
 *     outside `DOC_FILES`.
 *  3. The dead identifiers — the two retired spec roots and the hard-coded
 *     prior-year task prefix (see `DEAD_ROOTS` / `DEAD_YEAR_PREFIX` below,
 *     which spell them out) — cannot come back.
 *  4. `renderTaskMd` output survives `parseTaskFile` for EVERY status × type
 *     pair, including hostile titles.
 *
 * Duty 4 is the load-bearing one. The emitter (a hand-rolled YAML writer in
 * `libs/shared`, which cannot depend on `gray-matter` because that pulls in
 * `node:fs` and would break the webview build) and the parser (`gray-matter` +
 * Zod, backend-only) are two separate pieces of code that MUST agree. Nothing
 * else in the build checks that they still do.
 */
import * as fs from 'fs';
import * as path from 'path';
import {
  CARRIER_FILE,
  DOC_FILES,
  SPEC_ROOT,
  TASK_STATUSES,
  TASK_TYPES,
  renderTaskMd,
  type TaskStatus,
  type TaskType,
} from '@ptah-extension/shared';
import { parseTaskFile } from './task-frontmatter';

// ---------------------------------------------------------------------------
// Repo-root discovery + file walking
// ---------------------------------------------------------------------------

/** Walk up from this file until the Nx workspace root is found. */
function findRepoRoot(): string {
  let dir = __dirname;
  for (let i = 0; i < 12; i++) {
    if (fs.existsSync(path.join(dir, 'nx.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the Nx workspace root from ' + __dirname);
}

const REPO_ROOT = findRepoRoot();

const SKIP_DIRS = new Set([
  'node_modules',
  'dist',
  'coverage',
  '.nx',
  '.git',
  '.angular',
  '.astro',
]);

/** Every file under `dir` matching `test`, as repo-relative POSIX paths. */
function walkFiles(dir: string, test: (name: string) => boolean): string[] {
  const found: string[] = [];
  if (!fs.existsSync(dir)) return found;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      found.push(...walkFiles(full, test));
    } else if (test(entry.name)) {
      found.push(path.relative(REPO_ROOT, full).split(path.sep).join('/'));
    }
  }
  return found;
}

function read(relPath: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relPath), 'utf8');
}

/** Every `.ts`/`.tsx` file in the workspace's own source trees. */
function allTypeScriptFiles(): string[] {
  return [
    ...walkFiles(path.join(REPO_ROOT, 'apps'), (n) => /\.tsx?$/.test(n)),
    ...walkFiles(path.join(REPO_ROOT, 'libs'), (n) => /\.tsx?$/.test(n)),
  ];
}

/**
 * Strip line and block comments while preserving string literals intact.
 *
 * Duty 1 is about CODE, not prose: a doc comment that mentions
 * `implementation-plan.md` while citing a task's own plan is not a second
 * doc-file list, and flagging it would make the ratchet useless noise.
 */
function stripComments(source: string): string {
  let out = '';
  let i = 0;
  const n = source.length;
  while (i < n) {
    const c = source[i];
    const d = source[i + 1];
    if (c === '/' && d === '/') {
      while (i < n && source[i] !== '\n') i++;
      continue;
    }
    if (c === '/' && d === '*') {
      i += 2;
      while (i < n && !(source[i] === '*' && source[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') {
      const quote = c;
      out += c;
      i++;
      while (i < n) {
        if (source[i] === '\\') {
          out += source[i] + (source[i + 1] ?? '');
          i += 2;
          continue;
        }
        out += source[i];
        if (source[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// ---------------------------------------------------------------------------
// Duty 1 — per-task filename literals live in exactly one place
// ---------------------------------------------------------------------------

/** Every filename the contract owns, carrier included. */
const OWNED_FILENAMES: readonly string[] = [...DOC_FILES, CARRIER_FILE];

/**
 * Production TypeScript files permitted to hand-write a per-task filename.
 *
 * EXPLICIT and closed. Each entry is a pre-existing consumer that predates the
 * contract module; listing it FREEZES the current state — a new file cannot
 * start its own doc-file list without a deliberate edit here, which is the
 * whole point. Adding an entry is a review conversation, not a formality.
 */
const LITERAL_ALLOWLIST: ReadonlyArray<{ file: string; why: string }> = [
  {
    file: 'libs/shared/src/lib/types/task-spec.contract.ts',
    why: 'The contract itself — this is the one place the names are defined.',
  },
  {
    file: 'libs/backend/task-specs/src/lib/contract.guard.spec.ts',
    why: 'This ratchet; it must name what it guards.',
  },
  {
    file: 'libs/backend/skill-synthesis/src/lib/spec-extractor.ts',
    why: 'Reads a SUBSET (graded-critique artifacts) that DOC_FILES does not model as a subset.',
  },
  {
    file: 'libs/backend/vscode-lm-tools/src/lib/code-execution/namespace-builders/orchestration-namespace.builder.ts',
    why: 'Maps orchestration stages to required artifacts, including the permanent batches.md/tasks.md pair.',
  },
  {
    file: 'apps/ptah-cli/src/cli/commands/execute-spec.ts',
    why: 'CLI spec-execution reads two fixed documents; Phase 2 moves it onto the contract.',
  },
];

const ALLOWLISTED_FILES = new Set(LITERAL_ALLOWLIST.map((e) => e.file));

/**
 * `*.spec.ts` is exempt as a CATEGORY, deliberately and visibly.
 *
 * Test fixtures must be able to write a literal `task.md` onto a temp folder —
 * that is what makes them tests of the real on-disk shape rather than of the
 * constant. Tests ship no behaviour, so a literal there cannot diverge from the
 * contract in production.
 */
function isTestFile(relPath: string): boolean {
  return /\.(spec|test)\.tsx?$/.test(relPath);
}

describe('contract guard — per-task filename literals', () => {
  it('appear only in the contract module and its explicit allowlist', () => {
    const offenders: string[] = [];
    for (const relPath of allTypeScriptFiles()) {
      if (ALLOWLISTED_FILES.has(relPath) || isTestFile(relPath)) continue;
      const code = stripComments(read(relPath));
      const found = OWNED_FILENAMES.filter((name) =>
        new RegExp(`['"]${name.replace(/\./g, '\\.')}['"]`).test(code),
      );
      if (found.length > 0) {
        offenders.push(`${relPath} → ${found.join(', ')}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  it('has an allowlist whose every entry still exists', () => {
    const missing = LITERAL_ALLOWLIST.filter(
      (entry) => !fs.existsSync(path.join(REPO_ROOT, entry.file)),
    ).map((entry) => entry.file);
    // A stale allowlist entry silently widens the guard.
    expect(missing).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Duty 2 — assets may only name documents the contract recognises
// ---------------------------------------------------------------------------

const AGENT_TEMPLATE_DIR = 'libs/backend/agent-generation/templates/agents';
const ORCHESTRATION_SKILL_DIR =
  'apps/ptah-extension-vscode/assets/plugins/ptah-core/skills/orchestration';

function assetFiles(): string[] {
  return [
    ...walkFiles(path.join(REPO_ROOT, AGENT_TEMPLATE_DIR), (n) =>
      n.endsWith('.md'),
    ),
    ...walkFiles(path.join(REPO_ROOT, ORCHESTRATION_SKILL_DIR), (n) =>
      n.endsWith('.md'),
    ),
  ];
}

/**
 * A per-task document is a `*.md` sitting in a TASK-FOLDER POSITION, i.e.
 * `<SPEC_ROOT>/<folder>/<name>.md`. Detection is positional on purpose: agent
 * templates also name `CLAUDE.md`, `SKILL.md`, `README.md` and design-system
 * docs, none of which are per-task documents, and a bare filename scan would
 * drown the real signal.
 */
const SPEC_DOC_REFERENCE = new RegExp(
  `${SPEC_ROOT.replace(/\./g, '\\.')}/[^\\s)\`"',]+?/([A-Za-z0-9_.*<>-]+\\.md)`,
  'g',
);

/** Glob / placeholder forms that are not filenames at all. */
function isPlaceholder(name: string): boolean {
  return name.includes('*') || name.includes('<');
}

describe('contract guard — asset document names', () => {
  it('names only documents inside DOC_FILES (plus the carrier)', () => {
    const recognised = new Set<string>(OWNED_FILENAMES);
    const offenders: string[] = [];

    for (const relPath of assetFiles()) {
      const text = read(relPath);
      for (const match of text.matchAll(SPEC_DOC_REFERENCE)) {
        const name = match[1];
        if (isPlaceholder(name) || recognised.has(name)) continue;
        offenders.push(`${relPath} → ${name}`);
      }
    }

    // R2: when this fails, FIX THE ASSET or widen DOC_FILES on purpose.
    // Never relax the rule to get green.
    expect([...new Set(offenders)]).toEqual([]);
  });

  it('actually scanned both asset trees (a silent zero-file scan is a lie)', () => {
    const files = assetFiles();
    expect(files.some((f) => f.startsWith(AGENT_TEMPLATE_DIR))).toBe(true);
    expect(files.some((f) => f.startsWith(ORCHESTRATION_SKILL_DIR))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Duty 3 — dead identifiers cannot come back
// ---------------------------------------------------------------------------

const SKILL_ASSET_ROOTS = [
  'apps/ptah-extension-vscode/assets/plugins',
  AGENT_TEMPLATE_DIR,
];

function skillAssetFiles(): string[] {
  return SKILL_ASSET_ROOTS.flatMap((rel) =>
    walkFiles(path.join(REPO_ROOT, rel), (n) => n.endsWith('.md')),
  );
}

/**
 * The two dead spec roots. Neither has any legitimate use anywhere.
 *
 * Assembled from fragments so this file does not contain the banned strings
 * itself. That is not cosmetic: the alternative — exempting this file from its
 * own scan — would punch a permanent hole in the very rule it enforces.
 */
const DEAD_ROOTS = ['.ptah/' + 'tasks/', 'task-' + 'tracking/'] as const;

/** Same reasoning: the banned year prefix, never spelled out in one piece. */
const DEAD_YEAR_PREFIX = 'TASK_' + '2025_';

/**
 * A hard-coded year prefix in a SPEC-PATH position.
 *
 * Deliberately positional. The dead prefix also appears in ~67 TypeScript files
 * as a provenance citation (a comment naming the task that shipped a change)
 * and in log strings that record the same. Those are history, not spec paths, and
 * banning them would demand rewriting the commit record of unrelated libs
 * — that is not what the Phase-0 fix was about. What the fix WAS about is a
 * hard-coded year used to locate or match a task folder, which is exactly what
 * this pattern catches.
 */
const HARDCODED_YEAR_SPEC_PATH = new RegExp(`specs[/\\\\]${DEAD_YEAR_PREFIX}`);

describe('contract guard — dead identifiers', () => {
  it.each(DEAD_ROOTS)('no TypeScript file contains %s', (dead) => {
    const offenders = allTypeScriptFiles().filter((relPath) =>
      read(relPath).includes(dead),
    );
    expect(offenders).toEqual([]);
  });

  it.each(DEAD_ROOTS)('no skill asset contains %s', (dead) => {
    const offenders = skillAssetFiles().filter((relPath) =>
      read(relPath).includes(dead),
    );
    expect(offenders).toEqual([]);
  });

  it('no TypeScript file hard-codes the dead year prefix in a spec path', () => {
    const offenders = allTypeScriptFiles().filter((relPath) =>
      HARDCODED_YEAR_SPEC_PATH.test(read(relPath)),
    );
    expect(offenders).toEqual([]);
  });

  it('no skill asset mentions the dead year prefix at all', () => {
    // Assets are prose that agents imitate, so even an EXAMPLE id teaches the
    // stale year. There is no provenance-citation exemption here.
    const offenders = skillAssetFiles().filter((relPath) =>
      read(relPath).includes(DEAD_YEAR_PREFIX),
    );
    expect(offenders).toEqual([]);
  });

  it('actually scanned a non-trivial file set (guards against a no-op scan)', () => {
    expect(allTypeScriptFiles().length).toBeGreaterThan(500);
    expect(skillAssetFiles().length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Duty 4 — renderTaskMd → parseTaskFile round-trip
// ---------------------------------------------------------------------------

const FOLDER = 'TASK_2026_179';
const FIXED_NOW = '2026-08-04T12:00:00.000Z';

/**
 * Titles chosen to break a naive YAML emitter. Each one is a real way an
 * agent-authored title has looked or could look.
 */
const HOSTILE_TITLES: ReadonlyArray<[label: string, title: string]> = [
  ['a colon', 'Refactor: split the adapter'],
  ['a hash', 'Fix #412 in the parser'],
  ['double quotes', 'Rename "task.md" to nothing'],
  ['single quotes', "Don't clobber the writer's file"],
  ['a leading dash', '- leading dash looks like a list item'],
  ['a leading digit', '2026 roadmap import'],
  ['YAML true', 'true'],
  ['YAML null', 'null'],
  ['YAML no', 'no'],
  ['YAML yes/off mix', 'off'],
  ['a trailing space', 'trailing space '],
  ['a brace + bracket', 'Handle {a: [b]} shaped input'],
  ['a percent + at', '100% @ once'],
  ['unicode', 'Émettre le résumé — ligne'],
];

const MULTILINE_DESCRIPTION = [
  'First line of the description.',
  '',
  'Second paragraph with a colon: and a "quote".',
  '- and a leading dash line',
].join('\n');

describe('contract guard — renderTaskMd round-trips through parseTaskFile', () => {
  const pairs: Array<[TaskStatus, TaskType]> = TASK_STATUSES.flatMap((status) =>
    TASK_TYPES.map((type): [TaskStatus, TaskType] => [status, type]),
  );

  it('covers every status × type pair', () => {
    expect(pairs).toHaveLength(TASK_STATUSES.length * TASK_TYPES.length);
    expect(pairs).toHaveLength(48);
  });

  it.each(pairs)('%s × %s survives the round trip', (status, type) => {
    const raw = renderTaskMd({
      id: FOLDER,
      title: `Carry ${status} ${type} through`,
      type,
      status,
      dependsOn: ['TASK_2026_001', 'TASK_2026_002'],
      description: MULTILINE_DESCRIPTION,
      executor: 'backend-developer',
      now: FIXED_NOW,
    });

    const parsed = parseTaskFile(FOLDER, raw);
    if (parsed.kind !== 'task') {
      throw new Error(
        `Carrier was EXCLUDED (${parsed.excluded.reason}) for ${status}/${type}`,
      );
    }

    expect(parsed.task.status).toBe(status);
    expect(parsed.task.type).toBe(type);
    expect(parsed.task.id).toBe(FOLDER);
    expect(parsed.task.folderName).toBe(FOLDER);
    expect(parsed.task.dependsOn).toEqual(['TASK_2026_001', 'TASK_2026_002']);
    expect(parsed.task.description).toBe(MULTILINE_DESCRIPTION);
    expect(parsed.task.executor).toBe('backend-developer');
    expect(parsed.task.created).toBe(FIXED_NOW);
    expect(parsed.task.updated).toBe(FIXED_NOW);
    // No validation issues: a freshly rendered carrier must be pristine, or
    // the board shows a warning badge on every task Ptah itself created.
    expect(parsed.task.validationIssues).toEqual([]);
    expect(parsed.task.frontmatterValid).toBe(true);
  });

  it.each(HOSTILE_TITLES)('preserves a title with %s', (_label, title) => {
    const raw = renderTaskMd({
      id: FOLDER,
      title,
      type: 'REFACTORING',
      status: 'in_review',
      now: FIXED_NOW,
    });

    const parsed = parseTaskFile(FOLDER, raw);
    if (parsed.kind !== 'task') {
      throw new Error(`Carrier EXCLUDED (${parsed.excluded.reason}): ${title}`);
    }
    expect(parsed.task.title).toBe(title);
    expect(parsed.task.status).toBe('in_review');
    expect(parsed.task.validationIssues).toEqual([]);
  });

  it('emits an empty depends_on that parses back as an empty array', () => {
    const raw = renderTaskMd({
      id: FOLDER,
      title: 'No dependencies',
      type: 'FEATURE',
      now: FIXED_NOW,
    });
    const parsed = parseTaskFile(FOLDER, raw);
    expect(parsed.kind).toBe('task');
    if (parsed.kind !== 'task') return;
    expect(parsed.task.dependsOn).toEqual([]);
    expect(parsed.task.status).toBe('backlog');
  });

  it('keeps hostile dependency ids intact', () => {
    const dependsOn = ['TASK_2026_001', 'no', 'true', '- dashed', 'a: colon'];
    const raw = renderTaskMd({
      id: FOLDER,
      title: 'Hostile deps',
      type: 'BUGFIX',
      dependsOn,
      now: FIXED_NOW,
    });
    const parsed = parseTaskFile(FOLDER, raw);
    if (parsed.kind !== 'task') throw new Error('excluded');
    expect(parsed.task.dependsOn).toEqual(dependsOn);
  });

  it('writes a POINTER body — banner + summary + context link, never prose', () => {
    const raw = renderTaskMd({
      id: FOLDER,
      title: 'Pointer body',
      type: 'DOCUMENTATION',
      description: MULTILINE_DESCRIPTION,
      now: FIXED_NOW,
    });
    const parsed = parseTaskFile(FOLDER, raw);
    if (parsed.kind !== 'task') throw new Error('excluded');

    expect(parsed.body).toContain('Ptah carrier');
    expect(parsed.body).toContain('./context.md');
    // The multi-line description must NOT be splatted into the body.
    expect(parsed.body).not.toContain('- and a leading dash line');
  });
});
