import type { ExecutionNode } from '../types/execution';

import {
  classifyTestCommand,
  hasMaskedTestCommandOutcome,
} from './test-command-matcher';

export type TurnTestOutcome = 'passed' | 'failed' | 'running' | 'unknown';

export interface TurnTestRun {
  readonly command: string;
  readonly outcome: TurnTestOutcome;
  readonly project?: string;
  readonly failures?: readonly string[];
}

export interface TurnTestSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly running: number;
  readonly unknown: number;
}

function outcomeFor(node: ExecutionNode, finalized: boolean): TurnTestOutcome {
  if (
    node.toolInput?.['run_in_background'] === true &&
    node.status !== 'complete' &&
    node.status !== 'error'
  )
    return 'running';
  if (!finalized && node.status !== 'complete' && node.status !== 'error')
    return 'unknown';
  if (node.status !== 'complete' && node.status !== 'error') return 'unknown';
  if (node.isError === true) return 'failed';
  if (node.isError === false) return 'passed';
  return 'unknown';
}

function outputText(output: unknown): string {
  if (typeof output === 'string') return output;
  if (typeof output === 'object' && output !== null) {
    const record = output as Record<string, unknown>;
    return [record['summary'], record['output'], record['message']]
      .filter((value): value is string => typeof value === 'string')
      .join('\n');
  }
  return '';
}

function outputOutcome(output: string): TurnTestOutcome | null {
  const reportedFailures = Array.from(
    output.matchAll(/(?:Tests|Test Suites):\s*(\d+)\s+failed/gi),
    (match) => Number(match[1]),
  );
  if (
    /^[ \t]*(?:Failed tasks:|Ran targets?\b.*\bfailed\b)/im.test(output) ||
    reportedFailures.some((count) => count > 0)
  )
    return 'failed';
  if (
    /Successfully ran target|Tests:\s*\d+\s+passed|Test Suites:\s*\d+\s+passed/i.test(
      output,
    )
  )
    return 'passed';
  return null;
}

function projectRuns(
  command: string,
  output: string,
  outcome: TurnTestOutcome,
  completed: boolean,
): TurnTestRun[] {
  const projects = new Map<string, TurnTestOutcome>();
  if (completed) {
    for (const match of output.matchAll(
      /Successfully ran target\s+([^\s:]+):([^\s\n]+)/gi,
    ))
      projects.set(`${match[1]}:${match[2]}`, 'passed');
  }
  let inFailedTasks = false;
  for (const line of output.split('\n')) {
    if (/^\s*Failed tasks:\s*$/i.test(line)) {
      inFailedTasks = true;
      continue;
    }
    const match = inFailedTasks
      ? /^\s*-\s*([^\s:]+):([^\s\n]+)\s*$/.exec(line)
      : /^\s*[\u00d7x]\s*([^\s:]+):([^\s\n]+)/i.exec(line);
    if (match !== null) {
      projects.set(`${match[1]}:${match[2]}`, 'failed');
      continue;
    }
    if (line.trim() !== '') inFailedTasks = false;
  }
  const failures = Array.from(
    output.matchAll(/^[ \t]*(?:FAIL|\u00d7)[ \t]+([^\n]+)/gm),
    (match) => match[1].trim(),
  ).slice(0, 5);
  if (projects.size === 0)
    return [{ command, outcome, ...(failures.length > 0 && { failures }) }];
  const runs: TurnTestRun[] = Array.from(projects, ([project, projectOutcome]) => ({
    command,
    project,
    outcome: projectOutcome,
    ...(projectOutcome === 'failed' && failures.length > 0 && { failures }),
  }));
  if (outcome === 'failed' && !runs.some((run) => run.outcome === 'failed')) {
    runs.push({ command, outcome });
  }
  return runs;
}

/** Collects Bash test commands in depth-first execution-tree order. */
export function collectTurnTests(
  roots: readonly ExecutionNode[],
  opts: { readonly finalized: boolean },
): TurnTestRun[] {
  if (!Array.isArray(roots)) return [];

  const runs: TurnTestRun[] = [];
  const visited = new Set<ExecutionNode>();
  const visit = (node: ExecutionNode): void => {
    if (visited.has(node)) return;
    visited.add(node);
    const command = node.toolInput?.['command'];
    if (
      node.type === 'tool' &&
      node.toolName === 'Bash' &&
      typeof command === 'string' &&
      classifyTestCommand(command)
    ) {
      const output = outputText(node.toolOutput);
      const completed = node.status === 'complete' || node.status === 'error';
      const parsedOutcome = outputOutcome(output);
      const outcome =
        (node.isError === true
          ? 'failed'
          : parsedOutcome === 'failed' || completed
            ? parsedOutcome
            : null) ??
        (hasMaskedTestCommandOutcome(command) && node.status === 'complete'
          ? 'unknown'
          : outcomeFor(node, opts.finalized));
      runs.push(...projectRuns(command, output, outcome, completed));
    }
    for (const child of node.children) visit(child);
  };
  for (const root of roots) visit(root);
  return runs;
}

/** Counts the outcome categories in a collected test run list. */
export function summarizeTurnTests(
  runs: readonly TurnTestRun[],
): TurnTestSummary {
  if (!Array.isArray(runs)) {
    return { total: 0, passed: 0, failed: 0, running: 0, unknown: 0 };
  }
  let passed = 0;
  let failed = 0;
  let running = 0;
  let unknown = 0;
  for (const run of runs) {
    if (run.outcome === 'passed') passed += 1;
    else if (run.outcome === 'failed') failed += 1;
    else if (run.outcome === 'running') running += 1;
    else unknown += 1;
  }
  return { total: runs.length, passed, failed, running, unknown };
}
