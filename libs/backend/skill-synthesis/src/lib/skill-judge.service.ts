/**
 * SkillJudgeService — LLM-as-judge gate during skill promotion (Signal 5).
 *
 * Evaluates a candidate's body against five skill-authoring criteria (novelty,
 * actionability, scope, generalization, triggerClarity), each scored 1-10 by the
 * LLM. A composite average is compared against `settings.minJudgeScore`. Fails
 * open on LLM errors (returns score=10, passed=true) so promotion is never
 * blocked by an unavailable judge.
 *
 * Runs at the promotion gate and at the suggestion-pass gate — NOT at candidate
 * creation time.
 */
import * as os from 'node:os';
import { inject, injectable } from 'tsyringe';
import { TOKENS, type Logger } from '@ptah-extension/vscode-core';
import {
  PLATFORM_TOKENS,
  type IWorkspaceProvider,
} from '@ptah-extension/platform-core';
import type { IInternalQuery } from './internal-query.interface';
import type { SkillCandidateRow, SkillSynthesisSettings } from './types';
import { INTERNAL_QUERY_SERVICE_TOKEN } from './di/tokens';
import { resolveJudgeModel } from './model-resolver';

/** Hard cap on judge LLM call duration. */
const JUDGE_TIMEOUT_MS = 15_000;

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
    context?: string,
  ): Promise<JudgeDecision> {
    if (!settings.judgeEnabled || !this.internalQuery) {
      return { passed: true, score: 10, reason: 'judge-disabled' };
    }

    const model = this.resolveModel(settings.judgeModel);

    const prompt = [
      `Evaluate this synthesized skill against skill-authoring best practices. A good skill is a REUSABLE, repo-agnostic workflow with a trigger-oriented description and concise, actionable steps. Reply with ONLY valid JSON.`,
      ``,
      `Skill name: ${candidate.name}`,
      `Skill description: ${candidate.description}`,
      ``,
      `Body:`,
      `---`,
      body.slice(0, 3000),
      `---`,
      ``,
      // Optional background material (e.g. the enhancer's measured-scorecard
      // block). Informational only — the five scoring criteria are unchanged.
      ...(context
        ? [
            `Background (measured usage signal for context only — do NOT add new scoring criteria):`,
            context,
            ``,
          ]
        : []),
      `Score each criterion 1-10 (be strict — score low when in doubt):`,
      `- novelty: How novel/non-obvious is this versus common knowledge an agent already has?`,
      `- actionability: How directly executable are the steps (imperative, concrete, ordered)?`,
      `- scope: Is the scope a single well-defined workflow (not too broad, not a trivial one-off)?`,
      `- generalization: Is it repo-agnostic and transferable, with NO leftover workspace paths, file names, or session-specific details? Score 1-3 if it merely echoes one session or restates the user's request.`,
      `- triggerClarity: Does the description clearly state WHEN to use the skill, so another agent could decide to trigger it? Score low if vague or it just names the task.`,
      ``,
      `Reply with ONLY: {"novelty": <number>, "actionability": <number>, "scope": <number>, "generalization": <number>, "triggerClarity": <number>}`,
    ].join('\n');

    const abortController = new AbortController();
    const timeoutHandle = setTimeout(
      () => abortController.abort(),
      JUDGE_TIMEOUT_MS,
    );

    try {
      const handle = await this.internalQuery.execute({
        cwd: os.homedir(),
        model,
        prompt,
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
        generalization?: unknown;
        triggerClarity?: unknown;
      };

      const novelty = toScore(parsed.novelty);
      const actionability = toScore(parsed.actionability);
      const scope = toScore(parsed.scope);
      const generalization = toScore(parsed.generalization);
      const triggerClarity = toScore(parsed.triggerClarity);

      if (
        novelty === null ||
        actionability === null ||
        scope === null ||
        generalization === null ||
        triggerClarity === null
      ) {
        this.logger.warn('[skill-judge] invalid score values in response', {
          candidateId: candidate.id,
          parsed,
        });
        return { passed: true, score: 10, reason: 'judge-error-passthrough' };
      }

      const composite =
        (novelty + actionability + scope + generalization + triggerClarity) / 5;
      const passed = composite >= settings.minJudgeScore;

      this.logger.info('[skill-judge] verdict', {
        candidateId: candidate.id,
        composite,
        passed,
        novelty,
        actionability,
        scope,
        generalization,
        triggerClarity,
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
    return resolveJudgeModel(judgeModel, this.workspaceProvider);
  }
}

/** Safely coerce an unknown value to a 1-10 score, or null if invalid. */
function toScore(v: unknown): number | null {
  if (typeof v !== 'number' && typeof v !== 'string') return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 1 || n > 10) return null;
  return n;
}
