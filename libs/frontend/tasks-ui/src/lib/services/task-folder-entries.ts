/**
 * Pure mapping from a task folder's typed listing to the rows the reader shows.
 *
 * Two inputs reach this file: the root listing carried on `TaskSpecDetail`
 * (`entries`, or the older `artifacts` name list) and a nested listing returned
 * by `tasks:listFolderEntries`. Both are host data, so every entry is validated
 * here before it becomes a row. No document name is written out in this file:
 * the workflow set comes from `WORKFLOW_ARTIFACTS`, which is derived from the
 * shared `DOC_FILES` contract.
 */
import {
  CARRIER_FILE,
  isDocFile,
  isLegacyDocFile,
  isReadableTaskFolderMarkdownName,
  type TaskSpecDetail,
} from '@ptah-extension/shared';
import { WORKFLOW_ARTIFACTS } from '../task-presentation';

/** Entry kinds the host reports; a symlink is shown but never followed. */
export type TaskFolderEntryKind = 'file' | 'directory' | 'symlink' | 'other';

/**
 * What a row is to the task workflow.
 *
 * - `carrier`: `task.md`. Its metadata and body are rendered by the detail
 *   panel, so the reader does not offer it.
 * - `workflow`: one of the canonical workflow documents.
 * - `legacy`: the permanent `tasks.md` alias of the batch breakdown.
 * - `extra`: anything else in the folder (`decisions.md`, `prototype/`, ...).
 */
export type TaskFolderEntryRole = 'carrier' | 'workflow' | 'legacy' | 'extra';

/** One entry as validated from the host. */
export interface TaskFolderRawEntry {
  readonly name: string;
  readonly kind: TaskFolderEntryKind;
}

/** One reader row: an actual entry, or a workflow document expected but absent. */
export interface TaskFolderEntry {
  readonly name: string;
  readonly kind: TaskFolderEntryKind;
  readonly presence: 'present' | 'missing';
  readonly role: TaskFolderEntryRole;
  /** Workflow stage label for `workflow` / `legacy` rows, otherwise `null`. */
  readonly label: string | null;
  /** The in-place reader may be offered for this row. */
  readonly readable: boolean;
  /** The row may be handed to the editor opener (direct-child regular file). */
  readonly openable: boolean;
}

/** One breadcrumb segment. `path` is `''` for the task folder itself. */
export interface TaskFolderBreadcrumb {
  readonly label: string;
  readonly path: string;
}

/** The host limits nested listings to this depth; deeper paths are refused locally. */
export const MAX_FOLDER_DEPTH = 4;

const ENTRY_KINDS: ReadonlySet<string> = new Set([
  'file',
  'directory',
  'symlink',
  'other',
]);

/**
 * True when `name` can only mean a direct child of the folder it is listed in.
 *
 * Rejects the empty name, `.` and `..`, any separator, a drive colon, NUL and
 * percent signs (so an encoded traversal never reaches a path join).
 */
export function isDirectChildName(name: string): boolean {
  if (name.length === 0 || name.length > 255) return false;
  if (name === '.' || name === '..') return false;
  return !/[\\/:%\0]/.test(name);
}

/**
 * Validate a relative directory path inside the task folder: `''` for the
 * folder itself, otherwise 1 to {@link MAX_FOLDER_DEPTH} `/`-separated
 * direct-child segments.
 */
export function isValidFolderDirectory(directory: string): boolean {
  if (directory === '') return true;
  const segments = directory.split('/');
  return (
    segments.length <= MAX_FOLDER_DEPTH &&
    segments.every((segment) => isDirectChildName(segment))
  );
}

/** Append one validated child name to a relative directory path. */
export function joinFolderPath(directory: string, name: string): string {
  return directory === '' ? name : `${directory}/${name}`;
}

/** Breadcrumbs from the task folder down to `directory`. */
export function folderBreadcrumbs(
  folderLabel: string,
  directory: string,
): readonly TaskFolderBreadcrumb[] {
  const crumbs: TaskFolderBreadcrumb[] = [{ label: folderLabel, path: '' }];
  if (directory === '') return crumbs;
  let path = '';
  for (const segment of directory.split('/')) {
    path = joinFolderPath(path, segment);
    crumbs.push({ label: segment, path });
  }
  return crumbs;
}

/**
 * Validate a host-supplied entry list. Malformed or unsafe entries are dropped,
 * and a name listed twice keeps its first kind.
 */
export function parseFolderEntries(raw: unknown): TaskFolderRawEntry[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const entries: TaskFolderRawEntry[] = [];
  for (const item of raw) {
    if (typeof item !== 'object' || item === null) continue;
    const name: unknown = Reflect.get(item, 'name');
    const kind: unknown = Reflect.get(item, 'kind');
    if (typeof name !== 'string' || !isDirectChildName(name)) continue;
    if (typeof kind !== 'string' || !isEntryKind(kind)) continue;
    if (seen.has(name)) continue;
    seen.add(name);
    entries.push({ name, kind });
  }
  return entries;
}

/**
 * The root listing of a task. Prefers the typed `entries`; a host that predates
 * them sends only `artifacts`, whose names are all regular files.
 */
export function rootEntriesOf(detail: TaskSpecDetail): TaskFolderRawEntry[] {
  if (Array.isArray(detail.entries)) return parseFolderEntries(detail.entries);
  return parseFolderEntries(
    (Array.isArray(detail.artifacts) ? detail.artifacts : []).map((name) => ({
      name,
      kind: 'file',
    })),
  );
}

/**
 * Rows for the task folder root: the carrier, then every workflow stage in
 * `DOC_FILES` order (present, or a `missing` row for its canonical name), then
 * the remaining files, then directories.
 *
 * `tasks.md` satisfies the batch stage when `batches.md` is absent and is
 * still listed beside it when both exist.
 */
export function buildRootFolderEntries(
  raw: readonly TaskFolderRawEntry[],
): TaskFolderEntry[] {
  const byName = new Map(raw.map((entry) => [entry.name, entry]));
  const placed = new Set<string>();
  const rows: TaskFolderEntry[] = [];

  const carrier = byName.get(CARRIER_FILE);
  if (carrier) {
    rows.push(presentRow(carrier, 'carrier', null, true));
    placed.add(carrier.name);
  }

  for (const stage of WORKFLOW_ARTIFACTS) {
    const present = stage.files
      .map((file) => byName.get(file))
      .filter((entry): entry is TaskFolderRawEntry => entry !== undefined);
    if (present.length === 0) {
      rows.push({
        name: stage.files[0],
        kind: 'file',
        presence: 'missing',
        role: 'workflow',
        label: stage.label,
        readable: false,
        openable: false,
      });
      continue;
    }
    for (const entry of present) {
      const role = isLegacyDocFile(entry.name) ? 'legacy' : 'workflow';
      rows.push(presentRow(entry, role, stage.label, true));
      placed.add(entry.name);
    }
  }

  const rest = raw.filter((entry) => !placed.has(entry.name));
  for (const entry of sortEntries(rest)) {
    rows.push(presentRow(entry, 'extra', null, true));
  }
  return rows;
}

/**
 * Rows for a nested directory. Only navigation is offered there: the read RPC
 * and the editor opener accept direct children of the task folder only.
 */
export function buildNestedFolderEntries(
  raw: readonly TaskFolderRawEntry[],
): TaskFolderEntry[] {
  return sortEntries(raw).map((entry) => ({
    name: entry.name,
    kind: entry.kind,
    presence: 'present',
    role: 'extra',
    label: null,
    readable: false,
    openable: false,
  }));
}

/**
 * True when `file` is a present regular file directly inside the task folder,
 * so composing `<folder>/<file>` for the editor opener cannot leave it.
 */
export function isOpenableRootFile(
  detail: TaskSpecDetail,
  file: string,
): boolean {
  if (!isDirectChildName(file)) return false;
  return rootEntriesOf(detail).some(
    (entry) => entry.name === file && entry.kind === 'file',
  );
}

function presentRow(
  entry: TaskFolderRawEntry,
  role: TaskFolderEntryRole,
  label: string | null,
  atRoot: boolean,
): TaskFolderEntry {
  const isFile = entry.kind === 'file';
  return {
    name: entry.name,
    kind: entry.kind,
    presence: 'present',
    role,
    label,
    readable:
      atRoot &&
      isFile &&
      role !== 'carrier' &&
      (isDocFile(entry.name) || isReadableTaskFolderMarkdownName(entry.name)),
    openable: atRoot && isFile,
  };
}

/** Files (and other non-directories) by name, then directories by name. */
function sortEntries(
  entries: readonly TaskFolderRawEntry[],
): TaskFolderRawEntry[] {
  return [...entries].sort((a, b) => {
    const aDir = a.kind === 'directory' ? 1 : 0;
    const bDir = b.kind === 'directory' ? 1 : 0;
    if (aDir !== bDir) return aDir - bDir;
    return a.name < b.name ? -1 : a.name > b.name ? 1 : 0;
  });
}

function isEntryKind(kind: string): kind is TaskFolderEntryKind {
  return ENTRY_KINDS.has(kind);
}
