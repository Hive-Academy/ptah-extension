/**
 * VS Code Status Bar Manager with Enhanced Item Management
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN Week 3 specifications
 * Provides reactive status bar management with event bus integration
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { EventBus } from '../messaging/event-bus';
import { TOKENS } from '../di/tokens';
import {
  ANALYTICS_MESSAGE_TYPES,
  SYSTEM_MESSAGE_TYPES,
} from '@ptah-extension/shared';

/**
 * Status bar item configuration options
 */
export interface StatusBarItemConfig {
  readonly id: string;
  readonly alignment?: vscode.StatusBarAlignment;
  readonly priority?: number;
  readonly text?: string;
  readonly tooltip?: string;
  readonly color?: string | vscode.ThemeColor;
  readonly backgroundColor?: vscode.ThemeColor;
  readonly command?: string | vscode.Command;
  readonly accessibilityInformation?: vscode.AccessibilityInformation;
}

/**
 * Status bar item update options
 */
export interface StatusBarItemUpdate {
  readonly text?: string;
  readonly tooltip?: string;
  readonly color?: string | vscode.ThemeColor;
  readonly backgroundColor?: vscode.ThemeColor;
  readonly command?: string | vscode.Command;
  readonly accessibilityInformation?: vscode.AccessibilityInformation;
}

/**
 * Status bar item event payload for event bus
 */
export interface StatusBarItemCreatedPayload {
  readonly itemId: string;
  readonly alignment: vscode.StatusBarAlignment;
  readonly priority: number;
  readonly timestamp: number;
}

/**
 * Status bar item state change event payload for event bus
 */
export interface StatusBarItemUpdatedPayload {
  readonly itemId: string;
  readonly properties: string[];
  readonly timestamp: number;
}

/**
 * Status bar item click event payload for event bus
 */
export interface StatusBarItemClickedPayload {
  readonly itemId: string;
  readonly command?: string;
  readonly timestamp: number;
}

/**
 * Status bar item error event payload for event bus
 */
export interface StatusBarItemErrorPayload {
  readonly itemId: string;
  readonly operation: string;
  readonly error: string;
  readonly timestamp: number;
}

/**
 * VS Code Status Bar Manager with event integration
 * Provides centralized status bar item management with comprehensive monitoring
 */
@injectable()
export class StatusBarManager {
  private readonly statusBarItems = new Map<string, vscode.StatusBarItem>();
  private readonly itemMetrics = new Map<
    string,
    {
      createdAt: number;
      updateCount: number;
      lastUpdate: number;
      clickCount: number;
      lastClick: number;
      isVisible: boolean;
      errorCount: number;
    }
  >();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext,
    @inject(TOKENS.EVENT_BUS) private readonly eventBus: EventBus
  ) {}

  /**
   * Create a status bar item with enhanced configuration
   * Automatically sets up metrics tracking and lifecycle management
   *
   * @param config - Status bar item configuration
   * @returns Created status bar item
   */
  createStatusBarItem(config: StatusBarItemConfig): vscode.StatusBarItem {
    // Check if item already exists
    if (this.statusBarItems.has(config.id)) {
      return this.statusBarItems.get(config.id)!;
    }

    try {
      // Create status bar item with alignment and priority
      const item = vscode.window.createStatusBarItem(
        config.id,
        config.alignment || vscode.StatusBarAlignment.Right,
        config.priority || 0
      );

      // Configure initial properties
      if (config.text) item.text = config.text;
      if (config.tooltip) item.tooltip = config.tooltip;
      if (config.color) item.color = config.color;
      if (config.backgroundColor) item.backgroundColor = config.backgroundColor;
      if (config.command) item.command = config.command;
      if (config.accessibilityInformation) {
        item.accessibilityInformation = config.accessibilityInformation;
      }

      // Store item reference
      this.statusBarItems.set(config.id, item);

      // Initialize metrics tracking
      this.itemMetrics.set(config.id, {
        createdAt: Date.now(),
        updateCount: 0,
        lastUpdate: 0,
        clickCount: 0,
        lastClick: 0,
        isVisible: false, // Items start hidden by default
        errorCount: 0,
      });

      // Add to extension subscriptions for proper cleanup
      this.context.subscriptions.push(item);

      // Publish item created event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:itemCreated',
        properties: {
          itemId: config.id,
          alignment: config.alignment || vscode.StatusBarAlignment.Right,
          priority: config.priority || 0,
          hasText: !!config.text,
          hasTooltip: !!config.tooltip,
          hasCommand: !!config.command,
          timestamp: Date.now(),
        },
      });

      return item;
    } catch (error) {
      // Publish error event
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_CREATE_FAILED',
        message: `Failed to create status bar item ${config.id}: ${error}`,
        source: 'StatusBarManager',
        data: { config },
        timestamp: Date.now(),
      });

      // Re-throw to maintain VS Code error handling
      throw error;
    }
  }

  /**
   * Update a status bar item with new properties
   * Automatically tracks state changes and publishes events
   *
   * @param itemId - ID of the status bar item to update
   * @param update - Properties to update
   * @returns True if item was updated, false if item not found
   */
  updateStatusBarItem(itemId: string, update: StatusBarItemUpdate): boolean {
    const item = this.statusBarItems.get(itemId);

    if (!item) {
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_NOT_FOUND',
        message: `Status bar item ${itemId} not found`,
        source: 'StatusBarManager',
        data: { itemId, update },
        timestamp: Date.now(),
      });
      return false;
    }

    try {
      const updatedProperties: string[] = [];

      // Update properties and track changes
      if (update.text !== undefined) {
        item.text = update.text;
        updatedProperties.push('text');
      }
      if (update.tooltip !== undefined) {
        item.tooltip = update.tooltip;
        updatedProperties.push('tooltip');
      }
      if (update.color !== undefined) {
        item.color = update.color;
        updatedProperties.push('color');
      }
      if (update.backgroundColor !== undefined) {
        item.backgroundColor = update.backgroundColor;
        updatedProperties.push('backgroundColor');
      }
      if (update.command !== undefined) {
        item.command = update.command;
        updatedProperties.push('command');
      }
      if (update.accessibilityInformation !== undefined) {
        item.accessibilityInformation = update.accessibilityInformation;
        updatedProperties.push('accessibilityInformation');
      }

      // Update metrics
      this.updateItemMetrics(itemId, 'update', false);

      // Publish update event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:itemUpdated',
        properties: {
          itemId,
          propertiesUpdated: updatedProperties.length,
          updatedProperties: updatedProperties.join(','),
          timestamp: Date.now(),
        },
      });

      return true;
    } catch (error) {
      // Update error metrics
      this.updateItemMetrics(itemId, 'update', true);

      // Publish error event
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_UPDATE_FAILED',
        message: `Failed to update status bar item ${itemId}: ${error}`,
        source: 'StatusBarManager',
        data: { itemId, update },
        timestamp: Date.now(),
      });

      return false;
    }
  }

  /**
   * Show a status bar item
   * Makes the item visible in the status bar
   *
   * @param itemId - ID of the status bar item to show
   * @returns True if item was shown, false if item not found
   */
  show(itemId: string): boolean {
    const item = this.statusBarItems.get(itemId);

    if (!item) {
      return false;
    }

    try {
      item.show();

      // Update visibility in metrics
      const metrics = this.itemMetrics.get(itemId);
      if (metrics) {
        metrics.isVisible = true;
      }

      // Publish show event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:itemShown',
        properties: {
          itemId,
          timestamp: Date.now(),
        },
      });

      return true;
    } catch (error) {
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_SHOW_FAILED',
        message: `Failed to show status bar item ${itemId}: ${error}`,
        source: 'StatusBarManager',
        data: { itemId },
        timestamp: Date.now(),
      });

      return false;
    }
  }

  /**
   * Hide a status bar item
   * Removes the item from the status bar without disposing it
   *
   * @param itemId - ID of the status bar item to hide
   * @returns True if item was hidden, false if item not found
   */
  hide(itemId: string): boolean {
    const item = this.statusBarItems.get(itemId);

    if (!item) {
      return false;
    }

    try {
      item.hide();

      // Update visibility in metrics
      const metrics = this.itemMetrics.get(itemId);
      if (metrics) {
        metrics.isVisible = false;
      }

      // Publish hide event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:itemHidden',
        properties: {
          itemId,
          timestamp: Date.now(),
        },
      });

      return true;
    } catch (error) {
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_HIDE_FAILED',
        message: `Failed to hide status bar item ${itemId}: ${error}`,
        source: 'StatusBarManager',
        data: { itemId },
        timestamp: Date.now(),
      });

      return false;
    }
  }

  /**
   * Simulate a click event for analytics tracking
   * This should be called when status bar item commands are executed
   *
   * @param itemId - ID of the status bar item that was clicked
   * @param command - Optional command that was executed
   */
  trackClick(itemId: string, command?: string): void {
    if (!this.statusBarItems.has(itemId)) {
      return;
    }

    // Update click metrics
    this.updateItemMetrics(itemId, 'click', false);

    // Publish click event
    this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
      event: 'statusBar:itemClicked',
      properties: {
        itemId,
        hasCommand: !!command,
        command: command || 'none',
        timestamp: Date.now(),
      },
    });
  }

  /**
   * Get a status bar item by ID
   *
   * @param itemId - ID of the status bar item to retrieve
   * @returns Status bar item or undefined if not found
   */
  getItem(itemId: string): vscode.StatusBarItem | undefined {
    return this.statusBarItems.get(itemId);
  }

  /**
   * Check if a status bar item exists
   *
   * @param itemId - ID of the item to check
   * @returns True if item exists
   */
  hasItem(itemId: string): boolean {
    return this.statusBarItems.has(itemId);
  }

  /**
   * Get status bar item metrics for monitoring and debugging
   *
   * @param itemId - Optional specific item ID, or all items if not provided
   * @returns Metrics for specified item or all items
   */
  getItemMetrics(itemId?: string) {
    if (itemId) {
      return this.itemMetrics.get(itemId) || null;
    }

    return Object.fromEntries(this.itemMetrics);
  }

  /**
   * Get list of all registered status bar item IDs
   * Useful for debugging and validation
   *
   * @returns Array of registered item IDs
   */
  getItemIds(): readonly string[] {
    return Array.from(this.statusBarItems.keys());
  }

  /**
   * Dispose a specific status bar item
   * Properly cleans up resources and stops tracking metrics
   *
   * @param itemId - ID of the item to dispose
   * @returns True if item was disposed, false if it wasn't found
   */
  disposeItem(itemId: string): boolean {
    const item = this.statusBarItems.get(itemId);

    if (!item) {
      return false;
    }

    try {
      item.dispose();
      this.statusBarItems.delete(itemId);
      this.itemMetrics.delete(itemId);

      // Publish disposal event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:itemDisposed',
        properties: {
          itemId,
          timestamp: Date.now(),
        },
      });

      return true;
    } catch (error) {
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_ITEM_DISPOSE_FAILED',
        message: `Failed to dispose status bar item ${itemId}: ${error}`,
        source: 'StatusBarManager',
        data: { itemId },
        timestamp: Date.now(),
      });

      return false;
    }
  }

  /**
   * Dispose all registered status bar items
   * Should be called during extension deactivation
   */
  dispose(): void {
    try {
      this.statusBarItems.forEach((item) => item.dispose());
      this.statusBarItems.clear();
      this.itemMetrics.clear();

      // Publish disposal event
      this.eventBus.publish(ANALYTICS_MESSAGE_TYPES.TRACK_EVENT, {
        event: 'statusBar:managerDisposed',
        properties: {
          timestamp: Date.now(),
        },
      });
    } catch (error) {
      this.eventBus.publish(SYSTEM_MESSAGE_TYPES.ERROR, {
        code: 'STATUS_BAR_MANAGER_DISPOSE_FAILED',
        message: `Failed to dispose StatusBarManager: ${error}`,
        source: 'StatusBarManager',
        timestamp: Date.now(),
      });
    }
  }

  /**
   * Update status bar item metrics
   * Tracks performance and usage statistics for monitoring
   */
  private updateItemMetrics(
    itemId: string,
    operation: 'update' | 'click',
    isError: boolean
  ): void {
    const metrics = this.itemMetrics.get(itemId);

    if (!metrics) return;

    if (operation === 'update') {
      metrics.updateCount++;
      metrics.lastUpdate = Date.now();
    } else if (operation === 'click') {
      metrics.clickCount++;
      metrics.lastClick = Date.now();
    }

    if (isError) {
      metrics.errorCount++;
    }
  }
}
