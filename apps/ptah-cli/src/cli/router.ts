/**
 * Commander router for the `ptah` headless CLI.
 *
 * Declares all 6 subcommands (config, harness, profile, run, execute-spec,
 * interact) plus the global flags listed in
 * `.ptah/specs/TASK_2026_104/task-description.md` § 5.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Each subcommand handler invokes a
 * stub that prints "not yet implemented" and exits 0; real behavior lands in
 * Batches 4-6. No DI bootstrap occurs here — that lives inside each command's
 * `execute()` from Batch 5 onward.
 */

import { Command, Option } from 'commander';

import * as configCmd from './commands/config.js';
import * as executeSpecCmd from './commands/execute-spec.js';
import * as harnessCmd from './commands/harness.js';
import * as interactCmd from './commands/interact.js';
import * as profileCmd from './commands/profile.js';
import * as runCmd from './commands/run.js';

/**
 * Cross-cutting flags resolved on the root program. Every command receives
 * these as the second argument to its `execute()`.
 */
export interface GlobalOptions {
  /** Emit JSON-RPC 2.0 NDJSON on stdout (default true). */
  json: boolean;
  /** Pretty-print events with colors and indentation. */
  human: boolean;
  /** Working directory for workspace ops. Defaults to `process.cwd()`. */
  cwd: string;
  /** Suppress non-essential notifications. */
  quiet: boolean;
  /** Emit `debug.*` notifications. */
  verbose: boolean;
  /** Override config file path (defaults to `~/.ptah/settings.json`). */
  config?: string;
  /** Disable ANSI escape codes in `--human` mode. */
  noColor: boolean;
  /** Auto-allow all permission requests (run / execute-spec only). */
  autoApprove: boolean;
  /** Show sensitive values verbatim (config list only). */
  reveal: boolean;
}

interface RawProgramOptions {
  json?: boolean;
  human?: boolean;
  cwd?: string;
  quiet?: boolean;
  verbose?: boolean;
  config?: string;
  color?: boolean;
  autoApprove?: boolean;
  reveal?: boolean;
}

/**
 * Hoist the resolved global options onto a single object. Commander attaches
 * `--no-color` as a `color: false` option (negatable boolean), so we map it
 * back to the `noColor` flag the rest of the CLI consumes.
 */
function resolveGlobals(program: Command): GlobalOptions {
  const raw = program.opts<RawProgramOptions>();
  return {
    json: raw.json !== false,
    human: raw.human === true,
    cwd: raw.cwd ?? process.cwd(),
    quiet: raw.quiet === true,
    verbose: raw.verbose === true,
    config: raw.config,
    noColor: raw.color === false,
    autoApprove: raw.autoApprove === true,
    reveal: raw.reveal === true,
  };
}

/**
 * Read the package version from the CLI `package.json`. The bundled
 * `package.json` lives alongside `main.mjs` in `dist/apps/ptah-cli/`; in
 * source-tree runs (e.g. `nx dev`, `tsx`) it lives two directories up from
 * `src/cli/router.ts`. Try the dist layout first, then fall back to the
 * source layout. Returns `0.0.0` if both lookups fail so `--version` still
 * exits 0.
 */
function readPackageVersion(): string {
  const candidates = ['./package.json', '../../package.json'];
  for (const candidate of candidates) {
    try {
      const require = createRequireSafely();
      if (!require) {
        continue;
      }
      const pkg = require(candidate) as { version?: string };
      if (pkg.version) {
        return pkg.version;
      }
    } catch {
      /* try the next candidate */
    }
  }
  return '0.0.0';
}

function createRequireSafely(): NodeRequire | null {
  try {
    const { createRequire } = require('node:module');
    return createRequire(import.meta.url);
  } catch {
    return null;
  }
}

/**
 * Build the root commander program with every subcommand wired to its stub
 * handler. The caller is responsible for invoking `parseAsync(argv)`.
 */
export function buildRouter(): Command {
  const program = new Command();

  program
    .name('ptah')
    .description(
      'Ptah headless A2A CLI — drives the agent backend over JSON-RPC 2.0 stdio',
    )
    .version(readPackageVersion(), '-V, --version', 'print version and exit')
    .helpOption('-h, --help', 'print usage and exit')
    .addOption(
      new Option('--json', 'emit JSON-RPC 2.0 NDJSON on stdout (default)')
        .default(true)
        .conflicts('human'),
    )
    .addOption(
      new Option('--human', 'pretty-print events with colors and indentation')
        .default(false)
        .conflicts('json'),
    )
    .option('--cwd <dir>', 'working directory for workspace ops', process.cwd())
    .addOption(
      new Option('--quiet', 'suppress non-essential notifications')
        .default(false)
        .conflicts('verbose'),
    )
    .addOption(
      new Option('--verbose', 'emit additional debug.* notifications')
        .default(false)
        .conflicts('quiet'),
    )
    .option(
      '--config <path>',
      'override config file path (default ~/.ptah/settings.json)',
    )
    .option('--no-color', 'disable ANSI escape codes in --human mode')
    .option(
      '--auto-approve',
      'auto-allow all permission requests (run / execute-spec only)',
      false,
    )
    .option(
      '--reveal',
      'show sensitive values verbatim (config list only)',
      false,
    );

  // -- ptah config -----------------------------------------------------------
  const config = program
    .command('config')
    .description('read and write Ptah global configuration');

  config
    .command('get <key>')
    .description('read the value at <key> from settings.json')
    .action(async (key: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'get', key },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  config
    .command('set <key> <value>')
    .description('write <value> at <key> in settings.json')
    .action(async (key: string, value: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'set', key, value },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  config
    .command('list')
    .description('list all configuration entries (sensitive values redacted)')
    .action(async () => {
      const exit = await configCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah harness ----------------------------------------------------------
  const harness = program
    .command('harness')
    .description('provision a Ptah workspace and install skills');

  harness
    .command('init')
    .description('create the .ptah/ scaffolding (idempotent)')
    .option('--dir <path>', 'target directory (defaults to --cwd)')
    .option('--skills <comma-list>', 'comma-separated skills to install')
    .action(async (opts: { dir?: string; skills?: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'init', dir: opts.dir, skills: opts.skills },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('install-skill <name>')
    .description('install a skill into .ptah/skills/<name>/')
    .action(async (name: string) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'install-skill', name },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('list-skills')
    .description('list installed skills in .ptah/skills/')
    .action(async () => {
      const exit = await harnessCmd.execute(
        { subcommand: 'list-skills' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah profile ----------------------------------------------------------
  const profile = program
    .command('profile')
    .description('apply and list sub-agent profiles');

  profile
    .command('apply <name>')
    .description('write the named profile into .ptah/agents/')
    .action(async (name: string) => {
      const exit = await profileCmd.execute(
        { subcommand: 'apply', name },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  profile
    .command('list')
    .description('list registry-available and locally-applied profiles')
    .action(async () => {
      const exit = await profileCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah run --------------------------------------------------------------
  program
    .command('run')
    .description('submit a single one-off task to the agent and stream events')
    .requiredOption('--task <string>', 'free-form task prompt')
    .action(async (opts: { task: string }) => {
      const exit = await runCmd.execute(
        { task: opts.task },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah execute-spec -----------------------------------------------------
  program
    .command('execute-spec')
    .description('execute a stored spec via the Team Leader agent')
    .requiredOption('--id <task-id>', 'task spec id (e.g. TASK_2026_104)')
    .action(async (opts: { id: string }) => {
      const exit = await executeSpecCmd.execute(
        { id: opts.id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah interact ---------------------------------------------------------
  program
    .command('interact')
    .description('persistent JSON-RPC 2.0 stdio session')
    .option('--session <id>', 'resume or create the session with this id')
    .action(async (opts: { session?: string }) => {
      const exit = await interactCmd.execute(
        { session: opts.session },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  return program;
}
