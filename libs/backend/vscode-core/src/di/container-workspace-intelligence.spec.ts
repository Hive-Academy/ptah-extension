/**
 * DI Container Workspace Intelligence Integration Tests
 *
 * Validates that all workspace-intelligence services are properly registered
 * and resolvable via the DI container.
 *
 * Tests for TASK_PRV_005 Phase 3 Step 3.1
 */

import 'reflect-metadata';
import { DIContainer, TOKENS } from './container';
import * as vscode from 'vscode';

// Mock VS Code API for testing
jest.mock('vscode', () => ({
  workspace: {
    workspaceFolders: [],
    fs: {
      readFile: jest.fn(),
      readDirectory: jest.fn(),
      stat: jest.fn(),
    },
  },
  Uri: {
    file: jest.fn((path: string) => ({ fsPath: path, path })),
    parse: jest.fn((path: string) => ({ fsPath: path, path })),
  },
  FileType: {
    File: 1,
    Directory: 2,
  },
}));

describe('DIContainer - Workspace Intelligence Services', () => {
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    // Clear container before each test
    DIContainer.clear();

    // Create mock extension context
    mockContext = {
      subscriptions: [],
      extensionPath: '/test/path',
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
        keys: jest.fn(() => []),
      },
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn(() => []),
      },
      secrets: {} as vscode.SecretStorage,
      extensionUri: vscode.Uri.file('/test/path'),
      extensionMode: 3,
      storageUri: vscode.Uri.file('/test/storage'),
      globalStorageUri: vscode.Uri.file('/test/global-storage'),
      logUri: vscode.Uri.file('/test/logs'),
      storagePath: '/test/storage',
      globalStoragePath: '/test/global-storage',
      logPath: '/test/logs',
      asAbsolutePath: jest.fn((path) => `/test/path/${path}`),
      environmentVariableCollection:
        {} as vscode.GlobalEnvironmentVariableCollection,
      extension: {} as vscode.Extension<unknown>,
      languageModelAccessInformation:
        {} as vscode.LanguageModelAccessInformation,
    };

    // Setup container with mock context
    DIContainer.setup(mockContext);
  });

  afterEach(() => {
    DIContainer.clear();
  });

  describe('Service Registration', () => {
    it('should register all core workspace-intelligence services', () => {
      // GIVEN: Container is set up (done in beforeEach)

      // WHEN: Checking registration status

      // THEN: All services should be registered
      expect(DIContainer.isRegistered(TOKENS.TOKEN_COUNTER_SERVICE)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.FILE_SYSTEM_SERVICE)).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.PROJECT_DETECTOR_SERVICE)).toBe(
        true
      );
      expect(DIContainer.isRegistered(TOKENS.FRAMEWORK_DETECTOR_SERVICE)).toBe(
        true
      );
      expect(DIContainer.isRegistered(TOKENS.DEPENDENCY_ANALYZER_SERVICE)).toBe(
        true
      );
      expect(DIContainer.isRegistered(TOKENS.MONOREPO_DETECTOR_SERVICE)).toBe(
        true
      );
    });

    it('should register file indexing services', () => {
      // GIVEN: Container is set up (done in beforeEach)

      // WHEN: Checking registration status

      // THEN: File indexing services should be registered
      expect(DIContainer.isRegistered(TOKENS.PATTERN_MATCHER_SERVICE)).toBe(
        true
      );
      expect(
        DIContainer.isRegistered(TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE)
      ).toBe(true);
      expect(
        DIContainer.isRegistered(TOKENS.FILE_TYPE_CLASSIFIER_SERVICE)
      ).toBe(true);
      expect(DIContainer.isRegistered(TOKENS.WORKSPACE_INDEXER_SERVICE)).toBe(
        true
      );
    });
  });

  describe('Service Resolution', () => {
    it('should resolve TokenCounterService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.TOKEN_COUNTER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('TokenCounterService');
    });

    it('should resolve FileSystemService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.FILE_SYSTEM_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('FileSystemService');
    });

    it('should resolve ProjectDetectorService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.PROJECT_DETECTOR_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('ProjectDetectorService');
    });

    it('should resolve FrameworkDetectorService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.FRAMEWORK_DETECTOR_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('FrameworkDetectorService');
    });

    it('should resolve DependencyAnalyzerService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.DEPENDENCY_ANALYZER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('DependencyAnalyzerService');
    });

    it('should resolve MonorepoDetectorService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.MONOREPO_DETECTOR_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('MonorepoDetectorService');
    });

    it('should resolve PatternMatcherService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.PATTERN_MATCHER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('PatternMatcherService');
    });

    it('should resolve IgnorePatternResolverService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('IgnorePatternResolverService');
    });

    it('should resolve FileTypeClassifierService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.FILE_TYPE_CLASSIFIER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('FileTypeClassifierService');
    });

    it('should resolve WorkspaceIndexerService', () => {
      // WHEN: Resolving service
      const service = DIContainer.resolve<{ constructor: { name: string } }>(
        TOKENS.WORKSPACE_INDEXER_SERVICE
      );

      // THEN: Service should be resolved
      expect(service).toBeDefined();
      expect(service.constructor.name).toBe('WorkspaceIndexerService');
    });
  });

  describe('Service Singleton Behavior', () => {
    it('should return same instance for multiple resolutions', () => {
      // WHEN: Resolving same service twice
      const service1 = DIContainer.resolve(TOKENS.TOKEN_COUNTER_SERVICE);
      const service2 = DIContainer.resolve(TOKENS.TOKEN_COUNTER_SERVICE);

      // THEN: Should be same instance (singleton)
      expect(service1).toBe(service2);
    });

    it('should maintain singleton across all workspace-intelligence services', () => {
      // WHEN: Resolving all services twice
      const services1 = {
        tokenCounter: DIContainer.resolve(TOKENS.TOKEN_COUNTER_SERVICE),
        fileSystem: DIContainer.resolve(TOKENS.FILE_SYSTEM_SERVICE),
        projectDetector: DIContainer.resolve(TOKENS.PROJECT_DETECTOR_SERVICE),
        frameworkDetector: DIContainer.resolve(
          TOKENS.FRAMEWORK_DETECTOR_SERVICE
        ),
        dependencyAnalyzer: DIContainer.resolve(
          TOKENS.DEPENDENCY_ANALYZER_SERVICE
        ),
        monorepoDetector: DIContainer.resolve(TOKENS.MONOREPO_DETECTOR_SERVICE),
        patternMatcher: DIContainer.resolve(TOKENS.PATTERN_MATCHER_SERVICE),
        ignoreResolver: DIContainer.resolve(
          TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE
        ),
        fileClassifier: DIContainer.resolve(
          TOKENS.FILE_TYPE_CLASSIFIER_SERVICE
        ),
        workspaceIndexer: DIContainer.resolve(TOKENS.WORKSPACE_INDEXER_SERVICE),
      };

      const services2 = {
        tokenCounter: DIContainer.resolve(TOKENS.TOKEN_COUNTER_SERVICE),
        fileSystem: DIContainer.resolve(TOKENS.FILE_SYSTEM_SERVICE),
        projectDetector: DIContainer.resolve(TOKENS.PROJECT_DETECTOR_SERVICE),
        frameworkDetector: DIContainer.resolve(
          TOKENS.FRAMEWORK_DETECTOR_SERVICE
        ),
        dependencyAnalyzer: DIContainer.resolve(
          TOKENS.DEPENDENCY_ANALYZER_SERVICE
        ),
        monorepoDetector: DIContainer.resolve(TOKENS.MONOREPO_DETECTOR_SERVICE),
        patternMatcher: DIContainer.resolve(TOKENS.PATTERN_MATCHER_SERVICE),
        ignoreResolver: DIContainer.resolve(
          TOKENS.IGNORE_PATTERN_RESOLVER_SERVICE
        ),
        fileClassifier: DIContainer.resolve(
          TOKENS.FILE_TYPE_CLASSIFIER_SERVICE
        ),
        workspaceIndexer: DIContainer.resolve(TOKENS.WORKSPACE_INDEXER_SERVICE),
      };

      // THEN: All services should be singleton
      expect(services1.tokenCounter).toBe(services2.tokenCounter);
      expect(services1.fileSystem).toBe(services2.fileSystem);
      expect(services1.projectDetector).toBe(services2.projectDetector);
      expect(services1.frameworkDetector).toBe(services2.frameworkDetector);
      expect(services1.dependencyAnalyzer).toBe(services2.dependencyAnalyzer);
      expect(services1.monorepoDetector).toBe(services2.monorepoDetector);
      expect(services1.patternMatcher).toBe(services2.patternMatcher);
      expect(services1.ignoreResolver).toBe(services2.ignoreResolver);
      expect(services1.fileClassifier).toBe(services2.fileClassifier);
      expect(services1.workspaceIndexer).toBe(services2.workspaceIndexer);
    });
  });

  describe('Service Dependency Injection', () => {
    it('should inject dependencies into WorkspaceIndexerService', () => {
      // WHEN: Resolving WorkspaceIndexerService
      const workspaceIndexer = DIContainer.resolve<{
        fileSystemService: unknown;
        patternMatcher: unknown;
        ignoreResolver: unknown;
        fileClassifier: unknown;
        tokenCounter: unknown;
      }>(TOKENS.WORKSPACE_INDEXER_SERVICE);

      // THEN: Should have all injected dependencies
      expect(workspaceIndexer.fileSystemService).toBeDefined();
      expect(workspaceIndexer.patternMatcher).toBeDefined();
      expect(workspaceIndexer.ignoreResolver).toBeDefined();
      expect(workspaceIndexer.fileClassifier).toBeDefined();
      expect(workspaceIndexer.tokenCounter).toBeDefined();
    });

    it('should inject dependencies into ProjectDetectorService', () => {
      // WHEN: Resolving ProjectDetectorService
      const projectDetector = DIContainer.resolve<{
        fileSystem: { constructor: { name: string } };
      }>(TOKENS.PROJECT_DETECTOR_SERVICE);

      // THEN: Should have FileSystemService injected
      expect(projectDetector.fileSystem).toBeDefined();
      expect(projectDetector.fileSystem.constructor.name).toBe(
        'FileSystemService'
      );
    });

    it('should inject dependencies into FrameworkDetectorService', () => {
      // WHEN: Resolving FrameworkDetectorService
      const frameworkDetector = DIContainer.resolve<{
        fileSystem: { constructor: { name: string } };
      }>(TOKENS.FRAMEWORK_DETECTOR_SERVICE);

      // THEN: Should have FileSystemService injected
      expect(frameworkDetector.fileSystem).toBeDefined();
      expect(frameworkDetector.fileSystem.constructor.name).toBe(
        'FileSystemService'
      );
    });
  });

  describe('Error Handling', () => {
    it('should throw error when resolving unregistered service', () => {
      // GIVEN: Container is set up
      // WHEN: Resolving non-existent service
      const nonExistentToken = Symbol('NonExistentService');

      // THEN: Should throw error
      expect(() => DIContainer.resolve(nonExistentToken)).toThrow();
    });
  });
});
