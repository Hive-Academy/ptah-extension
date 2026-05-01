/**
 * StatusBarManager unit tests.
 *
 * Exercises the real StatusBarManager surface: item creation with initial
 * properties, incremental updates, show/hide visibility tracking, click
 * tracking, accessor helpers, and disposal.
 *
 * TASK_2025_291 Wave B: replaces a ghost spec that mocked a nonexistent
 * EventBus dependency.
 */

import 'reflect-metadata';
import type * as vscode from 'vscode';

import {
  StatusBarManager,
  type StatusBarItemConfig,
  type StatusBarItemUpdate,
} from './status-bar-manager';

// -------------------------------------------------------------------------
// Module-level vscode mock
// -------------------------------------------------------------------------
jest.mock('vscode', () => ({
  window: {
    createStatusBarItem: jest.fn(),
  },
  StatusBarAlignment: {
    Left: 1,
    Right: 2,
  },
  Uri: {
    file: jest.fn(),
    parse: jest.fn(),
    joinPath: jest.fn(),
  },
}));

const vscodeModule = jest.requireMock<{
  window: { createStatusBarItem: jest.Mock };
  StatusBarAlignment: { Left: number; Right: number };
}>('vscode');

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------
interface MockStatusBarItem {
  id: string;
  alignment: number;
  priority: number;
  text: string;
  tooltip: string | undefined;
  color: string | vscode.ThemeColor | undefined;
  backgroundColor: vscode.ThemeColor | undefined;
  command: string | vscode.Command | undefined;
  accessibilityInformation: vscode.AccessibilityInformation | undefined;
  show: jest.Mock<void, []>;
  hide: jest.Mock<void, []>;
  dispose: jest.Mock<void, []>;
}

function createMockItem(
  id: string,
  alignment: number,
  priority: number,
): MockStatusBarItem {
  return {
    id,
    alignment,
    priority,
    text: '',
    tooltip: undefined,
    color: undefined,
    backgroundColor: undefined,
    command: undefined,
    accessibilityInformation: undefined,
    show: jest.fn(),
    hide: jest.fn(),
    dispose: jest.fn(),
  };
}

function createMockContext(): Pick<vscode.ExtensionContext, 'subscriptions'> {
  return { subscriptions: [] } as Pick<
    vscode.ExtensionContext,
    'subscriptions'
  >;
}

describe('StatusBarManager', () => {
  let context: Pick<vscode.ExtensionContext, 'subscriptions'>;
  let createItemMock: jest.Mock;
  let createdItems: MockStatusBarItem[];
  let manager: StatusBarManager;

  beforeEach(() => {
    jest.clearAllMocks();
    createdItems = [];
    createItemMock = vscodeModule.window.createStatusBarItem;
    createItemMock.mockImplementation(
      (id: string, alignment: number, priority: number) => {
        const item = createMockItem(id, alignment, priority);
        createdItems.push(item);
        return item;
      },
    );
    context = createMockContext();
    manager = new StatusBarManager(context as vscode.ExtensionContext);
  });

  afterEach(() => {
    manager.dispose();
  });

  // ---------------------------------------------------------------------
  // Construction
  // ---------------------------------------------------------------------
  describe('construction', () => {
    it('starts with no items', () => {
      expect(manager.getItemIds()).toEqual([]);
      expect(manager.getItemMetrics()).toEqual({});
    });
  });

  // ---------------------------------------------------------------------
  // createStatusBarItem
  // ---------------------------------------------------------------------
  describe('createStatusBarItem', () => {
    it('creates an item with the defaults (Right alignment, priority 0)', () => {
      const config: StatusBarItemConfig = { id: 'ptah.item.default' };

      const item = manager.createStatusBarItem(config);

      expect(createItemMock).toHaveBeenCalledWith(
        'ptah.item.default',
        vscodeModule.StatusBarAlignment.Right,
        0,
      );
      expect(item).toBe(createdItems[0]);
      expect(manager.hasItem('ptah.item.default')).toBe(true);
      expect(context.subscriptions).toContain(createdItems[0]);
    });

    it('forwards custom alignment and priority', () => {
      manager.createStatusBarItem({
        id: 'ptah.item.custom',
        alignment: vscodeModule.StatusBarAlignment
          .Left as unknown as vscode.StatusBarAlignment,
        priority: 5,
      });

      expect(createItemMock).toHaveBeenCalledWith(
        'ptah.item.custom',
        vscodeModule.StatusBarAlignment.Left,
        5,
      );
    });

    it('copies initial properties onto the created item', () => {
      const config: StatusBarItemConfig = {
        id: 'ptah.item.props',
        text: 'hello',
        tooltip: 'world',
        command: 'ptah.doThing',
      };

      manager.createStatusBarItem(config);

      const item = createdItems[0];
      expect(item.text).toBe('hello');
      expect(item.tooltip).toBe('world');
      expect(item.command).toBe('ptah.doThing');
    });

    it('returns the existing item when creating with a duplicate id', () => {
      const first = manager.createStatusBarItem({ id: 'ptah.dup' });
      const second = manager.createStatusBarItem({ id: 'ptah.dup' });

      expect(second).toBe(first);
      expect(createItemMock).toHaveBeenCalledTimes(1);
    });

    it('initialises zeroed metrics with isVisible=false', () => {
      manager.createStatusBarItem({ id: 'ptah.item.metrics' });

      const metrics = manager.getItemMetrics('ptah.item.metrics');
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-item metrics object');
      }
      expect(metrics.updateCount).toBe(0);
      expect(metrics.clickCount).toBe(0);
      expect(metrics.errorCount).toBe(0);
      expect(metrics.isVisible).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // updateStatusBarItem
  // ---------------------------------------------------------------------
  describe('updateStatusBarItem', () => {
    const itemId = 'ptah.update';

    beforeEach(() => {
      manager.createStatusBarItem({ id: itemId, text: 'initial' });
    });

    it('applies only the properties provided in the update', () => {
      const update: StatusBarItemUpdate = {
        text: 'updated',
        tooltip: 'tip',
      };

      expect(manager.updateStatusBarItem(itemId, update)).toBe(true);

      const item = createdItems[0];
      expect(item.text).toBe('updated');
      expect(item.tooltip).toBe('tip');
      expect(item.color).toBeUndefined();
    });

    it('increments updateCount in metrics', () => {
      manager.updateStatusBarItem(itemId, { text: 'a' });
      manager.updateStatusBarItem(itemId, { text: 'b' });

      const metrics = manager.getItemMetrics(itemId);
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-item metrics object');
      }
      expect(metrics.updateCount).toBe(2);
      expect(metrics.lastUpdate).toBeGreaterThan(0);
    });

    it('returns false for an unknown item', () => {
      expect(manager.updateStatusBarItem('ptah.unknown', { text: 'x' })).toBe(
        false,
      );
    });
  });

  // ---------------------------------------------------------------------
  // show / hide
  // ---------------------------------------------------------------------
  describe('show / hide', () => {
    const itemId = 'ptah.visible';

    beforeEach(() => {
      manager.createStatusBarItem({ id: itemId });
    });

    it('show() calls item.show() and flips isVisible', () => {
      expect(manager.show(itemId)).toBe(true);
      expect(createdItems[0].show).toHaveBeenCalledTimes(1);

      const metrics = manager.getItemMetrics(itemId);
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-item metrics object');
      }
      expect(metrics.isVisible).toBe(true);
    });

    it('hide() calls item.hide() and flips isVisible', () => {
      manager.show(itemId);
      expect(manager.hide(itemId)).toBe(true);
      expect(createdItems[0].hide).toHaveBeenCalledTimes(1);

      const metrics = manager.getItemMetrics(itemId);
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-item metrics object');
      }
      expect(metrics.isVisible).toBe(false);
    });

    it('show() returns false when the item does not exist', () => {
      expect(manager.show('ptah.unknown')).toBe(false);
    });

    it('hide() returns false when the item does not exist', () => {
      expect(manager.hide('ptah.unknown')).toBe(false);
    });

    it('show() returns false if item.show() throws', () => {
      createdItems[0].show.mockImplementation(() => {
        throw new Error('show failed');
      });
      expect(manager.show(itemId)).toBe(false);
    });
  });

  // ---------------------------------------------------------------------
  // trackClick
  // ---------------------------------------------------------------------
  describe('trackClick', () => {
    it('increments clickCount for a registered item', () => {
      const itemId = 'ptah.click';
      manager.createStatusBarItem({ id: itemId });

      manager.trackClick(itemId);
      manager.trackClick(itemId, 'ptah.doThing');

      const metrics = manager.getItemMetrics(itemId);
      if (metrics === null || Array.isArray(metrics)) {
        throw new Error('expected per-item metrics object');
      }
      expect(metrics.clickCount).toBe(2);
      expect(metrics.lastClick).toBeGreaterThan(0);
    });

    it('is a no-op for an unknown item', () => {
      expect(() => manager.trackClick('ptah.unknown')).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------
  // Accessors
  // ---------------------------------------------------------------------
  describe('accessors', () => {
    it('getItem() returns the item for a known id', () => {
      manager.createStatusBarItem({ id: 'ptah.acc' });
      expect(manager.getItem('ptah.acc')).toBe(createdItems[0]);
    });

    it('getItem() returns undefined for an unknown id', () => {
      expect(manager.getItem('ptah.unknown')).toBeUndefined();
    });

    it('getItemMetrics() returns null for an unknown id', () => {
      expect(manager.getItemMetrics('ptah.unknown')).toBeNull();
    });
  });

  // ---------------------------------------------------------------------
  // disposeItem / dispose
  // ---------------------------------------------------------------------
  describe('disposal', () => {
    it('disposeItem() disposes the item and clears tracking', () => {
      manager.createStatusBarItem({ id: 'ptah.disp' });
      const item = createdItems[0];

      expect(manager.disposeItem('ptah.disp')).toBe(true);
      expect(item.dispose).toHaveBeenCalledTimes(1);
      expect(manager.hasItem('ptah.disp')).toBe(false);
      expect(manager.getItemMetrics('ptah.disp')).toBeNull();
    });

    it('disposeItem() returns false for an unknown id', () => {
      expect(manager.disposeItem('ptah.unknown')).toBe(false);
    });

    it('dispose() disposes every item and clears state', () => {
      manager.createStatusBarItem({ id: 'ptah.all.1' });
      manager.createStatusBarItem({ id: 'ptah.all.2' });
      const [a, b] = createdItems;

      manager.dispose();

      expect(a.dispose).toHaveBeenCalledTimes(1);
      expect(b.dispose).toHaveBeenCalledTimes(1);
      expect(manager.getItemIds()).toEqual([]);
      expect(manager.getItemMetrics()).toEqual({});
    });
  });
});
