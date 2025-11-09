/**
 * Workspace Intelligence Type Definitions
 *
 * Domain-specific types for workspace analysis, file indexing, and context optimization.
 * Extends base WorkspaceInfo from shared types.
 */

import { WorkspaceInfo } from '@ptah-extension/shared';

/**
 * Project type enumeration for ecosystem detection
 */
export enum ProjectType {
  Node = 'node',
  React = 'react',
  Vue = 'vue',
  Angular = 'angular',
  NextJS = 'nextjs',
  Python = 'python',
  Java = 'java',
  Rust = 'rust',
  Go = 'go',
  DotNet = 'dotnet',
  PHP = 'php',
  Ruby = 'ruby',
  General = 'general',
}

/**
 * Framework enumeration for specific framework detection
 */
export enum Framework {
  React = 'react',
  Vue = 'vue',
  Angular = 'angular',
  NextJS = 'nextjs',
  Nuxt = 'nuxt',
  Express = 'express',
  Django = 'django',
  Laravel = 'laravel',
  Rails = 'rails',
}

/**
 * Monorepo type enumeration
 */
export enum MonorepoType {
  Nx = 'nx',
  Lerna = 'lerna',
  Rush = 'rush',
  Turborepo = 'turborepo',
  PnpmWorkspaces = 'pnpm-workspaces',
  YarnWorkspaces = 'yarn-workspaces',
}

/**
 * File classification types
 */
export enum FileType {
  Source = 'source',
  Test = 'test',
  Config = 'config',
  Documentation = 'docs',
  Asset = 'asset',
}

/**
 * Enhanced workspace information with project analysis
 * Extends base WorkspaceInfo from shared types
 */
export interface EnhancedWorkspaceInfo extends WorkspaceInfo {
  /** Detected project type */
  projectType: ProjectType;
  /** Detected framework (if applicable) */
  framework?: Framework;
  /** Whether workspace is a monorepo */
  isMonorepo: boolean;
  /** Monorepo type (if applicable) */
  monorepoType?: MonorepoType;
  /** Project dependencies */
  dependencies: string[];
  /** Development dependencies */
  devDependencies: string[];
}

/**
 * Indexed file metadata
 */
export interface IndexedFile {
  /** Absolute file path */
  path: string;
  /** Path relative to workspace root */
  relativePath: string;
  /** Classified file type */
  type: FileType;
  /** File size in bytes */
  size: number;
  /** Detected programming language */
  language?: string;
  /** Estimated token count for AI context */
  estimatedTokens: number;
}

/**
 * File indexing result
 */
export interface FileIndex {
  /** All indexed files */
  files: IndexedFile[];
  /** Ignore patterns applied */
  ignoredPatterns: string[];
  /** Total number of files indexed */
  totalFiles: number;
  /** Total size of all files in bytes */
  totalSize: number;
}

/**
 * Context optimization request parameters
 */
export interface ContextOptimizationRequest {
  /** Optional query for relevance scoring */
  query?: string;
  /** Maximum token budget */
  tokenBudget: number;
  /** Specific files to consider (if not all) */
  files?: string[];
  /** Patterns to exclude from context */
  excludePatterns?: string[];
}

/**
 * Context optimization result
 */
export interface ContextOptimizationResult {
  /** Files selected within token budget */
  selectedFiles: IndexedFile[];
  /** Total tokens of selected files */
  totalTokens: number;
  /** Relevance scores per file path */
  relevanceScores: Map<string, number>;
}

/**
 * Dependency information
 */
export interface DependencyInfo {
  /** Package name */
  name: string;
  /** Version or version range */
  version: string;
  /** Whether it's a development dependency */
  isDev: boolean;
}

/**
 * Project analysis result
 */
export interface ProjectAnalysis {
  /** Enhanced workspace information */
  workspace: EnhancedWorkspaceInfo;
  /** Detected dependencies */
  dependencies: DependencyInfo[];
  /** Project root paths (for monorepos, multiple roots) */
  roots: string[];
}
