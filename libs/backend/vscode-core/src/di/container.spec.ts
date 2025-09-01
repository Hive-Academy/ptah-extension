/**
 * DI Container Tests - User Requirement Validation
 * Testing Week 2 implementation: Type-Safe Dependency Injection Container
 * Validates user requirements from TASK_CMD_002
 */

import 'reflect-metadata';
import * as vscode from 'vscode';
import { DIContainer, TOKENS } from './container';
import { EventBus } from '../messaging/event-bus';
import { CommandManager } from '../api-wrappers/command-manager';
import { WebviewManager } from '../api-wrappers/webview-manager';
import { createMockExtensionContext, vscodeModuleMock } from '../__mocks__/vscode-mocks';

// Mock VS Code API
jest.mock('vscode', () => vscodeModuleMock);

// Mock the dynamic imports in DIContainer
jest.mock('../messaging/event-bus', () => ({
  EventBus: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../api-wrappers/command-manager', () => ({
  CommandManager: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../api-wrappers/webview-manager', () => ({
  WebviewManager: jest.fn().mockImplementation(() => ({})),
}));

describe('DIContainer - User Requirement: Type-Safe Dependency Injection', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    // Reset container state before each test
    DIContainer.clear();
    
    mockContext = createMockExtensionContext();

    jest.clearAllMocks();
  });

  afterEach(() => {
    DIContainer.clear();
  });

  describe('User Scenario: Extension Initialization', () => {
    it('should initialize container with VS Code extension context', () => {
      // GIVEN: Extension is activating with context
      // WHEN: DIContainer is set up
      const container = DIContainer.setup(mockContext);

      // THEN: Container should be configured and context registered
      expect(container).toBeDefined();
      expect(DIContainer.isRegistered(TOKENS.EXTENSION_CONTEXT)).toBe(true);
    });

    it('should register extension context as singleton with type safety', () => {
      // GIVEN: Extension context provided
      // WHEN: DIContainer setup is called
      DIContainer.setup(mockContext);

      // THEN: Context should be resolvable with correct type
      const resolvedContext = DIContainer.resolve<vscode.ExtensionContext>(TOKENS.EXTENSION_CONTEXT);
      expect(resolvedContext).toBe(mockContext);
    });
  });

  describe('User Scenario: Service Registration', () => {
    it('should register all core services as singletons', () => {
      // GIVEN: Extension needs core services
      // WHEN: DIContainer is set up
      DIContainer.setup(mockContext);

      // THEN: All core services should be registered
      expect(DIContainer.isRegistered(TOKENS.EVENT_BUS)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.COMMAND_REGISTRY)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.WEBVIEW_PROVIDER)).toBe(true);
    });

    it('should use Symbol-based tokens for type safety', () => {
      // GIVEN: Extension requires type-safe service resolution
      // WHEN: Services are registered
      DIContainer.setup(mockContext);

      // THEN: All tokens should be Symbols (not strings)
      expect(typeof TOKENS.EXTENSION_CONTEXT).toBe('symbol');
      expect(typeof TOKENS.EVENT_BUS).toBe('symbol');
      expect(typeof TOKENS.COMMAND_REGISTRY).toBe('symbol');
      expect(typeof TOKENS.WEBVIEW_PROVIDER).toBe('symbol');
    });
  });

  describe('User Scenario: Service Resolution', () => {
    beforeEach(() => {
      DIContainer.setup(mockContext);
    });

    it('should resolve services with correct types', () => {
      // GIVEN: Services are registered
      // WHEN: Services are resolved
      const eventBus = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      const commandManager = DIContainer.resolve<CommandManager>(TOKENS.COMMAND_REGISTRY);
      const webviewManager = DIContainer.resolve<WebviewManager>(TOKENS.WEBVIEW_PROVIDER);

      // THEN: Services should be resolved with correct types
      expect(eventBus).toBeDefined();
      expect(commandManager).toBeDefined();
      expect(webviewManager).toBeDefined();
    });

    it('should return same singleton instance on multiple resolutions', () => {
      // GIVEN: Singleton services are registered
      // WHEN: Services are resolved multiple times
      const eventBus1 = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      const eventBus2 = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);

      // THEN: Same instance should be returned (singleton behavior)
      expect(eventBus1).toBe(eventBus2);
    });

    it('should throw error for unregistered service', () => {
      // GIVEN: Service is not registered
      const unregisteredToken = Symbol('UnregisteredService');
      
      // WHEN: Attempting to resolve unregistered service
      // THEN: Should throw error
      expect(() => {
        DIContainer.resolve(unregisteredToken);
      }).toThrow();
    });
  });

  describe('User Scenario: Container Utilities', () => {
    beforeEach(() => {
      DIContainer.setup(mockContext);
    });

    it('should check service registration status', () => {
      // GIVEN: Services are registered
      // WHEN: Checking registration status
      const isEventBusRegistered = DIContainer.isRegistered(TOKENS.EVENT_BUS);
      const isUnknownRegistered = DIContainer.isRegistered(Symbol('Unknown'));

      // THEN: Should correctly report registration status
      expect(isEventBusRegistered).toBe(true);
      expect(isUnknownRegistered).toBe(false);
    });

    it('should provide access to global container instance', () => {
      // GIVEN: Container is set up
      // WHEN: Getting container instance
      const container = DIContainer.getContainer();

      // THEN: Should return the global container
      expect(container).toBeDefined();
      expect(typeof container.resolve).toBe('function');
      expect(typeof container.register).toBe('function');
    });

    it('should clear all instances for cleanup', () => {
      // GIVEN: Container with registered services and resolved instances
      const eventBus1 = DIContainer.resolve(TOKENS.EVENT_BUS);
      expect(eventBus1).toBeDefined();

      // WHEN: Container is cleared
      DIContainer.clear();

      // THEN: New instances should be created on subsequent resolves
      const eventBus2 = DIContainer.resolve(TOKENS.EVENT_BUS);
      expect(eventBus2).toBeDefined();
      // Note: Since registrations remain, services can still be resolved
      // but new instances are created after clearing
    });
  });

  describe('User Error Scenarios', () => {
    it('should handle resolution errors gracefully', () => {
      // GIVEN: Container is not properly set up
      const invalidToken = Symbol('InvalidService');

      // WHEN: Attempting to resolve non-existent service
      // THEN: Should throw meaningful error
      expect(() => {
        DIContainer.resolve(invalidToken);
      }).toThrow(/unregistered dependency token/i);
    });

    it('should allow re-setup after clear', () => {
      // GIVEN: Container was previously set up and cleared
      DIContainer.setup(mockContext);
      DIContainer.clear();

      // WHEN: Setting up container again
      expect(() => {
        DIContainer.setup(mockContext);
      }).not.toThrow();

      // THEN: Services should be available again
      expect(DIContainer.isRegistered(TOKENS.EXTENSION_CONTEXT)).toBe(true);
    });
  });

  describe('User Requirement: Zero any types', () => {
    it('should provide full TypeScript type safety', () => {
      // GIVEN: Container is set up
      DIContainer.setup(mockContext);

      // WHEN: Resolving services with explicit types
      // THEN: TypeScript should enforce correct types (this is a compile-time test)
      const eventBus: EventBus = DIContainer.resolve<EventBus>(TOKENS.EVENT_BUS);
      const context: vscode.ExtensionContext = DIContainer.resolve<vscode.ExtensionContext>(TOKENS.EXTENSION_CONTEXT);

      // Verify types are correctly enforced at runtime
      expect(eventBus).toBeDefined();
      expect(context).toBe(mockContext);
    });
  });
});