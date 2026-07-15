/**
 * Frontmatter parser + byte-preserving writer for `.ptah/specs/<id>/task.md`.
 *
 * `parseTaskFile` NEVER throws past its boundary (R1.2): every failure mode
 * maps to a typed `{ kind: 'excluded' }` result. Zod is applied ONLY here, at
 * the file boundary, and only for the two ESSENTIAL fields (status, title) —
 * everything else degrades to a `validationIssue` warning while the task stays
 * included (folder name wins over `id`, C1).
 *
 * `updateFrontmatter` splices ONLY the frontmatter block and leaves the body
 * byte-for-byte (CRLF, trailing bytes, `---` inside code fences all survive).
 */
import matter from 'gray-matter';
import { z } from 'zod';
import {
  TASK_STATUSES,
  TASK_TYPES,
  type ExcludedTaskFolder,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TaskValidationIssue,
} from '@ptah-extension/shared';

/**
 * Canonical `task.md` frontmatter shape (documentation + writer input type).
 * NOTE: `parseTaskFile` deliberately does NOT gate inclusion on this whole
 * schema — only `status`/`title` are essential; the rest degrade to warnings.
 */
export const TaskFrontmatterSchema = z.object({
  id: z.string().min(1).optional(),
  status: z.enum(TASK_STATUSES),
  type: z.enum(TASK_TYPES).nullish(),
  title: z.string().min(1),
  description: z.string().nullish(),
  assignee: z.string().nullish(),
  depends_on: z.array(z.string()).nullish(),
  executor: z.string().nullish(),
  claim: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
  created: z.string().nullish(),
  updated: z.string().nullish(),
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

export type ParseTaskFileResult =
  | { kind: 'task'; task: TaskSpecSummary; body: string }
  | { kind: 'excluded'; excluded: ExcludedTaskFolder };

/** Matches the leading frontmatter block, tolerating CRLF and a final EOF. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

/**
 * Strip a single leading UTF-8 BOM (U+FEFF) if present. A BOM at byte 0 is
 * common from Windows tooling (PowerShell `Out-File`, some editors) and would
 * otherwise defeat `FRONTMATTER_RE`'s `^---` anchor, silently excluding an
 * otherwise-valid `task.md` as `no_frontmatter`.
 */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

const STATUS_SCHEMA = z.enum(TASK_STATUSES);
const TITLE_SCHEMA = z.string().min(1);

/** Coerce a frontmatter date value into an ISO string, or null if unusable. */
function coerceIso(value: unknown): { iso: string | null; present: boolean } {
  if (value === undefined || value === null) {
    return { iso: null, present: false };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime())
      ? { iso: null, present: true }
      : { iso: value.toISOString(), present: true };
  }
  if (typeof value === 'string') {
    return Number.isNaN(Date.parse(value))
      ? { iso: null, present: true }
      : { iso: value, present: true };
  }
  return { iso: null, present: true };
}

/**
 * Parse a raw `task.md` string. NEVER throws (R1.2).
 *
 * @param folderName the owning folder name — becomes the canonical `id`.
 * @param raw the full file contents.
 */
export function parseTaskFile(
  folderName: string,
  raw: string,
): ParseTaskFileResult {
  // Tolerate a leading BOM so a BOM-prefixed carrier parses normally instead
  // of being excluded as `no_frontmatter`.
  const normalized = stripLeadingBom(raw);
  if (!FRONTMATTER_RE.test(normalized)) {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'no_frontmatter' },
    };
  }

  let data: Record<string, unknown>;
  let body: string;
  try {
    const parsed = matter(normalized);
    data = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'yaml_unparseable' },
    };
  }

  // ESSENTIAL: status.
  const statusResult = STATUS_SCHEMA.safeParse(data['status']);
  if (!statusResult.success) {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'invalid_status' },
    };
  }
  const status: TaskStatus = statusResult.data;

  // ESSENTIAL: title.
  const titleResult = TITLE_SCHEMA.safeParse(data['title']);
  if (!titleResult.success) {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'missing_title' },
    };
  }
  const title = titleResult.data;

  // Everything below is non-essential — collect warnings, stay included.
  const issues: TaskValidationIssue[] = [];

  // id: folder name always wins (C1); warn on mismatch.
  const rawId = data['id'];
  if (typeof rawId === 'string' && rawId.length > 0 && rawId !== folderName) {
    issues.push({
      field: 'id',
      code: 'id_mismatch',
      message: `Frontmatter id '${rawId}' does not match folder '${folderName}'; folder name wins.`,
    });
  }

  // type: null when absent or invalid; warn only when a bad value is present.
  let type: TaskType | null = null;
  const rawType = data['type'];
  if (rawType !== undefined && rawType !== null) {
    const typeResult = z.enum(TASK_TYPES).safeParse(rawType);
    if (typeResult.success) {
      type = typeResult.data;
    } else {
      issues.push({
        field: 'type',
        code: 'invalid_type',
        message: `Unknown task type '${String(rawType)}'.`,
      });
    }
  }

  // depends_on: [] when absent or malformed; warn on malformed value.
  let dependsOn: string[] = [];
  const rawDepends = data['depends_on'];
  if (rawDepends !== undefined && rawDepends !== null) {
    const dependsResult = z.array(z.string()).safeParse(rawDepends);
    if (dependsResult.success) {
      dependsOn = dependsResult.data;
    } else {
      issues.push({
        field: 'depends_on',
        code: 'invalid_depends_on',
        message: 'depends_on must be an array of task-id strings.',
      });
    }
  }

  // created / updated: ISO or null; warn when present but unparseable.
  const created = coerceIso(data['created']);
  if (created.present && created.iso === null) {
    issues.push({
      field: 'created',
      code: 'invalid_date',
      message: 'created is not a parseable ISO 8601 date.',
    });
  }
  const updated = coerceIso(data['updated']);
  if (updated.present && updated.iso === null) {
    issues.push({
      field: 'updated',
      code: 'invalid_date',
      message: 'updated is not a parseable ISO 8601 date.',
    });
  }

  const description =
    typeof data['description'] === 'string'
      ? (data['description'] as string)
      : undefined;
  const assignee =
    typeof data['assignee'] === 'string'
      ? (data['assignee'] as string)
      : undefined;
  const executor =
    typeof data['executor'] === 'string'
      ? (data['executor'] as string)
      : undefined;

  const task: TaskSpecSummary = {
    id: folderName,
    folderName,
    status,
    type,
    title,
    description,
    assignee,
    dependsOn,
    executor,
    created: created.iso,
    updated: updated.iso,
    frontmatterValid: issues.length === 0,
    validationIssues: issues,
  };

  return { kind: 'task', task, body };
}

/**
 * Byte-preserving frontmatter mutation (R1.5).
 *
 * Re-serializes ONLY the leading frontmatter block; the body after the closing
 * `---` is copied through untouched. `updated` is refreshed to now unless the
 * caller supplies it explicitly in `patch`.
 *
 * If `raw` has no frontmatter block it is returned unchanged (the writer only
 * calls this on files it already parsed as valid tasks).
 */
export function updateFrontmatter(
  raw: string,
  patch: Partial<TaskFrontmatter>,
): string {
  // A leading BOM is stripped for parsing and re-applied on rewrite, so the
  // original file's encoding marker is preserved (safer than silently dropping
  // it). The body after the closing `---` still survives byte-for-byte.
  const hadBom = raw.charCodeAt(0) === 0xfeff;
  const source = stripLeadingBom(raw);

  const match = FRONTMATTER_RE.exec(source);
  if (!match) return raw;

  const block = match[0];
  const body = source.slice(block.length);

  let existing: Record<string, unknown> = {};
  try {
    existing = matter(source).data as Record<string, unknown>;
  } catch {
    existing = {};
  }

  const merged: Record<string, unknown> = { ...existing, ...patch };
  if (!('updated' in patch) || patch.updated === undefined) {
    merged['updated'] = new Date().toISOString();
  }

  // gray-matter.stringify('', data) yields exactly "---\n<yaml>---\n" (empty
  // content) — the frontmatter block only. Concatenate the untouched body.
  const renderedBlock = matter.stringify('', merged);
  const rebuilt = renderedBlock + body;
  return hadBom ? '\uFEFF' + rebuilt : rebuilt;
}
