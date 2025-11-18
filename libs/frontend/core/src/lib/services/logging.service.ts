import { Injectable, signal } from '@angular/core';

/**
 * Log levels in ascending order of severity
 */
export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

/**
 * Log entry structure
 */
export interface LogEntry {
  timestamp: Date;
  level: LogLevel;
  context: string;
  message: string;
  data?: unknown;
}

/**
 * Centralized logging service with configurable log levels and history
 *
 * Features:
 * - Configurable log level filtering
 * - Log history with max size limit
 * - Context-based logging (component, service, api, performance)
 * - Export logs as JSON
 * - Development mode console output
 *
 * @example
 * ```typescript
 * class MyComponent {
 *   private readonly logger = inject(LoggingService);
 *
 *   ngOnInit() {
 *     this.logger.lifecycle('MyComponent', 'Initialized');
 *   }
 *
 *   handleClick() {
 *     this.logger.interaction('MyComponent', 'Button clicked', { buttonId: 'submit' });
 *   }
 * }
 * ```
 */
/**
 * Configuration for logging service
 */
export interface LoggingConfig {
  level: LogLevel;
  enableConsole: boolean;
  maxHistorySize: number;
}

/**
 * Default logging configuration
 * - Production: Only WARN and ERROR
 * - Development: INFO and above (includes WARN, ERROR)
 * - Debug mode: All logs including DEBUG
 */
const DEFAULT_LOG_CONFIG: LoggingConfig = {
  // Use INFO for development (info, warnings, and errors)
  // Set to DEBUG via window.PTAH_DEBUG_LOGGING = true for troubleshooting
  // Set to WARN for production (only warnings and errors)
  level: LogLevel.INFO,
  enableConsole: true,
  maxHistorySize: 1000,
};

@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  // Signal-based log level for reactive updates
  private readonly _currentLevel = signal<LogLevel>(DEFAULT_LOG_CONFIG.level);
  readonly currentLevel = this._currentLevel.asReadonly();

  private logHistory: LogEntry[] = [];
  private readonly maxHistorySize = DEFAULT_LOG_CONFIG.maxHistorySize;
  private consoleEnabled = DEFAULT_LOG_CONFIG.enableConsole;

  constructor() {
    this.initializeFromEnvironment();
  }

  /**
   * Initialize log level from environment/window variables
   * Supports:
   * - window.PTAH_LOG_LEVEL = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'NONE'
   * - window.PTAH_DEBUG_LOGGING = true (enables DEBUG level)
   */
  private initializeFromEnvironment(): void {
    const win = window as Window & {
      PTAH_LOG_LEVEL?: string;
      PTAH_DEBUG_LOGGING?: boolean;
    };

    // Check for debug mode flag
    if (win.PTAH_DEBUG_LOGGING === true) {
      this._currentLevel.set(LogLevel.DEBUG);
      console.info(
        '[LoggingService] Debug logging enabled via window.PTAH_DEBUG_LOGGING'
      );
      return;
    }

    // Check for explicit log level
    if (win.PTAH_LOG_LEVEL) {
      const levelName = win.PTAH_LOG_LEVEL.toUpperCase();
      const level = LogLevel[levelName as keyof typeof LogLevel];
      if (level !== undefined) {
        this._currentLevel.set(level);
        console.info(
          `[LoggingService] Log level set to ${levelName} via window.PTAH_LOG_LEVEL`
        );
        return;
      }
    }

    console.info(
      `[LoggingService] Using default log level: ${
        LogLevel[this._currentLevel()]
      }`
    );
    console.info(
      '[LoggingService] To enable debug logging, run: window.PTAH_DEBUG_LOGGING = true'
    );
  }

  /**
   * Set the minimum log level
   * Messages below this level will be filtered out
   */
  setLogLevel(level: LogLevel): void {
    this._currentLevel.set(level);
    console.info(`[LoggingService] Log level changed to ${LogLevel[level]}`);
  }

  /**
   * Enable or disable console output
   */
  setConsoleEnabled(enabled: boolean): void {
    this.consoleEnabled = enabled;
    console.info(
      `[LoggingService] Console output ${enabled ? 'enabled' : 'disabled'}`
    );
  }

  /**
   * Get current configuration
   */
  getConfig(): LoggingConfig {
    return {
      level: this._currentLevel(),
      enableConsole: this.consoleEnabled,
      maxHistorySize: this.maxHistorySize,
    };
  }

  /**
   * Debug level logging
   */
  debug(context: string, message: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, context, message, data);
  }

  /**
   * Info level logging
   */
  info(context: string, message: string, data?: unknown): void {
    this.log(LogLevel.INFO, context, message, data);
  }

  /**
   * Warning level logging
   */
  warn(context: string, message: string, data?: unknown): void {
    this.log(LogLevel.WARN, context, message, data);
  }

  /**
   * Error level logging
   */
  error(context: string, message: string, data?: unknown): void {
    this.log(LogLevel.ERROR, context, message, data);
  }

  /**
   * Component lifecycle logging (ngOnInit, ngOnDestroy, etc.)
   */
  lifecycle(
    componentName: string,
    lifecycleHook: string,
    data?: unknown
  ): void {
    this.debug(`[Lifecycle] ${componentName}`, lifecycleHook, data);
  }

  /**
   * Service operation logging
   */
  service(serviceName: string, operation: string, data?: unknown): void {
    this.debug(`[Service] ${serviceName}`, operation, data);
  }

  /**
   * User interaction logging
   */
  interaction(context: string, action: string, data?: unknown): void {
    this.info(`[Interaction] ${context}`, action, data);
  }

  /**
   * Performance metrics logging
   */
  performance(context: string, metric: string, value: number): void {
    this.debug(`[Performance] ${context}`, metric, { value, unit: 'ms' });
  }

  /**
   * API/Message logging
   */
  api(
    direction: 'sent' | 'received',
    messageType: string,
    data?: unknown
  ): void {
    this.debug(`[API] ${direction}`, messageType, data);
  }

  /**
   * Core logging method
   */
  private log(
    level: LogLevel,
    context: string,
    message: string,
    data?: unknown
  ): void {
    // Filter based on current log level
    if (level < this._currentLevel()) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date(),
      level,
      context,
      message,
      data,
    };

    // Add to history with size limit
    this.logHistory.push(entry);
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Console output in development
    this.logToConsole(entry);
  }

  /**
   * Output log entry to browser console
   */
  private logToConsole(entry: LogEntry): void {
    // Skip console output if disabled
    if (!this.consoleEnabled) {
      return;
    }

    const timestamp = entry.timestamp.toISOString();
    const prefix = `[${timestamp}] [${LogLevel[entry.level]}] ${
      entry.context
    }:`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(prefix, entry.message, entry.data ?? '');
        break;
      case LogLevel.INFO:
        console.info(prefix, entry.message, entry.data ?? '');
        break;
      case LogLevel.WARN:
        console.warn(prefix, entry.message, entry.data ?? '');
        break;
      case LogLevel.ERROR:
        console.error(prefix, entry.message, entry.data ?? '');
        break;
    }
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count = 100): LogEntry[] {
    return this.logHistory.slice(-count);
  }

  /**
   * Get logs by level
   */
  getLogsByLevel(level: LogLevel): LogEntry[] {
    return this.logHistory.filter((entry) => entry.level === level);
  }

  /**
   * Get logs by context
   */
  getLogsByContext(context: string): LogEntry[] {
    return this.logHistory.filter((entry) => entry.context.includes(context));
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as JSON
   */
  exportLogs(): string {
    return JSON.stringify(this.logHistory, null, 2);
  }
}
