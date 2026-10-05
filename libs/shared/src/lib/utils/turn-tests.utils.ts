import type { ExecutionNode } from '../types/execution';

import {
  classifyTestCommand,
  hasMaskedTestCommandOutcome,
} from './test-command-matcher';

export type TurnTestOutcome = 'passed' | 'failed' | 'unknown';

export interface TurnTestRun {
  readonly command: string;
  readonly outcome: TurnTestOutcome;
}

export interface TurnTestSummary {
  readonly total: number;
  readonly passed: number;
  readonly failed: number;
  readonly unknown: number;
}

function outcomeFor(node: ExecutionNode, finalized: boolean): TurnTestOutcome {
  if (node.toolInput?.['run_in_background'] === true) return 'unknown';
  if (!finalized && node.status !== 'complete' && node.status !== 'error')
    return 'unknown';
  if (node.status !== 'complete' && node.status !== 'error') return 'unknown';
  if (node.isError === true) return 'failed';
  if (node.isError === false) return 'passed';
  return 'unknown';
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
      runs.push({
        command,
        outcome: hasMaskedTestCommandOutcome(command)
          ? 'unknown'
          : outcomeFor(node, opts.finalized),
      });
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
    return { total: 0, passed: 0, failed: 0, unknown: 0 };
  }
  let passed = 0;
  let failed = 0;
  let unknown = 0;
  for (const run of runs) {
    if (run.outcome === 'passed') passed += 1;
    else if (run.outcome === 'failed') failed += 1;
    else unknown += 1;
  }
  return { total: runs.length, passed, failed, unknown };
}
