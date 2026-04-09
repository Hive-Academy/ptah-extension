/**
 * DiffViewer -- Renders unified diffs with syntax coloring in the TUI.
 *
 * Parses raw unified diff text into structured hunks and renders them
 * with colored add/delete/context lines, line numbers, file headers,
 * and summary statistics. When a diff exceeds 50 lines and
 * `defaultCollapsed` is set, shows a truncated view with the first 10
 * and last 5 lines of each file.
 */

import React, { useMemo } from 'react';
import { Box, Text } from 'ink';

import { useTheme } from '../../hooks/use-theme.js';
import {
  parseDiff,
  type ParsedDiff,
  type DiffLine,
  type DiffHunk,
} from '../../lib/diff-parser.js';

interface DiffViewerProps {
  rawDiff: string;
  defaultCollapsed?: boolean;
}

/** Count total rendered lines across all hunks in a parsed diff. */
function countLines(diff: ParsedDiff): number {
  let count = 0;
  for (const hunk of diff.hunks) {
    count += hunk.lines.length;
  }
  return count;
}

/** Count total rendered lines across all parsed diffs. */
function countAllLines(diffs: ParsedDiff[]): number {
  let count = 0;
  for (const diff of diffs) {
    count += countLines(diff);
  }
  return count;
}

/** Flatten all lines from all hunks into a single array for truncation. */
function flattenLines(diff: ParsedDiff): DiffLine[] {
  const result: DiffLine[] = [];
  for (const hunk of diff.hunks) {
    for (const line of hunk.lines) {
      result.push(line);
    }
  }
  return result;
}

function DiffLineRow({ line }: { line: DiffLine }): React.JSX.Element {
  const theme = useTheme();

  const oldNum =
    line.oldLineNumber !== undefined
      ? String(line.oldLineNumber).padStart(4, ' ')
      : '    ';
  const newNum =
    line.newLineNumber !== undefined
      ? String(line.newLineNumber).padStart(4, ' ')
      : '    ';

  let prefix: string;
  let color: string | undefined;

  switch (line.type) {
    case 'add':
      prefix = '+';
      color = theme.status.success;
      break;
    case 'delete':
      prefix = '-';
      color = theme.status.error;
      break;
    default:
      prefix = ' ';
      color = undefined;
      break;
  }

  return (
    <Box>
      <Text color={theme.ui.dimmed}>
        {oldNum} {newNum}{' '}
      </Text>
      <Text color={color}>
        {prefix}
        {line.content}
      </Text>
    </Box>
  );
}

function HunkView({ hunk }: { hunk: DiffHunk }): React.JSX.Element {
  const theme = useTheme();
  const header = `@@ -${hunk.oldStart},${hunk.oldCount} +${hunk.newStart},${hunk.newCount} @@`;

  return (
    <Box flexDirection="column">
      <Text color={theme.ui.dimmed}>{header}</Text>
      {hunk.lines.map((line, idx) => (
        <DiffLineRow key={idx} line={line} />
      ))}
    </Box>
  );
}

function FileDiffView({
  diff,
  collapsed,
}: {
  diff: ParsedDiff;
  collapsed: boolean;
}): React.JSX.Element {
  const theme = useTheme();
  const lineCount = countLines(diff);

  return (
    <Box
      flexDirection="column"
      borderStyle="single"
      borderColor={theme.ui.border}
      paddingX={1}
      marginY={0}
    >
      {/* File header */}
      <Box gap={1}>
        <Text bold>{diff.filePath}</Text>
        {diff.totalAdded > 0 && (
          <Text color={theme.status.success}>+{diff.totalAdded}</Text>
        )}
        {diff.totalDeleted > 0 && (
          <Text color={theme.status.error}>-{diff.totalDeleted}</Text>
        )}
      </Box>

      {/* Diff content */}
      {diff.hunks.length === 0 ? (
        <Text color={theme.ui.dimmed}>Binary file</Text>
      ) : collapsed && lineCount > 50 ? (
        <CollapsedLines diff={diff} totalLines={lineCount} />
      ) : (
        diff.hunks.map((hunk, idx) => <HunkView key={idx} hunk={hunk} />)
      )}
    </Box>
  );
}

function CollapsedLines({
  diff,
  totalLines,
}: {
  diff: ParsedDiff;
  totalLines: number;
}): React.JSX.Element {
  const theme = useTheme();
  const allLines = flattenLines(diff);
  const headLines = allLines.slice(0, 10);
  const tailLines = allLines.slice(-5);
  const hiddenCount = totalLines - 15;

  return (
    <Box flexDirection="column">
      {headLines.map((line, idx) => (
        <DiffLineRow key={`head-${idx}`} line={line} />
      ))}
      <Box paddingX={1}>
        <Text color={theme.ui.dimmed}>
          {'... '}
          {hiddenCount}
          {' lines hidden ...'}
        </Text>
      </Box>
      {tailLines.map((line, idx) => (
        <DiffLineRow key={`tail-${idx}`} line={line} />
      ))}
    </Box>
  );
}

export function DiffViewer({
  rawDiff,
  defaultCollapsed,
}: DiffViewerProps): React.JSX.Element {
  const theme = useTheme();

  const parsed = useMemo(() => {
    try {
      return parseDiff(rawDiff);
    } catch {
      return null;
    }
  }, [rawDiff]);

  // Fallback: render raw text if parsing failed entirely
  if (!parsed || parsed.length === 0) {
    return (
      <Box borderStyle="single" borderColor={theme.ui.border} paddingX={1}>
        <Text>{rawDiff}</Text>
      </Box>
    );
  }

  const totalLines = countAllLines(parsed);
  const shouldCollapse =
    defaultCollapsed !== undefined ? defaultCollapsed : totalLines > 50;

  return (
    <Box flexDirection="column">
      {parsed.map((diff, idx) => (
        <FileDiffView key={idx} diff={diff} collapsed={shouldCollapse} />
      ))}
    </Box>
  );
}
