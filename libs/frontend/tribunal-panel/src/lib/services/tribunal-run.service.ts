import { Injectable, inject } from '@angular/core';
import {
  ClaudeRpcService,
  VSCodeService,
  ModelStateService,
  EffortStateService,
} from '@ptah-extension/core';
import { SurfaceId, TabId } from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import { TribunalSurfaceService } from './tribunal-surface.service';
import { TribunalStateService } from './tribunal-state.service';
import type { TribunalMove, VendorLane } from '../types/tribunal-ui.types';

const MOVE_PHRASE: Record<TribunalMove, string> = {
  council: 'Convene a Tribunal Council',
  forge: 'Convene a Tribunal Forge',
  race: 'Convene a Tribunal Race',
};

const MOVE_FRAMING: Record<TribunalMove, string> = {
  council:
    'Council: each panelist weighs in independently, then synthesize a single cited verdict.',
  forge:
    'Forge: each panelist implements the objective in its own worktree, then cross-review the diffs.',
  race: 'Race: panelists compete on the objective; score the results against a rubric and rank them.',
};

const FULL_AUTO_DIRECTIVE =
  'Do NOT call AskUserQuestion. Run fully autonomously and make reasonable assumptions; state assumptions inline rather than asking.';

@Injectable()
export class TribunalRunService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly modelState = inject(ModelStateService);
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly surface = inject(TribunalSurfaceService);
  private readonly state = inject(TribunalStateService);

  async launch(
    move: TribunalMove,
    lanes: readonly VendorLane[],
    objective: string,
  ): Promise<boolean> {
    const trimmedObjective = objective.trim();
    if (trimmedObjective.length === 0 || lanes.length === 0) {
      return false;
    }
    const correlationId = TabId.create();
    const surfaceId = SurfaceId.create();

    this.claims.claim(correlationId as string, surfaceId);
    this.surface.registerSurface(surfaceId);

    this.state.setMove(move);
    this.state.setLanes(lanes);
    this.state.buildTilesForRun(move, lanes);
    this.state.setSurfaceId(surfaceId);
    this.state.setPhase('fan');

    const workspacePath = this.vscode.config().workspaceRoot;
    const model = this.modelState.currentModel();
    const effort = this.effortState.currentEffort();
    const prompt = this.buildTribunalPrompt(move, lanes, trimmedObjective);

    try {
      const result = await this.rpc.call('chat:start', {
        prompt,
        tabId: correlationId as string,
        name: `Tribunal: ${move}`,
        surfaceMode: true,
        ...(workspacePath ? { workspacePath } : {}),
        options: {
          ...(model ? { model } : {}),
          ...(effort ? { effort } : {}),
        },
      });

      const ok = result.isSuccess() && result.data?.success !== false;
      if (!ok) {
        this.rollback();
        console.error(
          '[TribunalRunService] chat:start failed:',
          result.data?.error ?? result.error,
        );
        return false;
      }
      this.state.refreshSessionId();
      return true;
    } catch (error: unknown) {
      this.rollback();
      console.error(
        '[TribunalRunService] chat:start threw:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  private rollback(): void {
    this.surface.teardown();
    this.state.reset();
  }

  private buildTribunalPrompt(
    move: TribunalMove,
    lanes: readonly VendorLane[],
    objective: string,
  ): string {
    const laneLines = lanes
      .map((lane) => {
        const model = lane.model ? ` (${lane.model})` : '';
        return `  [tribunal:${lane.laneId}] Vendor: ${lane.displayName}${model}. ${objective}`;
      })
      .join('\n');

    return [
      `${MOVE_PHRASE[move]}. You are the Tribunal conductor running FULLY AUTONOMOUSLY.`,
      '',
      `Objective: ${objective}`,
      '',
      MOVE_FRAMING[move],
      '',
      'Spawn EXACTLY one Task sub-agent per panelist below. For EACH panelist, the FIRST line of the sub-agent task you pass to the Task tool MUST be the literal tag shown, with nothing before it:',
      '',
      laneLines,
      '',
      'Rules:',
      `- ${FULL_AUTO_DIRECTIVE}`,
      '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.',
      `- ${FULL_AUTO_DIRECTIVE}`,
    ].join('\n');
  }
}
