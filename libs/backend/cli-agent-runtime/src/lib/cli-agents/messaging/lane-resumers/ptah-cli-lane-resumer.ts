import type {
  AgentProcessInfo,
  CliType,
  LaneNetworkMode,
  LanePermissionMode,
  SpawnAgentResult,
} from '@ptah-extension/shared';
import type { SessionMetadataStore } from '@ptah-extension/agent-sdk';
import type { Logger } from '@ptah-extension/vscode-core';
import type { AgentProcessManager } from '../../agent-process-manager.service';
import { LaneAccountResumeError } from '../../lane-resume-gate';
import type { PtahCliRegistry } from '../../../ptah-cli/ptah-cli-registry';
import {
  LaneResumeError,
  type LaneResumer,
  type LaneResumeResult,
} from './lane-resumer.port';

export interface PtahCliResumeParams {
  readonly cliSessionId: string;
  readonly cli: CliType;
  readonly task: string;
  readonly parentSessionId?: string;
  readonly ptahCliId: string;
  readonly previousAgentId?: string;
  /** The lane's saved policy; a resume keeps the permission and network it ran under. */
  readonly permission?: LanePermissionMode;
  readonly network?: LaneNetworkMode;
}

export type PtahCliLaneResumerManager = Pick<
  AgentProcessManager,
  'prepareSdkHandleSpawn' | 'reserveAgentId' | 'spawnFromSdkHandle'
>;

/** Owns the registry-backed Ptah CLI resume sequence for RPC and cold sends. */
export class PtahCliLaneResumer implements LaneResumer {
  constructor(
    private readonly manager: PtahCliLaneResumerManager,
    private readonly registry: Pick<
      PtahCliRegistry,
      'spawnAgent' | 'getMcpPort'
    >,
    private readonly sessionMetadata: Pick<SessionMetadataStore, 'createChild'>,
    private readonly logger: Pick<Logger, 'warn'>,
  ) {}

  resume(info: AgentProcessInfo, task: string): Promise<LaneResumeResult> {
    if (!info.cliSessionId) {
      throw new LaneResumeError(
        'no-session',
        'No CLI session is available for resume.',
      );
    }
    if (!info.ptahCliId) {
      throw new LaneResumeError(
        'spawn-failed',
        'No Ptah CLI agent id is available for resume.',
      );
    }
    return this.resumePtahCli(
      {
        cliSessionId: info.cliSessionId,
        cli: info.cli,
        task,
        parentSessionId: info.parentSessionId,
        ptahCliId: info.ptahCliId,
        previousAgentId: info.agentId,
        permission: info.effectivePolicy?.permission,
        network: info.effectivePolicy?.network,
      },
      info.workingDirectory,
    );
  }

  async resumePtahCli(
    params: PtahCliResumeParams,
    workspaceRoot: string,
  ): Promise<SpawnAgentResult> {
    try {
      const parentSessionId = params.parentSessionId || undefined;
      const prepared = await this.manager.prepareSdkHandleSpawn({
        cli: 'ptah-cli',
        task: params.task,
        resumeSessionId: params.cliSessionId,
      });
      const agentId = this.manager.reserveAgentId();
      const spawnResult = await this.registry.spawnAgent(
        params.ptahCliId,
        prepared.task,
        {
          workingDirectory: workspaceRoot,
          resumeSessionId: prepared.resumeSessionId,
          parentSessionId,
          agentId,
          ...(params.permission ? { permission: params.permission } : {}),
          ...(params.network ? { network: params.network } : {}),
        },
      );
      if ('status' in spawnResult) {
        throw new LaneResumeError(
          'spawn-failed',
          `Ptah CLI agent resume failed: ${spawnResult.message}`,
        );
      }

      spawnResult.handle.onSessionResolved?.((sessionId: string) => {
        this.sessionMetadata
          .createChild(sessionId, workspaceRoot, spawnResult.agentName)
          .catch((error: unknown) => {
            this.logger.warn('[PtahCliLaneResumer] Failed to save child session metadata', {
              error: error instanceof Error ? error.message : String(error),
            });
          });
      });

      const result = await this.manager.spawnFromSdkHandle(spawnResult.handle, {
        task: params.task,
        cli: 'ptah-cli',
        workingDirectory: workspaceRoot,
        parentSessionId,
        ptahCliName: spawnResult.agentName,
        ptahCliId: params.ptahCliId,
        resumedFromAgentId: params.previousAgentId,
        resumeSessionId: prepared.resumeSessionId,
        ...(prepared.resumeDecision
          ? { resumeDecision: prepared.resumeDecision }
          : {}),
        ...(prepared.originalTask !== undefined
          ? { originalTask: prepared.originalTask }
          : {}),
        agentId,
        mcpPort: this.registry.getMcpPort(),
        expectsMcp: true,
        // Stored on the new record, so the next resume keeps the same policy.
        effectivePolicy: spawnResult.effectivePolicy,
      });
      spawnResult.setAgentId(result.agentId);
      return result;
    } catch (error: unknown) {
      if (
        error instanceof LaneResumeError ||
        error instanceof LaneAccountResumeError
      ) {
        throw error;
      }
      throw new LaneResumeError(
        'spawn-failed',
        error instanceof Error ? error.message : String(error),
      );
    }
  }
}
