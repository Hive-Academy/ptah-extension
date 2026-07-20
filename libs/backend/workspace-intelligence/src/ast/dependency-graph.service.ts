import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS, Logger } from '@ptah-extension/vscode-core';
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

  constructor(
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger,
  ) {}

  /**
   * Build the dependency graph for a set of workspace files.
   * Parses each file's imports/exports and resolves relative paths.
   *
   * @param filePaths - Absolute paths of files to include
   * @param workspaceRoot - Workspace root for relative path resolution
   * @param tsconfigPaths - Optional tsconfig compilerOptions.paths for alias resolution
   * @returns The built dependency graph
   */
  async buildGraph(
    filePaths: string[],
    workspaceRoot: string,
    tsconfigPaths?: Record<string, string[]>,
  ): Promise<DependencyGraph> {
    const startTime = Date.now();
    this.logger.info(
      `DependencyGraphService.buildGraph() - Building graph for ${filePaths.length} files`,
    );

    const nodes = new Map<string, FileNode>();
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();
    let unresolvedCount = 0;
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');
    const CHUNK_SIZE = 20;

    const processFile = async (filePath: string): Promise<void> => {
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

        const node: FileNode = {
          path: normalizedPath,
          relativePath,
          imports: insights.imports,
          exports: insights.exports ?? [],
          language,
        };

        nodes.set(normalizedPath, node);
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error);
        this.logger.debug(
          `DependencyGraphService.buildGraph() - Error reading ${normalizedPath}: ${errorMessage}`,
        );
      }
    };

    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(chunk.map(processFile));
    }
    const knownFiles = new Set(nodes.keys());
    for (const [filePath, node] of nodes) {
      const fileEdges = new Set<string>();

      for (const imp of node.imports) {
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

      edges.set(filePath, fileEdges);
    }

    const graph: DependencyGraph = {
      nodes,
      edges,
      reverseEdges,
      builtAt: Date.now(),
      unresolvedCount,
    };

    const key = this.normalizeRoot(workspaceRoot);
    this.graphs.set(key, graph);
    this.symbolIndexes.delete(key); // Invalidate cached symbol index for this root

    const elapsed = Date.now() - startTime;
    this.logger.info(
      `DependencyGraphService.buildGraph() - Graph built in ${elapsed}ms: ` +
        `${nodes.size} nodes, ${this.countEdges(
          edges,
        )} edges, ${unresolvedCount} unresolved`,
    );

    return graph;
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
   * Evict a single workspace's cached graph and symbol index. Call when a
   * workspace folder is closed so its graph does not linger in memory.
   */
  evict(workspaceRoot: string): void {
    const key = this.normalizeRoot(workspaceRoot);
    if (this.graphs.delete(key)) {
      this.symbolIndexes.delete(key);
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
    for (const key of [...this.graphs.keys()]) {
      if (!keep.has(key)) {
        this.graphs.delete(key);
        this.symbolIndexes.delete(key);
        this.logger.debug(
          `DependencyGraphService.retainOnly() - Evicted graph for ${key}`,
        );
      }
    }
  }

  /** Evict every cached graph (e.g. on shutdown). */
  clear(): void {
    this.graphs.clear();
    this.symbolIndexes.clear();
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
