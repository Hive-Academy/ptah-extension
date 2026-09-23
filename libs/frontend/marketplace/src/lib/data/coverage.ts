/**
 * The coverage matrix: which CLI receives which server (implementation plan
 * C5 `coverage`).
 *
 * ## Why connections get one merged "Ptah sessions" cell (A5)
 *
 * Smithery and OAuth servers are not written into any CLI config. They are
 * rebuilt at query time into `mcpServersOverride`, and that map has exactly
 * one producer and one consumer:
 *
 * - produced only by `chat:start`
 *   (`rpc-handlers/.../chat/session/chat-session.service.ts:339-368`, called at
 *   `:536` and passed to `sdkAdapter.startChatSession` at `:571`);
 * - consumed only by the Claude Agent SDK query
 *   (`agent-sdk/.../sdk-agent-adapter.ts:643-726` →
 *   `session-query-executor.service.ts:101,294` →
 *   `sdk-query-options-builder.ts:922-926,967`, merged into `options.mcpServers`).
 *
 * No other CLI (VS Code, Cursor, Copilot, Codex, Antigravity, OpenCode) and no
 * Claude Code run outside Ptah receives it, so a per-CLI cell for these rows
 * would be a claim without evidence. claude.ai account connectors are likewise
 * known only from a Ptah session's report. All three render one merged cell.
 */

import type {
  HarnessTargetHealth,
  McpInstallTarget,
} from '@ptah-extension/shared';
import { mcpTargetLabel } from '@ptah-extension/chat-ui';
import {
  MCP_TARGET_ORDER,
  isMcpInstallTarget,
  type ProviderRow,
} from './provider-row';

/**
 * One cell's state.
 *
 * - `configured`: the target's config file declares the server.
 * - `declared-by-cli`: the CLI's own config declares it (`claude-user` →
 *   the `claude` column).
 * - `session-override`: injected into Ptah sessions only (the merged cell).
 * - `none`: the target does not receive it.
 */
export type CoverageCell =
  'configured' | 'declared-by-cli' | 'session-override' | 'none';

/** The merged cell's text. */
export const PTAH_SESSIONS_LABEL = 'Ptah sessions';

export interface CoverageColumn {
  readonly target: McpInstallTarget;
  readonly label: string;
}

/** A row's cells: one per column, or one merged cell spanning all of them. */
export type CoverageCells =
  | {
      readonly kind: 'per-target';
      /** Aligned with {@link CoverageMatrix.columns}. */
      readonly cells: readonly Exclude<CoverageCell, 'session-override'>[];
    }
  | {
      readonly kind: 'merged';
      readonly cell: 'session-override';
      readonly label: string;
    };

export interface CoverageRow {
  readonly ref: string;
  readonly title: string;
  readonly brand: string | null;
  readonly originLabel: string;
  readonly coverage: CoverageCells;
}

export interface CoverageMatrix {
  readonly columns: readonly CoverageColumn[];
  readonly rows: readonly CoverageRow[];
}

/**
 * Build the matrix. Columns are the targets, in `TARGET_LABELS` order, that
 * any row reaches or that the harness reports as detected. Rows keep the
 * order they were given in.
 */
export function buildCoverageMatrix(
  rows: readonly ProviderRow[],
  harnessTargets: readonly HarnessTargetHealth[],
): CoverageMatrix {
  const present = new Set<McpInstallTarget>();
  for (const row of rows) {
    for (const { target } of row.targets) present.add(target);
  }
  for (const health of harnessTargets) {
    if (health.detected && isMcpInstallTarget(health.target)) {
      present.add(health.target);
    }
  }
  const columns = MCP_TARGET_ORDER.filter((target) => present.has(target)).map(
    (target) => ({ target, label: mcpTargetLabel(target) }),
  );

  return {
    columns,
    rows: rows.map((row) => ({
      ref: row.ref,
      title: row.title,
      brand: row.brand,
      originLabel: row.originLabel,
      coverage: cellsOf(row, columns),
    })),
  };
}

function cellsOf(
  row: ProviderRow,
  columns: readonly CoverageColumn[],
): CoverageCells {
  if (row.kind !== 'config') {
    return {
      kind: 'merged',
      cell: 'session-override',
      label: PTAH_SESSIONS_LABEL,
    };
  }
  return {
    kind: 'per-target',
    cells: columns.map(({ target }) => {
      const reached = row.targets.find((entry) => entry.target === target);
      return reached === undefined ? 'none' : reached.via;
    }),
  };
}
