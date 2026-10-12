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

function bash(
  command: string,
  status: ExecutionStatus,
  isError?: boolean,
  background = false,
): ExecutionNode {
  return node({
    toolName: 'Bash',
    status,
    toolInput: { command, ...(background ? { run_in_background: true } : {}) },
    ...(isError === undefined ? {} : { isError }),
  });
}

describe('collectTurnTests', () => {
  it('walks roots and agent subtrees depth-first, counting each node once', () => {
    const first = bash('npm test', 'complete', false);
    const nested = bash('pytest', 'error', true);
    const shared = bash('go test ./...', 'complete', false);
    const roots = [
      node({ id: 'root', type: 'message' }, [
        first,
        node({ id: 'agent', type: 'agent' }, [nested, shared]),
      ]),
      shared,
    ];

    expect(collectTurnTests(roots, { finalized: true })).toEqual([
      { command: 'npm test', outcome: 'passed' },
      { command: 'pytest', outcome: 'failed' },
      { command: 'go test ./...', outcome: 'passed' },
    ]);
  });

  it.each([
    ['complete', false, false, 'passed'],
    ['complete', true, false, 'failed'],
    ['error', false, false, 'passed'],
    ['error', true, false, 'failed'],
    ['complete', undefined, false, 'unknown'],
    ['error', undefined, false, 'unknown'],
    ['pending', false, false, 'unknown'],
    ['streaming', false, false, 'unknown'],
    ['interrupted', false, false, 'unknown'],
    ['resumed', false, false, 'unknown'],
    ['complete', false, true, 'passed'],
    ['streaming', false, true, 'running'],
  ] as const)(
    'maps %s with isError=%s and background=%s to %s',
    (status, isError, background, outcome) => {
      expect(
        collectTurnTests([bash('npm test', status, isError, background)], {
          finalized: true,
        }),
      ).toEqual([{ command: 'npm test', outcome }]);
    },
  );

  it.each(['npm test | tee log', 'npm test || true'])(
    'marks a test command with a masked exit code as unknown',
    (command) => {
      expect(
        collectTurnTests([bash(command, 'complete', false)], {
          finalized: true,
        }),
      ).toEqual([{ command, outcome: 'unknown' }]);
    },
  );

  it('ignores non-Bash, malformed, and non-test tool nodes', () => {
    expect(
      collectTurnTests(
        [
          node({ toolName: 'Read', toolInput: { command: 'npm test' } }),
          node({ toolName: 'Bash', toolInput: {} }),
          bash('npm run build', 'complete', false),
        ],
        { finalized: false },
      ),
    ).toEqual([]);
  });

  it('does not mark a zero-failure summary as failed', () => {
    const command = 'npm test';
    const result = collectTurnTests(
      [{ ...bash(command, 'complete', false), toolOutput: 'Tests: 0 failed, 5 passed' }],
      { finalized: true },
    );
    expect(result).toEqual([{ command, outcome: 'passed' }]);
  });

  it.each([
    [
      'the Node spec reporter',
      `> node --test sum.test.js

ok 1 test passed
✔ sum.test.js (99.1006ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 107.0612`,
    ],
    [
      'the Node TAP reporter',
      `TAP version 13
# tests 1
# suites 0
# pass 1
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 107.0612`,
    ],
  ])('recognizes a completed Bash run using %s', (_reporter, toolOutput) => {
    const command = 'npm test';
    expect(
      collectTurnTests([{ ...bash(command, 'complete'), toolOutput }], {
        finalized: true,
      }),
    ).toEqual([{ command, outcome: 'passed' }]);
  });

  it('keeps a failed Node test runner summary failed when it also reports passes', () => {
    const command = 'npm test';
    const toolOutput = `ℹ pass 1
ℹ fail 1`;
    expect(
      collectTurnTests([{ ...bash(command, 'complete'), toolOutput }], {
        finalized: true,
      }),
    ).toEqual([{ command, outcome: 'failed' }]);
  });

  it('marks a Node test runner summary with cancelled tests failed', () => {
    const command = 'npm test';
    const toolOutput = `ℹ pass 3
ℹ fail 0
ℹ cancelled 1`;
    expect(
      collectTurnTests([{ ...bash(command, 'complete'), toolOutput }], {
        finalized: true,
      }),
    ).toEqual([{ command, outcome: 'failed' }]);
  });

  it('does not record a running target as passed', () => {
    const command = 'npx nx test app';
    const result = collectTurnTests(
      [{ ...bash(command, 'streaming', false), toolOutput: 'Running target app:test' }],
      { finalized: false },
    );
    expect(result).toEqual([{ command, outcome: 'unknown' }]);
  });

  it('keeps the command failure when parsed projects only passed', () => {
    const command = 'npx nx test app';
    const result = collectTurnTests(
      [
        {
          ...bash(command, 'complete', true),
          toolOutput: 'Successfully ran target app:test',
        },
      ],
      { finalized: true },
    );
    expect(result).toEqual([
      { command, project: 'app:test', outcome: 'passed' },
      { command, outcome: 'failed' },
    ]);
  });

  it('does not let partial success output override an active command', () => {
    const command = 'npx nx test app';
    const result = collectTurnTests(
      [
        {
          ...bash(command, 'streaming', false),
          toolOutput: 'Successfully ran target app:test',
        },
      ],
      { finalized: false },
    );
    expect(result).toEqual([{ command, outcome: 'unknown' }]);
  });

  it('does not treat prose after a running-target line as an Nx failure summary', () => {
    const command = 'npx nx test app';
    const result = collectTurnTests(
      [
        {
          ...bash(command, 'complete', false),
          toolOutput:
            'Running targets app:test\nThis passing test documents a failed retry.',
        },
      ],
      { finalized: true },
    );

    expect(result).toEqual([{ command, outcome: 'passed' }]);
  });
});

describe('summarizeTurnTests', () => {
  it('counts each outcome', () => {
    expect(
      summarizeTurnTests([
        { command: 'npm test', outcome: 'passed' },
        { command: 'pytest', outcome: 'failed' },
        { command: 'go test', outcome: 'unknown' },
      ]),
    ).toEqual({ total: 3, passed: 1, failed: 1, running: 0, unknown: 1 });
  });

  it('uses Nx and Jest output, including individual target failures', () => {
    const command = 'npx nx run-many -t test -p cli,rpc';
    const result = collectTurnTests(
      [bash(command, 'complete', false)].map((entry) => ({
        ...entry,
        toolOutput:
          'Successfully ran target cli:test\nFailed tasks:\n- rpc:test\nFAIL rpc.spec.ts',
      })),
      { finalized: true },
    );
    expect(result).toEqual([
      { command, project: 'cli:test', outcome: 'passed' },
      {
        command,
        project: 'rpc:test',
        outcome: 'failed',
        failures: ['rpc.spec.ts'],
      },
    ]);
  });

  it('does not extract lowercase fail prose as a Jest failure marker', () => {
    const command = 'npm test';
    const result = collectTurnTests(
      [
        {
          ...bash(command, 'complete', true),
          toolOutput: 'expected request to fail with 401',
        },
      ],
      { finalized: true },
    );

    expect(result).toEqual([{ command, outcome: 'failed' }]);
  });
});
