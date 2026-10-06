/**
 * File-tool ground truth for `ptah_ast_analyze` / `ptah_context_enrich_file`,
 * `ptah_search_files` and `ptah_search_text`, generated from the corpus tree.
 *
 * Every generator takes the corpus root as a parameter, so Batch 9 can drive
 * it through `withPinnedCorpus` later. Nothing here runs `git` or `gh`:
 * the corpus root is a read-only extraction of the pinned commit
 * (`git archive <pin>`), which contains exactly the files
 * `git ls-tree -r --name-only <pin>` lists.
 *
 * - ast questions: eligible files stratified by line count; the truth is the
 *   top-level declaration list from `ts.createSourceFile` per file (no
 *   program, no Batch 5 `ts-program.ts`).
 * - glob questions: patterns built from real corpus directories and
 *   extensions, including a few that match nothing; the truth is picomatch
 *   over the corpus file list.
 * - text questions: literal and regex queries; the truth is a `file:line` set
 *   from a Node line scan of the corpus (skipping `.git` and binaries). `rg`
 *   is the native baseline for the text suite, never the truth.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join, sep } from 'node:path';
import picomatch from 'picomatch';
import * as ts from 'typescript';
import { z } from 'zod';
import { ELIGIBLE_EXTENSIONS } from './relevance-questions';

/** Directories never scanned and never matched by generated patterns. */
const SKIPPED_DIRS: ReadonlySet<string> = new Set(['.git', 'node_modules']);

const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.ico',
  '.icns',
  '.webp',
  '.pdf',
  '.zip',
  '.gz',
  '.tar',
  '.7z',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.node',
  '.wasm',
  '.ttf',
  '.otf',
  '.woff',
  '.woff2',
  '.eot',
  '.mp4',
  '.webm',
  '.mov',
  '.avi',
  '.mp3',
  '.wav',
  '.flac',
  '.ogg',
  '.m4a',
  '.aac',
  '.glb',
  '.sqlite',
  '.db',
]);

interface CorpusFile {
  /** Workspace-relative path with forward slashes. */
  readonly path: string;
  readonly lines: readonly string[];
}

function isBinaryPath(path: string): boolean {
  return [...BINARY_EXTENSIONS].some((ext) => path.endsWith(ext));
}

function toRelativePosix(corpusRoot: string, absolute: string): string {
  let relative = absolute.slice(corpusRoot.length);
  if (relative.startsWith(sep)) relative = relative.slice(1);
  return relative.split(sep).join('/');
}

/** All non-binary corpus files, workspace-relative posix paths, sorted. */
export function listCorpusFiles(corpusRoot: string): readonly string[] {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (SKIPPED_DIRS.has(entry.name)) continue;
      const absolute = join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(absolute);
      } else if (entry.isFile()) {
        const path = toRelativePosix(corpusRoot, absolute);
        if (!isBinaryPath(path)) files.push(path);
      }
    }
  };
  walk(corpusRoot);
  return files.sort();
}

function readCorpusFile(corpusRoot: string, path: string): CorpusFile {
  const raw = readFileSync(join(corpusRoot, path));
  if (raw.subarray(0, 1024).includes(0)) {
    throw new Error(`binary file listed as text: ${path}`);
  }
  const content = raw.toString('utf8');
  return { path, lines: content.split(/\r?\n/) };
}

/** Picks `count` items evenly spaced over the sorted list, deterministic. */
function pickEvenlySpaced<T>(items: readonly T[], count: number): readonly T[] {
  if (count <= 0 || items.length === 0) return [];
  if (items.length <= count) return [...items];
  if (count === 1) {
    const middle = items[Math.floor((items.length - 1) / 2)];
    return middle !== undefined ? [middle] : [];
  }
  const picked: T[] = [];
  for (let i = 0; i < count; i++) {
    const index = Math.floor((i * (items.length - 1)) / (count - 1));
    const item = items[index];
    if (item !== undefined) picked.push(item);
  }
  return picked;
}

// ---------------------------------------------------------------------------
// ast / enrich questions
// ---------------------------------------------------------------------------

/** One top-level declaration, the truth for one ast/enrich file question. */
export interface DeclarationTruth {
  readonly name: string;
  readonly kind:
    | 'function'
    | 'class'
    | 'interface'
    | 'type'
    | 'enum'
    | 'variable'
    | 'module';
  readonly startLine: number;
  readonly endLine: number;
}

/** Top-level declarations of a source file, via `ts.createSourceFile` only. */
export function extractTopLevelDeclarations(
  content: string,
): readonly DeclarationTruth[] {
  const source = ts.createSourceFile(
    'question.ts',
    content,
    ts.ScriptTarget.Latest,
    true,
  );
  const lineOf = (position: number): number =>
    source.getLineAndCharacterOfPosition(position).line + 1;
  const out: DeclarationTruth[] = [];
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) ||
        ts.isClassDeclaration(statement) ||
        ts.isInterfaceDeclaration(statement) ||
        ts.isEnumDeclaration(statement) ||
        ts.isTypeAliasDeclaration(statement)) &&
      statement.name
    ) {
      const kind: DeclarationTruth['kind'] = ts.isFunctionDeclaration(statement)
        ? 'function'
        : ts.isClassDeclaration(statement)
          ? 'class'
          : ts.isInterfaceDeclaration(statement)
            ? 'interface'
            : ts.isEnumDeclaration(statement)
              ? 'enum'
              : 'type';
      out.push({
        name: statement.name.text,
        kind,
        startLine: lineOf(statement.getStart(source)),
        endLine: lineOf(statement.getEnd()),
      });
    } else if (ts.isVariableStatement(statement)) {
      for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name)) {
          out.push({
            name: declaration.name.text,
            kind: 'variable',
            startLine: lineOf(declaration.getStart(source)),
            endLine: lineOf(declaration.getEnd()),
          });
        }
      }
    } else if (ts.isModuleDeclaration(statement)) {
      if (
        ts.isIdentifier(statement.name) ||
        ts.isStringLiteral(statement.name)
      ) {
        out.push({
          name: statement.name.text,
          kind: 'module',
          startLine: lineOf(statement.getStart(source)),
          endLine: lineOf(statement.getEnd()),
        });
      }
    }
  }
  return out;
}

export interface AstQuestion {
  readonly id: string;
  readonly kind: 'ast';
  readonly file: string;
  readonly lineCount: number;
  readonly stratum: 'small' | 'medium' | 'large';
  readonly declarations: readonly DeclarationTruth[];
}

export interface AstBuildResult {
  readonly questions: readonly AstQuestion[];
  readonly strataCounts: {
    readonly small: number;
    readonly medium: number;
    readonly large: number;
  };
  readonly considered: number;
}

/** Size strata: <200 lines, 200-1,000 lines, >1,000 lines. */
function stratumOf(lineCount: number): AstQuestion['stratum'] {
  if (lineCount < 200) return 'small';
  if (lineCount <= 1000) return 'medium';
  return 'large';
}

/**
 * ast/enrich questions: up to `fileCount` eligible files picked evenly spaced
 * within each size stratum, with the declaration list as truth.
 */
export function buildAstQuestions(
  corpusRoot: string,
  options: { readonly fileCount?: number } = {},
): AstBuildResult {
  const fileCount = options.fileCount ?? 100;
  const candidates = listCorpusFiles(corpusRoot)
    .filter((path) => ELIGIBLE_EXTENSIONS.some((ext) => path.endsWith(ext)))
    .map((path) => ({
      path,
      lineCount: readCorpusFile(corpusRoot, path).lines.length,
    }));
  const buckets: Record<AstQuestion['stratum'], typeof candidates> = {
    small: [],
    medium: [],
    large: [],
  };
  for (const candidate of candidates) {
    buckets[stratumOf(candidate.lineCount)].push(candidate);
  }
  for (const bucket of Object.values(buckets)) {
    bucket.sort((a, b) => a.path.localeCompare(b.path));
  }
  const quotas: Record<AstQuestion['stratum'], number> = {
    small: 0,
    medium: 0,
    large: 0,
  };
  const base = Math.floor(fileCount / 3);
  quotas.small = base;
  quotas.medium = base;
  quotas.large = base;
  let remaining = fileCount - base * 3;
  for (const stratum of ['small', 'medium', 'large'] as const) {
    const extra = Math.min(
      remaining,
      Math.max(0, buckets[stratum].length - quotas[stratum]),
    );
    quotas[stratum] += extra;
    remaining -= extra;
  }
  const picked: AstQuestion[] = [];
  for (const stratum of ['small', 'medium', 'large'] as const) {
    for (const pick of pickEvenlySpaced(buckets[stratum], quotas[stratum])) {
      picked.push({
        id: '',
        kind: 'ast',
        file: pick.path,
        lineCount: pick.lineCount,
        stratum,
        declarations: extractTopLevelDeclarations(
          readCorpusFile(corpusRoot, pick.path).lines.join('\n'),
        ),
      });
    }
  }
  picked.sort((a, b) => a.file.localeCompare(b.file));
  const questions = picked.map((question, index) => ({
    ...question,
    id: `ast-${String(index + 1).padStart(4, '0')}`,
  }));
  return {
    questions,
    strataCounts: {
      small: questions.filter((q) => q.stratum === 'small').length,
      medium: questions.filter((q) => q.stratum === 'medium').length,
      large: questions.filter((q) => q.stratum === 'large').length,
    },
    considered: candidates.length,
  };
}

// ---------------------------------------------------------------------------
// glob questions
// ---------------------------------------------------------------------------

export interface GlobQuestion {
  readonly id: string;
  readonly kind: 'glob';
  readonly pattern: string;
  readonly truth: readonly string[];
}

export interface GlobBuildResult {
  readonly questions: readonly GlobQuestion[];
  readonly zeroMatchCount: number;
}

/** Patterns that cannot match any real corpus file, in every generation. */
const GUARANTEED_ZERO_MATCH_PATTERNS: readonly string[] = [
  '**/*.zzz-missing-ext',
  'no-such-root-dir/**/*.ts',
  '**/zzz-missing-dir/**/*.ts',
  '**/zzz-missing-file.ts',
  'missing-root/**/*.tsx',
];

const GLOB_SWEEPS: readonly string[] = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.js',
  '**/*.jsx',
  '**/*.spec.ts',
  '**/tsconfig.json',
  '**/package.json',
];

/** Builds glob patterns from real corpus directories and extensions. */
export function buildGlobPatterns(
  files: readonly string[],
  patternCount: number,
): readonly string[] {
  const sourceFiles = files.filter((path) =>
    ELIGIBLE_EXTENSIONS.some((ext) => path.endsWith(ext)),
  );
  const dirs = [
    ...new Set(sourceFiles.map((path) => posixDirname(path))),
  ].sort();
  const basenames = pickEvenlySpaced(
    sourceFiles,
    Math.min(10, sourceFiles.length),
  ).map((path) => path.split('/').pop() ?? path);
  const patterns: string[] = [
    ...GUARANTEED_ZERO_MATCH_PATTERNS,
    ...GLOB_SWEEPS,
    ...basenames.map((base) => `**/${base}`),
  ];
  const dirVariants = [
    (dir: string): string => `${dir}/**/*.ts`,
    (dir: string): string => `${dir}/**`,
    (dir: string): string => `${dir}/*.ts`,
  ];
  let dirIndex = 0;
  while (patterns.length < patternCount && dirs.length > 0) {
    const dir = dirs[dirIndex % dirs.length];
    const variant =
      dirVariants[Math.floor(dirIndex / dirs.length) % dirVariants.length];
    if (dir === undefined || variant === undefined) break;
    patterns.push(variant(dir));
    dirIndex++;
    if (dirIndex > dirs.length * dirVariants.length) break;
  }
  return [...new Set(patterns)];
}

function posixDirname(path: string): string {
  const index = path.lastIndexOf('/');
  return index === -1 ? '' : path.slice(0, index);
}

/**
 * Glob questions: patterns built from real directories and extensions (a few
 * matching nothing); the truth is picomatch over the corpus file list.
 */
export function buildGlobQuestions(
  corpusRoot: string,
  options: { readonly patternCount?: number } = {},
): GlobBuildResult {
  const patternCount = options.patternCount ?? 100;
  const files = listCorpusFiles(corpusRoot);
  const patterns = buildGlobPatterns(files, patternCount);
  const questions = patterns.map((pattern, index) => {
    const matches = picomatch(pattern, { dot: true });
    return {
      id: `glob-${String(index + 1).padStart(4, '0')}`,
      kind: 'glob' as const,
      pattern,
      truth: [...files].filter((file) => matches(file)),
    };
  });
  return {
    questions,
    zeroMatchCount: questions.filter((question) => question.truth.length === 0)
      .length,
  };
}

// ---------------------------------------------------------------------------
// text questions
// ---------------------------------------------------------------------------

export interface TextQuestion {
  readonly id: string;
  readonly kind: 'text-literal' | 'text-regex';
  readonly query: string;
  readonly truth: readonly string[];
}

export interface TextBuildResult {
  readonly questions: readonly TextQuestion[];
}

/** Candidate tokens: at least this many matching lines. */
const TOKEN_MIN_LINES = 2;
/** Candidate tokens: at most this many matching lines (keeps truth sets small). */
const TOKEN_MAX_LINES = 40;
const TOKEN_PATTERN = /[A-Za-z][A-Za-z0-9_-]{4,}/g;

function collectTextFiles(corpusRoot: string): readonly CorpusFile[] {
  return listCorpusFiles(corpusRoot).map((path) =>
    readCorpusFile(corpusRoot, path),
  );
}

/** Literal queries whose substring matches stay inside the size band. */
function selectLiteralCandidates(
  textFiles: readonly CorpusFile[],
  count: number,
): readonly string[] {
  const lineCounts = new Map<string, number>();
  for (const file of textFiles) {
    for (const line of file.lines) {
      const seen = new Set<string>();
      for (const match of line.matchAll(TOKEN_PATTERN)) {
        const token = match[0];
        if (seen.has(token)) continue;
        seen.add(token);
        lineCounts.set(token, (lineCounts.get(token) ?? 0) + 1);
      }
    }
  }
  const candidates = [...lineCounts.entries()]
    .filter(([, lines]) => lines >= TOKEN_MIN_LINES && lines <= TOKEN_MAX_LINES)
    .map(([token]) => token)
    .sort();
  return pickEvenlySpaced(candidates, count);
}

const REGEX_TEMPLATES: readonly ((candidate: string) => string)[] = [
  (candidate) => `\\b${candidate}\\s*\\(`,
  (candidate) => `import .*${candidate}`,
  (candidate) => `(const|let|var)\\s+\\w*${candidate}\\w*`,
  (candidate) => `\\b${candidate}:`,
  (candidate) => `await\\s+.*${candidate}`,
];

/**
 * Text questions: literal and regex queries. The truth is a `path:line` set
 * from a Node line scan of the corpus. `rg` is never used here.
 */
export function buildTextQuestions(
  corpusRoot: string,
  options: {
    readonly literalCount?: number;
    readonly regexCount?: number;
  } = {},
): TextBuildResult {
  const literalCount = options.literalCount ?? 150;
  const regexCount = options.regexCount ?? 50;
  const textFiles = collectTextFiles(corpusRoot);
  const literalCandidates = selectLiteralCandidates(
    textFiles,
    literalCount + regexCount * 2,
  );
  const literals = literalCandidates.slice(0, literalCount);
  // Regex candidates come from the tail of the same spaced selection, so a
  // regex query never repeats a literal query's token.
  const regexCandidates = pickEvenlySpaced(
    literalCandidates.slice(literalCount),
    Math.ceil(regexCount / REGEX_TEMPLATES.length),
  );
  const questions: TextQuestion[] = [];
  const literalTruth = (query: string): string[] => {
    const truth: string[] = [];
    for (const file of textFiles) {
      file.lines.forEach((line, index) => {
        if (line.includes(query)) truth.push(`${file.path}:${index + 1}`);
      });
    }
    return truth.sort();
  };
  literals.forEach((literal, index) => {
    questions.push({
      id: `text-literal-${String(index + 1).padStart(4, '0')}`,
      kind: 'text-literal',
      query: literal,
      truth: literalTruth(literal),
    });
  });
  let regexIndex = 0;
  for (const candidate of regexCandidates) {
    for (const template of REGEX_TEMPLATES) {
      if (regexIndex >= regexCount) break;
      const pattern = template(candidate);
      const regex = new RegExp(pattern);
      const truth: string[] = [];
      for (const file of textFiles) {
        file.lines.forEach((line, index) => {
          if (regex.test(line)) truth.push(`${file.path}:${index + 1}`);
        });
      }
      questions.push({
        id: `text-regex-${String(regexIndex + 1).padStart(4, '0')}`,
        kind: 'text-regex',
        query: pattern,
        truth: truth.sort(),
      });
      regexIndex++;
    }
  }
  return { questions };
}

// ---------------------------------------------------------------------------
// frozen file
// ---------------------------------------------------------------------------

export interface FileToolsBuildOptions {
  readonly corpusCommit: string;
  readonly frozenAt: string;
  readonly astCount?: number;
  readonly globPatternCount?: number;
  readonly textLiteralCount?: number;
  readonly textRegexCount?: number;
  readonly generator?: string;
}

export interface FileToolsQuestionFile {
  readonly id: 'file-tools';
  readonly version: '1';
  readonly method: 'generated';
  readonly frozenAt: string;
  readonly corpusCommit: string;
  readonly generator: string;
  readonly seed: null;
  readonly counts: {
    readonly ast: number;
    readonly astSmall: number;
    readonly astMedium: number;
    readonly astLarge: number;
    readonly glob: number;
    readonly globZeroMatch: number;
    readonly textLiteral: number;
    readonly textRegex: number;
    readonly total: number;
  };
  readonly questions: readonly (AstQuestion | GlobQuestion | TextQuestion)[];
}

const declarationTruthSchema = z.object({
  name: z.string().min(1),
  kind: z.enum([
    'function',
    'class',
    'interface',
    'type',
    'enum',
    'variable',
    'module',
  ]),
  startLine: z.number().int().positive(),
  endLine: z.number().int().positive(),
});

const astQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('ast'),
  file: z.string().min(1),
  lineCount: z.number().int().positive(),
  stratum: z.enum(['small', 'medium', 'large']),
  declarations: z.array(declarationTruthSchema),
});

const globQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.literal('glob'),
  pattern: z.string().min(1),
  truth: z.array(z.string().min(1)),
});

const textQuestionSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['text-literal', 'text-regex']),
  query: z.string().min(1),
  truth: z.array(z.string().min(1)),
});

export const fileToolsQuestionFileSchema = z
  .object({
    id: z.literal('file-tools'),
    version: z.literal('1'),
    method: z.literal('generated'),
    raterCount: z.number().int().positive().optional(),
    frozenAt: z.string().datetime(),
    corpusCommit: z.string().min(1),
    generator: z.string().min(1),
    seed: z.null(),
    counts: z.object({
      ast: z.number().int().nonnegative(),
      astSmall: z.number().int().nonnegative(),
      astMedium: z.number().int().nonnegative(),
      astLarge: z.number().int().nonnegative(),
      glob: z.number().int().nonnegative(),
      globZeroMatch: z.number().int().nonnegative(),
      textLiteral: z.number().int().nonnegative(),
      textRegex: z.number().int().nonnegative(),
      total: z.number().int().nonnegative(),
    }),
    questions: z.array(
      z.discriminatedUnion('kind', [
        astQuestionSchema,
        globQuestionSchema,
        textQuestionSchema,
      ]),
    ),
  })
  .superRefine((file, context) => {
    if (
      file.counts.ast !==
      file.counts.astSmall + file.counts.astMedium + file.counts.astLarge
    ) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'ast strata must sum to counts.ast',
        path: ['counts', 'ast'],
      });
    }
    if (file.counts.total !== file.questions.length) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'counts.total must equal questions.length',
        path: ['counts', 'total'],
      });
    }
  });

/** Builds the whole frozen file-tools question file for a corpus root. */
export function buildFileToolsQuestionFile(
  corpusRoot: string,
  options: FileToolsBuildOptions,
): FileToolsQuestionFile {
  const ast = buildAstQuestions(corpusRoot, { fileCount: options.astCount });
  const glob = buildGlobQuestions(corpusRoot, {
    patternCount: options.globPatternCount,
  });
  const text = buildTextQuestions(corpusRoot, {
    literalCount: options.textLiteralCount,
    regexCount: options.textRegexCount,
  });
  const questions: FileToolsQuestionFile['questions'] = [
    ...ast.questions,
    ...glob.questions,
    ...text.questions,
  ];
  return {
    id: 'file-tools',
    version: '1',
    method: 'generated',
    frozenAt: options.frozenAt,
    corpusCommit: options.corpusCommit,
    generator: options.generator ?? 'file-tool-questions.ts',
    seed: null,
    counts: {
      ast: ast.questions.length,
      astSmall: ast.strataCounts.small,
      astMedium: ast.strataCounts.medium,
      astLarge: ast.strataCounts.large,
      glob: glob.questions.length,
      globZeroMatch: glob.zeroMatchCount,
      textLiteral: text.questions.filter((q) => q.kind === 'text-literal')
        .length,
      textRegex: text.questions.filter((q) => q.kind === 'text-regex').length,
      total: questions.length,
    },
    questions,
  };
}
