import { SupportedLanguage } from './ast.types';

// Define language identifiers
export type { SupportedLanguage };

// --- Language Configuration ---

export const EXTENSION_LANGUAGE_MAP: Readonly<
  Record<string, SupportedLanguage>
> = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
};

export const LANGUAGE_GRAMMAR_MAP: Readonly<Record<SupportedLanguage, string>> =
  {
    // Use package names directly for potentially more robust resolution, especially post-build
    javascript: 'tree-sitter-javascript',
    typescript: 'tree-sitter-typescript',
  };

// --- Tree-sitter Queries ---
// Group queries by language for better organization

export interface LanguageQueries {
  functionQuery: string;
  classQuery: string;
}

// Removed JS queries as well to resolve runtime errors
// const JS_FUNCTION_QUERY = `...`; // Content removed for brevity
// const JS_CLASS_QUERY = `...`; // Content removed for brevity

export const LANGUAGE_QUERIES_MAP: Readonly<
  Record<SupportedLanguage, LanguageQueries>
> = {
  javascript: { functionQuery: '', classQuery: '' }, // Removed problematic queries
  typescript: { functionQuery: '', classQuery: '' }, // Removed problematic queries
};
