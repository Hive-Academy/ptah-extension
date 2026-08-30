/**
 * Ignore Pattern Resolver Service Tests
 *
 * Comprehensive test suite for ignore pattern parsing and matching.
 * Tests cover:
 * - .gitignore parsing (standard Git format)
 * - .vscodeignore, .prettierignore, .eslintignore formats
 * - Negation patterns (!pattern)
 * - Directory patterns (trailing /)
 * - Comments and empty lines
 * - Nested ignore files
 * - Case sensitivity (platform-specific)
 */

import 'reflect-metadata';
import { IgnorePatternResolverService } from './ignore-pattern-resolver.service';
import { FileSystemService } from '../services/file-system.service';
import { PatternMatcherService } from './pattern-matcher.service';

describe('IgnorePatternResolverService', () => {
  let service: IgnorePatternResolverService;
  let mockFileSystem: jest.Mocked<FileSystemService>;
  let patternMatcher: PatternMatcherService;

  beforeEach(() => {
    // Create real pattern matcher (tested separately)
    patternMatcher = new PatternMatcherService();

    // Mock file system
    mockFileSystem = {
      readFile: jest.fn(),
      exists: jest.fn(),
    } as unknown as jest.Mocked<FileSystemService>;

    service = new IgnorePatternResolverService(mockFileSystem, patternMatcher);
  });

  describe('parseIgnoreFile', () => {
    it('should parse basic patterns', async () => {
      const content = `node_modules/
dist/
*.log`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.filePath).toBe('/workspace/.gitignore');
      expect(result.baseDir).toBe('/workspace');
      expect(result.patterns).toHaveLength(3);

      expect(result.patterns[0].pattern).toBe('node_modules/**');
      expect(result.patterns[0].isNegation).toBe(false);
      expect(result.patterns[0].isDirectoryOnly).toBe(true);

      expect(result.patterns[1].pattern).toBe('dist/**');
      expect(result.patterns[1].isDirectoryOnly).toBe(true);

      expect(result.patterns[2].pattern).toBe('*.log');
      expect(result.patterns[2].isDirectoryOnly).toBe(false);
    });

    it('should parse negation patterns', async () => {
      const content = `*.log
!important.log
!debug/`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(3);

      expect(result.patterns[0].pattern).toBe('*.log');
      expect(result.patterns[0].isNegation).toBe(false);

      expect(result.patterns[1].pattern).toBe('important.log');
      expect(result.patterns[1].isNegation).toBe(true);

      expect(result.patterns[2].pattern).toBe('debug/**');
      expect(result.patterns[2].isNegation).toBe(true);
    });

    it('should skip comments and empty lines', async () => {
      const content = `# Comment
node_modules/

# Another comment
dist/
`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].pattern).toBe('node_modules/**');
      expect(result.patterns[1].pattern).toBe('dist/**');
    });

    it('should handle leading slashes', async () => {
      const content = `/build/
/coverage/`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].pattern).toBe('build/**');
      expect(result.patterns[1].pattern).toBe('coverage/**');
    });

    it('should preserve glob patterns in directory patterns', async () => {
      const content = `**/node_modules/
dist/**/`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].pattern).toBe('**/node_modules/');
      expect(result.patterns[1].pattern).toBe('dist/**/');
    });

    it('should trim trailing whitespace', async () => {
      const content = `node_modules/
*.log     `;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].pattern).toBe('node_modules/**');
      expect(result.patterns[1].pattern).toBe('*.log');
    });

    it('should handle Windows line endings (CRLF)', async () => {
      const content = `node_modules/\r\ndist/\r\n*.log`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(3);
    });
  });

  describe('parseWorkspaceIgnoreFiles', () => {
    it('should parse multiple ignore files', async () => {
      mockFileSystem.exists.mockImplementation(async (filePath: string) => {
        return (
          filePath.endsWith('.gitignore') ||
          filePath.endsWith('.prettierignore')
        );
      });

      mockFileSystem.readFile.mockImplementation(async (filePath: string) => {
        if (filePath.endsWith('.gitignore')) {
          return 'node_modules/\n*.log';
        }
        if (filePath.endsWith('.prettierignore')) {
          return 'dist/\nbuild/';
        }
        return '';
      });

      const workspaceUri = '/workspace';
      const result = await service.parseWorkspaceIgnoreFiles(workspaceUri);

      expect(result).toHaveLength(2);
      expect(result[0].patterns).toHaveLength(2); // .gitignore
      expect(result[1].patterns).toHaveLength(2); // .prettierignore
    });

    it('should skip non-existent files', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const workspaceUri = '/workspace';
      const result = await service.parseWorkspaceIgnoreFiles(workspaceUri);

      expect(result).toHaveLength(0);
    });

    it('should handle malformed ignore files gracefully', async () => {
      mockFileSystem.exists.mockResolvedValue(true);
      mockFileSystem.readFile.mockRejectedValue(new Error('Read error'));

      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      const workspaceUri = '/workspace';
      const result = await service.parseWorkspaceIgnoreFiles(workspaceUri);

      expect(result).toHaveLength(0);
      expect(consoleWarnSpy).toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('isIgnored', () => {
    it('should ignore files matching patterns', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: 'node_modules/',
            pattern: 'node_modules/**',
            isNegation: false,
            isDirectoryOnly: true,
            lineNumber: 1,
          },
          {
            raw: '*.log',
            pattern: '*.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 2,
          },
        ],
      };

      const result1 = await service.isIgnored(
        'node_modules/pkg/index.js',
        [ignoreFile],
        '/workspace',
      );
      expect(result1.ignored).toBe(true);
      expect(result1.matchedPattern?.pattern).toBe('node_modules/**');

      const result2 = await service.isIgnored(
        'debug.log',
        [ignoreFile],
        '/workspace',
      );
      expect(result2.ignored).toBe(true);
      expect(result2.matchedPattern?.pattern).toBe('*.log');

      const result3 = await service.isIgnored(
        'src/app.ts',
        [ignoreFile],
        '/workspace',
      );
      expect(result3.ignored).toBe(false);
    });

    it('should respect negation patterns', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: '*.log',
            pattern: '*.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 1,
          },
          {
            raw: '!important.log',
            pattern: 'important.log',
            isNegation: true,
            isDirectoryOnly: false,
            lineNumber: 2,
          },
        ],
      };

      const result1 = await service.isIgnored(
        'debug.log',
        [ignoreFile],
        '/workspace',
      );
      expect(result1.ignored).toBe(true);

      const result2 = await service.isIgnored(
        'important.log',
        [ignoreFile],
        '/workspace',
      );
      expect(result2.ignored).toBe(false);
      expect(result2.matchedPattern?.isNegation).toBe(true);
    });

    it('should apply patterns in order (later overrides earlier)', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: '*.log',
            pattern: '*.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 1,
          },
          {
            raw: '!debug.log',
            pattern: 'debug.log',
            isNegation: true,
            isDirectoryOnly: false,
            lineNumber: 2,
          },
          {
            raw: 'debug.log',
            pattern: 'debug.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 3,
          },
        ],
      };

      const result = await service.isIgnored(
        'debug.log',
        [ignoreFile],
        '/workspace',
      );

      // Last matching pattern wins (line 3: ignore debug.log)
      expect(result.ignored).toBe(true);
      expect(result.matchedPattern?.lineNumber).toBe(3);
    });

    it('should normalize Windows paths', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: 'node_modules/',
            pattern: 'node_modules/**',
            isNegation: false,
            isDirectoryOnly: true,
            lineNumber: 1,
          },
        ],
      };

      const result = await service.isIgnored(
        'node_modules\\pkg\\index.js',
        [ignoreFile],
        '/workspace',
      );

      expect(result.ignored).toBe(true);
      expect(result.filePath).toBe('node_modules/pkg/index.js');
    });
  });

  describe('testFiles', () => {
    it('should test multiple files', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: 'node_modules/',
            pattern: 'node_modules/**',
            isNegation: false,
            isDirectoryOnly: true,
            lineNumber: 1,
          },
          {
            raw: 'dist/',
            pattern: 'dist/**',
            isNegation: false,
            isDirectoryOnly: true,
            lineNumber: 2,
          },
        ],
      };

      const files = [
        'src/app.ts',
        'node_modules/pkg/index.js',
        'dist/bundle.js',
      ];
      const results = await service.testFiles(
        files,
        [ignoreFile],
        '/workspace',
      );

      expect(results).toHaveLength(3);
      expect(results[0].ignored).toBe(false); // src/app.ts
      expect(results[1].ignored).toBe(true); // node_modules/pkg/index.js
      expect(results[2].ignored).toBe(true); // dist/bundle.js
    });
  });

  describe('filterIgnored', () => {
    it('should return only non-ignored files', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: 'node_modules/',
            pattern: 'node_modules/**',
            isNegation: false,
            isDirectoryOnly: true,
            lineNumber: 1,
          },
          {
            raw: '*.log',
            pattern: '*.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 2,
          },
        ],
      };

      const files = [
        'src/app.ts',
        'node_modules/pkg/index.js',
        'debug.log',
        'test/app.spec.ts',
      ];

      const included = await service.filterIgnored(
        files,
        [ignoreFile],
        '/workspace',
      );

      expect(included).toHaveLength(2);
      expect(included).toContain('src/app.ts');
      expect(included).toContain('test/app.spec.ts');
      expect(included).not.toContain('node_modules/pkg/index.js');
      expect(included).not.toContain('debug.log');
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty ignore file', async () => {
      const content = '';

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(0);
    });

    it('should handle ignore file with only comments', async () => {
      const content = `# Comment 1
# Comment 2
# Comment 3`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(0);
    });

    it('should handle complex glob patterns', async () => {
      const content = `**/*.{js,jsx}
src/**/test/**
!src/important/**`;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(3);
      expect(result.patterns[0].pattern).toBe('**/*.{js,jsx}');
      expect(result.patterns[1].pattern).toBe('src/**/test/**');
      expect(result.patterns[2].pattern).toBe('src/important/**');
      expect(result.patterns[2].isNegation).toBe(true);
    });

    it('should handle patterns with spaces', async () => {
      const content = `  node_modules/
  !  important.log  `;

      mockFileSystem.readFile.mockResolvedValue(content);

      const uri = '/workspace/.gitignore';
      const result = await service.parseIgnoreFile(uri);

      expect(result.patterns).toHaveLength(2);
      expect(result.patterns[0].pattern).toBe('node_modules/**');
      expect(result.patterns[1].pattern).toBe('important.log');
      expect(result.patterns[1].isNegation).toBe(true);
    });

    it('should handle no matching patterns', async () => {
      const ignoreFile = {
        filePath: '/workspace/.gitignore',
        baseDir: '/workspace',
        patterns: [
          {
            raw: '*.log',
            pattern: '*.log',
            isNegation: false,
            isDirectoryOnly: false,
            lineNumber: 1,
          },
        ],
      };

      const result = await service.isIgnored(
        'src/app.ts',
        [ignoreFile],
        '/workspace',
      );

      expect(result.ignored).toBe(false);
      expect(result.matchedPattern).toBeUndefined();
      expect(result.matchedFile).toBeUndefined();
    });
  });

  /**
   * TASK_2026_344 — `compileMatcher` is the BULK path's matcher: the workspace
   * walk filters 15k paths through it on the Electron main loop, where
   * `isIgnored`'s per-(path, pattern) `JSON.stringify` cache key and its
   * 1000-entry result LRU are pure overhead (they evict long before they can
   * hit at that volume).
   *
   * It is only allowed to exist because it gives the SAME ANSWER. So every case
   * below asserts the two against each other on the same inputs, not just
   * against a hand-written expectation — a divergence would show up as a
   * silently different index rather than as a failure anywhere else.
   */
  describe('compileMatcher', () => {
    /** Build a ParsedIgnoreFile through the real parser (so `dir/` → `dir/**`). */
    const parse = async (
      filePath: string,
      content: string,
    ): Promise<Awaited<ReturnType<typeof service.parseIgnoreFile>>> => {
      mockFileSystem.readFile.mockResolvedValue(content);
      return service.parseIgnoreFile(filePath);
    };

    const WS = '/workspace';

    it.each([
      ['plain pattern matches', '*.log', 'debug.log', true],
      ['plain pattern misses', '*.log', 'src/app.ts', false],
      ['negation after a match wins', '*.log\n!keep.log', 'keep.log', false],
      [
        'negation does not rescue a sibling',
        '*.log\n!keep.log',
        'other.log',
        true,
      ],
      ['directory pattern matches its children', 'dist/', 'dist/main.js', true],
      // `dist/` is parsed to `dist/**`, and with `bash: true` picomatch treats
      // the bare directory as matching too. Asserted rather than assumed
      // because the compiled matcher has to reproduce it, not improve on it.
      [
        'directory pattern also matches the directory itself',
        'dist/',
        'dist',
        true,
      ],
      [
        'directory pattern misses an unrelated path',
        'dist/',
        'src/dist-notes.md',
        false,
      ],
    ])(
      '%s — and agrees with isIgnored',
      async (_name, content, candidate, expected) => {
        const ignoreFile = await parse(`${WS}/.gitignore`, content);

        const compiled = service.compileMatcher([ignoreFile], WS);
        const reference = await service.isIgnored(candidate, [ignoreFile], WS);

        expect(compiled(candidate)).toBe(expected);
        expect(compiled(candidate)).toBe(reference.ignored);
      },
    );

    /**
     * A nested ignore file's patterns are relative to ITS directory, so the
     * candidate has to be re-based per ignore file before matching. Getting
     * this wrong is invisible on a root-level .gitignore and wrong on every
     * monorepo.
     */
    it('re-bases the candidate against a nested ignore file, as isIgnored does', async () => {
      const nested = await parse(`${WS}/src/.gitignore`, 'gen/');
      const candidate = `${WS}/src/gen/schema.ts`;

      const compiled = service.compileMatcher([nested], WS);
      const reference = await service.isIgnored(candidate, [nested], WS);

      expect(compiled(candidate)).toBe(true);
      expect(compiled(candidate)).toBe(reference.ignored);

      // A path outside the nested file's directory is untouched by its rules.
      const outside = `${WS}/other/gen/schema.ts`;
      expect(compiled(outside)).toBe(
        (await service.isIgnored(outside, [nested], WS)).ignored,
      );
    });

    /**
     * Case sensitivity is platform-derived (`nocase` on win32), so the correct
     * assertion is not "matches" or "does not match" — it is "the same as
     * isIgnored", plus the platform's own rule stated once.
     */
    it('applies the platform case rule exactly as isIgnored does', async () => {
      const ignoreFile = await parse(`${WS}/.gitignore`, 'DIST/');
      const candidate = 'dist/main.js';

      const compiled = service.compileMatcher([ignoreFile], WS);
      const reference = await service.isIgnored(candidate, [ignoreFile], WS);

      expect(compiled(candidate)).toBe(reference.ignored);
      expect(compiled(candidate)).toBe(process.platform === 'win32');
    });

    it('lets a later ignore file override an earlier one, as isIgnored does', async () => {
      const first = await parse(`${WS}/.gitignore`, '*.log');
      const second = await parse(`${WS}/.prettierignore`, '!debug.log');
      const candidate = 'debug.log';

      const compiled = service.compileMatcher([first, second], WS);
      const reference = await service.isIgnored(candidate, [first, second], WS);

      expect(compiled(candidate)).toBe(false);
      expect(compiled(candidate)).toBe(reference.ignored);
    });

    it('ignores nothing when there are no ignore files', () => {
      const compiled = service.compileMatcher([], WS);
      expect(compiled('src/app.ts')).toBe(false);
      expect(compiled('anything/at/all.log')).toBe(false);
    });

    it('normalizes Windows separators before matching, as isIgnored does', async () => {
      const ignoreFile = await parse(`${WS}/.gitignore`, 'dist/');
      const candidate = 'dist\\main.js';

      const compiled = service.compileMatcher([ignoreFile], WS);
      const reference = await service.isIgnored(candidate, [ignoreFile], WS);

      expect(compiled(candidate)).toBe(true);
      expect(compiled(candidate)).toBe(reference.ignored);
    });
  });
});
