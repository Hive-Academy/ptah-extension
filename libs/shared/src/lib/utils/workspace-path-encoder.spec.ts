/**
 * WorkspacePathEncoder Unit Tests
 * Testing path encoding for Claude CLI session directory format
 *
 * Test Coverage:
 * - Windows path encoding (D:\projects\ptah → d--projects-ptah)
 * - Linux path encoding (/home/user/project → -home-user-project)
 * - macOS path encoding (/Users/user/project → -users-user-project)
 * - Case normalization (MyProject → myproject)
 * - Special characters (spaces, hyphens)
 * - Security validation (path traversal, absolute paths)
 * - Length validation
 */

import { WorkspacePathEncoder } from './workspace-path-encoder';

describe('WorkspacePathEncoder', () => {
  describe('encode', () => {
    it('should encode Windows path with drive letter', () => {
      // Arrange
      const windowsPath = 'D:\\projects\\ptah-extension';

      // Act
      const result = WorkspacePathEncoder.encode(windowsPath);

      // Assert
      expect(result).toBe('d--projects-ptah-extension');
    });

    it('should encode Windows path with forward slashes', () => {
      // Arrange
      const windowsPath = 'D:/projects/ptah-extension';

      // Act
      const result = WorkspacePathEncoder.encode(windowsPath);

      // Assert
      expect(result).toBe('d--projects-ptah-extension');
    });

    it('should encode Linux path', () => {
      // Arrange
      const linuxPath = '/home/user/my-project';

      // Act
      const result = WorkspacePathEncoder.encode(linuxPath);

      // Assert
      expect(result).toBe('-home-user-my-project');
    });

    it('should encode macOS path', () => {
      // Arrange
      const macPath = '/Users/agent/workspace';

      // Act
      const result = WorkspacePathEncoder.encode(macPath);

      // Assert
      expect(result).toBe('-users-agent-workspace');
    });

    it('should handle mixed case (lowercase normalization)', () => {
      // Arrange
      const mixedCasePath = 'D:\\Projects\\MyApp\\SourceCode';

      // Act
      const result = WorkspacePathEncoder.encode(mixedCasePath);

      // Assert
      expect(result).toBe('d--projects-myapp-sourcecode');
    });

    it('should handle paths with spaces', () => {
      // Arrange
      const pathWithSpaces = 'D:\\My Projects\\My App';

      // Act
      const result = WorkspacePathEncoder.encode(pathWithSpaces);

      // Assert
      expect(result).toBe('d--my-projects-my-app');
    });

    it('should handle paths with multiple hyphens', () => {
      // Arrange
      const pathWithHyphens = 'D:\\projects\\my-awesome-app-v2';

      // Act
      const result = WorkspacePathEncoder.encode(pathWithHyphens);

      // Assert
      expect(result).toBe('d--projects-my-awesome-app-v2');
    });

    it('should handle single directory Linux path', () => {
      // Arrange
      const singleDir = '/home';

      // Act
      const result = WorkspacePathEncoder.encode(singleDir);

      // Assert
      expect(result).toBe('-home');
    });

    it('should handle deep nested Windows path', () => {
      // Arrange
      const deepPath = 'C:\\Users\\Developer\\Documents\\Projects\\2024\\App';

      // Act
      const result = WorkspacePathEncoder.encode(deepPath);

      // Assert
      expect(result).toBe('c--users-developer-documents-projects-2024-app');
    });

    it('should handle path with trailing slash', () => {
      // Arrange
      const trailingSlash = 'D:\\projects\\ptah\\';

      // Act
      const result = WorkspacePathEncoder.encode(trailingSlash);

      // Assert
      expect(result).toBe('d--projects-ptah-');
    });

    it('should reject path with traversal (..) sequence', () => {
      // Arrange
      const maliciousPath = 'D:\\projects\\..\\..\\etc\\passwd';

      // Act & Assert
      expect(() => WorkspacePathEncoder.encode(maliciousPath)).toThrow(
        'Path traversal detected',
      );
    });

    it('should reject empty path', () => {
      // Act & Assert
      expect(() => WorkspacePathEncoder.encode('')).toThrow(
        'Path cannot be empty',
      );
    });

    it('should reject path that is too long', () => {
      // Arrange: Create path > 510 chars (MAX_PATH_LENGTH * 2)
      const longPath = 'D:\\' + 'a'.repeat(520);

      // Act & Assert
      expect(() => WorkspacePathEncoder.encode(longPath)).toThrow(
        'Path too long',
      );
    });
  });

  describe('validate', () => {
    it('should validate correct Windows path', () => {
      // Arrange
      const windowsPath = 'D:\\projects\\ptah-extension';

      // Act
      const result = WorkspacePathEncoder.validate(windowsPath);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('D:/projects/ptah-extension');
    });

    it('should validate correct Linux path', () => {
      // Arrange
      const linuxPath = '/home/user/project';

      // Act
      const result = WorkspacePathEncoder.validate(linuxPath);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('/home/user/project');
    });

    it('should reject path with traversal', () => {
      // Arrange
      const maliciousPath = '../../../etc/passwd';

      // Act
      const result = WorkspacePathEncoder.validate(maliciousPath);

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toContain('Path traversal detected');
    });

    it('should reject empty path', () => {
      // Act
      const result = WorkspacePathEncoder.validate('');

      // Assert
      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Path cannot be empty');
    });

    it('should normalize backslashes to forward slashes', () => {
      // Arrange
      const windowsPath = 'C:\\Users\\Documents\\Project';

      // Act
      const result = WorkspacePathEncoder.validate(windowsPath);

      // Assert
      expect(result.isValid).toBe(true);
      expect(result.normalized).toBe('C:/Users/Documents/Project');
    });
  });

  describe('isValidEncoded', () => {
    it('should accept valid encoded path', () => {
      // Arrange
      const encoded = 'd--projects-ptah-extension';

      // Act
      const result = WorkspacePathEncoder.isValidEncoded(encoded);

      // Assert
      expect(result).toBe(true);
    });

    it('should accept Linux encoded path', () => {
      // Arrange
      const encoded = '-home-user-project';

      // Act
      const result = WorkspacePathEncoder.isValidEncoded(encoded);

      // Assert
      expect(result).toBe(true);
    });

    it('should reject path with slashes', () => {
      // Arrange
      const invalidPath = 'path/with/slash';

      // Act
      const result = WorkspacePathEncoder.isValidEncoded(invalidPath);

      // Assert
      expect(result).toBe(false);
    });

    it('should reject path with traversal', () => {
      // Arrange
      const maliciousPath = '../etc/passwd';

      // Act
      const result = WorkspacePathEncoder.isValidEncoded(maliciousPath);

      // Assert
      expect(result).toBe(false);
    });

    it('should reject empty string', () => {
      // Act
      const result = WorkspacePathEncoder.isValidEncoded('');

      // Assert
      expect(result).toBe(false);
    });

    it('should reject path that is too long', () => {
      // Arrange: Create encoded path > 255 chars
      const tooLong = 'a'.repeat(256);

      // Act
      const result = WorkspacePathEncoder.isValidEncoded(tooLong);

      // Assert
      expect(result).toBe(false);
    });
  });

  describe('Integration: Encoding Algorithm', () => {
    it('should follow Claude CLI encoding algorithm exactly', () => {
      // Test Case 1: Windows path (from research-report.md:54-62)
      // D:\projects\ptah-extension → d--projects-ptah-extension
      expect(WorkspacePathEncoder.encode('D:\\projects\\ptah-extension')).toBe(
        'd--projects-ptah-extension',
      );

      // Test Case 2: Linux path
      // /home/user/project → -home-user-project
      expect(WorkspacePathEncoder.encode('/home/user/project')).toBe(
        '-home-user-project',
      );

      // Test Case 3: macOS path
      // /Users/agent/app → -users-agent-app
      expect(WorkspacePathEncoder.encode('/Users/agent/app')).toBe(
        '-users-agent-app',
      );
    });

    it('should produce consistent encoding for same path', () => {
      // Arrange
      const path = 'D:\\projects\\ptah-extension';

      // Act
      const result1 = WorkspacePathEncoder.encode(path);
      const result2 = WorkspacePathEncoder.encode(path);

      // Assert
      expect(result1).toBe(result2);
    });
  });

  describe('Performance', () => {
    // Measure the per-call average over many warm iterations instead of a
    // single cold call. One cold invocation is dominated by JIT warmup, GC,
    // and scheduler jitter (seconds-of-ms on a loaded CI runner), which made
    // the prior single-shot `< 1ms` assertion flaky. The average reflects the
    // steady-state cost and stays well under the budget on any machine.
    const ITERATIONS = 1000;
    const WARMUP = 100;

    function averageDurationMs(run: () => void): number {
      for (let i = 0; i < WARMUP; i++) run();
      const startTime = performance.now();
      for (let i = 0; i < ITERATIONS; i++) run();
      return (performance.now() - startTime) / ITERATIONS;
    }

    it('should encode path in under 1ms', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const averageDuration = averageDurationMs(() =>
        WorkspacePathEncoder.encode(workspacePath),
      );

      // Assert
      expect(averageDuration).toBeLessThan(1); // < 1ms per call
    });

    it('should validate path in under 1ms', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const averageDuration = averageDurationMs(() =>
        WorkspacePathEncoder.validate(workspacePath),
      );

      // Assert
      expect(averageDuration).toBeLessThan(1); // < 1ms per call
    });
  });
});
