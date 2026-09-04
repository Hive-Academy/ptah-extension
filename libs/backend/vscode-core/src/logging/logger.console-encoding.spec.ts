/**
 * `Logger` console-encoding specs (TASK_2026_354).
 *
 * Narrow on purpose: the only thing asserted here is WHERE
 * `sanitizeConsoleText` is applied. The transformation itself is covered by
 * `console-text.spec.ts`.
 *
 * The split matters. The output channel is a UTF-8 file and must receive the
 * message as written; the console is the surface where a double-encoded em dash
 * prints as `—` and where a legacy Windows codepage mangles even a correct
 * one. Sanitising both would silently rewrite the durable log; sanitising
 * neither is the defect.
 */

import 'reflect-metadata';

import { Logger } from './logger';
import type { OutputManager } from '../api-wrappers/output-manager';

/** UTF-8 bytes of U+2014 EM DASH decoded as CP1252: `â` `€` `”`. */
const MOJIBAKE_EM_DASH = '—';

interface Harness {
  logger: Logger;
  written: string[];
  consoleLines: string[];
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

  const consoleLines: string[] = [];
  jest
    .spyOn(console, 'log')
    .mockImplementation((message?: unknown) =>
      consoleLines.push(String(message)),
    );

  return { logger: new Logger(outputManager), written, consoleLines };
}

describe('Logger console encoding', () => {
  const previousLogLevel = process.env['PTAH_LOG_LEVEL'];

  beforeEach(() => {
    // Console mirroring is a development-mode behaviour; this is the env switch
    // `detectDevelopmentMode()` honours without pretending to be VS Code.
    process.env['PTAH_LOG_LEVEL'] = 'debug';
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousLogLevel === undefined) {
      delete process.env['PTAH_LOG_LEVEL'];
    } else {
      process.env['PTAH_LOG_LEVEL'] = previousLogLevel;
    }
  });

  it('repairs double-encoded punctuation on the console line', () => {
    const { logger, consoleLines } = buildLogger();

    logger.info(`SDK options built ${MOJIBAKE_EM_DASH} launching query`);

    expect(consoleLines).toEqual([
      '[INFO] SDK options built - launching query',
    ]);
  });

  it('leaves the output-channel line exactly as written', () => {
    const { logger, written } = buildLogger();

    logger.info(`SDK options built ${MOJIBAKE_EM_DASH} launching query`);

    expect(written.some((line) => line.includes(MOJIBAKE_EM_DASH))).toBe(true);
  });
});
