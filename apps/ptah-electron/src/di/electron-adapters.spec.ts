/**
 * ElectronLoggerAdapter — structured context reaches the log file.
 *
 * On 2026-10-13 two `[renderer] console.error` lines reached the log with no
 * text: the forwarder passes the console message as context, and the adapter
 * wrote only `service`, `operation` and `error`.
 */

import type { IOutputChannel } from '@ptah-extension/platform-core';

import {
  ElectronLoggerAdapter,
  ElectronOutputManagerAdapter,
} from './electron-adapters';

function makeLogger(): { logger: ElectronLoggerAdapter; lines: string[] } {
  const lines: string[] = [];
  const channel = {
    name: 'Ptah',
    appendLine: (line: string) => lines.push(line),
    dispose: jest.fn(),
  } as unknown as IOutputChannel;
  const logger = new ElectronLoggerAdapter(
    new ElectronOutputManagerAdapter(channel),
  );
  return { logger, lines };
}

describe('ElectronLoggerAdapter.error context', () => {
  it('writes the context fields of a renderer console error', () => {
    const { logger, lines } = makeLogger();

    logger.error('[renderer] console.error', {
      windowId: 1,
      message: 'TypeError: x is undefined',
      source: 'main.js:42',
    });

    expect(lines[0]).toContain('[renderer] console.error');
    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(JSON.parse(context.slice('  Context: '.length))).toEqual({
      windowId: 1,
      message: 'TypeError: x is undefined',
      source: 'main.js:42',
    });
  });

  it('writes metadata and keeps the error on its own line', () => {
    const { logger, lines } = makeLogger();

    logger.logWithContext('error', 'failed', {
      metadata: { sessionId: 's1' },
      error: new Error('boom'),
    });

    expect(lines).toContain('  Error: boom');
    expect(lines).toContain('  Context: {"metadata":{"sessionId":"s1"}}');
  });

  it('caps an oversized context line and keeps it valid JSON', () => {
    const { logger, lines } = makeLogger();

    logger.error('huge', {
      payload: 'x'.repeat(50_000),
      quoted: '"'.repeat(5_000),
    });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length).toBeLessThan(8_300);
    const parsed = JSON.parse(context.slice('  Context: '.length)) as {
      truncatedChars: number;
      head: string;
    };
    expect(parsed.truncatedChars).toBeGreaterThan(0);
    expect(parsed.head.startsWith('{"payload":"xxx')).toBe(true);
  });

  it('redacts credential fields and credential-shaped text', () => {
    const { logger, lines } = makeLogger();

    logger.error('auth failed', {
      apiKey: 'sk-ant-api03-ABCDEFGHIJKLMNOPQRST',
      metadata: { refresh_token: 'RT1', inputTokens: 12 },
      url: 'https://x.example.com/cb?code=abc&ok=1',
    });

    expect(lines).toContain(
      '  Context: {"apiKey":"[REDACTED]","metadata":{"refresh_token":"[REDACTED]","inputTokens":12},"url":"https://x.example.com/cb?code=[REDACTED]&ok=1"}',
    );
  });

  it('writes a non-Error error field on its own line', () => {
    const { logger, lines } = makeLogger();

    logger.error('refresh failed', { error: 'HTTP 400', serverKey: 's1' });

    expect(lines).toContain('  Error: HTTP 400');
    expect(lines).toContain('  Context: {"serverKey":"s1"}');
  });

  it('keeps a context of escape-heavy text under the bound', () => {
    const { logger, lines } = makeLogger();

    logger.error('escapes', { a: '\\'.repeat(6_000), b: '\\'.repeat(6_000) });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length - '  Context: '.length).toBeLessThanOrEqual(8_192);
    expect(() => JSON.parse(context.slice('  Context: '.length))).not.toThrow();
  });

  it('caps a long non-Error error field and redacts the stack', () => {
    const { logger, lines } = makeLogger();
    const err = new Error('boom');
    err.stack = 'Error: boom\n    at cb (https://x.example.com/cb?code=SECRET1)';

    logger.error('long', { error: 'e'.repeat(20_000) });
    logger.error('stacked', err);

    const errorLine = lines.find((l) => l.startsWith('  Error: eee')) ?? '';
    expect(errorLine.length).toBeLessThan(8_300);
    expect(lines.join('\n')).not.toContain('SECRET1');
    expect(lines.join('\n')).toContain('code=[REDACTED]');
  });

  it('bounds the work for a huge nested context', () => {
    const { logger, lines } = makeLogger();
    const huge = Array.from({ length: 100_000 }, (_, i) => ({ i, nested: { i } }));

    logger.error('huge nested', { huge });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length).toBeLessThan(8_300);
    expect(context).toContain('…[99950 more]');
    expect(context).not.toContain('truncatedChars');
  });

  it('bounds a very wide object and never calls toJSON', () => {
    const { logger, lines } = makeLogger();
    const wide: Record<string, number> = {};
    for (let i = 0; i < 100_000; i++) wide[`k${i}`] = i;
    const toJSON = jest.fn(() => 'expensive');

    logger.error('wide', { wide, custom: { toJSON, value: 1 } });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length).toBeLessThan(8_300);
    expect(context).toContain('"…":"more keys dropped"');
    expect(toJSON).not.toHaveBeenCalled();
  });

  it('writes circular, bigint and Error values without throwing', () => {
    const { logger, lines } = makeLogger();
    const loop: Record<string, unknown> = { name: 'loop' };
    loop['self'] = loop;

    logger.error('odd values', {
      loop,
      big: BigInt(42),
      cause: new Error('inner'),
    });

    expect(lines).toContain(
      '  Context: {"loop":{"name":"loop","self":"[Circular]"},"big":"42n","cause":{"name":"Error","message":"inner"}}',
    );
  });

  it('keeps the other fields when one getter throws', () => {
    const { logger, lines } = makeLogger();
    const context: Record<string, unknown> = { before: 1 };
    Object.defineProperty(context, 'broken', {
      enumerable: true,
      get: () => {
        throw new Error('getter failed');
      },
    });
    context['after'] = new Map([['a', 1]]);

    logger.error('getter', context);

    expect(lines).toContain(
      '  Context: {"before":1,"broken":"[Unreadable]","after":"[Map size=1]"}',
    );
  });

  it('writes no context line when there is no context', () => {
    const { logger, lines } = makeLogger();

    logger.error('plain failure');

    expect(lines.some((l) => l.startsWith('  Context: '))).toBe(false);
  });
});
