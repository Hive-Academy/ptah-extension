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
@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  // Signal-based log level for reactive updates
  private readonly _currentLevel = signal<LogLevel>(LogLevel.INFO);
  readonly currentLevel = this._currentLevel.asReadonly();

  private logHistory: LogEntry[] = [];
  private readonly maxHistorySize = 1000;

  /**
   * Set the minimum log level
   * Messages below this level will be filtered out
   */
  setLogLevel(level: LogLevel): void {
    this._currentLevel.set(level);
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
