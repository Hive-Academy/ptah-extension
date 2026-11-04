import { buildLensPrompt, type ReviewPromptInput } from './prompt-fence';

export function buildContractsCallersPrompt(input: ReviewPromptInput): string {
  return buildLensPrompt('contracts-callers', 'Trace producers and consumers, changed exports, unchanged callers, cross-module contracts, and outside-diff impacts.', input);
}
