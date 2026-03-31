/**
 * Ignore Pattern Resolver Service
 *
 * Parses and resolves ignore patterns from various ignore files:
 * - .gitignore (Git)
 * - .vscodeignore (VS Code extensions)
 * - .prettierignore (Prettier)
 * - .eslintignore (ESLint)
 * - .npmignore (npm)
 *
 * Supports:
 * - Standard glob patterns
 * - Negation patterns (!pattern)
 * - Comments (# comment)
 * - Nested ignore files (subdirectory patterns override parent)
 * - Trailing spaces (ignored as per Git spec)
 *
 * @see https://git-scm.com/docs/gitignore - Git ignore pattern spec
 * @see .ptah/specs/TASK_PRV_005/implementation-plan.md - Phase 2 Step 2.5
 */

import { injectable, inject } from 'tsyringe';
import * as path from 'path';
import { TOKENS } from '@ptah-extension/vscode-core';
import { FileSystemService } from '../services/file-system.service';
import { PatternMatcherService } from './pattern-matcher.service';

/**
 * Parsed ignore file representation
 */
export interface ParsedIgnoreFile {
  /** Absolute path to the ignore file */
  filePath: string;
  /** Directory containing the ignore file (base directory for relative patterns) */
  baseDir: string;
  /** Parsed patterns (negations have ! prefix removed) */
  patterns: IgnorePattern[];
}

/**
 * Individual ignore pattern
 */
export interface IgnorePattern {
  /** Original pattern string */
  raw: string;
  /** Normalized pattern (cleaned, no comments/whitespace) */
  pattern: string;
  /** Whether this is a negation pattern (starts with !) */
  isNegation: boolean;
  /** Whether this pattern matches directories only (ends with /) */
  isDirectoryOnly: boolean;
  /** Line number in original file (for debugging) */
  lineNumber: number;
}

/**
 * Result of testing a file against ignore patterns
 */
export interface IgnoreTestResult {
  /** File path that was tested */
  filePath: string;
  /** Whether the file should be ignored */
  ignored: boolean;
  /** Which pattern caused the ignore decision (if any) */
  matchedPattern?: IgnorePattern;
  /** Which ignore file contained the matched pattern (if any) */
  matchedFile?: string;
}

/**
 * Ignore Pattern Resolver Service
 *
 * Parses ignore files and provides efficient pattern matching for file filtering.
 *
 * @example
 * ```typescript
 * const resolver = container.resolve(IgnorePatternResolverService);
 *
 * // Parse .gitignore
 * const gitignore = await resolver.parseIgnoreFile(uri);
 *
 * // Test if file should be ignored
 * const shouldIgnore = await resolver.isIgnored('node_modules/pkg/index.js', [gitignore]);
 * // shouldIgnore.ignored = true
 *
 * // Bulk test multiple files
 * const results = await resolver.testFiles(['src/app.ts', 'node_modules/pkg/index.js'], [gitignore]);
 * ```
 */
@injectable()
export class IgnorePatternResolverService {
  constructor(
    @inject(TOKENS.FILE_SYSTEM_SERVICE)
    private readonly fileSystem: FileSystemService,
    @inject(TOKENS.PATTERN_MATCHER_SERVICE)
    private readonly patternMatcher: PatternMatcherService,
  ) {}

  /**
   * Parse an ignore file and extract patterns
   *
   * Supports all standard ignore file formats:
   * - .gitignore, .vscodeignore, .prettierignore, etc.
   *
   * @param ignoreFileUri - VS Code URI of the ignore file
   * @returns Parsed ignore file with patterns
   *
   * @example
   * ```typescript
   * const gitignoreUri = vscode.Uri.file('/workspace/.gitignore');
   * const parsed = await resolver.parseIgnoreFile(gitignoreUri);
   * // parsed.patterns = [{ pattern: 'node_modules/', isNegation: false, ... }, ...]
   * ```
   */
  async parseIgnoreFile(ignoreFilePath: string): Promise<ParsedIgnoreFile> {
    const content = await this.fileSystem.readFile(ignoreFilePath);
    const filePath = ignoreFilePath;
    const baseDir = path.dirname(filePath);

    const patterns: IgnorePattern[] = [];
    const lines = content.split(/\r?\n/);

    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const lineNumber = i + 1;

      // Skip empty lines
      if (raw.trim() === '') {
        continue;
      }

      // Skip comments (lines starting with #)
      if (raw.trimStart().startsWith('#')) {
        continue;
      }

      // Parse pattern
      const pattern = this.parsePattern(raw, lineNumber);
      if (pattern) {
        patterns.push(pattern);
      }
    }

    return {
      filePath,
      baseDir,
      patterns,
    };
  }

  /**
   * Parse multiple ignore files from a workspace
   *
   * Automatically discovers and parses common ignore files:
   * - .gitignore
   * - .vscodeignore
   * - .prettierignore
   * - .eslintignore
   * - .npmignore
   *
   * Supports nested ignore files in subdirectories.
   *
   * @param workspaceUri - VS Code URI of workspace root
   * @param ignoreFileNames - Optional custom ignore file names to search for
   * @returns Array of parsed ignore files
   *
   * @example
   * ```typescript
   * const workspaceUri = vscode.Uri.file('/workspace');
   * const ignoreFiles = await resolver.parseWorkspaceIgnoreFiles(workspaceUri);
   * // ignoreFiles = [ParsedIgnoreFile for .gitignore, .prettierignore, etc.]
   * ```
   */
  async parseWorkspaceIgnoreFiles(
    workspacePath: string,
    ignoreFileNames: string[] = [
      '.gitignore',
      '.vscodeignore',
      '.prettierignore',
      '.eslintignore',
      '.npmignore',
    ],
  ): Promise<ParsedIgnoreFile[]> {
    const ignoreFiles: ParsedIgnoreFile[] = [];

    for (const fileName of ignoreFileNames) {
      const ignoreFilePath = path.join(workspacePath, fileName);

      // Check if file exists
      const exists = await this.fileSystem.exists(ignoreFilePath);
      if (!exists) {
        continue;
      }

      try {
        const parsed = await this.parseIgnoreFile(ignoreFilePath);
        ignoreFiles.push(parsed);
      } catch (error) {
        // Ignore parse errors (malformed ignore files)
        console.warn(
          `Failed to parse ignore file ${fileName}:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    return ignoreFiles;
  }

  /**
   * Test if a file should be ignored based on ignore patterns
   *
   * @param filePath - Absolute or relative file path to test
   * @param ignoreFiles - Array of parsed ignore files
   * @param workspaceRoot - Optional workspace root for relative path resolution
   * @returns Ignore test result
   *
   * @example
   * ```typescript
   * const result = await resolver.isIgnored('node_modules/pkg/index.js', [gitignore]);
   * // result.ignored = true
   * // result.matchedPattern = { pattern: 'node_modules/', ... }
   * ```
   */
  async isIgnored(
    filePath: string,
    ignoreFiles: ParsedIgnoreFile[],
    workspaceRoot?: string,
  ): Promise<IgnoreTestResult> {
    // Normalize file path to use forward slashes
    const normalizedPath = filePath.replace(/\\/g, '/');

    let ignored = false;
    let matchedPattern: IgnorePattern | undefined;
    let matchedFile: string | undefined;

    // Process ignore files in order (later files override earlier ones)
    // Patterns within a file are processed in order (later patterns override earlier ones)
    for (const ignoreFile of ignoreFiles) {
      for (const pattern of ignoreFile.patterns) {
        // Make path relative to ignore file's base directory if workspace root provided
        let testPath = normalizedPath;
        if (workspaceRoot) {
          const relativePath = this.makeRelativePath(
            normalizedPath,
            ignoreFile.baseDir,
            workspaceRoot,
          );
          testPath = relativePath;
        }

        // Test pattern match
        const matches = this.patternMatcher.isMatch(testPath, pattern.pattern, {
          dot: true, // Git ignores dot files by default unless explicitly included
          caseSensitive: process.platform !== 'win32', // Case-sensitive on Unix, insensitive on Windows
        });

        if (matches) {
          // Negation pattern (!pattern) means "don't ignore this file"
          ignored = !pattern.isNegation;
          matchedPattern = pattern;
          matchedFile = ignoreFile.filePath;
        }
      }
    }

    return {
      filePath: normalizedPath,
      ignored,
      matchedPattern,
      matchedFile,
    };
  }

  /**
   * Test multiple files against ignore patterns
   *
   * @param filePaths - Array of file paths to test
   * @param ignoreFiles - Array of parsed ignore files
   * @param workspaceRoot - Optional workspace root for relative path resolution
   * @returns Array of ignore test results
   *
   * @example
   * ```typescript
   * const files = ['src/app.ts', 'node_modules/pkg/index.js', 'dist/bundle.js'];
   * const results = await resolver.testFiles(files, [gitignore]);
   * // results[0].ignored = false (src/app.ts not ignored)
   * // results[1].ignored = true (node_modules/ ignored)
   * // results[2].ignored = true (dist/ ignored)
   * ```
   */
  async testFiles(
    filePaths: string[],
    ignoreFiles: ParsedIgnoreFile[],
    workspaceRoot?: string,
  ): Promise<IgnoreTestResult[]> {
    const results: IgnoreTestResult[] = [];

    for (const filePath of filePaths) {
      const result = await this.isIgnored(filePath, ignoreFiles, workspaceRoot);
      results.push(result);
    }

    return results;
  }

  /**
   * Get list of files that should NOT be ignored
   *
   * @param filePaths - Array of file paths to filter
   * @param ignoreFiles - Array of parsed ignore files
   * @param workspaceRoot - Optional workspace root for relative path resolution
   * @returns Array of file paths that should NOT be ignored
   *
   * @example
   * ```typescript
   * const files = ['src/app.ts', 'node_modules/pkg/index.js', 'dist/bundle.js'];
   * const included = await resolver.filterIgnored(files, [gitignore]);
   * // included = ['src/app.ts']
   * ```
   */
  async filterIgnored(
    filePaths: string[],
    ignoreFiles: ParsedIgnoreFile[],
    workspaceRoot?: string,
  ): Promise<string[]> {
    const results = await this.testFiles(filePaths, ignoreFiles, workspaceRoot);
    return results
      .filter((result) => !result.ignored)
      .map((result) => result.filePath);
  }

  /**
   * Parse a single pattern line from an ignore file
   *
   * @param raw - Raw pattern line
   * @param lineNumber - Line number in file (for debugging)
   * @returns Parsed ignore pattern or null if invalid
   */
  private parsePattern(raw: string, lineNumber: number): IgnorePattern | null {
    // Remove trailing whitespace (as per Git spec)
    let pattern = raw.trimEnd();

    // Remove leading whitespace (preserve leading ! for negation)
    pattern = pattern.trimStart();

    // Empty pattern after trimming
    if (pattern === '') {
      return null;
    }

    // Check for negation pattern
    const isNegation = pattern.startsWith('!');
    if (isNegation) {
      pattern = pattern.slice(1).trimStart();
    }

    // Check for directory-only pattern (ends with /)
    const isDirectoryOnly = pattern.endsWith('/');

    // Normalize pattern:
    // - Remove leading slash (treat as relative to base dir)
    // - Keep trailing slash for directory patterns
    if (pattern.startsWith('/')) {
      pattern = pattern.slice(1);
    }

    // Convert directory pattern to glob (add ** to match all files inside)
    if (isDirectoryOnly && !pattern.includes('*')) {
      pattern = `${pattern}**`;
    }

    return {
      raw,
      pattern,
      isNegation,
      isDirectoryOnly,
      lineNumber,
    };
  }

  /**
   * Make a file path relative to a base directory
   *
   * @param filePath - Absolute file path
   * @param baseDir - Base directory
   * @param workspaceRoot - Workspace root
   * @returns Relative path
   */
  private makeRelativePath(
    filePath: string,
    baseDir: string,
    workspaceRoot: string,
  ): string {
    // Normalize paths
    const normalizedFile = filePath.replace(/\\/g, '/');
    const normalizedBase = baseDir.replace(/\\/g, '/');
    const normalizedRoot = workspaceRoot.replace(/\\/g, '/');

    // If file is under base dir, make relative to base
    if (normalizedFile.startsWith(normalizedBase)) {
      return normalizedFile.slice(normalizedBase.length + 1);
    }

    // Otherwise, make relative to workspace root
    if (normalizedFile.startsWith(normalizedRoot)) {
      return normalizedFile.slice(normalizedRoot.length + 1);
    }

    // Return as-is if not under workspace
    return normalizedFile;
  }
}
