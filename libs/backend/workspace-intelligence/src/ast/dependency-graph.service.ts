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

// ---------------------------------------------------------------------------
// Public data structures
// ---------------------------------------------------------------------------

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

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Extensions to try when resolving relative imports (in order) */
const RESOLVE_EXTENSIONS = ['.ts', '.tsx', '.js', '.jsx'];

/** Index file names to try when resolving directory imports */
const INDEX_FILES = ['index.ts', 'index.js'];

/** Maximum transitive depth allowed for getDependencies */
const MAX_DEPTH = 3;

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

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
  /** The cached dependency graph */
  private graph: DependencyGraph | null = null;

  /** Cached symbol index derived from graph nodes */
  private symbolIndex: SymbolIndex | null = null;

  constructor(
    @inject(TOKENS.AST_ANALYSIS_SERVICE)
    private readonly astAnalysis: AstAnalysisService,
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.LOGGER) private readonly logger: Logger
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
    tsconfigPaths?: Record<string, string[]>
  ): Promise<DependencyGraph> {
    const startTime = Date.now();
    this.logger.info(
      `DependencyGraphService.buildGraph() - Building graph for ${filePaths.length} files`
    );

    const nodes = new Map<string, FileNode>();
    const edges = new Map<string, Set<string>>();
    const reverseEdges = new Map<string, Set<string>>();
    let unresolvedCount = 0;

    // Normalize workspace root to use forward slashes for consistent path handling
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

    // Phase 1: Parse all files and build nodes (bounded parallelism, chunks of 20)
    const CHUNK_SIZE = 20;

    const processFile = async (filePath: string): Promise<void> => {
      const normalizedPath = filePath.replace(/\\/g, '/');
      const ext = path.extname(normalizedPath).toLowerCase();
      const language = EXTENSION_LANGUAGE_MAP[ext];

      if (!language) {
        this.logger.debug(
          `DependencyGraphService.buildGraph() - Skipping unsupported file: ${normalizedPath}`
        );
        return;
      }

      try {
        const content = await this.fileSystem.readFile(filePath);

        const analysisResult = this.astAnalysis.analyzeSource(
          content,
          language,
          normalizedPath
        );

        if (!analysisResult.isOk()) {
          this.logger.debug(
            `DependencyGraphService.buildGraph() - Failed to analyze ${normalizedPath}: ${analysisResult.error?.message}`
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
          `DependencyGraphService.buildGraph() - Error reading ${normalizedPath}: ${errorMessage}`
        );
      }
    };

    for (let i = 0; i < filePaths.length; i += CHUNK_SIZE) {
      const chunk = filePaths.slice(i, i + CHUNK_SIZE);
      await Promise.allSettled(chunk.map(processFile));
    }

    // Build a set of known file paths for fast lookup during resolution
    const knownFiles = new Set(nodes.keys());

    // Phase 2: Resolve imports and build edges
    for (const [filePath, node] of nodes) {
      const fileEdges = new Set<string>();

      for (const imp of node.imports) {
        const resolvedPath = this.resolveImportPath(
          imp.source,
          filePath,
          normalizedRoot,
          knownFiles,
          tsconfigPaths
        );

        if (resolvedPath) {
          fileEdges.add(resolvedPath);

          // Build reverse edge
          if (!reverseEdges.has(resolvedPath)) {
            reverseEdges.set(resolvedPath, new Set());
          }
          reverseEdges.get(resolvedPath)!.add(filePath);
        } else {
          unresolvedCount++;
          this.logger.debug(
            `DependencyGraphService.buildGraph() - Unresolved import '${imp.source}' in ${node.relativePath}`
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

    this.graph = graph;
    this.symbolIndex = null; // Invalidate cached symbol index

    const elapsed = Date.now() - startTime;
    this.logger.info(
      `DependencyGraphService.buildGraph() - Graph built in ${elapsed}ms: ` +
        `${nodes.size} nodes, ${this.countEdges(
          edges
        )} edges, ${unresolvedCount} unresolved`
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
    if (!this.graph) {
      return [];
    }

    const clampedDepth = Math.min(Math.max(depth, 1), MAX_DEPTH);
    const normalizedPath = filePath.replace(/\\/g, '/');

    if (clampedDepth === 1) {
      const directEdges = this.graph.edges.get(normalizedPath);
      return directEdges ? Array.from(directEdges) : [];
    }

    // Transitive traversal with cycle detection
    const result: string[] = [];
    const visited = new Set<string>();
    visited.add(normalizedPath); // Mark origin as visited to prevent self-cycles

    this.collectDependencies(normalizedPath, clampedDepth, visited, result);

    return result;
  }

  /**
   * Get reverse dependencies (what files import this file).
   *
   * @param filePath - Absolute file path
   * @returns Array of dependent file paths
   */
  getDependents(filePath: string): string[] {
    if (!this.graph) {
      return [];
    }

    const normalizedPath = filePath.replace(/\\/g, '/');
    const dependents = this.graph.reverseEdges.get(normalizedPath);
    return dependents ? Array.from(dependents) : [];
  }

  /**
   * Get the symbol index (map of file path to exported symbols).
   * Used by FileRelevanceScorerService for symbol-aware scoring.
   * Lazily computed from graph nodes.
   *
   * @returns SymbolIndex map
   */
  getSymbolIndex(): SymbolIndex {
    if (this.symbolIndex) {
      return this.symbolIndex;
    }

    const index: SymbolIndex = new Map();

    if (this.graph) {
      for (const [filePath, node] of this.graph.nodes) {
        if (node.exports.length > 0) {
          index.set(filePath, node.exports);
        }
      }
    }

    this.symbolIndex = index;
    return index;
  }

  /**
   * Invalidate cached graph data for a specific file.
   * Removes the file's node and all edges to/from it.
   *
   * @param filePath - Absolute file path to invalidate
   */
  invalidateFile(filePath: string): void {
    if (!this.graph) {
      return;
    }

    const normalizedPath = filePath.replace(/\\/g, '/');

    // Remove forward edges from this file
    const forwardDeps = this.graph.edges.get(normalizedPath);
    if (forwardDeps) {
      // Remove this file from reverse edges of its dependencies
      for (const dep of forwardDeps) {
        const reverseDeps = this.graph.reverseEdges.get(dep);
        if (reverseDeps) {
          reverseDeps.delete(normalizedPath);
          if (reverseDeps.size === 0) {
            this.graph.reverseEdges.delete(dep);
          }
        }
      }
      this.graph.edges.delete(normalizedPath);
    }

    // Remove reverse edges pointing to this file
    const reverseDeps = this.graph.reverseEdges.get(normalizedPath);
    if (reverseDeps) {
      // Remove this file from forward edges of its dependents
      for (const dependent of reverseDeps) {
        const fwdDeps = this.graph.edges.get(dependent);
        if (fwdDeps) {
          fwdDeps.delete(normalizedPath);
        }
      }
      this.graph.reverseEdges.delete(normalizedPath);
    }

    // Remove the node itself
    this.graph.nodes.delete(normalizedPath);

    // Invalidate cached symbol index
    this.symbolIndex = null;

    this.logger.debug(
      `DependencyGraphService.invalidateFile() - Invalidated ${normalizedPath}`
    );
  }

  /**
   * Check if the graph has been built.
   */
  isBuilt(): boolean {
    return this.graph !== null;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Recursively collect transitive dependencies with cycle detection.
   */
  private collectDependencies(
    filePath: string,
    remainingDepth: number,
    visited: Set<string>,
    result: string[]
  ): void {
    if (remainingDepth <= 0 || !this.graph) {
      return;
    }

    const directDeps = this.graph.edges.get(filePath);
    if (!directDeps) {
      return;
    }

    for (const dep of directDeps) {
      if (visited.has(dep)) {
        continue; // Cycle detected -- skip this branch
      }

      visited.add(dep);
      result.push(dep);

      // Recurse for transitive dependencies
      if (remainingDepth > 1) {
        this.collectDependencies(dep, remainingDepth - 1, visited, result);
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
    tsconfigPaths?: Record<string, string[]>
  ): string | null {
    // Case 1: Relative imports
    if (importSource.startsWith('.')) {
      return this.resolveRelativeImport(
        importSource,
        importingFilePath,
        knownFiles
      );
    }

    // Case 2: tsconfig path aliases
    if (tsconfigPaths) {
      const resolved = this.resolveTsconfigPath(
        importSource,
        workspaceRoot,
        knownFiles,
        tsconfigPaths
      );
      if (resolved) {
        return resolved;
      }
    }

    // Case 3: External package -- unresolved
    return null;
  }

  /**
   * Resolve a relative import (starts with './' or '../') to an absolute path.
   */
  private resolveRelativeImport(
    importSource: string,
    importingFilePath: string,
    knownFiles: Set<string>
  ): string | null {
    const importDir = path.dirname(importingFilePath);
    const basePath = path.resolve(importDir, importSource).replace(/\\/g, '/');

    // Try exact path first (already has extension)
    if (knownFiles.has(basePath)) {
      return basePath;
    }

    // Try adding extensions
    for (const ext of RESOLVE_EXTENSIONS) {
      const withExt = basePath + ext;
      if (knownFiles.has(withExt)) {
        return withExt;
      }
    }

    // Try as directory with index file
    for (const indexFile of INDEX_FILES) {
      const indexPath = basePath + '/' + indexFile;
      if (knownFiles.has(indexPath)) {
        return indexPath;
      }
    }

    // If not found in knownFiles, mark as unresolved rather than hitting the filesystem.
    // Files not in knownFiles were not included in the build scope.
    return null;
  }

  /**
   * Resolve a tsconfig path alias to an absolute file path.
   */
  private resolveTsconfigPath(
    importSource: string,
    workspaceRoot: string,
    knownFiles: Set<string>,
    tsconfigPaths: Record<string, string[]>
  ): string | null {
    for (const [pattern, mappings] of Object.entries(tsconfigPaths)) {
      const match = this.matchTsconfigPattern(importSource, pattern);
      if (match === null) {
        continue;
      }

      // Try each mapping path
      for (const mappingPath of mappings) {
        // Replace the wildcard with the captured portion
        const resolvedMapping = mappingPath.replace('*', match);
        const absolutePath = path
          .resolve(workspaceRoot, resolvedMapping)
          .replace(/\\/g, '/');

        // Try exact path
        if (knownFiles.has(absolutePath)) {
          return absolutePath;
        }

        // Try with extensions
        for (const ext of RESOLVE_EXTENSIONS) {
          const withExt = absolutePath + ext;
          if (knownFiles.has(withExt)) {
            return withExt;
          }
        }

        // Try as directory with index file
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
    pattern: string
  ): string | null {
    const wildcardIndex = pattern.indexOf('*');

    if (wildcardIndex === -1) {
      // Exact match pattern (no wildcard)
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

    // Extract the captured portion between prefix and suffix
    const captured = importSource.substring(
      prefix.length,
      importSource.length - suffix.length
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
