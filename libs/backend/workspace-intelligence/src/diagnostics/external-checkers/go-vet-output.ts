/**
 * go vet `-json` output → findings (TASK_2026_559 Batch 37a).
 *
 * `go vet -json` writes `# <package>` header lines and, per package, a JSON
 * tree `{ <package id>: { <analyzer>: [ { posn, message, … } ] | { error } } }`
 * (x/tools `analysisflags.JSONTree`). Anything else outside an object makes
 * the output unreadable (`null`), never an empty success. A finding whose
 * position the caller cannot map into the workspace (a `//line` directive,
 * generated code) is COUNTED per package, never dropped (review r1 finding 3).
 */

import * as path from 'path';
import type {
  DiagnosticEntry,
  FileDiagnostics,
} from '@ptah-extension/platform-core';
import type { GoVetReason } from './go-vet-checker';

/** Most diagnostics one run reports; the rest set `diagnosticsTruncated`. */
export const GO_VET_MAX_DIAGNOSTICS = 500;

/** End of the JSON object that opens at `start`, or -1. */
function endOfJsonObject(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === '\\') index++;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === '{') depth++;
    else if (char === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

/**
 * Split vet's `-json` output: `# <package>` header lines and JSON objects.
 * Anything else outside an object is `stray`.
 */
export function splitVetOutput(text: string): {
  readonly objects: unknown[];
  readonly stray: boolean;
} {
  const objects: unknown[] = [];
  let stray = false;
  let index = 0;
  while (index < text.length) {
    const char = text[index];
    if (char === ' ' || char === '\t' || char === '\r' || char === '\n') {
      index++;
      continue;
    }
    if (char === '{') {
      const end = endOfJsonObject(text, index);
      if (end < 0) return { objects, stray: true };
      try {
        objects.push(JSON.parse(text.slice(index, end + 1)));
      } catch (error: unknown) {
        void error;
        stray = true;
      }
      index = end + 1;
      continue;
    }
    const lineEnd = text.indexOf('\n', index);
    const stop = lineEnd < 0 ? text.length : lineEnd;
    if (char !== '#') stray = true;
    index = stop + 1;
  }
  return { objects, stray };
}

export function isPlainObject(
  value: unknown,
): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface ParsedVetOutput {
  readonly diagnostics: FileDiagnostics[];
  readonly truncated: boolean;
  readonly analyzerError: boolean;
  /** Findings whose position is outside the workspace, by package id. */
  readonly unmapped: ReadonlyMap<string, number>;
}

function parsePosition(posn: string): { file: string; line: number } | null {
  const match = /^(.+):(\d+):(\d+)$/.exec(posn) ?? /^(.+):(\d+)$/.exec(posn);
  if (match === null) return null;
  return { file: match[1], line: Number(match[2]) };
}

/** Maps a reported position to the path to report, or `null` (outside). */
export type PositionMapper = (file: string) => string | null;

/**
 * Vet's JSON tree → per-file diagnostics, or `null` when unreadable. A
 * position that maps outside the workspace is counted per package, never
 * dropped silently (review r1 finding 3).
 */
export function parseVetDiagnostics(
  text: string,
  moduleDir: string,
  mapPosition: PositionMapper,
): ParsedVetOutput | null {
  const { objects, stray } = splitVetOutput(text);
  if (stray) return null;
  const byFile = new Map<string, DiagnosticEntry[]>();
  const unmapped = new Map<string, number>();
  let count = 0;
  let truncated = false;
  let analyzerError = false;
  for (const tree of objects) {
    if (!isPlainObject(tree)) return null;
    for (const [packageId, analyzers] of Object.entries(tree)) {
      if (!isPlainObject(analyzers)) return null;
      for (const [analyzer, value] of Object.entries(analyzers)) {
        if (isPlainObject(value) && typeof value['error'] === 'string') {
          analyzerError = true;
          continue;
        }
        if (!Array.isArray(value)) return null;
        for (const item of value) {
          if (
            !isPlainObject(item) ||
            typeof item['posn'] !== 'string' ||
            typeof item['message'] !== 'string'
          ) {
            return null;
          }
          const position = parsePosition(item['posn']);
          if (position === null) return null;
          const file = mapPosition(path.resolve(moduleDir, position.file));
          if (file === null) {
            unmapped.set(packageId, (unmapped.get(packageId) ?? 0) + 1);
            continue;
          }
          if (count >= GO_VET_MAX_DIAGNOSTICS) {
            truncated = true;
            continue;
          }
          count++;
          const entries = byFile.get(file) ?? [];
          entries.push({
            message: item['message'],
            line: position.line,
            severity: 'warning',
            code: analyzer,
          });
          byFile.set(file, entries);
        }
      }
    }
  }
  return {
    diagnostics: [...byFile.entries()].map(([file, diagnostics]) => ({
      file,
      diagnostics,
    })),
    truncated,
    analyzerError,
    unmapped,
  };
}

/**
 * The directory of a vet package id (`example.com/m/a`, its test variants
 * `… [example.com/m/a.test]` and `example.com/m/a_test`), or `null` when the
 * id is not under the module.
 */
export function packageDirForId(
  packageId: string,
  modulePath: string | null,
  moduleDir: string,
): string | null {
  if (modulePath === null) return null;
  let importPath = packageId.split(' ')[0] ?? '';
  if (importPath.endsWith('.test')) importPath = importPath.slice(0, -5);
  if (importPath.endsWith('_test')) importPath = importPath.slice(0, -5);
  if (importPath === modulePath) return moduleDir;
  if (!importPath.startsWith(`${modulePath}/`)) return null;
  const parts = importPath.slice(modulePath.length + 1).split('/');
  if (parts.some((part) => part === '..' || part === '' || part === '.')) {
    return null;
  }
  return path.join(moduleDir, ...parts);
}

const TOOLCHAIN_MISMATCH = /requires go >= |GOTOOLCHAIN=local/;
const MISSING_MODULES =
  /missing go\.sum entry|no required module provides package|module lookup disabled|cannot find module providing package|updates to go\.mod needed|GOPROXY=off/;
const BUILD_ERRORS =
  /\.go:\d+(?::\d+)?: |build constraints exclude all Go files|^vet: /m;

/** Why a non-zero exit failed, read from fixed patterns only. */
export function classifyFailure(text: string): GoVetReason {
  if (TOOLCHAIN_MISMATCH.test(text)) return 'toolchain-mismatch';
  if (MISSING_MODULES.test(text)) return 'missing-modules';
  if (BUILD_ERRORS.test(text)) return 'build-errors';
  return 'unparseable';
}
