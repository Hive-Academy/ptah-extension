import { Injectable, inject } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  SkillAnalyzeNowParams,
  SkillAnalyzeNowResult,
  SkillDiagnosticsParams,
  SkillDiagnosticsResult,
  SkillGetTriggersResult,
  SkillSetTriggersParams,
  SkillSetTriggersResult,
  SkillTriggersDto,
} from '@ptah-extension/shared';

const SKILL_DIAGNOSTICS_RPC_TIMEOUTS = {
  DIAGNOSTICS_MS: 10_000,
  ANALYZE_MS: 60_000,
  TRIGGERS_MS: 8_000,
} as const;

@Injectable({ providedIn: 'root' })
export class SkillDiagnosticsRpcService {
  private readonly rpc = inject(ClaudeRpcService);

  public async diagnostics(
    params: SkillDiagnosticsParams = {},
  ): Promise<SkillDiagnosticsResult> {
    const result = await this.rpc.call('skillSynthesis:diagnostics', params, {
      timeout: SKILL_DIAGNOSTICS_RPC_TIMEOUTS.DIAGNOSTICS_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'skillSynthesis:diagnostics failed');
  }

  public async analyzeNow(
    params: SkillAnalyzeNowParams,
  ): Promise<SkillAnalyzeNowResult> {
    const result = await this.rpc.call('skillSynthesis:analyzeNow', params, {
      timeout: SKILL_DIAGNOSTICS_RPC_TIMEOUTS.ANALYZE_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'skillSynthesis:analyzeNow failed');
  }

  public async setTriggers(
    triggers: Partial<SkillTriggersDto>,
  ): Promise<SkillSetTriggersResult> {
    const params: SkillSetTriggersParams = { triggers };
    const result = await this.rpc.call('skillSynthesis:setTriggers', params, {
      timeout: SKILL_DIAGNOSTICS_RPC_TIMEOUTS.TRIGGERS_MS,
    });
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'skillSynthesis:setTriggers failed');
  }

  public async getTriggers(): Promise<SkillGetTriggersResult> {
    const result = await this.rpc.call(
      'skillSynthesis:getTriggers',
      {},
      { timeout: SKILL_DIAGNOSTICS_RPC_TIMEOUTS.TRIGGERS_MS },
    );
    if (result.isSuccess() && result.data) {
      return result.data;
    }
    throw new Error(result.error || 'skillSynthesis:getTriggers failed');
  }
}
