/**
 * Extension -> language inference for `ContextEnrichmentService.generateStructuralSummary`.
 *
 * Extracted (TASK_2026_559 Batch 20 r1, defect 5) so the production MCP path
 * (`analysis-namespace.builders.ts::enrichFile` in `vscode-lm-tools`) and the
 * Task 20.2 regression bench (`mcp-contract.bench.spec.ts`, in this lib) call
 * the SAME function — a benchmark that re-implemented this decision locally
 * could not detect a regression in the real inference.
 *
 * @module libs/backend/workspace-intelligence/context-analysis
 */

import * as path from 'node:path';
import {
  EXTENSION_LANGUAGE_MAP,
  GRAMMAR_FILE_MAP,
} from '../ast/tree-sitter.config';
import type { SupportedLanguage } from '../ast/ast.types';
import { hasCapability } from '../ast/language-registry';

/**
 * A language `ContextEnrichmentService` renders as a .d.ts-style summary: one
 * the registry grants `enrichSummary` (typescript, javascript, tsx).
 */
export type EnrichLanguage = SupportedLanguage;

function isEnrichLanguage(value: unknown): value is EnrichLanguage {
  return (
    typeof value === 'string' &&
    Object.hasOwn(GRAMMAR_FILE_MAP, value) &&
    hasCapability(value as SupportedLanguage, 'enrichSummary')
  );
}

/**
 * ESM/CJS module-flavour extensions `EXTENSION_LANGUAGE_MAP` does not list;
 * each parses with the grammar of its base extension.
 */
const MODULE_EXTENSION_BASE: Readonly<Record<string, string>> = {
  '.mts': '.ts',
  '.cts': '.ts',
  '.mjs': '.js',
  '.cjs': '.js',
};

/**
 * The language to summarise `filePath` as. An explicit summary `language`
 * (one the registry grants `enrichSummary`) wins, even when it contradicts the
 * extension. Otherwise (omitted or not a summary language) it is inferred from
 * the last extension, case-insensitively, through `EXTENSION_LANGUAGE_MAP`
 * (`.jsx` → javascript, `.tsx` → tsx, `.spec.ts`/`.D.TS` → typescript). A
 * language the summary cannot render (python, go, csharp) or a file without an
 * extension gives `undefined`, which the service answers with full content and
 * `reason: 'unsupported-language'`.
 */
export function resolveEnrichLanguage(
  filePath: string,
  language?: string,
): EnrichLanguage | undefined {
  if (isEnrichLanguage(language)) {
    return language;
  }
  const extension = path.extname(filePath).toLowerCase();
  const key = Object.hasOwn(MODULE_EXTENSION_BASE, extension)
    ? MODULE_EXTENSION_BASE[extension]
    : extension;
  const inferred = Object.hasOwn(EXTENSION_LANGUAGE_MAP, key)
    ? EXTENSION_LANGUAGE_MAP[key]
    : undefined;
  return isEnrichLanguage(inferred) ? inferred : undefined;
}
