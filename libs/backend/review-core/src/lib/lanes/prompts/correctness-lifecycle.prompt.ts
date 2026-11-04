import { buildLensPrompt, type ReviewPromptInput } from './prompt-fence';

export function buildCorrectnessLifecyclePrompt(input: ReviewPromptInput): string {
  return buildLensPrompt('correctness-lifecycle', 'Inspect correctness, async lifecycle, retries, cancellation, resource cleanup, persistence and performance when relevant. For UI changes, inspect accessibility and interaction semantics.', input);
}
