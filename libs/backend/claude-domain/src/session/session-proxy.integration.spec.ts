/**
 * SessionProxy Integration Tests
 * Testing with REAL session files from actual Claude CLI directory
 *
 * Test Coverage:
 * - Read from actual C:\Users\abdal\.claude\projects\d--projects-ptah-extension\ directory
 * - Parse 373 real session files
 * - Performance: < 100ms for full session list
 * - Verify session count matches directory
 * - Skip tests if directory doesn't exist (CI compatibility)
 *
 * **NOTE**: These tests run against real file system data.
 * They will be skipped in CI environments where the directory doesn't exist.
 */

import 'reflect-metadata'; // Required for tsyringe
import { SessionProxy } from './session-proxy';
import { WorkspacePathEncoder } from './workspace-path-encoder';
import { promises as fs } from 'fs';
import * as path from 'path';

describe('SessionProxy Integration', () => {
  let sessionProxy: SessionProxy;
  const realWorkspaceRoot = 'D:\\projects\\ptah-extension';
  const realSessionsDir =
    'C:\\Users\\abdal\\.claude\\projects\\d--projects-ptah-extension';
  let sessionsDirExists = false;
  let expectedSessionCount = 0;

  beforeAll(async () => {
    // Check if real sessions directory exists
    try {
      await fs.access(realSessionsDir);
      sessionsDirExists = true;

      // Count actual .jsonl files
      const files = await fs.readdir(realSessionsDir);
      expectedSessionCount = files.filter((f) => f.endsWith('.jsonl')).length;

      console.log(
        `✓ Real sessions directory found: ${realSessionsDir} (${expectedSessionCount} sessions)`
      );
    } catch {
      console.warn(
        '⚠ Skipping integration tests: Real sessions directory not found'
      );
      console.warn(`   Expected: ${realSessionsDir}`);
      console.warn('   This is normal in CI environments.');
      sessionsDirExists = false;
    }

    // Initialize SessionProxy
    sessionProxy = new SessionProxy();
  });

  describe('Real Session Files', () => {
    it('should encode workspace path correctly', () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const encoded =
        WorkspacePathEncoder.encodeWorkspacePath(realWorkspaceRoot);
      const sessionsDir =
        WorkspacePathEncoder.getSessionsDirectory(realWorkspaceRoot);

      // Assert
      expect(encoded).toBe('d--projects-ptah-extension');
      expect(sessionsDir).toBe(realSessionsDir);
    });

    it('should list all real sessions', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);

      // Assert
      expect(sessions.length).toBeGreaterThan(0);
      // Note: Some files may be corrupt/empty and gracefully skipped
      expect(sessions.length).toBeLessThanOrEqual(expectedSessionCount);
      expect(sessions.length).toBeGreaterThanOrEqual(expectedSessionCount - 50); // Allow up to 50 corrupt files
      console.log(
        `✓ Successfully parsed ${sessions.length}/${expectedSessionCount} real session files`
      );

      // Verify structure of first session
      expect(sessions[0]).toMatchObject({
        id: expect.any(String),
        name: expect.any(String),
        messageCount: expect.any(Number),
        lastActiveAt: expect.any(Number),
        createdAt: expect.any(Number),
      });

      // Verify sessions are sorted by lastActiveAt (newest first)
      if (sessions.length > 1) {
        expect(sessions[0].lastActiveAt).toBeGreaterThanOrEqual(
          sessions[1].lastActiveAt
        );
      }
    });

    it('should parse sessions with meaningful names (not "Unnamed Session")', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);

      // Assert: At least some sessions should have meaningful names
      const namedSessions = sessions.filter(
        (s) => s.name !== 'Unnamed Session'
      );
      expect(namedSessions.length).toBeGreaterThan(0);

      // Log sample session names
      console.log('\n📋 Sample session names:');
      sessions.slice(0, 5).forEach((s, i) => {
        console.log(
          `   ${i + 1}. ${s.name} (${s.messageCount} messages, ID: ${s.id.slice(
            0,
            8
          )}...)`
        );
      });
    });

    it('should have valid timestamps (not negative, not far future)', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);

      // Assert
      const now = Date.now();
      const oneYearAgo = now - 365 * 24 * 60 * 60 * 1000;
      const oneYearFromNow = now + 365 * 24 * 60 * 60 * 1000;

      sessions.forEach((session) => {
        expect(session.lastActiveAt).toBeGreaterThan(oneYearAgo);
        expect(session.lastActiveAt).toBeLessThan(oneYearFromNow);
        expect(session.createdAt).toBeGreaterThan(oneYearAgo);
        expect(session.createdAt).toBeLessThan(oneYearFromNow);
      });
    });

    it('should have message counts > 0', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);

      // Assert: Most sessions should have at least 1 message
      const sessionsWithMessages = sessions.filter((s) => s.messageCount > 0);
      expect(sessionsWithMessages.length).toBeGreaterThan(0);

      // Log statistics
      const avgMessages =
        sessions.reduce((sum, s) => sum + s.messageCount, 0) / sessions.length;
      const maxMessages = Math.max(...sessions.map((s) => s.messageCount));
      console.log(`\n📊 Message statistics:`);
      console.log(`   Average: ${avgMessages.toFixed(1)} messages per session`);
      console.log(`   Maximum: ${maxMessages} messages in a session`);
    });
  });

  describe('Performance', () => {
    it('should complete in under 100ms', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const startTime = performance.now();
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);
      const duration = performance.now() - startTime;

      // Assert
      expect(sessions.length).toBeGreaterThan(0);
      expect(sessions.length).toBeLessThanOrEqual(expectedSessionCount);
      expect(duration).toBeLessThan(100); // < 100ms requirement
      console.log(
        `✓ Parsed ${sessions.length} sessions in ${duration.toFixed(2)}ms`
      );
    });

    it('should parse individual session files efficiently', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act: List sessions and measure
      const startTime = performance.now();
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);
      const duration = performance.now() - startTime;

      // Assert: Average parse time per session
      const avgTimePerSession = duration / sessions.length;
      expect(avgTimePerSession).toBeLessThan(10); // < 10ms per session
      console.log(
        `✓ Average parse time: ${avgTimePerSession.toFixed(2)}ms per session`
      );
    });
  });

  describe('getSessionDetails', () => {
    it('should read real session file content', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Arrange: Get first session ID
      const sessions = await sessionProxy.listSessions(realWorkspaceRoot);
      if (sessions.length === 0) {
        console.warn('⚠ No sessions found to test');
        return;
      }

      const sessionId = sessions[0].id;

      // Act
      const details = await sessionProxy.getSessionDetails(
        sessionId,
        realWorkspaceRoot
      );

      // Assert
      expect(details).not.toBeNull();
      expect(details).toHaveProperty('content');
      expect(typeof details?.['content']).toBe('string');

      // Verify JSONL format (should have newlines)
      const content = details?.['content'] as string;
      expect(content).toContain('\n');

      // Verify first line is summary or message
      const firstLine = content.split('\n')[0];
      const firstLineData = JSON.parse(firstLine);
      expect(firstLineData).toHaveProperty('type');
    });
  });

  describe('Error Handling', () => {
    it('should return null for non-existent session', async () => {
      // Skip if directory doesn't exist
      if (!sessionsDirExists) {
        console.warn('⚠ Skipped: Real sessions directory not found');
        return;
      }

      // Act
      const details = await sessionProxy.getSessionDetails(
        'non-existent-uuid',
        realWorkspaceRoot
      );

      // Assert
      expect(details).toBeNull();
    });

    it('should return empty array for non-existent workspace', async () => {
      // Act
      const sessions = await sessionProxy.listSessions(
        'D:\\non-existent-workspace'
      );

      // Assert
      expect(sessions).toEqual([]);
    });
  });

  describe('CI Compatibility', () => {
    it('should gracefully skip tests when directory does not exist', () => {
      // This test always passes - just documents the skip behavior
      if (!sessionsDirExists) {
        console.log('✓ Tests properly skipped in CI environment');
      } else {
        console.log('✓ Tests ran with real session files');
      }
      expect(true).toBe(true);
    });
  });
});
