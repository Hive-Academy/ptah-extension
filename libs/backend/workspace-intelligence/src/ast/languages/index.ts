import type { SupportedLanguage } from '../ast.types';
import { CPP_LANGUAGE } from './cpp.language';
import { CSHARP_LANGUAGE } from './csharp.language';
import { GO_LANGUAGE } from './go.language';
import { JAVA_LANGUAGE } from './java.language';
import { JAVASCRIPT_LANGUAGE } from './javascript.language';
import { PHP_LANGUAGE } from './php.language';
import { PYTHON_LANGUAGE } from './python.language';
import { RUBY_LANGUAGE } from './ruby.language';
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
  php: PHP_LANGUAGE,
  ruby: RUBY_LANGUAGE,
  cpp: CPP_LANGUAGE,
};
