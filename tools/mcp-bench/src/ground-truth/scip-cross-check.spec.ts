import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  compareWithTsTruth,
  detectScipIndexers,
  generatePolyglotQuestions,
  naRecord,
  parseScipIndex,
  scipNaEnvelopeSchema,
  symbolName,
  writePolyglotQuestions,
  type ScipDependencyQuestion,
  type ScipEnvelope,
  type ScipIndex,
  type ScipReferenceQuestion,
} from './scip-cross-check';

const SYMBOL_F = 'test python pkg 1.0.0 a.py `f`().';
const SYMBOL_H = 'test python pkg 1.0.0 a.py h.';
const LOCAL_G = 'local g';

// --- Minimal protobuf encoder (spec-only) to build a tiny SCIP index. ---

const textEncoder = new TextEncoder();

function varint(value: number): number[] {
  const bytes: number[] = [];
  let remaining = value;
  for (;;) {
    const byte = remaining & 0x7f;
    remaining = Math.floor(remaining / 128);
    if (remaining === 0) {
      bytes.push(byte);
      return bytes;
    }
    bytes.push(byte | 0x80);
  }
}
function tag(field: number, wireType: number): number[] {
  return varint(field * 8 + wireType);
}
function varintField(field: number, value: number): number[] {
  return [...tag(field, 0), ...varint(value)];
}
function stringField(field: number, value: string): number[] {
  const encoded = Array.from(textEncoder.encode(value));
  return [...tag(field, 2), ...varint(encoded.length), ...encoded];
}
function messageField(field: number, payload: number[]): number[] {
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}
function packedInt32Field(field: number, values: readonly number[]): number[] {
  const payload = values.flatMap((value) => varint(value));
  return [...tag(field, 2), ...varint(payload.length), ...payload];
}
/** An unknown fixed32 field (wire type 5) the decoder must skip. */
function unknownFixed32Field(field: number): number[] {
  return [...tag(field, 5), 1, 2, 3, 4];
}

function occurrence(
  range: readonly number[] | 'non-packed',
  symbol: string | null,
  roles: number,
): number[] {
  const encodedRange =
    range === 'non-packed'
      ? // Three separate field-1 entries instead of one packed field.
        [...varintField(1, 2), ...varintField(1, 0), ...varintField(1, 3)]
      : packedInt32Field(1, range);
  const encodedSymbol = symbol === null ? [] : stringField(2, symbol);
  return [
    ...encodedRange,
    ...encodedSymbol,
    ...varintField(3, roles),
    // syntax_kind (5) and an unknown varint field must be skipped.
    ...varintField(5, 6),
    ...varintField(99, 7),
  ];
}

function document(relativePath: string, occurrences: number[][]): number[] {
  return [
    ...stringField(1, relativePath),
    ...occurrences.flatMap((payload) => messageField(2, payload)),
    ...messageField(3, [
      ...stringField(1, `doc:${relativePath}`),
      ...stringField(99, 'unknown symbol field'),
    ]),
    ...stringField(4, 'Python'),
    ...stringField(99, 'unknown document field'),
  ];
}

function fixtureIndex(): Uint8Array {
  const aPy = document('a.py', [
    occurrence([0, 0, 1], SYMBOL_F, 0x1), // definition, line 1
    occurrence([4, 2, 7, 9], SYMBOL_H, 0x1), // 4-element range, line 5
  ]);
  const bPy = document('b.py', [
    occurrence([1, 0, 3], SYMBOL_H, 0x2), // import role, line 2
    occurrence([3, 0, 4], SYMBOL_F, 0), // reference, line 4
    occurrence([7, 0, 8], SYMBOL_F, 0), // reference, line 8
    occurrence([5, 0, 6], LOCAL_G, 0), // local reference, ignored
  ]);
  const cPy = document('c.py', [
    occurrence('non-packed', LOCAL_G, 0x1), // local definition, line 3
    occurrence([9, 0, 10], null, 0), // no symbol: dropped by the parser
  ]);
  return new Uint8Array([
    // Index.metadata (1), external_symbols (3) and unknown fields are skipped.
    ...messageField(1, stringField(3, '/tmp/corpus')),
    ...messageField(2, aPy),
    ...messageField(2, bPy),
    ...messageField(2, cPy),
    ...messageField(3, stringField(1, 'external symbol')),
    ...unknownFixed32Field(15),
  ]);
}

const OPTIONS = {
  corpusId: 'python-attrs',
  corpusCommit: '9a98e00a7c078360add417c5d62db820d4645ab1',
  language: 'python',
  frozenAt: '2026-10-07T00:00:00.000Z',
  seed: 6190701,
} as const;

function referenceQuestionsOf(envelope: {
  readonly questions: readonly unknown[];
}): ScipReferenceQuestion[] {
  return envelope.questions.filter(
    (question): question is ScipReferenceQuestion =>
      typeof question === 'object' &&
      question !== null &&
      'query' in question &&
      'truth' in question,
  );
}

function dependencyQuestionsOf(envelope: {
  readonly questions: readonly unknown[];
}): ScipDependencyQuestion[] {
  return envelope.questions.filter(
    (question): question is ScipDependencyQuestion =>
      typeof question === 'object' &&
      question !== null &&
      'pathForms' in question,
  );
}

describe('scip-cross-check ground truth', () => {
  let index: ScipIndex;
  let envelope: ScipEnvelope;

  beforeEach(() => {
    index = parseScipIndex(fixtureIndex());
    envelope = generatePolyglotQuestions(index, OPTIONS);
  });

  it('parses occurrences with 1-based lines, roles, and skipped unknown fields', () => {
    expect(index.documents.map((document) => document.relativePath)).toEqual([
      'a.py',
      'b.py',
      'c.py',
    ]);
    const aPy = index.documents[0];
    expect(aPy.language).toBe('Python');
    expect(aPy.symbols).toEqual(['doc:a.py']);
    expect(aPy.occurrences).toEqual([
      { line: 1, symbol: SYMBOL_F, isDefinition: true, isImport: false },
      { line: 5, symbol: SYMBOL_H, isDefinition: true, isImport: false },
    ]);
    expect(index.documents[1]?.occurrences).toEqual([
      { line: 2, symbol: SYMBOL_H, isDefinition: false, isImport: true },
      { line: 4, symbol: SYMBOL_F, isDefinition: false, isImport: false },
      { line: 8, symbol: SYMBOL_F, isDefinition: false, isImport: false },
      { line: 6, symbol: LOCAL_G, isDefinition: false, isImport: false },
    ]);
    // The symbol-less occurrence is dropped and the non-packed range
    // (three separate field-1 entries) still lands on line 3.
    expect(index.documents[2]?.occurrences).toEqual([
      { line: 3, symbol: LOCAL_G, isDefinition: true, isImport: false },
    ]);
  });

  it('normalizes win32 separators in document paths', () => {
    const windowsIndex = parseScipIndex(
      Uint8Array.from(messageField(2, document('src\\pkg\\a.py', []))),
    );
    expect(windowsIndex.documents[0]?.relativePath).toBe('src/pkg/a.py');
  });

  it('extracts the final descriptor name from SCIP symbol strings', () => {
    expect(symbolName('test npm pkg 1.0.0 src/a.ts `foo`().')).toBe('foo');
    expect(symbolName('test npm pkg 1.0.0 src/a.ts foo.')).toBe('foo');
    expect(symbolName('test npm pkg 1.0.0 src/a.ts Foo#')).toBe('Foo');
    expect(symbolName('github.com/sirupsen/logrus v1.9.4 logrus/Info().')).toBe(
      'Info',
    );
    expect(symbolName('test go mod v1.0.0 pkg.Foo#field().')).toBe('field');
  });

  it('generates reference truth that includes the definition', () => {
    expect(envelope.id).toBe('python-attrs');
    expect(envelope.language).toBe('python');
    expect(envelope.version).toBe('1');
    expect(envelope.method).toBe('generated');
    expect(envelope.generator).toBe('scip-cross-check.ts');
    expect(envelope.frozenAt).toBe(OPTIONS.frozenAt);
    expect(envelope.corpusCommit).toBe(OPTIONS.corpusCommit);
    expect(envelope.seed).toBe(OPTIONS.seed);
    const fQuestion = referenceQuestionsOf(envelope).find(
      (question) => question.query === 'f',
    );
    expect(fQuestion?.file).toBe('a.py');
    expect(fQuestion?.line).toBe(1);
    expect(fQuestion?.stratum).toBe('under-5');
    expect(fQuestion?.declarationIncluded).toBe(true);
    expect(fQuestion?.truth).toEqual(['a.py:1', 'b.py:4', 'b.py:8']);
    const hQuestion = referenceQuestionsOf(envelope).find(
      (question) => question.query === 'h',
    );
    expect(hQuestion?.truth).toEqual(['a.py:5', 'b.py:2']);
    // Deterministic for a fixed seed.
    expect(generatePolyglotQuestions(index, OPTIONS)).toEqual(envelope);
  });

  it('generates file-level dependency questions and ignores local symbols', () => {
    const questions = dependencyQuestionsOf(envelope);
    expect(questions.map((question) => question.file).sort()).toEqual([
      'a.py',
      'b.py',
      'c.py',
    ]);
    const aPy = questions.find((question) => question.file === 'a.py');
    expect(aPy?.pathForms).toEqual(['relative', 'absolute']);
    expect(aPy?.dependents).toEqual(['b.py']);
    expect(aPy?.dependencies).toEqual([]);
    expect(aPy?.imports).toEqual([]);
    const bPy = questions.find((question) => question.file === 'b.py');
    expect(bPy?.dependencies).toEqual(['a.py']);
    expect(bPy?.dependents).toEqual([]);
    // b.py references `local g` defined in c.py; local symbols create no edge.
    const cPy = questions.find((question) => question.file === 'c.py');
    expect(cPy?.dependencies).toEqual([]);
    expect(cPy?.dependents).toEqual([]);
  });

  it('records unfilled strata in counts instead of throwing', () => {
    expect(envelope.counts['under-5']).toBe(2);
    expect(envelope.counts['5-50']).toBe(0);
    expect(envelope.counts['over-50']).toBe(0);
    expect(envelope.counts['references']).toBe(2);
    expect(envelope.counts['references-target']).toBe(50);
    expect(envelope.counts['unfilled-strata']).toBe(3);
    expect(envelope.counts['dependencies']).toBe(3);
    expect(envelope.counts['dependencies-target']).toBe(50);
  });

  it('writes pretty JSON with a trailing newline', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcp-bench-scip-'));
    try {
      writePolyglotQuestions(directory, 'python-attrs', envelope);
      const written = readFileSync(
        join(directory, 'python-attrs.json'),
        'utf8',
      );
      expect(written.endsWith('\n')).toBe(true);
      expect(written).toContain('"id": "python-attrs"');
      expect(JSON.parse(written)).toEqual(envelope);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it('detects absent indexers with a reason', () => {
    const detected = detectScipIndexers({}, () => null);
    expect(detected.typescript).toEqual({
      available: false,
      command: null,
      reason: expect.stringContaining('scip-typescript'),
    });
    expect(detected.python.available).toBe(false);
    expect(detected.python.command).toBe(null);
    expect(detected.python.reason).toContain('PATH');
    expect(detected.go.available).toBe(false);
    expect(detected.go.reason).toContain('PTAH_BENCH_SCIP_GO');
  });

  it('honors environment overrides and PATH lookup', () => {
    const withOverride = detectScipIndexers(
      { PTAH_BENCH_SCIP_PYTHON: '/wsl/usr/local/bin/scip-python' },
      (command) =>
        command === '/wsl/usr/local/bin/scip-python' ? command : null,
    );
    expect(withOverride.python).toEqual({
      available: true,
      command: '/wsl/usr/local/bin/scip-python',
      reason: null,
    });
    expect(withOverride.typescript.available).toBe(false);
    expect(withOverride.go.available).toBe(false);
    const onPath = detectScipIndexers({}, (command) =>
      command === 'scip-go' ? 'C:\\Users\\bench\\go\\bin\\scip-go.exe' : null,
    );
    expect(onPath.go).toEqual({
      available: true,
      command: 'C:\\Users\\bench\\go\\bin\\scip-go.exe',
      reason: null,
    });
  });

  it('reports an override that cannot be resolved', () => {
    const detected = detectScipIndexers(
      { PTAH_BENCH_SCIP_GO: 'C:\\missing\\scip-go.exe' },
      () => null,
    );
    expect(detected.go.available).toBe(false);
    expect(detected.go.command).toBe(null);
    expect(detected.go.reason).toContain('PTAH_BENCH_SCIP_GO');
    expect(detected.go.reason).toContain('C:\\missing\\scip-go.exe');
  });

  it('produces a schema-valid na record when an indexer is absent', () => {
    const record = naRecord('python', 'scip-python 0.6.6 crashes on Windows');
    expect(scipNaEnvelopeSchema.parse(record)).toEqual(record);
    expect(record.id).toBe('python');
    expect(record.language).toBe('python');
    expect(record.version).toBe('1');
    expect(record.method).toBe('generated');
    expect(record.generator).toBe('scip-cross-check.ts');
    expect(record.counts).toEqual({});
    expect(record.questions).toEqual([]);
    expect(record.na).toEqual({
      reason: 'scip-python 0.6.6 crashes on Windows',
    });
  });

  it('compares SCIP truth against the Batch 5 reference questions', () => {
    const agreement = compareWithTsTruth(index, {
      questions: [
        {
          id: 'reference-1',
          query: 'f',
          file: 'a.py',
          line: 1,
          truth: ['a.py:1', 'b.py:4', 'b.py:8'],
        },
        {
          id: 'reference-2',
          query: 'f',
          file: 'a.py',
          line: 1,
          truth: ['a.py:1', 'b.py:4'],
        },
        {
          id: 'reference-3',
          query: 'absent',
          file: 'a.py',
          line: 1,
          truth: ['a.py:1'],
        },
      ],
    });
    expect(agreement.compared).toBe(2);
    expect(agreement.unmatched).toBe(1);
    expect(agreement.perQuestion).toEqual([
      { id: 'reference-1', jaccard: 1, onlyTs: 0, onlyScip: 0 },
      { id: 'reference-2', jaccard: 2 / 3, onlyTs: 0, onlyScip: 1 },
    ]);
    expect(agreement.meanJaccard).toBe((1 + 2 / 3) / 2);
    expect(agreement.exactRate).toBe(0.5);
  });
});
