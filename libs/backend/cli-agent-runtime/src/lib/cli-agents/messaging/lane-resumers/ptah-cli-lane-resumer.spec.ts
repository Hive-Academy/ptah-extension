import 'reflect-metadata';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import {
  AgentId,
  type AgentProcessInfo,
  type SpawnAgentResult,
} from '@ptah-extension/shared';
import type { Logger } from '@ptah-extension/vscode-core';
import type { SdkHandle } from '../../cli-adapters';
import type { PtahCliRegistry } from '../../../ptah-cli/ptah-cli-registry';
import { manifestFixture } from '../../testing/manifest.fixture';
import { AgentLaneResumeService } from '../agent-lane-resume.service';
import { LaneResumeError } from './lane-resumer.port';
import {
  PtahCliLaneResumer,
  type PtahCliLaneResumerManager,
} from './ptah-cli-lane-resumer';

const OLD_AGENT_ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000201');
const NEW_AGENT_ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000202');
const info: AgentProcessInfo = {
  agentId: OLD_AGENT_ID,
  cli: 'ptah-cli',
  task: 'original',
  workingDirectory: '/worktree',
  status: 'completed',
  startedAt: '2026-11-07T00:00:00.000Z',
  cliSessionId: 'cli-session',
  parentSessionId: 'parent-session',
  ptahCliId: 'ptah-config',
};

function harness() {
  const onSessionResolved = jest.fn();
  const handle: SdkHandle = {
    abort: new AbortController(),
    done: new Promise<number>(() => undefined),
    onOutput: jest.fn(),
    onSessionResolved,
  };
  const spawned: SpawnAgentResult = {
    agentId: NEW_AGENT_ID,
    cli: 'ptah-cli',
    status: 'running',
    startedAt: '2026-11-07T00:01:00.000Z',
    cliSessionId: 'cli-session',
  };
  const manager: PtahCliLaneResumerManager = {
    prepareSdkHandleSpawn: jest.fn(async () => ({
      task: 'prepared task',
      resumeSessionId: 'cli-session',
    })),
    reserveAgentId: jest.fn(() => NEW_AGENT_ID),
    spawnFromSdkHandle: jest.fn(async () => spawned),
  };
  const setAgentId = jest.fn();
  const registry: Pick<PtahCliRegistry, 'spawnAgent' | 'getMcpPort'> = {
    spawnAgent: jest.fn(async () => ({
      handle,
      agentName: 'Researcher',
      setAgentId,
      potentialCapabilities: manifestFixture(),
      effectivePolicy: {},
    })),
    getMcpPort: jest.fn(() => 4321),
  };
  const sessionMetadata = {
    createChild: jest.fn(
      () =>
        new Promise<Awaited<ReturnType<SessionMetadataStore['createChild']>>>(
          () => undefined,
        ),
    ),
  } as Pick<SessionMetadataStore, 'createChild'>;
  const logger: Pick<Logger, 'warn'> = {
    warn: jest.fn(),
  };
  const resumer = new PtahCliLaneResumer(
    manager,
    registry,
    sessionMetadata,
    logger,
  );
  return { handle, onSessionResolved, manager, registry, sessionMetadata, setAgentId, resumer, spawned };
}

describe('PtahCliLaneResumer', () => {
  it('runs the registry resume sequence with parent and previous agent identity', async () => {
    const h = harness();

    await expect(h.resumer.resume(info, 'continue')).resolves.toBe(h.spawned);
    expect(h.manager.prepareSdkHandleSpawn).toHaveBeenCalledWith({
      cli: 'ptah-cli',
      task: 'continue',
      resumeSessionId: 'cli-session',
    });
    expect(h.registry.spawnAgent).toHaveBeenCalledWith(
      'ptah-config',
      'prepared task',
      {
        workingDirectory: '/worktree',
        resumeSessionId: 'cli-session',
        parentSessionId: 'parent-session',
        agentId: NEW_AGENT_ID,
      },
    );
    expect(h.manager.spawnFromSdkHandle).toHaveBeenCalledWith(
      h.handle,
      expect.objectContaining({
        parentSessionId: 'parent-session',
        resumedFromAgentId: OLD_AGENT_ID,
        ptahCliId: 'ptah-config',
        agentId: NEW_AGENT_ID,
        mcpPort: 4321,
        expectsMcp: true,
      }),
    );
    expect(h.setAgentId).toHaveBeenCalledWith(NEW_AGENT_ID);
  });

  it('keeps child metadata creation on session resolution', async () => {
    const h = harness();
    await h.resumer.resume(info, 'continue');
    const callback = h.onSessionResolved.mock.calls[0]?.[0] as
      | ((sessionId: string) => void)
      | undefined;
    if (!callback) throw new Error('session callback not registered');

    callback('resolved-sdk-session');
    expect(h.sessionMetadata.createChild).toHaveBeenCalledWith(
      'resolved-sdk-session',
      '/worktree',
      'Researcher',
    );
  });

  it('raises LaneResumeError for a registry refusal', async () => {
    const h = harness();
    h.registry.spawnAgent = jest.fn(async () => ({
      status: 'disabled' as const,
      message: 'agent disabled',
    }));

    const failure = h.resumer.resume(info, 'continue');
    await expect(failure).rejects.toBeInstanceOf(LaneResumeError);
    await expect(failure).rejects.toMatchObject({
      code: 'spawn-failed',
      message: 'Ptah CLI agent resume failed: agent disabled',
    });
    expect(h.manager.spawnFromSdkHandle).not.toHaveBeenCalled();
  });

  it('routes service resumes and explicit RPC resumes through this resumer', async () => {
    const h = harness();
    const service = new AgentLaneResumeService(
      {
        spawn: jest.fn(),
        prepareSdkHandleSpawn: h.manager.prepareSdkHandleSpawn,
        releaseIdleForResume: jest.fn(async () => undefined),
      },
      h.resumer,
    );

    await expect(service.resume(info, 'continue')).resolves.toBe(h.spawned);
    await expect(
      service.resumePtahCli(
        {
          cliSessionId: 'cli-session',
          cli: 'ptah-cli',
          task: 'RPC continue',
          parentSessionId: 'parent-session',
          ptahCliId: 'ptah-config',
          previousAgentId: OLD_AGENT_ID,
        },
        '/worktree',
      ),
    ).resolves.toBe(h.spawned);
    expect(h.registry.spawnAgent).toHaveBeenCalledTimes(2);
  });
});
