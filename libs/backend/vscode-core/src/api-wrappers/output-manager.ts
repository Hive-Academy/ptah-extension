/**
 * VS Code Output Manager with Enhanced Channel Management
 * Based on MONSTER_EXTENSION_REFACTOR_PLAN Week 3 specifications
 * Provides centralized output channel management with event bus integration
 */

import * as vscode from 'vscode';
import { injectable, inject } from 'tsyringe';
import { TOKENS } from '../di/tokens';

/**
 * Output channel configuration options
 */
export interface OutputChannelConfig {
  readonly name: string;
  readonly languageId?: string;
  readonly preserveOnReveal?: boolean;
  readonly logLevel?: 'debug' | 'info' | 'warn' | 'error';
}

/**
 * Output channel write options
 */
export interface WriteOptions {
  readonly level?: 'debug' | 'info' | 'warn' | 'error';
  readonly timestamp?: boolean;
  readonly prefix?: string;
}

/**
 * Output message event payload for event bus
 */
export interface OutputMessagePayload {
  readonly channelName: string;
  readonly message: string;
  readonly level: 'debug' | 'info' | 'warn' | 'error';
  readonly timestamp: number;
}

/**
 * Output channel event payload for event bus
 */
export interface OutputChannelCreatedPayload {
  readonly channelName: string;
  readonly languageId?: string;
  readonly timestamp: number;
}

/**
 * Output channel error event payload for event bus
 */
export interface OutputChannelErrorPayload {
  readonly channelName: string;
  readonly operation: string;
  readonly error: string;
  readonly timestamp: number;
}

/**
 * VS Code Output Manager with event integration
 * Provides centralized output channel management with comprehensive monitoring
 */
@injectable()
export class OutputManager {
  private readonly outputChannels = new Map<string, vscode.OutputChannel>();
  private readonly channelMetrics = new Map<
    string,
    {
      messageCount: number;
      lastWrite: number;
      createdAt: number;
      totalWrites: number;
      errorCount: number;
      levelCounts: {
        debug: number;
        info: number;
        warn: number;
        error: number;
      };
    }
  >();

  constructor(
    @inject(TOKENS.EXTENSION_CONTEXT)
    private readonly context: vscode.ExtensionContext
  ) {}

  /**
   * Create or get an output channel with enhanced configuration
   * Automatically sets up metrics tracking and lifecycle management
   *
   * @param config - Output channel configuration
   * @returns Created or existing output channel
   */
  createOutputChannel(config: OutputChannelConfig): vscode.OutputChannel {
    // Check if channel already exists
    if (this.outputChannels.has(config.name)) {
      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
      return this.outputChannels.get(config.name)!;
    }

    try {
      // Create output channel with language ID if provided
      const channel = config.languageId
        ? vscode.window.createOutputChannel(config.name, config.languageId)
        : vscode.window.createOutputChannel(config.name);

      // Store channel reference
      this.outputChannels.set(config.name, channel);

      // Initialize metrics tracking
      this.channelMetrics.set(config.name, {
        messageCount: 0,
        lastWrite: 0,
        createdAt: Date.now(),
        totalWrites: 0,
        errorCount: 0,
        levelCounts: {
          debug: 0,
          info: 0,
          warn: 0,
          error: 0,
        },
      });

      // Add to extension subscriptions for proper cleanup
      this.context.subscriptions.push(channel);

      // Publish channel created event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return channel;
    } catch (error) {
      // Publish error event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      // Re-throw to maintain VS Code error handling
      throw error;
    }
  }

  /**
   * Write a message to an output channel with enhanced options
   * Automatically tracks metrics and publishes events
   *
   * @param channelName - Name of the target output channel
   * @param message - Message to write
   * @param options - Write options for formatting and metadata
   */
  write(
    channelName: string,
    message: string,
    options: WriteOptions = {}
  ): void {
    const channel = this.outputChannels.get(channelName);

    if (!channel) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC
      return;
    }

    try {
      const level = options.level || 'info';
      const timestamp = options.timestamp
        ? `[${new Date().toISOString()}] `
        : '';
      const prefix = options.prefix ? `[${options.prefix}] ` : '';
      const formattedMessage = `${timestamp}${prefix}${message}`;

      // Write message to channel
      channel.appendLine(formattedMessage);

      // Update metrics
      this.updateChannelMetrics(channelName, level, false);

      // Publish message written event (using analytics since we don't have specific output event)
      // TODO: Phase 2 - Restore analytics/error reporting via RPC
    } catch (error) {
      // Update error metrics
      this.updateChannelMetrics(channelName, options.level || 'info', true);

      // Publish error event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      // Re-throw to maintain error handling
      throw error;
    }
  }

  /**
   * Write multiple lines to an output channel
   * Convenient method for bulk writing with consistent formatting
   *
   * @param channelName - Name of the target output channel
   * @param messages - Array of messages to write
   * @param options - Write options applied to all messages
   */
  writeLines(
    channelName: string,
    messages: readonly string[],
    options: WriteOptions = {}
  ): void {
    messages.forEach((message) => this.write(channelName, message, options));
  }

  /**
   * Clear an output channel
   * Resets the channel content while preserving metrics
   *
   * @param channelName - Name of the output channel to clear
   * @returns True if channel was cleared, false if channel not found
   */
  clear(channelName: string): boolean {
    const channel = this.outputChannels.get(channelName);

    if (!channel) {
      return false;
    }

    try {
      channel.clear();

      // Publish clear event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return true;
    } catch (error) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return false;
    }
  }

  /**
   * Show an output channel in the editor
   * Brings the channel to focus with optional column preference
   *
   * @param channelName - Name of the output channel to show
   * @param preserveFocus - Whether to preserve current editor focus
   * @returns True if channel was shown, false if channel not found
   */
  show(channelName: string, preserveFocus = false): boolean {
    const channel = this.outputChannels.get(channelName);

    if (!channel) {
      return false;
    }

    try {
      channel.show(preserveFocus);

      // Publish show event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return true;
    } catch (error) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return false;
    }
  }

  /**
   * Hide an output channel
   * Removes the channel from view without disposing it
   *
   * @param channelName - Name of the output channel to hide
   * @returns True if channel was hidden, false if channel not found
   */
  hide(channelName: string): boolean {
    const channel = this.outputChannels.get(channelName);

    if (!channel) {
      return false;
    }

    try {
      channel.hide();

      // Publish hide event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return true;
    } catch (error) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return false;
    }
  }

  /**
   * Get an output channel by name
   *
   * @param channelName - Name of the output channel to retrieve
   * @returns Output channel or undefined if not found
   */
  getChannel(channelName: string): vscode.OutputChannel | undefined {
    return this.outputChannels.get(channelName);
  }

  /**
   * Check if an output channel exists
   *
   * @param channelName - Name of the channel to check
   * @returns True if channel exists
   */
  hasChannel(channelName: string): boolean {
    return this.outputChannels.has(channelName);
  }

  /**
   * Get output channel metrics for monitoring and debugging
   *
   * @param channelName - Optional specific channel name, or all channels if not provided
   * @returns Metrics for specified channel or all channels
   */
  getChannelMetrics(channelName?: string) {
    if (channelName) {
      return this.channelMetrics.get(channelName) || null;
    }

    return Object.fromEntries(this.channelMetrics);
  }

  /**
   * Get list of all registered channel names
   * Useful for debugging and validation
   *
   * @returns Array of registered channel names
   */
  getChannelNames(): readonly string[] {
    return Array.from(this.outputChannels.keys());
  }

  /**
   * Dispose a specific output channel
   * Properly cleans up resources and stops tracking metrics
   *
   * @param channelName - Name of the channel to dispose
   * @returns True if channel was disposed, false if it wasn't found
   */
  disposeChannel(channelName: string): boolean {
    const channel = this.outputChannels.get(channelName);

    if (!channel) {
      return false;
    }

    try {
      channel.dispose();
      this.outputChannels.delete(channelName);
      this.channelMetrics.delete(channelName);

      // Publish disposal event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return true;
    } catch (error) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC

      return false;
    }
  }

  /**
   * Dispose all registered output channels
   * Should be called during extension deactivation
   */
  dispose(): void {
    try {
      this.outputChannels.forEach((channel) => channel.dispose());
      this.outputChannels.clear();
      this.channelMetrics.clear();

      // Publish disposal event
      // TODO: Phase 2 - Restore analytics/error reporting via RPC
    } catch (error) {
      // TODO: Phase 2 - Restore analytics/error reporting via RPC
    }
  }

  /**
   * Update channel execution metrics
   * Tracks performance and error statistics for monitoring
   */
  private updateChannelMetrics(
    channelName: string,
    level: 'debug' | 'info' | 'warn' | 'error',
    isError: boolean
  ): void {
    const metrics = this.channelMetrics.get(channelName);

    if (!metrics) return;

    metrics.messageCount++;
    metrics.totalWrites++;
    metrics.lastWrite = Date.now();
    metrics.levelCounts[level]++;

    if (isError) {
      metrics.errorCount++;
    }
  }
}
