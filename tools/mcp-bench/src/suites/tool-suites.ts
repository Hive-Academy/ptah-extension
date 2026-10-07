/**
 * The per-tool suites of the MCP benchmark (batches.md Task 9.1): for each
 * tool, which frozen questions it answers, the arguments it is called with
 * (the real input schemas of `tool-description.builder.ts`), how its result
 * text is read back as an answer, which native baselines it is compared with,
 * and which claim of the prompt (`ptah-core-prompt.ts:<line>`) it is held to.
 *
 * How a result text is read back as an answer lives in `tool-results.ts`.
 * Truths are workspace-relative with 1-based lines; the tool's arguments
 * join them to this run's corpus root.
 */

import { join } from 'node:path';

import {
  astBaseline,
  definitionsBaseline,
  dependentsBaseline,
  globBaseline,
  memoryBaseline,
  referencesBaseline,
  relevanceBaseline,
  relevanceGitLogBaseline,
  symbolsConceptBaseline,
  symbolsExactBaseline,
  textLiteralBaseline,
  textRegexBaseline,
  type NativeContext,
} from '../baselines/native-baselines';
import { buildMemoryQuestionSet } from '../ground-truth/memory-questions';
import { mulberry32 } from '../ground-truth/ts-program';
import { type Truth, hitAtK } from '../metrics/retrieval-metrics';
import type { RetryPolicy } from '../transport/call-recorder';
import type { MemorySeedRoots } from '../transport/memory-seed-env';
import type {
  AstQuestion,
  DefinitionQuestion,
  DependencyQuestion,
  GlobQuestion,
  MemoryQuestion,
  PolyglotQuestionSet,
  QuestionBank,
  QuestionSet,
  ReferenceQuestion,
  RelevanceQuestion,
  SymbolQuestion,
  TextQuestion,
} from './question-sets';
import {
  NOISE_MARGIN,
  nativeBaseline,
  sampleQuestions,
  type FailureEntry,
  type QuestionRecord,
  type SuiteClaim,
  type ToolSuiteDefinition,
} from './suite-runner';
import {
  RelativePathProbe,
  answerOf,
  columnOf,
  fileOf,
  filesOnly,
  namesPresent,
  parseFileList,
  parseGraphList,
  parseLspLocations,
  parseMemoryContents,
  parseRankedFiles,
  parseSymbolHits,
  parseSymbolIndex,
  parseTextLocations,
  tokenRatioP50,
} from './tool-results';

/** Questions per suite under `--smoke`. */
export const SMOKE_QUESTIONS = 40;
/** Seed of the `--smoke` sample. */
export const SMOKE_SEED = 6190901;
/** Results asked of ranked tools (top 10 is what recall@10 scores). */
const TOP_K = 10;
/**
 * Retry budget for the import-graph tools: their description says to call
 * again after `retryAfterMs` while the graph builds. Three retries, each wait
 * capped at the 15 s hint, as the live test that recorded `building` three
 * times; a fourth `building` is an error.
 */
export const GRAPH_RETRY: RetryPolicy = {
  maxRetries: 3,
  maxDelayMs: 15_000,
  defaultDelayMs: 15_000,
};
/** `ptah_ast_analyze` claims 40-60 % fewer tokens than Read: at most 0.6 of Read's tokens. */
const AST_MAX_TOKEN_RATIO = 0.6;

const PROMPT =
  'libs/backend/agent-sdk/src/lib/prompt-harness/ptah-core-prompt.ts';
const TOOL_DESCRIPTIONS =
  'libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/tool-description.builder.ts';

const claim = (line: number, text: string): SuiteClaim => ({
  source: 'prompt',
  ref: `${PROMPT}:${line}`,
  text,
});

export const CLAIMS = {
  searchFiles: claim(40, 'Respects .gitignore, workspace-indexed'),
  references: claim(42, 'LSP-accurate, cross-file, rename-safe'),
  definitions: claim(43, 'Go-to-definition via LSP'),
  codeSearch: claim(
    47,
    'BM25+vector symbol index — no false positives from string matches',
  ),
  astAnalyze: claim(48, '40-60% fewer tokens than Read'),
  enrich: claim(49, '.d.ts-style summary — signatures without bodies'),
  dependents: claim(50, 'Reverse import edges = blast radius'),
  memory: claim(51, 'Persistent cross-session memory (BM25+vector)'),
  relevance: claim(
    52,
    'Ranked 0-100 with reasons — triage before opening files',
  ),
  symbolIndex: claim(54, 'Map of file → exported symbol names'),
  dependencies: {
    source: 'tool-description',
    ref: `${TOOL_DESCRIPTIONS}:1837`,
    text: 'List the files that the given file imports (forward dependency edges)',
  } satisfies SuiteClaim,
  searchText: {
    source: 'tool-description',
    ref: 'ptah_search_text (tool description lands in Phase 2 Batch 33)',
    text: 'ranked ripgrep, compact output',
  } satisfies SuiteClaim,
} as const;

// ---------------------------------------------------------------------------
// shared pieces
// ---------------------------------------------------------------------------

/** What every suite builder needs about the run. */
export interface SuiteBuildContext {
  readonly corpusRoot: string;
  readonly native: NativeContext;
  /** `SMOKE_QUESTIONS` under `--smoke`, else `null` (every question). */
  readonly sample: number | null;
}

function pick<Q>(
  set: QuestionSet<Q>,
  sample: number | null,
  keep: (q: Q) => boolean = () => true,
): Q[] {
  const eligible = set.questions.filter(keep);
  return sample === null
    ? eligible
    : sampleQuestions(eligible, sample, mulberry32(SMOKE_SEED));
}

const abstainTruth = (items: readonly string[]): Truth =>
  items.length === 0 ? { items: [], abstain: true } : { items: [...items] };

// ---------------------------------------------------------------------------
// TS corpus suites
// ---------------------------------------------------------------------------

function symbolSuite(
  id: 'symbols-exact' | 'symbols-concept',
  set: QuestionSet<SymbolQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<SymbolQuestion> {
  const fileLevel = id === 'symbols-concept';
  const run = fileLevel ? symbolsConceptBaseline : symbolsExactBaseline;
  return {
    id,
    tool: 'ptah_code_search_symbols',
    claim: CLAIMS.codeSearch,
    groundTruth: set.groundTruth,
    primaryMetric: 'hit@5',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) =>
      q.abstain
        ? { items: [], abstain: true }
        : {
            items: fileLevel ? [...new Set(q.truth.map(fileOf))] : [...q.truth],
          },
    args: (q) => ({ query: q.query, maxResults: TOP_K }),
    parse: (text, q) =>
      parseSymbolHits(text, context.corpusRoot, q.truth, fileLevel),
    natives: [
      nativeBaseline<SymbolQuestion>(
        'native',
        fileLevel
          ? 'rg -i -l on the 3 longest tokens, by match count (file level)'
          : 'rg declaration pattern, then method/property pattern',
        (q) => run(q, context.native),
        fileLevel ? { mapAnswer: filesOnly } : {},
      ),
    ],
  };
}

function referenceSuite(
  id: string,
  set: QuestionSet<ReferenceQuestion>,
  context: SuiteBuildContext,
  extra: Partial<ToolSuiteDefinition<ReferenceQuestion>> = {},
): ToolSuiteDefinition<ReferenceQuestion> {
  return {
    id,
    tool: 'ptah_lsp_references',
    claim: CLAIMS.references,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall_all',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => ({ items: [...q.truth] }),
    args: (q) => ({
      file: join(context.corpusRoot, q.file),
      line: q.line - 1,
      col: columnOf(context.corpusRoot, q.file, q.line, q.query),
    }),
    parse: (text) => parseLspLocations(text, context.corpusRoot),
    natives: [
      nativeBaseline<ReferenceQuestion>(
        'native',
        'rg -n -w NAME, every line (no cap)',
        (q) => referencesBaseline(q, context.native),
      ),
    ],
    ...extra,
  };
}

function definitionSuite(
  set: QuestionSet<DefinitionQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<DefinitionQuestion> {
  return {
    id: 'definitions',
    tool: 'ptah_lsp_definitions',
    claim: CLAIMS.definitions,
    groundTruth: set.groundTruth,
    primaryMetric: 'hit@1',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => ({ items: [q.truth] }),
    args: (q) => ({
      file: join(context.corpusRoot, q.file),
      line: q.line - 1,
      col: q.column - 1,
    }),
    parse: (text) => parseLspLocations(text, context.corpusRoot),
    natives: [
      nativeBaseline<DefinitionQuestion>(
        'native',
        'rg definition pattern, same file first',
        (q) => definitionsBaseline(q, context.native),
      ),
    ],
  };
}

function graphSuite(
  id: string,
  key: 'dependents' | 'dependencies',
  set: QuestionSet<DependencyQuestion>,
  context: SuiteBuildContext,
  claimText: SuiteClaim,
  tsImportBaseline = true,
): ToolSuiteDefinition<DependencyQuestion> {
  const tool =
    key === 'dependents' ? 'ptah_get_dependents' : 'ptah_get_dependencies';
  const probe = new RelativePathProbe(tool, context.corpusRoot);
  const natives =
    key === 'dependents'
      ? [
          nativeBaseline<DependencyQuestion>(
            'native',
            tsImportBaseline
              ? 'rg -l "from \'…<stem>\'" over libs and apps'
              : 'rg -l "from \'…<stem>\'" over libs and apps (a TS import pattern: reported, not deciding, on this corpus)',
            (q) => dependentsBaseline(q, context.native),
            { decides: tsImportBaseline },
          ),
        ]
      : [
          nativeBaseline<DependencyQuestion>(
            'native-read',
            'Read of the file (cost only: no scripted import resolution in Phase 1)',
            (q) => astBaseline(q, context.native),
            { decides: false, scored: false },
          ),
        ];
  return {
    id,
    tool,
    claim: claimText,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall_all',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => abstainTruth(q[key]),
    // pathForms ['relative', 'absolute']: the absolute form is this run's corpus root joined.
    args: (q) => ({ file: join(context.corpusRoot, q.file) }),
    parse: (text) => parseGraphList(text, key, context.corpusRoot),
    natives,
    retry: GRAPH_RETRY,
    afterAnswer: (q, caller) => probe.probe(q.file, caller),
    findings: () => probe.finding(),
  };
}

function symbolIndexSuite(
  set: QuestionSet<SymbolQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<SymbolQuestion> {
  return {
    id: 'symbol-index',
    tool: 'ptah_get_symbol_index',
    claim: CLAIMS.symbolIndex,
    groundTruth: set.groundTruth,
    primaryMetric: 'hit@1',
    questions: pick(
      set,
      context.sample,
      (q) => !q.abstain && q.truth.length > 0,
    ),
    questionsInFile: set.questions.length,
    truth: (q) => ({ items: [...new Set(q.truth.map(fileOf))] }),
    args: (q) => ({ pathPrefix: fileOf(q.truth[0]), limit: 50 }),
    parse: (text, q) => parseSymbolIndex(text, q.query, context.corpusRoot),
    natives: [
      nativeBaseline<SymbolQuestion>(
        'native',
        'rg declaration pattern (file level)',
        (q) => symbolsExactBaseline(q, context.native),
        {
          mapAnswer: filesOnly,
        },
      ),
    ],
    retry: GRAPH_RETRY,
  };
}

function relevanceSuite(
  set: QuestionSet<RelevanceQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<RelevanceQuestion> {
  const test = set.questions.filter((q) => q.split === 'test');
  const composition = `${test.filter((q) => q.source === 'pr').length} PRs, ${test.filter((q) => q.source === 'commit').length} commits`;
  return {
    id: 'relevance',
    tool: 'ptah_relevance_rank_files',
    claim: CLAIMS.relevance,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall@10',
    // The held-out `test` split only (Batch 6); `tune` is for Phase 2 tuning.
    questions: pick(set, context.sample, (q) => q.split === 'test'),
    questionsInFile: test.length,
    truth: (q) => ({ items: [...q.truthFiles] }),
    args: (q) => ({ query: q.query, limit: TOP_K }),
    parse: (text) => parseRankedFiles(text, context.corpusRoot),
    natives: [
      nativeBaseline<RelevanceQuestion>(
        'native',
        'rg -il on query keywords, by match count',
        (q) => relevanceBaseline(q, context.native),
      ),
      nativeBaseline<RelevanceQuestion>(
        'native-git-log',
        'git log --grep on query keywords (second native view; cost kept apart from rg)',
        (q) => relevanceGitLogBaseline(q, context.native),
        { decides: false },
      ),
    ],
    breakdowns: (['pr', 'commit'] as const).map((source) => ({
      arm: `source:${source}`,
      filter: (q: RelevanceQuestion) => q.source === source,
      naReason: (count: number, total: number) =>
        `breakdown of the relevance test split by source ${source} (${count} of ${total}; the split holds ${composition}); the whole suite decides the verdict`,
    })),
  };
}

function structureSuite(
  id: 'ast-analyze' | 'context-enrich',
  set: QuestionSet<AstQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<AstQuestion> {
  const tool =
    id === 'ast-analyze' ? 'ptah_ast_analyze' : 'ptah_context_enrich_file';
  const names = (q: AstQuestion): string[] => [
    ...new Set(q.declarations.map((declaration) => declaration.name)),
  ];
  const ratios = (
    records: readonly QuestionRecord<AstQuestion>[],
    stratum?: string,
  ): number | null =>
    tokenRatioP50(
      records,
      (q) => stratum === undefined || q.stratum === stratum,
    );
  return {
    id,
    tool,
    claim: id === 'ast-analyze' ? CLAIMS.astAnalyze : CLAIMS.enrich,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall_all',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => abstainTruth(names(q)),
    args: (q) => ({ file: join(context.corpusRoot, q.file) }),
    parse: (text, q) => namesPresent(text, names(q)),
    natives: [
      nativeBaseline<AstQuestion>(
        'native',
        'Read of the whole file',
        (q) => astBaseline(q, context.native),
        {
          mapAnswer: (answer, q) =>
            namesPresent(answer.ranked[0] ?? '', names(q)),
        },
      ),
    ],
    // Token ratio tool/native (lower is better; <= 0.6 meets "40-60% fewer").
    extraDeltas: (records) => ({
      native: {
        'token_ratio.all': ratios(records),
        'token_ratio.small': ratios(records, 'small'),
        'token_ratio.medium': ratios(records, 'medium'),
        'token_ratio.large': ratios(records, 'large'),
      },
    }),
    ...(id === 'ast-analyze'
      ? {
          claimChecks: (records: readonly QuestionRecord<AstQuestion>[]) => {
            const ratio = ratios(records);
            return ratio !== null && ratio > AST_MAX_TOKEN_RATIO
              ? [
                  `the result is ${ratio} of Read's tokens (p50); the claim is 40-60% fewer (at most ${AST_MAX_TOKEN_RATIO})`,
                ]
              : [];
          },
        }
      : {}),
  };
}

function searchFilesSuite(
  set: QuestionSet<GlobQuestion>,
  context: SuiteBuildContext,
): ToolSuiteDefinition<GlobQuestion> {
  return {
    id: 'search-files',
    tool: 'ptah_search_files',
    claim: CLAIMS.searchFiles,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall_all',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => abstainTruth(q.truth),
    args: (q) => ({ pattern: q.pattern, limit: 100_000 }),
    parse: (text) => parseFileList(text, context.corpusRoot),
    natives: [
      nativeBaseline<GlobQuestion>('native', 'Glob (fast-glob)', (q) =>
        globBaseline(q, context.native),
      ),
    ],
  };
}

function searchTextSuite(
  set: QuestionSet<TextQuestion>,
  context: SuiteBuildContext,
  listed: boolean,
): ToolSuiteDefinition<TextQuestion> {
  return {
    id: 'search-text',
    tool: 'ptah_search_text',
    claim: CLAIMS.searchText,
    groundTruth: set.groundTruth,
    primaryMetric: 'recall_all',
    questions: pick(set, context.sample),
    questionsInFile: set.questions.length,
    truth: (q) => abstainTruth(q.truth),
    args: (q) => ({ query: q.query, regex: q.kind === 'text-regex' }),
    parse: (text) => parseTextLocations(text, context.corpusRoot),
    natives: [
      nativeBaseline<TextQuestion>(
        'native',
        'rg -n -F (literal) / rg -n -e (regex)',
        (q) =>
          q.kind === 'text-regex'
            ? textRegexBaseline(q, context.native)
            : textLiteralBaseline(q, context.native),
      ),
    ],
    ...(listed
      ? {}
      : {
          naReason:
            'ptah_search_text does not exist yet (Phase 2 Batch 33); scored once it is listed',
        }),
  };
}

/** Memory suite inputs; `roots: null` makes the suite `na` with `naReason`. */
export interface MemorySuiteOptions {
  readonly roots: MemorySeedRoots | null;
  readonly naReason?: string;
  /** Native comparison (rg over `.ptah/specs` plus `git log --grep`) context. */
  readonly native: NativeContext;
}

function memorySuite(
  set: QuestionSet<MemoryQuestion>,
  context: SuiteBuildContext,
  options: MemorySuiteOptions,
): ToolSuiteDefinition<MemoryQuestion> {
  const seeded = buildMemoryQuestionSet();
  // Content → stored row: the tool returns rows by content, the truth names rows by id.
  const rows = new Map<string, { id: string; root: 'A' | 'B' }>();
  for (const fact of seeded.facts)
    for (const row of fact.rows)
      rows.set(row.content.trim(), { id: row.id, root: fact.root });
  const scopeRoot = (q: MemoryQuestion): 'A' | 'B' =>
    q.scope === '<rootB>' ? 'B' : 'A';
  const leaks = new Map<string, number>();
  const totalLeaks = (): number =>
    [...leaks.values()].reduce((sum, count) => sum + count, 0);
  const scorable = set.questions.filter((q) => q.scorable !== false);
  const unscorable = set.questions.length - scorable.length;
  const worktreeIds = new Set(
    set.questions
      .filter((q) => q.scope === '<worktreeOfA>' && q.abstain !== true)
      .map((q) => q.id),
  );
  return {
    id: 'memory',
    tool: 'ptah_memory_search',
    claim: CLAIMS.memory,
    groundTruth: set.groundTruth,
    primaryMetric: 'hit@5',
    questions: pick(set, context.sample, (q) => q.scorable !== false),
    questionsInFile: set.questions.length,
    truth: (q) =>
      q.abstain === true
        ? { items: [], abstain: true }
        : { items: [...q.expectedFactIds] },
    workspaceRoot: (q) =>
      options.roots === null
        ? context.corpusRoot
        : q.scope === '<rootB>'
          ? options.roots.rootB
          : q.scope === '<worktreeOfA>'
            ? options.roots.worktreeOfA
            : options.roots.rootA,
    args: (q) => ({ query: q.query, maxResults: TOP_K }),
    parse: (text, q) => {
      const contents = parseMemoryContents(text);
      let leaked = 0;
      const ranked = contents.map((content) => {
        const row = rows.get(content);
        if (row === undefined) return `unseeded:${content.slice(0, 60)}`;
        if (row.root !== scopeRoot(q)) leaked += 1;
        return row.id;
      });
      leaks.set(q.id, leaked);
      return answerOf(ranked);
    },
    natives: [
      nativeBaseline<MemoryQuestion>(
        'native-comparison',
        'rg over .ptah/specs plus git log --grep (comparison view, not scored)',
        (q) => memoryBaseline(q, options.native),
        { decides: false, scored: false },
      ),
    ],
    claimChecks: (records) => {
      const reasons: string[] = [];
      const leaked = totalLeaks();
      if (leaked > 0)
        reasons.push(`cross-workspace leak count ${leaked} (expected 0)`);
      const worktree = records.filter(
        (record) => worktreeIds.has(record.question.id) && record.tool !== null,
      );
      const worktreeHits = worktree.filter(
        (record) =>
          hitAtK(
            record.tool?.answer ?? { ranked: [], abstained: false },
            record.truth,
            5,
          ) === 1,
      ).length;
      if (
        worktree.length > 0 &&
        worktreeHits / worktree.length < 1 - NOISE_MARGIN
      )
        reasons.push(
          `worktree-of-A queries found A's fact in the top 5 for ${worktreeHits} of ${worktree.length}`,
        );
      return reasons;
    },
    findings: () => [
      {
        question: '(ground truth)',
        expected: [`${scorable.length} scorable of ${set.questions.length}`],
        got: [
          `${unscorable} labelled TASK_2026_473 track-A queries are unscorable (no user data is seeded)`,
          `leak count ${totalLeaks()}`,
        ],
      },
    ],
    ...(options.roots === null
      ? {
          naReason:
            options.naReason ?? 'memory seeding is not available on this host',
        }
      : {}),
  };
}

/** Everything a TS-corpus run scores, in scorecard order. */
export function buildTsSuites(
  bank: QuestionBank,
  context: SuiteBuildContext,
  options: {
    readonly listedTools: ReadonlySet<string>;
    readonly memory: MemorySuiteOptions;
  },
): ToolSuiteDefinition<{ readonly id: string }>[] {
  const fileTools = bank.fileTools;
  const ofKind = <K extends string>(kinds: readonly K[]) => ({
    ...fileTools,
    questions: fileTools.questions.filter((q) =>
      (kinds as readonly string[]).includes(q.kind),
    ),
  });
  const agreement = new Map(
    bank.tsAgreement.perQuestion.map((item) => [item.id, item]),
  );
  const exact = bank.tsAgreement.perQuestion.filter(
    (item) => item.jaccard === 1,
  ).length;
  return [
    symbolSuite('symbols-exact', bank.symbolsExact, context),
    symbolSuite('symbols-concept', bank.symbolsConcept, context),
    relevanceSuite(bank.relevance, context),
    referenceSuite('references', bank.references, context, {
      breakdowns: [
        {
          arm: 'scip-strict',
          filter: (q) => agreement.get(q.id)?.jaccard === 1,
          naReason: (count, total) =>
            `SCIP-strict second view (${bank.tsAgreement.indexer}, ts-agreement.json): ${count} of ${total} questions whose SCIP set equals the TS truth (${exact} of ${bank.tsAgreement.compared} compared; mean Jaccard ${bank.tsAgreement.meanJaccard.toFixed(3)}; SCIP keeps each symbol apart and never finds a reference the TS truth misses). Never the verdict: the TS editor-semantics truth decides.`,
        },
        {
          arm: 'same-name',
          filter: (q) => q.sameName === true,
          naReason: (count, total) =>
            `breakdown: identifiers sharing their name with another symbol (${count} of ${total}), the rename-safe case; the whole suite decides the verdict`,
        },
      ],
    }),
    definitionSuite(bank.definitions, context),
    graphSuite(
      'dependents',
      'dependents',
      bank.dependents,
      context,
      CLAIMS.dependents,
    ),
    graphSuite(
      'dependencies',
      'dependencies',
      bank.dependents,
      context,
      CLAIMS.dependencies,
    ),
    symbolIndexSuite(bank.symbolsExact, context),
    memorySuite(bank.memory, context, options.memory),
    structureSuite(
      'ast-analyze',
      ofKind(['ast'] as const) as QuestionSet<AstQuestion>,
      context,
    ),
    structureSuite(
      'context-enrich',
      ofKind(['ast'] as const) as QuestionSet<AstQuestion>,
      context,
    ),
    searchFilesSuite(
      ofKind(['glob'] as const) as QuestionSet<GlobQuestion>,
      context,
    ),
    searchTextSuite(
      ofKind([
        'text-literal',
        'text-regex',
      ] as const) as QuestionSet<TextQuestion>,
      context,
      options.listedTools.has('ptah_search_text'),
    ),
  ] as ToolSuiteDefinition<{ readonly id: string }>[];
}

/**
 * The Python or Go suites of one Batch 7 SCIP set, scored on that corpus:
 * references against the SCIP truth (its unfilled strata quoted, not padded)
 * and dependents. A frozen `na` record makes both suites `na`.
 */
export function buildPolyglotSuites(
  set: PolyglotQuestionSet,
  context: SuiteBuildContext,
): ToolSuiteDefinition<{ readonly id: string }>[] {
  const counts = set.references.counts;
  const shortfall: FailureEntry = {
    question: '(ground truth)',
    expected: [`${counts['references-target'] ?? 50} reference questions`],
    got: [
      `${counts['references'] ?? set.references.questions.length} (under-5 ${counts['under-5'] ?? 0}/${counts['under-5-target'] ?? 0}, 5-50 ${counts['5-50'] ?? 0}/${counts['5-50-target'] ?? 0}, over-50 ${counts['over-50'] ?? 0}/${counts['over-50-target'] ?? 0}); the pinned corpus is small, strata are not refilled`,
    ],
  };
  const na =
    set.references.naReason === undefined
      ? {}
      : { naReason: `SCIP ground truth absent: ${set.references.naReason}` };
  const references = referenceSuite(
    `references-${set.corpusId}`,
    set.references,
    context,
    {
      findings: () => [shortfall],
      ...na,
    },
  );
  const dependents = graphSuite(
    `dependents-${set.corpusId}`,
    'dependents',
    set.dependents,
    context,
    CLAIMS.dependents,
    false,
  );
  return [references, { ...dependents, ...na }] as ToolSuiteDefinition<{
    readonly id: string;
  }>[];
}
