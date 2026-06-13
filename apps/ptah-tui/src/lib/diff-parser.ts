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

function extractPath(line: string, prefix: '---' | '+++'): string | undefined {
  const rest = line.slice(prefix.length).trim();
  if (rest === '/dev/null') return undefined;

  if (rest.startsWith('a/') || rest.startsWith('b/')) {
    return rest.slice(2);
  }
  return rest;
}

export function parseDiff(rawDiff: string): ParsedDiff[] {
  try {
    const lines = rawDiff.split('\n');
    const results: ParsedDiff[] = [];
    let currentDiff: ParsedDiff | null = null;
    let currentHunk: DiffHunk | null = null;
    let oldLine = 0;
    let newLine = 0;
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

      if (line.startsWith('diff --git ')) {
        finalizeCurrent();
        const match = line.match(/^diff --git a\/(.*?) b\/(.*?)$/);
        gitDiffPath = match ? match[2] : undefined;
        continue;
      }

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

      if (line.startsWith('rename to ')) {
        gitDiffPath = line.slice('rename to '.length).trim();
        continue;
      }
      if (line.startsWith('rename from ')) {
        continue;
      }

      if (line.startsWith('--- ')) {
        if (!currentDiff) {
          currentDiff = {
            filePath: gitDiffPath ?? 'unknown',
            hunks: [],
            totalAdded: 0,
            totalDeleted: 0,
          };
        }
        continue;
      }

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

      const hunkMatch = HUNK_HEADER_RE.exec(line);
      if (hunkMatch) {
        if (currentHunk && currentDiff) {
          currentDiff.hunks.push(currentHunk);
        }

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

      if (!currentHunk) {
        continue;
      }

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
        continue;
      }
    }

    finalizeCurrent();

    if (results.length === 0) {
      return createFallback(rawDiff);
    }

    return results;
  } catch {
    return createFallback(rawDiff);
  }
}
