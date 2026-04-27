/**
 * Output formatter — JSON-RPC NDJSON (default) vs human-readable pretty
 * printer.
 *
 * TASK_2026_104 Batch 3.
 *
 * Both formatters share a common `Formatter` interface so commands and the
 * event-pipe can stay agnostic of which mode is active. The factory
 * `buildFormatter(globals)` resolves the mode from the global flags and
 * environment (`NO_COLOR`, `--no-color`).
 *
 * `JsonFormatter` writes via the shared `StdoutWriter` so backpressure +
 * serial ordering are honored. `HumanFormatter` does the same; ANSI color
 * codes are emitted inline (no `chalk` dep — task constraint).
 */

import {
  encodeError,
  encodeNotification,
  encodeRequest,
  encodeResponse,
} from '../jsonrpc/encoder.js';
import type { RequestId } from '../jsonrpc/types.js';
import { StdoutWriter } from '../io/stdout-writer.js';

/** Subset of resolved global flags the formatter cares about. */
export interface FormatterGlobals {
  human?: boolean;
  noColor?: boolean;
  quiet?: boolean;
}

/**
 * Cross-mode formatter contract. Each method returns a promise that resolves
 * once the underlying writer accepts the chunk.
 */
export interface Formatter {
  writeNotification(method: string, params?: unknown): Promise<void>;
  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void>;
  writeResponse(id: RequestId | null, result: unknown): Promise<void>;
  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void>;
  /** Flush + release any held resources. Idempotent. */
  close(): Promise<void>;
}

/** JSON-RPC NDJSON formatter (the default). */
export class JsonFormatter implements Formatter {
  constructor(private readonly writer: StdoutWriter) {}

  writeNotification(method: string, params?: unknown): Promise<void> {
    return this.writer.write(encodeNotification(method, params));
  }

  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void> {
    return this.writer.write(encodeRequest(id, method, params));
  }

  writeResponse(id: RequestId | null, result: unknown): Promise<void> {
    return this.writer.write(encodeResponse(id, result));
  }

  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    return this.writer.write(encodeError(id, code, message, data));
  }

  close(): Promise<void> {
    return this.writer.flush();
  }
}

// ---------------------------------------------------------------------------
// Human-readable formatter
// ---------------------------------------------------------------------------

/** Minimal ANSI palette — intentionally hand-rolled (no `chalk` dep). */
const ANSI = {
  reset: '\x1b[0m',
  bold: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  gray: '\x1b[90m',
} as const;

type AnsiKey = keyof typeof ANSI;

/** Decide whether color is allowed for the current invocation. */
export function shouldUseColor(globals: FormatterGlobals = {}): boolean {
  if (globals.noColor) return false;
  if (typeof process !== 'undefined' && process.env) {
    if (
      process.env['NO_COLOR'] !== undefined &&
      process.env['NO_COLOR'] !== ''
    ) {
      return false;
    }
    if (process.env['PTAH_NO_TTY'] === '1') return false;
  }
  return true;
}

/**
 * Pretty-printer for `--human` mode. Renders each event as a one- or
 * two-line summary with a colored prefix and indented key/value body. Does
 * NOT emit JSON-RPC envelope — the human view is a debugging convenience,
 * not a machine contract.
 */
export class HumanFormatter implements Formatter {
  private readonly useColor: boolean;

  constructor(
    private readonly writer: StdoutWriter,
    globals: FormatterGlobals = {},
  ) {
    this.useColor = shouldUseColor(globals);
  }

  writeNotification(method: string, params?: unknown): Promise<void> {
    const prefix = this.color(this.prefixFor(method), this.colorFor(method));
    const body = params === undefined ? '' : ` ${this.format(params)}`;
    return this.writer.write(`${prefix} ${method}${body}\n`);
  }

  writeRequest(id: RequestId, method: string, params?: unknown): Promise<void> {
    const prefix = this.color('?', 'cyan');
    const idTag = this.color(`#${String(id)}`, 'dim');
    const body = params === undefined ? '' : ` ${this.format(params)}`;
    return this.writer.write(`${prefix} ${method} ${idTag}${body}\n`);
  }

  writeResponse(id: RequestId | null, result: unknown): Promise<void> {
    const prefix = this.color('<', 'green');
    const idTag = this.color(`#${String(id ?? 'null')}`, 'dim');
    return this.writer.write(`${prefix} ${idTag} ${this.format(result)}\n`);
  }

  writeError(
    id: RequestId | null,
    code: number,
    message: string,
    data?: unknown,
  ): Promise<void> {
    const prefix = this.color('!', 'red');
    const idTag = this.color(`#${String(id ?? 'null')}`, 'dim');
    const codeTag = this.color(`(${code})`, 'yellow');
    const dataPart = data === undefined ? '' : ` ${this.format(data)}`;
    return this.writer.write(
      `${prefix} ${idTag} ${codeTag} ${message}${dataPart}\n`,
    );
  }

  close(): Promise<void> {
    return this.writer.flush();
  }

  private prefixFor(method: string): string {
    if (method.startsWith('task.')) return '*';
    if (method.startsWith('agent.')) return '>';
    if (method.startsWith('session.')) return '~';
    if (method.startsWith('debug.')) return '.';
    return '-';
  }

  private colorFor(method: string): AnsiKey {
    if (method.endsWith('.error')) return 'red';
    if (method.endsWith('.complete')) return 'green';
    if (method.startsWith('agent.tool')) return 'magenta';
    if (method.startsWith('agent.')) return 'blue';
    if (method.startsWith('session.')) return 'yellow';
    if (method.startsWith('debug.')) return 'gray';
    return 'cyan';
  }

  private color(text: string, key: AnsiKey): string {
    if (!this.useColor) return text;
    return `${ANSI[key]}${text}${ANSI.reset}`;
  }

  private format(value: unknown): string {
    if (value === null || value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export interface BuildFormatterOptions extends FormatterGlobals {
  /** Override the underlying writer (tests). */
  writer?: StdoutWriter;
}

/**
 * Resolve which formatter to instantiate based on global flags + env. The
 * caller may pre-supply a writer (e.g. tests with a `PassThrough` stream).
 */
export function buildFormatter(options: BuildFormatterOptions = {}): Formatter {
  const writer = options.writer ?? new StdoutWriter();
  if (options.human) {
    return new HumanFormatter(writer, options);
  }
  return new JsonFormatter(writer);
}
