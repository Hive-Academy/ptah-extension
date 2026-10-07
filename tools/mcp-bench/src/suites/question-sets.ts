/**
 * The frozen question files of Batches 5, 6 and 7, read and validated in one
 * place. Batch 5 (`symbol-questions.ts`, `graph-questions.ts`), Batch 6
 * (`relevance-questions.ts`, `file-tool-questions.ts`, `memory-questions.ts`)
 * and Batch 7 (`scip-cross-check.ts`) each wrote the same envelope with its
 * own zod schema; this module is the one merged envelope schema the runner
 * reads them through (the short-lived duplication recorded at Batch 5/6 ends
 * here). Batch 6's per-question schemas are reused as exported; Batch 5's
 * question shapes were never exported as schemas, so they are declared here.
 *
 * Every file carries its ground-truth identity (`id`, `version`, `method`,
 * `raterCount`, `frozenAt`), which the scorecard's `groundTruth` mirrors, and
 * the SHA-256 of its bytes, which the scorecard lists as an artifact.
 */

import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join, relative } from 'node:path';

import { z } from 'zod';

import { fileToolsQuestionFileSchema } from '../ground-truth/file-tool-questions';
import { memoryQuestionFileSchema } from '../ground-truth/memory-questions';
import { relevanceQuestionFileSchema } from '../ground-truth/relevance-questions';

/** The merged envelope: every frozen question file has these fields. */
export const questionEnvelopeSchema = z.object({
  id: z.string().min(1),
  version: z.literal('1'),
  method: z.enum(['generated', 'labelled', 'seeded', 'git-history']),
  raterCount: z.number().int().positive().optional(),
  frozenAt: z.string().datetime(),
  corpusCommit: z.string(),
  generator: z.string().min(1),
  seed: z.number().nullable(),
  counts: z.record(z.string(), z.number().int().nonnegative()),
  questions: z.array(z.unknown()),
  /** Batch 7 (SCIP): the corpus language. */
  language: z.string().min(1).optional(),
  /** Batch 7 (SCIP): present when the indexer was absent; the suite is `na`. */
  na: z.object({ reason: z.string().min(1) }).optional(),
});

export const symbolQuestionSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  truth: z.array(z.string().min(1)),
  abstain: z.boolean(),
  stratum: z.string().min(1),
  truthCount: z.number().int().nonnegative(),
});
export type SymbolQuestion = z.infer<typeof symbolQuestionSchema>;

/** A reference question (Batch 5 TS truth, or Batch 7 SCIP truth). Lines are 1-based. */
export const referenceQuestionSchema = z.object({
  id: z.string().min(1),
  query: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  truth: z.array(z.string().min(1)),
  declarationIncluded: z.boolean(),
  stratum: z.string().min(1),
  sameName: z.boolean().optional(),
});
export type ReferenceQuestion = z.infer<typeof referenceQuestionSchema>;

/** A definition call site. `line` and `column` are 1-based. */
export const definitionQuestionSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  line: z.number().int().positive(),
  column: z.number().int().positive(),
  query: z.string().min(1),
  truth: z.string().min(1),
});
export type DefinitionQuestion = z.infer<typeof definitionQuestionSchema>;

/** A dependents/dependencies file; `file` is workspace-relative, joined to the run's corpus root. */
export const dependencyQuestionSchema = z.object({
  id: z.string().min(1),
  file: z.string().min(1),
  pathForms: z.tuple([z.literal('relative'), z.literal('absolute')]),
  dependencies: z.array(z.string().min(1)),
  dependents: z.array(z.string().min(1)),
  imports: z.array(z.string().min(1)).optional(),
});
export type DependencyQuestion = z.infer<typeof dependencyQuestionSchema>;

export type RelevanceQuestion = z.infer<
  typeof relevanceQuestionFileSchema
>['questions'][number];
export type MemoryQuestion = z.infer<
  typeof memoryQuestionFileSchema
>['questions'][number];
export type FileToolQuestion = z.infer<
  typeof fileToolsQuestionFileSchema
>['questions'][number];
export type AstQuestion = Extract<FileToolQuestion, { kind: 'ast' }>;
export type GlobQuestion = Extract<FileToolQuestion, { kind: 'glob' }>;
export type TextQuestion = Extract<
  FileToolQuestion,
  { kind: 'text-literal' | 'text-regex' }
>;

const tsAgreementSchema = z.object({
  id: z.literal('ts-agreement'),
  version: z.literal('1'),
  frozenAt: z.string().datetime(),
  corpusCommit: z.string().min(1),
  generator: z.string().min(1),
  indexer: z.string().min(1),
  compared: z.number().int().nonnegative(),
  unmatched: z.number().int().nonnegative(),
  meanJaccard: z.number(),
  exactRate: z.number(),
  perQuestion: z.array(
    z.object({
      id: z.string().min(1),
      jaccard: z.number(),
      onlyTs: z.number().int().nonnegative(),
      onlyScip: z.number().int().nonnegative(),
    }),
  ),
});
export type TsAgreement = z.infer<typeof tsAgreementSchema>;

/** The scorecard `groundTruth` of a question file. */
export interface GroundTruthRef {
  readonly id: string;
  readonly version: string;
  readonly method: 'generated' | 'labelled' | 'seeded' | 'git-history';
  readonly raterCount?: number;
  readonly frozenAt: string;
}

/** One validated question file. */
export interface QuestionSet<Q> {
  readonly groundTruth: GroundTruthRef;
  readonly corpusCommit: string;
  readonly counts: Readonly<Record<string, number>>;
  readonly questions: readonly Q[];
  /** Path relative to the project root, for the scorecard artifact. */
  readonly path: string;
  readonly sha256: string;
  readonly language?: string;
  /** Set when the frozen file is the `na` record of an absent indexer. */
  readonly naReason?: string;
}

/** Every question file the suites read. */
export interface QuestionBank {
  readonly symbolsExact: QuestionSet<SymbolQuestion>;
  readonly symbolsConcept: QuestionSet<SymbolQuestion>;
  readonly references: QuestionSet<ReferenceQuestion>;
  readonly definitions: QuestionSet<DefinitionQuestion>;
  readonly dependents: QuestionSet<DependencyQuestion>;
  readonly relevance: QuestionSet<RelevanceQuestion>;
  readonly memory: QuestionSet<MemoryQuestion>;
  readonly fileTools: QuestionSet<FileToolQuestion>;
  readonly polyglot: readonly PolyglotQuestionSet[];
  readonly tsAgreement: TsAgreement & {
    readonly path: string;
    readonly sha256: string;
  };
}

/** A Batch 7 SCIP question file split into its two question kinds. */
export interface PolyglotQuestionSet {
  readonly corpusId: string;
  readonly references: QuestionSet<ReferenceQuestion>;
  readonly dependents: QuestionSet<DependencyQuestion>;
}

interface RawFile {
  readonly envelope: z.infer<typeof questionEnvelopeSchema>;
  readonly path: string;
  readonly sha256: string;
  readonly raw: unknown;
}

function readJson(path: string): { raw: unknown; sha256: string } {
  const bytes = readFileSync(path);
  return {
    raw: JSON.parse(bytes.toString('utf8')) as unknown,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  };
}

function readEnvelope(projectRoot: string, path: string): RawFile {
  const { raw, sha256 } = readJson(path);
  const parsed = questionEnvelopeSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error(
      `${path}: not a question file: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
    );
  }
  return {
    envelope: parsed.data,
    path: relative(projectRoot, path).replaceAll('\\', '/'),
    sha256,
    raw,
  };
}

function toSet<Q>(
  file: RawFile,
  questions: readonly Q[],
  counts: Readonly<Record<string, number>> = file.envelope.counts,
): QuestionSet<Q> {
  const { envelope } = file;
  return {
    groundTruth: {
      id: envelope.id,
      version: envelope.version,
      method: envelope.method,
      ...(envelope.raterCount === undefined
        ? {}
        : { raterCount: envelope.raterCount }),
      frozenAt: envelope.frozenAt,
    },
    corpusCommit: envelope.corpusCommit,
    counts,
    questions,
    path: file.path,
    sha256: file.sha256,
    ...(envelope.language === undefined ? {} : { language: envelope.language }),
    ...(envelope.na === undefined ? {} : { naReason: envelope.na.reason }),
  };
}

function parseQuestions<Q>(
  file: RawFile,
  schema: z.ZodType<Q>,
  questions: readonly unknown[] = file.envelope.questions,
): Q[] {
  return questions.map((question, index) => {
    const parsed = schema.safeParse(question);
    if (!parsed.success) {
      throw new Error(
        `${file.path}: question ${index} is invalid: ${parsed.error.issues.map((issue) => `${issue.path.join('.')} ${issue.message}`).join('; ')}`,
      );
    }
    return parsed.data;
  });
}

/** Reads one Batch 7 SCIP file (`na` record or question set). */
function readPolyglot(projectRoot: string, path: string): PolyglotQuestionSet {
  const file = readEnvelope(projectRoot, path);
  const isReference = (question: unknown): boolean =>
    String((question as { id?: unknown }).id ?? '').startsWith('reference-');
  const references = parseQuestions(
    file,
    referenceQuestionSchema,
    file.envelope.questions.filter(isReference),
  );
  const dependents = parseQuestions(
    file,
    dependencyQuestionSchema,
    file.envelope.questions.filter((question) => !isReference(question)),
  );
  return {
    corpusId: file.envelope.id,
    references: toSet(file, references),
    dependents: toSet(file, dependents),
  };
}

/**
 * Reads and validates every question file for `corpusCommit` under
 * `<projectRoot>/questions/<corpusCommit>/` and `<projectRoot>/questions/scip/`.
 * A file that does not match its schema throws, naming the file and question:
 * a broken ground truth breaks the run, it is never scored.
 */
export function loadQuestionBank(
  projectRoot: string,
  corpusCommit: string,
): QuestionBank {
  const dir = join(projectRoot, 'questions', corpusCommit);
  const scipDir = join(projectRoot, 'questions', 'scip');
  const envelope = (name: string): RawFile =>
    readEnvelope(projectRoot, join(dir, `${name}.json`));

  const symbolsExact = envelope('symbols-exact');
  const symbolsConcept = envelope('symbols-concept');
  const references = envelope('references');
  const definitions = envelope('definitions');
  const dependents = envelope('dependents');

  const relevancePath = join(dir, 'relevance.json');
  const relevance = readEnvelope(projectRoot, relevancePath);
  const relevanceFile = relevanceQuestionFileSchema.parse(relevance.raw);
  const memory = envelope('memory');
  const memoryFile = memoryQuestionFileSchema.parse(memory.raw);
  const fileTools = envelope('file-tools');
  const fileToolsFile = fileToolsQuestionFileSchema.parse(fileTools.raw);

  const agreementPath = join(scipDir, 'ts-agreement.json');
  const agreementJson = readJson(agreementPath);
  const agreement = tsAgreementSchema.parse(agreementJson.raw);

  for (const file of [symbolsExact, references, relevance, memory, fileTools]) {
    if (file.envelope.corpusCommit !== corpusCommit) {
      throw new Error(
        `${file.path}: frozen for corpus ${file.envelope.corpusCommit}, the run pins ${corpusCommit}`,
      );
    }
  }

  return {
    symbolsExact: toSet(
      symbolsExact,
      parseQuestions(symbolsExact, symbolQuestionSchema),
    ),
    symbolsConcept: toSet(
      symbolsConcept,
      parseQuestions(symbolsConcept, symbolQuestionSchema),
    ),
    references: toSet(
      references,
      parseQuestions(references, referenceQuestionSchema),
    ),
    definitions: toSet(
      definitions,
      parseQuestions(definitions, definitionQuestionSchema),
    ),
    dependents: toSet(
      dependents,
      parseQuestions(dependents, dependencyQuestionSchema),
    ),
    relevance: toSet(relevance, relevanceFile.questions, relevanceFile.counts),
    memory: toSet(memory, memoryFile.questions, memoryFile.counts),
    fileTools: toSet(fileTools, fileToolsFile.questions, fileToolsFile.counts),
    polyglot: ['python-attrs', 'go-logrus'].map((name) =>
      readPolyglot(projectRoot, join(scipDir, `${name}.json`)),
    ),
    tsAgreement: {
      ...agreement,
      path: relative(projectRoot, agreementPath).replaceAll('\\', '/'),
      sha256: agreementJson.sha256,
    },
  };
}
