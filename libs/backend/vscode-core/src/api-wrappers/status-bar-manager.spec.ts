/**
 * StatusBarManager Tests - User Requirement Validation
 * Testing Week 3 implementation: VS Code Status Bar Manager with Event Integration
 * Validates user requirements from TASK_CMD_003
 */

/* eslint-disable @typescript-eslint/no-explicit-any, @typescript-eslint/no-non-null-assertion */
import 'reflect-metadata';
import * as vscode from 'vscode';
import {
  StatusBarManager,
  StatusBarItemConfig,
  StatusBarItemUpdate,
} from './status-bar-manager';

// Mock VS Code API with proper disposable patterns
const mockStatusBarItem = {
  id: '',
  alignment: 2,
  priority: 0,
  text: '',
  tooltip: '',
  color: undefined,
  backgroundColor: undefined,
  command: undefined,
  accessibilityInformation: undefined,
  show: jest.fn(),
  hide: jest.fn(),
  dispose: jest.fn(),
};

jest.mock('vscode', () => ({
  window: {
    createStatusBarItem: jest
      .fn()
      .mockImplementation(
        (id: string, alignment: number, priority: number) => ({
          ...mockStatusBarItem,
          id,
          alignment,
          priority,
        })
      ),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  ThemeColor: jest.fn(),
  ExtensionContext: jest.fn(),
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
}));

// Access the mocked window after the mock is set up
const mockWindow = require('vscode').window;
const mockStatusBarAlignment = require('vscode').StatusBarAlignment;

// Mock EventBus
const mockEventBus = {
  publish: jest.fn(),
  subscribe: jest.fn(),
  dispose: jest.fn(),
};

describe('StatusBarManager - User Requirement: VS Code Status Bar Abstraction', () => {
  let statusBarManager: StatusBarManager;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    mockContext = {
      subscriptions: [],
      workspaceState: {
        get: jest.fn(),
        update: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
        setKeysForSync: jest.fn(),
        keys: jest.fn().mockReturnValue([]),
      },
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
        onDidChange: jest.fn(),
      },
      extensionUri: {
        scheme: 'file',
        authority: '',
        path: '/test',
        query: '',
        fragment: '',
        fsPath: '/test',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      extensionPath: '/test/extension/path',
      environmentVariableCollection: {
        persistent: false,
        replace: jest.fn(),
        append: jest.fn(),
        prepend: jest.fn(),
        get: jest.fn(),
        forEach: jest.fn(),
        delete: jest.fn(),
        clear: jest.fn(),
      },
      storagePath: '/test/storage/path',
      globalStoragePath: '/test/global/storage/path',
      logPath: '/test/log/path',
      extensionMode: 1,
      logUri: {
        scheme: 'file',
        authority: '',
        path: '/test/log',
        query: '',
        fragment: '',
        fsPath: '/test/log',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      storageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/storage',
        query: '',
        fragment: '',
        fsPath: '/test/storage',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      globalStorageUri: {
        scheme: 'file',
        authority: '',
        path: '/test/global',
        query: '',
        fragment: '',
        fsPath: '/test/global',
        with: jest.fn(),
        toString: jest.fn(),
        toJSON: jest.fn(),
      },
      asAbsolutePath: jest.fn(),
      extension: {
        id: 'test.extension',
        extensionUri: { scheme: 'file', path: '/test', fsPath: '/test' } as any,
        extensionPath: '/test',
        isActive: true,
        packageJSON: {},
        exports: undefined,
        activate: jest.fn(),
        extensionKind: 1,
      },
      languageModelAccessInformation: {
        onDidChange: jest.fn(),
        canSendRequest: jest.fn().mockReturnValue(true),
      },
    } as any;

    statusBarManager = new StatusBarManager(mockContext, mockEventBus as any);
  });

  afterEach(() => {
    statusBarManager.dispose();
  });

  describe('User Scenario: Status Bar Item Creation', () => {
    it('should create status bar items with VS Code API and track them', () => {
      // GIVEN: User wants to create a status bar item
      const itemConfig: StatusBarItemConfig = {
        id: 'ptah.status.test',
        alignment: mockStatusBarAlignment.Left,
        priority: 100,
        text: '$(sync) Ptah',
        tooltip: 'Ptah Extension Status',
        command: 'ptah.showStatus',
      };

      // WHEN: Creating the status bar item
      const item = statusBarManager.createStatusBarItem(itemConfig);

      // THEN: Item should be created with VS Code and tracked
      expect(mockWindow.createStatusBarItem).toHaveBeenCalledWith(
        'ptah.status.test',
        mockStatusBarAlignment.Left,
        100
      );
      expect(item).toBeDefined();
      expect(item.text).toBe('$(sync) Ptah');
      expect(item.tooltip).toBe('Ptah Extension Status');
      expect(item.command).toBe('ptah.showStatus');
      expect(statusBarManager.hasItem('ptah.status.test')).toBe(true);
      expect(mockContext.subscriptions).toContain(item);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemCreated',
          properties: {
            itemId: 'ptah.status.test',
            alignment: mockStatusBarAlignment.Left,
            priority: 100,
            hasText: true,
            hasTooltip: true,
            hasCommand: true,
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return existing item if already created', () => {
      // GIVEN: Item already exists
      const config: StatusBarItemConfig = {
        id: 'ptah.existing',
        text: 'Existing',
      };
      const firstItem = statusBarManager.createStatusBarItem(config);

      // WHEN: Creating item with same ID
      const secondItem = statusBarManager.createStatusBarItem(config);

      // THEN: Should return same item instance
      expect(firstItem).toBe(secondItem);
      expect(mockWindow.createStatusBarItem).toHaveBeenCalledTimes(1);
    });

    it('should create item with default alignment and priority when not provided', () => {
      // GIVEN: Item config with minimal properties
      const config: StatusBarItemConfig = { id: 'ptah.minimal' };

      // WHEN: Creating the item
      statusBarManager.createStatusBarItem(config);

      // THEN: Should use default values
      expect(mockWindow.createStatusBarItem).toHaveBeenCalledWith(
        'ptah.minimal',
        mockStatusBarAlignment.Right, // default alignment
        0 // default priority
      );
    });

    it('should handle item creation errors', () => {
      // GIVEN: VS Code API throws error
      const config: StatusBarItemConfig = { id: 'ptah.error' };
      mockWindow.createStatusBarItem.mockImplementationOnce(() => {
        throw new Error('VS Code error');
      });

      // WHEN: Creating item that fails
      // THEN: Should throw error and publish error event
      expect(() => statusBarManager.createStatusBarItem(config)).toThrow(
        'VS Code error'
      );

      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_ITEM_CREATE_FAILED',
        message:
          'Failed to create status bar item ptah.error: Error: VS Code error',
        source: 'StatusBarManager',
        data: { config },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('User Scenario: Status Bar Item Updates and State Management', () => {
    beforeEach(() => {
      // Setup item for update tests
      statusBarManager.createStatusBarItem({
        id: 'ptah.update.test',
        text: 'Initial Text',
        tooltip: 'Initial Tooltip',
      });
      jest.clearAllMocks(); // Clear creation events
    });

    it('should update item properties and track changes', () => {
      // GIVEN: Item update configuration
      const update: StatusBarItemUpdate = {
        text: 'Updated Text',
        tooltip: 'Updated Tooltip',
        color: 'red',
        command: 'ptah.updatedCommand',
      };

      // WHEN: Updating the item
      const result = statusBarManager.updateStatusBarItem(
        'ptah.update.test',
        update
      );

      // THEN: Item should be updated and tracked
      expect(result).toBe(true);
      const item = statusBarManager.getItem('ptah.update.test');
      expect(item!.text).toBe('Updated Text');
      expect(item!.tooltip).toBe('Updated Tooltip');
      expect(item!.color).toBe('red');
      expect(item!.command).toBe('ptah.updatedCommand');

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemUpdated',
          properties: {
            itemId: 'ptah.update.test',
            propertiesUpdated: 4,
            updatedProperties: 'text,tooltip,color,command',
            timestamp: expect.any(Number),
          },
        }
      );

      // AND: Metrics should be updated
      const metrics = statusBarManager.getItemMetrics('ptah.update.test');
      expect(metrics!.updateCount).toBe(1);
      expect(metrics!.lastUpdate).toBeGreaterThan(0);
    });

    it('should handle partial updates correctly', () => {
      // GIVEN: Partial update (only text)
      const update: StatusBarItemUpdate = {
        text: 'Only Text Updated',
      };

      // WHEN: Updating only text
      statusBarManager.updateStatusBarItem('ptah.update.test', update);

      // THEN: Only text should be changed
      const item = statusBarManager.getItem('ptah.update.test');
      expect(item!.text).toBe('Only Text Updated');
      // Original tooltip should remain
      expect(item!.tooltip).toBe('Initial Tooltip');

      // AND: Should track only the updated property
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemUpdated',
          properties: {
            itemId: 'ptah.update.test',
            propertiesUpdated: 1,
            updatedProperties: 'text',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should handle updates to non-existent items', () => {
      // WHEN: Updating item that doesn't exist
      const result = statusBarManager.updateStatusBarItem('non.existent', {
        text: 'test',
      });

      // THEN: Should return false and publish error
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_ITEM_NOT_FOUND',
        message: 'Status bar item non.existent not found',
        source: 'StatusBarManager',
        data: { itemId: 'non.existent', update: { text: 'test' } },
        timestamp: expect.any(Number),
      });
    });

    it('should handle update errors gracefully', () => {
      // GIVEN: Update operation that will fail
      const item = statusBarManager.getItem('ptah.update.test');
      Object.defineProperty(item!, 'text', {
        set: () => {
          throw new Error('Update failed');
        },
      });

      // WHEN: Updating item that fails
      const result = statusBarManager.updateStatusBarItem('ptah.update.test', {
        text: 'fail',
      });

      // THEN: Should return false and publish error event
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_ITEM_UPDATE_FAILED',
        message:
          'Failed to update status bar item ptah.update.test: Error: Update failed',
        source: 'StatusBarManager',
        data: { itemId: 'ptah.update.test', update: { text: 'fail' } },
        timestamp: expect.any(Number),
      });

      // AND: Error metrics should be updated
      const metrics = statusBarManager.getItemMetrics('ptah.update.test');
      expect(metrics!.errorCount).toBe(1);
    });
  });

  describe('User Scenario: Status Bar Item Visibility Management', () => {
    beforeEach(() => {
      statusBarManager.createStatusBarItem({ id: 'ptah.visibility.test' });
      jest.clearAllMocks();
    });

    it('should show items and track visibility state', () => {
      // WHEN: Showing item
      const result = statusBarManager.show('ptah.visibility.test');

      // THEN: Item should be shown and state tracked
      expect(result).toBe(true);
      expect(mockStatusBarItem.show).toHaveBeenCalled();

      // AND: Visibility should be tracked in metrics
      const metrics = statusBarManager.getItemMetrics('ptah.visibility.test');
      expect(metrics!.isVisible).toBe(true);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemShown',
          properties: {
            itemId: 'ptah.visibility.test',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should hide items and track visibility state', () => {
      // GIVEN: Item is initially shown
      statusBarManager.show('ptah.visibility.test');
      jest.clearAllMocks();

      // WHEN: Hiding item
      const result = statusBarManager.hide('ptah.visibility.test');

      // THEN: Item should be hidden and state tracked
      expect(result).toBe(true);
      expect(mockStatusBarItem.hide).toHaveBeenCalled();

      // AND: Visibility should be updated in metrics
      const metrics = statusBarManager.getItemMetrics('ptah.visibility.test');
      expect(metrics!.isVisible).toBe(false);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemHidden',
          properties: {
            itemId: 'ptah.visibility.test',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return false for visibility operations on non-existent items', () => {
      expect(statusBarManager.show('non.existent')).toBe(false);
      expect(statusBarManager.hide('non.existent')).toBe(false);
    });

    it('should handle visibility operation errors', () => {
      // GIVEN: Show operation that will fail
      mockStatusBarItem.show.mockImplementationOnce(() => {
        throw new Error('Show failed');
      });

      // WHEN: Showing item that fails
      const result = statusBarManager.show('ptah.visibility.test');

      // THEN: Should return false and publish error
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_ITEM_SHOW_FAILED',
        message:
          'Failed to show status bar item ptah.visibility.test: Error: Show failed',
        source: 'StatusBarManager',
        data: { itemId: 'ptah.visibility.test' },
        timestamp: expect.any(Number),
      });
    });
  });

  describe('User Scenario: Click Tracking and Analytics', () => {
    beforeEach(() => {
      statusBarManager.createStatusBarItem({
        id: 'ptah.click.test',
        command: 'ptah.testCommand',
      });
      jest.clearAllMocks();
    });

    it('should track clicks and update metrics', () => {
      // WHEN: Tracking a click with command
      statusBarManager.trackClick('ptah.click.test', 'ptah.testCommand');

      // THEN: Click should be tracked in metrics
      const metrics = statusBarManager.getItemMetrics('ptah.click.test');
      expect(metrics!.clickCount).toBe(1);
      expect(metrics!.lastClick).toBeGreaterThan(0);

      // AND: Analytics event should be published
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemClicked',
          properties: {
            itemId: 'ptah.click.test',
            hasCommand: true,
            command: 'ptah.testCommand',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should track clicks without commands', () => {
      // WHEN: Tracking a click without command
      statusBarManager.trackClick('ptah.click.test');

      // THEN: Click should be tracked with no command
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemClicked',
          properties: {
            itemId: 'ptah.click.test',
            hasCommand: false,
            command: 'none',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should ignore clicks on non-existent items', () => {
      // WHEN: Tracking click on non-existent item
      statusBarManager.trackClick('non.existent');

      // THEN: Should not publish any events
      expect(mockEventBus.publish).not.toHaveBeenCalled();
    });
  });

  describe('User Scenario: Item Information and Debugging', () => {
    beforeEach(() => {
      statusBarManager.createStatusBarItem({ id: 'ptah.info.1' });
      statusBarManager.createStatusBarItem({ id: 'ptah.info.2' });
      jest.clearAllMocks();
    });

    it('should provide item access and validation', () => {
      // THEN: Should provide access to items
      expect(statusBarManager.getItem('ptah.info.1')).toBeDefined();
      expect(statusBarManager.getItem('non.existent')).toBeUndefined();
      expect(statusBarManager.hasItem('ptah.info.1')).toBe(true);
      expect(statusBarManager.hasItem('non.existent')).toBe(false);
    });

    it('should list all item IDs', () => {
      // THEN: Should return all registered item IDs
      const itemIds = statusBarManager.getItemIds();
      expect(itemIds).toContain('ptah.info.1');
      expect(itemIds).toContain('ptah.info.2');
      expect(itemIds).toHaveLength(2);
    });

    it('should provide metrics for specific items', () => {
      // GIVEN: Item with some activity
      statusBarManager.updateStatusBarItem('ptah.info.1', { text: 'test' });
      statusBarManager.trackClick('ptah.info.1');

      // THEN: Should provide specific item metrics
      const metrics = statusBarManager.getItemMetrics('ptah.info.1');
      expect(metrics).toEqual({
        createdAt: expect.any(Number),
        updateCount: 1,
        lastUpdate: expect.any(Number),
        clickCount: 1,
        lastClick: expect.any(Number),
        isVisible: false,
        errorCount: 0,
      });
    });

    it('should provide metrics for all items', () => {
      // GIVEN: Activity on multiple items
      statusBarManager.updateStatusBarItem('ptah.info.1', { text: 'test1' });
      statusBarManager.updateStatusBarItem('ptah.info.2', { text: 'test2' });

      // THEN: Should provide all item metrics
      const allMetrics = statusBarManager.getItemMetrics();
      expect(allMetrics).toBeTruthy();
      expect(allMetrics).not.toBeNull();
      if (allMetrics && typeof allMetrics === 'object') {
        expect('ptah.info.1' in allMetrics).toBe(true);
        expect('ptah.info.2' in allMetrics).toBe(true);
        expect(Object.keys(allMetrics)).toHaveLength(2);
      }
    });

    it('should return null for metrics of non-existent items', () => {
      expect(statusBarManager.getItemMetrics('non.existent')).toBeNull();
    });
  });

  describe('User Scenario: Manager Lifecycle and Cleanup', () => {
    it('should dispose individual items', () => {
      // GIVEN: Item to dispose
      statusBarManager.createStatusBarItem({ id: 'ptah.dispose.test' });

      // WHEN: Disposing item
      const result = statusBarManager.disposeItem('ptah.dispose.test');

      // THEN: Item should be disposed and removed from tracking
      expect(result).toBe(true);
      expect(mockStatusBarItem.dispose).toHaveBeenCalled();
      expect(statusBarManager.hasItem('ptah.dispose.test')).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:itemDisposed',
          properties: {
            itemId: 'ptah.dispose.test',
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should dispose all items during manager disposal', () => {
      // GIVEN: Multiple items
      statusBarManager.createStatusBarItem({ id: 'item1' });
      statusBarManager.createStatusBarItem({ id: 'item2' });

      // WHEN: Disposing manager
      statusBarManager.dispose();

      // THEN: All items should be disposed
      expect(mockStatusBarItem.dispose).toHaveBeenCalledTimes(2);
      expect(statusBarManager.getItemIds()).toHaveLength(0);
      expect(mockEventBus.publish).toHaveBeenCalledWith(
        'analytics:trackEvent',
        {
          event: 'statusBar:managerDisposed',
          properties: {
            timestamp: expect.any(Number),
          },
        }
      );
    });

    it('should return false when disposing non-existent items', () => {
      expect(statusBarManager.disposeItem('non.existent')).toBe(false);
    });

    it('should handle disposal errors gracefully', () => {
      // GIVEN: Item and disposal error
      statusBarManager.createStatusBarItem({ id: 'error.item' });
      mockStatusBarItem.dispose.mockImplementationOnce(() => {
        throw new Error('Disposal error');
      });

      // WHEN: Disposing item that fails
      const result = statusBarManager.disposeItem('error.item');

      // THEN: Should return false and publish error
      expect(result).toBe(false);
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_ITEM_DISPOSE_FAILED',
        message:
          'Failed to dispose status bar item error.item: Error: Disposal error',
        source: 'StatusBarManager',
        data: { itemId: 'error.item' },
        timestamp: expect.any(Number),
      });
    });

    it('should handle manager disposal errors gracefully', () => {
      // GIVEN: Item and manager disposal error
      statusBarManager.createStatusBarItem({ id: 'manager.error' });
      mockStatusBarItem.dispose.mockImplementationOnce(() => {
        throw new Error('Manager disposal error');
      });

      // WHEN: Disposing manager
      statusBarManager.dispose();

      // THEN: Should publish error event
      expect(mockEventBus.publish).toHaveBeenCalledWith('error', {
        code: 'STATUS_BAR_MANAGER_DISPOSE_FAILED',
        message:
          'Failed to dispose StatusBarManager: Error: Manager disposal error',
        source: 'StatusBarManager',
        timestamp: expect.any(Number),
      });
    });
  });
});
