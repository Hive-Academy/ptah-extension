/**
 * Configuration Management Types - Type definitions for configuration
 */

import type * as vscode from 'vscode';
import type { z } from 'zod';

/**
 * Configuration watcher for monitoring config changes
 * Tracks a specific configuration key and notifies on changes
 */
export interface ConfigWatcher {
  /**
   * Configuration key being watched
   */
  readonly key: string;

  /**
   * Callback function executed when configuration changes
   */
  readonly callback: (value: unknown) => void;

  /**
   * VS Code disposable for cleanup
   */
  readonly disposable: vscode.Disposable;
}

/**
 * Configuration schema with metadata
 * Provides type-safe configuration with validation and defaults
 */
export interface ConfigurationSchema<T> {
  /**
   * Configuration key (dot-notation path)
   */
  readonly key: string;

  /**
   * Default value when configuration is not set
   */
  readonly default: T;

  /**
   * Configuration scope (workspace or global)
   */
  readonly scope: 'workspace' | 'global';

  /**
   * Optional Zod validator for runtime validation
   */
  readonly validator?: z.ZodSchema<T>;

  /**
   * Optional type guard function
   */
  readonly isValid?: (value: unknown) => value is T;
}

/**
 * Configuration update options
 */
export interface ConfigUpdateOptions {
  /**
   * Target scope for the configuration update
   */
  readonly target?: vscode.ConfigurationTarget;

  /**
   * Whether to validate the value before updating
   */
  readonly validate?: boolean;
}
