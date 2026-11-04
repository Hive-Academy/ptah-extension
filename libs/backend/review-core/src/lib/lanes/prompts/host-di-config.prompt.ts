import { buildLensPrompt, type ReviewPromptInput } from './prompt-fence';

export function buildHostDiConfigPrompt(input: ReviewPromptInput): string {
  return buildLensPrompt('host-di-config', 'Inspect host parity across Electron, VS Code and CLI, DI registrations, configuration integrity, migrations, and startup behavior.', input);
}
