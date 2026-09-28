/**
 * Language registry + coverage size contract (TASK_2026_559 Batch 22,
 * Task 22.2).
 *
 * Fails before Batch 22: this file and `language-registry.ts` did not exist,
 * and platform-core exported no `LanguageCoverage`, so "worst-case coverage
 * <= 1,000 chars" and "codeIndex and publicSymbols are separate" could not
 * compile, let alone pass.
 *
 * Later-batch expectations pinned here (update them in the batch that changes
 * them, never silently):
 * - `tsx` has its own grammar since Batch 29b (parse, outline, enrichSummary,
 *   codeIndex; publicSymbols and file graph edges through the TypeScript
 *   queries; no Electron definition fallback).
 * - `publicSymbols` / `graphEdges` stay TS/JS only until Batches 33-36.
 * - `definitionFallback` gained C# in Batch 26b (the Electron C# declaration
 *   query is proven against the shipped grammar in
 *   `apps/ptah-electron/src/services/electron-ide-capabilities.spec.ts`).
 * - The grammar the parser registers for each language equals
 *   `GRAMMAR_FILE_MAP` until Batch 29a2 makes the parser read the map.
 * - `.mjs/.cjs/.mts/.cts/.pyi/.pyw` are recognition-only (counted as
 *   `unsupported`) until a batch adds them to `EXTENSION_LANGUAGE_MAP` with
 *   their consumers.
 *
 * Revision r1 (`reviews/batch-22-code-logic-review-r1.md`): S1 — common
 * source extensions no longer vanish (recognition-only suffixes and the
 * `unrecognised` bucket); M1 — the grammar guard compares language -> file,
 * not a set of file names.
 */
import 'reflect-metadata';
import { basename } from 'path';
import type { Logger } from '@ptah-extension/vscode-core';

// The parser runs with web-tree-sitter mocked: each loaded "grammar" keeps its
// path, so the grammar handed to a parser reveals which file the parser
// associated with that language (r1 M1).
jest.mock('./wasm-bundle-dir', () => ({
  BUNDLE_DIR: '/mock/bundle',
  resolveWasmPath: (filename: string) => `/mock/bundle/wasm/${filename}`,
}));

const mockSetLanguage = jest.fn();

jest.mock('web-tree-sitter', () => ({
  Parser: Object.assign(
    jest.fn(() => ({
      setLanguage: mockSetLanguage,
      parse: jest.fn().mockReturnValue(null),
      delete: jest.fn(),
    })),
    { init: jest.fn().mockResolvedValue(undefined) },
  ),
  Language: {
    load: jest.fn(async (grammarPath: string) => ({ grammarPath })),
  },
  Query: jest.fn(),
  Edit: jest.fn(),
}));

import {
  COVERAGE_COUNT_MAX,
  FAILURE_REASONS,
  LANGUAGE_IDS,
  MAX_COMPACT_FAILURE_REASONS,
  MAX_REPORTED_APPROXIMATIONS,
  MAX_UNSUPPORTED_LANGUAGE_KEYS,
  RECOGNISED_LANGUAGE_IDS,
  compactCoverage,
  isCleanAnswer,
  withCoverageVerdict,
  type Approximation,
  type Count,
  type CoverageFields,
  type CoverageState,
} from '@ptah-extension/platform-core';
import {
  LANGUAGE_REGISTRY,
  CODE_FILE_NAMES,
  NON_SOURCE_EXTENSIONS,
  NON_SOURCE_FILE_NAMES,
  classifyFileForCoverage,
  extensionHasCapability,
  hasCapability,
  languageForExtension,
  supportedLanguagesFor,
  type LanguageCapability,
} from './language-registry';
import {
  EXTENSION_LANGUAGE_MAP,
  GRAMMAR_FILE_MAP,
  LANGUAGE_QUERIES_MAP,
  type SupportedLanguage,
} from './tree-sitter.config';
import { TreeSitterParserService } from './tree-sitter-parser.service';

const MAX = COVERAGE_COUNT_MAX;

/**
 * The serialised worst case, committed as the fixture for the size contract:
 * every language claimed, `censusLimit` and every count saturated, the longest
 * `state` and `checks` values, the eight longest language keys plus `other`,
 * all six failure reasons (the three longest carrying the largest counts), a full `resolution` (longest literal values), the
 * four LONGEST approximation strings (a bound above what the priority rule can
 * actually keep) and a saturated `approximationsOmitted`.
 */
function longestKeys(): string[] {
  return [...LANGUAGE_IDS, ...RECOGNISED_LANGUAGE_IDS]
    .slice()
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .slice(0, MAX_UNSUPPORTED_LANGUAGE_KEYS);
}

function longestApproximations(): Approximation[] {
  const all: Approximation[] = [
    'resolver-context-partial',
    'text-scan',
    'case-folded',
    'c:parsed-as-cpp',
    'go:package-edges',
    'csharp:namespace-edges',
    'java:package-wildcard',
    ...LANGUAGE_IDS.map((id): Approximation => `${id}:syntax-only`),
  ];
  return all
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .slice(0, MAX_REPORTED_APPROXIMATIONS);
}

/**
 * The failure reasons the compact block keeps by name when every reason is
 * non-zero: the largest counts. The fixture gives the LONGEST names the
 * largest counts (every count still six digits), so the compact worst case
 * keeps the longest names, not the tie-break's first ones.
 */
function longestFailureReasons(): string[] {
  return [...FAILURE_REASONS]
    .sort((a, b) => b.length - a.length || (a < b ? -1 : 1))
    .slice(0, MAX_COMPACT_FAILURE_REASONS);
}

const WORST_FIELDS: CoverageFields = {
  supportedLanguages: [...LANGUAGE_IDS],
  census: 'truncated',
  censusLimit: MAX,
  state: 'incomplete',
  analyzed: MAX,
  unchecked: MAX,
  failed: MAX,
  unsupported: MAX,
  unrecognised: MAX,
  nonSource: MAX,
  excluded: MAX,
  omittedByCap: MAX,
  unsupportedByLanguage: Object.fromEntries([
    ...longestKeys().map((key) => [key, MAX]),
    ['other', MAX],
  ]),
  failedByReason: Object.fromEntries(
    FAILURE_REASONS.map((reason) => [
      reason,
      longestFailureReasons().includes(reason) ? MAX : MAX - 1,
    ]),
  ),
  resolution: {
    external: MAX,
    unresolvedInternal: MAX,
    truncatedImports: MAX,
    edgeCapHit: false,
    context: 'complete',
  },
  approximations: longestApproximations(),
  approximationsOmitted: MAX,
  checks: 'provider-defined',
};

/** The fields as a tool returns them: verdict first (Batch 24r). */
const WORST_CASE = withCoverageVerdict(WORST_FIELDS);

/**
 * Every combination of the values that make the serialised coverage longest:
 * each count saturated or `null` (`null` is shorter, but adds an `unknown-*`
 * reason), every census and state, and every resolution qualifier. The
 * verdict's reasons change with each combination, so the longest object is
 * found, not assumed.
 */
function longestVerdictedCoverage(
  serialise: (fields: CoverageFields) => object = withCoverageVerdict,
): { chars: number; json: string } {
  const counts = [
    'analyzed',
    'unchecked',
    'failed',
    'unsupported',
    'unrecognised',
    'nonSource',
    'excluded',
    'omittedByCap',
  ] as const;
  const censuses = ['complete', 'truncated', 'unknown'] as const;
  const states: (CoverageState | undefined)[] = [
    undefined,
    'current',
    'updating',
    'incomplete',
  ];
  const { state: _unusedState, ...base } = WORST_FIELDS;
  let longest = { chars: 0, json: '' };
  for (let mask = 0; mask < 1 << counts.length; mask++) {
    const patch: Partial<Record<(typeof counts)[number], Count>> = {};
    counts.forEach((key, bit) => {
      patch[key] = mask & (1 << bit) ? null : MAX;
    });
    for (const census of censuses) {
      for (const state of states) {
        for (const unresolvedInternal of [MAX, null]) {
          for (const truncatedImports of [MAX, null]) {
            for (const edgeCapHit of [false, true]) {
              for (const context of ['complete', 'partial'] as const) {
                const json = JSON.stringify(
                  serialise({
                    ...base,
                    ...patch,
                    census,
                    ...(state === undefined ? {} : { state }),
                    resolution: {
                      external: MAX,
                      unresolvedInternal,
                      truncatedImports,
                      edgeCapHit,
                      context,
                    },
                  }),
                );
                if (json.length > longest.chars) {
                  longest = { chars: json.length, json };
                }
              }
            }
          }
        }
      }
    }
  }
  return longest;
}

/**
 * Measured length of the longest verdicted coverage, the FULL shape
 * `execute_code` returns (every failure reason kept). 1,000 at Batch 24r
 * (five failure reasons); 1,028 since the Lane H merge, because Batch 20.2q
 * added the sixth reason `unsupported-syntax` (+27 chars, +1 separator). The
 * full shape is pinned exactly, not bounded: the 1,000-char bound of User
 * Decision 21 applies to the compact block every tool writes (team-leader
 * ruling R1, Lane H merge).
 */
const MEASURED_WORST_CASE_CHARS = 1_028;

/**
 * Measured length of the longest compact coverage: the full worst case
 * without the clean values it can leave out, and with at most
 * {@link MAX_COMPACT_FAILURE_REASONS} named failure reasons plus `other`.
 * 997 at Batch 22c (five reasons, all named); 1,025 with six named reasons
 * (over the bound); 994 since the Lane H merge caps the named reasons at
 * three (ruling R1).
 */
const MEASURED_COMPACT_WORST_CASE_CHARS = 994;

/** The plan's bound ("about 1,000 chars per response"), verdict included. */
const WORST_CASE_BOUND_CHARS = 1_000;

describe('coverage size contract', () => {
  const longest = longestVerdictedCoverage();

  it('pins the measured full worst-case length (execute_code shape) so a contract change is visible', () => {
    expect(longest.chars).toBe(MEASURED_WORST_CASE_CHARS);
  });

  it('the fixed fixture carries its verdict first', () => {
    expect(Object.keys(WORST_CASE).slice(0, 2)).toEqual(['clean', 'reasons']);
    expect(JSON.stringify(WORST_CASE).length).toBeLessThanOrEqual(
      longest.chars,
    );
  });

  // Batch 22c: tools write the compact block (`compactCoverage`); its worst
  // case is a subset of the full one and stays within the same bound. The
  // full shape above still bounds `execute_code`, which returns the objects.
  it('compact worst case, as tools write it, <= 1,000 chars and pinned', () => {
    const compact = longestVerdictedCoverage(compactCoverage);
    expect(compact.chars).toBeLessThanOrEqual(WORST_CASE_BOUND_CHARS);
    expect(compact.chars).toBe(MEASURED_COMPACT_WORST_CASE_CHARS);
    expect(
      JSON.stringify(compactCoverage(WORST_FIELDS)).length,
    ).toBeLessThanOrEqual(JSON.stringify(WORST_CASE).length);
  });

  it('uses the full shape: 9 language keys, 6 reasons, 4 approximations', () => {
    expect(Object.keys(WORST_CASE.unsupportedByLanguage ?? {})).toHaveLength(9);
    expect(Object.keys(WORST_CASE.failedByReason ?? {})).toHaveLength(6);
    expect(WORST_CASE.approximations).toHaveLength(4);
  });
});

describe('language registry', () => {
  it('codeIndex and publicSymbols are separate', () => {
    // Python/Go/C# chunks are in the SQLite code index today while their
    // export extraction is absent (empty exportQuery): one flag must not
    // stand for the other (review r2 finding 1; 24b pins the tool side).
    for (const id of ['python', 'go', 'csharp'] as const) {
      expect(hasCapability(id, 'codeIndex')).toBe(true);
      expect(hasCapability(id, 'publicSymbols')).toBe(false);
    }
    expect(supportedLanguagesFor('codeIndex')).not.toEqual(
      supportedLanguagesFor('publicSymbols'),
    );
  });

  it.each<[LanguageCapability, string[]]>([
    [
      'parse',
      [
        'typescript',
        'javascript',
        'tsx',
        'python',
        'go',
        'csharp',
        'java',
        'kotlin',
        'rust',
        'php',
        'ruby',
        'cpp',
      ],
    ],
    [
      'outline',
      [
        'typescript',
        'javascript',
        'tsx',
        'python',
        'go',
        'csharp',
        'java',
        'kotlin',
        'rust',
        'php',
        'ruby',
        'cpp',
      ],
    ],
    ['enrichSummary', ['typescript', 'javascript', 'tsx']],
    [
      'codeIndex',
      [
        'typescript',
        'javascript',
        'tsx',
        'python',
        'go',
        'csharp',
        'java',
        'kotlin',
        'rust',
        'php',
        'ruby',
        'cpp',
      ],
    ],
    ['publicSymbols', ['typescript', 'javascript', 'tsx']],
    ['graphEdges', ['typescript', 'javascript', 'tsx']],
    [
      'definitionFallback',
      ['typescript', 'javascript', 'python', 'go', 'csharp'],
    ],
    [
      'syntaxDiagnostics',
      [
        'python',
        'go',
        'csharp',
        'java',
        'kotlin',
        'rust',
        'php',
        'ruby',
        'cpp',
      ],
    ],
  ])('initial %s languages', (capability, expected) => {
    expect(supportedLanguagesFor(capability)).toEqual(expected);
  });

  it('draws TS/JS/TSX graph edges per file', () => {
    // Batch 26b r1 B2: the edges do not bound references (global scripts,
    // re-exports, require, dynamic import, unmapped aliases), so TS/JS do not
    // claim referenceScopeComplete and reference lookups never narrow on them.
    for (const id of ['typescript', 'javascript', 'tsx'] as const) {
      expect(LANGUAGE_REGISTRY[id].capabilities.graphEdges).toEqual({
        granularity: 'file',
        referenceScopeComplete: false,
      });
    }
  });

  it('has an entry for every language id and no capability without a grammar', () => {
    expect(Object.keys(LANGUAGE_REGISTRY)).toEqual([...LANGUAGE_IDS]);
    for (const id of LANGUAGE_IDS) {
      const entry = LANGUAGE_REGISTRY[id];
      expect(entry.id).toBe(id);
      if (entry.grammarFile === null) {
        for (const capability of Object.keys(
          entry.capabilities,
        ) as LanguageCapability[]) {
          expect(hasCapability(id, capability)).toBe(false);
        }
      } else {
        expect(entry.capabilities.parse).toBe(true);
      }
    }
  });

  it('derives parsed-language extensions, grammars and export support from the config maps', () => {
    for (const [extension, language] of Object.entries(
      EXTENSION_LANGUAGE_MAP,
    )) {
      expect(LANGUAGE_REGISTRY[language].extensions).toContain(extension);
      expect(languageForExtension(extension)).toBe(language);
    }
    for (const [language, grammarFile] of Object.entries(GRAMMAR_FILE_MAP)) {
      const id = language as keyof typeof GRAMMAR_FILE_MAP;
      expect(LANGUAGE_REGISTRY[id].grammarFile).toBe(grammarFile);
      expect(LANGUAGE_REGISTRY[id].capabilities.publicSymbols).toBe(
        LANGUAGE_QUERIES_MAP[id].exportQuery !== '',
      );
    }
  });

  it('gives .tsx its own tsx grammar (Batch 29b)', () => {
    expect(languageForExtension('.tsx')).toBe('tsx');
    expect(languageForExtension('.ts')).toBe('typescript');
    expect(LANGUAGE_REGISTRY.tsx.extensions).toEqual(['.tsx']);
    expect(LANGUAGE_REGISTRY.tsx.grammarFile).toBe('tree-sitter-tsx.wasm');
    expect(LANGUAGE_REGISTRY.typescript.extensions).toEqual(['.ts']);
  });

  it('maps .c and .h to cpp (no separate c id)', () => {
    expect(languageForExtension('.c')).toBe('cpp');
    expect(languageForExtension('.h')).toBe('cpp');
    expect(languageForExtension('.cpp')).toBe('cpp');
  });

  it('recognises unsupported source languages', () => {
    expect(languageForExtension('.kt')).toBe('kotlin');
    expect(languageForExtension('.ex')).toBe('elixir');
    expect(languageForExtension('.swift')).toBe('swift');
    expect(languageForExtension('.R')).toBe('r');
    expect(languageForExtension('.exs')).toBe('elixir');
    for (const id of RECOGNISED_LANGUAGE_IDS) {
      expect(LANGUAGE_IDS as readonly string[]).not.toContain(id);
    }
  });

  it('is case-insensitive and returns null for non-source extensions', () => {
    expect(languageForExtension('.PY')).toBe('python');
    expect(languageForExtension('.md')).toBeNull();
    expect(languageForExtension('')).toBeNull();
  });

  it('assigns every extension to exactly one language', () => {
    const seen = new Map<string, string>();
    for (const id of LANGUAGE_IDS) {
      const entry = LANGUAGE_REGISTRY[id];
      for (const extension of [
        ...entry.extensions,
        ...entry.recognitionOnlyExtensions,
      ]) {
        expect(extension).toBe(extension.toLowerCase());
        expect(seen.get(extension)).toBeUndefined();
        seen.set(extension, id);
        // A recognised-language list reusing it would override this entry.
        expect(languageForExtension(extension)).toBe(id);
      }
    }
    // No documented non-source extension may shadow a source language.
    for (const extension of NON_SOURCE_EXTENSIONS) {
      expect(languageForExtension(extension)).toBeNull();
    }
  });
});

/**
 * Models the census a later producer (23b/24b/25a) runs with the registry's
 * own rule (`classifyFileForCoverage`); every eligible file is assumed to be
 * analysed successfully.
 */
function censusOf(
  files: readonly string[],
  capability: LanguageCapability,
): CoverageFields {
  const counts = { eligible: 0, unsupported: 0, unrecognised: 0, nonSource: 0 };
  for (const file of files) {
    counts[classifyFileForCoverage(file, capability)] += 1;
  }
  return {
    supportedLanguages: supportedLanguagesFor(capability),
    census: 'complete',
    analyzed: counts.eligible,
    unchecked: 0,
    failed: 0,
    unsupported: counts.unsupported,
    unrecognised: counts.unrecognised,
    nonSource: counts.nonSource,
    excluded: 0,
    omittedByCap: 0,
  };
}

describe('recognition never loses a source file (r1 S1)', () => {
  // Fails before r1: `.mjs/.cjs/.mts/.cts/.pyi` returned null, so a census
  // counting only recognised files reported these repositories clean.
  it.each([
    ['.mjs', 'javascript'],
    ['.cjs', 'javascript'],
    ['.mts', 'typescript'],
    ['.cts', 'typescript'],
    ['.pyi', 'python'],
    ['.pyw', 'python'],
    ['.kts', 'kotlin'],
    ['.hpp', 'cpp'],
    ['.hh', 'cpp'],
    ['.cc', 'cpp'],
    ['.cxx', 'cpp'],
    ['.h', 'cpp'],
    ['.rb', 'ruby'],
    ['.rake', 'ruby'],
    ['.php', 'php'],
    ['.java', 'java'],
    ['.rs', 'rust'],
    ['.go', 'go'],
    ['.cs', 'csharp'],
    ['.csx', 'csharp'],
  ])('recognises %s as %s', (extension, language) => {
    expect(languageForExtension(extension)).toBe(language);
  });

  it('grants no capability to a recognition-only suffix', () => {
    for (const id of LANGUAGE_IDS) {
      const entry = LANGUAGE_REGISTRY[id];
      for (const extension of entry.recognitionOnlyExtensions) {
        for (const capability of Object.keys(
          entry.capabilities,
        ) as LanguageCapability[]) {
          expect(extensionHasCapability(extension, capability)).toBe(false);
        }
      }
    }
    expect(extensionHasCapability('.mjs', 'codeIndex')).toBe(false);
    expect(extensionHasCapability('.js', 'codeIndex')).toBe(true);
    expect(extensionHasCapability('.JS', 'codeIndex')).toBe(true);
    expect(extensionHasCapability('.swift', 'parse')).toBe(false);
    expect(extensionHasCapability('.xyz', 'parse')).toBe(false);
  });

  it.each([
    [['src/a.mjs']],
    [['src/a.cjs']],
    [['src/a.mts']],
    [['src/a.cts']],
    [['stubs/a.pyi']],
    [['src/a.xyz']],
    [['src/a.ts', 'src/b.mjs', 'typings/c.pyi', 'src/d.xyz']],
  ])('a census over %p is never clean', (files) => {
    const coverage = censusOf(files, 'codeIndex');
    expect(isCleanAnswer(coverage)).toBe(false);
    expect(
      (coverage.analyzed ?? 0) +
        (coverage.unsupported ?? 0) +
        (coverage.unrecognised ?? 0) +
        (coverage.nonSource ?? 0),
    ).toBe(files.length);
  });

  it('a census over analysed files only is clean', () => {
    expect(
      isCleanAnswer(censusOf(['src/a.ts', 'src/b.py', 'c.go'], 'codeIndex')),
    ).toBe(true);
  });
});

describe('non-source classification (orchestrator ruling)', () => {
  // Fails before the ruling: no non-source classification existed, so these
  // files were `unrecognised` and every workspace answer was qualified.
  it('a census over README.md + package.json + logo.png is clean', () => {
    const coverage = censusOf(
      ['README.md', 'package.json', 'assets/logo.png'],
      'codeIndex',
    );
    expect(coverage.nonSource).toBe(3);
    expect(coverage.unrecognised).toBe(0);
    expect(isCleanAnswer(coverage)).toBe(true);
  });

  it.each([
    [['README.md', 'package.json', 'src/main.zig']],
    [['README.md', 'tools/gen.xyz']],
    [['src/a.ts', 'scripts/deploy.sh']],
    [['Dockerfile']],
  ])(
    'a census containing code-like or unknown files is not clean: %p',
    (files) => {
      const coverage = censusOf(files, 'codeIndex');
      expect(coverage.unrecognised).toBeGreaterThan(0);
      expect(isCleanAnswer(coverage)).toBe(false);
    },
  );

  it.each([
    ['README.md', 'nonSource'],
    ['docs/LICENSE', 'nonSource'],
    ['C:\\repo\\.gitignore', 'nonSource'],
    ['yarn.lock', 'nonSource'],
    ['src/app.ts', 'eligible'],
    ['src/APP.TS', 'eligible'],
    ['src/esm.mjs', 'unsupported'],
    ['lib/mix.ex', 'unsupported'],
    ['src/Widget.swift', 'unsupported'],
    ['src/main.zig', 'unrecognised'],
    ['web/index.html', 'unrecognised'],
    ['web/site.css', 'unrecognised'],
    ['db/schema.sql', 'unrecognised'],
    ['Makefile', 'unrecognised'],
    ['Dockerfile', 'unrecognised'],
    ['notes', 'unrecognised'],
  ])('classifies %s as %s for codeIndex', (file, expected) => {
    expect(classifyFileForCoverage(file, 'codeIndex')).toBe(expected);
  });

  it('pins the documented lists (additions are deliberate)', () => {
    expect([...NON_SOURCE_EXTENSIONS]).toEqual([
      '.md',
      '.markdown',
      '.txt',
      '.rst',
      '.adoc',
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
      '.lock',
      '.png',
      '.jpg',
      '.jpeg',
      '.gif',
      '.webp',
      '.avif',
      '.bmp',
      '.ico',
      '.woff',
      '.woff2',
      '.ttf',
      '.otf',
      '.eot',
      '.mp3',
      '.mp4',
      '.wav',
      '.webm',
      '.mov',
      '.pdf',
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
      '.map',
    ]);
    expect([...NON_SOURCE_FILE_NAMES]).toEqual([
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
      'go.sum',
      'go.work.sum',
    ]);
    expect([...CODE_FILE_NAMES]).toEqual([
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
    ]);
  });

  it('keeps code-like names off the non-source lists', () => {
    for (const codeLike of [
      '.sh',
      '.sql',
      '.html',
      '.css',
      '.vue',
      '.svelte',
      '.mdx',
      '.svg',
    ]) {
      expect(NON_SOURCE_EXTENSIONS).not.toContain(codeLike);
    }
    for (const buildFile of CODE_FILE_NAMES) {
      expect(NON_SOURCE_FILE_NAMES).not.toContain(buildFile);
    }
  });
});

describe('code files are never non-source (r2 R2-S1)', () => {
  // Fails before r2: `.mdx` and `.txt` were non-source with no base-name
  // precedence, so each one-file census below reported clean with 0 analysed.
  it.each([
    [['docs/index.mdx']],
    [['CMakeLists.txt']],
    [['native/CMakeLists.txt']],
    [['build.xml']],
    [['assets/icon.svg']],
    [['tools/build.zig']],
  ])('a one-file census over %p is not clean', (files) => {
    const coverage = censusOf(files, 'codeIndex');
    expect(coverage.analyzed).toBe(0);
    expect(coverage.unrecognised).toBe(1);
    expect(isCleanAnswer(coverage)).toBe(false);
  });

  it('lets a base-name rule outrank the .txt / .xml extension rules', () => {
    expect(classifyFileForCoverage('CMakeLists.txt', 'parse')).toBe(
      'unrecognised',
    );
    expect(classifyFileForCoverage('C:\\proj\\CMAKELISTS.TXT', 'parse')).toBe(
      'unrecognised',
    );
    expect(classifyFileForCoverage('notes.txt', 'parse')).toBe('nonSource');
    expect(classifyFileForCoverage('build.xml', 'parse')).toBe('unrecognised');
    expect(classifyFileForCoverage('pom.xml', 'parse')).toBe('nonSource');
  });

  it.each(CODE_FILE_NAMES.map((name) => [name]))(
    'classifies the code file name %s as unrecognised',
    (name) => {
      expect(classifyFileForCoverage(`repo/${name}`, 'codeIndex')).toBe(
        'unrecognised',
      );
    },
  );
});

describe('artefacts are counted but never qualify (r3 R3-S1)', () => {
  // Fails before the bounded correction: r2 dropped artefacts and checksum
  // files from the non-source lists, so each landed in `unrecognised` and a
  // clean source census turned non-clean without any source being skipped.
  it('main.go + go.sum is clean', () => {
    const coverage = censusOf(['cmd/main.go', 'go.sum'], 'codeIndex');
    expect(coverage).toMatchObject({
      analyzed: 1,
      nonSource: 1,
      unrecognised: 0,
    });
    expect(isCleanAnswer(coverage)).toBe(true);
  });

  it('a clean source census plus PDF, ZIP and DLL stays clean', () => {
    const source = ['src/main.ts', 'LICENSE', 'package.json', 'logo.png'];
    const artefacts = ['docs/guide.pdf', 'backup.zip', 'bin/native.dll'];
    const before = censusOf(source, 'codeIndex');
    const after = censusOf([...source, ...artefacts], 'codeIndex');
    expect(isCleanAnswer(before)).toBe(true);
    expect(isCleanAnswer(after)).toBe(true);
    expect(after.analyzed).toBe(before.analyzed);
    expect(after.nonSource).toBe((before.nonSource ?? 0) + artefacts.length);
    expect(after.unrecognised).toBe(0);
  });

  it.each([
    'docs/guide.pdf',
    'dist/app.js.map',
    'dist/bundle.tar.gz',
    'vendor/lib.jar',
    'target/app.war',
    'packages/Acme.1.0.0.nupkg',
    'dist/pkg-1.0-py3-none-any.whl',
    'bin/App.class',
    '__pycache__/m.cpython-312.pyc',
    'build/main.o',
    'build/main.obj',
    'build/libfoo.a',
    'build/foo.lib',
    'lib/libfoo.so',
    'lib/libfoo.dylib',
    'bin/tool.exe',
    'assets/parser.wasm',
    'go.sum',
    'go.work.sum',
    'Cargo.lock',
    'Gemfile.lock',
    'poetry.lock',
    'composer.lock',
    'yarn.lock',
    'package-lock.json',
    'pnpm-lock.yaml',
  ])('classifies the artefact %s as nonSource', (file) => {
    expect(classifyFileForCoverage(file, 'codeIndex')).toBe('nonSource');
  });

  it('keeps MDX, CMakeLists.txt and unknown code non-clean next to artefacts', () => {
    for (const codeFile of ['docs/page.mdx', 'CMakeLists.txt', 'x/y.zig']) {
      const coverage = censusOf(
        ['src/main.ts', 'go.sum', 'lib.dll', codeFile],
        'codeIndex',
      );
      expect(coverage.unrecognised).toBe(1);
      expect(isCleanAnswer(coverage)).toBe(false);
    }
  });
});

/** Languages whose observed grammar file differs from the expected map. */
function grammarAssociationMismatches(
  observed: Readonly<Record<string, string>>,
  expected: Readonly<Record<string, string>>,
): string[] {
  const languages = new Set([
    ...Object.keys(observed),
    ...Object.keys(expected),
  ]);
  return [...languages].filter((id) => observed[id] !== expected[id]).sort();
}

async function observeParserGrammars(): Promise<Record<string, string>> {
  const logger = {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  };
  const service = new TreeSitterParserService(logger as unknown as Logger);
  const observed: Record<string, string> = {};
  for (const language of Object.keys(GRAMMAR_FILE_MAP) as SupportedLanguage[]) {
    mockSetLanguage.mockClear();
    // The mocked tree is null, so parse returns an error after the parser is
    // created; only the grammar handed to setLanguage matters here.
    await service.parse('', language);
    const grammar = mockSetLanguage.mock.calls[0]?.[0] as
      { grammarPath: string } | undefined;
    observed[language] = grammar ? basename(grammar.grammarPath) : '<none>';
  }
  return observed;
}

describe('parser grammar association (r1 M1)', () => {
  it('registers the GRAMMAR_FILE_MAP file for each language', async () => {
    const observed = await observeParserGrammars();
    expect(observed).toEqual({ ...GRAMMAR_FILE_MAP });
    expect(grammarAssociationMismatches(observed, GRAMMAR_FILE_MAP)).toEqual(
      [],
    );
  });

  // Fails before r1: the old guard compared sorted file-name sets, which a
  // swap of two languages' files leaves unchanged.
  it('detects two languages swapping grammar files', async () => {
    const observed = await observeParserGrammars();
    const swapped = {
      ...observed,
      javascript: observed['typescript'],
      typescript: observed['javascript'],
    };
    expect(Object.values(swapped).sort()).toEqual(
      Object.values(GRAMMAR_FILE_MAP).sort(),
    );
    expect(grammarAssociationMismatches(swapped, GRAMMAR_FILE_MAP)).toEqual([
      'javascript',
      'typescript',
    ]);
  });
});
