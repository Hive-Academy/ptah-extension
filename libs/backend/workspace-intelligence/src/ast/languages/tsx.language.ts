/**
 * TSX language module (Batch 29b). `.tsx` parses with the shipped TSX grammar
 * (`tree-sitter-tsx.wasm`, @vscode/tree-sitter-wasm), which is the TypeScript
 * grammar plus JSX: every node the TypeScript queries name exists in it, so
 * the TypeScript query set is reused unchanged and JSX-bearing functions are
 * captured by the same function queries. `tsx-grammar.integration.spec.ts`
 * proves the queries against the real grammar.
 */
import type { LanguageModule } from './types';
import { FILE_EDGES } from './javascript.language';
import { TYPESCRIPT_LANGUAGE } from './typescript.language';

export const TSX_LANGUAGE: LanguageModule = {
  id: 'tsx',
  extensions: ['.tsx'],
  recognitionOnlyExtensions: [],
  grammarFile: 'tree-sitter-tsx.wasm',
  queries: TYPESCRIPT_LANGUAGE.queries,
  capabilities: {
    outline: true,
    enrichSummary: true,
    codeIndex: true,
    graphEdges: FILE_EDGES,
    // The Electron index-free declaration scan (`DECLARATION_QUERIES`,
    // `electron-ide-capabilities.ts`) answers `.tsx` as unresolved, so the
    // fallback is not claimed.
    definitionFallback: false,
    syntaxDiagnostics: false,
  },
};
