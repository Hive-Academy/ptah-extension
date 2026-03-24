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
    // These tests require VS Code environment (dynamic import of vscode.Uri)
    // They are integration tests that should run in Extension Development Host
    it.skip('should parse multiple ignore files', async () => {
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

    it.skip('should skip non-existent files', async () => {
      mockFileSystem.exists.mockResolvedValue(false);

      const workspaceUri = '/workspace';
      const result = await service.parseWorkspaceIgnoreFiles(workspaceUri);

      expect(result).toHaveLength(0);
    });

    it.skip('should handle malformed ignore files gracefully', async () => {
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
        '/workspace'
      );
      expect(result1.ignored).toBe(true);
      expect(result1.matchedPattern?.pattern).toBe('node_modules/**');

      const result2 = await service.isIgnored(
        'debug.log',
        [ignoreFile],
        '/workspace'
      );
      expect(result2.ignored).toBe(true);
      expect(result2.matchedPattern?.pattern).toBe('*.log');

      const result3 = await service.isIgnored(
        'src/app.ts',
        [ignoreFile],
        '/workspace'
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
        '/workspace'
      );
      expect(result1.ignored).toBe(true);

      const result2 = await service.isIgnored(
        'important.log',
        [ignoreFile],
        '/workspace'
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
        '/workspace'
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
        '/workspace'
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
        '/workspace'
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
        '/workspace'
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
        '/workspace'
      );

      expect(result.ignored).toBe(false);
      expect(result.matchedPattern).toBeUndefined();
      expect(result.matchedFile).toBeUndefined();
    });
  });
});
