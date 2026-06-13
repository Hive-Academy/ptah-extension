import path from 'node:path';
import { pathToFileURL } from 'node:url';

import type { GlobalOptions } from '../router.js';

interface TuiBundle {
  runTui?: (globals: {
    cwd?: string;
    config?: string;
    verbose?: boolean;
  }) => Promise<number>;
  TUI_BUNDLE_API_VERSION?: number;
}

function ttySupported(): boolean {
  return (
    process.stdin.isTTY === true &&
    typeof process.stdin.setRawMode === 'function'
  );
}

function writeTtyError(): void {
  process.stderr.write(
    '\n  Ptah TUI requires an interactive terminal (TTY with raw mode).\n' +
      '  Piped or redirected stdin cannot drive the TUI.\n\n' +
      '  Run it from a real terminal:\n\n' +
      '    ptah tui\n\n',
  );
}

function writeBundleError(reason: string): void {
  process.stderr.write(
    `\n  Unable to load the Ptah TUI bundle: ${reason}\n\n` +
      '  Reinstall the CLI to restore tui.mjs:\n\n' +
      '    npm install -g @hive-academy/ptah-cli\n\n' +
      '  In a source checkout, build it first:\n\n' +
      '    nx build ptah-tui\n\n',
  );
}

export async function execute(
  _args: Record<string, never>,
  globals: GlobalOptions,
): Promise<number> {
  const smoke = process.env['PTAH_TUI_SMOKE'] === '1';

  if (!smoke && !ttySupported()) {
    writeTtyError();
    return 1;
  }

  const tuiPath = path.join(__dirname, 'tui.mjs');

  let mod: TuiBundle;
  try {
    mod = (await import(pathToFileURL(tuiPath).href)) as TuiBundle;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    writeBundleError(message);
    return 1;
  }

  if (typeof mod.runTui !== 'function' || mod.TUI_BUNDLE_API_VERSION !== 1) {
    writeBundleError('incompatible or missing tui.mjs (API version mismatch)');
    return 1;
  }

  return mod.runTui({
    cwd: globals.cwd,
    config: globals.config,
    verbose: globals.verbose,
  });
}
