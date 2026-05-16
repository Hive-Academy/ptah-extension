/**
 * Line-buffered NDJSON parser over an arbitrary `Readable` stream.
 *
 * Wraps `node:readline` with a `.start()` / `.stop()` lifecycle that decodes
 * each line into a JSON-RPC message via the encoder. Tolerates split chunks
 * (`readline` already line-buffers under the hood). Bad JSON does NOT crash
 * — the configured `onParseError` callback is invoked with the raw line.
 *
 * No DI, no globals. Safe to import from any layer; tests pass an arbitrary
 * `Readable` (e.g. `node:stream` `PassThrough`).
 */

import * as readline from 'node:readline';
import type { Readable } from 'node:stream';

import { decodeMessage, type DecodeResult } from '../jsonrpc/encoder.js';
import type { JsonRpcMessage } from '../jsonrpc/types.js';

/** Callback invoked for each successfully decoded JSON-RPC message. */
export type OnMessage = (message: JsonRpcMessage, raw: string) => void;

/** Callback invoked for each malformed line (decoder returned `{ ok: false }`). */
export type OnParseError = (
  result: Extract<DecodeResult, { ok: false }>,
) => void;

/** Callback invoked on EOF / `'close'`. */
export type OnEnd = () => void;

export interface StdinReaderOptions {
  /** Source stream — defaults to `process.stdin`. */
  input?: Readable;
}

/**
 * Stateful reader. `start()` attaches the readline interface; `stop()` detaches
 * it. Calling `start()` twice without `stop()` is a no-op (idempotent).
 */
export class StdinReader {
  private readonly input: Readable;
  private rl: readline.Interface | null = null;
  private onMessage: OnMessage | null = null;
  private onParseError: OnParseError | null = null;
  private onEnd: OnEnd | null = null;

  constructor(options: StdinReaderOptions = {}) {
    this.input = options.input ?? process.stdin;
  }

  /** Begin reading. Subsequent calls are ignored until `stop()` runs. */
  start(handlers: {
    onMessage: OnMessage;
    onParseError?: OnParseError;
    onEnd?: OnEnd;
  }): void {
    if (this.rl !== null) {
      // Already started — caller bug, but tolerate it.
      return;
    }

    this.onMessage = handlers.onMessage;
    this.onParseError = handlers.onParseError ?? null;
    this.onEnd = handlers.onEnd ?? null;

    this.rl = readline.createInterface({
      input: this.input,
      // Disable terminal mode so we don't emit echo / cursor escape sequences
      // when stdin happens to be a TTY in dev shells.
      terminal: false,
      crlfDelay: Infinity,
    });

    this.rl.on('line', (line) => this.handleLine(line));
    this.rl.on('close', () => this.handleClose());
  }

  /** Detach handlers and close the readline interface. */
  stop(): void {
    if (this.rl === null) {
      return;
    }
    this.rl.removeAllListeners();
    this.rl.close();
    this.rl = null;
    this.onMessage = null;
    this.onParseError = null;
    this.onEnd = null;
  }

  private handleLine(line: string): void {
    // Skip blank lines silently — common when piping with extra `\n`.
    if (line.length === 0 || line.trim().length === 0) {
      return;
    }

    const decoded = decodeMessage(line);
    if (decoded.ok === true) {
      this.onMessage?.(decoded.message, line);
      return;
    }
    // Narrow explicitly (some downstream tsconfigs do not have strict mode
    // enabled and won't narrow the discriminated union via `else`).
    const failure: Extract<typeof decoded, { ok: false }> = decoded;
    this.onParseError?.(failure);
  }

  private handleClose(): void {
    const cb = this.onEnd;
    // Detach state BEFORE invoking the callback so handlers can call `start()`
    // again on a fresh stream from inside `onEnd` if they want to.
    this.rl = null;
    this.onMessage = null;
    this.onParseError = null;
    this.onEnd = null;
    cb?.();
  }
}
