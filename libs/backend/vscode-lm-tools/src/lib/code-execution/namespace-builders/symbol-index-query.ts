/**
 * Paging and filtering of the symbol index (TASK_2026_559 Batch 9).
 *
 * Kept apart from `analysis-namespace.builders.ts` because the MCP layer
 * (`tool-description.builder.ts`, `protocol-dispatcher.ts`) needs the limits
 * and the argument validation without loading the workspace-intelligence
 * services that builder imports.
 */
import * as path from 'node:path';
import type {
  SymbolIndexEntry,
  SymbolIndexPage,
  SymbolIndexQuery,
} from '../types';

/**
 * Default symbol-index page size. 200 did not fit the 8,000-char result
 * budget: on this repository's own index (2,652 files, absolute paths of 135
 * chars on average) the first 200 entries are about 39,000 chars, 40 entries
 * about 7,100 chars and 1,860 tokens, 30 entries about 5,600 chars and 1,450
 * tokens.
 */
export const SYMBOL_INDEX_DEFAULT_LIMIT = 30;
/** Largest `limit` a symbol-index page accepts. */
export const SYMBOL_INDEX_MAX_LIMIT = 1000;

/** A validated {@link SymbolIndexQuery}; `pathPrefix` is `/`-separated and not yet resolved. */
export interface ParsedSymbolIndexQuery {
  readonly pathPrefix?: string;
  readonly limit: number;
  readonly offset: number;
}

export type SymbolIndexQueryParseResult =
  | { readonly ok: true; readonly query: ParsedSymbolIndexQuery }
  | { readonly ok: false; readonly error: string };

/** A Windows absolute path once `\` is `/`: `C:/…` or UNC `//server/…`. */
const WINDOWS_ABSOLUTE = /^(?:[A-Za-z]:\/|\/\/)/;
/** `C:foo`: relative to the drive's current directory, which the host does not know. */
const DRIVE_RELATIVE = /^[A-Za-z]:(?!\/)/;

/**
 * Validate the paging and filtering arguments of the symbol index. `null` and
 * `undefined` mean "not given". Errors are fixed text and never echo a value.
 */
export function parseSymbolIndexQuery(input: {
  readonly [K in keyof SymbolIndexQuery]?: unknown;
}): SymbolIndexQueryParseResult {
  const limit = input.limit ?? SYMBOL_INDEX_DEFAULT_LIMIT;
  if (
    typeof limit !== 'number' ||
    !Number.isInteger(limit) ||
    limit < 1 ||
    limit > SYMBOL_INDEX_MAX_LIMIT
  ) {
    return {
      ok: false,
      error: `"limit" must be an integer from 1 to ${SYMBOL_INDEX_MAX_LIMIT}.`,
    };
  }
  const offset = input.offset ?? 0;
  if (
    typeof offset !== 'number' ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  ) {
    return { ok: false, error: '"offset" must be a non-negative integer.' };
  }
  const rawPrefix = input.pathPrefix ?? '';
  if (typeof rawPrefix !== 'string') {
    return { ok: false, error: '"pathPrefix" must be a string.' };
  }
  const slashed = rawPrefix.trim().replace(/\\/g, '/');
  if (slashed === '') {
    return { ok: true, query: { limit, offset } };
  }
  if (slashed.split('/').includes('..')) {
    return {
      ok: false,
      error: '"pathPrefix" must not contain ".." segments.',
    };
  }
  if (DRIVE_RELATIVE.test(slashed)) {
    return {
      ok: false,
      error:
        '"pathPrefix" must be workspace-relative or absolute, not drive-relative (C:dir).',
    };
  }
  // posix.normalize folds `a//b` and `./` segments but would also fold the
  // UNC `//` into one slash, so a UNC prefix keeps its leading slash apart.
  const pathPrefix = slashed.startsWith('//')
    ? `/${path.posix.normalize(slashed.slice(1))}`
    : path.posix.normalize(slashed);
  return { ok: true, query: { pathPrefix, limit, offset } };
}

/**
 * The absolute `/`-separated prefix a parsed `pathPrefix` stands for, or
 * `undefined` when it is relative and there is no root to resolve it against.
 * `.` (the root itself) becomes `<root>/`.
 */
function resolveSymbolIndexPrefix(
  pathPrefix: string,
  workspaceRoot: string | undefined,
): string | undefined {
  if (pathPrefix.startsWith('/') || WINDOWS_ABSOLUTE.test(pathPrefix)) {
    return pathPrefix;
  }
  if (!workspaceRoot) {
    return undefined;
  }
  const base = workspaceRoot.replace(/\\/g, '/').replace(/\/+$/, '');
  const relative = pathPrefix === '.' || pathPrefix === './' ? '' : pathPrefix;
  return `${base}/${relative}`;
}

/**
 * `entries` under the query's `pathPrefix`, ordered by path, and the page of
 * them at `offset`. A relative prefix resolves against `workspaceRoot`; with
 * no root it matches nothing. A Windows prefix (drive letter or UNC) matches
 * case-insensitively, as the file system it names does; a POSIX prefix
 * matches exactly.
 */
export function pageSymbolIndex(
  entries: readonly SymbolIndexEntry[],
  query: ParsedSymbolIndexQuery,
  workspaceRoot: string | undefined,
): SymbolIndexPage {
  const { limit, offset } = query;
  let matching: SymbolIndexEntry[] = [...entries];
  if (query.pathPrefix !== undefined) {
    const prefix = resolveSymbolIndexPrefix(query.pathPrefix, workspaceRoot);
    if (prefix === undefined) {
      return { files: [], count: 0, total: 0, offset };
    }
    const foldCase = WINDOWS_ABSOLUTE.test(prefix);
    const wanted = foldCase ? prefix.toLowerCase() : prefix;
    matching = matching.filter((entry) => {
      const file = entry.file.replace(/\\/g, '/');
      return (foldCase ? file.toLowerCase() : file).startsWith(wanted);
    });
  }
  matching.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
  const files = matching.slice(offset, offset + limit);
  const end = offset + files.length;
  return {
    files,
    count: files.length,
    total: matching.length,
    offset,
    ...(end < matching.length ? { nextOffset: end } : {}),
  };
}
