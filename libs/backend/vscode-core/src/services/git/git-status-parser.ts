import type { GitBranchInfo, GitFileStatus } from '@ptah-extension/shared';

/**
 * Parser for `git status --porcelain=v2 --branch -z` output.
 *
 * With `-z` every record ends in a NUL byte and paths are written verbatim:
 * no C-quoting, no escaping, no trimming. A type-2 (rename/copy) record is
 * followed by one extra NUL-terminated field holding the original path.
 *
 * Record shapes (fields separated by a single space; the path is the rest of
 * the record and may itself contain spaces):
 *   # branch.oid <commit> | (initial)
 *   # branch.head <branch> | (detached)
 *   # branch.upstream <upstream>
 *   # branch.ab +<ahead> -<behind>
 *   1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>
 *   2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>\0<origPath>
 *   u <XY> <sub> <m1> <m2> <m3> <mW> <h1> <h2> <h3> <path>
 *   ? <path>
 *   ! <path>
 *
 * Status values stay inside today's `GitFileStatus['status']` union: `T`
 * (type change) and unmerged `u` records map to `'M'`, matching the
 * line-based parser this module replaces.
 */

export interface GitStatusV2ZResult {
  branch: GitBranchInfo;
  files: GitFileStatus[];
  /** Records that could not be parsed and were left out of the result. */
  skippedRecords: number;
}

const NUL = '\0';
const BRANCH_HEAD = '# branch.head ';
const BRANCH_UPSTREAM = '# branch.upstream ';
const BRANCH_AB = '# branch.ab ';

/** Space-separated fields that precede the path, the record type included. */
const ORDINARY_FIELDS_BEFORE_PATH = 8;
const RENAME_FIELDS_BEFORE_PATH = 9;
const UNMERGED_FIELDS_BEFORE_PATH = 10;

/** Characters git writes in the XY field of type 1, 2 and u records. */
const XY_CODES = new Set(['.', 'M', 'T', 'A', 'D', 'R', 'C', 'U']);

/**
 * Parse `git status --porcelain=v2 --branch -z` output. Runs in one pass,
 * never throws, and counts every record it cannot interpret.
 */
export function parseStatusV2Z(output: string): GitStatusV2ZResult {
  const branch: GitBranchInfo = {
    branch: '',
    upstream: null,
    ahead: 0,
    behind: 0,
  };
  const files: GitFileStatus[] = [];
  let skippedRecords = 0;

  let pos = 0;
  const length = output.length;
  while (pos < length) {
    const end = nextNul(output, pos);
    const record = output.substring(pos, end);
    pos = end + 1;

    // Every record is `<type> <rest>`; an empty or separator-less one is garbage.
    if (record.length < 2 || record[1] !== ' ') {
      skippedRecords++;
      continue;
    }

    switch (record[0]) {
      case '#':
        if (!applyHeader(record, branch)) skippedRecords++;
        break;
      case '1':
        if (
          !pushTracked(record, ORDINARY_FIELDS_BEFORE_PATH, undefined, files)
        ) {
          skippedRecords++;
        }
        break;
      case '2': {
        // The original path is the next NUL-terminated field. Consume it
        // even when the record itself is malformed so it is never read as a
        // record of its own.
        if (pos >= length) {
          skippedRecords++;
          break;
        }
        const origEnd = nextNul(output, pos);
        const origPath = output.substring(pos, origEnd);
        pos = origEnd + 1;
        if (
          origPath.length === 0 ||
          !pushTracked(record, RENAME_FIELDS_BEFORE_PATH, origPath, files)
        ) {
          skippedRecords++;
        }
        break;
      }
      case 'u':
        if (!pushUnmerged(record, files)) skippedRecords++;
        break;
      case '?':
      case '!':
        if (
          !pushUntrackedOrIgnored(record, record[0] === '?' ? '??' : '!', files)
        ) {
          skippedRecords++;
        }
        break;
      default:
        skippedRecords++;
    }
  }

  return { branch, files, skippedRecords };
}

function nextNul(output: string, from: number): number {
  const index = output.indexOf(NUL, from);
  return index === -1 ? output.length : index;
}

/**
 * Index of the first path character: the position after the `count`-th
 * space. Returns -1 when the record has fewer fields or an empty path.
 */
function pathStart(record: string, count: number): number {
  let index = 0;
  for (let seen = 0; seen < count; seen++) {
    const space = record.indexOf(' ', index);
    if (space === -1) return -1;
    index = space + 1;
  }
  return index < record.length ? index : -1;
}

/** The XY field, or null when it is not two known status characters. */
function readXy(record: string): string | null {
  if (record.length < 5 || record[4] !== ' ') return null;
  const x = record[2];
  const y = record[3];
  return XY_CODES.has(x) && XY_CODES.has(y) ? x + y : null;
}

function applyHeader(record: string, branch: GitBranchInfo): boolean {
  if (record.startsWith(BRANCH_HEAD)) {
    const head = record.substring(BRANCH_HEAD.length);
    if (head.length === 0) return false;
    branch.branch = head === '(detached)' ? 'HEAD' : head;
    return true;
  }
  if (record.startsWith(BRANCH_UPSTREAM)) {
    const upstream = record.substring(BRANCH_UPSTREAM.length);
    if (upstream.length === 0) return false;
    branch.upstream = upstream;
    return true;
  }
  if (record.startsWith(BRANCH_AB)) {
    return applyAheadBehind(record.substring(BRANCH_AB.length), branch);
  }
  // `# branch.oid`, `# stash <n>` and future headers carry nothing this result
  // reports; they are well-formed, so they are not counted as skipped.
  return true;
}

/** Parse `+<ahead> -<behind>` without a regex. */
function applyAheadBehind(value: string, branch: GitBranchInfo): boolean {
  const space = value.indexOf(' ');
  if (space === -1 || value[0] !== '+' || value[space + 1] !== '-') {
    return false;
  }
  const ahead = parseDigits(value, 1, space);
  const behind = parseDigits(value, space + 2, value.length);
  if (ahead === null || behind === null) return false;
  branch.ahead = ahead;
  branch.behind = behind;
  return true;
}

function parseDigits(value: string, from: number, to: number): number | null {
  if (from >= to) return null;
  let result = 0;
  for (let i = from; i < to; i++) {
    const digit = value.charCodeAt(i) - 0x30;
    if (digit < 0 || digit > 9) return null;
    result = result * 10 + digit;
  }
  return result;
}

/** Type 1 and type 2 records: one entry per non-`.` side of XY. */
function pushTracked(
  record: string,
  fieldsBeforePath: number,
  origPath: string | undefined,
  files: GitFileStatus[],
): boolean {
  const xy = readXy(record);
  const start = pathStart(record, fieldsBeforePath);
  if (xy === null || start === -1) return false;

  const path = record.substring(start);
  const origin = origPath === undefined ? {} : { origPath };
  if (xy[0] !== '.') {
    files.push({ path, status: mapStatusCode(xy[0]), staged: true, ...origin });
  }
  if (xy[1] !== '.') {
    files.push({
      path,
      status: mapStatusCode(xy[1]),
      staged: false,
      ...origin,
    });
  }
  return true;
}

/** Unmerged records keep today's shape: one unstaged `'M'` entry (V9). */
function pushUnmerged(record: string, files: GitFileStatus[]): boolean {
  const start = pathStart(record, UNMERGED_FIELDS_BEFORE_PATH);
  if (readXy(record) === null || start === -1) return false;
  files.push({ path: record.substring(start), status: 'M', staged: false });
  return true;
}

function pushUntrackedOrIgnored(
  record: string,
  status: '??' | '!',
  files: GitFileStatus[],
): boolean {
  const rawPath = record.substring(2);
  if (rawPath.length === 0) return false;
  const isDirectory = rawPath.length > 1 && rawPath.endsWith('/');
  files.push({
    path: isDirectory ? rawPath.slice(0, -1) : rawPath,
    status,
    staged: false,
    ...(isDirectory && { isDirectory: true }),
  });
  return true;
}

/** `T` (type change) and any other code fall back to `'M'` as today (V9). */
function mapStatusCode(code: string): GitFileStatus['status'] {
  switch (code) {
    case 'A':
      return 'A';
    case 'D':
      return 'D';
    case 'R':
      return 'R';
    case 'C':
      return 'C';
    default:
      return 'M';
  }
}
