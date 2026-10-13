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

  it('caps an oversized context line', () => {
    const { logger, lines } = makeLogger();

    logger.error('huge', { payload: 'x'.repeat(50_000) });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length).toBeLessThan(8_300);
    expect(context).toMatch(/…\[truncated \d+ chars\]$/);
  });

  it('bounds the work for a huge nested context', () => {
    const { logger, lines } = makeLogger();
    const huge = Array.from({ length: 100_000 }, (_, i) => ({ i, nested: { i } }));

    logger.error('huge nested', { huge });

    const context = lines.find((l) => l.startsWith('  Context: ')) ?? '';
    expect(context.length).toBeLessThan(8_300);
    expect(context).toContain('…[99950 more]');
    expect(context).not.toContain('…[truncated');
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
