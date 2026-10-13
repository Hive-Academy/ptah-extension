/**
 * Electron-compatible adapters for VS Code-specific services
 *
 * These adapters replace vscode-core services that import the 'vscode' module.
 * They provide the same interface contract expected by downstream consumers
 * (Logger, RpcHandler, etc.).
 *
 * Why these exist:
 * - OutputManager uses vscode.window.createOutputChannel -> replace with IOutputChannel wrapper
 * - Logger depends on OutputManager -> create adapter that works with our wrapper
 *
 * Note: LicenseService and AuthSecretsService now use `import type` for vscode,
 * so they have no runtime vscode dependency and can be used directly in Electron.
 */

import type { IOutputChannel } from '@ptah-extension/platform-core';

import {
  REDACTED,
  isSecretFieldName,
  redactSecrets,
} from '../services/diagnostics/log-redaction';

/**
 * Electron-compatible OutputManager adapter.
 *
 * The VS Code OutputManager wraps vscode.OutputChannel and tracks metrics.
 * This adapter wraps the platform-electron IOutputChannel (which writes to
 * a log file) and provides the same interface that Logger expects.
 *
 * Logger only calls: createOutputChannel(), write(), show()
 * We implement only what's needed.
 */
export class ElectronOutputManagerAdapter {
  private readonly channels = new Map<string, IOutputChannel>();

  constructor(private readonly defaultChannel: IOutputChannel) {
    this.channels.set(defaultChannel.name, defaultChannel);
  }

  /**
   * Create or get an output channel.
   * In Electron we reuse the default log-file-backed channel.
   */
  createOutputChannel(config: { name: string }): IOutputChannel {
    const existing = this.channels.get(config.name);
    if (existing) {
      return existing;
    }
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
   * Show an output channel. No-op in Electron (no VS Code output panel).
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

/** Context keys `logWithContext` already writes on their own lines. */
const CONTEXT_LINE_KEYS: ReadonlySet<string> = new Set([
  'service',
  'operation',
  'error',
]);

/** Upper bound for one serialized `Context:` line in the log file. */
const MAX_CONTEXT_CHARS = 8_192;

/** Values copied per `Context:` line; later or deeper values are dropped. */
const MAX_CONTEXT_NODES = 500;

/** Items kept from one array value in a `Context:` line. */
const MAX_CONTEXT_ARRAY_ITEMS = 50;

interface ContextBudget {
  nodes: number;
  readonly seen: Set<object>;
}

/**
 * Copy one context value into plain JSON data with bounded work. It never
 * calls `toJSON` (caller code), cuts long strings and arrays, redacts
 * credentials, and stops descending once {@link MAX_CONTEXT_NODES} values were
 * copied.
 */
function boundContextValue(value: unknown, budget: ContextBudget): unknown {
  budget.nodes += 1;
  if (budget.nodes > MAX_CONTEXT_NODES) return '…';
  if (typeof value === 'string') {
    const kept =
      value.length > MAX_CONTEXT_CHARS
        ? `${value.slice(0, MAX_CONTEXT_CHARS)}…`
        : value;
    return redactSecrets(kept);
  }
  if (typeof value === 'bigint') return `${value}n`;
  if (typeof value === 'function' || typeof value === 'symbol') {
    return undefined;
  }
  if (value === null || typeof value !== 'object') return value;
  if (budget.seen.has(value)) return '[Circular]';
  budget.seen.add(value);
  return boundContextObject(value, budget);
}

function boundContextObject(value: object, budget: ContextBudget): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: boundContextValue(value.message, budget),
    };
  }
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? 'Invalid Date' : value.toISOString();
  }
  if (value instanceof Map) return `[Map size=${value.size}]`;
  if (value instanceof Set) return `[Set size=${value.size}]`;
  if (Array.isArray(value)) return boundContextArray(value, budget);
  return boundContextEntries(value, budget);
}

function boundContextArray(
  value: readonly unknown[],
  budget: ContextBudget,
): unknown[] {
  const items: unknown[] = [];
  const kept = Math.min(value.length, MAX_CONTEXT_ARRAY_ITEMS);
  for (let i = 0; i < kept; i++) {
    if (budget.nodes >= MAX_CONTEXT_NODES) break;
    items.push(boundContextValue(value[i], budget) ?? null);
  }
  if (value.length > items.length) {
    items.push(`…[${value.length - items.length} more]`);
  }
  return items;
}

/** Text for a context field written on its own line (`Service:` etc.). */
function contextLineText(value: unknown): string {
  if (typeof value === 'string') {
    return redactSecrets(
      value.length > MAX_CONTEXT_CHARS
        ? `${value.slice(0, MAX_CONTEXT_CHARS)}…`
        : value,
    );
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return JSON.stringify(
    boundContextValue(value, { nodes: 0, seen: new Set() }) ?? null,
  );
}

/** Read one context field; a throwing getter reads as undefined. */
function readContextField(source: object, key: string): unknown {
  try {
    return (source as Record<string, unknown>)[key];
  } catch {
    // degradation-audit: optional-capability - the field is optional log
    // detail; the entry is still written without it.
    return undefined;
  }
}

/**
 * Own enumerable entries of `source`, bounded; `skip` keys are left out and a
 * credential field's value is never read.
 */
function boundContextEntries(
  source: object,
  budget: ContextBudget,
  skip?: ReadonlySet<string>,
): Record<string, unknown> {
  const entries: Record<string, unknown> = {};
  for (const key in source) {
    if (!Object.hasOwn(source, key)) continue;
    if (skip?.has(key)) continue;
    if (budget.nodes >= MAX_CONTEXT_NODES) {
      entries['…'] = 'more keys dropped';
      break;
    }
    if (isSecretFieldName(key)) {
      entries[key] = REDACTED;
      continue;
    }
    let raw: unknown;
    try {
      raw = (source as Record<string, unknown>)[key];
    } catch {
      // degradation-audit: optional-capability - one throwing getter loses
      // only its own field; the other context fields are still written.
      entries[key] = '[Unreadable]';
      continue;
    }
    const bounded = boundContextValue(raw, budget);
    if (bounded !== undefined) entries[key] = bounded;
  }
  return entries;
}

/**
 * Electron-compatible Logger adapter.
 *
 * The VS Code Logger is @injectable() and depends on OutputManager via
 * @inject(TOKENS.OUTPUT_MANAGER). Since OutputManager imports vscode,
 * we cannot use the original Logger class.
 *
 * This adapter provides the same public API (debug/info/warn/error/show)
 * using ElectronOutputManagerAdapter instead.
 *
 * This class is registered as a plain value (useValue), not via @injectable(),
 * so it does not need tsyringe decorators.
 */
export class ElectronLoggerAdapter {
  private static readonly CHANNEL_NAME = 'Ptah';

  private static readonly LEVEL_ORDER: Record<LogLevel, number> = {
    debug: 0,
    info: 1,
    warn: 2,
    error: 3,
  };

  private readonly minLevel: LogLevel;
  private readonly logToConsole: boolean;

  constructor(private readonly outputManager: ElectronOutputManagerAdapter) {
    this.outputManager.createOutputChannel({
      name: ElectronLoggerAdapter.CHANNEL_NAME,
    });
    const explicitLevel = process.env['PTAH_LOG_LEVEL'] as LogLevel | undefined;
    if (
      explicitLevel &&
      ElectronLoggerAdapter.LEVEL_ORDER[explicitLevel] !== undefined
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
      ElectronLoggerAdapter.LEVEL_ORDER[level] >=
      ElectronLoggerAdapter.LEVEL_ORDER[this.minLevel]
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

    // The caller's context is passed through, never spread: a spread would
    // run every getter here, outside the guarded, bounded copy below.
    this.writeEntry('error', actualMessage, actualContext ?? {}, actualError);
  }

  logWithContext(level: LogLevel, message: string, context: LogContext): void {
    const error = readContextField(context, 'error');
    this.writeEntry(
      level,
      message,
      context,
      error instanceof Error ? error : undefined,
    );
  }

  private writeEntry(
    level: LogLevel,
    message: string,
    context: object,
    error: Error | undefined,
  ): void {
    if (!this.shouldLog(level)) return;

    const levelPrefix = level.toUpperCase().padEnd(5);
    const timestamp = new Date().toISOString();
    const formatted = `[${levelPrefix}] ${timestamp} - ${message}`;

    this.outputManager.write(ElectronLoggerAdapter.CHANNEL_NAME, formatted);

    const service = readContextField(context, 'service');
    if (service) {
      this.outputManager.write(
        ElectronLoggerAdapter.CHANNEL_NAME,
        `  Service: ${contextLineText(service)}`,
      );
    }

    const operation = readContextField(context, 'operation');
    if (operation) {
      this.outputManager.write(
        ElectronLoggerAdapter.CHANNEL_NAME,
        `  Operation: ${contextLineText(operation)}`,
      );
    }

    // A non-Error `error` field (often `error: err.message`) is still detail.
    const errorField = error ? undefined : readContextField(context, 'error');
    if (errorField !== undefined && errorField !== null) {
      this.outputManager.write(
        ElectronLoggerAdapter.CHANNEL_NAME,
        `  Error: ${contextLineText(errorField)}`,
      );
    }

    if (error) {
      this.outputManager.write(
        ElectronLoggerAdapter.CHANNEL_NAME,
        `  Error: ${redactSecrets(error.message)}`,
      );
      if (error.stack) {
        this.outputManager.write(
          ElectronLoggerAdapter.CHANNEL_NAME,
          `  Stack trace:`,
        );
        this.outputManager.write(
          ElectronLoggerAdapter.CHANNEL_NAME,
          redactSecrets(error.stack),
        );
      }
    }

    // Structured context (`logger.error(msg, { ... })`) is the only place a
    // caller's details live — the renderer console forwarder puts the console
    // text here. Mirrors vscode-core `Logger.writeLogEntry`.
    let details: Record<string, unknown>;
    try {
      details = boundContextEntries(
        context,
        { nodes: 0, seen: new Set() },
        CONTEXT_LINE_KEYS,
      );
    } catch {
      // degradation-audit: optional-capability - an object whose keys cannot
      // be enumerated (e.g. a throwing proxy) keeps the log line itself.
      details = { context: '[Unreadable]' };
    }
    if (Object.keys(details).length > 0) {
      let serialized = JSON.stringify(details);
      if (serialized.length > MAX_CONTEXT_CHARS) {
        // Still one JSON value: the head is a string. Escaping can double it
        // (every char a quote or backslash), so it gets under half the budget,
        // leaving room for the wrapper keys.
        const head = serialized.slice(0, MAX_CONTEXT_CHARS / 2 - 64);
        serialized = JSON.stringify({
          truncatedChars: serialized.length - head.length,
          head,
        });
      }
      this.outputManager.write(
        ElectronLoggerAdapter.CHANNEL_NAME,
        `  Context: ${serialized}`,
      );
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
          console.error(consoleMsg, error ?? '');
          break;
      }
    }
  }

  show(): void {
    this.outputManager.show(ElectronLoggerAdapter.CHANNEL_NAME);
  }

  dispose(): void {}

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
            // degradation-audit: optional-capability - inlining a log argument
            // is optional detail; the placeholder keeps the message itself
            // intact rather than letting a cyclic object break logging.
            return '[Unserializable]';
          }
        })
        .join(' ');
      inlinedMessage = `${message}: ${inlinedArgs}`;
    }

    this.logWithContext(level, inlinedMessage, {});
  }
}
