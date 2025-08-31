import { Injectable } from '@angular/core';

export enum LogLevel {
  DEBUG = 0,
  INFO = 1,
  WARN = 2,
  ERROR = 3,
  NONE = 4,
}

export interface LogEntry {
  timestamp: number;
  level: LogLevel;
  message: string;
  context?: string;
  data?: unknown;
  stack?: string;
}

/**
 * Frontend Logging Service - Structured Logging
 *
 * Provides structured logging for the Angular webview application
 * Replaces console.* calls with proper categorized logging
 * Supports different log levels and contexts
 * Maintains log history for debugging
 */
@Injectable({
  providedIn: 'root',
})
export class LoggingService {
  private currentLevel: LogLevel = LogLevel.INFO;
  private logHistory: LogEntry[] = [];
  private maxHistorySize = 1000;

  // Enable console output in development
  private enableConsoleOutput = true;

  setLogLevel(level: LogLevel): void {
    this.currentLevel = level;
  }

  debug(message: string, context?: string, data?: unknown): void {
    this.log(LogLevel.DEBUG, message, context, data);
  }

  info(message: string, context?: string, data?: unknown): void {
    this.log(LogLevel.INFO, message, context, data);
  }

  warn(message: string, context?: string, data?: unknown): void {
    this.log(LogLevel.WARN, message, context, data);
  }

  error(message: string, context?: string, error?: unknown): void {
    let stack: string | undefined;

    if (error instanceof Error) {
      stack = error.stack;
    }

    this.log(LogLevel.ERROR, message, context, error, stack);
  }

  /**
   * Log component lifecycle events
   */
  lifecycle(component: string, event: 'init' | 'destroy' | 'update', data?: unknown): void {
    this.debug(`Component ${event}`, component, data);
  }

  /**
   * Log service operations
   */
  service(service: string, operation: string, data?: unknown): void {
    this.debug(`Service operation: ${operation}`, service, data);
  }

  /**
   * Log user interactions
   */
  interaction(action: string, component?: string, data?: unknown): void {
    this.info(`User interaction: ${action}`, component, data);
  }

  /**
   * Log performance metrics
   */
  performance(metric: string, value: number, context?: string): void {
    this.debug(`Performance: ${metric} = ${value}ms`, context, { metric, value });
  }

  /**
   * Log API/messaging operations
   */
  api(operation: string, data?: unknown, success: boolean = true): void {
    const level = success ? LogLevel.INFO : LogLevel.WARN;
    const message = `API: ${operation} ${success ? 'succeeded' : 'failed'}`;
    this.log(level, message, 'api', data);
  }

  /**
   * Get recent log entries
   */
  getRecentLogs(count: number = 100): LogEntry[] {
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
    return this.logHistory.filter((entry) => entry.context === context);
  }

  /**
   * Clear log history
   */
  clearHistory(): void {
    this.logHistory = [];
  }

  /**
   * Export logs as JSON string
   */
  exportLogs(): string {
    return JSON.stringify(this.logHistory, null, 2);
  }

  private log(
    level: LogLevel,
    message: string,
    context?: string,
    data?: unknown,
    stack?: string,
  ): void {
    if (level < this.currentLevel) {
      return;
    }

    const entry: LogEntry = {
      timestamp: Date.now(),
      level,
      message,
      context,
      data,
      stack,
    };

    // Add to history
    this.logHistory.push(entry);

    // Maintain history size
    if (this.logHistory.length > this.maxHistorySize) {
      this.logHistory.shift();
    }

    // Console output for development
    if (this.enableConsoleOutput) {
      this.outputToConsole(entry);
    }
  }

  private outputToConsole(entry: LogEntry): void {
    const timestamp = new Date(entry.timestamp).toISOString();
    const context = entry.context ? `[${entry.context}]` : '';
    const prefix = `${timestamp} ${context}`;

    switch (entry.level) {
      case LogLevel.DEBUG:
        console.debug(`${prefix} DEBUG:`, entry.message, entry.data || '');
        break;
      case LogLevel.INFO:
        console.info(`${prefix} INFO:`, entry.message, entry.data || '');
        break;
      case LogLevel.WARN:
        console.warn(`${prefix} WARN:`, entry.message, entry.data || '');
        break;
      case LogLevel.ERROR:
        console.error(`${prefix} ERROR:`, entry.message, entry.data || '');
        if (entry.stack) {
          console.error('Stack trace:', entry.stack);
        }
        break;
    }
  }

  private getLevelName(level: LogLevel): string {
    switch (level) {
      case LogLevel.DEBUG:
        return 'DEBUG';
      case LogLevel.INFO:
        return 'INFO';
      case LogLevel.WARN:
        return 'WARN';
      case LogLevel.ERROR:
        return 'ERROR';
      default:
        return 'UNKNOWN';
    }
  }
}
