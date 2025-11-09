/**
 * File Type Classifier Service
 *
 * Classifies files by type (source, test, config, documentation, asset)
 * based on file extensions, naming patterns, and directory structure.
 */

import { injectable } from 'tsyringe';
import * as path from 'path';
import { FileType } from '../types/workspace.types';

/**
 * File classification result
 */
export interface FileClassificationResult {
  /** Classified file type */
  type: FileType;
  /** Detected programming language (for source files) */
  language?: string;
  /** Confidence score (0-1, where 1 is highest confidence) */
  confidence: number;
}

/**
 * Service for classifying files by type using heuristics
 *
 * Classification strategy:
 * 1. Test files: *.test.*, *.spec.*, __tests__, test/ directory
 * 2. Config files: Known config extensions and filenames
 * 3. Documentation: .md, .txt, .rst, docs/ directory
 * 4. Assets: Images, fonts, media files
 * 5. Source: Everything else with programming language extensions
 */
@injectable()
export class FileTypeClassifierService {
  /**
   * Programming language file extensions mapping
   */
  private readonly languageExtensions = new Map<string, string>([
    // JavaScript/TypeScript ecosystem
    ['.js', 'javascript'],
    ['.mjs', 'javascript'],
    ['.cjs', 'javascript'],
    ['.jsx', 'javascriptreact'],
    ['.ts', 'typescript'],
    ['.tsx', 'typescriptreact'],
    ['.mts', 'typescript'],
    ['.cts', 'typescript'],

    // Web
    ['.html', 'html'],
    ['.htm', 'html'],
    ['.css', 'css'],
    ['.scss', 'scss'],
    ['.sass', 'sass'],
    ['.less', 'less'],

    // Python
    ['.py', 'python'],
    ['.pyi', 'python'],
    ['.pyw', 'python'],

    // Java/Kotlin/Scala
    ['.java', 'java'],
    ['.kt', 'kotlin'],
    ['.kts', 'kotlin'],
    ['.scala', 'scala'],

    // C/C++
    ['.c', 'c'],
    ['.h', 'c'],
    ['.cpp', 'cpp'],
    ['.cxx', 'cpp'],
    ['.cc', 'cpp'],
    ['.hpp', 'cpp'],
    ['.hxx', 'cpp'],

    // C#
    ['.cs', 'csharp'],
    ['.csx', 'csharp'],

    // Go
    ['.go', 'go'],

    // Rust
    ['.rs', 'rust'],

    // Ruby
    ['.rb', 'ruby'],

    // PHP
    ['.php', 'php'],

    // Shell
    ['.sh', 'shellscript'],
    ['.bash', 'shellscript'],
    ['.zsh', 'shellscript'],

    // Other
    ['.sql', 'sql'],
    ['.graphql', 'graphql'],
    ['.gql', 'graphql'],
    ['.proto', 'protobuf'],
  ]);

  /**
   * Configuration file extensions and exact names
   */
  private readonly configPatterns = new Set<string>([
    // Extensions
    '.config.js',
    '.config.ts',
    '.config.mjs',
    '.config.cjs',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.ini',
    '.conf',
    '.xml',
    '.env',

    // Exact filenames
    'package.json',
    'tsconfig.json',
    'jsconfig.json',
    'angular.json',
    'nx.json',
    'project.json',
    'workspace.json',
    'rush.json',
    'lerna.json',
    'turbo.json',
    'pnpm-workspace.yaml',
    '.eslintrc',
    '.eslintrc.js',
    '.eslintrc.json',
    '.prettierrc',
    '.prettierrc.js',
    '.prettierrc.json',
    'prettier.config.js',
    'eslint.config.js',
    'eslint.config.mjs',
    'vite.config.js',
    'vite.config.ts',
    'webpack.config.js',
    'rollup.config.js',
    'jest.config.js',
    'jest.config.ts',
    'vitest.config.ts',
    'karma.conf.js',
    'browserslist',
    '.editorconfig',
    '.gitignore',
    '.gitattributes',
    '.dockerignore',
    'Dockerfile',
    'docker-compose.yml',
    'docker-compose.yaml',
    'Makefile',
    'Cargo.toml',
    'Cargo.lock',
    'go.mod',
    'go.sum',
    'requirements.txt',
    'Pipfile',
    'Pipfile.lock',
    'poetry.lock',
    'pyproject.toml',
    'Gemfile',
    'Gemfile.lock',
    'composer.json',
    'composer.lock',
  ]);

  /**
   * Documentation file extensions
   */
  private readonly documentationExtensions = new Set<string>([
    '.md',
    '.markdown',
    '.txt',
    '.rst',
    '.adoc',
    '.asciidoc',
  ]);

  /**
   * Asset file extensions (images, fonts, media)
   */
  private readonly assetExtensions = new Set<string>([
    // Images
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.svg',
    '.webp',
    '.ico',
    '.bmp',
    '.tiff',

    // Fonts
    '.woff',
    '.woff2',
    '.ttf',
    '.otf',
    '.eot',

    // Media
    '.mp4',
    '.webm',
    '.ogg',
    '.mp3',
    '.wav',
    '.flac',

    // Archives
    '.zip',
    '.tar',
    '.gz',
    '.7z',
    '.rar',
  ]);

  /**
   * Test file patterns (regex)
   */
  private readonly testPatterns = [
    /\.test\.(js|ts|jsx|tsx|mjs|cjs)$/i,
    /\.spec\.(js|ts|jsx|tsx|mjs|cjs)$/i,
    /_test\.(py|go|rs)$/i,
    /_spec\.rb$/i,
    /Test\.(java|kt|scala|cs)$/,
  ];

  /**
   * Test directory names
   */
  private readonly testDirectories = new Set<string>([
    '__tests__',
    'test',
    'tests',
    'spec',
    'specs',
    'e2e',
  ]);

  /**
   * Documentation directory names
   */
  private readonly docsDirectories = new Set<string>([
    'docs',
    'documentation',
    'doc',
  ]);

  /**
   * Classify a file by analyzing its path and extension
   *
   * @param filePath - Absolute or relative file path
   * @returns Classification result with type, language, and confidence
   */
  public classifyFile(filePath: string): FileClassificationResult {
    const fileName = path.basename(filePath);
    const ext = path.extname(filePath).toLowerCase();
    const pathSegments = filePath.split(/[\\/]/).map((s) => s.toLowerCase());

    // 1. Test file detection (highest priority)
    if (this.isTestFile(fileName, ext, pathSegments)) {
      const language = this.languageExtensions.get(
        ext.replace(/\.(test|spec)/, '')
      );
      return {
        type: FileType.Test,
        language,
        confidence: 1.0,
      };
    }

    // 2. Configuration file detection
    if (this.isConfigFile(fileName, ext)) {
      return {
        type: FileType.Config,
        confidence: 1.0,
      };
    }

    // 3. Documentation file detection
    if (this.isDocumentationFile(fileName, ext, pathSegments)) {
      return {
        type: FileType.Documentation,
        confidence: 1.0,
      };
    }

    // 4. Asset file detection
    if (this.isAssetFile(ext)) {
      return {
        type: FileType.Asset,
        confidence: 1.0,
      };
    }

    // 5. Source file detection (default for programming languages)
    const language = this.languageExtensions.get(ext);
    if (language) {
      return {
        type: FileType.Source,
        language,
        confidence: 1.0,
      };
    }

    // 6. Unknown file type - classify as source with low confidence
    return {
      type: FileType.Source,
      confidence: 0.3,
    };
  }

  /**
   * Batch classify multiple files
   *
   * @param filePaths - Array of file paths to classify
   * @returns Map of file path to classification result
   */
  public classifyFiles(
    filePaths: string[]
  ): Map<string, FileClassificationResult> {
    const results = new Map<string, FileClassificationResult>();

    for (const filePath of filePaths) {
      results.set(filePath, this.classifyFile(filePath));
    }

    return results;
  }

  /**
   * Get statistics about classified files
   *
   * @param classifications - Map of classifications from classifyFiles()
   * @returns Statistics by file type
   */
  public getStatistics(
    classifications: Map<string, FileClassificationResult>
  ): Map<FileType, number> {
    const stats = new Map<FileType, number>();

    for (const result of classifications.values()) {
      const count = stats.get(result.type) ?? 0;
      stats.set(result.type, count + 1);
    }

    return stats;
  }

  /**
   * Check if file is a test file
   */
  private isTestFile(
    fileName: string,
    ext: string,
    pathSegments: string[]
  ): boolean {
    // Check test file naming patterns
    for (const pattern of this.testPatterns) {
      if (pattern.test(fileName)) {
        return true;
      }
    }

    // Check if file is in a test directory
    return pathSegments.some((segment) => this.testDirectories.has(segment));
  }

  /**
   * Check if file is a configuration file
   */
  private isConfigFile(fileName: string, ext: string): boolean {
    // Exact filename match
    if (this.configPatterns.has(fileName)) {
      return true;
    }

    // Extension match
    if (this.configPatterns.has(ext)) {
      return true;
    }

    // Config pattern match (e.g., .config.js)
    for (const pattern of this.configPatterns) {
      if (pattern.startsWith('.') && fileName.endsWith(pattern)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Check if file is a documentation file
   */
  private isDocumentationFile(
    fileName: string,
    ext: string,
    pathSegments: string[]
  ): boolean {
    // Extension match
    if (this.documentationExtensions.has(ext)) {
      return true;
    }

    // Special documentation files
    const docFiles = new Set([
      'readme',
      'changelog',
      'contributing',
      'license',
      'authors',
      'notice',
    ]);

    const fileNameLower = fileName.toLowerCase();
    for (const docFile of docFiles) {
      if (fileNameLower.startsWith(docFile)) {
        return true;
      }
    }

    // Check if in docs directory
    return pathSegments.some((segment) => this.docsDirectories.has(segment));
  }

  /**
   * Check if file is an asset file
   */
  private isAssetFile(ext: string): boolean {
    return this.assetExtensions.has(ext);
  }
}
