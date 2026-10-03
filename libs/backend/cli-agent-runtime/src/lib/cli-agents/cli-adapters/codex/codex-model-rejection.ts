/**
 * The message a lane shows when Codex refuses the model it was given
 * (TASK_2026_597, D3, F10). There is never a retry with another model: the
 * message names the one place the user can change it, and quotes what Codex
 * actually said so a misread failure is never hidden.
 */

import type { LaneModelSource } from '../cli-adapter.interface';
import { redactSecrets } from '../sdk-error-summary';

/**
 * Model-not-found and unsupported-model wording from the Responses API and
 * Codex, e.g. `The 'gpt-6-sol' model is not supported when using Codex with a
 * ChatGPT account.` or `model_not_found`.
 *
 * Deliberately narrow (batch 4 review S1): "not available", a bare
 * "unsupported" and a bare "not supported" are left out, because capacity and
 * reconnect messages use them ("model is not available right now"). The gap
 * between "model" and the verdict may not cross a sentence end.
 */
const MODEL_REJECTION_PATTERN =
  /model_not_found|unsupported[_ ]model|\bmodel\b[^\n.]{0,80}?\b(?:not found|does not exist|is not supported|do(?:es)? not have access)\b/i;

/** Longest quote of Codex's own text a message or log line carries. */
const CODEX_TEXT_EXCERPT_MAX_CHARS = 200;

/** `text` on one line, secrets redacted, at most 200 chars. */
export function codexTextExcerpt(
  text: string,
  secrets: readonly string[],
): string {
  const redacted = redactSecrets(text.replace(/\s+/g, ' ').trim(), secrets);
  return redacted.length > CODEX_TEXT_EXCERPT_MAX_CHARS
    ? `${redacted.slice(0, CODEX_TEXT_EXCERPT_MAX_CHARS - 3)}...`
    : redacted;
}

/**
 * The lane-facing message when `text` is a model rejection, else `undefined`.
 * It ends with Codex's own words, redacted and truncated.
 *
 * @param model - The model the lane ran with; absent when Codex chose.
 * @param source - Where `model` came from. Absent means the source is not
 *   known yet and is named as "the setting or the spawn request".
 */
export function codexModelRejectionMessage(
  text: string,
  model: string | undefined,
  source: LaneModelSource | undefined,
  secrets: readonly string[],
): string | undefined {
  if (!MODEL_REJECTION_PATTERN.test(text)) return undefined;
  return `${modelAdvice(model, source)} Codex said: "${codexTextExcerpt(text, secrets)}"`;
}

function modelAdvice(
  model: string | undefined,
  source: LaneModelSource | undefined,
): string {
  if (!model || source === 'cli-default') {
    return 'Codex rejected its own default model. Set `agentOrchestration.codexModel` to a model your account offers.';
  }
  switch (source) {
    case 'ptah-default':
      return `Codex rejected \`${model}\`, Ptah's lane default. Set \`agentOrchestration.codexModel\` to a model your account offers.`;
    case 'setting':
      return `Codex rejected \`${model}\`, set in \`agentOrchestration.codexModel\`. Set it to a model your account offers.`;
    case 'request':
      return `Codex rejected \`${model}\`, named by the spawn request. Spawn with a model your account offers.`;
    default:
      return `Codex rejected \`${model}\`, chosen by the \`agentOrchestration.codexModel\` setting or the spawn request. Choose a model your account offers.`;
  }
}
