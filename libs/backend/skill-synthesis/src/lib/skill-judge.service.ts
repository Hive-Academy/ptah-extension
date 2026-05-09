/**
 * SkillJudgeService — LLM-as-judge gate during skill promotion (Signal 5).
 *
 * Evaluates a candidate's body against three criteria (novelty, actionability,
 * scope), each scored 1-10 by the LLM. A composite average is compared against
 * `settings.minJudgeScore`. Fails open on LLM errors (returns score=10, passed=true)
 * so promotion is never blocked by an unavailable judge.
 *
 * Only runs at the promotion gate — NOT at candidate creation time.
 */
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { IInternalQuery } from './internal-query.interface';
import type { SkillCandidateRow, SkillSynthesisSettings } from './types';

/**
 * Cross-library token for InternalQueryService.
 * Matches SDK_TOKENS.SDK_INTERNAL_QUERY_SERVICE = Symbol.for('SdkInternalQueryService').
 */
const INTERNAL_QUERY_SERVICE_TOKEN = Symbol.for('SdkInternalQueryService');

/** Hard cap on judge LLM call duration. */
const JUDGE_TIMEOUT_MS = 15_000;

/** Fallback model when judgeModel is 'inherit' and workspace has no preference. */
const JUDGE_FALLBACK_MODEL = 'claude-haiku-4-5-20251001';

export interface JudgeDecision {
  passed: boolean;
  score: number;
  reason: 'judge-verdict' | 'judge-disabled' | 'judge-error-passthrough';
}

@injectable()
export class SkillJudgeService {
  constructor(
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    @inject(PLATFORM_TOKENS.WORKSPACE_PROVIDER)
    private readonly workspaceProvider: IWorkspaceProvider,
    @inject(INTERNAL_QUERY_SERVICE_TOKEN, { isOptional: true })
    private readonly internalQuery: IInternalQuery | null,
  ) {}

  /**
   * Evaluate a candidate for promotion eligibility.
   * Returns { passed: true, score: 10, reason: 'judge-disabled' } when the
   * judge is turned off or InternalQueryService is unavailable.
   */
  async judge(
    candidate: SkillCandidateRow,
    body: string,
    settings: SkillSynthesisSettings,
  ): Promise<JudgeDecision> {
    if (!settings.judgeEnabled || !this.internalQuery) {
      return { passed: true, score: 10, reason: 'judge-disabled' };
    }

    const model = this.resolveModel(settings.judgeModel);

    const prompt = [
      `Evaluate this skill for promotion based on three criteria. Reply with ONLY valid JSON.`,
      ``,
      `Skill name: ${candidate.name}`,
      `Skill description: ${candidate.description}`,
      ``,
      `Body:`,
      `---`,
      body.slice(0, 3000),
      `---`,
      ``,
      `Score each criterion 1-10:`,
      `- novelty: How novel/non-obvious is this skill compared to common knowledge?`,
      `- actionability: How directly actionable are the steps?`,
      `- scope: Is the scope well-defined (not too broad, not too trivial)?`,
      ``,
      `Reply with ONLY: {"novelty": <number>, "actionability": <number>, "scope": <number>}`,
    ].join('\n');

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      JUDGE_TIMEOUT_MS,
    );

    try {
      const handle = await this.internalQuery.execute({
        cwd: process.cwd(),
        model,
        prompt,
        isPremium: false,
        mcpServerRunning: false,
        maxTurns: 1,
        abortController,
      });

      let collected = '';
      for await (const msg of handle.stream) {
        if (msg.type === 'assistant') {
          for (const block of msg.message?.content ?? []) {
            if (block.type === 'text' && typeof block.text === 'string') {
              collected += block.text;
            }
          }
        }
        if (msg.type === 'result') break;
      }

      // Parse JSON from collected text.
      const jsonMatch = /\{[^{}]*\}/.exec(collected.trim());
      if (!jsonMatch) {
        this.logger.warn('[skill-judge] could not extract JSON from response', {
          candidateId: candidate.id,
          raw: collected.slice(0, 200),
        });
        return { passed: true, score: 10, reason: 'judge-error-passthrough' };
      }

      const parsed = JSON.parse(jsonMatch[0]) as {
        novelty?: unknown;
        actionability?: unknown;
        scope?: unknown;
      };

      const novelty = toScore(parsed.novelty);
      const actionability = toScore(parsed.actionability);
      const scope = toScore(parsed.scope);

      if (novelty === null || actionability === null || scope === null) {
        this.logger.warn('[skill-judge] invalid score values in response', {
          candidateId: candidate.id,
          parsed,
        });
        return { passed: true, score: 10, reason: 'judge-error-passthrough' };
      }

      const composite = (novelty + actionability + scope) / 3;
      const passed = composite >= settings.minJudgeScore;

      this.logger.info('[skill-judge] verdict', {
        candidateId: candidate.id,
        composite,
        passed,
        novelty,
        actionability,
        scope,
      });

      return { passed, score: composite, reason: 'judge-verdict' };
    } catch (err: unknown) {
      this.logger.warn('[skill-judge] LLM call failed; fail-open', {
        candidateId: candidate.id,
        error: err instanceof Error ? err.message : String(err),
      });
      return { passed: true, score: 10, reason: 'judge-error-passthrough' };
    } finally {
      clearTimeout(timeoutHandle);
    }
  }

  private resolveModel(judgeModel: string): string {
    if (judgeModel !== 'inherit') return judgeModel;
    try {
      const configured = this.workspaceProvider.getConfiguration<string>(
        'ptah',
        'llm.vscode.model',
        '',
      );
      return configured || JUDGE_FALLBACK_MODEL;
    } catch {
      return JUDGE_FALLBACK_MODEL;
    }
  }
}

/** Safely coerce an unknown value to a 1-10 score, or null if invalid. */
function toScore(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}
