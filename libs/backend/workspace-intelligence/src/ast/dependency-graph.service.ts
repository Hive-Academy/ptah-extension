import { injectable, inject } from 'tsyringe';
import * as fs from 'fs';
import * as path from 'path';
import {
  TOKENS,
  Logger,
  type BackgroundWorkAdmission,
} from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import type {
  FailureReason,
  LanguageCoverage,
} from '@ptah-extension/platform-core';
import { SupportedLanguage } from './ast.types';
import { EXTENSION_LANGUAGE_MAP } from './tree-sitter.config';
import {
  ImportInfo,
  ExportInfo,
  CodeInsights,
} from './ast-analysis.interfaces';
import { AstAnalysisService } from './ast-analysis.service';
import { parserFailureReason } from './parser-refusal';
import { FileSystemService } from '../services/file-system.service';
import {
  GRAPH_EDGE_CAP,
  buildGraphCoverage,
  identityUnavailableCoverage,
  invalidatedCoverage,
  mergeGraphCoverages,
  selectGraphFiles,
  type GraphResolutionCounts,
} from './graph-coverage';
import { LANGUAGE_MODULES } from './languages';
import {
  MAX_TARGETS_PER_IMPORT,
  type GraphEdgeApproximation,
  type ImportResolution,
} from './import-resolution/import-resolver';
import {
  buildResolverContext,
  type ResolverContext,
} from './import-resolution/resolver-context';

/** A node in the dependency graph representing a single file */
export interface FileNode {
  /** Absolute file path */
  path: string;
  /** Workspace-relative path */
  relativePath: string;
  /** Parsed import information */
  imports: ImportInfo[];
  /** Parsed export information */
  exports: ExportInfo[];
  /**
   * Export forms the extractor found but could not read (`line N: <source>`,
   * e.g. `exports[key] = v`): `exports` may be incomplete, so the file counts
   * as `failed` (`unsupported-syntax`) in the coverage, never `analyzed`.
   * Absent when every export was read.
   */
  unextractedExports?: string[];
  /**
   * Modules the file's re-export statements load (`CodeInsights.
   * reExportSources`); absent when it has none. Each is linked like an
   * import, and marks the edge as a re-export (see `getDependents`).
   */
  reExportSources?: string[];
  /** Language of the file */
  language: SupportedLanguage;
}

/** The complete dependency graph for a workspace */
export interface DependencyGraph {
  /** All file nodes indexed by absolute path */
  nodes: Map<string, FileNode>;
  /** Forward edges: file -> set of files it imports (resolved paths) */
  edges: Map<string, Set<string>>;
  /** Reverse edges: file -> set of files that import it */
  reverseEdges: Map<string, Set<string>>;
  /** Build timestamp */
  builtAt: number;
  /** Number of unresolved imports (external packages, missing files) */
  unresolvedCount: number;
}

/** Map of file path to its exported symbols, used by relevance scorer */
export type SymbolIndex = Map<string, ExportInfo[]>;

/**
 * How much of the discovered workspace a graph was built from. A caller that
 * caps the file list before {@link DependencyGraphService.buildGraph} passes
 * the uncapped count, so the graph can say it is incomplete.
 */
export interface GraphCoverage {
  /**
   * Files the graph was built from: the list given to `buildGraph`, less the
   * graph-capable files its own parse cap dropped.
   */
  graphedFiles: number;
  /** Files the caller discovered before any cap; never below `graphedFiles`. */
  discoveredFiles: number;
}

/**
 * Everything published about one graph, set in the same step as the graph
 * itself (one generation), so the two never describe different builds.
 */
export interface GraphCoverageReport {
  /** The Batch 9 file counts ({@link DependencyGraphService.getCoverage}). */
  readonly files: GraphCoverage;
  /** What the build analysed, could not analyse, and how imports resolved. */
  readonly languages: LanguageCoverage;
}

/** How one {@link DependencyGraphService.buildGraph} call runs. */
export interface BuildGraphOptions {
  /**
   * Set by a build nobody awaits (the dependency tools start one in the
   * background). Such a build waits on the background-work governor before
   * each chunk, so it yields while the foreground is busy or the main loop
   * lags. An awaited build (the caller asked for it and waits on it) leaves
   * this unset: a governed wait inside a generating turn would make that turn
   * wait for itself (TASK_2026_437).
   */
  yieldToForeground?: boolean;
  /**
   * A generation {@link DependencyGraphService.reserveBuild} handed out for
   * this root before the caller discovered the files. The build runs under it
   * instead of taking a new one when it starts, so an eviction of the root, or
   * any build started after the reservation (even while the caller was still
   * discovering), supersedes it. Unset: the build takes a new generation.
   */
  generation?: number;
  /**
   * Set when the caller's file discovery stopped at this many files, so the
   * files past it were never seen: the coverage census is `truncated`. Unset:
   * the caller discovered every file (`complete`).
   */
  censusLimit?: number;
  /**
   * Set when the caller's discovery could not read part of the tree (a
   * directory it failed to open): which files exist there is unknown, so
   * the census is `unknown` and the coverage never clean.
   */
  censusUnknown?: boolean;
}

/** What {@link DependencyGraphService.getBuildState} reports for one root. */
export interface GraphBuildState {
  /**
   * The root's current generation: the latest reserved or started for it.
   * `undefined` when none was, or the root was evicted since.
   */
  generation: number | undefined;
  /** Whether a build of that generation is running in `buildGraph` now. */
  building: boolean;
}

/** `whenClear` lane name; it only labels the governor's ceiling log line. */
const GOVERNOR_LANE = 'dependency-graph';

/**
 * Longest a background build waits on the governor before one chunk. The
 * governor's own ceiling is 10 minutes per wait; a build of 250 chunks would
 * then never finish inside a long session. One second per chunk throttles the
 * build while the foreground is busy (the loop gets that second back) and
 * still lets it finish, which the agent that asked for it is waiting on.
 */
const GOVERNOR_MAX_DEFER_MS = 1_000;

/** Files a background build parses between two governor admissions. */
const CHUNK_SIZE = 20;

/**
 * Longest a background build links edges before it yields a macrotask, so
 * the host's timers (a tool call's bounded wait among them) and I/O run.
 */
const EDGE_SLICE_MS = 10;

/** Resolve on a later macrotask: timers and I/O callbacks run first. */
function nextMacrotask(): Promise<void> {
  return new Promise<void>((resolve) => setImmediate(resolve));
}

/**
 * Whether this host's paths compare case-insensitively. Win32 volumes are
 * case-insensitive by default. macOS volumes usually are too, but APFS can be
 * formatted case-sensitive and detecting that needs a probe on each volume,
 * so darwin keeps exact case: a case-variant spelling there is not matched,
 * while a symlinked spelling still is (through the real path).
 */
const CASE_INSENSITIVE_PATHS = process.platform === 'win32';

/**
 * The one path identity the graph service compares roots, containment and
 * node lookups with: forward slashes, a win32 extended-length prefix
 * (`//?/`) dropped, no trailing slash, case folded where the host's paths
 * are case-insensitive. Lexical only; links are followed separately.
 */
export function graphPathIdentity(
  filePath: string,
  caseInsensitive: boolean = CASE_INSENSITIVE_PATHS,
): string {
  const lexical = filePath
    .replace(/\\/g, '/')
    .replace(/^\/\/[?.]\/(?=[A-Za-z]:)/, '')
    .replace(/\/+$/, '');
  return caseInsensitive ? lexical.toLowerCase() : lexical;
}

/** Whether identity `fileIdentity` is `rootIdentity` or lies under it. */
function isUnderIdentity(fileIdentity: string, rootIdentity: string): boolean {
  return (
    fileIdentity === rootIdentity ||
    fileIdentity.startsWith(
      rootIdentity.endsWith('/') ? rootIdentity : rootIdentity + '/',
    )
  );
}

/** UNC paths are never resolved: touching a network share is a side effect. */
function isUncPath(filePath: string): boolean {
  return /^[\\/]{2}(?![?.][\\/])/.test(filePath);
}

/** What resolving a root's real path established about its identity. */
interface RootIdentity {
  /** The real path's identity; `undefined` when it has none or is unknown. */
  readonly real: string | undefined;
  /**
   * The lookup failed for a reason other than the root being absent (EIO,
   * EACCES, a link loop, ...): whether the root is a link alias is unknown,
   * so an invalidation named through its real path may go unmatched (r4 M1).
   */
  readonly unavailable: boolean;
}

/** Errors that prove there is nothing on disk to follow: no alias exists. */
const ABSENT_PATH_CODES: ReadonlySet<string> = new Set(['ENOENT', 'ENOTDIR']);

/**
 * The identity of `root`'s real path (links and junctions followed). A UNC
 * share is never resolved, and a root that does not exist has no alias:
 * both keep the lexical key as their only identity. Any other failed lookup
 * is `unavailable`, which the published coverage discloses.
 */
async function realRootIdentity(root: string): Promise<RootIdentity> {
  if (isUncPath(root)) return { real: undefined, unavailable: false };
  try {
    return {
      real: graphPathIdentity(await fs.promises.realpath(root)),
      unavailable: false,
    };
  } catch (error: unknown) {
    // degradation-audit: reported — a root that cannot be resolved keeps its
    // lexical identity; unless it is absent (no alias can exist), the graph
    // built under it publishes `unchecked: null` (never clean), because an
    // edit named through its real path may not be matched. Only the code is read.
    const code =
      typeof error === 'object' && error !== null && 'code' in error
        ? String((error as { code: unknown }).code)
        : '';
    return { real: undefined, unavailable: !ABSENT_PATH_CODES.has(code) };
  }
}

/**
 * The identities a file named for invalidation has: its lexical identity,
 * plus its real path's identity (for a file that is gone, its directory's
 * real path joined with its name). One synchronous lookup per invalidation,
 * never per root; a failed lookup leaves the lexical identity alone.
 */
function fileIdentities(normalizedPath: string): string[] {
  const lexical = graphPathIdentity(normalizedPath);
  if (isUncPath(normalizedPath)) return [lexical];
  let real: string | undefined;
  try {
    real = fs.realpathSync.native(normalizedPath);
  } catch (error: unknown) {
    // degradation-audit: optional-capability — the file may be deleted;
    // its directory's real path is the next best identity (below).
    void error;
    try {
      real = path.join(
        fs.realpathSync.native(path.dirname(normalizedPath)),
        path.basename(normalizedPath),
      );
    } catch (dirError: unknown) {
      // degradation-audit: optional-capability — nothing on disk to follow;
      // the lexical identity is still matched against every root.
      void dirError;
    }
  }
  const realIdentity = real === undefined ? undefined : graphPathIdentity(real);
  return realIdentity === undefined || realIdentity === lexical
    ? [lexical]
    : [lexical, realIdentity];
}

/** Maximum transitive depth allowed for getDependencies */
const MAX_DEPTH = 3;

/**
 * What one node depends on, in order: its imports, then each module its
 * re-export statements load (`reExportSources`, plus the source of every
 * re-export record, which also covers TypeScript's `export import X =
 * require(...)`), once each, as an import of that module.
 */
function dependenciesOf(
  node: FileNode,
): Array<{ imp: ImportInfo; reExport: boolean }> {
  const reExportSources = new Set(node.reExportSources ?? []);
  for (const info of node.exports) {
    if (info.isReExport === true && info.source !== undefined) {
      reExportSources.add(info.source);
    }
  }
  return [
    ...node.imports.map((imp) => ({ imp, reExport: false })),
    ...[...reExportSources].map((source) => ({
      imp: { source },
      reExport: true,
    })),
  ];
}

/** Add `value` to the set `map` holds under `key`, creating it. */
function addToSetMap(
  map: Map<string, Set<string>>,
  key: string,
  value: string,
): void {
  const set = map.get(key);
  if (set) set.add(value);
  else map.set(key, new Set([value]));
}

/**
 * Dependency Graph Service
 *
 * Builds and caches import-based dependency graphs for workspace files using
 * tree-sitter import/export queries via AstAnalysisService. Provides forward
 * dependency maps (what does this file import?), reverse dependency maps
 * (what imports this file?), and a symbol index (what does each file export?)
 * for use by relevance scoring.
 *
 * @module workspace-intelligence/ast
 */
@injectable()
export class DependencyGraphService {
  /**
   * Cached dependency graphs, keyed by normalized workspace root. One entry per
   * open workspace so multiple workspaces (e.g. Electron with several folders)
   * never share a graph. Evicted when a workspace closes — see {@link evict} /
   * {@link retainOnly}.
   */
  private readonly graphs = new Map<string, DependencyGraph>();

  /** Symbol index per workspace root, derived lazily from that graph's nodes. */
  private readonly symbolIndexes = new Map<string, SymbolIndex>();

  /**
   * Coverage of each cached graph, keyed and evicted with {@link graphs} and
   * set in the same {@link publish} step as the graph.
   */
  private readonly coverages = new Map<string, GraphCoverageReport>();

  /**
   * Per root, the generation of the latest build started or reserved for it
   * (see {@link reserveBuild}); the entry is dropped when the root is
   * evicted. A build publishes its graph only while its own generation is
   * still the root's, so a build overtaken by a later build, or by an
   * eviction of its root, can never replace the newer state with a stale
   * graph.
   */
  private readonly generations = new Map<string, number>();

  /** Last generation handed out; see {@link bumpGeneration}. */
  private lastGeneration = 0;

  /** Generations whose `buildGraph` is running; see {@link getBuildState}. */
  private readonly running = new Set<number>();

  /**
   * Per running generation: its root key and the files
   * {@link invalidateFile} named under that root while it ran. The build
   * applies them to the graph it publishes (it may have read the old content).
   */
  private readonly inFlightInvalidations = new Map<
    number,
    {
      readonly key: string;
      /** The root's real-path identity, once resolved. */
      realRoot: string | undefined;
      /**
       * Identities of every file invalidated while the build ran (see
       * `fileIdentities`); matched against the root when it publishes, once
       * its real path is known.
       */
      readonly paths: Set<readonly string[]>;
    }
  >();

  /**
   * Real-path identity of each published root whose real path differs from
   * its key (a junction or symlink alias); dropped with the graph.
   */
  private readonly realRoots = new Map<string, string>();

  /** Lazily built node-identity lookups; see {@link nodeKeysFor}. */
  private readonly nodeIdentityIndexes = new WeakMap<
    DependencyGraph,
    Map<string, string[]>
  >();

  /**
   * Per graph: for each file, the files that re-export it (their edge to it
   * came from a re-export statement). Kept beside the graph, not on the
   * exported `DependencyGraph` shape; mutated with it by invalidation.
   */
  private readonly reExporters = new WeakMap<
    DependencyGraph,
    Map<string, Set<string>>
  >();

  /** Latch: a defective governor is warned about once, not per chunk. */
  private governorFailureWarned = false;

  constructor(
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
    /**
     * Optional: a bare container has none, and then a background build runs
     * ungoverned, exactly as an awaited one does.
     */
    @inject(TOKENS.BACKGROUND_WORK_GOVERNOR, { isOptional: true })
    private readonly governor: BackgroundWorkAdmission | null = null,
  ) {}

  /**
   * Build the dependency graph for a set of workspace files.
   * Parses each file's imports/exports and resolves relative paths.
   *
   * @param filePaths - Absolute paths of files to include
   * @param workspaceRoot - Workspace root for relative path resolution
   * @param tsconfigPaths - Optional `paths` (relative to the root), tried
   *   before those the build's resolver context reads from the root
   *   `tsconfig*.json` itself (Batch 32b); no caller needs to pass them.
   * Only graph-capable files are parsed (see `selectGraphFiles`): at most
   * `GRAPH_PARSE_CAP` of them, shared round-robin across their languages.
   * Every other file is counted in the published coverage, never parsed.
   *
   * @param discoveredFiles - Files the caller discovered before capping
   *   `filePaths`; defaults to `filePaths.length` (nothing was dropped). Read
   *   back through {@link getCoverage} and {@link getCoverageReport} (the
   *   difference counts as `omittedByCap`).
   * @param options - See {@link BuildGraphOptions}.
   * @returns The built dependency graph. It is published (answers queries),
   *   with its coverage, only when no later build of the same root started,
   *   and the root was not evicted, while this one ran; otherwise neither is.
   */
  async buildGraph(
    filePaths: string[],
    workspaceRoot: string,
    tsconfigPaths?: Record<string, string[]>,
    discoveredFiles?: number,
    options: BuildGraphOptions = {},
  ): Promise<DependencyGraph> {
    const startTime = Date.now();
    const key = this.normalizeRoot(workspaceRoot);
    const generation = options.generation ?? this.bumpGeneration(key);
    const isCurrent = (): boolean => this.generations.get(key) === generation;
    this.logger.info(
      `DependencyGraphService.buildGraph() - Building graph for ${filePaths.length} files`,
    );
    this.running.add(generation);
    const invalidatedWhileBuilding = new Set<readonly string[]>();
    const inFlight = {
      key,
      realRoot: undefined as string | undefined,
      paths: invalidatedWhileBuilding,
    };
    this.inFlightInvalidations.set(generation, inFlight);
    try {
      // Resolved once per build, so invalidations named through a junction
      // or symlink alias of the root (or its target) are matched.
      const rootIdentity = await realRootIdentity(workspaceRoot);
      inFlight.realRoot =
        rootIdentity.real === key ? undefined : rootIdentity.real;
      const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
      const background = options.yieldToForeground === true;
      const selection = selectGraphFiles(filePaths);
      const failedByReason: Partial<Record<FailureReason, number>> = {};
      const recordFailure = (reason: FailureReason): void => {
        failedByReason[reason] = (failedByReason[reason] ?? 0) + 1;
      };
      const nodes = background
        ? await this.parseInBackground(
            selection.selected,
            normalizedRoot,
            isCurrent,
            recordFailure,
          )
        : await this.parseAwaited(
            selection.selected,
            normalizedRoot,
            recordFailure,
          );
      // Built once per build, after parsing (it indexes the parsed files);
      // a background build yields between manifest reads.
      const context = await buildResolverContext({
        root: normalizedRoot,
        knownFiles: nodes.keys(),
        ...(tsconfigPaths === undefined ? {} : { callerPaths: tsconfigPaths }),
        isCurrent,
        ...(background ? { yieldBetweenReads: nextMacrotask } : {}),
      });
      if (context === undefined) {
        this.logger.debug(
          'DependencyGraphService.buildGraph() - Superseded while reading manifests; graph not published',
        );
        return this.emptyGraph(nodes);
      }
      if (context.gaps.length > 0) {
        // Fixed gap names only: never a path.
        this.logger.debug(
          `DependencyGraphService.buildGraph() - Resolver context partial: ${context.gaps.join(', ')}`,
        );
      }
      const { graph, resolution, reExporters } = await this.linkNodes(
        nodes,
        context,
        background ? isCurrent : undefined,
      );
      this.reExporters.set(graph, reExporters);
      if (!isCurrent()) {
        // Fixed text: the root is a path.
        this.logger.debug(
          'DependencyGraphService.buildGraph() - Superseded by a later build or an eviction; graph not published',
        );
        return graph;
      }
      const listedFiles = filePaths.length;
      const discovered =
        Number.isSafeInteger(discoveredFiles) &&
        (discoveredFiles as number) > listedFiles
          ? (discoveredFiles as number)
          : listedFiles;
      // A node with unextracted exports keeps its edges and known symbols,
      // but parseFile counted it failed (`unsupported-syntax`), not analysed.
      let partialNodes = 0;
      for (const node of nodes.values()) {
        if (node.unextractedExports !== undefined) partialNodes++;
      }
      const languages = buildGraphCoverage({
        selection,
        analyzed: nodes.size - partialNodes,
        failedByReason,
        resolution,
        omittedUpstream: discovered - listedFiles,
        ...(options.censusLimit === undefined
          ? {}
          : { censusLimit: options.censusLimit }),
        ...(options.censusUnknown === true ? { censusUnknown: true } : {}),
      });
      this.publish(key, graph, {
        files: {
          graphedFiles: listedFiles - selection.omittedByCap,
          discoveredFiles: discovered,
        },
        languages: rootIdentity.unavailable
          ? identityUnavailableCoverage(languages)
          : languages,
      });
      if (inFlight.realRoot === undefined) this.realRoots.delete(key);
      else this.realRoots.set(key, inFlight.realRoot);
      // A file invalidated while this build ran may have been read before the
      // change: treat it as invalidated in the graph just published, in the
      // same synchronous step, so no reader sees it as current.
      for (const identities of invalidatedWhileBuilding) {
        this.invalidateMatching(key, graph, identities, inFlight.realRoot);
      }
      const elapsed = Date.now() - startTime;
      this.logger.info(
        `DependencyGraphService.buildGraph() - Graph built in ${elapsed}ms: ` +
          `${nodes.size} nodes, ${this.countEdges(
            graph.edges,
          )} edges, ${graph.unresolvedCount} unresolved`,
      );
      return graph;
    } finally {
      this.running.delete(generation);
      this.inFlightInvalidations.delete(generation);
    }
  }

  /**
   * Reserve a build generation for `workspaceRoot` before discovering its
   * files, and pass it to {@link buildGraph} as `options.generation`. Every
   * build started earlier for the root is superseded now; the reservation is
   * superseded in turn by a later build or reservation and by an eviction.
   */
  reserveBuild(workspaceRoot: string): number {
    return this.bumpGeneration(this.normalizeRoot(workspaceRoot));
  }

  /** The root's current generation, and whether a build of it is running. */
  getBuildState(workspaceRoot: string): GraphBuildState {
    const generation = this.generations.get(this.normalizeRoot(workspaceRoot));
    return {
      generation,
      building: generation !== undefined && this.running.has(generation),
    };
  }

  /**
   * Parse every file for an awaited build: chunks of {@link CHUNK_SIZE}
   * files in parallel, never yielding on purpose (the caller waits on it).
   */
  private async parseAwaited(
    filePaths: readonly string[],
    normalizedRoot: string,
    recordFailure: (reason: FailureReason) => void,
  ): Promise<Map<string, FileNode>> {
    const nodes = new Map<string, FileNode>();
    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map((filePath) =>
          this.parseFile(filePath, normalizedRoot, nodes, recordFailure),
        ),
      );
    }
    return nodes;
  }

  /**
   * Parse every file for a build nobody awaits, one file at a time: a
   * governor admission before each chunk of {@link CHUNK_SIZE} files, and a
   * macrotask yield before every file, so one file's synchronous parse is the
   * longest the host's timers and I/O wait. Stops early once `isCurrent`
   * says the build was superseded (nothing it parses could be published).
   */
  private async parseInBackground(
    filePaths: readonly string[],
    normalizedRoot: string,
    isCurrent: () => boolean,
    recordFailure: (reason: FailureReason) => void,
  ): Promise<Map<string, FileNode>> {
    const nodes = new Map<string, FileNode>();
    for (let i = 0; i < filePaths.length; i++) {
      if (i % CHUNK_SIZE === 0) await this.yieldToForeground();
      await nextMacrotask();
      if (!isCurrent()) break;
      await this.parseFile(filePaths[i], normalizedRoot, nodes, recordFailure);
    }
    return nodes;
  }

  /**
   * Read and parse one file into `nodes`. A file that fails is left out of
   * the graph and reported to `recordFailure` with its reason: `read` when
   * the read fails, `parse` when the analysis fails or reports an error.
   * A file whose exports were only partly extracted stays in the graph (its
   * edges and known exports are real) and is reported `unsupported-syntax`.
   */
  private async parseFile(
    filePath: string,
    normalizedRoot: string,
    nodes: Map<string, FileNode>,
    recordFailure: (reason: FailureReason) => void,
  ): Promise<void> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const ext = path.extname(normalizedPath).toLowerCase();
    const language = EXTENSION_LANGUAGE_MAP[ext];

    if (!language) {
      // Unreachable for a selected (graph-capable) file; counted, not dropped.
      recordFailure('grammar-unavailable');
      return;
    }

    let content: string;
    try {
      content = await this.fileSystem.readFile(filePath);
    } catch (error: unknown) {
      // degradation-audit: reported — the file stays out of the graph and is
      // counted as `failedByReason.read` in the coverage published with it.
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `DependencyGraphService.buildGraph() - Error reading ${normalizedPath}: ${errorMessage}`,
      );
      recordFailure('read');
      return;
    }

    let analysisResult: Result<CodeInsights, Error>;
    try {
      analysisResult = await this.astAnalysis.analyzeSource(
        content,
        language,
        normalizedPath,
      );
    } catch (error: unknown) {
      // degradation-audit: reported — the file stays out of the graph and is
      // counted as `failedByReason.parse` in the coverage published with it.
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `DependencyGraphService.buildGraph() - Error analyzing ${normalizedPath}: ${errorMessage}`,
      );
      recordFailure('parse');
      return;
    }

    if (!analysisResult.isOk()) {
      this.logger.debug(
        `DependencyGraphService.buildGraph() - Failed to analyze ${normalizedPath}: ${analysisResult.error?.message}`,
      );
      recordFailure(parserFailureReason(analysisResult.error));
      return;
    }

    const insights: CodeInsights = analysisResult.value!;
    const relativePath = path
      .relative(normalizedRoot, normalizedPath)
      .replace(/\\/g, '/');

    const unextracted = insights.unextractedExports ?? [];
    if (unextracted.length > 0) recordFailure('unsupported-syntax');
    nodes.set(normalizedPath, {
      path: normalizedPath,
      relativePath,
      imports: insights.imports,
      exports: insights.exports ?? [],
      ...(unextracted.length > 0 ? { unextractedExports: unextracted } : {}),
      ...(insights.reExportSources !== undefined &&
      insights.reExportSources.length > 0
        ? { reExportSources: insights.reExportSources }
        : {}),
      language,
    });
  }

  /**
   * Resolve every node's imports and re-export sources into forward and
   * reverse edges, through the resolver of the importing file's language
   * (`LanguageModule.importResolver`). A background build (`isCurrent`
   * given) yields a macrotask whenever it has linked for
   * {@link EDGE_SLICE_MS}, checked before every node, every dependency and
   * every target of a multi-target expansion, so one import-heavy file cannot
   * hold the host; once `isCurrent` says it was superseded it stops and
   * returns the partial graph, which `buildGraph` does not publish. An
   * awaited build never yields.
   *
   * Every dependency is tallied for coverage: linked, `external`, or
   * `unresolvedInternal`. An import is expanded to at most
   * {@link MAX_TARGETS_PER_IMPORT} targets (`truncatedImports` counts those
   * cut). Once the graph holds {@link GRAPH_EDGE_CAP} distinct edges, the
   * next new edge stops linking with `edgeCapHit`, so the graph is disclosed
   * as incomplete instead of growing without bound.
   */
  private async linkNodes(
    nodes: Map<string, FileNode>,
    context: ResolverContext,
    isCurrent: (() => boolean) | undefined,
  ): Promise<{
    graph: DependencyGraph;
    resolution: GraphResolutionCounts;
    reExporters: Map<string, Set<string>>;
  }> {
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();
    const reExporters = new Map<string, Set<string>>();
    let unresolvedCount = 0;
    let external = 0;
    let unresolvedInternal = 0;
    let truncatedImports = 0;
    let edgeCount = 0;
    let edgeCapHit = false;
    let caseFolded = false;
    let contextDependent = false;
    const edgeApproximations = new Set<GraphEdgeApproximation>();
    let sliceStart = Date.now();
    /** False once a background build was superseded: stop linking. */
    const continueLinking = async (): Promise<boolean> => {
      if (isCurrent === undefined) return true;
      if (Date.now() - sliceStart < EDGE_SLICE_MS) return true;
      await nextMacrotask();
      sliceStart = Date.now();
      return isCurrent();
    };
    const finish = (): {
      graph: DependencyGraph;
      resolution: GraphResolutionCounts;
      reExporters: Map<string, Set<string>>;
    } => ({
      graph: {
        nodes,
        edges,
        reverseEdges,
        builtAt: Date.now(),
        unresolvedCount,
      },
      resolution: {
        external,
        unresolvedInternal,
        truncatedImports,
        edgeCapHit,
        // Partial when the context could not read every manifest, or an
        // import was external only as far as the context knows.
        context:
          context.gaps.length > 0 || contextDependent ? 'partial' : 'complete',
        ...(caseFolded ? { caseFolded: true } : {}),
        ...(edgeApproximations.size > 0
          ? { edgeApproximations: [...edgeApproximations] }
          : {}),
      },
      reExporters,
    });
    for (const [filePath, node] of nodes) {
      if (!(await continueLinking())) return finish();
      const fileEdges = new Set<string>();
      edges.set(filePath, fileEdges);
      const resolver = LANGUAGE_MODULES[node.language].importResolver;

      for (const { imp, reExport } of dependenciesOf(node)) {
        if (!(await continueLinking())) return finish();
        const resolution: ImportResolution = resolver
          ? resolver.resolve(imp, filePath, context)
          : { kind: 'unresolved-internal', targets: [] };
        if (resolution.caseFolded === true) caseFolded = true;
        if (resolution.contextDependent === true) contextDependent = true;
        if (resolution.unresolvedMembers !== undefined) {
          unresolvedCount += resolution.unresolvedMembers;
          unresolvedInternal += resolution.unresolvedMembers;
        }
        let targets = resolution.targets;
        if (
          resolution.truncated === true ||
          targets.length > MAX_TARGETS_PER_IMPORT
        ) {
          truncatedImports++;
          targets = targets.slice(0, MAX_TARGETS_PER_IMPORT);
        }
        if (targets.length === 0) {
          unresolvedCount++;
          if (resolution.kind === 'external') external++;
          else unresolvedInternal++;
          this.logger.debug(
            `DependencyGraphService.buildGraph() - Unresolved import '${imp.source}' in ${node.relativePath}`,
          );
          continue;
        }
        // Declared once targets link; an unresolved import approximates nothing.
        if (resolution.approximation !== undefined) {
          edgeApproximations.add(resolution.approximation);
        }

        for (const target of targets) {
          // Inside a multi-target expansion too: yield, and stop once
          // superseded.
          if (targets.length > 1 && !(await continueLinking())) {
            return finish();
          }
          if (reExport) addToSetMap(reExporters, target, filePath);
          if (fileEdges.has(target)) continue;
          if (edgeCount >= GRAPH_EDGE_CAP) {
            edgeCapHit = true;
            this.logger.info(
              'DependencyGraphService.buildGraph() - Edge cap reached; linking stopped',
            );
            return finish();
          }
          edgeCount++;
          fileEdges.add(target);
          addToSetMap(reverseEdges, target, filePath);
        }
      }
    }

    return finish();
  }

  /** A graph of `nodes` with no edge (a build superseded before linking). */
  private emptyGraph(nodes: Map<string, FileNode>): DependencyGraph {
    return {
      nodes,
      edges: new Map(),
      reverseEdges: new Map(),
      builtAt: Date.now(),
      unresolvedCount: 0,
    };
  }

  /**
   * Make `graph` and its coverage the ones that answer queries for `key`, in
   * one synchronous step, so no reader sees one without the other.
   */
  private publish(
    key: string,
    graph: DependencyGraph,
    report: GraphCoverageReport,
  ): void {
    this.graphs.set(key, graph);
    this.symbolIndexes.delete(key); // Invalidate cached symbol index for this root
    this.coverages.set(key, report);
  }

  /**
   * Get direct dependencies of a file (what it imports).
   * Supports transitive traversal with cycle detection.
   *
   * @param filePath - Absolute file path
   * @param depth - Max traversal depth (default: 1, max: 3)
   * @returns Array of resolved dependency file paths
   */
  getDependencies(filePath: string, depth = 1): string[] {
    const found = this.findNode(filePath);
    if (!found) {
      return [];
    }
    const [graph, nodeKey] = found;

    const clampedDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);

    if (clampedDepth === 1) {
      const directEdges = graph.edges.get(nodeKey);
      return directEdges ? Array.from(directEdges) : [];
    }
    const result: string[] = [];
    const visited = new Set<string>();
    visited.add(nodeKey); // Mark origin as visited to prevent self-cycles

    this.collectDependencies(graph, nodeKey, clampedDepth, visited, result);

    return result;
  }

  /**
   * Get reverse dependencies: the files that import or re-export this file,
   * then, through every barrel that re-exports it (directly or through a
   * chain of re-exports), the files that import or re-export that barrel.
   * A barrel's consumer reaches the file's declarations through it, so it
   * depends on the file as much as a direct importer does; a plain import
   * passes nothing on.
   *
   * @param filePath - Absolute file path
   * @returns Array of dependent file paths: direct dependents first
   */
  getDependents(filePath: string): string[] {
    const found = this.findNode(filePath);
    if (!found) {
      return [];
    }
    const [graph, nodeKey] = found;
    const dependents = new Set(graph.reverseEdges.get(nodeKey) ?? []);
    const reExporters = this.reExporters.get(graph);
    const visited = new Set<string>([nodeKey]);
    const barrels = [...(reExporters?.get(nodeKey) ?? [])];
    while (barrels.length > 0) {
      const barrel = barrels.shift() as string;
      if (visited.has(barrel)) continue;
      visited.add(barrel);
      for (const consumer of graph.reverseEdges.get(barrel) ?? []) {
        if (consumer !== nodeKey) dependents.add(consumer);
      }
      barrels.push(...(reExporters?.get(barrel) ?? []));
    }
    return [...dependents];
  }

  /**
   * The graph's own spelling of `filePath` (its node key) in the graph that
   * answers {@link getDependencies} and {@link getDependents} for it, or
   * `undefined` when that graph holds no node for the file (or no graph
   * answers it). Found through the same path identity as invalidation: an
   * exact spelling first, else the unique node whose identity matches (case
   * folded where paths are case-insensitive), else the file's real path
   * re-rooted under the graph's root when the root is a link alias.
   */
  resolveNodePath(filePath: string): string | undefined {
    return this.findNode(filePath)?.[1];
  }

  /** The answering graph and the file's node key in it (see {@link resolveNodePath}). */
  private findNode(filePath: string): [DependencyGraph, string] | undefined {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const entry = this.findGraphEntryForFile(normalizedPath);
    if (!entry) {
      return undefined;
    }
    const [key, graph] = entry;
    if (graph.nodes.has(normalizedPath)) {
      return [graph, normalizedPath];
    }
    const unique = (candidates: readonly string[]): string | undefined =>
      candidates.length === 1 ? candidates[0] : undefined;
    const byIdentity = unique(
      this.nodeKeysFor(graph, graphPathIdentity(normalizedPath)),
    );
    if (byIdentity !== undefined) {
      return [graph, byIdentity];
    }
    // Spelt through a link alias of the root (or its target): follow the
    // file's real path, re-rooted at the key, as invalidation does. Only on
    // a miss, so an ordinary query costs no file-system lookup.
    const candidates = new Set<string>();
    for (const identity of this.identitiesUnderRoot(
      fileIdentities(normalizedPath),
      key,
      this.realRoots.get(key),
    )) {
      for (const nodeKey of this.nodeKeysFor(graph, identity)) {
        candidates.add(nodeKey);
      }
    }
    const byRealPath = unique([...candidates]);
    return byRealPath === undefined ? undefined : [graph, byRealPath];
  }

  /**
   * Get the symbol index (map of file path to exported symbols).
   * Used by FileRelevanceScorerService for symbol-aware scoring.
   * Lazily computed from graph nodes.
   *
   * @returns SymbolIndex map
   */
  getSymbolIndex(workspaceRoot?: string): SymbolIndex {
    if (workspaceRoot) {
      return this.symbolIndexForKey(this.normalizeRoot(workspaceRoot));
    }
    // No root specified: return the sole graph's index (the common single-
    // workspace case), or a merged union across all open workspaces.
    if (this.graphs.size === 1) {
      const [onlyKey] = this.graphs.keys();
      return this.symbolIndexForKey(onlyKey);
    }
    const merged: SymbolIndex = new Map();
    for (const key of this.graphs.keys()) {
      for (const [filePath, exports] of this.symbolIndexForKey(key)) {
        merged.set(filePath, exports);
      }
    }
    return merged;
  }

  /**
   * The export forms of `filePath` the extractor found but could not read,
   * from the node of the graph that answers the file (see
   * {@link resolveNodePath}); `undefined` when every export was read or no
   * graph holds the file.
   */
  getUnextractedExports(filePath: string): readonly string[] | undefined {
    const found = this.findNode(filePath);
    return found?.[0].nodes.get(found[1])?.unextractedExports;
  }

  /**
   * Build (and cache) the symbol index for a single graph, keyed by root. A
   * file with no export is left out, unless its extraction was partial: then
   * it stays, even with an empty list, so the index can say which file may
   * have exports it does not list ({@link getUnextractedExports}).
   */
  private symbolIndexForKey(key: string): SymbolIndex {
    const cached = this.symbolIndexes.get(key);
    if (cached) {
      return cached;
    }

    const index: SymbolIndex = new Map();
    const graph = this.graphs.get(key);
    if (graph) {
      for (const [filePath, node] of graph.nodes) {
        if (node.exports.length > 0 || node.unextractedExports !== undefined) {
          index.set(filePath, node.exports);
        }
      }
    }

    this.symbolIndexes.set(key, index);
    return index;
  }

  /**
   * Invalidate cached graph data for a specific file.
   * Removes the file's node and all edges to/from it, and qualifies the
   * graph's coverage in the same step (see `invalidatedCoverage`): the graph
   * no longer describes that file, so its answers stop reading as clean until
   * the next build publishes. Every published graph whose root contains the
   * file (parent and nested roots alike) or that holds its node is
   * invalidated in the same synchronous call; every build of such a root
   * that is running now applies the same invalidation to the graph it
   * publishes.
   *
   * @param filePath - Absolute file path to invalidate
   */
  invalidateFile(filePath: string): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    // One identity set for every comparison below: case folded where the
    // host is case-insensitive, and the file's real path (r3 B1).
    const identities = fileIdentities(normalizedPath);
    // Matched when each build publishes, once its root's real path is known.
    for (const inFlight of this.inFlightInvalidations.values()) {
      inFlight.paths.add(identities);
    }
    // Every published graph that can hold the file, not only the one that
    // routes queries for it: a parent root and a nested root both contain a
    // nested file, and the parent answers again once the nested root is
    // evicted (r2 B1). A graph built from an explicit list may also hold the
    // node outside its root.
    let invalidated = false;
    for (const [key, graph] of [...this.graphs.entries()]) {
      if (
        this.invalidateMatching(key, graph, identities, this.realRoots.get(key))
      ) {
        invalidated = true;
      }
    }
    if (invalidated) {
      return;
    }
    // No containing root: the graph that routes the file (the sole graph).
    const entry = this.findGraphEntryForFile(normalizedPath);
    if (entry) {
      this.invalidateInGraph(entry[0], entry[1], undefined);
    }
  }

  /**
   * Invalidate the file with these identities in one published graph when
   * its root (key or real path) contains the file or the graph holds its
   * node. Whether it did.
   */
  private invalidateMatching(
    key: string,
    graph: DependencyGraph,
    identities: readonly string[],
    realRoot: string | undefined,
  ): boolean {
    const underRoot = this.identitiesUnderRoot(identities, key, realRoot);
    const nodeKeys = new Set<string>();
    for (const identity of [...underRoot, ...identities]) {
      for (const nodeKey of this.nodeKeysFor(graph, identity)) {
        nodeKeys.add(nodeKey);
      }
    }
    if (underRoot.length === 0 && nodeKeys.size === 0) {
      return false;
    }
    if (nodeKeys.size === 0) {
      this.invalidateInGraph(key, graph, undefined);
    }
    for (const nodeKey of nodeKeys) {
      this.invalidateInGraph(key, graph, nodeKey);
    }
    return true;
  }

  /**
   * {@link invalidateFile} for one published graph (`key`, `graph`):
   * qualify its coverage and remove the node `nodeKey` (the stored spelling),
   * when the graph holds one.
   */
  private invalidateInGraph(
    key: string,
    graph: DependencyGraph,
    nodeKey: string | undefined,
  ): void {
    const report = this.coverages.get(key);
    if (report) {
      // A partial node was counted failed, not analysed: nothing moves.
      const wasAnalyzed =
        nodeKey !== undefined &&
        graph.nodes.get(nodeKey)?.unextractedExports === undefined;
      this.coverages.set(key, {
        files: report.files,
        languages: invalidatedCoverage(report.languages, wasAnalyzed),
      });
    }
    if (nodeKey === undefined) {
      return;
    }
    const normalizedPath = nodeKey;
    const reExporters = this.reExporters.get(graph);

    const forwardDeps = graph.edges.get(normalizedPath);
    if (forwardDeps) {
      for (const dep of forwardDeps) {
        const reverseDeps = graph.reverseEdges.get(dep);
        if (reverseDeps) {
          reverseDeps.delete(normalizedPath);
          if (reverseDeps.size === 0) {
            graph.reverseEdges.delete(dep);
          }
        }
        const barrels = reExporters?.get(dep);
        if (barrels) {
          barrels.delete(normalizedPath);
          if (barrels.size === 0) reExporters?.delete(dep);
        }
      }
      graph.edges.delete(normalizedPath);
    }
    reExporters?.delete(normalizedPath);
    const reverseDeps = graph.reverseEdges.get(normalizedPath);
    if (reverseDeps) {
      for (const dependent of reverseDeps) {
        const fwdDeps = graph.edges.get(dependent);
        if (fwdDeps) {
          fwdDeps.delete(normalizedPath);
        }
      }
      graph.reverseEdges.delete(normalizedPath);
    }
    graph.nodes.delete(normalizedPath);
    this.symbolIndexes.delete(key);

    this.logger.debug(
      `DependencyGraphService.invalidateFile() - Invalidated ${normalizedPath}`,
    );
  }

  /**
   * Check whether a graph has been built.
   * @param workspaceRoot - When provided, checks that specific workspace's
   *   graph; otherwise returns true if any workspace graph exists.
   */
  isBuilt(workspaceRoot?: string): boolean {
    if (workspaceRoot) {
      return this.graphs.has(this.normalizeRoot(workspaceRoot));
    }
    return this.graphs.size > 0;
  }

  /**
   * Coverage of a built graph, or `undefined` when none is built.
   * @param workspaceRoot - When provided, that workspace's graph; otherwise
   *   the sum over every cached graph (the scope of the merged
   *   {@link getSymbolIndex}).
   */
  getCoverage(workspaceRoot?: string): GraphCoverage | undefined {
    return this.getCoverageReport(workspaceRoot)?.files;
  }

  /**
   * Coverage of the graph that answers {@link getDependencies} and
   * {@link getDependents} for `filePath` (the same selection: the sole graph,
   * else the one whose root is the longest prefix of the path), or
   * `undefined` when no graph answers it.
   */
  getCoverageForFile(filePath: string): GraphCoverage | undefined {
    return this.getCoverageReportForFile(filePath)?.files;
  }

  /**
   * The file counts and the language coverage of a built graph, both
   * published with it by the same build, or `undefined` when none is built.
   * @param workspaceRoot - When provided, that workspace's graph; otherwise
   *   every cached graph combined (file counts summed, language coverage
   *   merged by `mergeGraphCoverages`).
   */
  getCoverageReport(workspaceRoot?: string): GraphCoverageReport | undefined {
    if (workspaceRoot) {
      return this.copyReport(
        this.coverages.get(this.normalizeRoot(workspaceRoot)),
      );
    }
    const reports = [...this.coverages.values()];
    const languages = mergeGraphCoverages(
      reports.map((report) => report.languages),
    );
    if (languages === undefined) {
      return undefined;
    }
    const files: GraphCoverage = { graphedFiles: 0, discoveredFiles: 0 };
    for (const report of reports) {
      files.graphedFiles += report.files.graphedFiles;
      files.discoveredFiles += report.files.discoveredFiles;
    }
    return { files, languages };
  }

  /**
   * {@link getCoverageReport} for the graph that answers `filePath` (the
   * selection {@link getCoverageForFile} uses).
   */
  getCoverageReportForFile(filePath: string): GraphCoverageReport | undefined {
    const entry = this.findGraphEntryForFile(filePath.replace(/\\/g, '/'));
    return this.copyReport(entry ? this.coverages.get(entry[0]) : undefined);
  }

  /** A caller may mutate the file counts it gets; the stored ones stay. */
  private copyReport(
    report: GraphCoverageReport | undefined,
  ): GraphCoverageReport | undefined {
    return report
      ? { files: { ...report.files }, languages: report.languages }
      : undefined;
  }

  /**
   * Evict a single workspace's cached graph and symbol index. Call when a
   * workspace folder is closed so its graph does not linger in memory.
   */
  evict(workspaceRoot: string): void {
    const key = this.normalizeRoot(workspaceRoot);
    // Also when no graph is published yet: a build in flight must not publish.
    this.generations.delete(key);
    this.realRoots.delete(key);
    if (this.graphs.delete(key)) {
      this.symbolIndexes.delete(key);
      this.coverages.delete(key);
      this.logger.debug(
        `DependencyGraphService.evict() - Evicted graph for ${key}`,
      );
    }
  }

  /**
   * Retain only the graphs whose workspace root is in `activeRoots`, evicting
   * all others. Driven by `onDidChangeWorkspaceFolders`: because that event
   * carries no removed path, retaining the current set is the race-free way to
   * drop graphs for closed workspaces.
   */
  retainOnly(activeRoots: string[]): void {
    const keep = new Set(activeRoots.map((root) => this.normalizeRoot(root)));
    // Builds still in flight for a dropped root have no graph yet; forgetting
    // their generation stops them publishing one.
    for (const key of [...this.generations.keys()]) {
      if (!keep.has(key)) this.generations.delete(key);
    }
    for (const key of [...this.graphs.keys()]) {
      if (!keep.has(key)) {
        this.graphs.delete(key);
        this.symbolIndexes.delete(key);
        this.coverages.delete(key);
        this.realRoots.delete(key);
        this.logger.debug(
          `DependencyGraphService.retainOnly() - Evicted graph for ${key}`,
        );
      }
    }
  }

  /** Evict every cached graph (e.g. on shutdown). */
  clear(): void {
    this.generations.clear();
    this.graphs.clear();
    this.symbolIndexes.clear();
    this.coverages.clear();
    this.realRoots.clear();
  }

  /** Give `key` a new generation, unique across every root and never reused. */
  private bumpGeneration(key: string): number {
    this.lastGeneration += 1;
    this.generations.set(key, this.lastGeneration);
    return this.lastGeneration;
  }

  /**
   * Wait until background work may parse its next chunk, at most
   * {@link GOVERNOR_MAX_DEFER_MS}. `isClear()` first, so an idle host pays no
   * promise per chunk. A governor `AbortError` (its `dispose()` at shutdown)
   * is rethrown so the build stops. `'timeout'` proceeds. Any other rejection
   * is a governor defect: warn once and parse the chunk (fail open), the rule
   * every adopter follows.
   */
  private async yieldToForeground(): Promise<void> {
    const governor = this.governor;
    if (governor === null || governor.isClear()) return;
    try {
      await governor.whenClear({
        lane: GOVERNOR_LANE,
        maxDeferMs: GOVERNOR_MAX_DEFER_MS,
      });
    } catch (error: unknown) {
      // degradation-audit: reported — an abort (host shutdown) stops the
      // build by rethrowing; any other governor failure is warned about once
      // and the chunk is parsed anyway (fail open). Fixed text only.
      if (error instanceof Error && error.name === 'AbortError') throw error;
      if (this.governorFailureWarned) return;
      this.governorFailureWarned = true;
      this.logger.warn(
        '[DependencyGraphService] background-work wait failed; building anyway',
      );
    }
  }

  /** The map key of a workspace root: its {@link graphPathIdentity}. */
  private normalizeRoot(root: string): string {
    return graphPathIdentity(root);
  }

  /**
   * Every node key whose {@link graphPathIdentity} is `identity`, so a path
   * spelt differently (case on win32, a junction alias) finds the stored
   * node keys. More than one means the identity is ambiguous: a query then
   * matches none of them, an invalidation removes all. Built on first use; a
   * published graph never gains nodes, and a removed node is re-checked
   * against `graph.nodes`.
   */
  private nodeKeysFor(graph: DependencyGraph, identity: string): string[] {
    let index = this.nodeIdentityIndexes.get(graph);
    if (index === undefined) {
      index = new Map();
      for (const nodeKey of graph.nodes.keys()) {
        const nodeIdentity = graphPathIdentity(nodeKey);
        const keys = index.get(nodeIdentity);
        if (keys) keys.push(nodeKey);
        else index.set(nodeIdentity, [nodeKey]);
      }
      this.nodeIdentityIndexes.set(graph, index);
    }
    return (index.get(identity) ?? []).filter((nodeKey) =>
      graph.nodes.has(nodeKey),
    );
  }

  /**
   * The spellings of `root`'s files a file with these identities has: for
   * every root identity (lexical key and canonical real path) that contains
   * one of the file identities, the file's identity re-rooted at the lexical
   * key (how the graph spells its nodes). Empty: the root does not contain it.
   */
  private identitiesUnderRoot(
    fileIdentities: readonly string[],
    key: string,
    realRoot: string | undefined,
  ): string[] {
    const rootIdentities = realRoot === undefined ? [key] : [key, realRoot];
    const result = new Set<string>();
    for (const rootIdentity of rootIdentities) {
      for (const fileIdentity of fileIdentities) {
        if (isUnderIdentity(fileIdentity, rootIdentity)) {
          result.add(key + fileIdentity.slice(rootIdentity.length));
        }
      }
    }
    return [...result];
  }

  /**
   * The root key and graph a file belongs to. With a single open workspace
   * the sole graph answers every query (identical to the pre-multi-workspace
   * behavior). With several open, the file is routed with the identities
   * invalidation uses (`fileIdentities`: lexical, and the real path) against
   * every graph's root identities (its key, and its real path when the root
   * is a link alias), so a path spelt through a junction or its target
   * reaches the same graph however many other roots are cached. Among the
   * graphs that contain it, the longest matching root identity wins; equal
   * lengths go to the smaller key, so the choice never depends on the order
   * the graphs were built in.
   */
  private findGraphEntryForFile(
    normalizedPath: string,
  ): [string, DependencyGraph] | undefined {
    if (this.graphs.size === 0) {
      return undefined;
    }
    if (this.graphs.size === 1) {
      const [entry] = this.graphs.entries();
      return entry;
    }
    const identities = fileIdentities(normalizedPath);
    let best: [string, DependencyGraph] | undefined;
    let bestLength = -1;
    for (const entry of this.graphs.entries()) {
      const key = entry[0];
      const realRoot = this.realRoots.get(key);
      for (const rootIdentity of realRoot === undefined
        ? [key]
        : [key, realRoot]) {
        if (!identities.some((id) => isUnderIdentity(id, rootIdentity))) {
          continue;
        }
        if (
          rootIdentity.length > bestLength ||
          (rootIdentity.length === bestLength && best && key < best[0])
        ) {
          best = entry;
          bestLength = rootIdentity.length;
        }
      }
    }
    return best;
  }

  /**
   * Every spelling, in graph node form, that an absolute path prefix has in
   * the cached graphs, compared through the identities invalidation uses
   * (the prefix's lexical and real-path identities, each root's key and real
   * path), in both directions:
   * - a prefix inside a root (or equal to it): the prefix re-rooted at the
   *   graph's key (see `identitiesUnderRoot`), trailing `/` kept;
   * - a prefix above a root (a string prefix of the root, as the symbol-index
   *   filter itself compares): that root's key followed by `/`, which selects
   *   exactly that graph's nodes, so a wider real-path prefix never loses an
   *   indexed alias subtree (review r2 B1).
   *
   * Only graphs whose own root is reached this way contribute, never an
   * unrelated parent spelling. The spellings are path identities, so they are
   * case-folded where paths are case-insensitive. Empty when no graph root is
   * related to the prefix.
   */
  graphSpellingsOf(filePath: string): string[] {
    const normalized = filePath.replace(/\\/g, '/');
    const trailing = normalized.endsWith('/') ? '/' : '';
    const stripped = normalized.replace(/\/+$/, '');
    if (stripped === '') return [];
    const identities = fileIdentities(stripped);
    const result = new Set<string>();
    for (const key of this.graphs.keys()) {
      const realRoot = this.realRoots.get(key);
      for (const spelling of this.identitiesUnderRoot(
        identities,
        key,
        realRoot,
      )) {
        result.add(spelling + trailing);
      }
      const rootIdentities = realRoot === undefined ? [key] : [key, realRoot];
      const aboveRoot = rootIdentities.some((rootIdentity) =>
        identities.some((identity) =>
          `${rootIdentity}/`.startsWith(identity + trailing),
        ),
      );
      if (aboveRoot) result.add(`${key}/`);
    }
    return [...result];
  }

  /**
   * Recursively collect transitive dependencies with cycle detection.
   */
  private collectDependencies(
    graph: DependencyGraph,
    filePath: string,
    remainingDepth: number,
    visited: Set<string>,
    result: string[],
  ): void {
    if (remainingDepth <= 0) {
      return;
    }

    const directDeps = graph.edges.get(filePath);
    if (!directDeps) {
      return;
    }

    for (const dep of directDeps) {
      if (visited.has(dep)) {
        continue; // Cycle detected -- skip this branch
      }

      visited.add(dep);
      result.push(dep);
      if (remainingDepth > 1) {
        this.collectDependencies(
          graph,
          dep,
          remainingDepth - 1,
          visited,
          result,
        );
      }
    }
  }

  /**
   * Count total number of edges in the graph.
   */
  private countEdges(edges: Map<string, Set<string>>): number {
    let count = 0;
    for (const edgeSet of edges.values()) {
      count += edgeSet.size;
    }
    return count;
  }
}
