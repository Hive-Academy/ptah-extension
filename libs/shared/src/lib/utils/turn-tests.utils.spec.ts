import type { ExecutionNode, ExecutionStatus } from '../types/execution';

import { collectTurnTests, summarizeTurnTests } from './turn-tests.utils';

// Bash execution-tree fixture evidence: execution-tree-retention.spec.ts:423-425.
// `toolInput` is the shared ExecutionNode payload record (types/execution/node.ts:149-152);
// this test pins the plan's A-2 contract that command and run_in_background live there.
function node(
  overrides: Partial<ExecutionNode> = {},
  children: readonly ExecutionNode[] = [],
): ExecutionNode {
  return {
    id: 'node',
    type: 'tool',
    status: 'complete',
    content: null,
    isCollapsed: false,
    children,
    ...overrides,
  };
}

function bash(command: string, status: ExecutionStatus, background = false): ExecutionNode {
  return node({
    toolName: 'Bash',
    status,
    toolInput: { command, ...(background ? { run_in_background: true } : {}) },
  });
}

describe('collectTurnTests', () => {
  it('walks roots and agent subtrees depth-first, counting each node once', () => {
    const first = bash('npm test', 'complete');
    const nested = bash('pytest', 'error');
    const shared = bash('go test ./...', 'complete');
    const roots = [node({ id: 'root', type: 'message' }, [first, node({ id: 'agent', type: 'agent' }, [nested, shared])]), shared];

    expect(collectTurnTests(roots, { finalized: true })).toEqual([
      { command: 'npm test', outcome: 'passed' },
      { command: 'pytest', outcome: 'failed' },
      { command: 'go test ./...', outcome: 'passed' },
    ]);
  });

  it.each([
    ['complete', false, 'passed'],
    ['error', false, 'failed'],
    ['pending', false, 'unknown'],
    ['streaming', false, 'unknown'],
    ['interrupted', false, 'unknown'],
    ['resumed', false, 'unknown'],
    ['complete', true, 'unknown'],
  ] as const)('maps %s and background=%s to %s', (status, background, outcome) => {
    expect(collectTurnTests([bash('npm test', status, background)], { finalized: true })).toEqual([
      { command: 'npm test', outcome },
    ]);
  });

  it('ignores non-Bash, malformed, and non-test tool nodes', () => {
    expect(collectTurnTests([
      node({ toolName: 'Read', toolInput: { command: 'npm test' } }),
      node({ toolName: 'Bash', toolInput: {} }),
      bash('npm run build', 'complete'),
    ], { finalized: false })).toEqual([]);
  });
});

describe('summarizeTurnTests', () => {
  it('counts each outcome', () => {
    expect(summarizeTurnTests([
      { command: 'npm test', outcome: 'passed' },
      { command: 'pytest', outcome: 'failed' },
      { command: 'go test', outcome: 'unknown' },
    ])).toEqual({ total: 3, passed: 1, failed: 1, unknown: 1 });
  });
});
