/**
 * Batch 29b's activation fragment: `tsx` gets its own grammar
 * (`languages/tsx.language.ts`, `tree-sitter-tsx.wasm`).
 *
 * Every key below is proved by an executing check on real TSX with JSX:
 * - `parse:tsx` — `HONESTY_CHECKS` in `language-honesty.contract.spec.ts`:
 *   the real parser analyses it with `parseStatus: 'ok'`;
 * - `outline:tsx` — `MCP_HONESTY_CHECKS` in vscode-lm-tools
 *   `mcp-language-coverage.spec.ts` (the outliner lives in that project, which
 *   this one may not import; listed in `CHECKED_ELSEWHERE`): the real
 *   `TreeSitterCodeOutliner` outlines a `.tsx` component instead of refusing;
 * - `codeIndex:tsx` — `HONESTY_CHECKS`: the real `CodeSymbolIndexer` stores
 *   the components and counts the file as analysed, not unsupported;
 * - `enrichSummary:tsx` — `HONESTY_CHECKS`: the real `ContextEnrichmentService`
 *   summarises a declaration-only `.tsx` file.
 *
 * None is an approximation: each is the same full contract TypeScript has.
 */

import type { ActivationFragment } from './activation-fragment';

export const ACTIVATION: ActivationFragment = {
  batch: 'b29b',
  keys: ['parse:tsx', 'outline:tsx', 'codeIndex:tsx', 'enrichSummary:tsx'],
};
