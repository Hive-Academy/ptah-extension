/**
 * SessionLifecycleManager Tests — Workspace Resolution & Session Ordering
 *
 * Tests the workspace resolution and active session ordering logic
 * added to fix multi-session agent attribution and workspace inheritance.
 */

import 'reflect-metadata';
import { SessionLifecycleManager } from './session-lifecycle-manager';
import { SessionId, AISessionConfig } from '@ptah-extension/shared';

// Minimal mock factories
function createMockLogger() {
  return {
    debug: jest.fn(),
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
  };
}

function createMockPermissionHandler() {
  return {
    requestPermission: jest.fn(),
    handlePermissionResponse: jest.fn(),
    cleanupPendingPermissions: jest.fn(),
  };
}

function createMockModuleLoader() {
  return {
    getModule: jest.fn(),
    isLoaded: jest.fn().mockReturnValue(true),
  };
}

function createMockQueryOptionsBuilder() {
  return {
    build: jest.fn(),
  };
}

function createMockMessageFactory() {
  return {
    createUserMessage: jest.fn(),
  };
}

function createMockSubagentRegistry() {
  return {
    markInterrupted: jest.fn(),
    markAllInterrupted: jest.fn(),
    getSubagents: jest.fn().mockReturnValue([]),
    getRunningSubagents: jest.fn().mockReturnValue([]),
  };
}

function createSessionConfig(
  overrides: Partial<AISessionConfig> = {},
): AISessionConfig {
  return {
    model: 'claude-sonnet-4-20250514',
    projectPath: '/test/workspace',
    ...overrides,
  } as AISessionConfig;
}

describe('SessionLifecycleManager', () => {
  let manager: SessionLifecycleManager;

  beforeEach(() => {
    // Construct directly with mock dependencies (bypassing DI)
    manager = new (SessionLifecycleManager as any)(
      createMockLogger(),
      createMockPermissionHandler(),
      createMockModuleLoader(),
      createMockQueryOptionsBuilder(),
      createMockMessageFactory(),
      createMockSubagentRegistry(),
    );
  });

  describe('getActiveSessionIds', () => {
    it('should return empty array when no sessions are registered', () => {
      expect(manager.getActiveSessionIds()).toEqual([]);
    });

    it('should return single session ID', () => {
      const config = createSessionConfig();
      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config,
        new AbortController(),
      );

      const ids = manager.getActiveSessionIds();
      expect(ids).toHaveLength(1);
      // Before resolution, returns the tab ID
      expect(ids[0]).toBe('tab_1');
    });

    it('should return real UUID after resolveRealSessionId', () => {
      const config = createSessionConfig();
      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config,
        new AbortController(),
      );
      manager.resolveRealSessionId('tab_1', 'real-uuid-123');

      const ids = manager.getActiveSessionIds();
      expect(ids[0]).toBe('real-uuid-123');
    });

    it('should return most recently active session first with 2 sessions', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      // tab_2 was registered last, so it should be first
      const ids = manager.getActiveSessionIds();
      expect(ids[0]).toBe('tab_2');
    });

    it('should default to registration order (last registered is most recent)', async () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      const ids = manager.getActiveSessionIds();
      // tab_2 was registered last, so it should be first
      expect(ids[0]).toBe('tab_2');
    });
  });

  describe('getActiveSessionWorkspace', () => {
    it('should return undefined when no sessions exist', () => {
      expect(manager.getActiveSessionWorkspace()).toBeUndefined();
    });

    it('should return workspace of the most recently active session', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      // tab_2 was registered last → it's the most recently active
      expect(manager.getActiveSessionWorkspace()).toBe('/workspace/b');
    });

    it('should fall back to any session when last active has no projectPath', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: undefined });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      // tab_2 is last active but has no projectPath → should fall back to tab_1
      expect(manager.getActiveSessionWorkspace()).toBe('/workspace/a');
    });

    it('should return undefined when no session has a projectPath', () => {
      const config = createSessionConfig({ projectPath: undefined });
      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config,
        new AbortController(),
      );

      expect(manager.getActiveSessionWorkspace()).toBeUndefined();
    });
  });

  describe('endSession cleanup', () => {
    it('should clear _lastActiveTabId and fall back to remaining session', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      // End tab_2 (the most recently active)
      manager.endSession('tab_2' as SessionId);

      // Should fall back to tab_1
      expect(manager.getActiveSessionWorkspace()).toBe('/workspace/a');
      expect(manager.getActiveSessionIds()).toEqual(['tab_1']);
    });

    it('should clear workspace when all sessions end', () => {
      const config = createSessionConfig({ projectPath: '/workspace/a' });
      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config,
        new AbortController(),
      );

      manager.endSession('tab_1' as SessionId);

      expect(manager.getActiveSessionWorkspace()).toBeUndefined();
      expect(manager.getActiveSessionIds()).toEqual([]);
    });

    it('should not affect ordering when a non-active session ends', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      // End tab_1 (not the most recently active)
      manager.endSession('tab_1' as SessionId);

      // tab_2 should still be active and first
      expect(manager.getActiveSessionWorkspace()).toBe('/workspace/b');
    });
  });

  describe('resolveRealSessionId', () => {
    it('should not affect workspace resolution', () => {
      const config = createSessionConfig({ projectPath: '/workspace/a' });
      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config,
        new AbortController(),
      );
      manager.resolveRealSessionId('tab_1', 'real-uuid-123');

      // Workspace should still be accessible through the tab-keyed session
      expect(manager.getActiveSessionWorkspace()).toBe('/workspace/a');
    });

    it('should replace tab IDs with real UUIDs in getActiveSessionIds', () => {
      const config1 = createSessionConfig({ projectPath: '/workspace/a' });
      const config2 = createSessionConfig({ projectPath: '/workspace/b' });

      manager.preRegisterActiveSession(
        'tab_1' as SessionId,
        config1,
        new AbortController(),
      );
      manager.preRegisterActiveSession(
        'tab_2' as SessionId,
        config2,
        new AbortController(),
      );

      manager.resolveRealSessionId('tab_1', 'uuid-aaa');
      manager.resolveRealSessionId('tab_2', 'uuid-bbb');

      const ids = manager.getActiveSessionIds();
      // tab_2 is most recent → uuid-bbb should be first
      expect(ids[0]).toBe('uuid-bbb');
      expect(ids[1]).toBe('uuid-aaa');
    });
  });
});
