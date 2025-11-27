/**
 * ClaudeProcess unit tests
 *
 * Tests cross-platform spawn behavior
 */

import * as os from 'os';
import { ClaudeProcess } from './claude-process';

// Mock os.platform() for cross-platform testing
jest.mock('os', () => ({
  ...jest.requireActual('os'),
  platform: jest.fn(),
}));

const mockPlatform = os.platform as jest.MockedFunction<typeof os.platform>;

describe('ClaudeProcess', () => {
  describe('needsShellExecution (private method via reflection)', () => {
    const testShellExecution = (
      cliPath: string,
      platform: NodeJS.Platform
    ): boolean => {
      mockPlatform.mockReturnValue(platform);
      const process = new ClaudeProcess(cliPath, '/workspace');
      // Access private method via reflection
      return (
        process as unknown as { needsShellExecution(): boolean }
      ).needsShellExecution();
    };

    describe('on Windows (win32)', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('win32');
      });

      it('should return true for PATH command "claude"', () => {
        expect(testShellExecution('claude', 'win32')).toBe(true);
      });

      it('should return true for .cmd files', () => {
        expect(testShellExecution('C:\\npm\\claude.cmd', 'win32')).toBe(true);
      });

      it('should return true for .bat files', () => {
        expect(testShellExecution('C:\\scripts\\run.bat', 'win32')).toBe(true);
      });

      it('should return false for full path .exe files', () => {
        expect(
          testShellExecution('C:\\Program Files\\Claude\\claude.exe', 'win32')
        ).toBe(false);
      });

      it('should return true for relative paths (may resolve to .cmd)', () => {
        expect(testShellExecution('./claude', 'win32')).toBe(true);
      });

      it('should return true for paths without extension', () => {
        expect(testShellExecution('C:\\tools\\claude', 'win32')).toBe(true);
      });
    });

    describe('on macOS (darwin)', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('darwin');
      });

      it('should return false for PATH command "claude"', () => {
        expect(testShellExecution('claude', 'darwin')).toBe(false);
      });

      it('should return false for full path executables', () => {
        expect(testShellExecution('/usr/local/bin/claude', 'darwin')).toBe(
          false
        );
      });

      it('should return false for home directory executables', () => {
        expect(
          testShellExecution('/Users/user/.local/bin/claude', 'darwin')
        ).toBe(false);
      });
    });

    describe('on Linux (linux)', () => {
      beforeEach(() => {
        mockPlatform.mockReturnValue('linux');
      });

      it('should return false for PATH command "claude"', () => {
        expect(testShellExecution('claude', 'linux')).toBe(false);
      });

      it('should return false for full path executables', () => {
        expect(testShellExecution('/usr/local/bin/claude', 'linux')).toBe(
          false
        );
      });

      it('should return false for WSL paths', () => {
        expect(
          testShellExecution(
            '/mnt/c/Users/user/AppData/Local/Claude/claude',
            'linux'
          )
        ).toBe(false);
      });
    });
  });

  describe('constructor', () => {
    it('should store cliPath and workspacePath', () => {
      const process = new ClaudeProcess(
        '/usr/bin/claude',
        '/workspace/project'
      );
      expect(process).toBeDefined();
    });
  });

  describe('isRunning', () => {
    it('should return false when no process is started', () => {
      const process = new ClaudeProcess('claude', '/workspace');
      expect(process.isRunning()).toBe(false);
    });
  });

  describe('kill', () => {
    it('should not throw when no process is running', () => {
      const process = new ClaudeProcess('claude', '/workspace');
      expect(() => process.kill()).not.toThrow();
    });
  });
});
