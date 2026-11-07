import type {
  AgentProcessInfo,
  SpawnAgentRequest,
  SpawnAgentResult,
} from '@ptah-extension/shared';
import type { AgentProcessManager } from '../agent-process-manager.service';
import { LaneResumeError, type LaneResumeResult } from './lane-resumers/lane-resumer.port';
import type {
  PtahCliLaneResumer,
  PtahCliResumeParams,
} from './lane-resumers/ptah-cli-lane-resumer';
import { SystemCliLaneResumer } from './lane-resumers/system-cli-lane-resumer';

/**
 * Explicit resume and cold message sends share the manager's resume gate.
 * Every Ptah CLI lane resumes through the registry-backed resumer, which every
 * host registers; a system CLI lane resumes through the manager's spawn.
 */
export class AgentLaneResumeService {
  private readonly system: SystemCliLaneResumer;

  constructor(
    private readonly manager: Pick<
      AgentProcessManager,
      'spawn' | 'prepareSdkHandleSpawn' | 'releaseIdleForResume'
    >,
    private readonly ptahCli: Pick<PtahCliLaneResumer, 'resume' | 'resumePtahCli'>,
  ) {
    this.system = new SystemCliLaneResumer(manager);
  }

  resume(info: AgentProcessInfo, task: string): Promise<LaneResumeResult> {
    if (info.cli === 'ptah-cli') {
      return this.ptahCli.resume(info, task);
    }
    return this.system.resume(info, task);
  }

  resumeRequest(request: SpawnAgentRequest): Promise<SpawnAgentResult> {
    if (!request.resumeSessionId) {
      throw new LaneResumeError(
        'no-session',
        'No CLI session is available for resume.',
      );
    }
    return this.manager.spawn(request);
  }

  prepareSdkResume(
    request: Parameters<AgentProcessManager['prepareSdkHandleSpawn']>[0],
  ): ReturnType<AgentProcessManager['prepareSdkHandleSpawn']> {
    if (!request.resumeSessionId) {
      throw new LaneResumeError(
        'no-session',
        'No CLI session is available for resume.',
      );
    }
    return this.manager.prepareSdkHandleSpawn(request);
  }

  resumePtahCli(
    params: PtahCliResumeParams,
    workspaceRoot: string,
  ): Promise<SpawnAgentResult> {
    return this.ptahCli.resumePtahCli(params, workspaceRoot);
  }
}
