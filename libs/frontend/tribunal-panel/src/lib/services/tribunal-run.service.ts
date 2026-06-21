import { Injectable, inject } from '@angular/core';
import {
  ClaudeRpcService,
  VSCodeService,
  EffortStateService,
} from '@ptah-extension/core';
import { SurfaceId, TabManagerService } from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
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

@Injectable({ providedIn: 'root' })
export class TribunalRunService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly vscode = inject(VSCodeService);
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly tabManager = inject(TabManagerService);
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

    if (this.state.correlationId()) {
      this.teardownTab(this.state.correlationId());
      this.state.reset();
    }

    const conductorTabId = this.tabManager.createTab(`Tribunal: ${move}`);
    const surfaceId = SurfaceId.create();

    this.claims.claim(conductorTabId, surfaceId);

    this.state.setMove(move);
    this.state.setLanes(lanes);
    this.state.buildTilesForRun(lanes);
    this.state.setSurfaceId(surfaceId);
    this.state.setCorrelationId(conductorTabId);

    const workspacePath = this.vscode.config().workspaceRoot;
    const effort = this.effortState.currentEffort();
    const prompt = this.buildTribunalPrompt(move, lanes, trimmedObjective);

    try {
      const result = await this.rpc.call('chat:start', {
        prompt,
        tabId: conductorTabId,
        name: `Tribunal: ${move}`,
        ...(workspacePath ? { workspacePath } : {}),
        options: {
          ...(effort ? { effort } : {}),
        },
      });

      const ok = result.isSuccess() && result.data?.success !== false;
      if (!ok) {
        this.rollback(conductorTabId);
        console.error(
          '[TribunalRunService] chat:start failed:',
          result.data?.error ?? result.error,
        );
        return false;
      }
      return true;
    } catch (error: unknown) {
      this.rollback(conductorTabId);
      console.error(
        '[TribunalRunService] chat:start threw:',
        error instanceof Error ? error.message : String(error),
      );
      return false;
    }
  }

  async endRun(): Promise<boolean> {
    const conductorTabId = this.state.correlationId();
    if (!conductorTabId) {
      this.state.reset();
      return true;
    }
    await this.tabManager.closeTab(conductorTabId);
    const stillOpen = this.tabManager
      .tabs()
      .some((t) => t.id === conductorTabId);
    if (stillOpen) {
      return false;
    }
    this.claims.release(conductorTabId);
    this.state.reset();
    return true;
  }

  private rollback(conductorTabId: string): void {
    this.claims.release(conductorTabId);
    this.teardownTab(conductorTabId);
    this.state.reset();
  }

  private teardownTab(conductorTabId: string | null): void {
    if (!conductorTabId) return;
    this.tabManager.forceCloseTab(conductorTabId);
  }

  private buildTribunalPrompt(
    move: TribunalMove,
    lanes: readonly VendorLane[],
    objective: string,
  ): string {
    const laneLines = lanes
      .map(
        (lane) =>
          `  [tribunal:${lane.laneId}] ${lane.displayName} — ptah_agent_spawn({ ${this.spawnArgsFor(
            lane,
          )} }). ${objective}`,
      )
      .join('\n');

    return [
      `${MOVE_PHRASE[move]}. You are the Tribunal conductor running FULLY AUTONOMOUSLY.`,
      '',
      `Objective: ${objective}`,
      '',
      MOVE_FRAMING[move],
      '',
      'This panel is EXPLICITLY defined by the user. Spawn EXACTLY these panelists with EXACTLY these spawn args via ptah_agent_spawn. Do NOT run your own vendor discovery or family-spread selection, do NOT collapse duplicate vendors, and do NOT substitute models. The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task, verbatim.',
      '',
      laneLines,
      '',
      'Rules:',
      `- ${FULL_AUTO_DIRECTIVE}`,
      '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.',
    ].join('\n');
  }

  private spawnArgsFor(lane: VendorLane): string {
    const modelArg = lane.model ? `, model: "${lane.model}"` : '';
    switch (lane.cli) {
      case 'codex':
        return `cli: "codex"${modelArg}`;
      case 'copilot':
        return `cli: "copilot"${modelArg}`;
      case 'cursor':
        return 'cli: "cursor"';
      case 'ptah-cli':
        return `ptahCliId: "${lane.ptahCliId ?? ''}"${modelArg}`;
    }
  }
}
