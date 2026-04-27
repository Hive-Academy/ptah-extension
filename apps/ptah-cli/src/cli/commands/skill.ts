/**
 * `ptah skill` command — Skills.sh marketplace operations.
 *
 * TASK_2026_104 Sub-batch B6b. Backed by `SkillsShRpcHandlers` re-registered
 * inside the CLI app (`apps/ptah-cli/src/services/rpc/handlers/skills-sh-rpc.handlers.ts`)
 * mirroring the Electron implementation verbatim. The `create` sub-subcommand
 * additionally hits the shared `harness:create-skill` RPC for AI-driven skill
 * creation from a wizard spec.
 *
 * Sub-commands (per task-description.md §3 `skill *` table):
 *
 *   search <query>             RPC `skillsSh:search`
 *   installed                  RPC `skillsSh:listInstalled`
 *   install <source> [--skill-id <id>] [--scope project|global]
 *                              RPC `skillsSh:install` (idempotent — second
 *                              run reports `changed: false`)
 *   remove <name> [--scope project|global]
 *                              RPC `skillsSh:uninstall`
 *   popular                    RPC `skillsSh:getPopular`
 *   recommended                RPC `skillsSh:detectRecommended`
 *   create [--from-spec <path>] RPC `harness:create-skill`
 *
 * Idempotency contract (`skill.installed` payload):
 *   - `changed: bool` — true on first successful install, false when
 *     `skillsSh:listInstalled` already shows the skill present (matched by
 *     `source` ± `skillId`) before the install call.
 *
 * The `--scope` flag defaults to `project`; `global` is also accepted.
 * Anything else is rejected with `ExitCode.UsageError` BEFORE bootstrapping DI.
 */

import { promises as fs } from 'node:fs';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import type {
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
  | 'create';

export type SkillScope = 'project' | 'global';

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
  /** For `install` / `remove` — installation scope. */
  scope?: string;
  /** For `create` — optional path to a JSON spec describing the skill. */
  fromSpec?: string;
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

const VALID_SCOPES: readonly SkillScope[] = ['project', 'global'];

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

// ---------------------------------------------------------------------------
// Sub-commands
// ---------------------------------------------------------------------------

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
  const scope = parseScope(opts.scope);
  if (scope === null) {
    stderr.write(
      `ptah skill install: --scope must be one of ${VALID_SCOPES.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    // Idempotency probe — if the source/skillId is already installed at the
    // requested scope, short-circuit with `changed: false`.
    const before = await callRpc<{ skills: InstalledSkill[] }>(
      ctx.transport,
      'skillsSh:listInstalled',
      {},
    );
    const alreadyInstalled = isAlreadyInstalled(
      before?.skills ?? [],
      source,
      skillId,
      scope,
    );
    if (alreadyInstalled) {
      await formatter.writeNotification('skill.installed', {
        source,
        skillId,
        scope,
        changed: false,
      });
      return ExitCode.Success;
    }

    const params: {
      source: string;
      scope: SkillScope;
      skillId?: string;
    } = { source, scope };
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
      scope,
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
  const scope = parseScope(opts.scope);
  if (scope === null) {
    stderr.write(
      `ptah skill remove: --scope must be one of ${VALID_SCOPES.join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    // Idempotency probe — if the name isn't installed at the requested scope,
    // short-circuit with `changed: false`.
    const before = await callRpc<{ skills: InstalledSkill[] }>(
      ctx.transport,
      'skillsSh:listInstalled',
      {},
    );
    const present = (before?.skills ?? []).some(
      (s) =>
        (s.source === opts.name || s.name === opts.name) && s.scope === scope,
    );
    if (!present) {
      await formatter.writeNotification('skill.removed', {
        name: opts.name,
        scope,
        changed: false,
      });
      return ExitCode.Success;
    }

    const result = await callRpc<{ success: boolean; error?: string }>(
      ctx.transport,
      'skillsSh:uninstall',
      { name: opts.name, scope },
    );
    if (!result?.success) {
      throw new Error(result?.error ?? 'skillsSh:uninstall failed');
    }
    await formatter.writeNotification('skill.removed', {
      name: opts.name,
      scope,
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

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

function parseScope(raw: string | undefined): SkillScope | null {
  if (raw === undefined) return 'project';
  const trimmed = raw.trim();
  return (VALID_SCOPES as readonly string[]).includes(trimmed)
    ? (trimmed as SkillScope)
    : null;
}

/**
 * A skill is "already installed" at `scope` when the `listInstalled` payload
 * contains an entry whose `source` matches `<source>` (or `<source>/<skillId>`
 * in the case of multi-skill repos) AND whose scope is the requested scope.
 *
 * The Electron handler stores `source` as just `owner/repo` for project-scope
 * skills and as the skill name itself for global scope, so we accept matches
 * on either field.
 */
function isAlreadyInstalled(
  installed: readonly InstalledSkill[],
  source: string,
  skillId: string | undefined,
  scope: SkillScope,
): boolean {
  for (const skill of installed) {
    if (skill.scope !== scope) continue;
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
