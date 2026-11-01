import { z } from 'zod';
import type { CodexModelInfo } from '@ptah-extension/codex-runtime';
import type { CliModelInfo } from '../cli-adapter.interface';

export const CODEX_LANE_DEFAULT_MODEL = 'gpt-6-sol';

export const CODEX_LANE_FALLBACK_MODELS: readonly CliModelInfo[] = [
  { id: 'gpt-6.1-sol', name: 'GPT-6.1-Sol' },
  { id: 'gpt-6-astra', name: 'GPT-6-Astra' },
  { id: 'gpt-6-sol', name: 'GPT-6-Sol' },
  { id: 'gpt-6-luna', name: 'GPT-6-Luna' },
  { id: 'gpt-5.6-sol', name: 'GPT-5.6-Sol' },
  { id: 'gpt-5.6-terra', name: 'GPT-5.6-Terra' },
  { id: 'gpt-5.6-luna', name: 'GPT-5.6-Luna' },
];

const modelListSchema = z.array(z.object({
  id: z.string().min(1), model: z.string().min(1), displayName: z.string(),
  isDefault: z.boolean(), description: z.string().optional(),
  supportedEfforts: z.array(z.string()).optional(),
}));

export function codexLaneModels(input: readonly CodexModelInfo[]): CliModelInfo[] {
  const parsed = modelListSchema.parse(input);
  return parsed.map((model) => markCodexLaneDefault({
    id: model.model, name: model.displayName.trim() || model.model,
  }));
}

export function markCodexLaneDefault(model: CliModelInfo): CliModelInfo {
  return model.id === CODEX_LANE_DEFAULT_MODEL
    ? { ...model, name: `${model.name} (Ptah lane default)` } : model;
}
