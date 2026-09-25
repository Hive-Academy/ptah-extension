/**
 * The VS Code Marketplace scanner rule, as a check.
 *
 * The scanner rejects trademarked AI product and vendor names in NON-JS files
 * of the VSIX, by file path and by content, and a rejection permanently burns
 * the extension id (`libs/frontend/ui/src/lib/native/provider-mark/
 * provider-marks.data.ts:5-11`, `README.md:1-8`). The flagged terms named in
 * this repository are "copilot", "codex", "claude" and "gpt"
 * (`libs/backend/platform-core/src/file-settings-manager.ts:5-6`); the rest of
 * the list below covers the AI vendors and CLI products the extension talks to
 * (implementation-plan R1 CLI targets, the provider ids in
 * `provider-marks.data.ts`). A token matches case-insensitively, and also with
 * spaces, dots and hyphens removed, so "Open AI" or "Co-pilot" cannot slip
 * through.
 *
 * Every plain-text file the brand-icon pipeline ships must return no hits.
 */

import { compareStrings } from './path-geometry.mjs';

export const SCANNER_TOKENS = Object.freeze([
  'anthropic',
  'claude',
  'openai',
  'chatgpt',
  'gpt',
  'codex',
  'copilot',
  'gemini',
  'antigravity',
  'cursor',
  'openrouter',
  'ollama',
  'moonshot',
  'kimi',
  'deepseek',
  'mistral',
  'grok',
  'perplexity',
]);

/** The scanner tokens found in `text` (sorted, unique); empty when the text is safe to ship. */
export function findScannerTokens(text) {
  const lower = text.toLowerCase();
  const collapsed = lower.replace(/[\s.\-_]+/g, '');
  return SCANNER_TOKENS.filter(
    (token) => lower.includes(token) || collapsed.includes(token),
  ).sort(compareStrings);
}

/**
 * Self-check run before every vendoring pass: the guard must flag each token
 * in plain, upper-case and split forms, and must pass clean text. A guard that
 * silently stopped matching would let a banned name into the VSIX.
 */
export function assertScannerGuardWorks() {
  for (const token of SCANNER_TOKENS) {
    const split = `${token.slice(0, 2)}-${token.slice(2)}`;
    for (const sample of [
      `x ${token} y`,
      `X ${token.toUpperCase()} Y`,
      `x ${split} y`,
    ]) {
      if (!findScannerTokens(sample).includes(token)) {
        throw new Error(
          `scanner guard self-check failed: "${sample}" was not flagged`,
        );
      }
    }
  }
  const clean = 'Brand icon notices. MIT License. Angular, SonarQube, Slack.';
  const hits = findScannerTokens(clean);
  if (hits.length > 0) {
    throw new Error(
      `scanner guard self-check failed: clean text flagged ${hits.join(', ')}`,
    );
  }
}
