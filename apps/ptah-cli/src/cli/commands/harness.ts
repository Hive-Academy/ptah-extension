/**
 * `ptah harness` command — Harness Setup Builder operations.
 *
 * TASK_2026_104 Sub-batch B6c. Replaces the Batch 2 3-line stub with the full
 * 10-sub-subcommand surface specified by `task-description.md` §3.1
 * (`harness *` table) and §4.1 notification schema.
 *
 * Sub-commands:
 *
 *   init [--dir]                                pure `mkdir` (no DI)
 *                                               emits `harness.initialized`
 *   status [--dir]                              pure `fs.readdir` (no DI)
 *                                               emits `harness.status`
 *   scan                                        RPC `harness:initialize`
 *                                               emits `harness.workspace_context`,
 *                                                     `harness.available_agents`,
 *                                                     `harness.available_skills`,
 *                                                     `harness.existing_presets`
 *   apply --preset <id>                         loads presets via
 *                                               `harness:load-presets` then
 *                                               applies via `harness:apply`
 *                                               emits `harness.applied`
 *   preset save <name> --from <path>            RPC `harness:save-preset`
 *                                               emits `harness.preset.saved`
 *   preset load                                 RPC `harness:load-presets`
 *                                               emits `harness.preset.list`
 *   chat                                        deferred-to-Batch-10 alias
 *                                               for `session start --scope
 *                                               harness-skill`. Emits
 *                                               `task.error` synchronously,
 *                                               exits 1.
 *   analyze-intent --intent <text>              RPC `harness:analyze-intent`
 *                                               emits `harness.intent.analysis`
 *   design-agents --workspace                   RPC `harness:design-agents`
 *                                               emits `harness.agent_design.start`,
 *                                                     `harness.agent_design.complete`
 *   generate-document --kind <prd|spec>         RPC `harness:generate-document`
 *                                               emits `harness.document.start`,
 *                                                     `harness.document.complete`
 *
 * `init` and `chat` deliberately bypass `withEngine` — `init` because pure
 * `mkdir` doesn't need DI (and must work on an unbootstrapped workspace),
 * `chat` because it's a synchronous deferred-error path until Batch 10 lands.
 */

import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { executeSessionStart } from './session.js';
import type {
  HarnessAnalyzeIntentResponse,
  HarnessApplyResponse,
  HarnessConfig,
  HarnessDesignAgentsResponse,
  HarnessGenerateDocumentResponse,
  HarnessInitializeResponse,
  HarnessLoadPresetsResponse,
  HarnessPreset,
  HarnessSavePresetResponse,
  PersonaDefinition,
} from '@ptah-extension/shared';

export type HarnessSubcommand =
  | 'init'
  | 'status'
  | 'scan'
  | 'apply'
  | 'preset-save'
  | 'preset-load'
  | 'chat'
  | 'analyze-intent'
  | 'design-agents'
  | 'generate-document';

export interface HarnessOptions {
  subcommand: HarnessSubcommand;
  /** For `init` / `status` — workspace target dir override. */
  dir?: string;
  /** For `apply --preset <id>`. */
  preset?: string;
  /** For `preset save <name>`. */
  name?: string;
  /** For `preset save --from <path>` — JSON file with a HarnessConfig. */
  from?: string;
  /** For `preset save --description <text>`. */
  description?: string;
  /** For `analyze-intent --intent <text>`. */
  intent?: string;
  /** For `design-agents` — when true, derive persona from `harness:initialize`. */
  workspace?: boolean;
  /** For `generate-document --kind <prd|spec>`. */
  kind?: string;
  /** For `chat` — forwarded to `session start --scope harness-skill` (B10d). */
  task?: string;
  /** For `chat --profile <name>`. */
  profile?: string;
  /** For `chat --session <id>` — resume an existing session. */
  session?: string;
  /** For `chat --auto-approve` — informational, plumbed but not consumed yet. */
  autoApprove?: boolean;
}

/** Locked contract — mirrors the architect's `runChatAlias` body verbatim. */
export interface HarnessChatOptions {
  task?: string;
  profile?: string;
  session?: string;
  autoApprove?: boolean;
  cwd?: string;
}

export interface HarnessStderrLike {
  write(chunk: string): boolean;
}

export interface HarnessExecuteHooks {
  stderr?: HarnessStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.mkdir`. */
  mkdir?: (path: string, opts: { recursive: boolean }) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.readdir`. */
  readdir?: (path: string) => Promise<string[]>;
  /** Override hook for tests — defaults to `node:fs/promises.stat`. */
  stat?: (path: string) => Promise<{ isDirectory(): boolean }>;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (path: string) => Promise<string>;
  /**
   * Override hook for tests — defaults to delegating into B10c's
   * `executeSessionStart`. Used by `harness chat` (TASK_2026_104 B10d).
   */
  executeSessionStart?: typeof executeSessionStart;
}

const VALID_DOC_KINDS = new Set(['prd', 'spec']);

export async function execute(
  opts: HarnessOptions,
  globals: GlobalOptions,
  hooks: HarnessExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: HarnessStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;

  try {
    switch (opts.subcommand) {
      case 'init':
        return await runInit(opts, globals, formatter, hooks);
      case 'status':
        return await runStatus(opts, globals, formatter, hooks);
      case 'scan':
        return await runScan(globals, formatter, engine);
      case 'apply':
        return await runApply(opts, globals, formatter, stderr, engine);
      case 'preset-save':
        return await runPresetSave(
          opts,
          globals,
          formatter,
          stderr,
          engine,
          hooks,
        );
      case 'preset-load':
        return await runPresetLoad(globals, formatter, engine);
      case 'chat':
        return await runChatAlias(buildChatOptions(opts), globals, hooks);
      case 'analyze-intent':
        return await runAnalyzeIntent(opts, globals, formatter, stderr, engine);
      case 'design-agents':
        return await runDesignAgents(opts, globals, formatter, engine);
      case 'generate-document':
        return await runGenerateDocument(
          opts,
          globals,
          formatter,
          stderr,
          engine,
        );
      default:
        stderr.write(
          `ptah harness: unknown sub-command '${String(opts.subcommand)}'\n`,
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
// init — pure mkdir, NO DI. Idempotent: second run reports `skipped[]`.
// ---------------------------------------------------------------------------

/** Default scaffold layout — created relative to the workspace root. */
const SCAFFOLD_DIRS: readonly string[] = [
  '.ptah',
  '.ptah/skills',
  '.ptah/agents',
  '.ptah/specs',
  '.ptah/presets',
];

async function runInit(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  hooks: HarnessExecuteHooks,
): Promise<number> {
  const root = opts.dir ?? globals.cwd;
  const mkdir =
    hooks.mkdir ??
    ((p: string, o: { recursive: boolean }) =>
      fs.mkdir(p, o).then(() => undefined));
  const stat =
    hooks.stat ??
    ((p: string) =>
      fs.stat(p).then((s) => ({ isDirectory: () => s.isDirectory() })));

  const created: string[] = [];
  const skipped: string[] = [];

  for (const rel of SCAFFOLD_DIRS) {
    const abs = path.join(root, rel);
    let existed = false;
    try {
      const info = await stat(abs);
      existed = info.isDirectory();
    } catch {
      existed = false;
    }
    if (existed) {
      skipped.push(rel);
      continue;
    }
    await mkdir(abs, { recursive: true });
    created.push(rel);
  }

  await formatter.writeNotification('harness.initialized', {
    path: root,
    created,
    skipped,
    changed: created.length > 0,
  });
  return ExitCode.Success;
}

// ---------------------------------------------------------------------------
// status — read-only fs.readdir, NO DI.
// ---------------------------------------------------------------------------

async function runStatus(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  hooks: HarnessExecuteHooks,
): Promise<number> {
  const root = opts.dir ?? globals.cwd;
  const readdir = hooks.readdir ?? ((p: string) => fs.readdir(p));

  // Walk `.ptah/` looking for skills, agents, specs, presets directories.
  // Missing directories are reported as `false`/empty rather than as errors.
  const ptahDir = path.join(root, '.ptah');
  let hasPtahDir = false;
  try {
    const list = await readdir(ptahDir);
    hasPtahDir = list.length >= 0; // listing succeeded
  } catch {
    hasPtahDir = false;
  }

  const probe = async (sub: string): Promise<string[]> => {
    if (!hasPtahDir) return [];
    try {
      return await readdir(path.join(ptahDir, sub));
    } catch {
      return [];
    }
  };

  const skills = await probe('skills');
  const agents = await probe('agents');
  const specs = await probe('specs');
  const presets = await probe('presets');

  await formatter.writeNotification('harness.status', {
    path: root,
    has_ptah_dir: hasPtahDir,
    has_skills: skills.length > 0,
    has_agents: agents.length > 0,
    has_specs: specs.length > 0,
    has_presets: presets.length > 0,
    skills,
    agents,
    specs,
    presets,
  });
  return ExitCode.Success;
}

// ---------------------------------------------------------------------------
// scan — RPC harness:initialize, fans out into 4 notifications.
// ---------------------------------------------------------------------------

async function runScan(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<HarnessInitializeResponse>(
      ctx.transport,
      'harness:initialize',
      {},
    );
    await formatter.writeNotification('harness.workspace_context', {
      workspaceContext: result?.workspaceContext,
    });
    await formatter.writeNotification('harness.available_agents', {
      agents: result?.availableAgents ?? [],
    });
    await formatter.writeNotification('harness.available_skills', {
      skills: result?.availableSkills ?? [],
    });
    await formatter.writeNotification('harness.existing_presets', {
      presets: result?.existingPresets ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// apply --preset <id> — load presets, find match, send to harness:apply.
// ---------------------------------------------------------------------------

async function runApply(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: HarnessStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.preset || opts.preset.trim().length === 0) {
    stderr.write('ptah harness apply: --preset <id> is required\n');
    return ExitCode.UsageError;
  }
  const presetId = opts.preset;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const presetsResp = await callRpc<HarnessLoadPresetsResponse>(
      ctx.transport,
      'harness:load-presets',
      {},
    );
    const preset = findPreset(presetsResp?.presets ?? [], presetId);
    if (!preset) {
      throw new Error(`Preset '${presetId}' not found`);
    }

    const result = await callRpc<HarnessApplyResponse>(
      ctx.transport,
      'harness:apply',
      { config: preset.config, outputFormat: 'json' },
    );
    await formatter.writeNotification('harness.applied', {
      presetId,
      presetName: preset.name,
      appliedPaths: result?.appliedPaths ?? [],
      warnings: result?.warnings ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// preset save <name> --from <path> [--description <text>]
// ---------------------------------------------------------------------------

async function runPresetSave(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: HarnessStderrLike,
  engine: typeof withEngine,
  hooks: HarnessExecuteHooks,
): Promise<number> {
  if (!opts.name || opts.name.trim().length === 0) {
    stderr.write('ptah harness preset save: <name> is required\n');
    return ExitCode.UsageError;
  }
  if (!opts.from || opts.from.trim().length === 0) {
    stderr.write(
      'ptah harness preset save: --from <path> is required (JSON file with a HarnessConfig)\n',
    );
    return ExitCode.UsageError;
  }
  const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));

  let raw: string;
  try {
    raw = await readFile(opts.from);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(
      `ptah harness preset save: failed to read config from ${opts.from}: ${message}\n`,
    );
    return ExitCode.UsageError;
  }
  let config: HarnessConfig;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('config file did not contain a JSON object');
    }
    config = parsed as HarnessConfig;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    stderr.write(`ptah harness preset save: invalid JSON config: ${message}\n`);
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<HarnessSavePresetResponse>(
      ctx.transport,
      'harness:save-preset',
      {
        name: opts.name,
        description: opts.description ?? '',
        config,
      },
    );
    await formatter.writeNotification('harness.preset.saved', {
      presetId: result?.presetId,
      presetPath: result?.presetPath,
      name: opts.name,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// preset load — RPC harness:load-presets.
// ---------------------------------------------------------------------------

async function runPresetLoad(
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<HarnessLoadPresetsResponse>(
      ctx.transport,
      'harness:load-presets',
      {},
    );
    await formatter.writeNotification('harness.preset.list', {
      presets: result?.presets ?? [],
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// chat — alias for `ptah session start --scope harness-skill`.
//
// TASK_2026_104 Sub-batch B10d (was previously a deferred `task.error` stub
// per the locked architect contract; B10c shipped `executeSessionStart` so
// this delegation is now real).
//
// The flag set on the router (`--task`, `--profile`, `--session`,
// `--auto-approve`) mirrors `session start --scope harness-skill` for stream-
// handling parity. Notifications emitted will be `session.*` + `agent.*`
// from the underlying `session start|resume`. Consumers SHOULD treat
// `harness chat` and `session start --scope harness-skill` as identical.
// ---------------------------------------------------------------------------

function buildChatOptions(opts: HarnessOptions): HarnessChatOptions {
  return {
    task: opts.task,
    profile: opts.profile,
    session: opts.session,
    autoApprove: opts.autoApprove,
  };
}

async function runChatAlias(
  opts: HarnessChatOptions,
  globals: GlobalOptions,
  hooks: HarnessExecuteHooks = {},
): Promise<number> {
  const delegate = hooks.executeSessionStart ?? executeSessionStart;
  return delegate(
    {
      task: opts.task,
      profile: opts.profile,
      scope: 'harness-skill',
      resumeId: opts.session,
      cwd: globals.cwd,
    },
    globals,
  );
}

// ---------------------------------------------------------------------------
// analyze-intent --intent <text>
// ---------------------------------------------------------------------------

async function runAnalyzeIntent(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: HarnessStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  if (!opts.intent || opts.intent.trim().length < 10) {
    stderr.write(
      'ptah harness analyze-intent: --intent <text> is required (min 10 chars)\n',
    );
    return ExitCode.UsageError;
  }
  const intent = opts.intent;

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const result = await callRpc<HarnessAnalyzeIntentResponse>(
      ctx.transport,
      'harness:analyze-intent',
      { input: intent },
    );
    await formatter.writeNotification('harness.intent.analysis', {
      intent,
      persona: result?.persona,
      suggestedAgents: result?.suggestedAgents ?? {},
      suggestedSubagents: result?.suggestedSubagents ?? [],
      suggestedSkills: result?.suggestedSkills ?? [],
      suggestedSkillSpecs: result?.suggestedSkillSpecs ?? [],
      suggestedPrompt: result?.suggestedPrompt,
      suggestedMcpServers: result?.suggestedMcpServers ?? [],
      summary: result?.summary,
      reasoning: result?.reasoning,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// design-agents --workspace
// ---------------------------------------------------------------------------

async function runDesignAgents(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  engine: typeof withEngine,
): Promise<number> {
  return engine(globals, { mode: 'full' }, async (ctx) => {
    // When --workspace is set, derive persona + existing agents from the
    // workspace via `harness:initialize`. Otherwise default to a generic
    // empty persona.
    let persona: PersonaDefinition;
    let existingAgents: string[] = [];

    if (opts.workspace) {
      const init = await callRpc<HarnessInitializeResponse>(
        ctx.transport,
        'harness:initialize',
        {},
      );
      persona = {
        label: init?.workspaceContext?.projectName ?? 'workspace',
        description:
          `Workspace ${init?.workspaceContext?.projectName ?? ''} (` +
          `${init?.workspaceContext?.projectType ?? 'unknown'})`.trim(),
        goals: init?.workspaceContext?.frameworks ?? [],
      };
      existingAgents = (init?.availableAgents ?? []).map((a) => a.id);
    } else {
      persona = { label: 'generic', description: '', goals: [] };
    }

    await formatter.writeNotification('harness.agent_design.start', {
      persona,
      workspace: opts.workspace === true,
    });

    const result = await callRpc<HarnessDesignAgentsResponse>(
      ctx.transport,
      'harness:design-agents',
      { persona, existingAgents },
    );

    await formatter.writeNotification('harness.agent_design.complete', {
      subagents: result?.subagents ?? [],
      reasoning: result?.reasoning,
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// generate-document --kind <prd|spec>
// ---------------------------------------------------------------------------

async function runGenerateDocument(
  opts: HarnessOptions,
  globals: GlobalOptions,
  formatter: Formatter,
  stderr: HarnessStderrLike,
  engine: typeof withEngine,
): Promise<number> {
  const kind = (opts.kind ?? '').trim().toLowerCase();
  if (!VALID_DOC_KINDS.has(kind)) {
    stderr.write(
      `ptah harness generate-document: --kind must be one of ${[...VALID_DOC_KINDS].join('|')}\n`,
    );
    return ExitCode.UsageError;
  }

  return engine(globals, { mode: 'full' }, async (ctx) => {
    const init = await callRpc<HarnessInitializeResponse>(
      ctx.transport,
      'harness:initialize',
      {},
    );

    // Build a minimal HarnessConfig skeleton from the workspace. The backend
    // service treats unspecified sections as defaults — we forward whatever
    // metadata the workspace exposes so the document is project-aware without
    // requiring a fully-populated harness config.
    const workspaceContext = init?.workspaceContext;
    const stubConfig: HarnessConfig = {
      name: workspaceContext?.projectName ?? 'workspace',
      persona: {
        label: workspaceContext?.projectName ?? 'workspace',
        description:
          `Workspace ${workspaceContext?.projectName ?? ''} (` +
          `${workspaceContext?.projectType ?? 'unknown'})`.trim(),
        goals: workspaceContext?.frameworks ?? [],
      },
      agents: { enabledAgents: {} },
      skills: { selectedSkills: [], createdSkills: [] },
      prompt: { systemPrompt: '', enhancedSections: {} },
      mcp: { servers: [], enabledTools: {} },
      claudeMd: {
        generateProjectClaudeMd: false,
        customSections: {},
        previewContent: '',
      },
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    await formatter.writeNotification('harness.document.start', {
      kind,
      projectName: stubConfig.name,
    });

    const result = await callRpc<HarnessGenerateDocumentResponse>(
      ctx.transport,
      'harness:generate-document',
      { config: stubConfig, workspaceContext },
    );

    await formatter.writeNotification('harness.document.complete', {
      kind,
      document: result?.document,
      sections: result?.sections ?? {},
    });
    return ExitCode.Success;
  });
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

/**
 * Find a preset by id, name, or sanitized name. The backend stores presets
 * under sanitized filenames (`HarnessConfigStore.sanitizeFileName`), so the
 * caller may pass either the canonical id or the human-readable name.
 */
function findPreset(
  presets: readonly HarnessPreset[],
  query: string,
): HarnessPreset | null {
  const sanitized = query.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  for (const p of presets) {
    if (p.id === query) return p;
    if (p.name === query) return p;
    if (p.id.toLowerCase() === sanitized) return p;
  }
  return null;
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
