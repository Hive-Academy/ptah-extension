import { AgentId, type AgentProcessInfo } from '@ptah-extension/shared';
import { LaneResumeError } from './lane-resumer.port';
import { SystemCliLaneResumer } from './system-cli-lane-resumer';

const AGENT_ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000101');
const NEW_AGENT_ID = AgentId.from('aaaaaaaa-bbbb-4ccc-8ddd-000000000102');
const info: AgentProcessInfo = {
  agentId: AGENT_ID,
  cli: 'codex',
  task: 'original',
  workingDirectory: '/worktree',
  status: 'completed',
  startedAt: '2026-11-07T00:00:00.000Z',
  cliSessionId: 'cli-session',
  parentSessionId: 'parent-session',
  effectivePolicy: { permission: 'plan', network: 'deny' },
};

describe('SystemCliLaneResumer', () => {
  it('keeps the parent and marks the previous agent on resume', async () => {
    const releaseIdleForResume = jest.fn(async () => undefined);
    const spawn = jest.fn(async () => ({
      agentId: NEW_AGENT_ID,
      cli: 'codex' as const,
      status: 'running' as const,
      startedAt: '2026-11-07T00:01:00.000Z',
      cliSessionId: 'cli-session',
    }));
    const resumer = new SystemCliLaneResumer({ spawn, releaseIdleForResume });

    await expect(resumer.resume(info, 'continue')).resolves.toMatchObject({
      agentId: NEW_AGENT_ID,
      cliSessionId: 'cli-session',
    });
    expect(releaseIdleForResume).toHaveBeenCalledWith(AGENT_ID);
    expect(spawn).toHaveBeenCalledWith({
      cli: 'codex',
      task: 'continue',
      workingDirectory: '/worktree',
      resumeSessionId: 'cli-session',
      parentSessionId: 'parent-session',
      ptahCliId: undefined,
      resumedFromAgentId: AGENT_ID,
      permission: 'plan',
      network: 'deny',
    });
  });

  it('raises LaneResumeError when the spawn fails', async () => {
    const resumer = new SystemCliLaneResumer({
      releaseIdleForResume: jest.fn(async () => undefined),
      spawn: jest.fn(async () => {
        throw new Error('provider unavailable');
      }),
    });

    const failure = resumer.resume(info, 'continue');
    await expect(failure).rejects.toBeInstanceOf(LaneResumeError);
    await expect(failure).rejects.toMatchObject({
      code: 'spawn-failed',
      message: 'provider unavailable',
    });
  });

  it('raises a no-session LaneResumeError before release or spawn', async () => {
    const releaseIdleForResume = jest.fn(async () => undefined);
    const spawn = jest.fn();
    const resumer = new SystemCliLaneResumer({ spawn, releaseIdleForResume });

    await expect(
      resumer.resume({ ...info, cliSessionId: undefined }, 'continue'),
    ).rejects.toMatchObject({ code: 'no-session' });
    expect(releaseIdleForResume).not.toHaveBeenCalled();
    expect(spawn).not.toHaveBeenCalled();
  });
});
