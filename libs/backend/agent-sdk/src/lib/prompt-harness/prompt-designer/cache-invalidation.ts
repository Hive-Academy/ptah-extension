/**
 * Cache Invalidation for Prompt Designer
 *
 * TASK_2025_137 Batch 3: Detects when cached prompt designs should be
 * invalidated based on workspace file changes.
 *
 * Monitors:
 * - package.json (dependency changes)
 * - tsconfig.json (TypeScript config)
 * - angular.json (Angular projects)
 * - nx.json (Nx workspaces)
 * - .eslintrc.* (ESLint configs)
 * - .prettierrc* (Prettier configs)
 */

import * as crypto from 'crypto';

/**
 * Files that trigger cache invalidation when changed
 */
export const INVALIDATION_TRIGGER_FILES = [
  // Package management
  '**/package.json',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml',

  // TypeScript configuration
  '**/tsconfig.json',
  '**/tsconfig.*.json',

  // Framework configs
  '**/angular.json',
  '**/project.json',
  '**/nx.json',
  '**/workspace.json',
  '**/vite.config.*',
  '**/next.config.*',
  '**/nuxt.config.*',

  // Linting/formatting
  '**/.eslintrc.*',
  '**/eslint.config.*',
  '**/.prettierrc*',
  '**/prettier.config.*',

  // Build tools
  '**/webpack.config.*',
  '**/rollup.config.*',
  '**/esbuild.config.*',
];

/**
 * Files to exclude from invalidation checks
 */
export const INVALIDATION_IGNORE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/coverage/**',
  '**/.nx/**',
];

/**
 * Cache invalidation reasons
 */
export type InvalidationReason =
  | 'file_changed' // Trigger file was modified
  | 'dependencies_changed' // package.json dependencies changed
  | 'config_changed' // Configuration file changed
  | 'ttl_expired' // Cache exceeded time-to-live
  | 'manual' // User requested regeneration
  | 'workspace_changed'; // Workspace structure changed

/**
 * Invalidation event payload
 */
export interface InvalidationEvent {
  reason: InvalidationReason;
  workspacePath: string;
  triggerFile?: string;
  timestamp: number;
  details?: string;
}

/**
 * Cache key components for computing workspace hash
 */
export interface CacheKeyComponents {
  /** Workspace root path */
  workspacePath: string;
  /** Hash of relevant package.json content */
  dependencyHash: string;
  /** Config version for schema changes */
  configVersion: string;
  /** Optional project type override */
  projectType?: string;
}

/**
 * Current config version - increment when cache format changes
 */
export const CACHE_CONFIG_VERSION = '1.0.0';

/**
 * Default TTL for cached prompt designs (7 days in ms)
 */
export const DEFAULT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Compute a stable hash for cache key generation
 *
 * @param content - Content to hash
 * @returns SHA-256 hash (first 16 chars)
 */
export function computeHash(content: string): string {
  return crypto.createHash('sha256').update(content).digest('hex').slice(0, 16);
}

/**
 * Generate cache key from workspace components
 *
 * @param components - Cache key components
 * @returns Stable cache key string
 */
export function generateCacheKey(components: CacheKeyComponents): string {
  const keyParts = [
    'prompt-design',
    CACHE_CONFIG_VERSION,
    computeHash(components.workspacePath),
    components.dependencyHash,
  ];

  if (components.projectType) {
    keyParts.push(components.projectType);
  }

  return keyParts.join(':');
}

/**
 * Extract relevant dependency info for hashing
 *
 * @param packageJsonContent - Raw package.json content
 * @returns Normalized dependency string for hashing
 */
export function extractDependencyInfo(
  packageJsonContent: string
): string | null {
  try {
    const pkg = JSON.parse(packageJsonContent);
    const relevantFields = {
      name: pkg.name,
      dependencies: pkg.dependencies || {},
      devDependencies: pkg.devDependencies || {},
      peerDependencies: pkg.peerDependencies || {},
    };
    return JSON.stringify(relevantFields, Object.keys(relevantFields).sort());
  } catch {
    return null;
  }
}

/**
 * Check if a file path matches invalidation trigger patterns
 *
 * @param filePath - File path to check
 * @returns True if file should trigger invalidation
 */
export function isInvalidationTrigger(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/');

  // Check ignore patterns first
  for (const pattern of INVALIDATION_IGNORE_PATTERNS) {
    if (matchGlobPattern(normalizedPath, pattern)) {
      return false;
    }
  }

  // Check trigger patterns
  for (const pattern of INVALIDATION_TRIGGER_FILES) {
    if (matchGlobPattern(normalizedPath, pattern)) {
      return true;
    }
  }

  return false;
}

/**
 * Determine the invalidation reason based on file path
 *
 * @param filePath - Changed file path
 * @returns Specific invalidation reason
 */
export function getInvalidationReason(
  filePath: string
): InvalidationReason | null {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

  if (
    normalizedPath.includes('package.json') ||
    normalizedPath.includes('package-lock.json') ||
    normalizedPath.includes('yarn.lock') ||
    normalizedPath.includes('pnpm-lock.yaml')
  ) {
    return 'dependencies_changed';
  }

  if (
    normalizedPath.includes('tsconfig') ||
    normalizedPath.includes('angular.json') ||
    normalizedPath.includes('nx.json') ||
    normalizedPath.includes('eslint') ||
    normalizedPath.includes('prettier') ||
    normalizedPath.includes('vite.config') ||
    normalizedPath.includes('next.config') ||
    normalizedPath.includes('webpack.config')
  ) {
    return 'config_changed';
  }

  if (normalizedPath.includes('project.json')) {
    return 'workspace_changed';
  }

  return 'file_changed';
}

/**
 * Simple glob pattern matcher
 *
 * Supports:
 * - * (any characters in filename)
 * - ** (any directory depth)
 * - ? (single character)
 */
function matchGlobPattern(path: string, pattern: string): boolean {
  // Escape special regex chars except * and ?
  let regexPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '<<<GLOBSTAR>>>')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '.')
    .replace(/<<<GLOBSTAR>>>/g, '.*');

  // Anchor the pattern
  regexPattern = '^' + regexPattern + '$';

  try {
    return new RegExp(regexPattern, 'i').test(path);
  } catch {
    return false;
  }
}

/**
 * Check if cache entry has expired
 *
 * @param cachedAt - Timestamp when cached
 * @param ttlMs - Time-to-live in milliseconds
 * @returns True if cache has expired
 */
export function isCacheExpired(cachedAt: number, ttlMs: number): boolean {
  return Date.now() - cachedAt > ttlMs;
}

/**
 * Create an invalidation event
 *
 * @param reason - Invalidation reason
 * @param workspacePath - Workspace path
 * @param triggerFile - Optional triggering file
 * @param details - Optional additional details
 * @returns Invalidation event
 */
export function createInvalidationEvent(
  reason: InvalidationReason,
  workspacePath: string,
  triggerFile?: string,
  details?: string
): InvalidationEvent {
  return {
    reason,
    workspacePath,
    triggerFile,
    timestamp: Date.now(),
    details,
  };
}
