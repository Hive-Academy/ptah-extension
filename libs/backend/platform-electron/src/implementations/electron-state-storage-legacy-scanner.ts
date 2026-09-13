import { createHash } from 'node:crypto';
import type { FileHandle } from 'node:fs/promises';

export const LEGACY_SCAN_CHUNK_BYTES = 64 * 1024;

export class ElectronStateLegacyFormatError extends Error {
  override readonly name = 'ElectronStateLegacyFormatError';

  constructor(
    readonly offset: number,
    readonly detail: string,
  ) {
    super(`Legacy state file is malformed at byte ${offset}: ${detail}`);
  }
}

export interface LegacyScanVisitor {
  onEntry(
    key: string,
    valueStart: number,
    valueEnd: number,
    elementCount: number | null,
  ): void | Promise<void>;
  onElement(
    key: string,
    index: number,
    start: number,
    end: number,
  ): void | Promise<void>;
}

export interface LegacyScanOptions {
  readonly splitKeys: ReadonlySet<string>;
  readonly chunkBytes?: number;
}

export interface LegacyScanResult {
  readonly sha256: string;
  readonly size: number;
}

type LegacyScanEvent =
  | {
      readonly kind: 'entry';
      readonly key: string;
      readonly start: number;
      readonly end: number;
      readonly elementCount: number | null;
    }
  | {
      readonly kind: 'element';
      readonly key: string;
      readonly index: number;
      readonly start: number;
      readonly end: number;
    };

type Phase =
  | 'start'
  | 'first-key'
  | 'key'
  | 'in-key'
  | 'colon'
  | 'value'
  | 'first-element'
  | 'element'
  | 'in-value'
  | 'after-element'
  | 'after-value'
  | 'end';

const QUOTE = 0x22;
const BACKSLASH = 0x5c;
const OPEN_OBJECT = 0x7b;
const CLOSE_OBJECT = 0x7d;
const OPEN_ARRAY = 0x5b;
const CLOSE_ARRAY = 0x5d;
const COMMA = 0x2c;
const COLON = 0x3a;

function isWhitespace(byte: number): boolean {
  return byte === 0x20 || byte === 0x0a || byte === 0x0d || byte === 0x09;
}

function nextByte(chunk: Buffer, byte: number, from: number): number {
  const found = chunk.indexOf(byte, from);
  return found === -1 ? chunk.length : found;
}

function isStructural(byte: number): boolean {
  return (
    byte === QUOTE ||
    byte === OPEN_OBJECT ||
    byte === CLOSE_OBJECT ||
    byte === OPEN_ARRAY ||
    byte === CLOSE_ARRAY ||
    byte === COMMA ||
    byte === COLON
  );
}

class LegacyObjectGrammar {
  readonly events: LegacyScanEvent[] = [];
  private phase: Phase = 'start';
  private readonly closers: number[] = [];
  private readonly keys = new Set<string>();
  private inString = false;
  private escaped = false;
  private scalar = false;
  private valueIsElement = false;
  private valueBase = 0;
  private valueStart = 0;
  private arrayStart = 0;
  private elementIndex = 0;
  private key = '';
  private keyStart = 0;
  private keyParts: Buffer[] = [];
  private quoteAt = -1;
  private backslashAt = -1;

  constructor(private readonly splitKeys: ReadonlySet<string>) {}

  feed(chunk: Buffer, base: number): void {
    this.quoteAt = -1;
    this.backslashAt = -1;
    let index = 0;
    while (index < chunk.length) {
      if (this.inString) {
        index = this.skipString(chunk, base, index);
        continue;
      }
      this.step(chunk, base, index);
      index++;
    }
    if (this.phase === 'in-key') {
      this.keyParts.push(Buffer.from(chunk.subarray(this.keyStart)));
      this.keyStart = 0;
    }
  }

  finish(size: number): void {
    if (this.phase === 'end') return;
    throw new ElectronStateLegacyFormatError(
      size,
      size === 0 ? 'the file is empty' : 'the file is truncated',
    );
  }

  private skipString(chunk: Buffer, base: number, from: number): number {
    if (this.escaped) {
      this.escaped = false;
      return from + 1;
    }
    if (this.quoteAt < from) this.quoteAt = nextByte(chunk, QUOTE, from);
    if (this.backslashAt < from) {
      this.backslashAt = nextByte(chunk, BACKSLASH, from);
    }
    if (this.backslashAt < this.quoteAt) {
      this.escaped = true;
      return this.backslashAt + 1;
    }
    if (this.quoteAt === chunk.length) return chunk.length;
    this.inString = false;
    this.closeString(chunk, base, this.quoteAt);
    return this.quoteAt + 1;
  }

  private closeString(chunk: Buffer, base: number, index: number): void {
    if (this.phase === 'in-key') {
      this.keyParts.push(chunk.subarray(this.keyStart, index + 1));
      this.acceptKey(base + index);
      return;
    }
    if (this.closers.length === this.valueBase) {
      this.completeValue(base + index + 1);
    }
  }

  private acceptKey(offset: number): void {
    const text = Buffer.concat(this.keyParts).toString('utf8');
    this.keyParts = [];
    let key: unknown;
    try {
      key = JSON.parse(text);
    } catch {
      throw new ElectronStateLegacyFormatError(offset, 'invalid key');
    }
    if (typeof key !== 'string') {
      throw new ElectronStateLegacyFormatError(offset, 'invalid key');
    }
    if (this.keys.has(key)) {
      throw new ElectronStateLegacyFormatError(offset, 'duplicate key');
    }
    this.keys.add(key);
    this.key = key;
    this.phase = 'colon';
  }

  private step(chunk: Buffer, base: number, index: number): void {
    const byte = chunk[index];
    const offset = base + index;
    switch (this.phase) {
      case 'in-value':
        this.stepValue(chunk, base, index);
        return;
      case 'start':
        if (isWhitespace(byte)) return;
        if (byte !== OPEN_OBJECT) this.fail(offset, 'expected an object');
        this.closers.push(CLOSE_OBJECT);
        this.phase = 'first-key';
        return;
      case 'first-key':
      case 'key':
        if (isWhitespace(byte)) return;
        if (byte === CLOSE_OBJECT && this.phase === 'first-key') {
          this.closeTopLevel();
          return;
        }
        if (byte !== QUOTE) this.fail(offset, 'expected a key');
        this.inString = true;
        this.keyStart = index;
        this.phase = 'in-key';
        return;
      case 'colon':
        if (isWhitespace(byte)) return;
        if (byte !== COLON) this.fail(offset, 'expected a colon');
        this.phase = 'value';
        return;
      case 'value':
        if (isWhitespace(byte)) return;
        if (byte === OPEN_ARRAY && this.splitKeys.has(this.key)) {
          this.closers.push(CLOSE_ARRAY);
          this.arrayStart = offset;
          this.elementIndex = 0;
          this.phase = 'first-element';
          return;
        }
        this.beginValue(byte, offset, false);
        return;
      case 'first-element':
      case 'element':
        if (isWhitespace(byte)) return;
        if (byte === CLOSE_ARRAY && this.phase === 'first-element') {
          this.closeSplitArray(offset);
          return;
        }
        this.beginValue(byte, offset, true);
        return;
      case 'after-element':
        if (isWhitespace(byte)) return;
        if (byte === COMMA) {
          this.phase = 'element';
          return;
        }
        if (byte !== CLOSE_ARRAY) this.fail(offset, 'expected a comma');
        this.closeSplitArray(offset);
        return;
      case 'after-value':
        if (isWhitespace(byte)) return;
        if (byte === COMMA) {
          this.phase = 'key';
          return;
        }
        if (byte !== CLOSE_OBJECT) this.fail(offset, 'expected a comma');
        this.closeTopLevel();
        return;
      case 'end':
        if (!isWhitespace(byte)) this.fail(offset, 'trailing content');
        return;
      case 'in-key':
        return;
    }
  }

  private beginValue(byte: number, offset: number, element: boolean): void {
    this.valueIsElement = element;
    this.valueBase = this.closers.length;
    this.valueStart = offset;
    this.scalar = false;
    this.phase = 'in-value';
    if (byte === QUOTE) {
      this.inString = true;
    } else if (byte === OPEN_OBJECT) {
      this.closers.push(CLOSE_OBJECT);
    } else if (byte === OPEN_ARRAY) {
      this.closers.push(CLOSE_ARRAY);
    } else if (isStructural(byte)) {
      this.fail(offset, 'expected a value');
    } else {
      this.scalar = true;
    }
  }

  private stepValue(chunk: Buffer, base: number, index: number): void {
    const byte = chunk[index];
    const offset = base + index;
    if (this.scalar) {
      const closesScalar =
        isWhitespace(byte) ||
        byte === COMMA ||
        byte === CLOSE_OBJECT ||
        byte === CLOSE_ARRAY;
      if (!closesScalar) {
        if (isStructural(byte)) this.fail(offset, 'unexpected token');
        return;
      }
      this.completeValue(offset);
      this.step(chunk, base, index);
      return;
    }
    if (byte === QUOTE) {
      this.inString = true;
    } else if (byte === OPEN_OBJECT) {
      this.closers.push(CLOSE_OBJECT);
    } else if (byte === OPEN_ARRAY) {
      this.closers.push(CLOSE_ARRAY);
    } else if (byte === CLOSE_OBJECT || byte === CLOSE_ARRAY) {
      if (
        this.closers.length <= this.valueBase ||
        this.closers.pop() !== byte
      ) {
        this.fail(offset, 'mismatched bracket');
      }
      if (this.closers.length === this.valueBase) {
        this.completeValue(offset + 1);
      }
    }
  }

  private completeValue(end: number): void {
    if (this.valueIsElement) {
      this.events.push({
        kind: 'element',
        key: this.key,
        index: this.elementIndex++,
        start: this.valueStart,
        end,
      });
      this.phase = 'after-element';
      return;
    }
    this.events.push({
      kind: 'entry',
      key: this.key,
      start: this.valueStart,
      end,
      elementCount: null,
    });
    this.phase = 'after-value';
  }

  private closeSplitArray(offset: number): void {
    this.closers.pop();
    this.events.push({
      kind: 'entry',
      key: this.key,
      start: this.arrayStart,
      end: offset + 1,
      elementCount: this.elementIndex,
    });
    this.phase = 'after-value';
  }

  private closeTopLevel(): void {
    this.closers.pop();
    this.phase = 'end';
  }

  private fail(offset: number, detail: string): never {
    throw new ElectronStateLegacyFormatError(offset, detail);
  }
}

export async function scanLegacyObject(
  handle: FileHandle,
  options: LegacyScanOptions,
  visitor: LegacyScanVisitor,
): Promise<LegacyScanResult> {
  const grammar = new LegacyObjectGrammar(options.splitKeys);
  const hash = createHash('sha256');
  const buffer = Buffer.allocUnsafe(
    options.chunkBytes ?? LEGACY_SCAN_CHUNK_BYTES,
  );
  let position = 0;
  for (;;) {
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, position);
    if (bytesRead === 0) break;
    const chunk = buffer.subarray(0, bytesRead);
    hash.update(chunk);
    grammar.feed(chunk, position);
    position += bytesRead;
    for (const event of grammar.events.splice(0)) {
      if (event.kind === 'entry') {
        await visitor.onEntry(
          event.key,
          event.start,
          event.end,
          event.elementCount,
        );
      } else {
        await visitor.onElement(event.key, event.index, event.start, event.end);
      }
    }
  }
  grammar.finish(position);
  return { sha256: hash.digest('hex'), size: position };
}

export async function readLegacySpan(
  handle: FileHandle,
  start: number,
  end: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(end - start);
  let filled = 0;
  while (filled < bytes.length) {
    const { bytesRead } = await handle.read(
      bytes,
      filled,
      bytes.length - filled,
      start + filled,
    );
    if (bytesRead === 0) {
      throw new ElectronStateLegacyFormatError(
        start + filled,
        'the file ended inside a value',
      );
    }
    filled += bytesRead;
  }
  return bytes;
}
