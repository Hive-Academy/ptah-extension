/**
 * Language registry — the one source of truth for which language holds which
 * capability on this host.
 *
 * Every language-bound tool reads its `supportedLanguages` claim here
 * (`supportedLanguagesFor`) instead of keeping its own list, so the claim a
 * tool makes in its coverage, its unsupported-language answer and (Batch 24c)
 * its description cannot drift apart.
 *
 * Capabilities are deliberately SEPARATE (TASK_2026_559
 * implementation-plan-languages.md, "Registry"; review r2 finding 1): a
 * language can be in the SQLite code index (`codeIndex`, function/class
 * chunks) long before its exports or public declarations are extracted
 * (`publicSymbols`), so "Python is searchable" and "Python `queryExports`
 * works" are different claims.
 *
 * What is derived and what is declared:
 * - Every parsed language is a module in `./languages/` — the same modules
 *   `tree-sitter.config.ts` assembles for the parser. `extensions`,
 *   `grammarFile`, `parse` and `publicSymbols` derive from the module
 *   (`publicSymbols` from its `exportQuery`), so the registry cannot claim a
 *   parse or an export query the parser does not have.
 * - The remaining capabilities are implemented outside this module (the
 *   outliner in vscode-lm-tools, the enrichment gate, the code-symbol indexer,
 *   the Electron definition fallback), so each language module declares them
 *   (`capabilities`); `languages/types.ts` cites where each is implemented.
 * - Languages with no grammar yet keep an entry with their extensions and no
 *   capability, so a `.java` file counts as `unsupported` under `java` instead
 *   of disappearing. Grammar batches (29b-31, 30k) turn them on.
 */
import {
  LANGUAGE_IDS,
  RECOGNISED_LANGUAGE_IDS,
  type LanguageId,
  type RecognisedLanguageId,
} from '@ptah-extension/platform-core';
import type { SupportedLanguage } from './ast.types';
import { LANGUAGE_MODULES } from './languages';

/** How a language's dependency edges are drawn. */
export interface GraphEdgesCapability {
  readonly granularity: 'file' | 'package' | 'namespace';
  /**
   * Whether graph dependents bound where a declaration can be referenced, so
   * the graph may narrow a reference search for this language. Per-query
   * evidence (clean resolution, complete census) is still required on top.
   */
  readonly referenceScopeComplete: boolean;
}

export interface LanguageCapabilities {
  /** A tree-sitter grammar is bundled and loads for this language. */
  readonly parse: boolean;
  /** The outline reducer / `ptah_ast_analyze` outline covers it. */
  readonly outline: boolean;
  /** `ptah_context_enrich_file` produces a structural summary. */
  readonly enrichSummary: boolean;
  /** The SQLite code index stores its function/class chunks. */
  readonly codeIndex: boolean;
  /** Export / public-declaration extraction (graph export index, `queryExports`). */
  readonly publicSymbols: boolean;
  /** Dependency-graph edges, or `null` when the graph has none for it. */
  readonly graphEdges: GraphEdgesCapability | null;
  /** Definition lookup without a language server (Electron index fallback). */
  readonly definitionFallback: boolean;
  /** A syntax-only (no process) diagnostics check. */
  readonly syntaxDiagnostics: boolean;
}

export type LanguageCapability = keyof LanguageCapabilities;

export interface LanguageRegistryEntry {
  readonly id: LanguageId;
  /** Lower-case extensions (leading dot) the capabilities apply to. */
  readonly extensions: readonly string[];
  /**
   * Source extensions of this language that no capability covers yet; they
   * are recognised (counted as `unsupported`), never analysed.
   */
  readonly recognitionOnlyExtensions: readonly string[];
  readonly grammarFile: string | null;
  readonly capabilities: LanguageCapabilities;
}

/**
 * Extensions of languages with no grammar yet. `tsx` has none on purpose:
 * `.tsx` parses with the TypeScript grammar (`typescript.language.ts`) until
 * Batch 29b gives it its own grammar. `.c`/`.h` belong to `cpp` (Decision 19).
 */
const UNPARSED_LANGUAGE_EXTENSIONS: Readonly<
  Record<Exclude<LanguageId, SupportedLanguage>, readonly string[]>
> = {
  tsx: [],
  java: ['.java'],
  kotlin: ['.kt', '.kts'],
  rust: ['.rs'],
  php: ['.php', '.phtml'],
  ruby: ['.rb', '.rake'],
  cpp: ['.cpp', '.cc', '.cxx', '.c++', '.hpp', '.hh', '.hxx', '.c', '.h'],
};

/** Source languages recognised for `unsupportedByLanguage`, never analysed. */
const RECOGNISED_LANGUAGE_EXTENSIONS: Readonly<
  Record<RecognisedLanguageId, readonly string[]>
> = {
  swift: ['.swift'],
  scala: ['.scala', '.sc'],
  dart: ['.dart'],
  elixir: ['.ex', '.exs'],
  lua: ['.lua'],
  haskell: ['.hs', '.lhs'],
  clojure: ['.clj', '.cljs', '.cljc'],
  objc: ['.m', '.mm'],
  r: ['.r'],
};

const NO_CAPABILITIES: LanguageCapabilities = {
  parse: false,
  outline: false,
  enrichSummary: false,
  codeIndex: false,
  publicSymbols: false,
  graphEdges: null,
  definitionFallback: false,
  syntaxDiagnostics: false,
};

function isParsedLanguage(id: LanguageId): id is SupportedLanguage {
  return Object.hasOwn(LANGUAGE_MODULES, id);
}

function buildEntry(id: LanguageId): LanguageRegistryEntry {
  if (!isParsedLanguage(id)) {
    return {
      id,
      extensions: UNPARSED_LANGUAGE_EXTENSIONS[id],
      recognitionOnlyExtensions: [],
      grammarFile: null,
      capabilities: NO_CAPABILITIES,
    };
  }
  const language = LANGUAGE_MODULES[id];
  return {
    id,
    extensions: language.extensions,
    recognitionOnlyExtensions: language.recognitionOnlyExtensions,
    grammarFile: language.grammarFile,
    capabilities: {
      parse: true,
      publicSymbols: language.queries.exportQuery !== '',
      ...language.capabilities,
    },
  };
}

/** Every capability-bearing language, keyed by id, in `LANGUAGE_IDS` order. */
export const LANGUAGE_REGISTRY: Readonly<
  Record<LanguageId, LanguageRegistryEntry>
> = Object.fromEntries(
  LANGUAGE_IDS.map((id) => [id, buildEntry(id)]),
) as Record<LanguageId, LanguageRegistryEntry>;

/** Extensions whose files the language's capabilities actually cover. */
const ANALYSED_EXTENSION_TO_LANGUAGE: ReadonlyMap<string, LanguageId> = new Map(
  LANGUAGE_IDS.flatMap((id) =>
    LANGUAGE_REGISTRY[id].extensions.map(
      (extension) => [extension, id] as const,
    ),
  ),
);

const EXTENSION_TO_LANGUAGE: ReadonlyMap<
  string,
  LanguageId | RecognisedLanguageId
> = new Map<string, LanguageId | RecognisedLanguageId>([
  ...ANALYSED_EXTENSION_TO_LANGUAGE,
  ...LANGUAGE_IDS.flatMap((id) =>
    LANGUAGE_REGISTRY[id].recognitionOnlyExtensions.map(
      (extension) => [extension, id] as const,
    ),
  ),
  ...RECOGNISED_LANGUAGE_IDS.flatMap((id) =>
    RECOGNISED_LANGUAGE_EXTENSIONS[id].map(
      (extension) => [extension, id] as const,
    ),
  ),
]);

/**
 * Every extension a registry or recognised language claims, lower-case with
 * the leading dot: what a census must discover to count `unsupported` files
 * as well as the ones it analyses (the code-symbol indexer's discovery).
 */
export function recognisedSourceExtensions(): readonly string[] {
  return [...EXTENSION_TO_LANGUAGE.keys()];
}

/** Whether `language` holds `capability` on this host. */
export function hasCapability(
  language: LanguageId,
  capability: LanguageCapability,
): boolean {
  const value = LANGUAGE_REGISTRY[language].capabilities[capability];
  return value !== false && value !== null;
}

/**
 * The `supportedLanguages` claim for a tool built on `capability`, in
 * `LANGUAGE_IDS` order. This is the only list a tool may advertise.
 */
export function supportedLanguagesFor(
  capability: LanguageCapability,
): readonly LanguageId[] {
  return LANGUAGE_IDS.filter((id) => hasCapability(id, capability));
}

/**
 * The language a file extension belongs to (`'.py'`, case-insensitive), a
 * recognised-but-unsupported language, or `null` when no registry language
 * claims it (see `classifyFileForCoverage` for where such a file lands).
 */
export function languageForExtension(
  extension: string,
): LanguageId | RecognisedLanguageId | null {
  return EXTENSION_TO_LANGUAGE.get(extension.toLowerCase()) ?? null;
}

/**
 * Whether a file with this extension is covered by `capability`. Per
 * extension, not per language: `.mjs` is JavaScript but not analysed yet, so
 * a census puts it in `unsupported` even though JavaScript has `codeIndex`.
 */
export function extensionHasCapability(
  extension: string,
  capability: LanguageCapability,
): boolean {
  const language = ANALYSED_EXTENSION_TO_LANGUAGE.get(extension.toLowerCase());
  return language !== undefined && hasCapability(language, capability);
}

/**
 * Documented non-source extensions. Rule: a file that is SOURCE a code tool
 * could analyse — text that can hold executable code or imports — is never
 * non-source. Artefacts are not source, even when they hold compiled code, so
 * they are counted here and never qualify an answer (review r3). What is here:
 * - prose docs (`.md` is text; `.mdx` is a module with imports and JSX, so it
 *   is absent);
 * - data/config formats, by accepted policy (review r2): commands or
 *   expressions embedded in them are strings run by other tools, and the
 *   tools here do not analyse them — JSON, YAML, TOML, INI, XML, CSV;
 * - lockfiles (`.lock`; `go.sum` and friends are in the base-name list);
 * - raster images, fonts, audio and video, and PDF documents;
 * - build artefacts: archives and packages, compiled binaries and bytecode,
 *   and source maps (generated output of source that is analysed at its own
 *   path).
 * Deliberately absent (they surface as `unrecognised`): `.mdx`, `.svg`
 * (a text format that can embed `<script>`; kept conservative), and every
 * code-like text format (`.sh`, `.sql`, `.html`, `.css`, `.vue`). The list is
 * CLOSED and pinned by `language-registry.spec.ts`; an addition is a
 * deliberate decision.
 */
export const NON_SOURCE_EXTENSIONS: readonly string[] = [
  // prose docs
  '.md',
  '.markdown',
  '.txt',
  '.rst',
  '.adoc',
  // data and config (policy)
  '.json',
  '.jsonc',
  '.json5',
  '.yaml',
  '.yml',
  '.toml',
  '.ini',
  '.cfg',
  '.conf',
  '.properties',
  '.xml',
  '.csv',
  '.tsv',
  // lockfiles
  '.lock',
  // raster images
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.webp',
  '.avif',
  '.bmp',
  '.ico',
  // fonts
  '.woff',
  '.woff2',
  '.ttf',
  '.otf',
  '.eot',
  // audio and video
  '.mp3',
  '.mp4',
  '.wav',
  '.webm',
  '.mov',
  // documents
  '.pdf',
  // build artefacts: archives and packages
  '.zip',
  '.tar',
  '.gz',
  '.tgz',
  '.bz2',
  '.xz',
  '.7z',
  '.jar',
  '.war',
  '.nupkg',
  '.whl',
  // build artefacts: compiled binaries and bytecode
  '.dll',
  '.so',
  '.dylib',
  '.exe',
  '.class',
  '.pyc',
  '.o',
  '.obj',
  '.a',
  '.lib',
  '.wasm',
  // build artefacts: source maps
  '.map',
];

/**
 * Documented non-source file names (lower-case, whole base name): licence and
 * readme-style prose without an extension, and tool dotfiles holding data.
 */
export const NON_SOURCE_FILE_NAMES: readonly string[] = [
  'license',
  'licence',
  'copying',
  'notice',
  'authors',
  'contributors',
  'changelog',
  'readme',
  'codeowners',
  '.gitignore',
  '.gitattributes',
  '.gitmodules',
  '.editorconfig',
  '.npmrc',
  '.nvmrc',
  '.yarnrc',
  '.prettierrc',
  '.prettierignore',
  '.eslintignore',
  '.dockerignore',
  '.env',
  '.ds_store',
  // checksum files without a lockfile extension
  'go.sum',
  'go.work.sum',
];

/**
 * Build and source files known by their base name (lower-case). A base-name
 * rule outranks every extension rule, so `CMakeLists.txt` and `build.xml`
 * are never non-source because of `.txt` / `.xml`; they are `unrecognised`.
 */
export const CODE_FILE_NAMES: readonly string[] = [
  'makefile',
  'gnumakefile',
  'dockerfile',
  'containerfile',
  'jenkinsfile',
  'rakefile',
  'gemfile',
  'podfile',
  'vagrantfile',
  'brewfile',
  'fastfile',
  'procfile',
  'justfile',
  'tiltfile',
  'cmakelists.txt',
  'build',
  'build.bazel',
  'workspace',
  'workspace.bazel',
  'module.bazel',
  'meson.build',
  'sconstruct',
  'sconscript',
  'build.xml',
];

const NON_SOURCE_EXTENSION_SET: ReadonlySet<string> = new Set(
  NON_SOURCE_EXTENSIONS,
);
const NON_SOURCE_FILE_NAME_SET: ReadonlySet<string> = new Set(
  NON_SOURCE_FILE_NAMES,
);
const CODE_FILE_NAME_SET: ReadonlySet<string> = new Set(CODE_FILE_NAMES);

/** Where one in-scope file lands in a census for `capability`. */
export type CoverageFileClass =
  'eligible' | 'unsupported' | 'unrecognised' | 'nonSource';

function baseNameOf(filePath: string): string {
  const cut = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  return filePath.slice(cut + 1).toLowerCase();
}

/** `path.extname` semantics: a leading dot alone (`.gitignore`) is no extension. */
function extensionOf(baseName: string): string {
  const dot = baseName.lastIndexOf('.');
  return dot > 0 ? baseName.slice(dot) : '';
}

/**
 * The census rule every coverage producer applies to an in-scope file:
 * - `eligible`: the extension is covered by `capability` (the producer then
 *   records `analyzed`, `failed`, `unchecked` or `omittedByCap`);
 * - `unsupported`: a registry or recognised language claims it, but not with
 *   this capability (includes recognition-only suffixes such as `.mjs`);
 * - `unrecognised`: a known build/source base name (`CODE_FILE_NAMES`, which
 *   outranks the extension lists), an unknown extension, or anything else;
 * - `nonSource`: on the documented non-source lists and nothing above.
 */
export function classifyFileForCoverage(
  filePath: string,
  capability: LanguageCapability,
): CoverageFileClass {
  const baseName = baseNameOf(filePath);
  const extension = extensionOf(baseName);
  if (extensionHasCapability(extension, capability)) {
    return 'eligible';
  }
  if (languageForExtension(extension) !== null) {
    return 'unsupported';
  }
  // Base-name rules outrank extension rules: CMakeLists.txt is code, not text.
  if (CODE_FILE_NAME_SET.has(baseName)) {
    return 'unrecognised';
  }
  if (
    NON_SOURCE_FILE_NAME_SET.has(baseName) ||
    NON_SOURCE_EXTENSION_SET.has(extension)
  ) {
    return 'nonSource';
  }
  return 'unrecognised';
}
