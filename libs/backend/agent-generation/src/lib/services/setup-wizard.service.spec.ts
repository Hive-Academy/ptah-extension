/**
 * Setup Wizard Service Tests
 *
 * Comprehensive test suite for SetupWizardService covering:
 * - Webview creation and lifecycle
 * - Wizard step transitions (all 6 steps)
 * - Session state tracking
 * - Cancellation and resume workflows
 * - RPC message handling (mocked)
 * - Error cases and edge conditions
 *
 * @module @ptah-extension/agent-generation/services/tests
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import { SetupWizardService } from './setup-wizard.service';
import { WebviewManager } from '@ptah-extension/vscode-core';
import { Logger } from '@ptah-extension/vscode-core';
import { WizardState } from '../types/wizard.types';

// Mock dependencies
jest.mock('@ptah-extension/vscode-core');

describe('SetupWizardService', () => {
  let service: SetupWizardService;
  let mockWebviewManager: jest.Mocked<WebviewManager>;
  let mockContext: jest.Mocked<vscode.ExtensionContext>;
  let mockLogger: jest.Mocked<Logger>;
  let mockWorkspaceState: Map<string, unknown>;

  beforeEach(() => {
    // Create mock webview manager
    mockWebviewManager = {
      createWebviewPanel: jest.fn(),
      getWebviewPanel: jest.fn(),
      disposeWebview: jest.fn(),
      sendMessage: jest.fn(),
    } as unknown as jest.Mocked<WebviewManager>;

    // Create mock workspace state
    mockWorkspaceState = new Map<string, unknown>();

    // Create mock extension context
    mockContext = {
      workspaceState: {
        get: jest.fn((key: string) => mockWorkspaceState.get(key)),
        update: jest.fn((key: string, value: unknown) => {
          mockWorkspaceState.set(key, value);
          return Promise.resolve();
        }),
      },
    } as unknown as jest.Mocked<vscode.ExtensionContext>;

    // Create mock logger
    mockLogger = {
      debug: jest.fn(),
      info: jest.fn(),
      warn: jest.fn(),
      error: jest.fn(),
    } as unknown as jest.Mocked<Logger>;

    // Create service instance
    service = new SetupWizardService(
      mockWebviewManager,
      mockContext,
      mockLogger
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
    mockWorkspaceState.clear();
  });

  describe('launchWizard', () => {
    const workspaceUri = {
      fsPath: '/test/workspace',
    } as vscode.Uri;

    it('should create webview panel and initialize wizard session', async () => {
      // Arrange
      const mockPanel = {} as vscode.WebviewPanel;
      mockWebviewManager.createWebviewPanel.mockReturnValue(mockPanel);

      // Act
      const result = await service.launchWizard(workspaceUri);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockWebviewManager.createWebviewPanel).toHaveBeenCalledWith({
        viewType: 'ptah.setupWizard',
        title: 'Ptah Setup Wizard',
        showOptions: {
          viewColumn: 1,
          preserveFocus: false,
        },
        options: {
          enableScripts: true,
          retainContextWhenHidden: true,
        },
      });

      // Verify session created
      const session = service.getCurrentSession();
      expect(session).toBeDefined();
      expect(session?.workspaceRoot).toBe('/test/workspace');
      expect(session?.currentStep).toBe('welcome');
    });

    it('should reveal existing wizard panel if already active for same workspace', async () => {
      // Arrange
      const mockPanel = {
        reveal: jest.fn(),
      } as unknown as vscode.WebviewPanel;
      mockWebviewManager.createWebviewPanel.mockReturnValue(mockPanel);
      mockWebviewManager.getWebviewPanel.mockReturnValue(mockPanel);

      // Launch wizard first time
      await service.launchWizard(workspaceUri);

      // Act - Launch again for same workspace
      const result = await service.launchWizard(workspaceUri);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockPanel.reveal).toHaveBeenCalled();
      expect(mockWebviewManager.createWebviewPanel).toHaveBeenCalledTimes(1); // Only called once
    });

    it('should return error if webview creation fails', async () => {
      // Arrange
      mockWebviewManager.createWebviewPanel.mockImplementation(() => {
        throw new Error('Webview creation failed');
      });

      // Act
      const result = await service.launchWizard(workspaceUri);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Wizard launch failed');
      expect(mockLogger.error).toHaveBeenCalled();
    });
  });

  describe('handleStep Transition', () => {
    const workspaceUri = { fsPath: '/test/workspace' } as vscode.Uri;

    beforeEach(async () => {
      // Set up active wizard session
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );
      await service.launchWizard(workspaceUri);
    });

    it('should transition from welcome to scan', async () => {
      // Arrange
      const session = service.getCurrentSession()!;

      // Act
      const result = await service.handleStepTransition(
        session.id,
        'welcome',
        {}
      );

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('scan');
      expect(service.getCurrentSession()?.currentStep).toBe('scan');
    });

    it('should transition from scan to review with project context', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      // Manually set step to scan
      await service.handleStepTransition(session.id, 'welcome', {});

      const projectContext = {
        projectType: 'Node.js',
        frameworks: ['Express', 'NestJS'],
        techStack: ['TypeScript'],
      };

      // Act
      const result = await service.handleStepTransition(session.id, 'scan', {
        projectContext,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('review');
      expect(service.getCurrentSession()?.projectContext).toEqual(
        projectContext
      );
    });

    it('should transition from review to select', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      await service.handleStepTransition(session.id, 'welcome', {});
      await service.handleStepTransition(session.id, 'scan', {});

      // Act
      const result = await service.handleStepTransition(session.id, 'review', {
        confirmed: true,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('select');
    });

    it('should transition from select to generate with agent selection', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      await service.handleStepTransition(session.id, 'welcome', {});
      await service.handleStepTransition(session.id, 'scan', {});
      await service.handleStepTransition(session.id, 'review', {});

      const selectedAgentIds = ['backend-developer', 'frontend-developer'];

      // Act
      const result = await service.handleStepTransition(session.id, 'select', {
        selectedAgentIds,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('generate');
      expect(service.getCurrentSession()?.selectedAgentIds).toEqual(
        selectedAgentIds
      );
    });

    it('should transition from generate to complete with generation summary', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      await service.handleStepTransition(session.id, 'welcome', {});
      await service.handleStepTransition(session.id, 'scan', {});
      await service.handleStepTransition(session.id, 'review', {});
      await service.handleStepTransition(session.id, 'select', {
        selectedAgentIds: ['backend-developer'],
      });

      const generationSummary = {
        totalAgents: 1,
        successful: 1,
        failed: 0,
        durationMs: 5000,
        warnings: [],
      };

      // Act
      const result = await service.handleStepTransition(
        session.id,
        'generate',
        { generationSummary }
      );

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value).toBe('complete');
      expect(service.getCurrentSession()?.generationSummary).toEqual(
        generationSummary
      );
    });

    it('should return error for invalid session ID', async () => {
      // Act
      const result = await service.handleStepTransition(
        'invalid-session-id',
        'welcome',
        {}
      );

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Invalid or expired');
    });

    it('should return error for step mismatch', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      // Session is on 'welcome', but we try to transition from 'scan'

      // Act
      const result = await service.handleStepTransition(session.id, 'scan', {});

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Step mismatch');
    });
  });

  describe('cancelWizard', () => {
    const workspaceUri = { fsPath: '/test/workspace' } as vscode.Uri;

    beforeEach(async () => {
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );
      await service.launchWizard(workspaceUri);
    });

    it('should cancel wizard and dispose webview', async () => {
      // Arrange
      const session = service.getCurrentSession()!;

      // Act
      const result = await service.cancelWizard(session.id, false);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockWebviewManager.disposeWebview).toHaveBeenCalledWith(
        'ptah.setupWizard'
      );
      expect(service.getCurrentSession()).toBeNull();
    });

    it('should save session state when saveProgress is true', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      await service.handleStepTransition(session.id, 'welcome', {});
      await service.handleStepTransition(session.id, 'scan', {
        projectContext: {
          projectType: 'Node.js',
          frameworks: ['Express'],
          techStack: ['TypeScript'],
        },
      });

      // Act
      const result = await service.cancelWizard(session.id, true);

      // Assert
      expect(result.isOk()).toBe(true);
      expect(mockContext.workspaceState.update).toHaveBeenCalledWith(
        'wizard-session-state',
        expect.objectContaining({
          sessionId: session.id,
          currentStep: 'review',
          workspaceRoot: '/test/workspace',
        })
      );
    });

    it('should return error for invalid session ID', async () => {
      // Act
      const result = await service.cancelWizard('invalid-session-id', false);

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Invalid or expired');
    });
  });

  describe('resumeWizard', () => {
    const workspaceRoot = '/test/workspace';

    it('should resume wizard from saved state', async () => {
      // Arrange
      const savedState: WizardState = {
        sessionId: 'test-session-123',
        currentStep: 'review',
        workspaceRoot,
        lastActivity: new Date(),
        projectContext: {
          projectType: 'Node.js',
          frameworks: ['Express'],
          techStack: ['TypeScript'],
        },
        selectedAgentIds: undefined,
      };
      mockWorkspaceState.set('wizard-session-state', savedState);
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );

      // Act
      const result = await service.resumeWizard({
        sessionId: 'test-session-123',
        workspaceRoot,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(result.value?.id).toBe('test-session-123');
      expect(result.value?.currentStep).toBe('review');
      expect(result.value?.projectContext).toEqual(savedState.projectContext);
      expect(mockWebviewManager.createWebviewPanel).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'Ptah Setup Wizard (Resumed)',
        })
      );
    });

    it('should return error if no saved state found', async () => {
      // Act
      const result = await service.resumeWizard({
        sessionId: 'test-session-123',
        workspaceRoot,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('No saved wizard session');
    });

    it('should return error if session ID mismatch', async () => {
      // Arrange
      const savedState: WizardState = {
        sessionId: 'different-session-id',
        currentStep: 'review',
        workspaceRoot,
        lastActivity: new Date(),
      };
      mockWorkspaceState.set('wizard-session-state', savedState);

      // Act
      const result = await service.resumeWizard({
        sessionId: 'test-session-123',
        workspaceRoot,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Session ID mismatch');
    });

    it('should return error if session expired (>24 hours)', async () => {
      // Arrange
      const expiredDate = new Date();
      expiredDate.setHours(expiredDate.getHours() - 25); // 25 hours ago

      const savedState: WizardState = {
        sessionId: 'test-session-123',
        currentStep: 'review',
        workspaceRoot,
        lastActivity: expiredDate,
      };
      mockWorkspaceState.set('wizard-session-state', savedState);

      // Act
      const result = await service.resumeWizard({
        sessionId: 'test-session-123',
        workspaceRoot,
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('expired or invalid');
      expect(mockLogger.warn).toHaveBeenCalledWith(
        'Wizard session expired',
        expect.any(Object)
      );
    });
  });

  describe('handleAgentSelectionUpdate', () => {
    const workspaceUri = { fsPath: '/test/workspace' } as vscode.Uri;

    beforeEach(async () => {
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );
      await service.launchWizard(workspaceUri);
    });

    it('should update agent selection in session', async () => {
      // Arrange
      const session = service.getCurrentSession()!;
      const selectedAgentIds = ['backend-developer', 'frontend-developer'];

      // Act
      const result = await service.handleAgentSelectionUpdate({
        sessionId: session.id,
        selectedAgentIds,
      });

      // Assert
      expect(result.isOk()).toBe(true);
      expect(service.getCurrentSession()?.selectedAgentIds).toEqual(
        selectedAgentIds
      );
    });

    it('should return error if selection is empty', async () => {
      // Arrange
      const session = service.getCurrentSession()!;

      // Act
      const result = await service.handleAgentSelectionUpdate({
        sessionId: session.id,
        selectedAgentIds: [],
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('cannot be empty');
    });

    it('should return error for invalid session ID', async () => {
      // Act
      const result = await service.handleAgentSelectionUpdate({
        sessionId: 'invalid-session-id',
        selectedAgentIds: ['backend-developer'],
      });

      // Assert
      expect(result.isErr()).toBe(true);
      expect(result.error?.message).toContain('Invalid or expired');
    });
  });

  describe('get CurrentSession', () => {
    it('should return null when no active session', () => {
      // Act
      const session = service.getCurrentSession();

      // Assert
      expect(session).toBeNull();
    });

    it('should return current session when wizard is active', async () => {
      // Arrange
      const workspaceUri = { fsPath: '/test/workspace' } as vscode.Uri;
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );
      await service.launchWizard(workspaceUri);

      // Act
      const session = service.getCurrentSession();

      // Assert
      expect(session).toBeDefined();
      expect(session?.workspaceRoot).toBe('/test/workspace');
    });
  });

  describe('Edge Cases', () => {
    it('should handle multiple cancel attempts gracefully', async () => {
      // Arrange
      const workspaceUri = { fsPath: '/test/workspace' } as vscode.Uri;
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );
      await service.launchWizard(workspaceUri);
      const session = service.getCurrentSession()!;

      // Act - Cancel twice
      const result1 = await service.cancelWizard(session.id, false);
      const result2 = await service.cancelWizard(session.id, false);

      // Assert
      expect(result1.isOk()).toBe(true);
      expect(result2.isErr()).toBe(true); // Second cancel should fail (session already gone)
    });

    it('should handle wizard launch for different workspaces sequentially', async () => {
      // Arrange
      const workspace1 = { fsPath: '/test/workspace1' } as vscode.Uri;
      const workspace2 = { fsPath: '/test/workspace2' } as vscode.Uri;
      mockWebviewManager.createWebviewPanel.mockReturnValue(
        {} as vscode.WebviewPanel
      );

      // Act - Launch for workspace1
      await service.launchWizard(workspace1);
      const session1 = service.getCurrentSession()!;

      // Launch for workspace2 (should cancel workspace1)
      await service.launchWizard(workspace2);
      const session2 = service.getCurrentSession()!;

      // Assert
      expect(session2.workspaceRoot).toBe('/test/workspace2');
      expect(session2.id).not.toBe(session1.id);
      expect(mockContext.workspaceState.update).toHaveBeenCalled(); // session1 was saved
    });
  });
});
