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
  ): Promise<boolean> {
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
    const prompt = this.buildTribunalPrompt(move, lanes);

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
  ): string {
    const families = Array.from(
      new Set(lanes.map((lane) => lane.family)),
    ).filter((family) => family.length > 0);
    const panel =
      families.length > 0
        ? `Use this vendor panel: ${families.join(', ')}.`
        : 'Use the default vendor panel.';
    return `${MOVE_PHRASE[move]}. ${panel}`;
  }
}
