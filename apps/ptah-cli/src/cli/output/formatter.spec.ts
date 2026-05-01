/**
 * Unit tests for the JSON / Human formatter.
 *
 * TASK_2026_104 Batch 3.
 */

import { PassThrough } from 'node:stream';

import {
  buildFormatter,
  HumanFormatter,
  JsonFormatter,
  shouldUseColor,
} from './formatter.js';
import { decodeMessage } from '../jsonrpc/encoder.js';
import {
  isJsonRpcErrorResponse,
  isJsonRpcRequest,
  isJsonRpcSuccessResponse,
} from '../jsonrpc/types.js';
import { StdoutWriter } from '../io/stdout-writer.js';

interface Capture {
  output: PassThrough;
  writer: StdoutWriter;
  read: () => Promise<string>;
}

function makeCapture(): Capture {
  const output = new PassThrough();
  const chunks: Buffer[] = [];
  output.on('data', (c: Buffer) => chunks.push(c));
  const writer = new StdoutWriter({ output });
  const read = async () => {
    await writer.flush();
    await new Promise((r) => setImmediate(r));
    return Buffer.concat(chunks).toString('utf8');
  };
  return { output, writer, read };
}

describe('JsonFormatter', () => {
  it('emits a JSON-RPC notification line', async () => {
    const cap = makeCapture();
    const fmt = new JsonFormatter(cap.writer);
    await fmt.writeNotification('agent.message', { text: 'hi' });
    const text = await cap.read();
    expect(text.endsWith('\n')).toBe(true);
    const decoded = decodeMessage(text);
    expect(decoded.ok).toBe(true);
  });

  it('emits a JSON-RPC request', async () => {
    const cap = makeCapture();
    const fmt = new JsonFormatter(cap.writer);
    await fmt.writeRequest(7, 'permission.request', { tool: 'edit' });
    const text = await cap.read();
    const decoded = decodeMessage(text);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(isJsonRpcRequest(decoded.message)).toBe(true);
  });

  it('emits a JSON-RPC response', async () => {
    const cap = makeCapture();
    const fmt = new JsonFormatter(cap.writer);
    await fmt.writeResponse(1, { complete: true });
    const text = await cap.read();
    const decoded = decodeMessage(text);
    expect(decoded.ok).toBe(true);
    if (decoded.ok)
      expect(isJsonRpcSuccessResponse(decoded.message)).toBe(true);
  });

  it('emits a JSON-RPC error', async () => {
    const cap = makeCapture();
    const fmt = new JsonFormatter(cap.writer);
    await fmt.writeError(2, -32603, 'internal', {
      ptah_code: 'internal_failure',
    });
    const text = await cap.read();
    const decoded = decodeMessage(text);
    expect(decoded.ok).toBe(true);
    if (decoded.ok) expect(isJsonRpcErrorResponse(decoded.message)).toBe(true);
  });

  it('close() flushes the writer', async () => {
    const cap = makeCapture();
    const fmt = new JsonFormatter(cap.writer);
    await fmt.writeNotification('x');
    await expect(fmt.close()).resolves.toBeUndefined();
  });
});

describe('HumanFormatter', () => {
  it('writes a colored notification by default', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: false });
    await fmt.writeNotification('agent.message', { text: 'hi' });
    const text = await cap.read();
    // ANSI escape present
    // eslint-disable-next-line no-control-regex
    expect(text).toMatch(/\x1b\[/);
    expect(text).toContain('agent.message');
  });

  it('honors --no-color via the noColor flag', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: true });
    await fmt.writeNotification('agent.message', { text: 'hi' });
    const text = await cap.read();
    // eslint-disable-next-line no-control-regex
    expect(text).not.toMatch(/\x1b\[/);
    expect(text).toContain('agent.message');
  });

  it('formats requests, responses, and errors with id tags', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: true });
    await fmt.writeRequest(1, 'permission.request', { tool: 'edit' });
    await fmt.writeResponse(1, { allowed: true });
    await fmt.writeError(2, -32603, 'kaboom', {
      ptah_code: 'internal_failure',
    });
    const text = await cap.read();
    expect(text).toContain('#1');
    expect(text).toContain('#2');
    expect(text).toContain('permission.request');
    expect(text).toContain('kaboom');
    expect(text).toContain('(-32603)');
  });

  it('handles undefined params and null result gracefully', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: true });
    await fmt.writeNotification('task.complete');
    await fmt.writeResponse(null, null);
    const text = await cap.read();
    expect(text).toContain('task.complete');
    expect(text).toContain('#null');
  });

  it('uses different prefixes per method namespace', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: true });
    await fmt.writeNotification('task.start', {});
    await fmt.writeNotification('agent.thought', {});
    await fmt.writeNotification('session.cost', {});
    await fmt.writeNotification('debug.di.phase', {});
    await fmt.writeNotification('config.value', {});
    const text = await cap.read();
    // Each line begins with a single-char prefix from {*, >, ~, ., -}.
    const lines = text.trimEnd().split('\n');
    expect(lines).toHaveLength(5);
    expect(lines[0]).toMatch(/^\*/);
    expect(lines[1]).toMatch(/^>/);
    expect(lines[2]).toMatch(/^~/);
    expect(lines[3]).toMatch(/^\./);
    expect(lines[4]).toMatch(/^-/);
  });

  it('close() flushes the writer', async () => {
    const cap = makeCapture();
    const fmt = new HumanFormatter(cap.writer, { noColor: true });
    await expect(fmt.close()).resolves.toBeUndefined();
  });
});

describe('shouldUseColor', () => {
  const originalNoColor = process.env['NO_COLOR'];
  const originalNoTty = process.env['PTAH_NO_TTY'];

  afterEach(() => {
    if (originalNoColor === undefined) delete process.env['NO_COLOR'];
    else process.env['NO_COLOR'] = originalNoColor;
    if (originalNoTty === undefined) delete process.env['PTAH_NO_TTY'];
    else process.env['PTAH_NO_TTY'] = originalNoTty;
  });

  it('returns true by default', () => {
    delete process.env['NO_COLOR'];
    delete process.env['PTAH_NO_TTY'];
    expect(shouldUseColor()).toBe(true);
  });

  it('returns false when noColor flag is true', () => {
    expect(shouldUseColor({ noColor: true })).toBe(false);
  });

  it('returns false when NO_COLOR env is set', () => {
    process.env['NO_COLOR'] = '1';
    expect(shouldUseColor()).toBe(false);
  });

  it('returns false when PTAH_NO_TTY=1', () => {
    delete process.env['NO_COLOR'];
    process.env['PTAH_NO_TTY'] = '1';
    expect(shouldUseColor()).toBe(false);
  });
});

describe('buildFormatter', () => {
  it('returns a JsonFormatter by default', () => {
    const cap = makeCapture();
    const fmt = buildFormatter({ writer: cap.writer });
    expect(fmt).toBeInstanceOf(JsonFormatter);
  });

  it('returns a HumanFormatter when human=true', () => {
    const cap = makeCapture();
    const fmt = buildFormatter({ writer: cap.writer, human: true });
    expect(fmt).toBeInstanceOf(HumanFormatter);
  });

  it('constructs its own StdoutWriter when none provided', () => {
    const fmt = buildFormatter();
    expect(fmt).toBeInstanceOf(JsonFormatter);
  });
});
