import type { SupportedLanguage } from '../ast.types';
import { CSHARP_LANGUAGE } from './csharp.language';
import { GO_LANGUAGE } from './go.language';
import { JAVA_LANGUAGE } from './java.language';
import { JAVASCRIPT_LANGUAGE } from './javascript.language';
import { PYTHON_LANGUAGE } from './python.language';
import { RUST_LANGUAGE } from './rust.language';
import { TSX_LANGUAGE } from './tsx.language';
import { TYPESCRIPT_LANGUAGE } from './typescript.language';
import type { LanguageModule } from './types';

/**
 * Every parsed language module, keyed by id. Key order is the order of the
 * assembled maps in `tree-sitter.config.ts` (and so of
 * `EXTENSION_LANGUAGE_MAP`'s keys).
 */
export const LANGUAGE_MODULES: Readonly<
  Record<SupportedLanguage, LanguageModule>
> = {
  javascript: JAVASCRIPT_LANGUAGE,
  typescript: TYPESCRIPT_LANGUAGE,
  tsx: TSX_LANGUAGE,
  python: PYTHON_LANGUAGE,
  go: GO_LANGUAGE,
  csharp: CSHARP_LANGUAGE,
  java: JAVA_LANGUAGE,
  rust: RUST_LANGUAGE,
};
