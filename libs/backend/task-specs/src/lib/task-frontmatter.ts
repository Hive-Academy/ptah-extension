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
  TASK_ESTIMATES,
  TASK_STATUSES,
  TASK_TYPES,
  isSingleTaskPathSegment,
  type ExcludedTaskFolder,
  type TaskEstimate,
  type TaskSpecSummary,
  type TaskStatus,
  type TaskType,
  type TaskValidationIssue,
} from '@ptah-extension/shared';
import { toTaskStatus, toTaskType } from './task-enum-narrowing';

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
  /**
   * Metadata fields (TASK_2026_181). All `.nullish()` for the same reason the
   * rest of this schema is: it documents the carrier shape and types the
   * writer's patch input, but it does NOT gate inclusion — `parseTaskFile`
   * lifts each field individually so a bad one degrades to a warning instead
   * of taking the whole task off the board.
   *
   * `estimate` is `z.string()` rather than the enum on purpose. Narrowing it
   * here would make an unrecognised size a SCHEMA failure, and the required
   * behaviour is a warning that NAMES the offending value — which needs the
   * raw string to still be in hand.
   */
  labels: z.array(z.string()).nullish(),
  estimate: z.string().nullish(),
  parent: z.string().nullish(),
  duplicates: z.array(z.string()).nullish(),
  relates_to: z.array(z.string()).nullish(),
  claim: z.union([z.string(), z.record(z.string(), z.unknown())]).nullish(),
  created: z.string().nullish(),
  updated: z.string().nullish(),
  /**
   * Set by the doctor's adoption path: this `status` was DEDUCED from the
   * artifacts in the folder, not declared. Purely informational — it never
   * affects inclusion, and nothing removes it automatically.
   */
  status_inferred: z.boolean().nullish(),
});

export type TaskFrontmatter = z.infer<typeof TaskFrontmatterSchema>;

export type ParseTaskFileResult =
  | { kind: 'task'; task: TaskSpecSummary; body: string }
  | { kind: 'excluded'; excluded: ExcludedTaskFolder };

/** Matches the leading frontmatter block, tolerating CRLF and a final EOF. */
const FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---(\r?\n|$)/;

/**
 * Options handed to EVERY `matter()` call in this file, and the reason is not
 * the option itself — it is that passing any options object at all defeats
 * gray-matter's module-global cache. That cache makes the parser
 * NON-DETERMINISTIC on a malformed file:
 *
 *   `index.js:36` takes the cache branch only `if (!options)`. On a cache MISS
 *   it stores the file object BEFORE parsing, then throws out of the YAML
 *   engine. The half-built entry survives with an empty `data`, so the SECOND
 *   call on identical bytes returns `{}` instead of throwing — and
 *   `parseTaskFile` falls past its `catch` and reports `invalid_status` for a
 *   file whose real defect is `yaml_unparseable`.
 *
 * Observed live, not theorised: `TASK_2026_182`/`188`/`189` were reported
 * `yaml_unparseable` by one `doctor plan()` and `invalid_status` by the next,
 * four seconds later, in one process. The exclusions drawer shows that reason
 * to a user, so a call-order-dependent diagnosis is a wrong answer, and the
 * cache is also unbounded in a long-lived extension host.
 *
 * `language: 'yaml'` is gray-matter's own default, so this changes nothing
 * about how the block is parsed. It is a typed, explicit way to say "no
 * cache" — the runtime honours a literal `{ cache: false }` too, but that key
 * is absent from the shipped `.d.ts`.
 */
const MATTER_OPTIONS = { language: 'yaml' } as const;

/**
 * Strip a single leading UTF-8 BOM (U+FEFF) if present. A BOM at byte 0 is
 * common from Windows tooling (PowerShell `Out-File`, some editors) and would
 * otherwise defeat `FRONTMATTER_RE`'s `^---` anchor, silently excluding an
 * otherwise-valid `task.md` as `no_frontmatter`.
 */
function stripLeadingBom(value: string): string {
  return value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
}

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
 * Shape guard for every `string[]` frontmatter field (`depends_on`, `labels`,
 * `duplicates`, `relates_to`). Applied at the file boundary only.
 */
const STRING_ARRAY_SCHEMA = z.array(z.string());

/** The recognised estimate values, as a set for O(1) membership. */
const ESTIMATE_VALUES = new Set<string>(TASK_ESTIMATES);

/**
 * A folder name is one path segment and nothing else.
 *
 * The implementation lives in `libs/shared` ({@link isSingleTaskPathSegment})
 * because four boundaries need this exact decision — this parser's `parent`,
 * the `tasks:` RPC schema, the MCP namespace, and `tasks:adopt` — and each one
 * guards a value that is eventually joined onto the spec root. Four
 * hand-written copies is how three of them came to accept `" .. "` while this
 * one rejected it. The aliasing import keeps the local name and the call sites
 * below unchanged.
 */
const isSinglePathSegment = isSingleTaskPathSegment;

/**
 * Lift one relation array (`duplicates` / `relates_to`) into the summary.
 *
 * Both fields behave identically, differ only in their YAML key, and both
 * degrade the same way — shape failure gives `[]` plus `invalid_relation`,
 * while a well-formed entry that points at nothing gives `dangling_relation`
 * and is KEPT. The entry is kept because the alternative is deciding, on the
 * reader's behalf, that a typo means the author did not intend the relation.
 *
 * Duplicate entries inside one array are NOT removed (FR-B4.8). De-duplication
 * is a display concern; doing it here would mean the value handed to a writer
 * no longer matches the file, which is how a read path turns into a silent
 * normalization pass.
 */
function liftRelationArray(
  raw: unknown,
  yamlKey: 'duplicates' | 'relates_to',
  folderName: string,
  knownFolders: ReadonlySet<string> | undefined,
  issues: TaskValidationIssue[],
): string[] {
  if (raw === undefined || raw === null) return [];

  const result = STRING_ARRAY_SCHEMA.safeParse(raw);
  if (!result.success) {
    issues.push({
      field: yamlKey,
      code: 'invalid_relation',
      message: `${yamlKey} must be an array of task-id strings.`,
    });
    return [];
  }

  for (const entry of result.data) {
    if (entry === folderName) {
      issues.push({
        field: yamlKey,
        code: 'dangling_relation',
        message: `${yamlKey} entry '${entry}' refers to this task itself.`,
        ref: entry,
      });
      continue;
    }
    // Only checkable when the caller told us which folders exist — see
    // `ParseTaskFileOptions.knownFolders`.
    if (knownFolders !== undefined && !knownFolders.has(entry)) {
      issues.push({
        field: yamlKey,
        code: 'dangling_relation',
        message: `${yamlKey} entry '${entry}' does not match any folder under .ptah/specs.`,
        ref: entry,
      });
    }
  }

  return result.data;
}

/**
 * Options for {@link parseTaskFile}.
 */
export interface ParseTaskFileOptions {
  /**
   * Folder names that exist under `.ptah/specs`. When supplied, every
   * `depends_on` entry outside this set raises a `dangling_depends_on` warning.
   *
   * OPTIONAL by design. `parseTaskFile` is a pure function over one file's
   * bytes and most callers legitimately have no view of the wider directory —
   * the scanner does, a single-file reparse does not. Omitting the set simply
   * skips the check rather than reporting every dependency as dangling, which
   * would be a false alarm caused by the caller's ignorance rather than by
   * anything wrong with the file.
   */
  knownFolders?: Iterable<string>;
}

/**
 * Parse a raw `task.md` string. NEVER throws (R1.2).
 *
 * @param folderName the owning folder name — becomes the canonical `id`.
 * @param raw the full file contents.
 * @param options see {@link ParseTaskFileOptions}.
 */
export function parseTaskFile(
  folderName: string,
  raw: string,
  options?: ParseTaskFileOptions,
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
    const parsed = matter(normalized, MATTER_OPTIONS);
    data = parsed.data as Record<string, unknown>;
    body = parsed.content;
  } catch {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'yaml_unparseable' },
    };
  }

  // ESSENTIAL: status. Narrowed case-insensitively (see
  // `task-enum-narrowing.ts`) — a declared `Backlog` is a backlog task, not a
  // folder that vanishes from the board.
  const status: TaskStatus | undefined = toTaskStatus(data['status']);
  if (status === undefined) {
    return {
      kind: 'excluded',
      excluded: { folderName, reason: 'invalid_status' },
    };
  }

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

  /**
   * The folder names that exist, when the caller knows them.
   *
   * `undefined` means the caller has no directory view — a single-file reparse
   * legitimately does not have one. Every check that needs the set is SKIPPED
   * in that case rather than guessed at, because reporting every reference as
   * dangling would be a false alarm about the CALLER's ignorance rather than
   * about anything wrong with the file. See {@link ParseTaskFileOptions}.
   */
  const knownFolders =
    options?.knownFolders === undefined
      ? undefined
      : new Set(options.knownFolders);

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
  // Narrowed case-insensitively (see `task-enum-narrowing.ts`) — the same
  // narrowing the doctor uses, so the two cannot disagree about one file again.
  let type: TaskType | null = null;
  const rawType = data['type'];
  if (rawType !== undefined && rawType !== null) {
    const narrowedType = toTaskType(rawType);
    if (narrowedType !== undefined) {
      type = narrowedType;
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
    const dependsResult = STRING_ARRAY_SCHEMA.safeParse(rawDepends);
    if (dependsResult.success) {
      dependsOn = dependsResult.data;

      // Well-formed but possibly pointing at nothing. Only checkable when the
      // caller told us which folders exist.
      if (knownFolders !== undefined) {
        for (const dependency of dependsOn) {
          if (knownFolders.has(dependency)) continue;
          issues.push({
            field: 'depends_on',
            code: 'dangling_depends_on',
            message: `depends_on entry '${dependency}' does not match any folder under .ptah/specs.`,
            ref: dependency,
          });
        }
      }
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

  // ── Metadata fields (TASK_2026_181) ───────────────────────────────────────
  //
  // One block per field, all following the `depends_on` shape above:
  // PRESENT-BUT-MALFORMED means a warning plus a safe default, never an
  // exclusion. A task with a typo in its estimate is still a task, and hiding
  // it from the board would turn a cosmetic mistake into a lost work item.

  // labels: [] when absent or the wrong shape; warn only on a bad value.
  let labels: string[] = [];
  const rawLabels = data['labels'];
  if (rawLabels !== undefined && rawLabels !== null) {
    const labelsResult = STRING_ARRAY_SCHEMA.safeParse(rawLabels);
    if (labelsResult.success) {
      labels = labelsResult.data;
    } else {
      issues.push({
        field: 'labels',
        code: 'invalid_labels',
        message: 'labels must be an array of strings.',
      });
    }
  }

  // estimate: undefined unless it is one of the recognised sizes. The raw
  // value is NAMED in the message — "invalid estimate" alone tells the author
  // nothing about which of their five carriers they typed `Medium` into.
  let estimate: TaskEstimate | undefined;
  const rawEstimate = data['estimate'];
  if (rawEstimate !== undefined && rawEstimate !== null) {
    if (typeof rawEstimate === 'string' && ESTIMATE_VALUES.has(rawEstimate)) {
      estimate = rawEstimate as TaskEstimate;
    } else {
      issues.push({
        field: 'estimate',
        code: 'invalid_estimate',
        message: `Unknown estimate '${String(rawEstimate)}'; expected one of ${TASK_ESTIMATES.join(', ')}.`,
      });
    }
  }

  // parent: single-valued, one path segment, never this folder.
  //
  // Only `invalid_parent` CLEARS the field, and only because that value is
  // structurally unsafe — it is a folder name that later gets joined onto the
  // spec root, so a `..` must not survive the boundary that noticed it.
  //
  // A self-parent or a parent naming a missing folder is KEPT verbatim. The
  // declared value is the only evidence of what the author meant, and the
  // derived graph is the component that decides effectiveness; discarding the
  // value here would leave every downstream consumer able to say "something
  // was wrong" and unable to say what.
  let parent: string | undefined;
  const rawParent = data['parent'];
  if (rawParent !== undefined && rawParent !== null) {
    if (typeof rawParent !== 'string' || !isSinglePathSegment(rawParent)) {
      issues.push({
        field: 'parent',
        code: 'invalid_parent',
        message: `parent '${String(rawParent)}' must be a single task folder name.`,
      });
    } else {
      parent = rawParent;
      if (rawParent === folderName) {
        // The one cycle a single file can prove on its own. Longer cycles need
        // the whole scanned set and belong to the scanner's cross-file pass.
        issues.push({
          field: 'parent',
          code: 'parent_cycle',
          message: `parent '${rawParent}' is this task itself.`,
          ref: rawParent,
        });
      } else if (knownFolders !== undefined && !knownFolders.has(rawParent)) {
        issues.push({
          field: 'parent',
          code: 'dangling_parent',
          message: `parent '${rawParent}' does not match any folder under .ptah/specs.`,
          ref: rawParent,
        });
      }
    }
  }

  const duplicates = liftRelationArray(
    data['duplicates'],
    'duplicates',
    folderName,
    knownFolders,
    issues,
  );
  const relatesTo = liftRelationArray(
    data['relates_to'],
    'relates_to',
    folderName,
    knownFolders,
    issues,
  );

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
    labels,
    estimate,
    parent,
    duplicates,
    relatesTo,
    created: created.iso,
    updated: updated.iso,
    frontmatterValid: issues.length === 0,
    validationIssues: issues,
  };

  return { kind: 'task', task, body };
}

/** Options for {@link updateFrontmatter}. */
export interface UpdateFrontmatterOptions {
  /**
   * Keys DELETED from the merged frontmatter, applied after the patch merge.
   *
   * Removal cannot be expressed as `patch.labels = undefined`: the merged
   * object is handed to js-yaml, which has no `undefined` to dump and throws.
   * An explicit remove list is the only way to say "this key should stop
   * existing" — which is what an emptied label set means (FR-B5.5).
   */
  readonly remove?: readonly string[];
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
  options?: UpdateFrontmatterOptions,
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
    // Same global-cache hazard as `parseTaskFile` — see `MATTER_OPTIONS`. A
    // cached empty `data` here would silently drop every existing frontmatter
    // field that the patch does not itself set.
    existing = matter(source, MATTER_OPTIONS).data as Record<string, unknown>;
  } catch {
    existing = {};
  }

  const merged: Record<string, unknown> = { ...existing, ...patch };
  // Applied AFTER the merge so a caller that both patches and removes a key
  // gets the removal — there is no shape in which "set it and also delete it"
  // is a coherent request, and deleting last makes the outcome stated rather
  // than dependent on object key order.
  for (const key of options?.remove ?? []) delete merged[key];
  if (!('updated' in patch) || patch.updated === undefined) {
    merged['updated'] = new Date().toISOString();
  }

  // `matter.stringify('', data)` yields "---\n<yaml>---\n" PLUS one trailing
  // newline — its own separator between the block and the content it was given.
  // `FRONTMATTER_RE` consumed only up to and including the single newline that
  // CLOSES the block, so the sliced body still carries its own leading newline.
  // Concatenating both inserts a blank line at the boundary on every write, and
  // because the next write slices the same way the blank lines ACCUMULATE —
  // one per status change, forever, in a file that is gitignored and has no
  // undo. Dropping the emitter's trailing padding makes the rebuild
  // block-for-block, which is what "the body is copied through untouched"
  // always claimed.
  const renderedBlock = matter.stringify('', merged).replace(/\n$/, '');
  const rebuilt = renderedBlock + body;
  return hadBom ? '\uFEFF' + rebuilt : rebuilt;
}
