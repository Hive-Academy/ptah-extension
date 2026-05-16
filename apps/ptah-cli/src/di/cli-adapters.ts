/**
 * TUI-compatible adapters for VS Code-specific services
 *
 * These adapters replace vscode-core services that import the 'vscode'
 * module. They provide the same interface contract expected by downstream
 * consumers (Logger, RpcHandler, etc.).
 *
 * Mirrors apps/ptah-electron/src/di/electron-adapters.ts with CLI-specific
 * adaptations (no Electron/VS Code imports).
 */

import type { IOutputChannel } from '@ptah-extension/platform-core';

/**
 * TUI-compatible OutputManager adapter.
 *
 * The VS Code OutputManager wraps vscode.OutputChannel and tracks metrics.
 * This adapter wraps the platform-cli IOutputChannel (which writes to
 * a log file) and provides the same interface that Logger expects.
 *
 * Logger only calls: createOutputChannel(), write(), show()
 * We implement only what's needed.
 */
export class CliOutputManagerAdapter {
  private readonly channels = new Map<string, IOutputChannel>();

  constructor(private readonly defaultChannel: IOutputChannel) {
    // Pre-register the default channel
    this.channels.set(defaultChannel.name, defaultChannel);
  }

  /**
   * Create or get an output channel.
   * In CLI we reuse the default log-file-backed channel.
   */
  createOutputChannel(config: { name: string }): IOutputChannel {
    const existing = this.channels.get(config.name);
    if (existing) {
      return existing;
    }
    // Reuse the default channel for all "channels" in CLI
    // (we only have one log output destination)
    this.channels.set(config.name, this.defaultChannel);
    return this.defaultChannel;
  }

  /**
   * Write a message to an output channel.
   * Logger calls this to append log lines.
   */
  write(channelName: string, message: string): void {
    const channel = this.channels.get(channelName) ?? this.defaultChannel;
    channel.appendLine(message);
  }

  /**
   * Show an output channel. No-op in CLI (no VS Code output panel).
   */
  show(_channelName: string, _preserveFocus?: boolean): boolean {
    return true;
  }

  /**
   * Dispose all channels.
   */
  dispose(): void {
    this.channels.forEach((channel) => channel.dispose());
    this.channels.clear();
  }
}

/**
 * Log level type matching vscode-core Logger's internal type.
 */
type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * Log context type matching vscode-core Logger's internal type.
 */
interface LogContext {
  service?: string;
  operation?: string;
  metadata?: Record<string, unknown>;
  error?: Error;
  [key: string]: unknown;
}

/**
 * TUI-compatible Logger adapter.
 *
 * The VS Code Logger is @injectable() and depends on OutputManager via
 * @inject(TOKENS.OUTPUT_MANAGER). Since OutputManager imports vscode,
 * we cannot use the original Logger class.
 *
 * This adapter provides the same public API (debug/info/warn/error/show)
 * using CliOutputManagerAdapter instead.
 *
 * This class is registered as a plain value (useValue), not via @injectable(),
 * so it does not need tsyringe decorators.
 */
export class CliLoggerAdapter {
  private static readonly CHANNEL_NAME = 'Ptah';

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private readonly minLevel: LogLevel;
  private readonly logToConsole: boolean;

  constructor(private readonly outputManager: CliOutputManagerAdapter) {
    // Ensure output channel is created
    this.outputManager.createOutputChannel({
      name: CliLoggerAdapter.CHANNEL_NAME,
    });

    // Determine log level from environment
    const explicitLevel = process.env['PTAH_LOG_LEVEL'] as LogLevel | undefined;
    if (
      explicitLevel &&
      CliLoggerAdapter.LEVEL_ORDER[explicitLevel] !== undefined
    ) {
      this.minLevel = explicitLevel;
    } else {
      const isDev = this.detectDevelopmentMode();
      this.minLevel = isDev ? 'debug' : 'info';
    }

    this.logToConsole = this.detectDevelopmentMode();
  }

  private detectDevelopmentMode(): boolean {
    return (
      process.env['NODE_ENV'] === 'development' ||
      process.env['PTAH_LOG_LEVEL'] === 'debug'
    );
  }

  private shouldLog(level: LogLevel): boolean {
    return (
      CliLoggerAdapter.LEVEL_ORDER[level] >=
      CliLoggerAdapter.LEVEL_ORDER[this.minLevel]
    );
  }

  debug(message: string, ...args: unknown[]): void {
    this.log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.log('warn', message, args);
  }

  error(
    message: string | Error,
    errorOrContext?: Error | Record<string, unknown>,
  ): void {
    let actualMessage: string;
    let actualError: Error | undefined;
    let actualContext: Record<string, unknown> | undefined;

    if (message instanceof Error) {
      actualError = message;
      actualMessage = message.message;
      if (errorOrContext && !(errorOrContext instanceof Error)) {
        actualContext = errorOrContext;
      }
    } else {
      actualMessage = message;
      if (errorOrContext instanceof Error) {
        actualError = errorOrContext;
      } else if (errorOrContext) {
        actualContext = errorOrContext;
      }
    }

    const context: LogContext = {
      ...actualContext,
      error: actualError,
    };

    this.logWithContext('error', actualMessage, context);
  }

  logWithContext(level: LogLevel, message: string, context: LogContext): void {
    if (!this.shouldLog(level)) return;

    const levelPrefix = level.toUpperCase().padEnd(5);
    const timestamp = new Date().toISOString();
    const formatted = `[${levelPrefix}] ${timestamp} - ${message}`;

    this.outputManager.write(CliLoggerAdapter.CHANNEL_NAME, formatted);

    if (context.service) {
      this.outputManager.write(
        CliLoggerAdapter.CHANNEL_NAME,
        `  Service: ${context.service}`,
      );
    }

    if (context.operation) {
      this.outputManager.write(
        CliLoggerAdapter.CHANNEL_NAME,
        `  Operation: ${context.operation}`,
      );
    }

    if (context.error) {
      this.outputManager.write(
        CliLoggerAdapter.CHANNEL_NAME,
        `  Error: ${context.error.message}`,
      );
      if (context.error.stack) {
        this.outputManager.write(
          CliLoggerAdapter.CHANNEL_NAME,
          `  Stack trace:`,
        );
        this.outputManager.write(
          CliLoggerAdapter.CHANNEL_NAME,
          context.error.stack,
        );
      }
    }

    if (this.logToConsole) {
      const consoleMsg = `[${level.toUpperCase()}] ${message}`;
      switch (level) {
        case 'debug':
          console.debug(consoleMsg);
          break;
        case 'info':
          console.log(consoleMsg);
          break;
        case 'warn':
          console.warn(consoleMsg);
          break;
        case 'error':
          console.error(consoleMsg, context.error || '');
          break;
      }
    }
  }

  show(): void {
    this.outputManager.show(CliLoggerAdapter.CHANNEL_NAME);
  }

  dispose(): void {
    // No-op: OutputManager handles disposal
  }

  private log(level: LogLevel, message: string, args: unknown[]): void {
    if (!this.shouldLog(level)) return;

    let inlinedMessage = message;
    if (args.length > 0) {
      const inlinedArgs = args
        .map((arg) => {
          try {
            if (typeof arg === 'object' && arg !== null) {
              return JSON.stringify(arg);
            }
            return String(arg);
          } catch {
            return '[Unserializable]';
          }
        })
        .join(' ');
      inlinedMessage = `${message}: ${inlinedArgs}`;
    }

    this.logWithContext(level, inlinedMessage, {});
  }
}
