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
 * - getSessionsDirectory() full path generation
 */

import { WorkspacePathEncoder } from './workspace-path-encoder';
import * as os from 'os';

// Mock os.homedir
jest.mock('os', () => ({
  homedir: jest.fn(() => 'C:\\Users\\testuser'),
}));

describe('WorkspacePathEncoder', () => {
  describe('encodeWorkspacePath', () => {
    it('should encode Windows path with drive letter', () => {
      // Arrange
      const windowsPath = 'D:\\projects\\ptah-extension';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(windowsPath);

      // Assert
      expect(result).toBe('d--projects-ptah-extension');
    });

    it('should encode Windows path with forward slashes', () => {
      // Arrange
      const windowsPath = 'D:/projects/ptah-extension';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(windowsPath);

      // Assert
      expect(result).toBe('d--projects-ptah-extension');
    });

    it('should encode Linux path', () => {
      // Arrange
      const linuxPath = '/home/user/my-project';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(linuxPath);

      // Assert
      expect(result).toBe('-home-user-my-project');
    });

    it('should encode macOS path', () => {
      // Arrange
      const macPath = '/Users/agent/workspace';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(macPath);

      // Assert
      expect(result).toBe('-users-agent-workspace');
    });

    it('should handle mixed case (lowercase normalization)', () => {
      // Arrange
      const mixedCasePath = 'D:\\Projects\\MyApp\\SourceCode';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(mixedCasePath);

      // Assert
      expect(result).toBe('d--projects-myapp-sourcecode');
    });

    it('should handle paths with spaces', () => {
      // Arrange
      const pathWithSpaces = 'D:\\My Projects\\My App';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(pathWithSpaces);

      // Assert
      expect(result).toBe('d--my projects-my app');
    });

    it('should handle paths with multiple hyphens', () => {
      // Arrange
      const pathWithHyphens = 'D:\\projects\\my-awesome-app-v2';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(pathWithHyphens);

      // Assert
      expect(result).toBe('d--projects-my-awesome-app-v2');
    });

    it('should handle single directory Linux path', () => {
      // Arrange
      const singleDir = '/home';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(singleDir);

      // Assert
      expect(result).toBe('-home');
    });

    it('should handle deep nested Windows path', () => {
      // Arrange
      const deepPath = 'C:\\Users\\Developer\\Documents\\Projects\\2024\\App';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(deepPath);

      // Assert
      expect(result).toBe('c--users-developer-documents-projects-2024-app');
    });

    it('should handle path with trailing slash', () => {
      // Arrange
      const trailingSlash = 'D:\\projects\\ptah\\';

      // Act
      const result = WorkspacePathEncoder.encodeWorkspacePath(trailingSlash);

      // Assert
      expect(result).toBe('d--projects-ptah-');
    });
  });

  describe('getSessionsDirectory', () => {
    beforeEach(() => {
      // Reset mock before each test
      (os.homedir as jest.Mock).mockReturnValue('C:\\Users\\testuser');
    });

    it('should return full path to sessions directory for Windows workspace', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const result = WorkspacePathEncoder.getSessionsDirectory(workspacePath);

      // Assert
      expect(result).toContain('.claude');
      expect(result).toContain('projects');
      expect(result).toContain('d--projects-ptah-extension');
      expect(result).toBe(
        'C:\\Users\\testuser\\.claude\\projects\\d--projects-ptah-extension'
      );
    });

    it('should return full path to sessions directory for Linux workspace', () => {
      // Arrange
      (os.homedir as jest.Mock).mockReturnValue('/home/testuser');
      const workspacePath = '/home/testuser/my-project';

      // Act
      const result = WorkspacePathEncoder.getSessionsDirectory(workspacePath);

      // Assert
      expect(result).toContain('.claude');
      expect(result).toContain('projects');
      expect(result).toContain('-home-testuser-my-project');
      expect(result).toBe(
        '/home/testuser/.claude/projects/-home-testuser-my-project'
      );
    });

    it('should return full path to sessions directory for macOS workspace', () => {
      // Arrange
      (os.homedir as jest.Mock).mockReturnValue('/Users/testuser');
      const workspacePath = '/Users/testuser/workspace';

      // Act
      const result = WorkspacePathEncoder.getSessionsDirectory(workspacePath);

      // Assert
      expect(result).toContain('.claude');
      expect(result).toContain('projects');
      expect(result).toContain('-users-testuser-workspace');
      expect(result).toBe(
        '/Users/testuser/.claude/projects/-users-testuser-workspace'
      );
    });

    it('should handle different user home directories', () => {
      // Arrange
      (os.homedir as jest.Mock).mockReturnValue('C:\\Users\\DifferentUser');
      const workspacePath = 'D:\\projects\\app';

      // Act
      const result = WorkspacePathEncoder.getSessionsDirectory(workspacePath);

      // Assert
      expect(result).toContain('DifferentUser');
      expect(result).toBe(
        'C:\\Users\\DifferentUser\\.claude\\projects\\d--projects-app'
      );
    });

    it('should create consistent path for same workspace', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const result1 = WorkspacePathEncoder.getSessionsDirectory(workspacePath);
      const result2 = WorkspacePathEncoder.getSessionsDirectory(workspacePath);

      // Assert
      expect(result1).toBe(result2);
    });
  });

  describe('Integration: Encoding Algorithm', () => {
    it('should follow Claude CLI encoding algorithm exactly', () => {
      // Test Case 1: Windows path (from research-report.md:54-62)
      // D:\projects\ptah-extension → d--projects-ptah-extension
      expect(
        WorkspacePathEncoder.encodeWorkspacePath('D:\\projects\\ptah-extension')
      ).toBe('d--projects-ptah-extension');

      // Test Case 2: Linux path
      // /home/user/project → -home-user-project
      expect(
        WorkspacePathEncoder.encodeWorkspacePath('/home/user/project')
      ).toBe('-home-user-project');

      // Test Case 3: macOS path
      // /Users/agent/app → -users-agent-app
      expect(WorkspacePathEncoder.encodeWorkspacePath('/Users/agent/app')).toBe(
        '-users-agent-app'
      );
    });

    it('should produce actual directory name used by Claude CLI', () => {
      // Arrange: Real workspace path
      const realWorkspace = 'D:\\projects\\ptah-extension';
      (os.homedir as jest.Mock).mockReturnValue('C:\\Users\\abdal');

      // Act
      const sessionsDir =
        WorkspacePathEncoder.getSessionsDirectory(realWorkspace);

      // Assert: Match actual Claude CLI directory structure
      expect(sessionsDir).toBe(
        'C:\\Users\\abdal\\.claude\\projects\\d--projects-ptah-extension'
      );
    });
  });

  describe('Performance', () => {
    it('should encode path in under 1ms', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const startTime = performance.now();
      WorkspacePathEncoder.encodeWorkspacePath(workspacePath);
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(1); // < 1ms requirement
    });

    it('should get sessions directory in under 1ms', () => {
      // Arrange
      const workspacePath = 'D:\\projects\\ptah-extension';

      // Act
      const startTime = performance.now();
      WorkspacePathEncoder.getSessionsDirectory(workspacePath);
      const duration = performance.now() - startTime;

      // Assert
      expect(duration).toBeLessThan(1); // < 1ms requirement
    });
  });
});
