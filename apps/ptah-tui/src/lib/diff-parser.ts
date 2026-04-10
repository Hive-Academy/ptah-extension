/**
 * diff-parser -- Unified diff format parser for the TUI.
 *
 * Parses raw unified diff output (e.g. from `git diff`) into structured
 * objects suitable for rendering by DiffViewer. Handles multi-file diffs,
 * binary files, renames, and malformed input gracefully.
 */

export interface DiffLine {
  type: 'add' | 'delete' | 'context';
  content: string;
  oldLineNumber?: number;
  newLineNumber?: number;
}

export interface DiffHunk {
  oldStart: number;
  oldCount: number;
  newStart: number;
  newCount: number;
  lines: DiffLine[];
}

export interface ParsedDiff {
  filePath: string;
  hunks: DiffHunk[];
  totalAdded: number;
  totalDeleted: number;
}

const HUNK_HEADER_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/;

function createFallback(rawDiff: string): ParsedDiff[] {
  return [
    {
      filePath: 'unknown',
      hunks: [
        {
          oldStart: 1,
          oldCount: 0,
          newStart: 1,
          newCount: 0,
          lines: rawDiff.split('\n').map((l) => ({
            type: 'context' as const,
            content: l,
          })),
        },
      ],
      totalAdded: 0,
      totalDeleted: 0,
    },
  ];
}

/**
 * Extract a file path from a `--- a/path` or `+++ b/path` header line.
 * Also handles `--- path` and `+++ path` (without a/ b/ prefix).
 * Returns undefined for /dev/null entries.
 */
function extractPath(line: string, prefix: '---' | '+++'): string | undefined {
  const rest = line.slice(prefix.length).trim();
  if (rest === '/dev/null') return undefined;

  // Strip leading a/ or b/ prefix
  if (rest.startsWith('a/') || rest.startsWith('b/')) {
    return rest.slice(2);
  }
  return rest;
}

/**
 * Parse a raw unified diff string into structured ParsedDiff objects.
 *
 * Supports multi-file diffs, binary file markers, renames, and
 * gracefully falls back on malformed input.
 */
export function parseDiff(rawDiff: string): ParsedDiff[] {
  try {
    const lines = rawDiff.split('\n');
    const results: ParsedDiff[] = [];
    let currentDiff: ParsedDiff | null = null;
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
    // Tracks the path from `diff --git` as a fallback
    let gitDiffPath: string | undefined;

    function finalizeCurrent(): void {
      if (currentHunk && currentDiff) {
        currentDiff.hunks.push(currentHunk);
      }
      if (currentDiff) {
        results.push(currentDiff);
      }
      currentDiff = null;
      currentHunk = null;
    }

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // `diff --git a/path b/path` — start of a new file diff
      if (line.startsWith('diff --git ')) {
        finalizeCurrent();
        // Extract path from `diff --git a/path b/path`
        const match = line.match(/^diff --git a\/(.*?) b\/(.*?)$/);
        gitDiffPath = match ? match[2] : undefined;
        continue;
      }

      // `Binary files ... differ` — skip binary diffs
      if (line.startsWith('Binary files ') && line.endsWith(' differ')) {
        finalizeCurrent();
        const filePath = gitDiffPath ?? 'binary file';
        results.push({
          filePath,
          hunks: [],
          totalAdded: 0,
          totalDeleted: 0,
        });
        gitDiffPath = undefined;
        continue;
      }

      // `rename from/to` — capture rename path
      if (line.startsWith('rename to ')) {
        gitDiffPath = line.slice('rename to '.length).trim();
        continue;
      }
      if (line.startsWith('rename from ')) {
        continue;
      }

      // `--- a/path` or `--- path` — old file header
      if (line.startsWith('--- ')) {
        // This marks the beginning of the actual diff content for a file.
        // If no currentDiff yet, create one.
        if (!currentDiff) {
          currentDiff = {
            filePath: gitDiffPath ?? 'unknown',
            hunks: [],
            totalAdded: 0,
            totalDeleted: 0,
          };
        }
        // We use +++ for the primary path, so just continue
        continue;
      }

      // `+++ b/path` or `+++ path` — new file header (primary filePath)
      if (line.startsWith('+++ ')) {
        const path = extractPath(line, '+++');
        if (!currentDiff) {
          currentDiff = {
            filePath: path ?? gitDiffPath ?? 'unknown',
            hunks: [],
            totalAdded: 0,
            totalDeleted: 0,
          };
        } else if (path) {
          currentDiff.filePath = path;
        }
        gitDiffPath = undefined;
        continue;
      }

      // `@@ -a,b +c,d @@` — hunk header
      const hunkMatch = HUNK_HEADER_RE.exec(line);
      if (hunkMatch) {
        // Push previous hunk if any
        if (currentHunk && currentDiff) {
          currentDiff.hunks.push(currentHunk);
        }

        // If we encounter a hunk without a preceding --- / +++ (rare but possible),
        // create a placeholder diff entry
        if (!currentDiff) {
          currentDiff = {
            filePath: gitDiffPath ?? 'unknown',
            hunks: [],
            totalAdded: 0,
            totalDeleted: 0,
          };
        }

        const oldStart = parseInt(hunkMatch[1], 10);
        const oldCount =
          hunkMatch[2] !== undefined ? parseInt(hunkMatch[2], 10) : 1;
        const newStart = parseInt(hunkMatch[3], 10);
        const newCount =
          hunkMatch[4] !== undefined ? parseInt(hunkMatch[4], 10) : 1;

        currentHunk = {
          oldStart,
          oldCount,
          newStart,
          newCount,
          lines: [],
        };
        oldLine = oldStart;
        newLine = newStart;
        continue;
      }

      // Skip metadata lines when not inside a hunk
      if (!currentHunk) {
        // Lines like `index abc..def 100644`, `old mode`, `new mode`, etc.
        continue;
      }

      // Diff content lines (inside a hunk)
      if (line.startsWith('+')) {
        const diffLine: DiffLine = {
          type: 'add',
          content: line.slice(1),
          newLineNumber: newLine,
        };
        currentHunk.lines.push(diffLine);
        if (currentDiff) currentDiff.totalAdded++;
        newLine++;
      } else if (line.startsWith('-')) {
        const diffLine: DiffLine = {
          type: 'delete',
          content: line.slice(1),
          oldLineNumber: oldLine,
        };
        currentHunk.lines.push(diffLine);
        if (currentDiff) currentDiff.totalDeleted++;
        oldLine++;
      } else if (line.startsWith(' ')) {
        const diffLine: DiffLine = {
          type: 'context',
          content: line.slice(1),
          oldLineNumber: oldLine,
          newLineNumber: newLine,
        };
        currentHunk.lines.push(diffLine);
        oldLine++;
        newLine++;
      } else if (line.startsWith('\\')) {
        // `\ No newline at end of file` — skip
        continue;
      }
      // Any other line inside a hunk is treated as context (shouldn't happen in valid diffs)
    }

    // Finalize last entry
    finalizeCurrent();

    if (results.length === 0) {
      return createFallback(rawDiff);
    }

    return results;
  } catch {
    return createFallback(rawDiff);
  }
}
