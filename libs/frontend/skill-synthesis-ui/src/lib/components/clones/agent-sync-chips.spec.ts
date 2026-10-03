import type {
  HarnessFacetSupport,
  HarnessHealth,
  HarnessTargetHealth,
  HarnessTargetId,
} from '@ptah-extension/shared';

import { agentSyncChip, agentSyncChips } from './agent-sync-chips';

function target(
  id: HarnessTargetId,
  overrides: Partial<HarnessTargetHealth> = {},
  agents: HarnessFacetSupport = 'supported',
): HarnessTargetHealth {
  return {
    target: id,
    detected: true,
    facets: {
      skills: 'supported',
      commands: 'supported',
      agents,
      mcp: 'supported',
    },
    expected: 0,
    found: 0,
    missing: [],
    foreign: [],
    writeFailed: [],
    overwrittenLocalEdit: [],
    removed: [],
    localEdit: [],
    agentsInSync: [],
    durationMs: 1,
    ...overrides,
  };
}

function health(targets: HarnessTargetHealth[]): HarnessHealth {
  return {
    workspaceRoot: '/ws',
    generatedAt: '2026-10-03T00:00:00.000Z',
    mode: 'preflight',
    reason: 'test',
    sources: 'ok',
    targets,
    collisions: [],
  };
}

/**
 * The task-description risk-table fixture: one agent missing on Codex and
 * hand-edited on OpenCode, plus an undetected Cursor. Copilot holds the only
 * in-sync copy, so a chip that read "in sync" from the absence of a problem
 * would show up on Codex or OpenCode.
 */
const RISK_TABLE = health([
  target('claude', {}, 'source-managed'),
  target('codex', { missing: ['.codex/agents/reviewer.toml'] }),
  target('copilot', { agentsInSync: ['.github/agents/reviewer.agent.md'] }),
  target('cursor', { detected: false }),
  target('opencode', { localEdit: ['.opencode/agent/reviewer.md'] }),
  target('antigravity', {}, 'unsupported'),
  target('vscode', {}, 'unsupported'),
]);

describe('agentSyncChips', () => {
  it('maps the risk-table fixture to exact chips, in display order', () => {
    expect(
      agentSyncChips(RISK_TABLE, 'reviewer').map((chip) => [
        chip.target,
        chip.state,
        chip.label,
        chip.path,
      ]),
    ).toEqual([
      ['claude', 'source', 'source', null],
      ['codex', 'missing', 'missing', '.codex/agents/reviewer.toml'],
      ['copilot', 'in-sync', 'in sync', '.github/agents/reviewer.agent.md'],
      ['cursor', 'not-detected', 'not detected', '.cursor/agents/reviewer.md'],
      ['opencode', 'edited', 'edited', '.opencode/agent/reviewer.md'],
      ['antigravity', 'unsupported', 'unsupported', null],
    ]);
  });

  it('never shows a chip for vscode, which has no agent concept', () => {
    expect(
      agentSyncChips(RISK_TABLE, 'reviewer').some((c) => c.target === 'vscode'),
    ).toBe(false);
  });

  it('attributes paths to the right slug: another agent on the same report is untouched', () => {
    const states = agentSyncChips(RISK_TABLE, 'planner').map((c) => c.state);
    expect(states).toEqual([
      'source',
      'not-synced',
      'not-synced',
      'not-detected',
      'not-synced',
      'unsupported',
    ]);
  });

  it('an undetected cursor says not detected even when its path is listed as in sync or missing', () => {
    const report = health([
      target('cursor', {
        detected: false,
        missing: ['.cursor/agents/reviewer.md'],
        agentsInSync: ['.cursor/agents/reviewer.md'],
      }),
    ]);
    expect(agentSyncChip(report, 'cursor', 'reviewer').state).toBe(
      'not-detected',
    );
  });

  it('is unknown for every target before any report exists', () => {
    expect(
      agentSyncChips(null, 'reviewer').every((c) => c.state === 'unknown'),
    ).toBe(true);
  });

  it('is unknown for a target the report does not mention', () => {
    expect(
      agentSyncChip(health([target('codex')]), 'cursor', 'reviewer').state,
    ).toBe('unknown');
  });

  it('not detected wins over source for an undetected Claude', () => {
    const report = health([
      target('claude', { detected: false }, 'source-managed'),
    ]);
    expect(agentSyncChip(report, 'claude', 'reviewer').state).toBe(
      'not-detected',
    );
  });

  it('carries the writeFailed reason, and failed wins over edited, missing and in sync', () => {
    const path = '.codex/agents/reviewer.toml';
    const report = health([
      target('codex', {
        writeFailed: [{ relPath: path, reason: 'EACCES: permission denied' }],
        localEdit: [path],
        missing: [path],
        agentsInSync: [path],
      }),
    ]);
    expect(agentSyncChip(report, 'codex', 'reviewer')).toEqual({
      target: 'codex',
      state: 'failed',
      label: 'failed',
      path,
      reason: 'EACCES: permission denied',
    });
  });

  it('edited wins over missing, and missing wins over in sync', () => {
    const path = '.codex/agents/reviewer.toml';
    const edited = health([
      target('codex', { localEdit: [path], missing: [path] }),
    ]);
    const missing = health([
      target('codex', { missing: [path], agentsInSync: [path] }),
    ]);
    expect(agentSyncChip(edited, 'codex', 'reviewer').state).toBe('edited');
    expect(agentSyncChip(missing, 'codex', 'reviewer').state).toBe('missing');
  });

  it('shows in sync ONLY from agentsInSync: a clean report without it is not synced', () => {
    const report = health([
      target('opencode', { agentsInSync: undefined, localEdit: undefined }),
    ]);
    const chip = agentSyncChip(report, 'opencode', 'reviewer');
    expect(chip.state).toBe('not-synced');
    expect(chip.label).toBe('not synced');
    expect(chip.reason).toBeUndefined();
  });

  it('a provider that carries no agents is unsupported even when detected', () => {
    const report = health([target('codex', {}, 'unsupported')]);
    expect(agentSyncChip(report, 'codex', 'reviewer').state).toBe(
      'unsupported',
    );
  });
});
