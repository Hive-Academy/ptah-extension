import { buildLensPrompt, type ReviewPromptInput } from './prompt-fence';

export function buildSecurityPrivacyPrompt(input: ReviewPromptInput): string {
  return buildLensPrompt('security-privacy', 'Inspect trust boundaries, path and command injection, credential handling, redaction, authorization, and privacy leaks.', input);
}
