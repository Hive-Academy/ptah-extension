/**
 * Claude agent model resolution.
 *
 * The one rule for the `model:` line a generated Claude agent file carries.
 * Generation (the orchestrator) and the wizard preview both call it, so the
 * preview always shows the model the written file gets.
 *
 * @module @ptah-extension/agent-generation/services
 */

import {
  isAgentModelEmittable,
  matchesAgentModelSyntax,
  resolveAgentModel,
} from '@ptah-extension/shared';
import type {
  AgentModelLayers,
  AgentModelPreview,
} from '@ptah-extension/shared';

/**
 * The Claude `model:` value for one agent: the user's override when Claude
 * Code accepts it, otherwise the template's own (trimmed), otherwise none.
 *
 * Precedence (workspace slug, workspace `*`, machine slug, machine `*`) and
 * tolerance of malformed settings belong to `resolveAgentModel`. The override
 * is trimmed before the check and the trimmed form is what gets emitted; only
 * values Claude Code accepts (`opus`, `sonnet`, `haiku`, `inherit`) pass,
 * because Claude Code rejects an agent file whose `model:` it does not know.
 * A rejected override is returned as `ignoredOverride`, untrimmed.
 *
 * @param layers - The `agentGeneration.models` layers, or null when unread
 * @param templateId - The agent file slug (`<id>.md`) the editor saves under
 * @param templateModel - The template's own `model`, if any
 */
export function resolveClaudeAgentModel(
  layers: AgentModelLayers | null,
  templateId: string,
  templateModel: string | undefined,
): AgentModelPreview {
  const fromTemplate = templateModel?.trim() || undefined;
  const templatePreview: AgentModelPreview = fromTemplate
    ? { value: fromTemplate, origin: 'template' }
    : { value: null, origin: 'none' };

  const override = layers
    ? resolveAgentModel(layers, templateId, 'claude')
    : undefined;
  if (override === undefined) return templatePreview;

  const candidate = override.value.trim();
  if (
    isAgentModelEmittable('claude', candidate) &&
    matchesAgentModelSyntax('claude', candidate)
  ) {
    return { value: candidate, origin: override.scope };
  }
  return { ...templatePreview, ignoredOverride: override.value };
}
