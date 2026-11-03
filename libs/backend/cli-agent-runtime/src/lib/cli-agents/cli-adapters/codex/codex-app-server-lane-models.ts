import { z } from 'zod';
import type { CodexModelInfo } from '@ptah-extension/codex-runtime';
import type { CliModelInfo } from '../cli-adapter.interface';

/**
 * Dynamic `model/list` rows, validated at the lane boundary. The optional
 * fields mirror the public `CodexModelInfo` normalization: a missing display
 * name falls back to the runnable ID and a missing default flag is false.
 */
const modelListSchema = z.array(z.object({
  id: z.string().min(1),
  model: z.string().min(1),
  displayName: z.string().optional(),
  isDefault: z.boolean().optional(),
  description: z.string().optional(),
  supportedEfforts: z.array(z.string()).optional(),
}));

/**
 * Maps the dynamic Codex catalog to lane model rows. The runnable value is
 * `model.model`, and the row the server itself marks default is labeled
 * "(Codex default)". Ptah inserts no model ID of its own: the selected Codex
 * version owns the default, and a failed or empty discovery stays empty
 * instead of falling back to stale hardcoded IDs.
 */
export function codexLaneModels(input: readonly CodexModelInfo[]): CliModelInfo[] {
  const parsed = modelListSchema.parse(input);
  return parsed.map((model) => {
    const name = model.displayName?.trim() || model.model;
    return model.isDefault === true
      ? { id: model.model, name: `${name} (Codex default)` }
      : { id: model.model, name };
  });
}