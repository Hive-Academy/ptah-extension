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
  CARRIER_BANNER,
  CARRIER_FILE,
  CONTEXT_FILE,
  DOC_FILES,
  SPEC_ROOT,
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  renderTaskMd,
  type RenderTaskMdInput,
  type TaskSpecSummary,
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

  /**
   * The three descriptions that actually made carriers vanish (D6).
   *
   * On 2026-08-09 `TASK_2026_182`, `188` and `189` were invisible to the board:
   * each held a `description:` written as an unquoted plain YAML scalar, which
   * terminates at the first `: `, so the whole document failed to parse and the
   * task disappeared rather than merely mislabelling itself.
   *
   * `renderTaskMd` did NOT write those three — every one of them carries
   * `assignee:` and `claim:`, fields the renderer has never emitted, so they
   * were hand-authored from the orchestration skill's template (fixed in the
   * same commit as this test). The renderer routes any unsafe scalar through
   * `JSON.stringify`, which is a valid YAML double-quoted scalar, and it is
   * correct today. This block is the RATCHET that keeps it correct: these exact
   * strings, verbatim, through render → parse → byte equality.
   */
  const KILLING_DESCRIPTIONS: ReadonlyArray<[label: string, text: string]> = [
    [
      '182 — a ternary with colon-space',
      'nativeAvailable ? describe : describe.skip',
    ],
    [
      '188 — a JSON flow mapping',
      'a client sending {"field": null} to a dtoPipe endpoint',
    ],
    [
      '189 — a call with a quoted path',
      "config({ path: resolve(__dirname, '.env') })",
    ],
    [
      'all four hostile characters at once',
      'colon: brace { quote " apostrophe \'',
    ],
  ];

  it.each(KILLING_DESCRIPTIONS)(
    'a description containing %s round-trips byte-exact',
    (_label, description) => {
      const raw = renderTaskMd({
        id: FOLDER,
        title: 'Carrier with a hostile description',
        type: 'BUGFIX',
        status: 'done',
        description,
        now: FIXED_NOW,
      });

      const parsed = parseTaskFile(FOLDER, raw);
      if (parsed.kind !== 'task') {
        throw new Error(
          `Carrier EXCLUDED (${parsed.excluded.reason}) for description: ${description}`,
        );
      }
      // Byte equality on the field, not merely "it parsed".
      expect(parsed.task.description).toBe(description);
      expect(parsed.task.status).toBe('done');
      expect(parsed.task.validationIssues).toEqual([]);
    },
  );

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
    expect(parsed.body).toContain(`./${CONTEXT_FILE}`);
    // The multi-line description must NOT be splatted into the body.
    expect(parsed.body).not.toContain('- and a leading dash line');
  });
});

// ---------------------------------------------------------------------------
// Duty 4, extended — the five metadata fields round-trip
// ---------------------------------------------------------------------------
//
// The emitter and the parser are still two separate pieces of code that must
// agree, and this task adds five more fields to the set they must agree on:
// `labels`, `estimate`, `parent`, `duplicates`, `relates_to`. Each is exercised
// across {absent, empty, single, many, quoted-scalar} because those are the five
// shapes where an emitter and a parser can silently disagree:
//
//  - ABSENT  — the key must never be emitted, and the field must default.
//  - EMPTY   — an empty array must REMOVE the key rather than emit `[]`. A
//              carrier that accumulates `labels: []` on every write is metadata
//              noise nobody asked for. (`depends_on` is the deliberate
//              exception; it has always been written as `[]` and stays so.)
//  - SINGLE / MANY — order and arity survive.
//  - QUOTED  — the value fails `isPlainSafeScalar` and must round-trip through
//              the double-quoted form verbatim, trailing space and all.
//
// Fixture ids are `TASK_2026_*` only, and every document name is interpolated
// from the contract module — the ratchet above scans this file too.

const META_FOLDER = 'TASK_2026_181';

/**
 * Labels chosen to break a naive YAML emitter. Every one of these is a shape a
 * human types into a label field without thinking about YAML for one second.
 */
const HOSTILE_LABELS: ReadonlyArray<[label: string, value: string]> = [
  ['a colon', 'needs:design'],
  ['a hash', '#urgent'],
  ['a leading digit', '2fa'],
  ['a leading dash', '-wip'],
  ['a YAML reserved word', 'no'],
  ['a trailing space', 'trailing '],
  ['unicode', 'sécurité'],
];

/**
 * Relation entries that are legal folder names but hostile YAML scalars. A
 * folder predating the `TASK_YYYY_NNN` convention is exactly this shape.
 */
const HOSTILE_RELATION_IDS: readonly string[] = ['2026_legacy_folder', 'no'];

function renderWithMetadata(
  overrides: Partial<RenderTaskMdInput> = {},
): string {
  return renderTaskMd({
    id: META_FOLDER,
    title: 'Metadata round trip',
    type: 'FEATURE',
    now: FIXED_NOW,
    ...overrides,
  });
}

/** Parse a carrier that MUST stay included; throws with the reason if not. */
function parseIncluded(raw: string, folder = META_FOLDER): TaskSpecSummary {
  const parsed = parseTaskFile(folder, raw);
  if (parsed.kind !== 'task') {
    throw new Error(`Carrier was EXCLUDED (${parsed.excluded.reason}).`);
  }
  return parsed.task;
}

/** Splice an extra frontmatter line in, to author shapes the emitter cannot. */
function withExtraFrontmatterLines(raw: string, ...lines: string[]): string {
  return raw.replace('depends_on: []', ['depends_on: []', ...lines].join('\n'));
}

interface ArrayFieldCase {
  readonly name: string;
  /** The YAML key as emitted. */
  readonly key: string;
  readonly render: (values: readonly string[]) => string;
  readonly read: (task: TaskSpecSummary) => readonly string[];
  readonly single: readonly string[];
  readonly many: readonly string[];
  readonly quoted: readonly string[];
}

const ARRAY_FIELDS: readonly ArrayFieldCase[] = [
  {
    name: 'labels',
    key: 'labels',
    render: (labels) => renderWithMetadata({ labels }),
    read: (task) => task.labels,
    single: ['licensing'],
    many: ['licensing', 'billing', 'webview'],
    quoted: HOSTILE_LABELS.map(([, value]) => value),
  },
  {
    name: 'duplicates',
    key: 'duplicates',
    render: (duplicates) => renderWithMetadata({ duplicates }),
    read: (task) => task.duplicates,
    single: ['TASK_2026_001'],
    many: ['TASK_2026_001', 'TASK_2026_002', 'TASK_2026_003'],
    quoted: HOSTILE_RELATION_IDS,
  },
  {
    name: 'relates_to',
    key: 'relates_to',
    render: (relatesTo) => renderWithMetadata({ relatesTo }),
    read: (task) => task.relatesTo,
    single: ['TASK_2026_010'],
    many: ['TASK_2026_010', 'TASK_2026_011'],
    quoted: HOSTILE_RELATION_IDS,
  },
];

describe.each(ARRAY_FIELDS)(
  'contract guard — $name round-trips through parseTaskFile',
  (field) => {
    it('ABSENT: the key is never emitted and the field reads back as []', () => {
      const raw = renderWithMetadata();
      expect(raw).not.toContain(`${field.key}:`);
      const task = parseIncluded(raw);
      expect(field.read(task)).toEqual([]);
      expect(task.validationIssues).toEqual([]);
    });

    it('EMPTY: the key is REMOVED from the rendered text, and reads back as []', () => {
      const raw = field.render([]);
      expect(raw).not.toContain(`${field.key}:`);
      expect(field.read(parseIncluded(raw))).toEqual([]);
    });

    it('SINGLE: one entry survives verbatim', () => {
      const raw = field.render(field.single);
      expect(raw).toContain(`${field.key}:`);
      const task = parseIncluded(raw);
      expect(field.read(task)).toEqual([...field.single]);
      expect(task.validationIssues).toEqual([]);
    });

    it('MANY: every entry survives, in authored order', () => {
      const raw = field.render(field.many);
      const task = parseIncluded(raw);
      expect(field.read(task)).toEqual([...field.many]);
      expect(task.validationIssues).toEqual([]);
    });

    it('QUOTED-SCALAR: hostile entries are emitted quoted and read back byte-exact', () => {
      const raw = field.render(field.quoted);
      for (const value of field.quoted) {
        // JSON string syntax IS a valid YAML double-quoted scalar — that is the
        // emitter's whole fallback strategy, so assert it took that branch.
        expect(raw).toContain(`  - ${JSON.stringify(value)}`);
      }
      const task = parseIncluded(raw);
      expect(field.read(task)).toEqual([...field.quoted]);
      expect(task.validationIssues).toEqual([]);
    });
  },
);

describe('contract guard — estimate round-trips through parseTaskFile', () => {
  it('ABSENT: no estimate key is emitted and the field is undefined', () => {
    const raw = renderWithMetadata();
    expect(raw).not.toContain('estimate:');
    expect(parseIncluded(raw).estimate).toBeUndefined();
  });

  it.each([...TASK_ESTIMATES])(
    '%s emits as an UNQUOTED plain scalar and reads back unchanged',
    (estimate) => {
      const raw = renderWithMetadata({ estimate });
      // None of the five collides with a YAML boolean token, so none is
      // quoted. If one ever did, this assertion is where it surfaces.
      expect(raw).toContain(`\nestimate: ${estimate}\n`);
      const task = parseIncluded(raw);
      expect(task.estimate).toBe(estimate);
      expect(task.validationIssues).toEqual([]);
    },
  );

  it('an unknown value is a WARNING naming the raw value, never an exclusion', () => {
    const raw = withExtraFrontmatterLines(
      renderWithMetadata(),
      'estimate: HUGE',
    );
    const task = parseIncluded(raw);
    expect(task.estimate).toBeUndefined();
    const issue = task.validationIssues.find(
      (i) => i.code === 'invalid_estimate',
    );
    expect(issue).toBeDefined();
    expect(issue?.field).toBe('estimate');
    expect(issue?.message).toContain('HUGE');
    expect(task.frontmatterValid).toBe(false);
  });
});

describe('contract guard — parent round-trips through parseTaskFile', () => {
  it('ABSENT: no parent key is emitted and the field is undefined', () => {
    const raw = renderWithMetadata();
    expect(raw).not.toContain('parent:');
    expect(parseIncluded(raw).parent).toBeUndefined();
  });

  it('EMPTY: an empty parent removes the key entirely', () => {
    const raw = renderWithMetadata({ parent: '' });
    expect(raw).not.toContain('parent:');
    expect(parseIncluded(raw).parent).toBeUndefined();
  });

  it('SINGLE: a parent folder name survives', () => {
    const raw = renderWithMetadata({ parent: 'TASK_2026_100' });
    const task = parseIncluded(raw);
    expect(task.parent).toBe('TASK_2026_100');
    expect(task.validationIssues).toEqual([]);
  });

  it('QUOTED-SCALAR: a hostile parent folder name survives byte-exact', () => {
    const raw = renderWithMetadata({ parent: '2026_legacy_folder' });
    expect(raw).toContain('parent: "2026_legacy_folder"');
    expect(parseIncluded(raw).parent).toBe('2026_legacy_folder');
  });

  it('a self-parent is reported as parent_cycle and keeps the DECLARED value', () => {
    const raw = renderWithMetadata({ parent: META_FOLDER });
    const task = parseIncluded(raw);
    expect(task.validationIssues.map((i) => i.code)).toContain('parent_cycle');
    // Kept, not cleared: the derived graph decides effectiveness, and a
    // consumer that only sees `undefined` cannot explain what went wrong.
    expect(task.parent).toBe(META_FOLDER);
  });

  it('a parent naming a folder that does not exist is dangling_parent, and is kept', () => {
    const raw = renderWithMetadata({ parent: 'TASK_2026_999' });
    const parsed = parseTaskFile(META_FOLDER, raw, {
      knownFolders: [META_FOLDER, 'TASK_2026_100'],
    });
    if (parsed.kind !== 'task') throw new Error('excluded');
    expect(parsed.task.validationIssues.map((i) => i.code)).toContain(
      'dangling_parent',
    );
    expect(parsed.task.parent).toBe('TASK_2026_999');
  });

  it('a single-file reparse (no knownFolders) SKIPS the dangling check', () => {
    // The deliberate contract at ParseTaskFileOptions: a caller with no
    // directory view gets no dangling warnings rather than false ones.
    const raw = renderWithMetadata({ parent: 'TASK_2026_999' });
    expect(parseIncluded(raw).validationIssues).toEqual([]);
  });

  /**
   * Every shape that must NOT survive as a parent.
   *
   * Each entry is the YAML scalar exactly as it would sit in a hand-authored
   * carrier. They are all `invalid_parent` and they are all CLEARED — the one
   * parent failure mode that does clear the field, because these values reach a
   * path join in later consumers and a warning alone would not stop them.
   */
  const REJECTED_PARENTS: ReadonlyArray<[label: string, yaml: string]> = [
    ['a traversal token', '".."'],
    ['a PADDED traversal token', '" .. "'],
    ['a current-directory token', '"."'],
    ['a relative path', '"../TASK_2026_100"'],
    ['a backslash-separated path', '"..\\\\TASK_2026_100"'],
    ['an absolute POSIX path', '"/etc/passwd"'],
    ['an absolute Windows path', '"C:\\\\Windows\\\\System32"'],
    ['a bare Windows drive letter', '"C:"'],
    ['a drive-RELATIVE Windows path', '"C:TASK_2026_100"'],
    ['an NTFS alternate-data-stream name', '"TASK_2026_100:stream"'],
    ['an embedded NUL', '"TASK_2026_100\\u0000"'],
    ['whitespace only', '"   "'],
  ];

  it.each(REJECTED_PARENTS)(
    'rejects %s as invalid_parent and clears the field',
    (_label, yaml) => {
      const raw = withExtraFrontmatterLines(
        renderWithMetadata(),
        `parent: ${yaml}`,
      );
      const task = parseIncluded(raw);
      expect(task.validationIssues.map((i) => i.code)).toContain(
        'invalid_parent',
      );
      expect(task.parent).toBeUndefined();
      // Rejected, never excluded: the task still reaches the board (NFR-11).
      expect(task.frontmatterValid).toBe(false);
    },
  );

  it('a padded but otherwise VALID parent is kept verbatim, not trimmed', () => {
    // The guard compares the trimmed value; the stored value stays raw. A
    // silent trim here would rewrite what the author typed, and `.ptah/**` is
    // gitignored — there is no undo. It matches no folder, so the scanner
    // reports it as dangling, which is the honest outcome.
    const raw = withExtraFrontmatterLines(
      renderWithMetadata(),
      'parent: " TASK_2026_100 "',
    );
    const task = parseIncluded(raw);
    expect(task.validationIssues.map((i) => i.code)).not.toContain(
      'invalid_parent',
    );
    expect(task.parent).toBe(' TASK_2026_100 ');
  });
});

describe('contract guard — malformed metadata warns and defaults, never excludes', () => {
  it('a non-array labels value warns and defaults to []', () => {
    const raw = withExtraFrontmatterLines(
      renderWithMetadata(),
      'labels: licensing',
    );
    const task = parseIncluded(raw);
    expect(task.labels).toEqual([]);
    expect(task.validationIssues.map((i) => i.code)).toContain(
      'invalid_labels',
    );
  });

  it.each([
    ['duplicates', 'duplicates'],
    ['relates_to', 'relatesTo'],
  ] as const)(
    'a non-array %s value warns as invalid_relation and defaults to []',
    (yamlKey, summaryField) => {
      const raw = withExtraFrontmatterLines(
        renderWithMetadata(),
        `${yamlKey}: TASK_2026_001`,
      );
      const task = parseIncluded(raw);
      expect(task[summaryField]).toEqual([]);
      const issue = task.validationIssues.find(
        (i) => i.code === 'invalid_relation',
      );
      expect(issue).toBeDefined();
      expect(issue?.field).toBe(yamlKey);
    },
  );

  it('a self-referencing relation is dangling_relation, not an exclusion', () => {
    const raw = renderWithMetadata({ relatesTo: [META_FOLDER] });
    const task = parseIncluded(raw);
    expect(task.relatesTo).toEqual([META_FOLDER]);
    expect(task.validationIssues.map((i) => i.code)).toContain(
      'dangling_relation',
    );
  });

  it('duplicate entries inside one relation array are PRESERVED, not de-duplicated', () => {
    // FR-B4.8: de-duplication is a DISPLAY concern. Rewriting the array here
    // would be a silent normalization of a file nobody asked us to touch.
    const raw = renderWithMetadata({
      duplicates: ['TASK_2026_001', 'TASK_2026_001'],
    });
    expect(parseIncluded(raw).duplicates).toEqual([
      'TASK_2026_001',
      'TASK_2026_001',
    ]);
  });
});

describe('contract guard — metadata survives every status × type pair', () => {
  const pairs: Array<[TaskStatus, TaskType]> = TASK_STATUSES.flatMap((status) =>
    TASK_TYPES.map((type): [TaskStatus, TaskType] => [status, type]),
  );

  it.each(pairs)('%s × %s carries all five fields through', (status, type) => {
    const raw = renderWithMetadata({
      status,
      type,
      dependsOn: ['TASK_2026_001'],
      parent: 'TASK_2026_100',
      estimate: 'M',
      labels: ['licensing', 'needs:design'],
      duplicates: ['TASK_2026_002'],
      relatesTo: ['TASK_2026_003', '2026_legacy_folder'],
    });

    const task = parseIncluded(raw);
    expect(task.status).toBe(status);
    expect(task.type).toBe(type);
    expect(task.parent).toBe('TASK_2026_100');
    expect(task.estimate).toBe('M');
    expect(task.labels).toEqual(['licensing', 'needs:design']);
    expect(task.duplicates).toEqual(['TASK_2026_002']);
    expect(task.relatesTo).toEqual(['TASK_2026_003', '2026_legacy_folder']);
    expect(task.dependsOn).toEqual(['TASK_2026_001']);
    // A carrier Ptah itself just wrote must be pristine, or every task the
    // board creates arrives wearing a warning badge.
    expect(task.validationIssues).toEqual([]);
    expect(task.frontmatterValid).toBe(true);
  });
});

/**
 * The pre-change carrier, byte for byte.
 *
 * This is the single assertion that proves the five new fields cost nothing to
 * a task that uses none of them. The frontmatter key list is spelled out on
 * purpose — deriving it from the emitter would make the test agree with any
 * change the emitter makes, which is the opposite of a golden.
 */
const GOLDEN_ZERO_METADATA_CARRIER = `---
id: ${META_FOLDER}
status: backlog
type: FEATURE
title: Metadata round trip
depends_on: []
created: "${FIXED_NOW}"
updated: "${FIXED_NOW}"
---

${CARRIER_BANNER}

Metadata round trip

Full context, plan and discussion live in [./${CONTEXT_FILE}](./${CONTEXT_FILE}).
`;

describe('contract guard — a carrier with NO metadata is unchanged', () => {
  it('is byte-identical to the pre-change golden string', () => {
    expect(renderWithMetadata()).toBe(GOLDEN_ZERO_METADATA_CARRIER);
  });

  it('is byte-identical when every new field is passed EMPTY', () => {
    // Empty is not "a value" — it is the absence of one, and it must produce
    // exactly the same bytes as never having mentioned the field.
    expect(
      renderWithMetadata({
        labels: [],
        duplicates: [],
        relatesTo: [],
        parent: '',
      }),
    ).toBe(GOLDEN_ZERO_METADATA_CARRIER);
  });
});
