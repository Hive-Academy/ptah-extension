/**
 * Pattern Matching Service
 *
 * High-performance glob pattern matching using picomatch library.
 * Provides 7-10x performance improvement over minimatch through:
 * - Compiled pattern caching (LRU cache)
 * - Efficient glob matching (follows Bash 4.3 spec)
 * - Batch file matching with boolean logic
 *
 * @see https://github.com/micromatch/picomatch - 7.2x faster than minimatch
 * @see .ptah/specs/TASK_PRV_005/research-report.md - Research Finding 5
 */

import { injectable } from 'tsyringe';
import picomatch from 'picomatch';

/**
 * LRU Cache implementation for compiled patterns
 * Stores recently used compiled matchers to avoid recompilation
 */
class LRUCache<K, V> {
  private cache = new Map<K, V>();
  private maxSize: number;

  constructor(maxSize = 100) {
    this.maxSize = maxSize;
  }

  get(key: K): V | undefined {
    const value = this.cache.get(key);
    if (value !== undefined) {
      // Move to end (most recently used)
      this.cache.delete(key);
      this.cache.set(key, value);
    }
    return value;
  }

  set(key: K, value: V): void {
    // Remove if exists (to update position)
    if (this.cache.has(key)) {
      this.cache.delete(key);
    }

    // Add to end
    this.cache.set(key, value);

    // Evict oldest if over size limit
    if (this.cache.size > this.maxSize) {
      const firstKey = this.cache.keys().next().value as K;
      if (firstKey !== undefined) {
        this.cache.delete(firstKey);
      }
    }
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }
}

/**
 * Compiled pattern matcher function
 * Returns true if path matches pattern
 */
type MatcherFunction = (path: string) => boolean;

/**
 * Pattern matching result for batch operations
 */
export interface PatternMatchResult {
  /** File path that was tested */
  path: string;
  /** Whether the path matched the pattern(s) */
  matched: boolean;
  /** Which pattern(s) matched (if any) */
  matchedPatterns: string[];
}

/**
 * Options for pattern matching
 */
export interface PatternMatchOptions {
  /** Base directory for relative path resolution */
  baseDir?: string;
  /** Whether to match dot files (default: false) */
  dot?: boolean;
  /** Whether patterns are case-sensitive (default: true on Linux, false on Windows) */
  caseSensitive?: boolean;
  /** Whether to ignore case (alias for !caseSensitive) */
  nocase?: boolean;
}

/**
 * Pattern Matcher Service
 *
 * Provides high-performance glob pattern matching with caching.
 * Uses picomatch for 7x performance improvement over minimatch.
 *
 * @example
 * ```typescript
 * const matcher = new PatternMatcherService();
 *
 * // Simple pattern matching
 * const matches = matcher.isMatch('src/app.ts', '** /*.ts'); // true
 *
 * // Negation patterns
 * const ignored = matcher.isMatch('node_modules/pkg/index.js', '!node_modules/**'); // false
 *
 * // Batch matching
 * const files = ['src/app.ts', 'test/app.spec.ts', 'README.md'];
 * const results = matcher.matchFiles(files, ['** /*.ts', '!** /*.spec.ts']);
 * // results = [{ path: 'src/app.ts', matched: true, matchedPatterns: ['** /*.ts'] }]
 * ```
 */
@injectable()
export class PatternMatcherService {
  /** Cache for compiled pattern matchers */
  private patternCache: LRUCache<string, MatcherFunction>;

  /** Cache for pattern matching results (path + pattern → boolean) */
  private resultCache: LRUCache<string, boolean>;

  constructor() {
    // Cache up to 100 compiled patterns
    this.patternCache = new LRUCache<string, MatcherFunction>(100);

    // Cache up to 1000 match results
    this.resultCache = new LRUCache<string, boolean>(1000);
  }

  /**
   * Check if a file path matches a glob pattern
   *
   * @param path - File path to test (relative or absolute)
   * @param pattern - Glob pattern to match against
   * @param options - Optional matching options
   * @returns True if path matches pattern
   *
   * @example
   * ```typescript
   * matcher.isMatch('src/app.ts', '** /*.ts'); // true
   * matcher.isMatch('src/app.js', '** /*.ts'); // false
   * matcher.isMatch('node_modules/pkg/index.js', 'node_modules/**'); // true
   * ```
   */
  isMatch(
    path: string,
    pattern: string,
    options?: PatternMatchOptions,
  ): boolean {
    // Check result cache first
    const cacheKey = `${path}::${pattern}::${JSON.stringify(options || {})}`;
    const cachedResult = this.resultCache.get(cacheKey);
    if (cachedResult !== undefined) {
      return cachedResult;
    }

    // Get or compile matcher
    const matcher = this.getCompiledMatcher(pattern, options);

    // Test path against matcher
    const result = matcher(path);

    // Cache result
    this.resultCache.set(cacheKey, result);

    return result;
  }

  /**
   * Match multiple files against a single pattern
   *
   * @param paths - Array of file paths to test
   * @param pattern - Glob pattern to match against
   * @param options - Optional matching options
   * @returns Array of paths that matched the pattern
   *
   * @example
   * ```typescript
   * const files = ['src/app.ts', 'src/app.spec.ts', 'README.md'];
   * const tsFiles = matcher.match(files, '** /*.ts');
   * // tsFiles = ['src/app.ts', 'src/app.spec.ts']
   * ```
   */
  match(
    paths: string[],
    pattern: string,
    options?: PatternMatchOptions,
  ): string[] {
    return paths.filter((path) => this.isMatch(path, pattern, options));
  }

  /**
   * Match files against multiple patterns with inclusion/exclusion support
   *
   * Patterns starting with '!' are treated as exclusions.
   * A file matches if:
   * - It matches at least one inclusion pattern AND
   * - It doesn't match any exclusion patterns
   *
   * @param paths - Array of file paths to test
   * @param patterns - Array of glob patterns (use '!' prefix for exclusions)
   * @param options - Optional matching options
   * @returns Array of PatternMatchResult objects
   *
   * @example
   * ```typescript
   * const files = ['src/app.ts', 'src/app.spec.ts', 'node_modules/pkg/index.js'];
   * const results = matcher.matchFiles(files, ['** /*.ts', '** /*.js', '!** /*.spec.ts', '!node_modules/**']);
   * // results = [
   * //   { path: 'src/app.ts', matched: true, matchedPatterns: ['** /*.ts'] },
   * //   { path: 'src/app.spec.ts', matched: false, matchedPatterns: [] },
   * //   { path: 'node_modules/pkg/index.js', matched: false, matchedPatterns: [] }
   * // ]
   * ```
   */
  matchFiles(
    paths: string[],
    patterns: string[],
    options?: PatternMatchOptions,
  ): PatternMatchResult[] {
    // Separate inclusion and exclusion patterns
    const inclusionPatterns = patterns.filter((p) => !p.startsWith('!'));
    const exclusionPatterns = patterns
      .filter((p) => p.startsWith('!'))
      .map((p) => p.slice(1));

    return paths.map((path) => {
      const matchedInclusions: string[] = [];
      const matchedExclusions: string[] = [];

      // Check inclusion patterns
      for (const pattern of inclusionPatterns) {
        if (this.isMatch(path, pattern, options)) {
          matchedInclusions.push(pattern);
        }
      }

      // Check exclusion patterns
      for (const pattern of exclusionPatterns) {
        if (this.isMatch(path, pattern, options)) {
          matchedExclusions.push(`!${pattern}`);
        }
      }

      // A file matches if:
      // - It matches at least one inclusion pattern (or no inclusion patterns specified)
      // - AND it doesn't match any exclusion patterns
      const hasInclusion =
        inclusionPatterns.length === 0 || matchedInclusions.length > 0;
      const hasExclusion = matchedExclusions.length > 0;
      const matched = hasInclusion && !hasExclusion;

      return {
        path,
        matched,
        matchedPatterns: matched ? matchedInclusions : [],
      };
    });
  }

  /**
   * Get only the paths that matched from a batch match operation
   *
   * @param paths - Array of file paths to test
   * @param patterns - Array of glob patterns (use '!' prefix for exclusions)
   * @param options - Optional matching options
   * @returns Array of paths that matched
   *
   * @example
   * ```typescript
   * const files = ['src/app.ts', 'src/app.spec.ts', 'node_modules/pkg/index.js'];
   * const matched = matcher.matchFilesSimple(files, ['** /*.ts', '!** /*.spec.ts']);
   * // matched = ['src/app.ts']
   * ```
   */
  matchFilesSimple(
    paths: string[],
    patterns: string[],
    options?: PatternMatchOptions,
  ): string[] {
    return this.matchFiles(paths, patterns, options)
      .filter((result) => result.matched)
      .map((result) => result.path);
  }

  /**
   * Get or create a compiled pattern matcher
   *
   * @param pattern - Glob pattern to compile
   * @param options - Optional matching options
   * @returns Compiled matcher function
   */
  private getCompiledMatcher(
    pattern: string,
    options?: PatternMatchOptions,
  ): MatcherFunction {
    // Create cache key from pattern + options
    const cacheKey = `${pattern}::${JSON.stringify(options || {})}`;

    // Check cache first
    const cached = this.patternCache.get(cacheKey);
    if (cached) {
      return cached;
    }

    // Compile new matcher with picomatch
    const picomatchOptions: picomatch.PicomatchOptions = {
      dot: options?.dot,
      // Handle case sensitivity: default to case-sensitive (false for nocase)
      // If caseSensitive is explicitly set to false, enable nocase
      // If nocase is explicitly set, use that
      nocase:
        options?.caseSensitive === false ? true : (options?.nocase ?? false),
      // Follow Bash 4.3 glob spec
      bash: true,
      // Enable brace expansion: {a,b,c}
      nobrace: false,
      // Enable advanced globstar: **
      noglobstar: false,
    };

    const matcher = picomatch(pattern, picomatchOptions);

    // Cache compiled matcher
    this.patternCache.set(cacheKey, matcher);

    return matcher;
  }

  /**
   * Clear all caches
   * Useful for testing or when patterns change frequently
   */
  clearCache(): void {
    this.patternCache.clear();
    this.resultCache.clear();
  }

  /**
   * Get cache statistics
   * Useful for monitoring and optimization
   */
  getCacheStats(): {
    patternCacheSize: number;
    resultCacheSize: number;
  } {
    return {
      patternCacheSize: this.patternCache.size,
      resultCacheSize: this.resultCache.size,
    };
  }
}
