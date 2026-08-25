/**
 * `ptah skill` command — Skills.sh marketplace operations.
 *
 * Backed by `SkillsShRpcHandlers` re-registered inside the CLI app
 * (`apps/ptah-cli/src/services/rpc/handlers/skills-sh-rpc.handlers.ts`)
 * mirroring the Electron implementation verbatim. The `create` sub-subcommand
 * additionally hits the shared `harness:create-skill` RPC for AI-driven skill
 * creation from a wizard spec.
 *
 * Sub-commands (per task-description.md §3 `skill *` table):
 *
 *   search <query>             RPC `skillsSh:search`
 *   installed                  RPC `skillsSh:listInstalled`
 *   install <source> [--skill-id <id>]
 *                              RPC `skillsSh:install` (idempotent — second
 *                              run reports `changed: false`)
 *   remove <name>              RPC `skillsSh:uninstall`
 *   popular                    RPC `skillsSh:getPopular`
 *   recommended                RPC `skillsSh:detectRecommended`
 *   create [--from-spec <path>] RPC `harness:create-skill`
 *   select [slug...] | --all   RPC `harness:set-skill-selection`
 *   selection                  RPC `harness:get-skill-selection`
 *
 * Idempotency contract (`skill.installed` payload):
 *   - `changed: bool` — true on first successful install, false when
 *     `skillsSh:listInstalled` already shows the skill present (matched by
 *     `source` ± `skillId`) before the install call.
 *
 * ## The per-workspace selection (TASK_2026_316)
 *
 * `select` / `selection` are the headless half of the desktop selection dialog.
 * Both go over the RPC transport and neither resolves `SkillSyncGate` (or any
 * other `harness-sync` internal) out of DI — that is what keeps this CLI, the
 * TUI's `/harness` and the Marketplace badge on ONE implementation of what a
 * workspace propagates. Without them a headless host is stuck with whatever the
 * desktop app last chose, which it may never have run.
 *
 * They boot `requireSdk: false`, unlike their skills.sh siblings above. Those
 * either hit the network or ask a model something; these two only read and
 * write `{ws}/.ptah/harness/state.json` and then copy files, so requiring an
 * API key would refuse the selection on exactly the unattended machine that
 * needs to set it. `mode` stays `'full'` for `harness doctor`'s reason: the
 * handlers and the plugin overlay that gives the reconciler its desired state
 * are both registered in DI phase 4.
 *
 * `--scope` is GONE (TASK_2026_288). It used to choose between
 * `{ws}/.claude/skills` and `~/.claude/skills`; a skills.sh skill now lands in a
 * user-global source root under `~/.ptah/plugins` and is propagated into every
 * detected CLI by the harness reconciler, so neither value named a real
 * destination any more. Per-workspace control is `disabledPluginIds` /
 * `disabledSkillIds`, and unlike an install-time flag it is reversible.
 */

import { promises as fs } from 'node:fs';

import { withEngine } from '@ptah-extension/cli-engine';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '@ptah-extension/cli-engine';
import type {
  HarnessGetSkillSelectionResult,
  HarnessSetSkillSelectionParams,
  HarnessSetSkillSelectionResult,
  InstalledSkill,
  SkillDetectionResult,
  SkillShEntry,
} from '@ptah-extension/shared';

export type SkillSubcommand =
  | 'search'
  | 'installed'
  | 'install'
  | 'remove'
  | 'popular'
  | 'recommended'
  | 'create'
  | 'select'
  | 'selection';

export interface SkillOptions {
  subcommand: SkillSubcommand;
  /** For `search` — free-form query. */
  query?: string;
  /** For `install` — owner/repo source (e.g. "vercel-labs/agent-skills"). */
  source?: string;
  /** For `install` — optional skill identifier inside the repo. */
  skillId?: string;
  /** For `remove` — local skill name. */
  name?: string;
  /** For `create` — optional path to a JSON spec describing the skill. */
  fromSpec?: string;
  /**
   * For `select` — the skill directory names to propagate. Mutually exclusive
   * with {@link all}.
   */
  slugs?: string[];
  /** For `select` — propagate everything the user layer offers. */
  all?: boolean;
}

export interface SkillStderrLike {
  write(chunk: string): boolean;
}

export interface SkillExecuteHooks {
  stderr?: SkillStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /**
   * Override hook for tests — read a JSON skill-spec from disk. Default uses
   * `node:fs/promises`.
   */
  readSpec?: (path: string) => Promise<string>;
}

export async function execute(
  opts: SkillOptions,
  globals: GlobalOptions,
  hooks: SkillExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: SkillStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const readSpec = hooks.readSpec ?? ((p: string) => fs.readFile(p, 'utf8'));

  try {
    switch (opts.subcommand) {
      case 'search':
        return await runSearch(opts, globals, formatter, stderr, engine);
      case 'installed':
        return await runInstalled(globals, formatter, engine);
      case 'install':
        return await runInstall(opts, globals, formatter, stderr, engine);
      case 'remove':
        return await runRemove(opts, globals, formatter, stderr, engine);
      case 'popular':
        return await runPopular(globals, formatter, engine);
      case 'recommended':
        return await runRecommended(globals, formatter, engine);
      case 'create':
        return await runCreate(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          readSpec,
        );
      case 'select':
        return await runSelect(opts, globals, formatter, stderr, engine);
      case 'selection':
        return await runSelection(globals, formatter, engine);
      default:
        stderr.write(
          `ptah skill: unknown sub-command '${String(opts.subcommand)}'\n`,
        );
        return ExitCode.UsageError;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await formatter.writeNotification('task.error', {
      ptah_code: 'internal_failure',
      message,
    });
    return ExitCode.InternalFailure;
  }
}

async function runSearch(
  opts: SkillOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.query || opts.query.trim().length === 0) {
    stderr.write('ptah skill search: <query> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      skills: SkillShEntry[];
      error?: string;
    }>(ctx.transport, 'skillsSh:search', { query: opts.query });
    if (result?.error) {
      throw new Error(result.error);
    }
    await formatter.writeNotification('skill.search', {
      query: opts.query,
      skills: result?.skills ?? [],
    });
    return ExitCode.Success;
  });
}

async function runInstalled(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ skills: InstalledSkill[] }>(
      ctx.transport,
      'skillsSh:listInstalled',
      {},
    );
    await formatter.writeNotification('skill.list', {
      skills: result?.skills ?? [],
    });
    return ExitCode.Success;
  });
}

async function runInstall(
  opts: SkillOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.source || opts.source.trim().length === 0) {
    stderr.write('ptah skill install: <source> is required (owner/repo)\n');
    return ExitCode.UsageError;
  }
  const source = opts.source;
  const skillId = opts.skillId;
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const before = await callRpc<{ skills: InstalledSkill[] }>(
      ctx.transport,
      'skillsSh:listInstalled',
      {},
    );
    const alreadyInstalled = isAlreadyInstalled(
      before?.skills ?? [],
      source,
      skillId,
    );
    if (alreadyInstalled) {
      await formatter.writeNotification('skill.installed', {
        source,
        skillId,
        changed: false,
      });
      return ExitCode.Success;
    }

    const params: {
      source: string;
      skillId?: string;
    } = { source };
    if (skillId) {
      params.skillId = skillId;
    }
    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'skillsSh:install',
      params,
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'skillsSh:install failed');
    }
    await formatter.writeNotification('skill.installed', {
      source,
      skillId,
      changed: true,
    });
    return ExitCode.Success;
  });
}

async function runRemove(
  opts: SkillOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.name || opts.name.trim().length === 0) {
    stderr.write('ptah skill remove: <name> is required\n');
    return ExitCode.UsageError;
  }
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const before = await callRpc<{ skills: InstalledSkill[] }>(
      ctx.transport,
      'skillsSh:listInstalled',
      {},
    );
    const present = (before?.skills ?? []).some(
      (s) => s.source === opts.name || s.name === opts.name,
    );
    if (!present) {
      await formatter.writeNotification('skill.removed', {
        name: opts.name,
        changed: false,
      });
      return ExitCode.Success;
    }

    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'skillsSh:uninstall',
      { name: opts.name },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'skillsSh:uninstall failed');
    }
    await formatter.writeNotification('skill.removed', {
      name: opts.name,
      changed: true,
    });
    return ExitCode.Success;
  });
}

async function runPopular(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{ skills: SkillShEntry[] }>(
      ctx.transport,
      'skillsSh:getPopular',
      {},
    );
    await formatter.writeNotification('skill.popular', {
      skills: result?.skills ?? [],
    });
    return ExitCode.Success;
  });
}

async function runRecommended(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<SkillDetectionResult>(
      ctx.transport,
      'skillsSh:detectRecommended',
      {},
    );
    await formatter.writeNotification('skill.recommended', {
      detectedTechnologies: result?.detectedTechnologies ?? {
        frameworks: [],
        languages: [],
        tools: [],
      },
      recommendedSkills: result?.recommendedSkills ?? [],
    });
    return ExitCode.Success;
  });
}

async function runCreate(
  opts: SkillOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillStderrLike,
  engine: typeof withEngine,
  readSpec: (path: string) => Promise<string>,
): Promise<number> {
  if (!opts.fromSpec || opts.fromSpec.trim().length === 0) {
    stderr.write(
      'ptah skill create: --from-spec <path> is required (JSON file with name/description/content/allowedTools)\n',
    );
    return ExitCode.UsageError;
  }

  let raw: string;
  try {
    raw = await readSpec(opts.fromSpec);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah skill create: failed to read spec at ${opts.fromSpec}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }

  let spec: unknown;
  try {
    spec = JSON.parse(raw);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`ptah skill create: invalid JSON in spec: ${message}\n`);
    return ExitCode.UsageError;
  }

  const validated = validateSpec(spec);
  if ('error' in validated) {
    stderr.write(`ptah skill create: ${validated.error}\n`);
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<{
      skillId: string;
      skillPath: string;
    }>(ctx.transport, 'harness:create-skill', validated.spec);
    await formatter.writeNotification('skill.created', {
      skillId: result?.skillId,
      skillPath: result?.skillPath,
      name: validated.spec.name,
    });
    return ExitCode.Success;
  });
}

/**
 * `ptah skill select <slug...>` / `ptah skill select --all`.
 *
 * The two forms are mutually exclusive and one of them is required. There is no
 * default: `'all'` and `'selected'` are both real decisions with real
 * consequences — `'selected'` with an empty allowlist reaps every managed skill
 * copy in the workspace — so a bare `ptah skill select` is a usage error rather
 * than a guess. That mirrors `harness:set-skill-selection`, which refuses an
 * absent `mode` at the schema for the same reason.
 *
 * A refused WRITE exits 1. `saved: false` means the decision never reached
 * `{ws}/.ptah/harness/state.json`, so the previous selection is still in force
 * and no propagation pass ran; exiting 0 there would tell a script its
 * selection took when the next reconcile will ignore it.
 */
async function runSelect(
  opts: SkillOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: SkillStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const all = opts.all === true;
  const slugs = normalizeSlugs(opts.slugs);

  if (all && slugs.length > 0) {
    stderr.write('ptah skill select: --all takes no <slug> arguments\n');
    return ExitCode.UsageError;
  }
  if (!all && slugs.length === 0) {
    stderr.write(
      'ptah skill select: pass at least one <slug>, or --all to propagate everything\n',
    );
    return ExitCode.UsageError;
  }

  // `slugs` is omitted under `'all'` rather than sent empty — the handler
  // clears the recorded allowlist itself, and a stale one surviving the switch
  // would read as a selection nobody made the next time the mode narrowed.
  const params: HarnessSetSkillSelectionParams = all
    ? { mode: 'all' }
    : { mode: 'selected', slugs };

  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<HarnessSetSkillSelectionResult>(
      ctx.transport,
      'harness:set-skill-selection',
      params,
    );
    const saved = result?.saved === true;
    await formatter.writeNotification('skill.selected', {
      saved,
      mode: result?.mode ?? params.mode,
      // The allowlist as the handler NORMALIZED it (trimmed, deduped, sorted),
      // not as it was typed — a caller diffing its own argv against this is
      // entitled to see what was actually recorded.
      slugs: result?.slugs ?? [],
      health: result?.health ?? null,
      summary: result?.summary ?? null,
    });
    return saved ? ExitCode.Success : ExitCode.GeneralError;
  });
}

/**
 * `ptah skill selection` — the current mode, the recorded allowlist, and every
 * candidate the workspace could propagate.
 *
 * Read-only, and deliberately so: `harness:get-skill-selection` resolves the
 * gate without persisting the answer, so polling this never records a selection
 * on the user's behalf. `derived: true` means the mode was absent on disk and
 * came from the migration's evidence walk — a script needs that to tell "the
 * user chose everything" from "this workspace predates the gate".
 */
async function runSelection(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full', requireSdk: false }, async (ctx) => {
    const result = await callRpc<HarnessGetSkillSelectionResult>(
      ctx.transport,
      'harness:get-skill-selection',
      {},
    );
    await formatter.writeNotification('skill.selection', {
      mode: result?.mode ?? 'all',
      slugs: result?.slugs ?? [],
      available: result?.available ?? [],
      derived: result?.derived === true,
    });
    return ExitCode.Success;
  });
}

/**
 * Trim, drop blanks and dedupe the slugs as typed.
 *
 * Sorting is left to the handler, which already records a sorted allowlist —
 * doing it here too would be a second place to change the ordering rule.
 */
function normalizeSlugs(slugs: readonly string[] | undefined): string[] {
  const seen = new Set<string>();
  for (const raw of slugs ?? []) {
    const slug = raw.trim();
    if (slug.length > 0) seen.add(slug);
  }
  return [...seen];
}

/**
 * A skill is "already installed" when the `listInstalled` payload contains an
 * entry whose `source` matches `<source>` (or `<source>/<skillId>` for
 * multi-skill repos), or whose slug matches `skillId`.
 *
 * There is no scope test any more. Every skills.sh skill lives in one
 * user-global source root, so comparing scopes could only ever be a tautology.
 */
function isAlreadyInstalled(
  installed: readonly InstalledSkill[],
  source: string,
  skillId: string | undefined,
): boolean {
  for (const skill of installed) {
    if (skill.source === source) return true;
    if (skillId && skill.source === `${source}/${skillId}`) return true;
    if (skillId && skill.name === skillId) return true;
  }
  return false;
}

interface ValidatedSpec {
  spec: {
    name: string;
    description: string;
    content: string;
    allowedTools?: string[];
  };
}

interface SpecError {
  error: string;
}

function validateSpec(value: unknown): ValidatedSpec | SpecError {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { error: 'spec must be a JSON object' };
  }
  const obj = value as Record<string, unknown>;
  const name = obj['name'];
  const description = obj['description'];
  const content = obj['content'];
  if (typeof name !== 'string' || name.trim().length === 0) {
    return { error: 'spec.name must be a non-empty string' };
  }
  if (typeof description !== 'string') {
    return { error: 'spec.description must be a string' };
  }
  if (typeof content !== 'string' || content.trim().length === 0) {
    return { error: 'spec.content must be a non-empty string' };
  }
  const allowedToolsRaw = obj['allowedTools'];
  let allowedTools: string[] | undefined;
  if (Array.isArray(allowedToolsRaw)) {
    if (!allowedToolsRaw.every((t): t is string => typeof t === 'string')) {
      return { error: 'spec.allowedTools must be an array of strings' };
    }
    allowedTools = allowedToolsRaw;
  } else if (allowedToolsRaw !== undefined) {
    return { error: 'spec.allowedTools must be an array of strings' };
  }
  const result: ValidatedSpec['spec'] = {
    name,
    description,
    content,
  };
  if (allowedTools) result.allowedTools = allowedTools;
  return { spec: result };
}

async function callRpc<T = unknown>(
  transport: CliMessageTransport,
  method: string,
  params: unknown,
): Promise<T> {
  const response = await transport.call<unknown, T>(method, params);
  if (!response.success) {
    const err = new Error(response.error ?? `${method} failed`);
    if (response.errorCode) {
      (err as unknown as { code: string }).code = response.errorCode;
    }
    throw err;
  }
  return (response.data as T) ?? (null as unknown as T);
}
