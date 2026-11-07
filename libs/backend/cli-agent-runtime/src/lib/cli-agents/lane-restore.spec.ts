import {
  AgentId,
  normalizeWorkspaceRoot,
  type AgentProcessInfo,
  type CliSessionReference,
} from '@ptah-extension/shared';
import {
  restoreLaneIdentity,
  restoreLaneLifecycle,
  stampWorkspaceKey,
} from './lane-restore';
import { manifestFixture } from './testing/manifest.fixture';

const AGENT_ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000301');
const info: AgentProcessInfo = {
  agentId: AGENT_ID,
  cli: 'ptah-cli',
  task: 'work',
  workingDirectory: '/workspace/root/worktree-a',
  status: 'running',
  startedAt: '2026-11-07T00:00:00.000Z',
};

function ref(overrides: Partial<CliSessionReference> = {}): CliSessionReference {
  return {
    cliSessionId: 'cli-session',
    cli: 'ptah-cli',
    agentId: AGENT_ID,
    task: 'work',
    startedAt: '2026-11-07T00:00:00.000Z',
    status: 'completed',
    completedAt: '2026-11-07T00:01:00.000Z',
    lastActivityAt: '2026-11-07T00:00:30.000Z',
    ...overrides,
  };
}

describe('restoreLaneIdentity', () => {
  it('restores parent, manifest, Ptah CLI identity and workspace beside lifecycle', () => {
    const reference = ref({
      ptahCliId: 'ptah-config',
      workspaceKey: '/workspace/root',
      potentialCapabilities: manifestFixture(),
      stopReason: 'auth',
    });

    expect(restoreLaneIdentity(reference, 'parent-session')).toEqual({
      parentSessionId: 'parent-session',
      potentialCapabilities: reference.potentialCapabilities,
      ptahCliId: 'ptah-config',
      workspaceKey: '/workspace/root',
    });
    expect(restoreLaneIdentity(reference, 'parent-session')).not.toHaveProperty(
      'status',
    );
    expect(restoreLaneLifecycle(reference, '2026-11-07T00:02:00.000Z')).toEqual({
      status: 'completed',
      completedAt: '2026-11-07T00:01:00.000Z',
      lastActivityAt: '2026-11-07T00:00:30.000Z',
      stopReason: 'auth',
    });
  });

  it('restores a positive finite stopResetAt with the lifecycle fields and omits invalid values', () => {
    const withReset = ref({
      status: 'stopped',
      stopReason: 'usage-limit',
      stopResetAt: 1_762_000_000_000,
    });
    expect(restoreLaneLifecycle(withReset, '2026-11-07T00:02:00.000Z')).toEqual({
      status: 'stopped',
      completedAt: '2026-11-07T00:01:00.000Z',
      lastActivityAt: '2026-11-07T00:00:30.000Z',
      stopReason: 'usage-limit',
      stopResetAt: 1_762_000_000_000,
    });

    const withZeroReset = ref({
      status: 'stopped',
      stopReason: 'usage-limit',
      stopResetAt: 0,
    });
    expect(
      restoreLaneLifecycle(withZeroReset, '2026-11-07T00:02:00.000Z'),
    ).not.toHaveProperty('stopResetAt');
  });
});

describe('stampWorkspaceKey', () => {
  it('normalizes the caller scope for two different worktrees', () => {
    const environment = {
      scopedWorkspaceRoot: () => 'C:\\Workspace\\Root',
    };
    const first = stampWorkspaceKey(info, environment);
    const second = stampWorkspaceKey(
      { ...info, workingDirectory: 'C:\\Workspace\\Root\\worktree-b' },
      environment,
    );

    expect(first.workspaceKey).toBe(normalizeWorkspaceRoot('C:\\Workspace\\Root'));
    expect(second.workspaceKey).toBe(first.workspaceKey);
  });

  it('leaves workspaceKey absent without a caller scope', () => {
    expect(
      stampWorkspaceKey(info, { scopedWorkspaceRoot: () => undefined }),
    ).not.toHaveProperty('workspaceKey');
  });

  it('inherits the original key instead of using a new caller scope', () => {
    const previous = { ...info, workspaceKey: '/workspace/original' };
    const resumed = stampWorkspaceKey(
      { ...info, agentId: AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000302') },
      { scopedWorkspaceRoot: () => '/workspace/other' },
      previous,
    );

    expect(resumed.workspaceKey).toBe('/workspace/original');
  });

  it('does not invent a key when the original resumed lane has none', () => {
    const resumed = stampWorkspaceKey(
      info,
      { scopedWorkspaceRoot: () => '/workspace/other' },
      info,
    );

    expect(resumed).not.toHaveProperty('workspaceKey');
  });
});
