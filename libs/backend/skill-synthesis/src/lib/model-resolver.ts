/**
 * Shared model-resolution utility for SkillJudgeService and SkillCuratorService.
 *
 * Extracted here to avoid importing from one service into another, which would
 * create an implicit dependency between peers.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import { JUDGE_DEFAULT_MODEL_ID } from './types';

/**
 * Resolve the effective LLM model string from a `judgeModel` setting value.
 *
 * When `judgeModel` is `'inherit'`, reads the workspace `ptah.llm.vscode.model`
 * configuration and falls back to {@link JUDGE_DEFAULT_MODEL_ID} if unset.
 * Any other value is returned as-is.
 *
 * Used by both SkillJudgeService and SkillCuratorService so resolution logic
 * is a single source of truth.
 */
export function resolveJudgeModel(
  judgeModel: string,
  workspaceProvider: IWorkspaceProvider,
): string {
  if (judgeModel !== 'inherit') return judgeModel;
  try {
    const configured = workspaceProvider.getConfiguration<string>(
      'ptah',
      'llm.vscode.model',
      '',
    );
    return configured || JUDGE_DEFAULT_MODEL_ID;
  } catch {
    return JUDGE_DEFAULT_MODEL_ID;
  }
}
