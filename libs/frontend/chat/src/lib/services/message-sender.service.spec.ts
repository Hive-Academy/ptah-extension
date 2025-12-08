/**
 * MessageSenderService Unit Tests
 *
 * Tests for the centralized message sending mediator service.
 * Validates routing logic, state management, and error handling.
 */

import { TestBed } from '@angular/core/testing';
import { MessageSenderService } from './message-sender.service';
import { ClaudeRpcService, VSCodeService } from '@ptah-extension/core';
import { TabManagerService } from './tab-manager.service';
import { SessionManager } from './session-manager.service';
import { PendingSessionManagerService } from './pending-session-manager.service';
import { SessionLoaderService } from './chat-store/session-loader.service';
import { SessionId } from '@ptah-extension/shared';

describe('MessageSenderService', () => {
  let service: MessageSenderService;
  let mockClaudeRpc: jest.Mocked<Partial<ClaudeRpcService>>;
  let mockVSCodeService: jest.Mocked<Partial<VSCodeService>>;
  let mockTabManager: jest.Mocked<Partial<TabManagerService>>;
  let mockSessionManager: jest.Mocked<Partial<SessionManager>>;
  let mockPendingSessionManager: jest.Mocked<Partial<PendingSessionManagerService>>;
  let mockSessionLoader: jest.Mocked<Partial<SessionLoaderService>>;

  beforeEach(() => {
    // Create mock services
    mockClaudeRpc = {
      call: jest.fn(),
    };

    mockVSCodeService = {
      config: jest.fn().mockReturnValue({
        workspaceRoot: '/test/workspace',
      }),
    };

    mockTabManager = {
      activeTab: jest.fn(),
      activeTabId: jest.fn(),
      createTab: jest.fn(),
      switchTab: jest.fn(),
      updateTab: jest.fn(),
      tabs: jest.fn().mockReturnValue([]),
    };

    mockSessionManager = {
      setSessionId: jest.fn(),
      getCurrentSessionId: jest.fn(),
      clearClaudeSessionId: jest.fn(),
      setStatus: jest.fn(),
      clearNodeMaps: jest.fn(),
      failSession: jest.fn(),
    };

    mockPendingSessionManager = {
      add: jest.fn(),
      remove: jest.fn(),
    };

    mockSessionLoader = {
      loadSessions: jest.fn(),
    };

    TestBed.configureTestingModule({
      providers: [
        MessageSenderService,
        { provide: ClaudeRpcService, useValue: mockClaudeRpc },
        { provide: VSCodeService, useValue: mockVSCodeService },
        { provide: TabManagerService, useValue: mockTabManager },
        { provide: SessionManager, useValue: mockSessionManager },
        {
          provide: PendingSessionManagerService,
          useValue: mockPendingSessionManager,
        },
        { provide: SessionLoaderService, useValue: mockSessionLoader },
      ],
    });

    service = TestBed.inject(MessageSenderService);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });

  describe('send()', () => {
    it('should route to continueConversation when active tab has existing session', async () => {
      // Arrange
      const mockTab = {
        id: 'tab1',
        claudeSessionId: 'session123' as SessionId,
        status: 'loaded' as const,
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      (mockTabManager.activeTabId as jest.Mock) = jest.fn().mockReturnValue('tab1');
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
        data: { sessionId: 'session123' },
      });

      // Act
      await service.send('Test message');

      // Assert
      expect(mockClaudeRpc.call).toHaveBeenCalledWith(
        'chat:continue',
        expect.any(Object)
      );
    });

    it('should route to startNewConversation when active tab has no session', async () => {
      // Arrange
      const mockTab = {
        id: 'tab1',
        claudeSessionId: null,
        status: 'loaded' as const,
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      (mockTabManager.activeTabId as jest.Mock) = jest.fn().mockReturnValue('tab1');
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
        data: { sessionId: 'newSession' },
      });
      (mockSessionLoader.loadSessions as jest.Mock) = jest.fn().mockResolvedValue(undefined);

      // Act
      await service.send('Test message');

      // Assert
      expect(mockClaudeRpc.call).toHaveBeenCalledWith(
        'chat:start',
        expect.any(Object)
      );
    });

    it('should warn and return early when no active tab', async () => {
      // Arrange
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(null);
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation();

      // Act
      await service.send('Test message');

      // Assert
      expect(consoleWarnSpy).toHaveBeenCalledWith('[MessageSender] No active tab');
      expect(mockClaudeRpc.call).not.toHaveBeenCalled();

      consoleWarnSpy.mockRestore();
    });
  });

  describe('sendOrQueue()', () => {
    it('should log queue message when streaming', async () => {
      // Arrange
      const mockTab = {
        id: 'tab1',
        status: 'streaming' as const,
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      const consoleLogSpy = jest.spyOn(console, 'log').mockImplementation();

      // Act
      await service.sendOrQueue('Test message');

      // Assert
      expect(consoleLogSpy).toHaveBeenCalledWith(
        '[MessageSender] Streaming active, message will be queued'
      );
      expect(mockClaudeRpc.call).not.toHaveBeenCalled();

      consoleLogSpy.mockRestore();
    });

    it('should send immediately when not streaming', async () => {
      // Arrange
      const mockTab = {
        id: 'tab1',
        claudeSessionId: 'session123' as SessionId,
        status: 'loaded' as const,
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      (mockTabManager.activeTabId as jest.Mock) = jest.fn().mockReturnValue('tab1');
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
        data: { sessionId: 'session123' },
      });

      // Act
      await service.sendOrQueue('Test message');

      // Assert
      expect(mockClaudeRpc.call).toHaveBeenCalledWith(
        'chat:continue',
        expect.any(Object)
      );
    });
  });

  describe('startNewConversation()', () => {
    beforeEach(() => {
      // Common setup for new conversation tests
      (mockTabManager.activeTabId as jest.Mock) = jest.fn().mockReturnValue('tab1');
      const mockTab = {
        id: 'tab1',
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      (mockSessionLoader.loadSessions as jest.Mock) = jest.fn().mockResolvedValue(undefined);
    });

    it('should create new session and call chat:start RPC', async () => {
      // Arrange
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
        data: { sessionId: 'newSession' },
      });

      // Act
      await service.send('Test message');

      // Assert
      expect(mockSessionManager.setSessionId).toHaveBeenCalledWith(
        expect.any(String),
        'draft'
      );
      expect(mockPendingSessionManager.add).toHaveBeenCalledWith(
        expect.any(String),
        'tab1'
      );
      expect(mockClaudeRpc.call).toHaveBeenCalledWith(
        'chat:start',
        expect.objectContaining({
          prompt: 'Test message',
          workspacePath: '/test/workspace',
        })
      );
    });

    it('should cleanup pending resolution on RPC failure', async () => {
      // Arrange
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: false,
        error: 'RPC failed',
      });
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();

      // Act
      await service.send('Test message');

      // Assert
      expect(mockPendingSessionManager.remove).toHaveBeenCalledWith(
        expect.any(String)
      );
      expect(mockSessionManager.failSession).toHaveBeenCalled();
      expect(consoleErrorSpy).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });

    it('should cleanup pending resolution on exception', async () => {
      // Arrange
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockRejectedValue(new Error('Network error'));
      (mockSessionManager.getCurrentSessionId as jest.Mock) = jest.fn().mockReturnValue('placeholder123');
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();

      // Act
      try {
        await service.send('Test message');
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
      } catch (_error) {
        // Expected to throw
      }

      // Assert
      expect(mockPendingSessionManager.remove).toHaveBeenCalledWith(
        'placeholder123'
      );
      expect(mockSessionManager.failSession).toHaveBeenCalled();

      consoleErrorSpy.mockRestore();
    });
  });

  describe('continueConversation()', () => {
    beforeEach(() => {
      // Common setup for continue conversation tests
      const mockTab = {
        id: 'tab1',
        claudeSessionId: 'session123' as SessionId,
        status: 'loaded' as const,
        messages: [],
      };
      (mockTabManager.activeTab as jest.Mock) = jest.fn().mockReturnValue(mockTab);
      (mockTabManager.activeTabId as jest.Mock) = jest.fn().mockReturnValue('tab1');
    });

    it('should call chat:continue RPC with existing session ID', async () => {
      // Arrange
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: true,
        data: { sessionId: 'session123' },
      });

      // Act
      await service.send('Test message');

      // Assert
      expect(mockClaudeRpc.call).toHaveBeenCalledWith(
        'chat:continue',
        expect.objectContaining({
          prompt: 'Test message',
          sessionId: 'session123',
          workspacePath: '/test/workspace',
        })
      );
      expect(mockSessionManager.setStatus).toHaveBeenCalledWith('resuming');
      expect(mockSessionManager.setStatus).toHaveBeenCalledWith('streaming');
    });

    it('should reset status on RPC failure', async () => {
      // Arrange
      (mockClaudeRpc.call as jest.Mock) = jest.fn().mockResolvedValue({
        success: false,
        error: 'RPC failed',
      });
      const consoleErrorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation();

      // Act
      await service.send('Test message');

      // Assert
      expect(mockSessionManager.setStatus).toHaveBeenCalledWith('loaded');
      expect(mockTabManager.updateTab).toHaveBeenCalledWith('tab1', {
        status: 'loaded',
      });

      consoleErrorSpy.mockRestore();
    });
  });
});
