import { AgentId, type AgentProcessInfo } from '@ptah-extension/shared';
import { AgentLaneResumeService } from './agent-lane-resume.service';

describe('AgentLaneResumeService', () => {
  const info = { agentId: AgentId.create(), cli: 'codex', status: 'completed', task: 'original',
    workingDirectory: '.', cliSessionId: 'session', parentSessionId: 'parent' } as AgentProcessInfo;

  it('uses the manager resume gate and forwards the original session', async () => {
    const spawn = jest.fn().mockResolvedValue({ agentId: AgentId.create() });
    const resume = new AgentLaneResumeService({ spawn, prepareSdkHandleSpawn: jest.fn() });
    await resume.resume(info, 'follow up');
    expect(spawn).toHaveBeenCalledWith(expect.objectContaining({
      cli: 'codex', resumeSessionId: 'session', task: 'follow up', parentSessionId: 'parent',
    }));
  });

  it('refuses a record without a session', () => {
    const spawn = jest.fn();
    const resume = new AgentLaneResumeService({ spawn, prepareSdkHandleSpawn: jest.fn() });
    expect(() => resume.resume({ ...info, cliSessionId: undefined }, 'follow up')).toThrow('No CLI session');
    expect(spawn).not.toHaveBeenCalled();
  });

  it('prepares an explicit Ptah CLI resume through the manager gate', async () => {
    const prepareSdkHandleSpawn = jest.fn().mockResolvedValue({ task: 'follow up', resumeSessionId: 'session' });
    const resume = new AgentLaneResumeService({ spawn: jest.fn(), prepareSdkHandleSpawn });
    await expect(resume.prepareSdkResume({ cli: 'ptah-cli', task: 'follow up', resumeSessionId: 'session' }))
      .resolves.toEqual({ task: 'follow up', resumeSessionId: 'session' });
    expect(prepareSdkHandleSpawn).toHaveBeenCalledWith({
      cli: 'ptah-cli', task: 'follow up', resumeSessionId: 'session',
    });
  });
});
