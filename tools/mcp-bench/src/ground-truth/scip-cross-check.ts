import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, isAbsolute, join } from 'node:path';
import { z } from 'zod';
import { compareCodeUnits } from '../utils/compare-code-units';
import { mulberry32 } from './ts-program';

/**
 * SCIP (Semantic Code Intelligence Protocol) support for the MCP tool
 * benchmark. SCIP indexes are BENCHMARK GROUND TRUTH ONLY and never a runtime
 * backend (context.md Gate SR decisions 1 and 4). The generator never runs
 * an indexer itself: it consumes an existing `index.scip` produced outside
 * this file, and `detectScipIndexers` exists only to record whether the
 * pinned indexers are present (an absent indexer yields the `na` record).
 *
 * The protobuf decoder below is hand-written for the exact subset of
 * scip.proto the pinned indexers emit: `Index{ metadata = 1, documents = 2,
 * external_symbols = 3 }`, `Document{ relative_path = 1, occurrences = 2,
 * symbols = 3, language = 4 }`, `Occurrence{ range = 1 (packed int32),
 * symbol = 2, symbol_roles = 3 }` and `SymbolInformation{ symbol = 1 }`.
 * Unknown fields are skipped by wire type, so indexes that carry more fields
 * still parse. The `@scip-code/scip` reader is ESM-only, which is why the
 * subset is decoded here instead.
 */

/** `SymbolRole.Definition` bit (scip.proto). */
const ROLE_DEFINITION = 0x1;
/** `SymbolRole.Import` bit (scip.proto). */
const ROLE_IMPORT = 0x2;
/** Local symbols start with this prefix and are never benchmark targets. */
const LOCAL_PREFIX = 'local ';

export interface ScipOccurrence {
  /** 1-based line of the occurrence range start. */
  readonly line: number;
  readonly symbol: string;
  readonly isDefinition: boolean;
  readonly isImport: boolean;
}

export interface ScipDocument {
  /** Workspace-relative path with forward slashes. */
  readonly relativePath: string;
  readonly language: string;
  readonly symbols: readonly string[];
  readonly occurrences: readonly ScipOccurrence[];
}

export interface ScipIndex {
  readonly documents: readonly ScipDocument[];
}

/**
 * Parses a serialized `Index` protobuf message. Only `documents` is kept;
 * `metadata` (1), `external_symbols` (3) and unknown fields are skipped.
 */
export function parseScipIndex(buffer: Uint8Array): ScipIndex {
  const documents: ScipDocument[] = [];
  forEachField(buffer, 0, buffer.length, (scanned) => {
    if (scanned.field === 2 && scanned.kind === 'bytes')
      documents.push(parseDocument(buffer, scanned.start, scanned.end));
  });
  return { documents };
}

function parseDocument(
  buffer: Uint8Array,
  start: number,
  end: number,
): ScipDocument {
  let relativePath = '';
  let language = '';
  const symbols: string[] = [];
  const occurrences: ScipOccurrence[] = [];
  forEachField(buffer, start, end, (scanned) => {
    if (scanned.kind !== 'bytes') return;
    // scip-typescript on win32 writes `\` separators; truths use `/`.
    if (scanned.field === 1)
      relativePath = decodeUtf8(buffer, scanned.start, scanned.end).replaceAll(
        '\\',
        '/',
      );
    else if (scanned.field === 2) {
      const occurrence = parseOccurrence(buffer, scanned.start, scanned.end);
      if (occurrence !== null) occurrences.push(occurrence);
    } else if (scanned.field === 3)
      symbols.push(parseSymbolInformation(buffer, scanned.start, scanned.end));
    else if (scanned.field === 4)
      language = decodeUtf8(buffer, scanned.start, scanned.end);
    // Document.text (5) and unknown fields are skipped.
  });
  return { relativePath, language, symbols, occurrences };
}

function parseOccurrence(
  buffer: Uint8Array,
  start: number,
  end: number,
): ScipOccurrence | null {
  let range: number[] | null = null;
  let symbol = '';
  let roles = 0;
  let cursor = start;
  while (cursor < end) {
    const scanned = nextField(buffer, cursor, end);
    cursor = scanned.next;
    if (scanned.field === 1) {
      // Occurrence.range is packed int32; a non-packed entry is also valid.
      const values =
        scanned.kind === 'varint'
          ? [scanned.value]
          : scanned.kind === 'bytes'
            ? readPackedInt32(buffer, scanned.start, scanned.end)
            : [];
      range = [...(range ?? []), ...values];
    } else if (scanned.field === 2 && scanned.kind === 'bytes') {
      symbol = decodeUtf8(buffer, scanned.start, scanned.end);
    } else if (scanned.field === 3 && scanned.kind === 'varint') {
      roles = scanned.value;
    }
    // override_documentation (4), syntax_kind (5) and unknown fields are
    // skipped.
  }
  // Occurrences without a symbol carry syntax-highlighting data only.
  if (symbol === '') return null;
  if (range === null)
    throw new Error(
      'SCIP occurrence without a range; only the packed int32 range (field 1) is decoded',
    );
  if (range.length !== 3 && range.length !== 4)
    throw new Error(
      `SCIP occurrence range needs 3 or 4 elements, got ${range.length}`,
    );
  const [startLine] = range;
  return {
    line: startLine + 1,
    symbol,
    isDefinition: (roles & ROLE_DEFINITION) !== 0,
    isImport: (roles & ROLE_IMPORT) !== 0,
  };
}

function parseSymbolInformation(
  buffer: Uint8Array,
  start: number,
  end: number,
): string {
  let symbol = '';
  forEachField(buffer, start, end, (scanned) => {
    if (scanned.field === 1 && scanned.kind === 'bytes')
      symbol = decodeUtf8(buffer, scanned.start, scanned.end);
    // documentation (3), relationships (4) and unknown fields are skipped.
  });
  return symbol;
}

const utf8Decoder = new TextDecoder();

function decodeUtf8(buffer: Uint8Array, start: number, end: number): string {
  return utf8Decoder.decode(buffer.subarray(start, end));
}

// --- Minimal protobuf reader (varint, length-delimited, packed int32). ---

const WIRE_VARINT = 0;
const WIRE_FIXED_64 = 1;
const WIRE_LENGTH = 2;
const WIRE_START_GROUP = 3;
const WIRE_END_GROUP = 4;
const WIRE_FIXED_32 = 5;

type ScannedField =
  | { kind: 'varint'; field: number; value: number; next: number }
  | {
      kind: 'bytes';
      field: number;
      start: number;
      end: number;
      next: number;
    }
  | { kind: 'fixed'; field: number; next: number }
  | { kind: 'group'; field: number; next: number }
  | { kind: 'end-group'; field: number; next: number };

/** Scans the next field, rejecting end-group markers outside `skipGroup`. */
function nextField(
  buffer: Uint8Array,
  position: number,
  limit: number,
): ScannedField {
  const scanned = scanField(buffer, position, limit);
  if (scanned.kind === 'end-group')
    throw new Error('unexpected protobuf end-group marker in SCIP index');
  return scanned;
}

/**
 * Walks every field of one message. Group fields are consumed whole by
 * `skipGroup`.
 */
function forEachField(
  buffer: Uint8Array,
  start: number,
  end: number,
  visit: (scanned: ScannedField) => void,
): void {
  let cursor = start;
  while (cursor < end) {
    const scanned = nextField(buffer, cursor, end);
    cursor = scanned.next;
    visit(scanned);
  }
}

function scanField(
  buffer: Uint8Array,
  position: number,
  limit: number,
): ScannedField {
  const key = readVarint(buffer, position, limit);
  const field = Math.floor(key.value / 8);
  const wireType = key.value % 8;
  const afterKey = key.next;
  switch (wireType) {
    case WIRE_VARINT: {
      const value = readVarint(buffer, afterKey, limit);
      return { kind: 'varint', field, value: value.value, next: value.next };
    }
    case WIRE_LENGTH: {
      const length = readVarint(buffer, afterKey, limit);
      const start = length.next;
      const end = start + length.value;
      if (end > limit)
        throw new Error('truncated length-delimited field in SCIP index');
      return { kind: 'bytes', field, start, end, next: end };
    }
    case WIRE_START_GROUP:
      return {
        kind: 'group',
        field,
        next: skipGroup(buffer, afterKey, limit, field),
      };
    case WIRE_END_GROUP:
      return { kind: 'end-group', field, next: afterKey };
    case WIRE_FIXED_32:
    case WIRE_FIXED_64: {
      const next = afterKey + (wireType === WIRE_FIXED_32 ? 4 : 8);
      if (next > limit) throw new Error('truncated fixed field in SCIP index');
      return { kind: 'fixed', field, next };
    }
    default:
      throw new Error(
        `unsupported protobuf wire type ${wireType} in SCIP index`,
      );
  }
}

function skipGroup(
  buffer: Uint8Array,
  position: number,
  limit: number,
  group: number,
): number {
  let cursor = position;
  while (cursor < limit) {
    const scanned = scanField(buffer, cursor, limit);
    cursor = scanned.next;
    if (scanned.kind !== 'end-group') continue;
    if (scanned.field === group) return cursor;
    throw new Error('mismatched protobuf end-group marker in SCIP index');
  }
  throw new Error('unterminated protobuf group in SCIP index');
}

function readVarint(
  buffer: Uint8Array,
  position: number,
  limit: number,
): { value: number; next: number } {
  let value = 0;
  let shift = 0;
  let cursor = position;
  for (;;) {
    if (cursor >= limit) throw new Error('truncated varint in SCIP index');
    const byte = buffer[cursor];
    cursor += 1;
    value += (byte & 0x7f) * 2 ** shift;
    if ((byte & 0x80) === 0) return { value, next: cursor };
    shift += 7;
    if (shift > 63) throw new Error('varint longer than 64 bits in SCIP index');
  }
}

function readPackedInt32(
  buffer: Uint8Array,
  start: number,
  end: number,
): number[] {
  const values: number[] = [];
  let cursor = start;
  while (cursor < end) {
    const value = readVarint(buffer, cursor, end);
    cursor = value.next;
    values.push(value.value);
  }
  return values;
}

// --- Indexer detection (for the `na` record only). ---

export type ScipIndexerLanguage = 'typescript' | 'python' | 'go';

export interface ScipIndexerStatus {
  readonly available: boolean;
  readonly command: string | null;
  readonly reason: string | null;
}

export type ScipIndexers = Record<ScipIndexerLanguage, ScipIndexerStatus>;

const SCIP_INDEXER_COMMANDS: Readonly<Record<ScipIndexerLanguage, string>> = {
  typescript: 'scip-typescript',
  python: 'scip-python',
  go: 'scip-go',
};
const SCIP_INDEXER_OVERRIDES: Readonly<Record<ScipIndexerLanguage, string>> = {
  typescript: 'PTAH_BENCH_SCIP_TYPESCRIPT',
  python: 'PTAH_BENCH_SCIP_PYTHON',
  go: 'PTAH_BENCH_SCIP_GO',
};

/**
 * Reports whether the pinned SCIP indexers can be invoked. An
 * `PTAH_BENCH_SCIP_<LANGUAGE>` entry in `env` wins over the PATH lookup and
 * may hold a path or a command. Inject `which` to test the decision logic.
 */
export function detectScipIndexers(
  env: Record<string, string | undefined> = process.env,
  which: (command: string) => string | null = defaultWhich,
): ScipIndexers {
  return {
    typescript: detectIndexer(env, which, 'typescript'),
    python: detectIndexer(env, which, 'python'),
    go: detectIndexer(env, which, 'go'),
  };
}

function detectIndexer(
  env: Record<string, string | undefined>,
  which: (command: string) => string | null,
  language: ScipIndexerLanguage,
): ScipIndexerStatus {
  const command = SCIP_INDEXER_COMMANDS[language];
  const overrideVariable = SCIP_INDEXER_OVERRIDES[language];
  const override = env[overrideVariable];
  if (override !== undefined && override.trim() !== '') {
    const resolved = which(override);
    if (resolved !== null)
      return { available: true, command: resolved, reason: null };
    return {
      available: false,
      command: null,
      reason: `${overrideVariable} is set to '${override}' but no such command or file exists`,
    };
  }
  const resolved = which(command);
  if (resolved !== null)
    return { available: true, command: resolved, reason: null };
  return {
    available: false,
    command: null,
    reason: `${command} was not found on PATH; set ${overrideVariable} to an absolute path or command to use an indexer installed elsewhere`,
  };
}

function defaultWhich(command: string): string | null {
  if (isAbsolute(command) || command.includes('/') || command.includes('\\')) {
    try {
      return statSync(command).isFile() ? command : null;
    } catch {
      // The candidate is not on disk; report it as not found.
      return null;
    }
  }
  const pathValue = process.env['PATH'] ?? '';
  const extensions =
    process.platform === 'win32'
      ? [
          '',
          ...(process.env['PATHEXT'] ?? '.COM;.EXE;.BAT;.CMD')
            .split(';')
            .filter((extension) => extension !== ''),
        ]
      : [''];
  for (const directory of pathValue.split(delimiter)) {
    if (directory === '') continue;
    for (const extension of extensions) {
      const candidate = join(directory, `${command}${extension}`);
      try {
        if (statSync(candidate).isFile()) return candidate;
      } catch {
        // The candidate is not on disk; keep scanning PATH.
      }
    }
  }
  return null;
}

// --- Polyglot question generation (ground truth only). ---

/** Descriptor suffixes that can terminate a global SCIP symbol string. */
const DESCRIPTOR_SUFFIXES = ['#', '.', '/', ':', '!'] as const;

/**
 * Extracts the final descriptor's name from a global SCIP symbol string
 * (the `Symbol` grammar in scip.proto). Descriptors start after the last
 * space of `<scheme> ' ' <package> ' '`; the final one may be a method
 * (`` `foo`(). ``, `foo(+1).`), a term (`foo.`), a type (`Foo#`), a
 * namespace (`foo/`), a meta (`foo:`) or a macro (`foo!`), possibly behind
 * container descriptors (`logrus/Info`, `Foo#field`). Local symbols have no
 * descriptors and are returned unchanged (callers skip them).
 */
export function symbolName(symbol: string): string {
  if (symbol.startsWith(LOCAL_PREFIX)) return symbol;
  let name = symbol.slice(symbol.lastIndexOf(' ') + 1);
  if (name.endsWith(').')) {
    // Method descriptor: <name> '(' (<disambiguator>)? ').'
    const open = name.lastIndexOf('(');
    if (open > 0) name = name.slice(0, open);
  } else if (name.endsWith(')') || name.endsWith(']')) {
    // Parameter descriptor '(' <name> ')' or type parameter '[' <name> ']'.
    const open = name.lastIndexOf(name.endsWith(')') ? '(' : '[');
    if (open >= 0) return unescapeName(name.slice(open + 1, -1));
  } else {
    for (const suffix of DESCRIPTOR_SUFFIXES)
      if (name.endsWith(suffix)) {
        name = name.slice(0, -suffix.length);
        break;
      }
  }
  if (name.endsWith('`')) {
    const start = name.lastIndexOf('`', name.length - 2);
    if (start >= 0) return unescapeName(name.slice(start + 1, -1));
  }
  let boundary = -1;
  for (const suffix of DESCRIPTOR_SUFFIXES)
    boundary = Math.max(boundary, name.lastIndexOf(suffix));
  return boundary >= 0 ? name.slice(boundary + 1) : unescapeName(name);
}

function unescapeName(name: string): string {
  if (!name.startsWith('`') || !name.endsWith('`')) return name;
  return name.slice(1, -1).replaceAll('``', '`');
}

export interface ScipReferenceQuestion {
  readonly id: string;
  readonly query: string;
  readonly file: string;
  readonly line: number;
  readonly truth: readonly string[];
  readonly declarationIncluded: boolean;
  readonly stratum: string;
}

export interface ScipDependencyQuestion {
  readonly id: string;
  readonly file: string;
  readonly pathForms: readonly ['relative', 'absolute'];
  readonly dependencies: readonly string[];
  readonly dependents: readonly string[];
  readonly imports: readonly string[];
}

/** Reference-question strata and their targets (Batch 5's equal thirds). */
export const SCIP_REFERENCE_TARGETS: Readonly<Record<string, number>> = {
  'under-5': 17,
  '5-50': 17,
  'over-50': 16,
};
/** Dependency-question target within the 50-question set. */
export const SCIP_DEPENDENCY_TARGET = 50;

export const scipEnvelopeSchema = z.object({
  id: z.string().min(1),
  language: z.string().min(1),
  version: z.literal('1'),
  method: z.literal('generated'),
  frozenAt: z.string().datetime(),
  corpusCommit: z.string().min(1),
  generator: z.literal('scip-cross-check.ts'),
  seed: z.number(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  questions: z.array(z.unknown()),
});
export type ScipEnvelope = z.infer<typeof scipEnvelopeSchema>;

/** The `na` variant written when an indexer is absent. */
export const scipNaEnvelopeSchema = scipEnvelopeSchema.extend({
  corpusCommit: z.string(),
  na: z.object({ reason: z.string().min(1) }),
});
export type ScipNaEnvelope = z.infer<typeof scipNaEnvelopeSchema>;

export interface PolyglotQuestionOptions {
  readonly corpusId: string;
  readonly corpusCommit: string;
  readonly language: string;
  readonly frozenAt: string;
  readonly seed: number;
}

/**
 * Generates the polyglot ground-truth envelope for one already-indexed
 * corpus: 50 reference questions (global symbols with a definition
 * occurrence in the corpus, stratified under-5 / 5-50 / over-50 like Batch 5
 * where the corpus allows) and 50 dependency questions (file-level edges:
 * file A depends on file B when A has a non-definition occurrence of a symbol
 * defined in B). Strata the corpus cannot fill are recorded in `counts` and
 * never throw.
 */
export function generatePolyglotQuestions(
  index: ScipIndex,
  options: PolyglotQuestionOptions,
): ScipEnvelope {
  const random = mulberry32(options.seed);
  const bySymbol = symbolOccurrences(globalOccurrences(index));
  const references = referenceQuestions(bySymbol, random);
  const dependencies = dependencyQuestions(
    index.documents.map((document) => document.relativePath),
    bySymbol,
    random,
  );
  return scipEnvelopeSchema.parse({
    id: options.corpusId,
    language: options.language,
    version: '1',
    method: 'generated',
    frozenAt: options.frozenAt,
    corpusCommit: options.corpusCommit,
    generator: 'scip-cross-check.ts',
    seed: options.seed,
    counts: {
      ...referenceCounts(references),
      ...dependencyCounts(dependencies),
    },
    questions: [...references, ...dependencies],
  });
}

/** The envelope variant written when a language's indexer is absent. */
export function naRecord(language: string, reason: string): ScipNaEnvelope {
  return scipNaEnvelopeSchema.parse({
    id: language,
    language,
    version: '1',
    method: 'generated',
    frozenAt: new Date().toISOString(),
    corpusCommit: '',
    generator: 'scip-cross-check.ts',
    seed: 0,
    counts: {},
    questions: [],
    na: { reason },
  });
}

/** Writes one envelope as pretty JSON with a trailing newline. */
export function writePolyglotQuestions(
  outputDirectory: string,
  name: string,
  envelope: ScipEnvelope | ScipNaEnvelope,
): void {
  mkdirSync(outputDirectory, { recursive: true });
  writeFileSync(
    join(outputDirectory, `${name}.json`),
    `${JSON.stringify(envelope, null, 2)}\n`,
  );
}

interface LocatedOccurrence {
  readonly file: string;
  readonly line: number;
  readonly symbol: string;
  readonly isDefinition: boolean;
  readonly isImport: boolean;
}

/** All non-local occurrences of the index, joined with their file. */
function globalOccurrences(index: ScipIndex): LocatedOccurrence[] {
  const located: LocatedOccurrence[] = [];
  for (const document of index.documents)
    for (const occurrence of document.occurrences) {
      if (occurrence.symbol.startsWith(LOCAL_PREFIX)) continue;
      located.push({ file: document.relativePath, ...occurrence });
    }
  return located;
}

function symbolOccurrences(
  occurrences: readonly LocatedOccurrence[],
): Map<string, LocatedOccurrence[]> {
  const bySymbol = new Map<string, LocatedOccurrence[]>();
  for (const occurrence of occurrences) {
    const list = bySymbol.get(occurrence.symbol);
    if (list === undefined) bySymbol.set(occurrence.symbol, [occurrence]);
    else list.push(occurrence);
  }
  return bySymbol;
}

function referenceQuestions(
  bySymbol: ReadonlyMap<string, readonly LocatedOccurrence[]>,
  random: () => number,
): ScipReferenceQuestion[] {
  const candidates: ScipReferenceQuestion[] = [];
  for (const [symbol, occurrences] of bySymbol) {
    const definition = occurrences.find(
      (occurrence) => occurrence.isDefinition,
    );
    if (definition === undefined) continue;
    const truth = [
      ...new Set(
        occurrences.map(
          (occurrence) => `${occurrence.file}:${occurrence.line}`,
        ),
      ),
    ];
    candidates.push({
      id: '',
      query: symbolName(symbol),
      file: definition.file,
      line: definition.line,
      truth,
      declarationIncluded: true,
      stratum:
        truth.length < 5 ? 'under-5' : truth.length <= 50 ? '5-50' : 'over-50',
    });
  }
  const deduped = uniqueBy(
    candidates,
    (question) => `${question.file}:${question.line}`,
  );
  const selected: ScipReferenceQuestion[] = [];
  for (const [stratum, target] of Object.entries(SCIP_REFERENCE_TARGETS))
    selected.push(
      ...pick(
        deduped.filter((question) => question.stratum === stratum),
        target,
        random,
      ),
    );
  return selected.map((question, index) => ({
    ...question,
    id: `reference-${index + 1}`,
  }));
}

function referenceCounts(
  questions: readonly ScipReferenceQuestion[],
): Record<string, number> {
  const counts: Record<string, number> = {
    references: questions.length,
    'references-target': Object.values(SCIP_REFERENCE_TARGETS).reduce(
      (total, target) => total + target,
      0,
    ),
  };
  let unfilledStrata = 0;
  for (const [stratum, target] of Object.entries(SCIP_REFERENCE_TARGETS)) {
    const selected = questions.filter(
      (question) => question.stratum === stratum,
    ).length;
    counts[stratum] = selected;
    counts[`${stratum}-target`] = target;
    if (selected < target) unfilledStrata += 1;
  }
  counts['unfilled-strata'] = unfilledStrata;
  return counts;
}

function dependencyQuestions(
  files: readonly string[],
  bySymbol: ReadonlyMap<string, readonly LocatedOccurrence[]>,
  random: () => number,
): ScipDependencyQuestion[] {
  const edges = new Map<string, Set<string>>();
  const reverseEdges = new Map<string, Set<string>>();
  for (const occurrences of bySymbol.values()) {
    const definitions = new Set(
      occurrences
        .filter((occurrence) => occurrence.isDefinition)
        .map((occurrence) => occurrence.file),
    );
    if (definitions.size === 0) continue;
    for (const occurrence of occurrences) {
      if (occurrence.isDefinition) continue;
      for (const definition of definitions) {
        if (definition === occurrence.file) continue;
        addEdge(edges, occurrence.file, definition);
        addEdge(reverseEdges, definition, occurrence.file);
      }
    }
  }
  return pick(files, SCIP_DEPENDENCY_TARGET, random).map((file, index) => ({
    id: `dependency-${index + 1}`,
    file,
    pathForms: ['relative', 'absolute'] as const,
    dependencies: [...(edges.get(file) ?? new Set<string>())].sort(compareCodeUnits),
    dependents: [...(reverseEdges.get(file) ?? new Set<string>())].sort(compareCodeUnits),
    imports: [...(edges.get(file) ?? new Set<string>())].sort(compareCodeUnits),
  }));
}

function dependencyCounts(
  questions: readonly ScipDependencyQuestion[],
): Record<string, number> {
  return {
    dependencies: questions.length,
    'dependencies-target': SCIP_DEPENDENCY_TARGET,
  };
}

function addEdge(
  edges: Map<string, Set<string>>,
  from: string,
  to: string,
): void {
  const targets = edges.get(from);
  if (targets === undefined) edges.set(from, new Set([to]));
  else targets.add(to);
}

// --- Cross-check against the Batch 5 TypeScript truth. ---

export interface TsReferenceQuestion {
  readonly id: string;
  readonly query: string;
  readonly file: string;
  readonly line: number;
  readonly truth: readonly string[];
}

export interface TsReferences {
  readonly questions: readonly TsReferenceQuestion[];
}

export interface ScipAgreementQuestion {
  readonly id: string;
  readonly jaccard: number;
  readonly onlyTs: number;
  readonly onlyScip: number;
}

export interface ScipAgreement {
  /** Questions where a SCIP occurrence name matched the query at file:line. */
  readonly compared: number;
  /** Questions where no SCIP symbol was found at the question's file:line. */
  readonly unmatched: number;
  /** Mean per-question Jaccard over the compared questions (0 when none). */
  readonly meanJaccard: number;
  /** Fraction of compared questions with Jaccard 1 (0 when none compared). */
  readonly exactRate: number;
  readonly perQuestion: readonly ScipAgreementQuestion[];
}

/**
 * Compares the SCIP truth with the frozen Batch 5 reference questions. For
 * every question, the SCIP symbol is the occurrence at the question's
 * `file:line` whose name matches `query`; its truth is every occurrence of
 * that symbol. `meanJaccard` and `exactRate` cover the compared questions;
 * questions without a matching SCIP symbol are counted in `unmatched`.
 */
export function compareWithTsTruth(
  index: ScipIndex,
  tsReferences: TsReferences,
): ScipAgreement {
  const occurrences = globalOccurrences(index);
  const bySymbol = symbolOccurrences(occurrences);
  const bySite = new Map<string, LocatedOccurrence[]>();
  for (const occurrence of occurrences) {
    const key = `${occurrence.file}:${occurrence.line}`;
    const list = bySite.get(key);
    if (list === undefined) bySite.set(key, [occurrence]);
    else list.push(occurrence);
  }
  const perQuestion: ScipAgreementQuestion[] = [];
  let unmatched = 0;
  for (const question of tsReferences.questions) {
    const anchor = (bySite.get(`${question.file}:${question.line}`) ?? []).find(
      (occurrence) => symbolName(occurrence.symbol) === question.query,
    );
    if (anchor === undefined) {
      unmatched += 1;
      continue;
    }
    const scipTruth = new Set(
      (bySymbol.get(anchor.symbol) ?? []).map(
        (occurrence) => `${occurrence.file}:${occurrence.line}`,
      ),
    );
    const tsTruth = new Set(question.truth);
    let intersection = 0;
    for (const location of tsTruth)
      if (scipTruth.has(location)) intersection += 1;
    const unionSize = tsTruth.size + scipTruth.size - intersection;
    perQuestion.push({
      id: question.id,
      jaccard: unionSize === 0 ? 1 : intersection / unionSize,
      onlyTs: tsTruth.size - intersection,
      onlyScip: scipTruth.size - intersection,
    });
  }
  const compared = perQuestion.length;
  const exact = perQuestion.filter((entry) => entry.jaccard === 1).length;
  return {
    compared,
    unmatched,
    meanJaccard:
      compared === 0
        ? 0
        : perQuestion.reduce((sum, entry) => sum + entry.jaccard, 0) / compared,
    exactRate: compared === 0 ? 0 : exact / compared,
    perQuestion,
  };
}

// --- Seeded selection helpers (mirrors graph-questions.ts). ---

function pick<T>(
  items: readonly T[],
  count: number,
  random: () => number,
): T[] {
  const copy = [...items];
  for (let index = copy.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(random() * (index + 1));
    [copy[index], copy[swap]] = [copy[swap], copy[index]];
  }
  return copy.slice(0, Math.min(count, copy.length));
}

function uniqueBy<T>(items: readonly T[], key: (item: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((item) => {
    const value = key(item);
    if (seen.has(value)) return false;
    seen.add(value);
    return true;
  });
}
