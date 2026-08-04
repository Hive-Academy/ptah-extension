/**
 * The `.ptah/specs/` task-spec contract (TASK_2026_179, step 1).
 *
 * ONE definition of the carrier filename, the spec root, the closed set of
 * recognised per-task documents, and the two renderers that produce the
 * machine-owned files (`task.md` and `.ptah/specs/README.md`).
 *
 * ## Ownership split — the whole point of this module
 *
 *  - `task.md` is the MACHINE-OWNED metadata carrier. Frontmatter plus a short
 *    pointer body. Ptah rewrites it. A folder without it is invisible to the
 *    Tasks board.
 *  - `context.md` and its siblings are AGENT-OWNED prose. No machine rewrites
 *    them.
 *
 * ## Zero dependencies — load-bearing
 *
 * This module lives in `libs/shared` because `libs/frontend/tasks-ui` must
 * consume it and a frontend lib may never reach a backend lib. It therefore has
 * NO `node:*` imports, no backend imports, no Angular imports, and no external
 * runtime dependency — not even `gray-matter`, which pulls in `node:fs` and
 * would break the webview build. The tiny YAML emitter below exists for exactly
 * that reason; its output is a strict subset of what `gray-matter` produces and
 * round-trips through `parseTaskFile`.
 */
import type { TaskStatus, TaskType } from './task-spec.types';

/** Workspace-relative root of the task-spec tree. */
export const SPEC_ROOT = '.ptah/specs';

/** `SPEC_ROOT` pre-split for `path.join(root, ...SPEC_ROOT_SEGMENTS)`. */
export const SPEC_ROOT_SEGMENTS = ['.ptah', 'specs'] as const;

/**
 * The metadata carrier filename. NEVER rename this — a missed rename is a
 * silent, null-swallowed harvest failure rather than a loud one.
 */
export const CARRIER_FILE = 'task.md';

/** Data-plane doc written into `SPEC_ROOT` by `renderSpecsReadme`. */
export const SPECS_README_FILE = 'README.md';

/** Bumped only when the on-disk carrier shape changes. */
export const SPEC_CONTRACT_VERSION = 1;

/**
 * The CLOSED set of per-task documents Ptah recognises inside a task folder.
 *
 * Closed on purpose: the CI ratchet fails any agent template or skill asset
 * that names a per-task `*.md` outside this list, so divergent doc-file lists
 * cannot re-appear. Widening it is a deliberate act, not an accident.
 *
 * ## Widened once, deliberately (TASK_2026_179, task 4.2 / risk R2)
 *
 * The ratchet's first run failed against the Phase-0 agent templates. Four of
 * the names it found are REAL deliverables the shipped agents already write
 * into a task folder, so the honest move was to widen the set rather than to
 * delete working workflow outputs:
 *
 *  - `design-handoff.md`, `design-assets-inventory.md` —
 *    `ui-ux-designer.template.md:148,152` writes them; `software-architect` and
 *    `frontend-developer` read them back.
 *  - `content-specification.md` — `technical-content-writer.template.md:555`.
 *  - `testing-infrastructure-escalation.md` — `senior-tester.template.md:528`.
 *
 * A fifth offender, `code-review.md`, was NOT admitted: the reviewer templates
 * themselves already write `code-style-review.md` / `code-logic-review.md`, so
 * the stale name was fixed in the assets instead.
 */
export const DOC_FILES = [
  'context.md',
  'task-description.md',
  'implementation-plan.md',
  'batches.md',
  'test-report.md',
  'testing-infrastructure-escalation.md',
  'code-style-review.md',
  'code-logic-review.md',
  'visual-review.md',
  'visual-design-specification.md',
  'design-handoff.md',
  'design-assets-inventory.md',
  'content-specification.md',
  'research-report.md',
  'future-enhancements.md',
  /** legacy — see `LEGACY_DOC_FILES`. */
  'tasks.md',
] as const;

/** Literal union of every recognised per-task document. */
export type DocFile = (typeof DOC_FILES)[number];

/**
 * Documents kept only under their pre-rename name.
 *
 * `tasks.md` was the team-leader batch breakdown before it became
 * `batches.md`. The fallback is PERMANENT and must NEVER be
 * deprecation-warned: existing task folders on disk are gitignored, so there is
 * no migration that can be trusted to have run.
 */
export const LEGACY_DOC_FILES = ['tasks.md'] as const;

/** Literal union of the legacy document names. */
export type LegacyDocFile = (typeof LEGACY_DOC_FILES)[number];

/** Current name of the team-leader batch breakdown. */
export const BATCHES_FILE = 'batches.md';

/** Permanent fallback name for {@link BATCHES_FILE}. */
export const LEGACY_BATCHES_FILE = 'tasks.md';

/** The agent-owned prose document. Machines never write it. */
export const CONTEXT_FILE = 'context.md';

/**
 * Documents whose presence proves the task reached verification: a test report,
 * or any review. A folder carrying one of these is FINISHED work that merely
 * lost its carrier — adopting it as `backlog` would misreport completed work as
 * not-started, which is worse than leaving it invisible.
 */
export const COMPLETION_ARTIFACTS: readonly DocFile[] = DOC_FILES.filter(
  (name) => name === 'test-report.md' || name.endsWith('-review.md'),
);

/**
 * Documents that prove work was PLANNED and probably started, but say nothing
 * about it finishing.
 */
export const PLANNING_ARTIFACTS: readonly DocFile[] = DOC_FILES.filter(
  (name) =>
    name === 'implementation-plan.md' ||
    name === 'batches.md' ||
    name === 'tasks.md',
);

/** Narrow an arbitrary filename to a recognised per-task document. */
export function isDocFile(name: string): name is DocFile {
  return (DOC_FILES as readonly string[]).includes(name);
}

/** Narrow an arbitrary filename to a legacy per-task document name. */
export function isLegacyDocFile(name: string): name is LegacyDocFile {
  return (LEGACY_DOC_FILES as readonly string[]).includes(name);
}

/**
 * Banner that opens every generated carrier body. Its job is to stop a human
 * (or an agent with a diverged `.claude/` clone) from treating `task.md` as a
 * place to write prose.
 */
export const CARRIER_BANNER =
  '<!-- Ptah carrier: machine-owned metadata. Ptah rewrites the frontmatter above. ' +
  'Do NOT write prose here — prose belongs in ./context.md. -->';

/** Input to {@link renderTaskMd}. */
export interface RenderTaskMdInput {
  /** Canonical id — ALWAYS the folder name. */
  id: string;
  title: string;
  type: TaskType;
  /** Defaults to `backlog`. */
  status?: TaskStatus;
  description?: string;
  dependsOn?: readonly string[];
  executor?: string;
  /**
   * Emits `status_inferred: true` when set.
   *
   * ONLY the doctor's adoption path sets this. It marks a carrier whose
   * `status` was deduced from the artifacts lying in the folder rather than
   * declared by a human or a tool, so a reader can tell a guess from a fact.
   * It is never removed automatically — a human editing the status is expected
   * to drop the line themselves.
   */
  statusInferred?: boolean;
  /** ISO 8601 stamp for `created`/`updated`. Defaults to now. Injectable so
   *  round-trip tests stay deterministic. */
  now?: string;
}

// ---------------------------------------------------------------------------
// Minimal YAML emitter — covers exactly the carrier's frontmatter field set.
// ---------------------------------------------------------------------------

/** Plain scalars that YAML would otherwise read as a boolean or null. */
const YAML_RESERVED_WORDS = new Set([
  'y',
  'n',
  'yes',
  'no',
  'true',
  'false',
  'on',
  'off',
  'null',
]);

/**
 * Conservative test for a scalar that is safe unquoted. Deliberately narrow:
 * anything with `:`, `#`, `-` at the start, a leading digit, a trailing space,
 * or a newline gets quoted instead. ISO timestamps contain `:` and are
 * therefore always quoted, which keeps them strings rather than YAML dates.
 */
function isPlainSafeScalar(value: string): boolean {
  if (!/^[A-Za-z][A-Za-z0-9 _./()-]*$/.test(value)) return false;
  if (value.endsWith(' ')) return false;
  return !YAML_RESERVED_WORDS.has(value.toLowerCase());
}

/**
 * Emit a YAML scalar. Falls back to a double-quoted scalar produced by
 * `JSON.stringify` — JSON string syntax is a valid YAML double-quoted scalar,
 * so this is correct for embedded quotes, colons, `#` and newlines alike.
 */
function yamlScalar(value: string): string {
  return isPlainSafeScalar(value) ? value : JSON.stringify(value);
}

type FrontmatterField = readonly [string, string | boolean | readonly string[]];

/** Render `---\n<yaml>---\n` — the frontmatter block and nothing else. */
function renderFrontmatterBlock(fields: readonly FrontmatterField[]): string {
  const lines: string[] = ['---'];
  for (const [key, value] of fields) {
    if (typeof value === 'boolean') {
      lines.push(`${key}: ${value ? 'true' : 'false'}`);
    } else if (typeof value === 'string') {
      lines.push(`${key}: ${yamlScalar(value)}`);
    } else if (value.length === 0) {
      lines.push(`${key}: []`);
    } else {
      lines.push(`${key}:`);
      for (const item of value) lines.push(`  - ${yamlScalar(item)}`);
    }
  }
  lines.push('---', '');
  return lines.join('\n');
}

/** Collapse a possibly multi-line string into a single summary line. */
function toOneLine(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

/**
 * Render a complete `task.md` carrier.
 *
 * The frontmatter field set and its ordering match what the writer emitted
 * before this module existed: `id, status, type, title, depends_on, created,
 * updated` plus optional `description` and `executor`.
 *
 * The BODY is a pointer, never prose: banner, a one-line summary, and an
 * explicit link to `./context.md`.
 */
export function renderTaskMd(input: RenderTaskMdInput): string {
  const now = input.now ?? new Date().toISOString();
  const fields: FrontmatterField[] = [
    ['id', input.id],
    ['status', input.status ?? 'backlog'],
    ['type', input.type],
    ['title', input.title],
    ['depends_on', input.dependsOn ?? []],
    ['created', now],
    ['updated', now],
  ];
  if (input.description !== undefined) {
    fields.push(['description', input.description]);
  }
  if (input.executor !== undefined) {
    fields.push(['executor', input.executor]);
  }
  if (input.statusInferred === true) {
    fields.push(['status_inferred', true]);
  }

  const block = renderFrontmatterBlock(fields);
  const summarySource =
    input.description !== undefined && input.description.trim().length > 0
      ? input.description
      : input.title;
  const firstLine =
    summarySource.split(/\r?\n/).find((line) => line.trim().length > 0) ??
    input.title;
  const summary = toOneLine(firstLine);

  return [
    block,
    CARRIER_BANNER,
    '',
    summary,
    '',
    `Full context, plan and discussion live in [./${CONTEXT_FILE}](./${CONTEXT_FILE}).`,
    '',
  ].join('\n');
}

/**
 * Render `.ptah/specs/README.md`.
 *
 * This is the data-plane doc — the ONLY channel that reaches a user whose
 * `.claude/` clone has diverged from the shipped orchestration skill. It must
 * stand alone and state the carrier contract without assuming any tooling.
 *
 * DETERMINISTIC: no wall-clock, no environment reads. The index service
 * compares the rendered hash against the on-disk hash and skips the write when
 * they match, so any non-determinism here would rewrite the file on every
 * activation.
 */
export function renderSpecsReadme(): string {
  const docList = DOC_FILES.filter((name) => !isLegacyDocFile(name))
    .map((name) => `- \`${name}\``)
    .join('\n');

  return `# \`${SPEC_ROOT}\` — task contract

<!-- Generated by Ptah (spec contract v${SPEC_CONTRACT_VERSION}). Edits are overwritten. -->

One sub-folder per task, named \`TASK_YYYY_NNN\`. **The folder name is the
canonical task id.** A frontmatter \`id:\` that disagrees with the folder name is
a warning only — the folder name wins, and nothing is auto-renamed.

## \`${CARRIER_FILE}\` is the carrier, and it is machine-owned

Every task folder MUST contain \`${CARRIER_FILE}\`. **A folder without it is
invisible to the Tasks board** — it is not "empty", it is skipped.

    ---
    id: TASK_2026_001
    status: backlog
    type: FEATURE
    title: Short imperative title
    depends_on: []
    created: "2026-01-01T00:00:00.000Z"
    updated: "2026-01-01T00:00:00.000Z"
    ---

\`status\` is exactly one of \`backlog\`, \`in_progress\`, \`in_review\`,
\`blocked\`, \`done\`, \`cancelled\`. \`type\` is one of \`FEATURE\`, \`BUGFIX\`,
\`REFACTORING\`, \`DOCUMENTATION\`, \`RESEARCH\`, \`DEVOPS\`, \`SAAS_INIT\`,
\`CREATIVE\`.

To change a status, edit the \`status:\` line and nothing else. Never rewrite the
whole file — Ptah writes this file too, and a whole-file write from a stale
snapshot silently discards the other writer's change.

## Prose is agent-owned, and it goes in \`${CONTEXT_FILE}\`

Never put narrative in \`${CARRIER_FILE}\`. Its body is a banner, a one-line
summary, and a pointer — that is the entire body contract.

- \`${CONTEXT_FILE}\` — user intent, background, the settled plan.
- \`${BATCHES_FILE}\` — the team-leader batch breakdown. This is a DIFFERENT file
  from \`${CARRIER_FILE}\`; do not confuse the two. Its former name
  \`${LEGACY_BATCHES_FILE}\` is still read, permanently.

## Recognised documents

Only these filenames are read from a task folder:

${docList}

plus \`${LEGACY_BATCHES_FILE}\` (legacy name for \`${BATCHES_FILE}\`).

## Allocating an id

Scan the \`TASK_*\` folders on disk, take the highest \`NNN\` for the current
year, add one, zero-pad to three digits. Never derive the next id from
\`registry.md\` — that file is generated and can be stale.
`;
}
