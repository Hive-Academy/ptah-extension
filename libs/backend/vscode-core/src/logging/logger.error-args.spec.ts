/**
 * `Logger` error arguments serialization spec (TASK_2026_367 / C5b).
 *
 * Verifies that `Logger.log()` formats Error arguments using name, message, and
 * stack, rather than JSON.stringify'ing an Error into `{}` due to non-enumerable
 * Error properties.
 */

import 'reflect-metadata';

import { Logger } from './logger';
import type { OutputManager } from '../api-wrappers/output-manager';

interface Harness {
  logger: Logger;
  written: string[];
}

function buildLogger(): Harness {
  const written: string[] = [];
  const outputManager = {
    createOutputChannel: jest.fn(),
    write: jest.fn((_channel: string, message: string) => {
      written.push(message);
    }),
    show: jest.fn(),
  } as unknown as OutputManager;

  return { logger: new Logger(outputManager), written };
}

describe('Logger error arguments serialization (C5b)', () => {
  it('serializes Error arguments with name, message and stack fragment instead of {}', () => {
    const { logger, written } = buildLogger();

    logger.warn('boom', new Error('kaput'));

    expect(written.length).toBe(1);
    const line = written[0];
    expect(line).toContain('boom:');
    expect(line).toContain('kaput');
    expect(line).toContain('Error');
    expect(line).toContain('stack');
    expect(line).not.toContain(': {}');
  });

  it('still serializes plain objects as before', () => {
    const { logger, written } = buildLogger();

    logger.warn('details', { status: 'failed', code: 500 });

    expect(written.length).toBe(1);
    const line = written[0];
    expect(line).toContain('details: {"status":"failed","code":500}');
  });

  it('safely handles circular object references with [Unserializable]', () => {
    const { logger, written } = buildLogger();
    const circular: Record<string, unknown> = { key: 'value' };
    circular['self'] = circular;

    logger.warn('circular', circular);

    expect(written.length).toBe(1);
    const line = written[0];
    expect(line).toContain('circular: [Unserializable]');
  });
});
