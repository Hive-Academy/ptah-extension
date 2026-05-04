/**
 * Commander router for the `ptah` headless CLI.
 *
 * Declares all subcommands (config, harness, agent, run, execute-spec,
 * interact, etc.) plus the global flags listed in
 * `.ptah/specs/TASK_2026_104/task-description.md` § 5.
 *
 * TASK_2026_104 Batch 2 — scaffold only. Each subcommand handler invokes a
 * stub that prints "not yet implemented" and exits 0; real behavior lands in
 * Batches 4-6. No DI bootstrap occurs here — that lives inside each command's
 * `execute()` from Batch 5 onward.
 */

import { Command, Option } from 'commander';

import * as agentCmd from './commands/agent.js';
import * as agentCliCmd from './commands/agent-cli.js';
import * as analyzeCmd from './commands/analyze.js';
import * as authCmd from './commands/auth.js';
import * as configCmd from './commands/config.js';
import * as doctorCmd from './commands/doctor.js';
import * as executeSpecCmd from './commands/execute-spec.js';
import * as gitCmd from './commands/git.js';
import * as harnessCmd from './commands/harness.js';
import * as interactCmd from './commands/interact.js';
import * as licenseCmd from './commands/license.js';
import * as mcpCmd from './commands/mcp.js';
import * as newProjectCmd from './commands/new-project.js';
import * as pluginCmd from './commands/plugin.js';
import * as promptsCmd from './commands/prompts.js';
import * as providerCmd from './commands/provider.js';
import * as proxyCmd from './commands/proxy.js';
import * as qualityCmd from './commands/quality.js';
import * as runCmd from './commands/run.js';
import * as sessionCmd from './commands/session.js';
import * as settingsCmd from './commands/settings.js';
import * as setupCmd from './commands/setup.js';
import * as skillCmd from './commands/skill.js';
import * as websearchCmd from './commands/websearch.js';
import * as wizardCmd from './commands/wizard.js';
import * as workspaceCmd from './commands/workspace.js';

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
 * Commander value coercer: split a comma-separated string into a non-empty
 * array. Trims each segment and drops empties. Used by `git stage|unstage|
 * discard --paths a,b,c`.
 */
function collectCsv(raw: string): string[] {
  return raw
    .split(',')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
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
    .option('--keys-only', 'emit only the key list (no values)', false)
    .option('--prefix <prefix>', 'only include keys starting with <prefix>')
    .option(
      '--changed-only',
      'only include keys whose value differs from the file-backed default',
      false,
    )
    .action(
      async (opts: {
        keysOnly?: boolean;
        prefix?: string;
        changedOnly?: boolean;
      }) => {
        const exit = await configCmd.execute(
          {
            subcommand: 'list',
            keysOnly: opts.keysOnly === true,
            prefix: opts.prefix,
            changedOnly: opts.changedOnly === true,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  config
    .command('reset <key>')
    .description('reset <key> to its file-backed default value')
    .action(async (key: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'reset', key },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  config
    .command('model-switch <model>')
    .description('switch the active agent model via config:model-switch')
    .action(async (model: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'model-switch', value: model },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  config
    .command('model-get')
    .description('emit the active agent model via config:model-get')
    .action(async () => {
      const exit = await configCmd.execute(
        { subcommand: 'model-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const configModels = config
    .command('models')
    .description('inspect available agent models');

  configModels
    .command('list')
    .description('emit the available agent model list via config:models-list')
    .action(async () => {
      const exit = await configCmd.execute(
        { subcommand: 'models-list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const configAutopilot = config
    .command('autopilot')
    .description(
      'read or toggle autopilot (auto-approve all permission requests)',
    );

  configAutopilot
    .command('get')
    .description('emit the current autopilot state via config:autopilot-get')
    .action(async () => {
      const exit = await configCmd.execute(
        { subcommand: 'autopilot-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  configAutopilot
    .command('set <enabled>')
    .description('toggle autopilot via config:autopilot-toggle (true|false)')
    .action(async (enabled: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'autopilot-set', value: enabled },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const configEffort = config
    .command('effort')
    .description('read or set the agent reasoning-effort tier');

  configEffort
    .command('get')
    .description('emit the current effort tier via config:effort-get')
    .action(async () => {
      const exit = await configCmd.execute(
        { subcommand: 'effort-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  configEffort
    .command('set <effort>')
    .description(
      'set the effort tier via config:effort-set (minimal|low|medium|high)',
    )
    .action(async (effort: string) => {
      const exit = await configCmd.execute(
        { subcommand: 'effort-set', value: effort },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah harness ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B6c. Backed by shared HarnessRpcHandlers
  // (registered globally via `registerAllRpcHandlers()`), so VS Code, Electron,
  // and the CLI all dispatch identical RPC verbs.
  const harness = program
    .command('harness')
    .description(
      'Harness Setup Builder — scaffold, scan, design, and apply project harness presets',
    );

  harness
    .command('init')
    .description(
      'create the .ptah/ scaffolding (pure mkdir, no DI; idempotent — second run reports changed:false)',
    )
    .option('--dir <path>', 'target directory (defaults to --cwd)')
    .action(async (opts: { dir?: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'init', dir: opts.dir },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('status')
    .description(
      'inspect .ptah/ contents (pure fs.readdir, no DI) and emit harness.status',
    )
    .option('--dir <path>', 'workspace root (defaults to --cwd)')
    .action(async (opts: { dir?: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'status', dir: opts.dir },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('scan')
    .description(
      'run harness:initialize and emit workspace_context / available_agents / available_skills / existing_presets',
    )
    .action(async () => {
      const exit = await harnessCmd.execute(
        { subcommand: 'scan' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('apply')
    .description('apply a stored harness preset via harness:apply')
    .requiredOption('--preset <id>', 'preset id or name')
    .action(async (opts: { preset: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'apply', preset: opts.preset },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const harnessPreset = harness
    .command('preset')
    .description('manage harness presets (save / load)');

  harnessPreset
    .command('save <name>')
    .description(
      'persist a HarnessConfig (read from --from <path>) via harness:save-preset',
    )
    .requiredOption(
      '--from <path>',
      'JSON file containing a HarnessConfig payload',
    )
    .option('--description <text>', 'human-readable description', '')
    .action(
      async (name: string, opts: { from: string; description?: string }) => {
        const exit = await harnessCmd.execute(
          {
            subcommand: 'preset-save',
            name,
            from: opts.from,
            description: opts.description,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  harnessPreset
    .command('load')
    .description('emit harness.preset.list via harness:load-presets')
    .action(async () => {
      const exit = await harnessCmd.execute(
        { subcommand: 'preset-load' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // ---------------------------------------------------------------------------
  // `harness chat` — alias for `ptah session start --scope harness-skill`.
  //
  // TASK_2026_104 Sub-batch B10d. The flag set mirrors `session start --scope
  // harness-skill` for stream-handling parity. Delegation lives in
  // `commands/harness.ts:runChatAlias` and ultimately calls
  // `executeSessionStart` from `session.ts`.
  // ---------------------------------------------------------------------------
  harness
    .command('chat')
    .description('alias for `ptah session start --scope harness-skill`')
    .option('--task <string>', 'free-form task prompt')
    .option('--profile <name>', 'sub-agent profile to use')
    .option('--session <id>', 'resume the given session id')
    .option('--auto-approve', 'auto-allow all permission requests', false)
    .action(
      async (opts: {
        task?: string;
        profile?: string;
        session?: string;
        autoApprove?: boolean;
      }) => {
        const exit = await harnessCmd.execute(
          {
            subcommand: 'chat',
            task: opts.task,
            profile: opts.profile,
            session: opts.session,
            autoApprove: opts.autoApprove === true,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  harness
    .command('analyze-intent')
    .description(
      'analyze a free-form intent via harness:analyze-intent and emit harness.intent.analysis',
    )
    .requiredOption('--intent <text>', 'free-form intent (min 10 chars)')
    .action(async (opts: { intent: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'analyze-intent', intent: opts.intent },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('design-agents')
    .description(
      'design sub-agents via harness:design-agents (use --workspace to derive persona from harness:initialize)',
    )
    .option(
      '--workspace',
      'derive persona + existing agents from the active workspace',
      false,
    )
    .action(async (opts: { workspace?: boolean }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'design-agents', workspace: opts.workspace === true },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  harness
    .command('generate-document')
    .description(
      'generate a project document via harness:generate-document (--kind prd|spec)',
    )
    .requiredOption('--kind <kind>', 'document kind (prd|spec)')
    .action(async (opts: { kind: string }) => {
      const exit = await harnessCmd.execute(
        { subcommand: 'generate-document', kind: opts.kind },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah agent ------------------------------------------------------------
  // TASK_2026_104 Batch B7. Replaces the deprecated `profile` surface
  // (deletion shim removed in Batch B11 — TASK_2026_104).
  const agent = program
    .command('agent')
    .description(
      'manage agent packs and individual agents (packs / list / apply)',
    );

  const agentPacks = agent
    .command('packs')
    .description('inspect and install curated agent packs');

  agentPacks
    .command('list')
    .description('emit agent.packs.list via wizard:list-agent-packs')
    .action(async () => {
      const exit = await agentCmd.execute(
        { subcommand: 'packs-list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agentPacks
    .command('install <pack-id>')
    .description(
      'install an agent pack via wizard:install-pack-agents (idempotent — emits changed:false on second run)',
    )
    .action(async (packId: string) => {
      const exit = await agentCmd.execute(
        { subcommand: 'packs-install', packId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agent
    .command('list')
    .description(
      'list locally-applied agents in .ptah/agents (pure fs scan, no DI bootstrap)',
    )
    .action(async () => {
      const exit = await agentCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agent
    .command('apply <name>')
    .description(
      'write the named agent template into .ptah/agents/<name>.md (idempotent — emits changed:false on identical content)',
    )
    .action(async (name: string) => {
      const exit = await agentCmd.execute(
        { subcommand: 'apply', name },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah agent-cli --------------------------------------------------------
  // TASK_2026_104 Batch B7. Allowlist enforced — only `glm` and `gemini` are
  // accepted for `--cli`; rejection emits ptah_code: cli_agent_unavailable
  // and exits 3 (AuthRequired). NEVER bypassable via env vars.
  const agentCli = program
    .command('agent-cli')
    .description(
      'manage CLI agents (detect / config / models / stop / resume) — allowlist: glm, gemini',
    );

  agentCli
    .command('detect')
    .description('emit agent_cli.detection via agent:detectClis')
    .action(async () => {
      const exit = await agentCliCmd.execute(
        { subcommand: 'detect' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const agentCliConfig = agentCli
    .command('config')
    .description('read or write the agent orchestration config');

  agentCliConfig
    .command('get')
    .description('emit agent_cli.config via agent:getConfig')
    .action(async () => {
      const exit = await agentCliCmd.execute(
        { subcommand: 'config-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agentCliConfig
    .command('set')
    .description(
      'write a single agent orchestration config entry via agent:setConfig',
    )
    .requiredOption('--key <key>', 'config key (e.g. maxConcurrentAgents)')
    .requiredOption('--value <value>', 'config value (coerced for known keys)')
    .action(async (opts: { key: string; value: string }) => {
      const exit = await agentCliCmd.execute(
        { subcommand: 'config-set', key: opts.key, value: opts.value },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const agentCliModels = agentCli
    .command('models')
    .description('inspect available models per CLI agent');

  agentCliModels
    .command('list')
    .description(
      'emit agent_cli.models via agent:listCliModels (--cli optional; only glm/gemini accepted)',
    )
    .option('--cli <id>', 'scope to a single allowlisted CLI (glm|gemini)')
    .action(async (opts: { cli?: string }) => {
      const exit = await agentCliCmd.execute(
        { subcommand: 'models-list', cli: opts.cli },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agentCli
    .command('stop <id>')
    .description(
      'stop a running CLI agent via agent:stop (--cli required; only glm/gemini accepted)',
    )
    .requiredOption('--cli <id>', 'allowlisted CLI id (glm|gemini)')
    .action(async (id: string, opts: { cli: string }) => {
      const exit = await agentCliCmd.execute(
        { subcommand: 'stop', agentId: id, cli: opts.cli },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  agentCli
    .command('resume <id>')
    .description(
      'resume a CLI agent session via agent:resumeCliSession (--cli required; only glm/gemini accepted)',
    )
    .requiredOption('--cli <id>', 'allowlisted CLI id (glm|gemini)')
    .option('--task <text>', 'free-form task prompt for the resumed session')
    .action(async (id: string, opts: { cli: string; task?: string }) => {
      const exit = await agentCliCmd.execute(
        {
          subcommand: 'resume',
          cliSessionId: id,
          cli: opts.cli,
          task: opts.task,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah run --------------------------------------------------------------
  // TASK_2026_104 Sub-batch B10d: `ptah run` is a thin deprecation alias for
  // `ptah session start --task <text>` and will be removed in the next
  // release. The body delegates to `executeSessionStart` and emits a single-
  // line deprecation notice on stderr.
  program
    .command('run')
    .description(
      'DEPRECATED — use `ptah session start --task` instead. Submits a single one-off task and streams events.',
    )
    .requiredOption('--task <string>', 'free-form task prompt')
    .option('--profile <name>', 'system prompt preset (claude_code|enhanced)')
    .action(async (opts: { task: string; profile?: string }) => {
      const exit = await runCmd.execute(
        { task: opts.task, profile: opts.profile },
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

  // -- ptah auth -------------------------------------------------------------
  // TASK_2026_104 Batch 8d. Sub-dispatcher: status / login / logout / test.
  const auth = program
    .command('auth')
    .description('inspect and manage agent provider authentication');

  auth
    .command('status')
    .description(
      'emit auth.status / auth.health / auth.api_key.status notifications',
    )
    .action(async () => {
      const exit = await authCmd.execute(
        { subcommand: 'status' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  auth
    .command('login <provider>')
    .description(
      'start an OAuth or out-of-band login flow for the named provider',
    )
    .action(async (provider: string) => {
      const exit = await authCmd.execute(
        { subcommand: 'login', provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  auth
    .command('logout <provider>')
    .description('log out of the named provider (codex requires --force)')
    .option(
      '--force',
      'required for `logout codex` (deletes ~/.codex/auth.json)',
      false,
    )
    .action(async (provider: string, opts: { force?: boolean }) => {
      const exit = await authCmd.execute(
        { subcommand: 'logout', provider, force: opts.force === true },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  auth
    .command('test <provider>')
    .description('issue a connection test against the named provider')
    .action(async (provider: string) => {
      const exit = await authCmd.execute(
        { subcommand: 'test', provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // `auth use <providerId>` (Stream B item #4) — switch the active auth
  // strategy without going through a full login flow. Writes
  // ptah.authMethod / ptah.defaultProvider / ptah.anthropicProviderId via
  // the workspace provider (routed to ~/.ptah/settings.json).
  auth
    .command('use <providerId>')
    .description(
      'switch active auth strategy (claude-cli | github-copilot | openai-codex | openrouter | moonshot | z-ai)',
    )
    .action(async (providerId: string) => {
      const exit = await authCmd.execute(
        { subcommand: 'use', providerId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // `auth set-anthropic-route <providerId>` (CLI bug batch item #5) — set
  // ONLY the `anthropicProviderId` config value. Pass `default` to clear.
  // Validates the id against the ANTHROPIC_PROVIDERS registry and emits
  // a `did-you-mean?` suggestion via Levenshtein distance for typos.
  auth
    .command('set-anthropic-route <providerId>')
    .description(
      'set the active Anthropic-compatible bridge provider (use `default` to clear)',
    )
    .action(async (providerId: string) => {
      const exit = await authCmd.execute(
        { subcommand: 'set-anthropic-route', providerId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah provider ---------------------------------------------------------
  // TASK_2026_104 Batch 8d. Sub-dispatcher with nested actions for default,
  // models, and tier (each spec'd in task-description.md §3.1 lines 459-469).
  const provider = program
    .command('provider')
    .description(
      'manage LLM providers (api keys, default, models, tier mapping)',
    );

  provider
    .command('status')
    .description('emit provider.status (api keys redacted unless --reveal)')
    .action(async () => {
      const exit = await providerCmd.execute(
        { subcommand: 'status' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  provider
    .command('set-key')
    .description('store an API key for a provider in secret storage')
    .requiredOption(
      '--provider <id>',
      'provider id (e.g. anthropic, openrouter)',
    )
    .requiredOption('--key <value>', 'API key (never echoed back)')
    .option(
      '--base-url <url>',
      'optional per-provider base URL override (persisted alongside the key)',
    )
    .action(
      async (opts: { provider: string; key: string; baseUrl?: string }) => {
        const exit = await providerCmd.execute(
          {
            subcommand: 'set-key',
            provider: opts.provider,
            key: opts.key,
            baseUrl: opts.baseUrl,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  provider
    .command('remove-key')
    .description('delete the stored API key for a provider')
    .requiredOption('--provider <id>', 'provider id')
    .action(async (opts: { provider: string }) => {
      const exit = await providerCmd.execute(
        { subcommand: 'remove-key', provider: opts.provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const providerDefault = provider
    .command('default')
    .description('read or write the default provider id');

  providerDefault
    .command('get')
    .description('emit provider.default with the configured default provider')
    .action(async () => {
      const exit = await providerCmd.execute(
        { subcommand: 'default', action: 'get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerDefault
    .command('set <provider>')
    .description(
      'set the default provider id and emit provider.default.updated',
    )
    .action(async (providerId: string) => {
      const exit = await providerCmd.execute(
        { subcommand: 'default', action: 'set', provider: providerId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const providerModels = provider
    .command('models')
    .description('inspect available models for a provider');

  providerModels
    .command('list')
    .description('emit provider.models for the named provider')
    .requiredOption(
      '--provider <id>',
      'provider id (e.g. anthropic, openrouter, copilot, codex)',
    )
    .action(async (opts: { provider: string }) => {
      const exit = await providerCmd.execute(
        { subcommand: 'models', action: 'list', provider: opts.provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const providerTier = provider
    .command('tier')
    .description('manage the sonnet/opus/haiku model tier mapping');

  providerTier
    .command('set')
    .description('map a tier slot to a model id and emit provider.tier.updated')
    .requiredOption('--tier <tier>', 'tier slot (sonnet|opus|haiku)')
    .requiredOption('--model <id>', 'model id to map to the tier')
    .action(async (opts: { tier: string; model: string }) => {
      const exit = await providerCmd.execute(
        {
          subcommand: 'tier',
          action: 'set',
          tier: opts.tier,
          model: opts.model,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerTier
    .command('get')
    .description('emit provider.tiers with the current tier mapping')
    .action(async () => {
      const exit = await providerCmd.execute(
        { subcommand: 'tier', action: 'get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerTier
    .command('clear')
    .description('clear a tier override and emit provider.tier.cleared')
    .requiredOption('--tier <tier>', 'tier slot (sonnet|opus|haiku)')
    .action(async (opts: { tier: string }) => {
      const exit = await providerCmd.execute(
        { subcommand: 'tier', action: 'clear', tier: opts.tier },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah provider base-url -----------------------------------------------
  // CLI parity with the desktop/extension base-URL override surface. Keys
  // route to ~/.ptah/settings.json under `provider.<id>.baseUrl` and are
  // consulted by ApiKeyStrategy.resolveProviderBaseUrl before the registry
  // default.
  const providerBaseUrl = provider
    .command('base-url')
    .description(
      'manage per-provider base URL overrides (persisted in ~/.ptah/settings.json)',
    );

  providerBaseUrl
    .command('set <url>')
    .description(
      'persist a base URL override for a provider and emit provider.base_url.set',
    )
    .requiredOption('--provider <id>', 'provider id (e.g. anthropic, ollama)')
    .action(async (url: string, opts: { provider: string }) => {
      const exit = await providerCmd.execute(
        {
          subcommand: 'base-url',
          action: 'set',
          provider: opts.provider,
          baseUrl: url,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerBaseUrl
    .command('get')
    .description(
      'emit provider.base_url with the override (if any) and registry default',
    )
    .requiredOption('--provider <id>', 'provider id')
    .action(async (opts: { provider: string }) => {
      const exit = await providerCmd.execute(
        {
          subcommand: 'base-url',
          action: 'get',
          provider: opts.provider,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerBaseUrl
    .command('clear')
    .description(
      'clear the base URL override for a provider and emit provider.base_url.cleared',
    )
    .requiredOption('--provider <id>', 'provider id')
    .action(async (opts: { provider: string }) => {
      const exit = await providerCmd.execute(
        {
          subcommand: 'base-url',
          action: 'clear',
          provider: opts.provider,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah provider ollama -------------------------------------------------
  // Convenience facade over `provider base-url ...` for the Ollama provider.
  // Identical persistence and resolution path; the only difference is the
  // hard-coded `provider: 'ollama'` and dedicated notification names.
  const providerOllama = provider
    .command('ollama')
    .description(
      'manage the local/remote Ollama endpoint (alias for `provider base-url --provider ollama`)',
    );

  providerOllama
    .command('set-endpoint <url>')
    .description(
      'persist the Ollama base URL override and emit provider.ollama.endpoint.set',
    )
    .action(async (url: string) => {
      const exit = await providerCmd.execute(
        { subcommand: 'ollama', action: 'set-endpoint', baseUrl: url },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerOllama
    .command('get-endpoint')
    .description('emit provider.ollama.endpoint with override + default URL')
    .action(async () => {
      const exit = await providerCmd.execute(
        { subcommand: 'ollama', action: 'get-endpoint' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  providerOllama
    .command('clear-endpoint')
    .description(
      'clear the Ollama base URL override and emit provider.ollama.endpoint.cleared',
    )
    .action(async () => {
      const exit = await providerCmd.execute(
        { subcommand: 'ollama', action: 'clear-endpoint' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah workspace --------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Backed by shared WorkspaceRpcHandlers (B5a).
  const workspace = program
    .command('workspace')
    .description('manage workspace folders (info / add / remove / switch)');

  workspace
    .command('info')
    .description('emit workspace.info via workspace:getInfo')
    .action(async () => {
      const exit = await workspaceCmd.execute(
        { subcommand: 'info' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  workspace
    .command('add')
    .description('register a workspace folder via workspace:registerFolder')
    .requiredOption(
      '--path <dir>',
      'folder path (no native picker in headless mode)',
    )
    .action(async (opts: { path: string }) => {
      const exit = await workspaceCmd.execute(
        { subcommand: 'add', path: opts.path },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  workspace
    .command('remove')
    .description('remove a workspace folder via workspace:removeFolder')
    .requiredOption('--path <dir>', 'folder path')
    .action(async (opts: { path: string }) => {
      const exit = await workspaceCmd.execute(
        { subcommand: 'remove', path: opts.path },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  workspace
    .command('switch')
    .description('switch the active workspace via workspace:switch')
    .requiredOption('--path <dir>', 'folder path to switch to')
    .action(async (opts: { path: string }) => {
      const exit = await workspaceCmd.execute(
        { subcommand: 'switch', path: opts.path },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah skill ------------------------------------------------------------
  // TASK_2026_104 Sub-batch B6b. Backed by `SkillsShRpcHandlers` re-registered
  // in the CLI app + shared `harness:create-skill`.
  const skill = program
    .command('skill')
    .description(
      'manage skills.sh skills (search / installed / install / remove / popular / recommended / create)',
    );

  skill
    .command('search <query>')
    .description('search the skills.sh registry via skillsSh:search')
    .action(async (query: string) => {
      const exit = await skillCmd.execute(
        { subcommand: 'search', query },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  skill
    .command('installed')
    .description('list locally-installed skills via skillsSh:listInstalled')
    .action(async () => {
      const exit = await skillCmd.execute(
        { subcommand: 'installed' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  skill
    .command('install <source>')
    .description(
      'install a skill via skillsSh:install (idempotent — second run reports changed:false)',
    )
    .option('--skill-id <id>', 'optional skill id inside the source repo')
    .option('--scope <scope>', 'installation scope (project|global)', 'project')
    .action(
      async (source: string, opts: { skillId?: string; scope?: string }) => {
        const exit = await skillCmd.execute(
          {
            subcommand: 'install',
            source,
            skillId: opts.skillId,
            scope: opts.scope,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  skill
    .command('remove <name>')
    .description(
      'uninstall a skill via skillsSh:uninstall (idempotent — emits changed:false when absent)',
    )
    .option('--scope <scope>', 'installation scope (project|global)', 'project')
    .action(async (name: string, opts: { scope?: string }) => {
      const exit = await skillCmd.execute(
        { subcommand: 'remove', name, scope: opts.scope },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  skill
    .command('popular')
    .description('emit the curated popular skills list via skillsSh:getPopular')
    .action(async () => {
      const exit = await skillCmd.execute(
        { subcommand: 'popular' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  skill
    .command('recommended')
    .description(
      'detect workspace technologies and emit recommended skills via skillsSh:detectRecommended',
    )
    .action(async () => {
      const exit = await skillCmd.execute(
        { subcommand: 'recommended' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  skill
    .command('create')
    .description(
      'create a skill from a JSON spec via harness:create-skill (--from-spec is required)',
    )
    .requiredOption(
      '--from-spec <path>',
      'path to a JSON file with name/description/content[/allowedTools]',
    )
    .action(async (opts: { fromSpec: string }) => {
      const exit = await skillCmd.execute(
        { subcommand: 'create', fromSpec: opts.fromSpec },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah mcp --------------------------------------------------------------
  // TASK_2026_104 Sub-batch B6b. Backed by shared McpDirectoryRpcHandlers (B6a).
  const mcp = program
    .command('mcp')
    .description(
      'browse and install MCP servers (search / details / install / uninstall / list / popular)',
    );

  mcp
    .command('search <query>')
    .description('search the Official MCP Registry via mcpDirectory:search')
    .option('--limit <n>', 'max results to return', (raw) =>
      Number.parseInt(raw, 10),
    )
    .action(async (query: string, opts: { limit?: number }) => {
      const exit = await mcpCmd.execute(
        { subcommand: 'search', query, limit: opts.limit },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  mcp
    .command('details <name>')
    .description('fetch a server entry via mcpDirectory:getDetails')
    .action(async (name: string) => {
      const exit = await mcpCmd.execute(
        { subcommand: 'details', name },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  mcp
    .command('install <name>')
    .description(
      'install an MCP server to one target via mcpDirectory:install (idempotent — emits changed:false on re-install with same config)',
    )
    .requiredOption(
      '--target <id>',
      'install target (vscode|claude|cursor|gemini|copilot)',
    )
    .action(async (name: string, opts: { target: string }) => {
      const exit = await mcpCmd.execute(
        { subcommand: 'install', name, target: opts.target },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  mcp
    .command('uninstall <key>')
    .description(
      'uninstall an MCP server from one target via mcpDirectory:uninstall (idempotent — emits changed:false when absent)',
    )
    .requiredOption(
      '--target <id>',
      'install target (vscode|claude|cursor|gemini|copilot)',
    )
    .action(async (key: string, opts: { target: string }) => {
      const exit = await mcpCmd.execute(
        { subcommand: 'uninstall', key, target: opts.target },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  mcp
    .command('list')
    .description('list installed MCP servers via mcpDirectory:listInstalled')
    .action(async () => {
      const exit = await mcpCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  mcp
    .command('popular')
    .description('emit popular/trending servers via mcpDirectory:getPopular')
    .action(async () => {
      const exit = await mcpCmd.execute(
        { subcommand: 'popular' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah plugin -----------------------------------------------------------
  // TASK_2026_104 Sub-batch B6c. Backed by shared PluginRpcHandlers.
  // NOTE: there is intentionally NO `install` sub-subcommand — Discovery D8
  // locked "install = enable" so `plugin enable <id>` IS the install verb.
  const plugin = program
    .command('plugin')
    .description(
      'manage workspace plugins (list / enable / disable / config / skills) — install = enable',
    );

  plugin
    .command('list')
    .description('emit plugin.list via plugins:list-available')
    .action(async () => {
      const exit = await pluginCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  plugin
    .command('enable <id>')
    .description(
      'enable (= install) a plugin via plugins:save-config (idempotent — emits changed:false when already enabled)',
    )
    .action(async (id: string) => {
      const exit = await pluginCmd.execute(
        { subcommand: 'enable', id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  plugin
    .command('disable <id>')
    .description(
      'disable a plugin via plugins:save-config (idempotent — emits changed:false when already disabled)',
    )
    .action(async (id: string) => {
      const exit = await pluginCmd.execute(
        { subcommand: 'disable', id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const pluginConfig = plugin
    .command('config')
    .description('read or write the plugin config');

  pluginConfig
    .command('get')
    .description(
      'emit plugin.config.value via plugins:get-config (enabled plugin ids + disabled skill ids)',
    )
    .action(async () => {
      const exit = await pluginCmd.execute(
        { subcommand: 'config-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  pluginConfig
    .command('set')
    .description(
      'replace the plugin config via plugins:save-config (idempotent — emits changed:false when state matches)',
    )
    .option(
      '--enabled <list>',
      'comma-separated enabled plugin ids (omit to keep current)',
      collectCsv,
    )
    .option(
      '--disabled-skills <list>',
      'comma-separated disabled skill ids (omit to keep current)',
      collectCsv,
    )
    .action(async (opts: { enabled?: string[]; disabledSkills?: string[] }) => {
      const exit = await pluginCmd.execute(
        {
          subcommand: 'config-set',
          enabled: opts.enabled,
          disabledSkills: opts.disabledSkills,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const pluginSkills = plugin
    .command('skills')
    .description('inspect skills exposed by enabled plugins');

  pluginSkills
    .command('list')
    .description(
      'emit plugin.skills.list via plugins:list-skills (defaults to currently-enabled plugins; pass --plugins to override)',
    )
    .option(
      '--plugins <list>',
      'comma-separated plugin ids to scope',
      collectCsv,
    )
    .action(async (opts: { plugins?: string[] }) => {
      const exit = await pluginCmd.execute(
        { subcommand: 'skills-list', plugins: opts.plugins },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah prompts ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B6c. Backed by shared EnhancedPromptsRpcHandlers.
  // The `regenerate` sub-subcommand is premium-gated (license_required is
  // surfaced by the backend and converted to a task.error).
  const prompts = program
    .command('prompts')
    .description(
      'manage Enhanced Prompts (status / enable / disable / regenerate / show / download) — premium-gated',
    );

  prompts
    .command('status')
    .description('emit prompts.status via enhancedPrompts:getStatus')
    .action(async () => {
      const exit = await promptsCmd.execute(
        { subcommand: 'status' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  prompts
    .command('enable')
    .description('enable enhanced prompts via enhancedPrompts:setEnabled')
    .action(async () => {
      const exit = await promptsCmd.execute(
        { subcommand: 'enable' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  prompts
    .command('disable')
    .description('disable enhanced prompts via enhancedPrompts:setEnabled')
    .action(async () => {
      const exit = await promptsCmd.execute(
        { subcommand: 'disable' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  prompts
    .command('regenerate')
    .description(
      'regenerate the project prompt via enhancedPrompts:regenerate (premium-gated; streams via setup-wizard:enhance-stream)',
    )
    .option(
      '--no-force',
      'skip the regenerate when a recent cache exists (default: --force)',
    )
    .action(async (opts: { force?: boolean }) => {
      const exit = await promptsCmd.execute(
        { subcommand: 'regenerate', force: opts.force !== false },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  prompts
    .command('show <name>')
    .description(
      'emit prompts.content via enhancedPrompts:getPromptContent (the <name> is informational — backend returns the combined prompt)',
    )
    .action(async (name: string) => {
      const exit = await promptsCmd.execute(
        { subcommand: 'show', name },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  prompts
    .command('download')
    .description(
      'download the combined prompt to disk via enhancedPrompts:download',
    )
    .action(async () => {
      const exit = await promptsCmd.execute(
        { subcommand: 'download' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah git --------------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Backed by shared GitRpcHandlers (B5b).
  const git = program
    .command('git')
    .description('git introspection + worktrees + source control');

  git
    .command('info')
    .description('emit git.info via git:info')
    .action(async () => {
      const exit = await gitCmd.execute(
        { subcommand: 'info' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('worktrees')
    .description('emit git.worktrees via git:worktrees')
    .action(async () => {
      const exit = await gitCmd.execute(
        { subcommand: 'worktrees' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('add-worktree')
    .description('add a worktree via git:addWorktree')
    .requiredOption('--branch <name>', 'branch name')
    .option('--path <dir>', 'worktree directory')
    .option('--create', 'create the branch if it does not exist', false)
    .action(
      async (opts: { branch: string; path?: string; create?: boolean }) => {
        const exit = await gitCmd.execute(
          {
            subcommand: 'add-worktree',
            branch: opts.branch,
            path: opts.path,
            createBranch: opts.create === true,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  git
    .command('remove-worktree')
    .description('remove a worktree via git:removeWorktree')
    .requiredOption('--path <dir>', 'worktree directory')
    .option('--force', 'force-remove even with uncommitted changes', false)
    .action(async (opts: { path: string; force?: boolean }) => {
      const exit = await gitCmd.execute(
        {
          subcommand: 'remove-worktree',
          path: opts.path,
          force: opts.force === true,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('stage')
    .description('stage paths via git:stage')
    .requiredOption('--paths <list>', 'comma-separated paths', collectCsv)
    .action(async (opts: { paths: string[] }) => {
      const exit = await gitCmd.execute(
        { subcommand: 'stage', paths: opts.paths },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('unstage')
    .description('unstage paths via git:unstage')
    .requiredOption('--paths <list>', 'comma-separated paths', collectCsv)
    .action(async (opts: { paths: string[] }) => {
      const exit = await gitCmd.execute(
        { subcommand: 'unstage', paths: opts.paths },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('discard')
    .description(
      'discard local changes via git:discard (DESTRUCTIVE — requires --confirm)',
    )
    .requiredOption('--paths <list>', 'comma-separated paths', collectCsv)
    .option('--confirm', 'required for git discard (destructive)', false)
    .action(async (opts: { paths: string[]; confirm?: boolean }) => {
      const exit = await gitCmd.execute(
        {
          subcommand: 'discard',
          paths: opts.paths,
          confirm: opts.confirm === true,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('commit')
    .description('commit staged changes via git:commit')
    .requiredOption('--message <msg>', 'commit message')
    .action(async (opts: { message: string }) => {
      const exit = await gitCmd.execute(
        { subcommand: 'commit', message: opts.message },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  git
    .command('show-file')
    .description('emit the HEAD content of <path> via git:showFile')
    .requiredOption('--path <file>', 'file path relative to repo root')
    .action(async (opts: { path: string }) => {
      const exit = await gitCmd.execute(
        { subcommand: 'show-file', path: opts.path },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah license ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Backed by shared LicenseRpcHandlers.
  const license = program
    .command('license')
    .description('inspect / set / clear the Ptah license key');

  license
    .command('status')
    .description('emit license.status via license:getStatus')
    .action(async () => {
      const exit = await licenseCmd.execute(
        { subcommand: 'status' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  license
    .command('set')
    .description('set the license key via license:setKey')
    .requiredOption('--key <ptah_lic_...>', 'license key (ptah_lic_<64-hex>)')
    .action(async (opts: { key: string }) => {
      const exit = await licenseCmd.execute(
        { subcommand: 'set', key: opts.key },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  license
    .command('clear')
    .description('clear the license key via license:clearKey')
    .action(async () => {
      const exit = await licenseCmd.execute(
        { subcommand: 'clear' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah websearch --------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Backed by shared WebSearchRpcHandlers.
  const websearch = program
    .command('websearch')
    .description('web-search provider settings + connectivity test');

  websearch
    .command('status')
    .description('emit websearch.status (key redacted unless --reveal)')
    .option('--provider <id>', 'override the provider id (defaults to active)')
    .action(async (opts: { provider?: string }) => {
      const exit = await websearchCmd.execute(
        { subcommand: 'status', provider: opts.provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  websearch
    .command('set-key')
    .description('store a web-search API key via webSearch:setApiKey')
    .requiredOption('--provider <id>', 'provider id (e.g. tavily, serper)')
    .requiredOption('--key <value>', 'API key (never echoed back)')
    .action(async (opts: { provider: string; key: string }) => {
      const exit = await websearchCmd.execute(
        { subcommand: 'set-key', provider: opts.provider, key: opts.key },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  websearch
    .command('remove-key')
    .description(
      'delete a stored web-search API key via webSearch:deleteApiKey',
    )
    .requiredOption('--provider <id>', 'provider id')
    .action(async (opts: { provider: string }) => {
      const exit = await websearchCmd.execute(
        { subcommand: 'remove-key', provider: opts.provider },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  websearch
    .command('test')
    .description('issue a connectivity test via webSearch:test')
    .action(async () => {
      const exit = await websearchCmd.execute(
        { subcommand: 'test' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  const websearchConfig = websearch
    .command('config')
    .description('read or write the web-search config');

  websearchConfig
    .command('get')
    .description('emit websearch.config via webSearch:getConfig')
    .action(async () => {
      const exit = await websearchCmd.execute(
        { subcommand: 'config-get' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  websearchConfig
    .command('set')
    .description('update the web-search config via webSearch:setConfig')
    .option('--provider <id>', 'set the active provider id')
    .option('--max-results <n>', 'set the max-results cap', (raw) =>
      Number.parseInt(raw, 10),
    )
    .action(async (opts: { provider?: string; maxResults?: number }) => {
      const exit = await websearchCmd.execute(
        {
          subcommand: 'config-set',
          provider: opts.provider,
          maxResults: opts.maxResults,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah settings ---------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Direct DI to SDK SettingsExportService /
  // SettingsImportService — bypasses the Electron-only RPC dialogs.
  const settings = program
    .command('settings')
    .description('export / import portable settings bundles');

  settings
    .command('export')
    .description('export a portable settings bundle (writes 0o600 on --out)')
    .option('--out <path>', 'output path (defaults to stdout — caller chmods)')
    .action(async (opts: { out?: string }) => {
      const exit = await settingsCmd.execute(
        { subcommand: 'export', out: opts.out },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  settings
    .command('import')
    .description(
      'import a settings bundle (preserves credentials unless --overwrite)',
    )
    .option('--in <path>', 'input path (defaults to stdin)')
    .option('--overwrite', 'overwrite existing credentials', false)
    .action(async (opts: { in?: string; overwrite?: boolean }) => {
      const exit = await settingsCmd.execute(
        {
          subcommand: 'import',
          in: opts.in,
          overwrite: opts.overwrite === true,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah quality ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B9b. Backed by shared QualityRpcHandlers.
  const quality = program
    .command('quality')
    .description(
      'inspect the quality dashboard (assessment / history / export)',
    );

  quality
    .command('assessment')
    .description('emit quality.assessment via quality:getAssessment')
    .option('--id <id>', 'advisory assessment id (forwarded but unused today)')
    .action(async (opts: { id?: string }) => {
      const exit = await qualityCmd.execute(
        { subcommand: 'assessment', id: opts.id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  quality
    .command('history')
    .description('emit quality.history via quality:getHistory')
    .option('--limit <n>', 'max entries to return', (raw) =>
      Number.parseInt(raw, 10),
    )
    .action(async (opts: { limit?: number }) => {
      const exit = await qualityCmd.execute(
        { subcommand: 'history', limit: opts.limit },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  quality
    .command('export')
    .description(
      'export the latest quality report as JSON via quality:export (writes to --out, or stdout if omitted)',
    )
    .option('--out <path>', 'output path (defaults to stdout)')
    .action(async (opts: { out?: string }) => {
      const exit = await qualityCmd.execute(
        { subcommand: 'export', out: opts.out },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah session ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B10c. 10-sub-subcommand dispatcher driving the
  // chat session surface end-to-end. Streaming sub-subcommands (start/resume/
  // send) wire B10b's ChatBridge + ApprovalBridge against the engine's
  // pushAdapter; non-streaming ones run a single RPC and exit. State persisted
  // under WORKSPACE_STATE_STORAGE namespace `sessions.<tabId>`.
  const session = program
    .command('session')
    .description(
      'manage chat sessions (start / resume / send / list / stop / delete / rename / load / stats / validate)',
    );

  session
    .command('start')
    .description(
      'start a new chat session — synthesizes a tabId, persists the entry, and (with --task) streams a turn',
    )
    .option('--profile <name>', 'system prompt preset (claude_code|enhanced)')
    .option('--task <text>', 'initial prompt — when given, streams the turn')
    .option('--once', 'exit after first turn completes', false)
    .option('--scope <scope>', 'forward-compat scope (e.g. harness-skill)')
    .action(
      async (opts: {
        profile?: string;
        task?: string;
        once?: boolean;
        scope?: string;
      }) => {
        const profile =
          opts.profile === 'claude_code' || opts.profile === 'enhanced'
            ? opts.profile
            : undefined;
        const exit = await sessionCmd.execute(
          {
            subcommand: 'start',
            profile,
            task: opts.task,
            once: opts.once === true,
            scope: opts.scope,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  session
    .command('resume <id>')
    .description(
      'resume an existing session — looks up by tabId or treats <id> as the SDK session id; with --task streams the next turn',
    )
    .option('--task <text>', 'follow-up prompt — when given, streams the turn')
    .action(async (id: string, opts: { task?: string }) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'resume', id, task: opts.task },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('send <id>')
    .description('send a follow-up turn to an existing session and stream it')
    .requiredOption('--task <text>', 'turn prompt (required)')
    .action(async (id: string, opts: { task: string }) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'send', id, task: opts.task },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('list')
    .description(
      'list sessions for the active workspace via session:list (best-effort enrichment with running + background agents)',
    )
    .action(async () => {
      const exit = await sessionCmd.execute(
        { subcommand: 'list' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('stop <id>')
    .description('abort an in-flight session via chat:abort')
    .action(async (id: string) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'stop', id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('delete <id>')
    .description(
      'delete a session via session:delete and remove the local persisted entry',
    )
    .action(async (id: string) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'delete', id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('rename <id>')
    .description('rename a session via session:rename')
    .requiredOption('--to <name>', 'new session name')
    .action(async (id: string, opts: { to: string }) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'rename', id, to: opts.to },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('load <id>')
    .description(
      'load full session history via session:load and emit session.history (writes JSON to --out when given)',
    )
    .option('--out <path>', 'output path for the JSON dump')
    .action(async (id: string, opts: { out?: string }) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'load', id, out: opts.out },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('stats')
    .description(
      'emit per-session stats via session:stats-batch (--ids comma-separated; empty = all)',
    )
    .option('--ids <csv>', 'comma-separated session ids')
    .action(async (opts: { ids?: string }) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'stats', ids: opts.ids },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  session
    .command('validate <id>')
    .description(
      'check whether a session id has an on-disk record via session:validate',
    )
    .action(async (id: string) => {
      const exit = await sessionCmd.execute(
        { subcommand: 'validate', id },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah new-project ------------------------------------------------------
  // TASK_2026_104 Sub-batch B9b. Backed by the New Project Wizard handlers
  // inside the shared SetupRpcHandlers.
  const newProject = program
    .command('new-project')
    .description(
      'New Project Wizard (select-type / submit-answers / get-plan / approve-plan)',
    );

  newProject
    .command('select-type <type>')
    .description(
      'fetch question groups for a project type via wizard:new-project-select-type',
    )
    .action(async (type: string) => {
      const exit = await newProjectCmd.execute(
        { subcommand: 'select-type', projectType: type },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  newProject
    .command('submit-answers')
    .description(
      'submit discovery answers (read from --file <path>) via wizard:new-project-submit-answers',
    )
    .requiredOption(
      '--file <path>',
      'JSON file with { projectType, projectName, answers[, force] }',
    )
    .action(async (opts: { file: string }) => {
      const exit = await newProjectCmd.execute(
        { subcommand: 'submit-answers', file: opts.file },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  newProject
    .command('get-plan <session-id>')
    .description(
      'load the previously-generated master plan via wizard:new-project-get-plan',
    )
    .action(async (sessionId: string) => {
      const exit = await newProjectCmd.execute(
        { subcommand: 'get-plan', sessionId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  newProject
    .command('approve-plan <session-id>')
    .description(
      'approve and persist the master plan via wizard:new-project-approve-plan',
    )
    .action(async (sessionId: string) => {
      const exit = await newProjectCmd.execute(
        { subcommand: 'approve-plan', sessionId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah wizard -----------------------------------------------------------
  // TASK_2026_104 Sub-batch B9c. Low-level Setup Wizard escape hatch backed by
  // WizardGenerationRpcHandlers (submit-selection / cancel / retry-item) plus
  // a status read of `setup.lastCompletedPhase` from WORKSPACE_STATE_STORAGE.
  // The high-level orchestrator lives in `ptah setup` (B9d).
  const wizard = program
    .command('wizard')
    .description(
      'low-level Setup Wizard sub-commands (submit-selection / cancel / retry-item / status)',
    );

  wizard
    .command('submit-selection')
    .description(
      'submit a wizard selection (read from --file <path>) via wizard:submit-selection — fire-and-forget; waits for setup-wizard:generation-complete (10-min cap)',
    )
    .requiredOption(
      '--file <path>',
      'JSON file with { selectedAgentIds, threshold?, variableOverrides?, analysisData?, analysisDir?, model? }',
    )
    .action(async (opts: { file: string }) => {
      const exit = await wizardCmd.execute(
        { subcommand: 'submit-selection', file: opts.file },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  wizard
    .command('cancel <session-id>')
    .description(
      'cancel an in-flight wizard session via wizard:cancel { saveProgress: true } — idempotent, always exits 0',
    )
    .action(async (sessionId: string) => {
      const exit = await wizardCmd.execute(
        { subcommand: 'cancel', sessionId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  wizard
    .command('retry-item <item-id>')
    .description(
      'retry a single failed generation item via wizard:retry-item (synchronous; emits wizard.retry.{start,complete})',
    )
    .action(async (itemId: string) => {
      const exit = await wizardCmd.execute(
        { subcommand: 'retry-item', itemId },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  wizard
    .command('status')
    .description(
      'emit wizard.status with the last completed setup phase (read from WORKSPACE_STATE_STORAGE — null until B9d setup runs)',
    )
    .action(async () => {
      const exit = await wizardCmd.execute(
        { subcommand: 'status' },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah setup ------------------------------------------------------------
  // TASK_2026_104 Sub-batch B9d. Top-level 5-phase Setup Wizard orchestrator
  // built on top of the B9c phase-runner. Each phase is wrapped with a best-
  // effort rollback strategy; `setup.lastCompletedPhase` is persisted to
  // WORKSPACE_STATE_STORAGE after every successful phase (so `ptah wizard
  // status` from B9c reads the live progress). On any phase failure: emits
  // `task.error { ptah_code: 'wizard_phase_failed', data: { phase, error } }`
  // and exits 1. `--dry-run` skips phases 3-5 (writes-free smoke test).
  program
    .command('setup')
    .description(
      'run the 5-phase Setup Wizard end-to-end (analyze → recommend → install_pack → generate → apply_harness)',
    )
    .option(
      '--dry-run',
      'skip phases 3-5 (only run analyze + recommend; emits dry_run: true)',
      false,
    )
    .option(
      '--auto-approve',
      'forward auto-approve to harness:apply config (forward-compatible)',
      false,
    )
    .action(async (opts: { dryRun?: boolean; autoApprove?: boolean }) => {
      const exit = await setupCmd.execute(
        {
          dryRun: opts.dryRun === true,
          autoApprove: opts.autoApprove === true,
        },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah analyze ----------------------------------------------------------
  // TASK_2026_104 Sub-batch B5d. Top-level command — drives wizard:deep-analyze
  // and streams analyze.* notifications. Premium licence gated by the backend.
  program
    .command('analyze')
    .description('run a multi-phase workspace analysis via wizard:deep-analyze')
    .option('--model <id>', 'model id forwarded to the analysis pipeline')
    .option(
      '--save',
      'persist the bundle to ~/.ptah/analyses/<slug>/manifest.json',
      false,
    )
    .option('--out <path>', 'explicit output path (implies --save)')
    .action(async (opts: { model?: string; save?: boolean; out?: string }) => {
      const exit = await analyzeCmd.execute(
        { model: opts.model, save: opts.save === true, out: opts.out },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  // -- ptah doctor / diagnose ------------------------------------------------
  // Stream B item #7. Top-level diagnostic snapshot. Boots the full DI graph
  // with `requireSdk: false` so the report still renders when auth is broken.
  // Emits a single `doctor.report` notification then exits.
  const doctorAction = async (): Promise<void> => {
    const exit = await doctorCmd.execute({}, resolveGlobals(program));
    process.exitCode = exit;
  };
  program
    .command('doctor')
    .description(
      'emit a doctor.report snapshot (license, auth, providers, effective route)',
    )
    .action(doctorAction);
  program
    .command('diagnose')
    .description('alias for `ptah doctor`')
    .action(doctorAction);

  // -- ptah proxy ------------------------------------------------------------
  // Anthropic-compatible HTTP proxy (TASK_2026_104 P2). `start` is long-blocking;
  // `stop` and `status` are deferred to Phase 2.
  const proxyCommand = program
    .command('proxy')
    .description('Anthropic-compatible HTTP proxy (Messages API)');

  proxyCommand
    .command('start')
    .description('start the HTTP proxy and block until SIGINT/SIGTERM')
    .requiredOption(
      '--port <number>',
      'TCP port to bind (0 = OS-assigned)',
      (v) => Number.parseInt(v, 10),
    )
    .option('--host <addr>', 'bind address', '127.0.0.1')
    .option(
      '--idle-timeout <seconds>',
      'auto-shutdown after N seconds idle (0 = disabled)',
      (v) => Number.parseInt(v, 10),
      0,
    )
    .option(
      '--no-expose-workspace-tools',
      'disable workspace MCP / plugin-skill tool merging into caller `tools[]`',
    )
    .action(
      async (opts: {
        port: number;
        host: string;
        idleTimeout: number;
        exposeWorkspaceTools: boolean;
      }) => {
        const exit = await proxyCmd.executeStart(
          {
            port: opts.port,
            host: opts.host,
            idleTimeout: opts.idleTimeout,
            exposeWorkspaceTools: opts.exposeWorkspaceTools !== false,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  proxyCommand
    .command('stop')
    .description(
      'stop a running proxy registered in ~/.ptah/proxies/<port>.json',
    )
    .option('--port <number>', 'port of the proxy to stop', (v) =>
      Number.parseInt(v, 10),
    )
    .action(async (opts: { port?: number }) => {
      const exit = await proxyCmd.executeStop(
        { port: opts.port },
        resolveGlobals(program),
      );
      process.exitCode = exit;
    });

  proxyCommand
    .command('status')
    .description('list running proxies registered in ~/.ptah/proxies/')
    .action(async () => {
      const exit = await proxyCmd.executeStatus({}, resolveGlobals(program));
      process.exitCode = exit;
    });

  // -- ptah interact ---------------------------------------------------------
  program
    .command('interact')
    .description('persistent JSON-RPC 2.0 stdio session')
    .option('--session <id>', 'resume or create the session with this id')
    .option(
      '--proxy-start',
      'boot an embedded Anthropic-compatible HTTP proxy alongside the interact loop',
      false,
    )
    .option(
      '--proxy-port <port>',
      'TCP port for the embedded proxy (0 = OS-assigned)',
      (raw) => Number.parseInt(raw, 10),
      0,
    )
    .option(
      '--proxy-host <host>',
      'bind host for the embedded proxy',
      '127.0.0.1',
    )
    .option(
      '--proxy-expose-workspace-tools',
      'surface workspace MCP tools through the embedded proxy',
      false,
    )
    .action(
      async (opts: {
        session?: string;
        proxyStart?: boolean;
        proxyPort?: number;
        proxyHost?: string;
        proxyExposeWorkspaceTools?: boolean;
      }) => {
        const exit = await interactCmd.execute(
          {
            session: opts.session,
            proxyStart: opts.proxyStart === true,
            proxyPort:
              typeof opts.proxyPort === 'number' &&
              Number.isFinite(opts.proxyPort)
                ? opts.proxyPort
                : 0,
            proxyHost: opts.proxyHost ?? '127.0.0.1',
            proxyExposeWorkspaceTools: opts.proxyExposeWorkspaceTools === true,
          },
          resolveGlobals(program),
        );
        process.exitCode = exit;
      },
    );

  return program;
}
