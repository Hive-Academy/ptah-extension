import type { AgentProcessInfo, SpawnAgentRequest, SpawnAgentResult } from '@ptah-extension/shared';
import type { AgentProcessManager } from '../agent-process-manager.service';

/** Explicit resume and cold message sends share the manager's resume gate. */
export class AgentLaneResumeService {
  constructor(private readonly manager: Pick<AgentProcessManager, 'spawn' | 'prepareSdkHandleSpawn'>) {}

  resume(info: AgentProcessInfo, task: string): Promise<SpawnAgentResult> {
    if (!info.cliSessionId) throw new Error('No CLI session is available for resume.');
    return this.resumeRequest({
      cli: info.cli,
      task,
      workingDirectory: info.workingDirectory,
      resumeSessionId: info.cliSessionId,
      parentSessionId: info.parentSessionId,
      ptahCliId: info.ptahCliId,
    });
  }

  resumeRequest(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    if (!request.resumeSessionId) throw new Error('No CLI session is available for resume.');
    return this.manager.spawn(request);
  }

  prepareSdkResume(
    request: Parameters<AgentProcessManager['prepareSdkHandleSpawn']>[0],
  ): ReturnType<AgentProcessManager['prepareSdkHandleSpawn']> {
    if (!request.resumeSessionId) throw new Error('No CLI session is available for resume.');
    return this.manager.prepareSdkHandleSpawn(request);
  }
}
