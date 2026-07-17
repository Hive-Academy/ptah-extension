import { Injectable, inject } from '@angular/core';
import { EffortStateService } from '@ptah-extension/core';
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
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly tabManager = inject(TabManagerService);
  private readonly state = inject(TribunalStateService);

  /**
   * Prepare a Tribunal run WITHOUT starting a session. Creates the (hidden)
   * conductor tab as a draft, builds the panelist tiles, and stamps the council
   * framing as the conductor tab's first-message preamble. The user then drives
   * the run from the conductor's normal chat input: their first message starts
   * the session via the standard send path with the framing prepended to the
   * backend prompt. No bespoke `chat:start` launch — the robust normal-chat
   * machinery owns the streaming, turn-end, and spawn lifecycle.
   */
  prepare(move: TribunalMove, lanes: readonly VendorLane[]): boolean {
    if (lanes.length === 0) {
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

    this.tabManager.setFirstMessagePreamble(
      conductorTabId,
      this.buildTribunalFraming(move, lanes),
    );

    const effort = this.effortState.currentEffort();
    if (effort) {
      this.tabManager.setOverrideEffort(conductorTabId, effort);
    }

    return true;
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

  /**
   * Council framing prepended (hidden) to the conductor's first message. The
   * user's objective is appended after this block by the normal send path, so
   * the panelist spawn lines reference "the objective below" rather than
   * embedding it.
   */
  private buildTribunalFraming(
    move: TribunalMove,
    lanes: readonly VendorLane[],
  ): string {
    const laneLines = lanes
      .map(
        (lane) =>
          `  [tribunal:${lane.laneId}] ${lane.displayName} — ptah_agent_spawn({ ${this.spawnArgsFor(
            lane,
          )} }) with the objective below as the task.`,
      )
      .join('\n');

    return [
      `${MOVE_PHRASE[move]}. You are the Tribunal conductor running FULLY AUTONOMOUSLY.`,
      '',
      MOVE_FRAMING[move],
      '',
      'This panel is EXPLICITLY defined by the user. Spawn EXACTLY these panelists with EXACTLY these spawn args via ptah_agent_spawn, passing each the objective stated at the end of this message. Do NOT run your own vendor discovery or family-spread selection, do NOT collapse duplicate vendors, and do NOT substitute models. The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task, verbatim.',
      '',
      laneLines,
      '',
      'Rules:',
      `- ${FULL_AUTO_DIRECTIVE}`,
      '- The [tribunal:<laneId>] tag MUST be the first line of each sub-agent task. Do not omit it and do not alter the laneId inside it.',
      '',
      'Objective:',
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
      case 'antigravity':
        // agy takes a model label (e.g. "Gemini 3.5 Flash (High)"); no effort
        // arg — reasoning effort is baked into the label. The adapter adds the
        // --print / --dangerously-skip-permissions flags on spawn.
        return `cli: "antigravity"${modelArg}`;
      case 'opencode':
        return `cli: "opencode"${modelArg}`;
      case 'pi':
        return `cli: "pi"${modelArg}`;
      case 'ptah-cli':
        return `ptahCliId: "${lane.ptahCliId ?? ''}"${modelArg}`;
    }
  }
}
