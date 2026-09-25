/**
 * coverage specs: columns in `TARGET_LABELS` order from rows and detected
 * harness targets, per-target cells (`configured`, `declared-by-cli`, `none`),
 * and the single merged "Ptah sessions" cell for connections and connectors
 * (A5: only the Claude Agent SDK session receives `mcpServersOverride`).
 */

import type {
  HarnessTargetHealth,
  HarnessTargetId,
  McpInstallTarget,
} from '@ptah-extension/shared';
import {
  PTAH_SESSIONS_LABEL,
  buildCoverageMatrix,
  type CoverageCells,
} from './coverage';
import type { ProviderRow, ProviderTarget } from './provider-row';

const LABELS: Readonly<Record<McpInstallTarget, string>> = {
  vscode: 'VS Code',
  claude: 'Claude Code',
  cursor: 'Cursor',
  copilot: 'Copilot CLI',
  codex: 'Codex CLI',
  antigravity: 'Antigravity CLI',
  opencode: 'OpenCode',
};

function configured(...ids: McpInstallTarget[]): ProviderTarget[] {
  return ids.map((target) => ({
    target,
    label: LABELS[target],
    via: 'configured' as const,
  }));
}

function row(title: string, overrides: Partial<ProviderRow> = {}): ProviderRow {
  return {
    ref: `harness-config:${title}`,
    serverKey: title,
    kind: 'config',
    title,
    brand: null,
    origin: 'harness-config',
    originLabel: 'Config file',
    targets: [],
    status: 'configured',
    statusSource: 'config',
    connection: null,
    removal: { kind: 'uninstall' },
    configSummary: {
      transport: 'stdio',
      command: 'npx',
      args: [],
      envKeys: [],
    },
    configPaths: [],
    ...overrides,
  };
}

function harnessTarget(
  target: HarnessTargetId,
  detected: boolean,
): HarnessTargetHealth {
  return {
    target,
    detected,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents: 'supported',
      mcp: 'supported',
    },
    expected: 0,
    found: 0,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    durationMs: 1,
  };
}

const MERGED: CoverageCells = {
  kind: 'merged',
  cell: 'session-override',
  label: PTAH_SESSIONS_LABEL,
};

/** The brief's connected-servers table, trimmed to one row per shape. */
const ROWS: readonly ProviderRow[] = [
  row('ptah', { targets: configured('antigravity', 'claude', 'codex') }),
  row('firecrawl', { targets: configured('claude', 'vscode') }),
  row('sentry', {
    ref: 'claude-user:sentry',
    origin: 'claude-user',
    originLabel: 'Claude CLI',
    brand: 'sentry',
    targets: [
      { target: 'claude', label: 'Claude Code', via: 'declared-by-cli' },
    ],
  }),
  row('sentry', {
    ref: 'oauth:sentry',
    kind: 'connection',
    origin: 'oauth',
    originLabel: 'OAuth',
    brand: 'sentry',
  }),
  row('exa', {
    ref: 'smithery:exa',
    kind: 'connection',
    origin: 'smithery',
    originLabel: 'Smithery',
  }),
  row('Gmail', {
    ref: 'claude-connector:Gmail',
    kind: 'account-connector',
    origin: 'claude-connector',
    originLabel: 'claude.ai connector',
  }),
];

describe('buildCoverageMatrix', () => {
  it('orders the columns as TARGET_LABELS, keeping only reached targets', () => {
    const matrix = buildCoverageMatrix(ROWS, []);
    expect(matrix.columns).toEqual([
      { target: 'vscode', label: 'VS Code' },
      { target: 'claude', label: 'Claude Code' },
      { target: 'codex', label: 'Codex CLI' },
      { target: 'antigravity', label: 'Antigravity CLI' },
    ]);
  });

  it('adds a column for every detected harness target, never an undetected one', () => {
    const matrix = buildCoverageMatrix(
      [row('only', { targets: configured('claude') })],
      [
        harnessTarget('opencode', true),
        harnessTarget('cursor', true),
        harnessTarget('copilot', false),
      ],
    );
    expect(matrix.columns.map((column) => column.target)).toEqual([
      'claude',
      'cursor',
      'opencode',
    ]);
    expect(matrix.rows[0].coverage).toEqual({
      kind: 'per-target',
      cells: ['configured', 'none', 'none'],
    });
  });

  it.each<[string, CoverageCells]>([
    [
      'harness-config:ptah',
      {
        kind: 'per-target',
        cells: ['none', 'configured', 'configured', 'configured'],
      },
    ],
    [
      'harness-config:firecrawl',
      {
        kind: 'per-target',
        cells: ['configured', 'configured', 'none', 'none'],
      },
    ],
    [
      'claude-user:sentry',
      {
        kind: 'per-target',
        cells: ['none', 'declared-by-cli', 'none', 'none'],
      },
    ],
    ['oauth:sentry', MERGED],
    ['smithery:exa', MERGED],
    ['claude-connector:Gmail', MERGED],
  ])('cells of %s', (ref, coverage) => {
    const matrix = buildCoverageMatrix(ROWS, []);
    expect(matrix.rows.find((entry) => entry.ref === ref)?.coverage).toEqual(
      coverage,
    );
  });

  it('never renders a per-CLI cell for a session-override row', () => {
    const matrix = buildCoverageMatrix(ROWS, []);
    const merged = matrix.rows.filter(
      (entry) => entry.coverage.kind === 'merged',
    );
    expect(merged.map((entry) => entry.ref)).toEqual([
      'oauth:sentry',
      'smithery:exa',
      'claude-connector:Gmail',
    ]);
    expect(PTAH_SESSIONS_LABEL).toBe('Ptah sessions');
  });

  it('keeps row order and presentation fields', () => {
    const matrix = buildCoverageMatrix(ROWS, []);
    expect(
      matrix.rows.map(({ ref, title, brand, originLabel }) => ({
        ref,
        title,
        brand,
        originLabel,
      })),
    ).toEqual(
      ROWS.map(({ ref, title, brand, originLabel }) => ({
        ref,
        title,
        brand,
        originLabel,
      })),
    );
  });

  it('has no columns and no rows for an empty inventory', () => {
    expect(buildCoverageMatrix([], [])).toEqual({ columns: [], rows: [] });
  });
});
