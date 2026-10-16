import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService, EffortStateService } from '@ptah-extension/core';
import { SurfaceId, TabManagerService } from '@ptah-extension/chat-state';
import { WorkflowSessionClaimService } from '@ptah-extension/chat-routing';
import { TribunalStateService } from './tribunal-state.service';
import { buildTribunalFraming, roundCapFor } from './tribunal-run-framing';
import { rosterIsLaunchable } from './tribunal-roster-rules';
import {
  rolesForMove,
  type TribunalMove,
  type VendorLane,
} from '../types/tribunal-ui.types';

/**
 * Everything a launch needs, in one object.
 *
 * A single parameter rather than a widening positional list: Crucible's rubric
 * and round cap travel WITH the move and lanes they belong to, so a call site
 * cannot pass a rubric for a move that has no rubric, or forget one for the
 * move that requires it.
 */
export interface TribunalLaunchSpec {
  readonly move: TribunalMove;
  readonly lanes: readonly VendorLane[];
  /** Crucible only. Forwarded to the framing VERBATIM — it is user input. */
  readonly rubric?: string;
  /** Crucible only. 1..2 at launch. */
  readonly roundCap?: number;
}

@Injectable({ providedIn: 'root' })
export class TribunalRunService {
  private readonly effortState = inject(EffortStateService);
  private readonly claims = inject(WorkflowSessionClaimService);
  private readonly tabManager = inject(TabManagerService);
  private readonly state = inject(TribunalStateService);
  private readonly rpc = inject(ClaudeRpcService);

  /**
   * Prepare a Tribunal run WITHOUT starting a session. Creates the (hidden)
   * conductor tab as a draft, builds the panelist tiles, and stamps the council
   * framing as the conductor tab's first-message preamble. The user then drives
   * the run from the conductor's normal chat input: their first message starts
   * the session via the standard send path with the framing prepended to the
   * backend prompt. No bespoke `chat:start` launch — the robust normal-chat
   * machinery owns the streaming, turn-end, and spawn lifecycle.
   *
   * Async because the role moves allocate their `.ptah/specs/TASK_[ID]` folder
   * up front (see {@link allocateSpecFolder}). That allocation is the only
   * awaited step and it can NEVER block a launch.
   */
  async prepare(spec: TribunalLaunchSpec): Promise<boolean> {
    const { move, lanes } = spec;
    if (lanes.length === 0) {
      return false;
    }
    // The wizard already blocks Next on this; re-asserting here means no other
    // caller can launch a roster the rules reject (AC-2.3, AC-2.5).
    if (!rosterIsLaunchable(move, lanes)) {
      return false;
    }

    if (this.state.correlationId()) {
      this.teardownTab(this.state.correlationId());
      this.state.reset();
    }

    const roundCap = roundCapFor(spec);
    const rubric = move === 'crucible' ? (spec.rubric ?? null) : null;
    const specTaskId = await this.allocateSpecFolder(move, lanes);

    const conductorTabId = this.tabManager.createTab(`Tribunal: ${move}`);
    const surfaceId = SurfaceId.create();

    this.claims.claim(conductorTabId, surfaceId);

    this.state.setMove(move);
    this.state.setLanes(lanes);
    this.state.buildTilesForRun(lanes);
    this.state.setSurfaceId(surfaceId);
    this.state.setCorrelationId(conductorTabId);
    this.state.setSpecTaskId(specTaskId);
    this.state.setRoundCap(roundCap);
    this.state.setRubric(rubric);

    this.tabManager.setFirstMessagePreamble(
      conductorTabId,
      buildTribunalFraming(move, lanes, {
        specTaskId,
        roundCap,
        rubric,
      }),
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
   * Allocate the run's spec folder via `tasks:create`, for the role moves only.
   *
   * The backend allocator already implements the folder-scan id rule and the
   * exclusive-create race; discovering the folder after the fact would be a
   * guess, because agents create task folders constantly.
   *
   * **Failure is non-blocking and silent to the launch path.** A null return
   * means the framing omits its `Spec folder:` line (the conductor then
   * allocates per the skill) and the run view shows progress as unavailable.
   * Progress is an enhancement; it never gates convening a panel.
   */
  private async allocateSpecFolder(
    move: TribunalMove,
    lanes: readonly VendorLane[],
  ): Promise<string | null> {
    if (rolesForMove(move).length === 0) {
      return null;
    }
    const workspaceRoot = this.tabManager.activeWorkspacePath;
    try {
      const result = await this.rpc.call('tasks:create', {
        title: `Tribunal ${this.moveLabel(move)} — ${new Date()
          .toISOString()
          .slice(0, 10)}`,
        type: 'FEATURE',
        status: 'in_progress',
        description: this.rosterDescription(move, lanes),
        ...(workspaceRoot ? { workspaceRoot } : {}),
      });
      if (result.isSuccess() && result.data?.success && result.data.task) {
        return result.data.task.id;
      }
      console.warn(
        '[TribunalRunService] spec folder allocation failed:',
        result.data?.error?.message ?? result.error ?? 'unknown error',
      );
      return null;
    } catch (error: unknown) {
      console.warn(
        '[TribunalRunService] spec folder allocation threw:',
        error instanceof Error ? error.message : String(error),
      );
      return null;
    }
  }

  private moveLabel(move: TribunalMove): string {
    return `${move.charAt(0).toUpperCase()}${move.slice(1)}`;
  }

  private rosterDescription(
    move: TribunalMove,
    lanes: readonly VendorLane[],
  ): string {
    const roster = lanes
      .map((lane) =>
        lane.role
          ? `${lane.role}: ${lane.displayName}${lane.model ? ` (${lane.model})` : ''}`
          : lane.displayName,
      )
      .join('; ');
    return `Tribunal ${this.moveLabel(move)} convened from the Tribunal panel. Lanes — ${roster}.`;
  }
}
