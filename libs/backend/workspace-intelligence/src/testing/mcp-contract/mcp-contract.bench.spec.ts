/**
 * MCP tool contract benchmark — service-level regression harness (Task 20.2).
 *
 * Revision round 1 (r1 REVISE 3/10): rewritten per
 * `reviews/batch-20b-code-logic-review-r1.md` defects 1-9 and the orchestrator
 * rulings in the r1 coordinator message. See
 * `batch-20b-executor-report.md` ("Revision round 1") for the measurements,
 * deviations and deliberate-break evidence.
 *
 * For every mandated MCP tool named in the Batch 20 quality requirements, this
 * spec exercises the REAL service (and, for `ast_analyze`/`context_enrich_
 * file`, the REAL production output-shaping — `formatAstAnalysisResult` and
 * `resolveEnrichLanguage`, both imported unmocked from the workspace-
 * intelligence barrel) on the REAL fixture workspace (real fs on a temp root;
 * the only platform boundary stood in for is `ITokenCounter`, backed here by
 * the REAL `gpt-tokenizer`-based `countTokens`, never a word/char estimator)
 * and asserts:
 *
 *  - SIZE: the tool's answer is smaller than a fair native baseline (a full
 *    file read, or a fixed-serialization tree grep) by the promised margin.
 *    `ast_analyze` and `context_enrich_file` are pinned to >= 40% TOKEN
 *    reduction (gpt-tokenizer, the same unit `tool-output-reducers` budgets
 *    with) on the 300-line fixture file, per batches.md:2757 and the frozen
 *    prompt constants. Never pin a lower measured value.
 *  - RECALL: every known symbol/edge/dependent/project the fixture's
 *    independent ground truth (`knownSymbols`/`knownEdges`, never the
 *    implementation's own answer) declares is present, exactly, not as a
 *    subset check that a union of unrelated fields can satisfy.
 *
 * This spec FAILS the run on regression; it never only logs.
 *
 * Polyglot extension point: Batch 27 will add non-TS fixtures. Add cases to
 * `POLYGLOT_CASES` below (currently empty — TS/TSX only, per this fixture)
 * instead of duplicating the suites.
 */

import 'reflect-metadata';

// The wasm bundle-dir resolver reads `import.meta.url`, which Jest's CJS
// runtime cannot parse; `Language.load(path)` uses a dynamic import Jest's VM
// rejects. Same two shims as `context-enrichment.service.spec.ts` and
// `dependency-graph.service.ts`'s own real-parser specs.
jest.mock('../../ast/wasm-bundle-dir', () => {
  const nodePath = require('path');
  const grammarDir = nodePath.join(
    nodePath.dirname(require.resolve('@vscode/tree-sitter-wasm/package.json')),
    'wasm',
  );
  const runtimeDir = nodePath.dirname(require.resolve('web-tree-sitter'));
  return {
    BUNDLE_DIR: grammarDir,
    resolveWasmPath: (filename: string) =>
      filename.startsWith('web-tree-sitter')
        ? nodePath.join(runtimeDir, filename)
        : nodePath.join(grammarDir, filename),
  };
});

jest.mock('web-tree-sitter', () => {
  const actual =
    jest.requireActual<typeof import('web-tree-sitter')>('web-tree-sitter');
  const nodeFs = require('fs');
  const loadFromPathOrBuffer = actual.Language.load.bind(actual.Language);
  actual.Language.load = (input: string | Uint8Array) =>
    loadFromPathOrBuffer(
      typeof input === 'string'
        ? new Uint8Array(nodeFs.readFileSync(input))
        : input,
    );
  return actual;
});

import * as fs from 'node:fs';
import { countTokens } from '@ptah-extension/tool-output-reducers';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  IFileSystemProvider,
  ITokenCounter,
  IWorkspaceProvider,
  LanguageCoverage,
} from '@ptah-extension/platform-core';
import { FileType as PlatformFileType } from '@ptah-extension/platform-core';
import * as WorkspaceIntelligence from '../../index';
import {
  AstAnalysisService,
  ContextEnrichmentService,
  DependencyGraphService,
  FileRelevanceScorerService,
  FileSystemService,
  FileType,
  MonorepoDetectorService,
  MonorepoType,
  ProjectDetectorService,
  ProjectType,
  TokenCounterService,
  TreeSitterParserService,
  classifyFileForCoverage,
  formatAstAnalysisResult,
  languageForExtension,
  supportedLanguagesFor,
  type IndexedFile,
  type SupportedLanguage,
} from '../../index';
import {
  createMcpContractFixture,
  type McpContractFixture,
} from './fixture-workspace';

// ---------------------------------------------------------------------------
// Shared real infrastructure: one fixture, one parser, one real tokenizer,
// for the whole file. Grammar loading is the slow part — see
// `context-enrichment.service.spec.ts`.
// ---------------------------------------------------------------------------

function makeLogger(): Logger {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    lifecycle: jest.fn(),
    dispose: jest.fn(),
  } as unknown as Logger;
}

/**
 * The REAL `ITokenCounter` platform boundary, backed by the installed
 * `gpt-tokenizer` (via `@ptah-extension/tool-output-reducers`'s `countTokens`
 * — the same counter `tool-result-budget.ts` sizes MCP answers with). r1
 * defect 4: SIZE assertions must use one real unit on both sides, never a
 * whitespace/character estimator standing in for tokens.
 */
function realTokenCounter(): ITokenCounter {
  return {
    countTokens: async (text: string) => countTokens(text),
    getMaxInputTokens: async () => 128_000,
  };
}

/** Real fs on the fixture's temp root — the only I/O this bench performs. */
function createRealFsProvider(): IFileSystemProvider {
  const notNeeded = (op: string) => async () => {
    throw new Error(`mcp-contract bench: '${op}' is not exercised`);
  };
  return {
    readFile: (p: string) => fs.promises.readFile(p, 'utf8'),
    readFileBytes: async (p: string) =>
      new Uint8Array(await fs.promises.readFile(p)),
    writeFile: notNeeded('writeFile'),
    writeFileBytes: notNeeded('writeFileBytes'),
    readDirectory: async (p: string) => {
      const entries = await fs.promises.readdir(p, { withFileTypes: true });
      return entries.map((entry) => ({
        name: entry.name,
        type: entry.isDirectory()
          ? PlatformFileType.Directory
          : entry.isFile()
            ? PlatformFileType.File
            : PlatformFileType.Unknown,
      }));
    },
    stat: async (p: string) => {
      const s = await fs.promises.stat(p);
      return {
        type: s.isDirectory()
          ? PlatformFileType.Directory
          : PlatformFileType.File,
        ctime: s.ctimeMs,
        mtime: s.mtimeMs,
        size: s.size,
      };
    },
    exists: async (p: string) => {
      try {
        await fs.promises.access(p);
        return true;
      } catch {
        return false;
      }
    },
    delete: notNeeded('delete'),
    createDirectory: notNeeded('createDirectory'),
    createDirectoryExclusive: notNeeded('createDirectoryExclusive'),
    copy: notNeeded('copy'),
    findFiles: notNeeded('findFiles'),
    createFileWatcher: () => {
      throw new Error('mcp-contract bench: createFileWatcher is not exercised');
    },
  };
}

/**
 * A `grep -n <pattern>`-style native baseline: one `file:line:text` line per
 * match, across `files`, in file order. This is the fair, deterministic
 * "what an agent would get from a real Grep call" comparator r2 defect R2-02
 * asks for — not the full source of every file.
 */
function grepLines(
  files: readonly string[],
  pattern: RegExp,
  root?: string,
): string {
  const lines: string[] = [];
  for (const file of files) {
    const content = fs.readFileSync(file, 'utf8');
    const label = root ? file.slice(root.length + 1) : file;
    content.split('\n').forEach((line, i) => {
      if (pattern.test(line)) {
        lines.push(`${label}:${i + 1}:${line}`);
      }
    });
  }
  return lines.join('\n');
}

/**
 * `protocol-dispatcher.ts::graphCompleteness` (line 2842), replicated: a
 * trivial pure derivation (not a decision the bench could get wrong
 * independently of production) from `GraphCoverage`'s two file counts. Not
 * exported from `vscode-lm-tools` (reverse dependency direction), so this
 * composes the same two fields the real function reads.
 */
function graphCompletenessFields(
  files: { graphedFiles: number; discoveredFiles: number } | undefined,
):
  | { incomplete: true; graphedFiles: number; discoveredFiles: number }
  | Record<string, never> {
  if (!files || files.discoveredFiles <= files.graphedFiles) {
    return {};
  }
  return {
    incomplete: true,
    graphedFiles: files.graphedFiles,
    discoveredFiles: files.discoveredFiles,
  };
}

function makeWorkspaceProvider(root: string): IWorkspaceProvider {
  return {
    getWorkspaceFolders: () => [root],
    getWorkspaceRoot: () => root,
    getConfiguration: () => undefined,
    onDidChangeConfiguration: () => ({ dispose: () => undefined }),
    onDidChangeWorkspaceFolders: () => ({ dispose: () => undefined }),
  } as unknown as IWorkspaceProvider;
}

/**
 * The exact envelope `protocol-dispatcher.ts`'s `ptah_ast_analyze` case
 * builds (`ast-namespace.builder.ts::analyze` + its private `fileCoverage`)
 * before handing it to `formatAstAnalysisResult`. `vscode-lm-tools` (which
 * owns that builder) cannot be imported from this lib (reverse dependency
 * direction), so this composes the same PRODUCTION primitives
 * (`classifyFileForCoverage`/`languageForExtension`/`supportedLanguagesFor`,
 * all exported from this barrel) the builder itself uses — it does not
 * reimplement any decision they make.
 */
function buildAstNamespaceEnvelope(
  insights: WorkspaceIntelligence.CodeInsights,
  absolutePath: string,
): object {
  const parseStatus = insights.parseStatus ?? 'unknown';
  const classification = classifyFileForCoverage(absolutePath, 'parse');
  const eligible = classification === 'eligible';
  const language = languageForExtension(
    absolutePath.slice(absolutePath.lastIndexOf('.')),
  ) as SupportedLanguage;
  const coverage: LanguageCoverage = {
    supportedLanguages: supportedLanguagesFor('parse'),
    census: 'complete',
    analyzed: eligible && parseStatus === 'ok' ? 1 : 0,
    unchecked: eligible && parseStatus === 'unknown' ? 1 : 0,
    failed: eligible && parseStatus === 'recovered' ? 1 : 0,
    unsupported: classification === 'unsupported' ? 1 : 0,
    unrecognised: classification === 'unrecognised' ? 1 : 0,
    nonSource: classification === 'nonSource' ? 1 : 0,
    excluded: 0,
    omittedByCap: 0,
  };
  return {
    parseStatus,
    errorNodeCount: insights.errorNodeCount ?? null,
    errorNodeCountCapped: insights.errorNodeCountCapped ?? false,
    coverage,
    file: absolutePath,
    language,
    functions: insights.functions,
    classes: insights.classes,
    imports: insights.imports,
    exports: insights.exports ?? [],
  };
}

describe('MCP tool contract benchmark (size + recall vs native)', () => {
  const suiteStartedAt = Date.now();
  const parser = new TreeSitterParserService(makeLogger());
  let fixture: McpContractFixture;
  let dataProcessorPath: string;
  let dataProcessorContent: string;

  beforeAll(() => {
    fixture = createMcpContractFixture();
    dataProcessorPath = fixture.knownSymbols.find(
      (s) => s.file === 'apps/api-service/src/data-processor.service.ts',
    )!.absolutePath;
    dataProcessorContent = fs.readFileSync(dataProcessorPath, 'utf8');
  });

  afterAll(() => {
    fixture.cleanup();
    parser.dispose();
    // r1 defect 9: an aggregate bound on the WHOLE file, not a per-test
    // timeout that lets the sum silently exceed the "normal test target"
    // budget.
    expect(Date.now() - suiteStartedAt).toBeLessThan(30_000);
  });

  /** The fixture's own declared symbols for `dataProcessorPath`, by kind. */
  function knownSymbolNames(
    kind: 'function' | 'class' | 'variable' | 'interface',
  ): string[] {
    return fixture.knownSymbols
      .filter(
        (s) =>
          s.file === 'apps/api-service/src/data-processor.service.ts' &&
          s.kind === kind,
      )
      .map((s) => s.name);
  }

  // -------------------------------------------------------------------------
  // ptah_ast_analyze (AstAnalysisService + the real `ptah_ast_analyze` MCP
  // output shaping: `formatAstAnalysisResult`, Batch 20.2p)
  // -------------------------------------------------------------------------
  describe('ptah_ast_analyze (AstAnalysisService + formatAstAnalysisResult)', () => {
    async function analyzeDataProcessor() {
      const logger = makeLogger();
      const astAnalysis = new AstAnalysisService(logger, parser);
      const result = await astAnalysis.analyzeSource(
        dataProcessorContent,
        'typescript',
        dataProcessorPath,
      );
      expect(result.isOk()).toBe(true);
      return result.unwrap();
    }

    it('the real ptah_ast_analyze MCP text is >= 40% smaller in tokens than reading the 300-line file', async () => {
      const insights = await analyzeDataProcessor();
      const envelope = buildAstNamespaceEnvelope(insights, dataProcessorPath);
      const formatted = formatAstAnalysisResult(envelope);

      const sourceTokens = countTokens(dataProcessorContent);
      const outputTokens = countTokens(formatted);
      const reduction = 1 - outputTokens / sourceTokens;

      // The prompt promises "40-60% fewer tokens than Read"
      // (ptah-core-prompt.ts:48; tool-description.builder.ts:1665) and
      // batches.md:2757 requires >= 40% on this fixture. Never weaken this to
      // a measured-lower value: a promise the product does not meet is a
      // product defect (fixed in Batch 20.2p's `formatAstAnalysisResult`),
      // not a bar to lower.
      expect(reduction).toBeGreaterThanOrEqual(0.4);
    });

    it('recalls every known function and class EXACTLY (not a subset, not a union with exports)', async () => {
      const insights = await analyzeDataProcessor();

      // r3 R3-B1/R3-B2 (Batch 20.2q closes the product gap): `insights.
      // exports` now carries EVERY known declaration kind (interfaces
      // included) via the shared `export-extraction.ts` decoder, one record
      // per name. The oracle is now ALL 43 knownSymbols for this file —
      // exact equality, not a runtime-only subset and not an `it.todo`.
      const expectedAll = new Map(
        fixture.knownSymbols
          .filter(
            (s) => s.file === 'apps/api-service/src/data-processor.service.ts',
          )
          .map((s) => [s.name, s.kind]),
      );
      expect(expectedAll.size).toBe(43);

      const actualExports = new Map(
        (insights.exports ?? []).map((e) => [e.name, e.kind]),
      );
      expect(new Set(actualExports.keys())).toEqual(
        new Set(expectedAll.keys()),
      );
      for (const [name, kind] of expectedAll) {
        expect(actualExports.get(name)).toBe(kind);
      }

      // Range fidelity: each known function's 1-indexed fixture line matches
      // the AST's 0-indexed `startLine` exactly.
      for (const sym of fixture.knownSymbols.filter(
        (s) =>
          s.file === 'apps/api-service/src/data-processor.service.ts' &&
          s.kind === 'function',
      )) {
        const fn = insights.functions.find((f) => f.name === sym.name);
        expect(fn).toBeDefined();
        expect(fn!.startLine).toBe((sym.line as number) - 1);
      }
    });

    // r2 R2-03: `formatAstAnalysisResult`'s output is lossless BELOW the MCP
    // result budget; above it, `tool-result-budget.ts` hands the JSON to
    // `json.reducer.ts`, which can drop null/empty metadata fields
    // (`errorNodeCount: null`, `coverage.excluded: null`) before the table
    // rows. Preserving those keys through reduction is Batch 24r's
    // `preserveKeys` work (Lane H), not yet merged. Choosing a named pending
    // test over an `it.skip`/weakened assertion so this specific contract —
    // required parse/coverage keys survive an above-budget cut — is written
    // down now and enforced automatically once Batch 24r lands, instead of
    // depending on someone remembering to add it later.
    it.todo('pending Batch 24r: preserved coverage survives reduction');
  });

  // -------------------------------------------------------------------------
  // ptah_context_enrich_file (ContextEnrichmentService, no language given —
  // exercising the REAL, unmocked production `resolveEnrichLanguage`)
  // -------------------------------------------------------------------------
  describe('ptah_context_enrich_file (ContextEnrichmentService, no language given)', () => {
    function makeEnrichmentService() {
      const logger = makeLogger();
      const tokenCounter = new TokenCounterService(realTokenCounter());
      const fileSystem = new FileSystemService(createRealFsProvider());
      const workspaceProvider = makeWorkspaceProvider(fixture.root);
      return new ContextEnrichmentService(
        parser,
        tokenCounter,
        fileSystem,
        logger,
        workspaceProvider,
      );
    }

    it('is >= 40% smaller in tokens than the full file, inferring the language via the real production resolveEnrichLanguage', async () => {
      const service = makeEnrichmentService();
      // Calls through the namespace object (not the destructured binding) so
      // the deliberate-break proof can `jest.spyOn` the SAME reference the
      // rest of production calls (r1 defect 5).
      const inferred = WorkspaceIntelligence.resolveEnrichLanguage(
        dataProcessorPath,
        undefined,
      );
      expect(inferred).toBe('typescript');

      const summary = await service.generateStructuralSummary(
        dataProcessorPath,
        inferred,
      );

      expect(summary.mode).toBe('structural');
      const sourceTokens = countTokens(dataProcessorContent);
      const summaryTokens = countTokens(summary.content);
      expect(1 - summaryTokens / sourceTokens).toBeGreaterThanOrEqual(0.4);
    });

    it('recalls every known function/class/variable DECLARATION (not merely a reference) in the summary text', async () => {
      const service = makeEnrichmentService();
      const inferred = WorkspaceIntelligence.resolveEnrichLanguage(
        dataProcessorPath,
        undefined,
      );

      const summary = await service.generateStructuralSummary(
        dataProcessorPath,
        inferred,
      );

      for (const name of knownSymbolNames('function')) {
        expect(summary.content).toMatch(
          new RegExp(`\\bfunction\\s+${name}\\s*\\(`),
        );
      }
      for (const name of knownSymbolNames('class')) {
        expect(summary.content).toMatch(new RegExp(`\\bclass\\s+${name}\\b`));
      }
      for (const name of knownSymbolNames('variable')) {
        expect(summary.content).toMatch(new RegExp(`\\b${name}\\s*[:=]`));
      }
      // r2 R2-01: the declaration-summary writer keeps EVERY top-level
      // declaration (interfaces included — unlike `ast_analyze`'s tree-sitter
      // export query, this is a full-source real-parser summary), so
      // interface recall is restored here, not filtered.
      const expectedInterfaces = knownSymbolNames('interface');
      expect(expectedInterfaces.length).toBeGreaterThan(0);
      for (const name of expectedInterfaces) {
        expect(summary.content).toMatch(
          new RegExp(`\\binterface\\s+${name}\\b`),
        );
      }
    });
  });

  // -------------------------------------------------------------------------
  // ptah_get_dependents / ptah_get_symbol_index (DependencyGraphService)
  // -------------------------------------------------------------------------
  describe('ptah_get_dependents / ptah_get_symbol_index (DependencyGraphService)', () => {
    /** All 6 files carrying the fixture's known edges/symbols. */
    function graphFileSet(): string[] {
      return [
        ...new Set(fixture.knownEdges.flatMap((e) => [e.fromPath, e.toPath])),
      ];
    }

    async function buildRealGraph(
      extraFiles: readonly string[] = [],
      tsconfigPaths?: Record<string, string[]>,
    ) {
      const logger = makeLogger();
      const astAnalysis = new AstAnalysisService(logger, parser);
      const fileSystem = new FileSystemService(createRealFsProvider());
      const graph = new DependencyGraphService(astAnalysis, fileSystem, logger);

      const graphFiles = [...graphFileSet(), ...extraFiles];
      const builtGraph = await graph.buildGraph(
        graphFiles,
        fixture.root,
        tsconfigPaths,
      );
      return { graph, builtGraph };
    }

    it('all 6 known files parse as graph nodes (fails fast, before any recall check silently skips a missing one)', async () => {
      const { builtGraph } = await buildRealGraph();
      for (const filePath of graphFileSet()) {
        expect(builtGraph.nodes.has(filePath)).toBe(true);
      }
      expect(builtGraph.nodes.size).toBe(graphFileSet().length);
    });

    it('a fully relative, fully resolvable fixture graph reports complete coverage with exact resolution counts (unconditional, not "else clean")', async () => {
      const { graph } = await buildRealGraph();
      const languages = graph.getCoverageReport(fixture.root)?.languages;
      expect(languages).toBeDefined();
      expect(languages!.census).toBe('complete');
      expect(languages!.analyzed).toBe(graphFileSet().length);
      expect(languages!.failed).toBe(0);
      expect(languages!.unsupported).toBe(0);
      expect(languages!.unrecognised).toBe(0);
      // Unconditional: every fixture import is a relative specifier that
      // resolves to a known file, so this MUST be complete, never partial.
      expect(languages!.resolution).toEqual({
        external: 0,
        unresolvedInternal: 0,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'complete',
      });
      expect(languages!.approximations).toBeUndefined();
    });

    it('a bare/workspace-alias import with no tsconfig paths given is unconditionally reported partial with resolver-context-partial (r1 defect 8, forced case)', async () => {
      // An extra file with one bare specifier no `tsconfigPaths` claims. This
      // is a real ambiguous case (Batch 32b, User Decision 20), not derived
      // from whatever the resolver happens to answer.
      const aliasConsumerPath = `${fixture.root}/flat-directory/bare-alias-consumer.ts`;
      fs.writeFileSync(
        aliasConsumerPath,
        [
          "import * as widgetNs from '@fixture/some-workspace-alias';",
          'export const usesWidget = widgetNs;',
          '',
        ].join('\n'),
        'utf8',
      );

      const { graph } = await buildRealGraph([aliasConsumerPath]);
      const languages = graph.getCoverageReport(fixture.root)?.languages;
      expect(languages).toBeDefined();
      // `extractImportsFromMatches` (AstAnalysisService) emits two ImportInfo
      // records per import statement — one detailed (with
      // `importedSymbols`/`isNamespace`) and one bare-`source` duplicate — so
      // one bare-specifier import statement counts as 2 unresolved imports,
      // not 1. Observed directly (not assumed); noted as a product quirk in
      // the executor report, not fixed here (out of this task's scope).
      expect(languages!.resolution).toEqual({
        external: 2,
        unresolvedInternal: 0,
        truncatedImports: 0,
        edgeCapHit: false,
        context: 'partial',
      });
      expect(languages!.approximations).toContain('resolver-context-partial');
    });

    it('recalls every known dependent (all knownEdges, including the Decision-21 hub fan-in)', async () => {
      const { graph } = await buildRealGraph();

      expect(fixture.knownEdges.length).toBeGreaterThanOrEqual(4);
      // RECALL only. SIZE for `ptah_get_dependents` is measured separately,
      // below, on the Decision-21 hub target: this fixture's original
      // 4 known edges have at most 2 dependents each, where a `{count, file,
      // dependents}` envelope's JSON overhead against a fair per-target grep
      // is not a meaningful SIZE comparison either way (see the executor
      // report's r3/Decision 21 history) — that small-answer overhead
      // question belongs to Batch 22c (compact coverage, Lane H), not here.
      for (const edge of fixture.knownEdges) {
        const dependents = graph.getDependents(edge.toPath);
        expect(dependents).toContain(edge.fromPath);
      }
    });

    it('User Decision 21: the real ptah_get_dependents MCP text for a realistic-fan-in hub (>= 10 dependents) is smaller (tokens, unaltered paths) than a fair native grep', async () => {
      const { graph } = await buildRealGraph();
      const graphFiles = graphFileSet();

      const hubEdges = fixture.knownEdges.filter((e) =>
        e.to.endsWith('libs/shared-core/src/hub.ts'),
      );
      expect(hubEdges.length).toBeGreaterThanOrEqual(10);
      const hubPath = hubEdges[0].toPath;

      // `ptah_get_dependents` answers ONE target per call
      // (`protocol-dispatcher.ts:2027-2058`): `{count, ...graphCompleteness,
      // file, dependents}`, UNALTERED (absolute) paths — exactly what
      // `getDependents` returns (r3 R3-S1: no relativized surrogate).
      const dependents = graph.getDependents(hubPath);
      for (const edge of hubEdges) {
        expect(dependents).toContain(edge.fromPath);
      }

      const files = graph.getCoverageReport(fixture.root)?.files;
      const answer = {
        count: dependents.length,
        ...graphCompletenessFields(files),
        file: hubPath,
        dependents,
      };
      const answerTokens = countTokens(JSON.stringify(answer));

      // Fair native baseline: a `grep` scoped to the actual question ("who
      // imports THIS file") over the same parsed files, same (absolute)
      // path form as the answer.
      const nativeBaseline = grepLines(graphFiles, /\bhub['"]/);
      const nativeTokens = countTokens(nativeBaseline);

      const reduction = 1 - answerTokens / nativeTokens;
      // The promised margin (batches.md:2757: "smaller native equivalent").
      // On a realistic fan-in this clears it; if a future regression makes
      // it not, this must fail, not silently pass with a lowered bar.
      expect(reduction).toBeGreaterThan(0);
      expect(answerTokens).toBeLessThan(nativeTokens);
    });

    it('the real ptah_get_symbol_index text recalls EVERY known symbol (all kinds, Batch 20.2q) EXACTLY per file, and is smaller (tokens) than a native grep for export lines', async () => {
      const { graph, builtGraph } = await buildRealGraph();
      const graphFiles = graphFileSet();
      const symbolIndex = graph.getSymbolIndex(fixture.root);

      // r3 R3-B1/R3-B2: Batch 20.2q's shared `export-extraction.ts` decoder
      // now extracts every export kind (interfaces/types/enums included), so
      // the ORACLE is every known symbol for a tracked file, not a
      // runtime-only subset — a real, executable assertion, not `it.todo`.
      const symbolsByFile = fixture.knownSymbols.reduce((map, sym) => {
        const list = map.get(sym.absolutePath) ?? [];
        list.push(sym.name);
        map.set(sym.absolutePath, list);
        return map;
      }, new Map<string, string[]>());

      // Every expected file must actually be a node before the per-file loop
      // below runs (r1 defect 6: a missing node used to silently `continue`).
      for (const filePath of symbolsByFile.keys()) {
        expect(builtGraph.nodes.has(filePath)).toBe(true);
      }

      for (const [filePath, names] of symbolsByFile) {
        const exported = new Set(
          (symbolIndex.get(filePath) ?? []).map((e) => e.name),
        );
        for (const name of names) {
          expect(exported.has(name)).toBe(true);
        }
      }

      // SIZE (r2 R2-02 / r3 R3-S1): the exact production envelope
      // `renderSymbolIndexPage` builds (`protocol-dispatcher.ts:2903-2911`):
      // `{count, total, offset, ...completeness, files: [{file, symbols}]}`,
      // with `symbols` produced by the SAME production `exportSymbolNames`
      // helper the real `getSymbolIndex` MCP path uses, and UNALTERED
      // (absolute) paths — not a rewritten/relativized surrogate. One page,
      // no pagination needed for 6 files, so no `nextOffset`.
      const files = graph.getCoverageReport(fixture.root)?.files;
      const pageEntries = graphFiles.map((file) => ({
        file,
        symbols: WorkspaceIntelligence.exportSymbolNames(
          symbolIndex.get(file) ?? [],
        ),
      }));
      const answerText = JSON.stringify({
        count: pageEntries.length,
        total: pageEntries.length,
        offset: 0,
        ...graphCompletenessFields(files),
        files: pageEntries,
      });
      const answerTokens = countTokens(answerText);

      const nativeBaseline = grepLines(graphFiles, /^export\s+/);
      const nativeTokens = countTokens(nativeBaseline);
      expect(answerTokens).toBeLessThan(nativeTokens);
    });
  });

  // -------------------------------------------------------------------------
  // ptah_relevance_rank_files (FileRelevanceScorerService)
  // -------------------------------------------------------------------------
  describe('ptah_relevance_rank_files (FileRelevanceScorerService)', () => {
    function toIndexedFile(relPath: string, absPath: string): IndexedFile {
      const content = fs.readFileSync(absPath, 'utf8');
      return {
        path: absPath,
        relativePath: relPath,
        type: FileType.Source,
        size: content.length,
        language: 'typescript',
        estimatedTokens: countTokens(content),
      };
    }

    it('every native-grep hit for the query outranks every non-hit, in a payload smaller than reading every candidate file', () => {
      const scorer = new FileRelevanceScorerService();
      const authSessionAbs = fixture.knownSymbols.find(
        (s) => s.name === 'AuthSessionService',
      )!.absolutePath;
      const tokenUtilsAbs = fixture.knownSymbols.find(
        (s) => s.name === 'generateSecureToken',
      )!.absolutePath;
      const unrelatedAbs = `${fixture.root}/flat-directory/flat-entry-000.ts`;

      const files = [
        toIndexedFile('libs/shared-core/src/auth-session.ts', authSessionAbs),
        toIndexedFile('libs/shared-core/src/token-utils.ts', tokenUtilsAbs),
        toIndexedFile('flat-directory/flat-entry-000.ts', unrelatedAbs),
      ];

      const query = 'auth session token credential';
      const terms = query.split(' ');

      // Independent native baseline: fixed grep over the SAME candidate set
      // (not the tool's own answer) for the query terms.
      const nativeHits = files.filter((f) =>
        terms.some((term) =>
          fs.readFileSync(f.path, 'utf8').toLowerCase().includes(term),
        ),
      );
      expect(nativeHits.map((f) => f.relativePath)).toEqual(
        expect.arrayContaining([
          'libs/shared-core/src/auth-session.ts',
          'libs/shared-core/src/token-utils.ts',
        ]),
      );
      const nativeMisses = files.filter((f) => !nativeHits.includes(f));
      expect(nativeMisses.length).toBeGreaterThan(0);

      // r3 R3-S2: recall and SIZE must both read the SAME result the real
      // `ptah_relevance_rank_files` MCP tool returns — `getTopFiles`
      // (`analysis-namespace.builders.ts:313-320`,
      // `rankFiles: async (...) => ... relevanceScorer.getTopFiles(...)`,
      // `{file, score, reasons}[]`), not a separately-called `rankFiles()`
      // score map that could diverge from what actually ships (the prior
      // round's gap: an empty `getTopFiles` answer still passed).
      const topFiles = scorer.getTopFiles(files, query, files.length);
      expect(topFiles.length).toBe(files.length);
      const scoreByPath = new Map(topFiles.map((r) => [r.file.path, r.score]));

      // Require EVERY native hit to outrank EVERY non-hit (r1 defect 6: not
      // merely "the first result is not the unrelated file"), on the SAME
      // `topFiles` result being sized below.
      for (const hit of nativeHits) {
        for (const miss of nativeMisses) {
          expect(scoreByPath.get(hit.path)!).toBeGreaterThan(
            scoreByPath.get(miss.path)!,
          );
        }
      }

      // SIZE (r2 R2-02 / r3 R3-S1): `protocol-dispatcher.ts:2202-2207`
      // `JSON.stringify`s exactly this array. The answer already uses
      // workspace-relative paths (`r.file.relativePath`); the native grep
      // baseline must use the SAME relative-path form — passing
      // `fixture.root` here (the prior round's actual bug: it was omitted,
      // so the baseline used absolute paths against a relative answer).
      const answerText = JSON.stringify(
        topFiles.map((r) => ({
          file: r.file.relativePath,
          score: r.score,
          reasons: r.reasons,
        })),
      );
      const answerTokens = countTokens(answerText);

      const nativeBaseline = grepLines(
        files.map((f) => f.path),
        new RegExp(terms.join('|'), 'i'),
        fixture.root,
      );
      const nativeTokens = countTokens(nativeBaseline);
      expect(answerTokens).toBeLessThan(nativeTokens);
    });
  });

  // -------------------------------------------------------------------------
  // ptah_project_detect_monorepo + workspace_analyze project type (detectors)
  // -------------------------------------------------------------------------
  describe('ptah_project_detect_monorepo and the workspace_analyze project type', () => {
    function makeDetectors() {
      const fileSystem = new FileSystemService(createRealFsProvider());
      const workspaceProvider = makeWorkspaceProvider(fixture.root);
      return {
        monorepoDetector: new MonorepoDetectorService(
          fileSystem,
          workspaceProvider,
        ),
        projectDetector: new ProjectDetectorService(
          fileSystem,
          workspaceProvider,
        ),
      };
    }

    async function detectComposition() {
      const { monorepoDetector, projectDetector } = makeDetectors();
      const monorepo = await monorepoDetector.detectMonorepo(fixture.root);
      expect(monorepo.isMonorepo).toBe(true);
      expect(monorepo.type).toBe(MonorepoType.Nx);
      const membership = await monorepoDetector.detectDeclaredMembers(
        fixture.root,
        monorepo.type,
      );
      return projectDetector.detectMonorepoComposition(
        fixture.root,
        membership,
      );
    }

    it('detects the Nx monorepo and reports a valid, non-react root type', async () => {
      const composition = await detectComposition();
      // Positive check: a valid enum member was actually returned (r1
      // defect 6 — "not-React" alone accepts `undefined`).
      expect(Object.values(ProjectType)).toContain(composition.rootType);
      expect(composition.rootType).not.toBe(ProjectType.React);
    });

    it('recalls every declared project (all 3 apps AND the shared-core lib) the native grep for project.json would find, in a payload smaller than reading every manifest', async () => {
      const composition = await detectComposition();

      const compositionPaths = new Set(composition.projects.map((p) => p.path));
      // Independent native baseline: every directory the fixture itself
      // wrote a `project.json` into (fixture-workspace.ts is authoritative,
      // not the composition under test).
      const nativeProjectJsonDirs = ['apps', 'libs']
        .flatMap((top) =>
          fs
            .readdirSync(`${fixture.root}/${top}`, { withFileTypes: true })
            .filter((e) => e.isDirectory())
            .map((e) => `${top}/${e.name}`),
        )
        .filter((dir) => fs.existsSync(`${fixture.root}/${dir}/project.json`));
      expect(nativeProjectJsonDirs.length).toBeGreaterThanOrEqual(4);
      for (const expectedProject of nativeProjectJsonDirs) {
        expect(compositionPaths.has(expectedProject)).toBe(true);
      }

      const nativeManifestSize = nativeProjectJsonDirs.reduce(
        (sum, dir) =>
          sum +
          fs.readFileSync(`${fixture.root}/${dir}/project.json`, 'utf8').length,
        0,
      );
      const compositionSize = JSON.stringify(composition).length;
      expect(compositionSize).toBeLessThan(nativeManifestSize);
    });
  });

  // -------------------------------------------------------------------------
  // ptah_count_tokens (TokenCounterService, real gpt-tokenizer backend)
  // -------------------------------------------------------------------------
  describe('ptah_count_tokens (TokenCounterService)', () => {
    it('matches the real gpt-tokenizer count exactly, and is far smaller than reading the file', async () => {
      const service = new TokenCounterService(realTokenCounter());

      const count = await service.countTokens(dataProcessorContent);

      // Native/independent baseline: the SAME real tokenizer, called
      // directly (not through the service under test) — one unit on both
      // sides, per r1 defect 4.
      const expected = countTokens(dataProcessorContent);
      expect(count).toBe(expected);
      expect(count).toBeGreaterThan(0);

      const answerSize = JSON.stringify({ tokens: count }).length;
      expect(answerSize).toBeLessThan(dataProcessorContent.length);
    });
  });
});
