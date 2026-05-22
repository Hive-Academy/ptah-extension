import { Injectable, computed, inject, signal } from '@angular/core';
import { AppStateManager, ClaudeRpcService } from '@ptah-extension/core';
import { TabManagerService } from '@ptah-extension/chat-state';
import type {
  MemoryRunNowResult,
  SkillAnalyzeNowResult,
} from '@ptah-extension/shared';

import { ActionBannerService } from './action-banner.service';

const SESSION_ACTION_TIMEOUTS = {
  MEMORY_RUN_MS: 60_000,
  SKILL_ANALYZE_MS: 60_000,
} as const;

@Injectable({ providedIn: 'root' })
export class SessionActionsService {
  private readonly rpc = inject(ClaudeRpcService);
  private readonly tabManager = inject(TabManagerService);
  private readonly appState = inject(AppStateManager);
  private readonly banner = inject(ActionBannerService);

  private readonly _actionInFlight = signal<boolean>(false);

  public readonly actionInFlight = this._actionInFlight.asReadonly();

  public readonly hasActiveSession = computed<boolean>(() => {
    const tab = this.tabManager.activeTab();
    return tab !== null && tab.claudeSessionId !== null;
  });

  public async saveToMemory(): Promise<MemoryRunNowResult | null> {
    const context = this.resolveContext();
    if (!context) {
      this.banner.showError('No active session to save.');
      return null;
    }
    if (this._actionInFlight()) return null;
    this._actionInFlight.set(true);
    try {
      const result = await this.rpc.call(
        'memory:runNow',
        { sessionId: context.sessionId, workspaceRoot: context.workspaceRoot },
        { timeout: SESSION_ACTION_TIMEOUTS.MEMORY_RUN_MS },
      );
      if (result.isSuccess() && result.data) {
        this.banner.showInfo('Session saved to memory.');
        return result.data;
      }
      this.banner.showError(result.error || 'Failed to save to memory.');
      return null;
    } catch (error: unknown) {
      this.banner.showError(
        error instanceof Error ? error.message : 'Failed to save to memory.',
      );
      return null;
    } finally {
      this._actionInFlight.set(false);
    }
  }

  public async extractSkill(): Promise<SkillAnalyzeNowResult | null> {
    const context = this.resolveContext();
    if (!context) {
      this.banner.showError('No active session to analyze.');
      return null;
    }
    if (this._actionInFlight()) return null;
    this._actionInFlight.set(true);
    try {
      const result = await this.rpc.call(
        'skillSynthesis:analyzeNow',
        {
          sessionId: context.sessionId,
          workspaceRoot: context.workspaceRoot,
          force: true,
        },
        { timeout: SESSION_ACTION_TIMEOUTS.SKILL_ANALYZE_MS },
      );
      if (result.isSuccess() && result.data) {
        const data = result.data;
        if (data.candidateId) {
          this.banner.showInfo('Skill candidate extracted.');
        } else if (data.reason) {
          this.banner.showInfo('Session ineligible: ' + data.reason);
        } else {
          this.banner.showInfo('Skill analysis complete.');
        }
        return data;
      }
      this.banner.showError(result.error || 'Failed to analyze session.');
      return null;
    } catch (error: unknown) {
      this.banner.showError(
        error instanceof Error ? error.message : 'Failed to analyze session.',
      );
      return null;
    } finally {
      this._actionInFlight.set(false);
    }
  }

  private resolveContext(): {
    sessionId: string;
    workspaceRoot: string;
  } | null {
    const tab = this.tabManager.activeTab();
    const sessionId = tab?.claudeSessionId;
    if (!sessionId) return null;
    const workspaceRoot = this.appState.workspaceInfo()?.path;
    if (!workspaceRoot) return null;
    return { sessionId: String(sessionId), workspaceRoot };
  }
}
