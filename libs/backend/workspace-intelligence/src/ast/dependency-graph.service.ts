import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import {
  TOKENS,
  Logger,
  type BackgroundWorkAdmission,
} from '@ptah-extension/vscode-core';
import { Result } from '@ptah-extension/shared';
import { SupportedLanguage } from './ast.types';
import { EXTENSION_LANGUAGE_MAP } from './tree-sitter.config';
import {
  ImportInfo,
  ExportInfo,
  CodeInsights,
} from './ast-analysis.interfaces';
import { AstAnalysisService } from './ast-analysis.service';
import { FileSystemService } from '../services/file-system.service';

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
  /** Files the graph was built from (the list given to `buildGraph`). */
  graphedFiles: number;
  /** Files the caller discovered before any cap; never below `graphedFiles`. */
  discoveredFiles: number;
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

/** Extensions to try when resolving relative imports (in order) */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Index file names to try when resolving directory imports */
const INDEX_FILES = ['index.ts', 'index.js'];

/** Maximum transitive depth allowed for getDependencies */
const MAX_DEPTH = 3;

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

  /** Coverage of each cached graph, keyed and evicted with {@link graphs}. */
  private readonly coverages = new Map<string, GraphCoverage>();

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
   * @param tsconfigPaths - Optional tsconfig compilerOptions.paths for alias resolution
   * @param discoveredFiles - Files the caller discovered before capping
   *   `filePaths`; defaults to `filePaths.length` (nothing was dropped). Read
   *   back through {@link getCoverage}.
   * @param options - See {@link BuildGraphOptions}.
   * @returns The built dependency graph. It is published (answers queries)
   *   only when no later build of the same root started, and the root was not
   *   evicted, while this one ran; otherwise it is returned unpublished.
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
    try {
      const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
      const background = options.yieldToForeground === true;
      const nodes = background
        ? await this.parseInBackground(filePaths, normalizedRoot, isCurrent)
        : await this.parseAwaited(filePaths, normalizedRoot);
      const graph = await this.linkNodes(
        nodes,
        normalizedRoot,
        tsconfigPaths,
        background ? isCurrent : undefined,
      );
      if (!isCurrent()) {
        // Fixed text: the root is a path.
        this.logger.debug(
          'DependencyGraphService.buildGraph() - Superseded by a later build or an eviction; graph not published',
        );
        return graph;
      }
      this.publish(key, graph, filePaths.length, discoveredFiles);
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
    filePaths: string[],
    normalizedRoot: string,
  ): Promise<Map<string, FileNode>> {
    const nodes = new Map<string, FileNode>();
    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(
        chunk.map((filePath) =>
          this.parseFile(filePath, normalizedRoot, nodes),
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
    filePaths: string[],
    normalizedRoot: string,
    isCurrent: () => boolean,
  ): Promise<Map<string, FileNode>> {
    const nodes = new Map<string, FileNode>();
    for (let i = 0; i < filePaths.length; i++) {
      if (i % CHUNK_SIZE === 0) await this.yieldToForeground();
      await nextMacrotask();
      if (!isCurrent()) break;
      await this.parseFile(filePaths[i], normalizedRoot, nodes);
    }
    return nodes;
  }

  /** Read and parse one file into `nodes`; a file that fails is skipped. */
  private async parseFile(
    filePath: string,
    normalizedRoot: string,
    nodes: Map<string, FileNode>,
  ): Promise<void> {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const ext = path.extname(normalizedPath).toLowerCase();
    const language = EXTENSION_LANGUAGE_MAP[ext];

    if (!language) {
      this.logger.debug(
        `DependencyGraphService.buildGraph() - Skipping unsupported file: ${normalizedPath}`,
      );
      return;
    }

    try {
      const content = await this.fileSystem.readFile(filePath);

      const analysisResult = await this.astAnalysis.analyzeSource(
        content,
        language,
        normalizedPath,
      );

      if (!analysisResult.isOk()) {
        this.logger.debug(
          `DependencyGraphService.buildGraph() - Failed to analyze ${normalizedPath}: ${analysisResult.error?.message}`,
        );
        return;
      }

      const insights: CodeInsights = analysisResult.value!;
      const relativePath = path
        .relative(normalizedRoot, normalizedPath)
        .replace(/\\/g, '/');

      nodes.set(normalizedPath, {
        path: normalizedPath,
        relativePath,
        imports: insights.imports,
        exports: insights.exports ?? [],
        language,
      });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      this.logger.debug(
        `DependencyGraphService.buildGraph() - Error reading ${normalizedPath}: ${errorMessage}`,
      );
    }
  }

  /**
   * Resolve every node's imports into forward and reverse edges. A
   * background build (`isCurrent` given) yields a macrotask whenever it has
   * linked for {@link EDGE_SLICE_MS}, checked before every node and every
   * import, so one import-heavy file cannot hold the host; once `isCurrent`
   * says it was superseded it stops and returns the partial graph, which
   * `buildGraph` does not publish. An awaited build never yields.
   */
  private async linkNodes(
    nodes: Map<string, FileNode>,
    normalizedRoot: string,
    tsconfigPaths: Record<string, string[]> | undefined,
    isCurrent: (() => boolean) | undefined,
  ): Promise<DependencyGraph> {
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();
    let unresolvedCount = 0;
    const knownFiles = new Set(nodes.keys());
    let sliceStart = Date.now();
    /** False once a background build was superseded: stop linking. */
    const continueLinking = async (): Promise<boolean> => {
      if (isCurrent === undefined) return true;
      if (Date.now() - sliceStart < EDGE_SLICE_MS) return true;
      await nextMacrotask();
      sliceStart = Date.now();
      return isCurrent();
    };
    const graph = (): DependencyGraph => ({
      nodes,
      edges,
      reverseEdges,
      builtAt: Date.now(),
      unresolvedCount,
    });
    for (const [filePath, node] of nodes) {
      if (!(await continueLinking())) return graph();
      const fileEdges = new Set<string>();
      edges.set(filePath, fileEdges);

      for (const imp of node.imports) {
        if (!(await continueLinking())) return graph();
        const resolvedPath = this.resolveImportPath(
          imp.source,
          filePath,
          normalizedRoot,
          knownFiles,
          tsconfigPaths,
        );

        if (resolvedPath) {
          fileEdges.add(resolvedPath);
          if (!reverseEdges.has(resolvedPath)) {
            reverseEdges.set(resolvedPath, new Set());
          }
          reverseEdges.get(resolvedPath)!.add(filePath);
        } else {
          unresolvedCount++;
          this.logger.debug(
            `DependencyGraphService.buildGraph() - Unresolved import '${imp.source}' in ${node.relativePath}`,
          );
        }
      }
    }

    return graph();
  }

  /** Make `graph` the one that answers queries for `key`. */
  private publish(
    key: string,
    graph: DependencyGraph,
    graphedFiles: number,
    discoveredFiles: number | undefined,
  ): void {
    this.graphs.set(key, graph);
    this.symbolIndexes.delete(key); // Invalidate cached symbol index for this root
    this.coverages.set(key, {
      graphedFiles,
      discoveredFiles:
        Number.isSafeInteger(discoveredFiles) &&
        (discoveredFiles as number) > graphedFiles
          ? (discoveredFiles as number)
          : graphedFiles,
    });
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
    const normalizedPath = filePath.replace(/\\/g, '/');
    const graph = this.findGraphForFile(normalizedPath);
    if (!graph) {
      return [];
    }

    const clampedDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);

    if (clampedDepth === 1) {
      const directEdges = graph.edges.get(normalizedPath);
      return directEdges ? Array.from(directEdges) : [];
    }
    const result: string[] = [];
    const visited = new Set<string>();
    visited.add(normalizedPath); // Mark origin as visited to prevent self-cycles

    this.collectDependencies(
      graph,
      normalizedPath,
      clampedDepth,
      visited,
      result,
    );

    return result;
  }

  /**
   * Get reverse dependencies (what files import this file).
   *
   * @param filePath - Absolute file path
   * @returns Array of dependent file paths
   */
  getDependents(filePath: string): string[] {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const graph = this.findGraphForFile(normalizedPath);
    if (!graph) {
      return [];
    }

    const dependents = graph.reverseEdges.get(normalizedPath);
    return dependents ? Array.from(dependents) : [];
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

  /** Build (and cache) the symbol index for a single graph, keyed by root. */
  private symbolIndexForKey(key: string): SymbolIndex {
    const cached = this.symbolIndexes.get(key);
    if (cached) {
      return cached;
    }

    const index: SymbolIndex = new Map();
    const graph = this.graphs.get(key);
    if (graph) {
      for (const [filePath, node] of graph.nodes) {
        if (node.exports.length > 0) {
          index.set(filePath, node.exports);
        }
      }
    }

    this.symbolIndexes.set(key, index);
    return index;
  }

  /**
   * Invalidate cached graph data for a specific file.
   * Removes the file's node and all edges to/from it.
   *
   * @param filePath - Absolute file path to invalidate
   */
  invalidateFile(filePath: string): void {
    const normalizedPath = filePath.replace(/\\/g, '/');
    const entry = this.findGraphEntryForFile(normalizedPath);
    if (!entry) {
      return;
    }
    const [key, graph] = entry;

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
      }
      graph.edges.delete(normalizedPath);
    }
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
    if (workspaceRoot) {
      const coverage = this.coverages.get(this.normalizeRoot(workspaceRoot));
      return coverage ? { ...coverage } : undefined;
    }
    if (this.coverages.size === 0) {
      return undefined;
    }
    const total: GraphCoverage = { graphedFiles: 0, discoveredFiles: 0 };
    for (const coverage of this.coverages.values()) {
      total.graphedFiles += coverage.graphedFiles;
      total.discoveredFiles += coverage.discoveredFiles;
    }
    return total;
  }

  /**
   * Coverage of the graph that answers {@link getDependencies} and
   * {@link getDependents} for `filePath` (the same selection: the sole graph,
   * else the one whose root is the longest prefix of the path), or
   * `undefined` when no graph answers it.
   */
  getCoverageForFile(filePath: string): GraphCoverage | undefined {
    const entry = this.findGraphEntryForFile(filePath.replace(/\\/g, '/'));
    const coverage = entry ? this.coverages.get(entry[0]) : undefined;
    return coverage ? { ...coverage } : undefined;
  }

  /**
   * Evict a single workspace's cached graph and symbol index. Call when a
   * workspace folder is closed so its graph does not linger in memory.
   */
  evict(workspaceRoot: string): void {
    const key = this.normalizeRoot(workspaceRoot);
    // Also when no graph is published yet: a build in flight must not publish.
    this.generations.delete(key);
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

  /** Normalize a workspace root to the map-key form (forward slashes, no trailing slash). */
  private normalizeRoot(root: string): string {
    return root.replace(/\\/g, '/').replace(/\/+$/, '');
  }

  /**
   * Find the graph a file belongs to. With a single open workspace the sole
   * graph answers every query (identical to the pre-multi-workspace behavior).
   * With several open, the file is routed to the graph whose root is the
   * longest prefix of the file path.
   */
  private findGraphForFile(
    normalizedPath: string,
  ): DependencyGraph | undefined {
    return this.findGraphEntryForFile(normalizedPath)?.[1];
  }

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
    let best: [string, DependencyGraph] | undefined;
    for (const entry of this.graphs.entries()) {
      const root = entry[0];
      if (
        normalizedPath === root ||
        normalizedPath.startsWith(root.endsWith('/') ? root : root + '/')
      ) {
        if (!best || root.length > best[0].length) {
          best = entry;
        }
      }
    }
    return best;
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
   * Resolve an import source to an absolute file path within the workspace.
   *
   * @returns Resolved absolute path (normalized with forward slashes) or null if unresolved
   */
  private resolveImportPath(
    importSource: string,
    importingFilePath: string,
    workspaceRoot: string,
    knownFiles: Set<string>,
    tsconfigPaths?: Record<string, string[]>,
  ): string | null {
    if (importSource.startsWith('.')) {
      return this.resolveRelativeImport(
        importSource,
        importingFilePath,
        knownFiles,
      );
    }
    if (tsconfigPaths) {
      const resolved = this.resolveTsconfigPath(
        importSource,
        workspaceRoot,
        knownFiles,
        tsconfigPaths,
      );
      if (resolved) {
        return resolved;
      }
    }
    return null;
  }

  /**
   * Resolve a relative import (starts with './' or '../') to an absolute path.
   */
  private resolveRelativeImport(
    importSource: string,
    importingFilePath: string,
    knownFiles: Set<string>,
  ): string | null {
    // All internal paths are pre-normalized to forward slashes, so resolve with
    // POSIX semantics. `path.resolve` would key off the host platform's notion
    // of "absolute" — on Linux a Windows-style root like `D:/ws` is treated as
    // relative and gets `process.cwd()` prepended, breaking resolution. `path.
    // posix.join` joins deterministically on every platform.
    const importDir = path.posix.dirname(importingFilePath);
    const basePath = path.posix.join(importDir, importSource);
    if (knownFiles.has(basePath)) {
      return basePath;
    }
    for (const ext of RESOLVE_EXTENSIONS) {
      const withExt = basePath + ext;
      if (knownFiles.has(withExt)) {
        return withExt;
      }
    }
    for (const indexFile of INDEX_FILES) {
      const indexPath = basePath + '/' + indexFile;
      if (knownFiles.has(indexPath)) {
        return indexPath;
      }
    }
    return null;
  }

  /**
   * Resolve a tsconfig path alias to an absolute file path.
   */
  private resolveTsconfigPath(
    importSource: string,
    workspaceRoot: string,
    knownFiles: Set<string>,
    tsconfigPaths: Record<string, string[]>,
  ): string | null {
    for (const [pattern, mappings] of Object.entries(tsconfigPaths)) {
      const match = this.matchTsconfigPattern(importSource, pattern);
      if (match === null) {
        continue;
      }
      for (const mappingPath of mappings) {
        const resolvedMapping = mappingPath.replace('*', match);
        // POSIX join for platform-independent resolution — see the note in
        // resolveRelativeImport. `workspaceRoot` is already forward-slashed, so
        // `path.resolve` on Linux would treat a Windows-style root as relative.
        const absolutePath = path.posix.join(workspaceRoot, resolvedMapping);
        if (knownFiles.has(absolutePath)) {
          return absolutePath;
        }
        for (const ext of RESOLVE_EXTENSIONS) {
          const withExt = absolutePath + ext;
          if (knownFiles.has(withExt)) {
            return withExt;
          }
        }
        for (const indexFile of INDEX_FILES) {
          const indexPath = absolutePath + '/' + indexFile;
          if (knownFiles.has(indexPath)) {
            return indexPath;
          }
        }
      }
    }

    return null;
  }

  /**
   * Match an import source against a tsconfig paths pattern.
   * Returns the captured wildcard portion, or null if no match.
   *
   * Pattern examples:
   * - "@ptah-extension/*" matches "@ptah-extension/shared" -> captured: "shared"
   * - "@ptah-extension/shared" matches "@ptah-extension/shared" exactly -> captured: ""
   */
  private matchTsconfigPattern(
    importSource: string,
    pattern: string,
  ): string | null {
    const wildcardIndex = pattern.indexOf('*');

    if (wildcardIndex === -1) {
      return importSource === pattern ? '' : null;
    }

    const prefix = pattern.substring(0, wildcardIndex);
    const suffix = pattern.substring(wildcardIndex + 1);

    if (!importSource.startsWith(prefix)) {
      return null;
    }

    if (suffix && !importSource.endsWith(suffix)) {
      return null;
    }
    const captured = importSource.substring(
      prefix.length,
      importSource.length - suffix.length,
    );

    return captured;
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
