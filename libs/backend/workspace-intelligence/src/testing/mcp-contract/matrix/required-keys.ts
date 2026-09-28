/**
 * The fixed key set for the language-honesty matrix (TASK_2026_559 Batch 27,
 * Task 27.2). Written once here; every activating batch (27, 29b, 30, 30k,
 * 31, 33, 34, 37b) contributes its own
 * `matrix/activations/<batch>.ts` fragment that claims a subset of these
 * keys. `required-keys.ts` itself is never edited by a later batch — only
 * new fragment files are added (Decomposition note, `batches.md` "Lane
 * plan").
 *
 * Key shapes:
 * - `<capability>:<language>` — a per-language capability (`parse`, `outline`,
 *   `codeIndex`, `enrichSummary`, `syntaxDiagnostics`, `publicSymbols`,
 *   `graphEdges`, `typeCheck`).
 * - `honesty:<mcp tool name>` — one of the ten literal honesty keys below,
 *   each pinning that tool's own "never silently confident/clean/empty"
 *   contract, independent of language.
 *
 * Decision 19: Kotlin graph support is explicitly not required, so there is
 * no `graphEdges:kotlin` or `publicSymbols:kotlin` key.
 *
 * Decision 27 (2026-09-28, amends Decisions 18(b) and 19 Q4): the Java graph
 * (Task 34.2), Rust (35) and PHP/Ruby/C++ (36a-c) dependency graphs are
 * DEFERRED to a follow-up task. There is no `graphEdges:java`,
 * `publicSymbols:java`, `graphEdges:rust`, `publicSymbols:rust`,
 * `graphEdges:php`, `publicSymbols:php`, `graphEdges:ruby`,
 * `publicSymbols:ruby`, `graphEdges:cpp` or `publicSymbols:cpp` key. Their
 * grammars, outline, code index and syntax diagnostics stay required
 * (already landed); their graph answers must disclose those languages as
 * unsupported, never as a clean empty answer (Batch 38 gate).
 */

/** Decision 18/19 option choices the matrix and its fixtures assume. */
export const SELECTED_OPTIONS = {
  kotlin: 'vendored',
  c: 'via-cpp',
  checkers: 'go-vet-opt-in',
  buildCheckers: 'none',
  extraGraphs: 'include',
} as const;

/**
 * The ten literal honesty keys (owner: Batch 27). Each names the MCP tool
 * whose "never a false-confident/false-clean/false-empty answer" contract
 * the harness pins. Order matches `implementation-plan-languages.md`'s
 * Required-keys table.
 */
export const HONESTY_KEYS = [
  'honesty:ptah_get_dependents',
  'honesty:ptah_get_dependencies',
  'honesty:ptah_get_symbol_index',
  'honesty:ptah_code_search_symbols',
  'honesty:ptah_code_reindex',
  'honesty:ptah_ast_analyze',
  'honesty:ptah_context_enrich_file',
  'honesty:ptah_lsp_definitions',
  'honesty:ptah_lsp_references',
  'honesty:ptah_get_diagnostics',
] as const;

/** One row of the plan's "Required keys" table. */
export interface CapabilityRow {
  readonly capability:
    | 'parse'
    | 'outline'
    | 'codeIndex'
    | 'enrichSummary'
    | 'syntaxDiagnostics'
    | 'publicSymbols'
    | 'graphEdges'
    | 'typeCheck';
  readonly languages: readonly string[];
  /** The batch that activates this row (documentation only; not asserted). */
  readonly owner: string;
}

/** The plan's "Required keys" table, verbatim (`implementation-plan-languages.md:471-489`). */
export const CAPABILITY_TABLE: readonly CapabilityRow[] = [
  { capability: 'parse', languages: ['tsx'], owner: '29b' },
  { capability: 'parse', languages: ['java', 'rust'], owner: '30' },
  { capability: 'parse', languages: ['php', 'ruby', 'cpp'], owner: '31' },
  { capability: 'parse', languages: ['kotlin'], owner: '30k' },

  { capability: 'outline', languages: ['tsx'], owner: '29b' },
  { capability: 'outline', languages: ['java', 'rust'], owner: '30' },
  { capability: 'outline', languages: ['php', 'ruby', 'cpp'], owner: '31' },
  { capability: 'outline', languages: ['kotlin'], owner: '30k' },

  { capability: 'codeIndex', languages: ['tsx'], owner: '29b' },
  { capability: 'codeIndex', languages: ['java', 'rust'], owner: '30' },
  { capability: 'codeIndex', languages: ['php', 'ruby', 'cpp'], owner: '31' },
  { capability: 'codeIndex', languages: ['kotlin'], owner: '30k' },

  { capability: 'enrichSummary', languages: ['tsx'], owner: '29b' },

  {
    capability: 'syntaxDiagnostics',
    languages: ['python', 'go', 'csharp'],
    owner: '27',
  },
  {
    capability: 'syntaxDiagnostics',
    languages: ['java', 'rust'],
    owner: '30',
  },
  {
    capability: 'syntaxDiagnostics',
    languages: ['php', 'ruby', 'cpp'],
    owner: '31',
  },
  { capability: 'syntaxDiagnostics', languages: ['kotlin'], owner: '30k' },

  { capability: 'publicSymbols', languages: ['python', 'go'], owner: '33' },
  { capability: 'publicSymbols', languages: ['csharp'], owner: '34' },

  { capability: 'graphEdges', languages: ['python', 'go'], owner: '33' },
  { capability: 'graphEdges', languages: ['csharp'], owner: '34' },

  { capability: 'typeCheck', languages: ['go'], owner: '37b' },
];

function capabilityLanguageKeys(): string[] {
  const keys: string[] = [];
  for (const row of CAPABILITY_TABLE) {
    for (const language of row.languages) {
      keys.push(`${row.capability}:${language}`);
    }
  }
  return keys;
}

/** Every key the matrix knows about — the union every activation fragment draws from. */
export const REQUIRED_KEYS: readonly string[] = [
  ...capabilityLanguageKeys(),
  ...HONESTY_KEYS,
];

/** `REQUIRED_KEYS`, deduplicated and lexicographically sorted. */
export function sortedRequiredKeys(): readonly string[] {
  return [...new Set(REQUIRED_KEYS)].sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
}

/** Owner lookup for a `<capability>:<language>` key (honesty keys have no owner row). */
export function ownerOf(key: string): string | undefined {
  for (const row of CAPABILITY_TABLE) {
    for (const language of row.languages) {
      if (`${row.capability}:${language}` === key) return row.owner;
    }
  }
  return undefined;
}
