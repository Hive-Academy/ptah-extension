/**
 * `ptah config` command stub.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Real implementation lands in Batch 4
 * (file-backed settings via `~/.ptah/settings.json`, redaction, atomic write).
 */

import type { GlobalOptions } from '../router.js';

export type ConfigSubcommand = 'get' | 'set' | 'list';

export interface ConfigOptions {
  subcommand: ConfigSubcommand;
  key?: string;
  value?: string;
}

/**
 * Execute the `config` command. Currently prints a "not yet implemented"
 * notice to stdout and returns exit code 0 so the harness wiring can be
 * verified end-to-end before Batch 4 wires real behavior.
 */
export async function execute(
  opts: ConfigOptions,
  _globals: GlobalOptions,
): Promise<number> {
  process.stdout.write(
    `ptah config ${opts.subcommand}: not yet implemented (TASK_2026_104 batch 2 scaffold)\n`,
  );
  return 0;
}
