/**
 * `ptah setup` command — top-level 5-phase orchestrator.
 *
 * Drives the Setup Wizard pipeline end-to-end via the phase-runner:
 *
 *   1. analyze         (sync)            wizard:deep-analyze
 *   2. recommend       (sync)            wizard:recommend-agents (input = phase 1)
 *   3. install_pack    (sync)            wizard:list-agent-packs → for each pack
 *                                        with selected agents, wizard:install-pack-agents
 *   4. generate        (async-broadcast) wizard:submit-selection (10-min cap)
 *                                        — awaits setup-wizard:generation-complete
 *   5. apply_harness   (sync)            harness:apply { config }
 *
 * On any phase failure: emits `task.error { ptah_code: 'wizard_phase_failed',
 * data: { phase, error } }` and exits 1 (`ExitCode.GeneralError`). After each
 * successful phase, persists `setup.lastCompletedPhase = <name>` to the
 * WORKSPACE_STATE_STORAGE so `ptah wizard status` (B9c) can read it. On
 * all-phase success: emits `setup.complete { duration_ms, agents_installed,
 * plugins_enabled, mcp_installed }`.
 *
 * `--dry-run` skips phases 3-5 (writes-free smoke test) and emits
 * `setup.complete { ..., dry_run: true }` with zero counters.
 *
 * Each phase has its own rollback strategy (see RUN_*_ROLLBACK below):
 *   1+2 — no-op (read-only)
 *   3   — best-effort delete agent files added to `<workspace>/.claude/agents/`
 *   4   — no-op (documented; warning printed; suggest `ptah wizard cancel`)
 *   5   — best-effort restore `~/.ptah/settings.json` snapshot, delete the
 *         new preset file at `appliedPaths[0]`, restore `CLAUDE.md` from any
 *         `.bak` path returned in `appliedPaths`.
 */

import { promises as fs } from 'node:fs';
import { homedir } from 'node:os';
import { join as pathJoin } from 'node:path';

import { withEngine } from '../bootstrap/with-engine.js';
import { buildFormatter, type Formatter } from '../output/formatter.js';
import { ExitCode } from '../jsonrpc/types.js';
import type { GlobalOptions } from '../router.js';
import type { CliMessageTransport } from '../../transport/cli-message-transport.js';
import { runPhase } from '../wizard/phase-runner.js';
import { WIZARD_LAST_COMPLETED_PHASE_KEY } from './wizard.js';
import {
  PLATFORM_TOKENS,
  type IStateStorage,
} from '@ptah-extension/platform-core';
import type {
  AgentPackInfoDto,
  AgentRecommendation,
  GenerationCompletePayload,
  HarnessApplyResponse,
  HarnessConfig,
  MultiPhaseAnalysisResponse,
  WizardInstallPackAgentsResult,
} from '@ptah-extension/shared';

/** 10-minute cap on phase 4, matching the backend GENERATION_TIMEOUT_MS. */
export const SETUP_GENERATE_TIMEOUT_MS = 10 * 60 * 1000;

export interface SetupOptions {
  /** Skip phases 3-5 (writes-free smoke test). Phases 1+2 still run. */
  dryRun?: boolean;
  /**
   * Forward auto-approve to harness:apply config (forward-compatible — the
   * underlying generation pipeline already auto-approves CLI-context).
   */
  autoApprove?: boolean;
}

export interface SetupStderrLike {
  write(chunk: string): boolean;
}

export interface SetupExecuteHooks {
  stderr?: SetupStderrLike;
  formatter?: Formatter;
  withEngine?: typeof withEngine;
  /** Override hook for tests — defaults to `node:fs/promises.readdir`. */
  readdir?: (path: string) => Promise<string[]>;
  /** Override hook for tests — defaults to `node:fs/promises.readFile`. */
  readFile?: (path: string) => Promise<string>;
  /** Override hook for tests — defaults to `node:fs/promises.writeFile`. */
  writeFile?: (path: string, data: string) => Promise<void>;
  /** Override hook for tests — defaults to `node:fs/promises.unlink`. */
  unlink?: (path: string) => Promise<void>;
  /** Override `Date.now()` for deterministic duration assertions. */
  now?: () => number;
  /** Override the agents directory used for the phase-3 snapshot/diff. */
  agentsDir?: string;
  /** Override the settings file path used for the phase-5 snapshot. */
  settingsPath?: string;
}

interface RecommendAgentsResponse {
  recommendations: AgentRecommendation[];
}

export async function execute(
  opts: SetupOptions,
  globals: GlobalOptions,
  hooks: SetupExecuteHooks = {},
): Promise<number> {
  const formatter = hooks.formatter ?? buildFormatter(globals);
  const stderr: SetupStderrLike = hooks.stderr ?? process.stderr;
  const engine = hooks.withEngine ?? withEngine;
  const readdir =
    hooks.readdir ?? ((p: string) => fs.readdir(p) as Promise<string[]>);
  const readFile = hooks.readFile ?? ((p: string) => fs.readFile(p, 'utf8'));
  const writeFile =
    hooks.writeFile ?? ((p: string, d: string) => fs.writeFile(p, d, 'utf8'));
  const unlink = hooks.unlink ?? ((p: string) => fs.unlink(p));
  const now = hooks.now ?? (() => Date.now());

  const cwd = globals.cwd ?? process.cwd();
  const agentsDir = hooks.agentsDir ?? pathJoin(cwd, '.claude', 'agents');
  const settingsPath =
    hooks.settingsPath ?? pathJoin(homedir(), '.ptah', 'settings.json');

  try {
    return await engine(globals, { mode: 'full' }, async (ctx) => {
      const setupStart = now();
      let agentsInstalled = 0;
      let pluginsEnabled = 0;
      let mcpInstalled = 0;

      // Resolve the storage once so we can surface `setup.lastCompletedPhase`
      // after every successful phase. `ptah wizard status` reads the same key.
      const storage = ctx.container.resolve<IStateStorage>(
        PLATFORM_TOKENS.WORKSPACE_STATE_STORAGE,
      );
      const writeLastPhase = async (name: string): Promise<void> => {
        await storage.update(WIZARD_LAST_COMPLETED_PHASE_KEY, name);
      };

      // ---------------------------------------------------------------------
      // Phase 1 — analyze (sync, no-op rollback)
      // ---------------------------------------------------------------------
      const r1 = await runPhase<MultiPhaseAnalysisResponse>(
        'analyze',
        {
          kind: 'sync',
          run: () =>
            callRpc<MultiPhaseAnalysisResponse>(
              ctx.transport,
              'wizard:deep-analyze',
              {},
            ),
        },
        { formatter },
      );
      if (r1.status !== 'completed' || !r1.result) {
        return await emitWizardPhaseFailed(formatter, 'analyze', r1.error);
      }
      await writeLastPhase('analyze');
      const analysisResult = r1.result;

      // ---------------------------------------------------------------------
      // Phase 2 — recommend (sync, no-op rollback)
      // ---------------------------------------------------------------------
      const r2 = await runPhase<RecommendAgentsResponse>(
        'recommend',
        {
          kind: 'sync',
          run: () =>
            callRpc<RecommendAgentsResponse>(
              ctx.transport,
              'wizard:recommend-agents',
              analysisResult,
            ),
        },
        { formatter },
      );
      if (r2.status !== 'completed' || !r2.result) {
        return await emitWizardPhaseFailed(formatter, 'recommend', r2.error);
      }
      await writeLastPhase('recommend');
      const recommendations = r2.result.recommendations ?? [];
      const selectedAgentIds = recommendations
        .filter((r) => r.recommended)
        .map((r) => r.agentId);

      // ---------------------------------------------------------------------
      // --dry-run: stop here, emit setup.complete with zero counters.
      // ---------------------------------------------------------------------
      if (opts.dryRun === true) {
        await formatter.writeNotification('setup.complete', {
          duration_ms: now() - setupStart,
          agents_installed: 0,
          plugins_enabled: 0,
          mcp_installed: 0,
          dry_run: true,
        });
        return ExitCode.Success;
      }

      // ---------------------------------------------------------------------
      // Phase 3 — install_pack (sync, rollback: delete added agent files)
      // ---------------------------------------------------------------------
      const agentsBefore = await snapshotAgentsDir(readdir, agentsDir);
      const r3 = await runPhase<number>(
        'install_pack',
        {
          kind: 'sync',
          run: async () => {
            const list = await callRpc<{ packs: AgentPackInfoDto[] }>(
              ctx.transport,
              'wizard:list-agent-packs',
              {},
            );
            const packs = list?.packs ?? [];
            const selectedSet = new Set(selectedAgentIds);
            let total = 0;
            for (const pack of packs) {
              const agentFiles = pack.agents
                .filter((entry) => selectedSet.has(entryAgentId(entry)))
                .map((entry) => entry.file);
              if (agentFiles.length === 0) continue;
              const result = await callRpc<WizardInstallPackAgentsResult>(
                ctx.transport,
                'wizard:install-pack-agents',
                { source: pack.source, agentFiles },
              );
              total += result?.agentsDownloaded ?? 0;
            }
            return total;
          },
        },
        {
          formatter,
          rollback: async () => {
            await rollbackAgentDir(readdir, unlink, agentsDir, agentsBefore);
          },
        },
      );
      if (r3.status !== 'completed') {
        return await emitWizardPhaseFailed(formatter, 'install_pack', r3.error);
      }
      await writeLastPhase('install_pack');
      agentsInstalled = r3.result ?? 0;

      // ---------------------------------------------------------------------
      // Phase 4 — generate (async-broadcast, no-op rollback + warning)
      // ---------------------------------------------------------------------
      const r4 = await runPhase<GenerationCompletePayload>(
        'generate',
        {
          kind: 'async-broadcast',
          run: () =>
            callRpc<unknown>(ctx.transport, 'wizard:submit-selection', {
              selectedAgentIds,
              analysisData: analysisResult,
              analysisDir: analysisResult.analysisDir,
            }),
          completionEvent: 'setup-wizard:generation-complete',
          progressEvents: [
            'setup-wizard:generation-progress',
            'setup-wizard:generation-stream',
          ],
          timeoutMs: SETUP_GENERATE_TIMEOUT_MS,
          adapter: ctx.pushAdapter,
          extractResult: (p) => p as GenerationCompletePayload,
          isFailure: (p) => {
            const payload = p as GenerationCompletePayload | undefined;
            if (payload?.success === false) {
              return payload.errors?.[0] ?? 'generation failed';
            }
            return null;
          },
        },
        {
          formatter,
          rollback: async () => {
            // Rollback for phase 4 is intentionally a no-op — the backend may
            // have written agent templates to disk before the failure surfaced,
            // and we cannot reliably distinguish them from prior state.
            // Surface a warning so the operator can clean up via `ptah wizard
            // cancel <session-id>`.
            stderr.write(
              "[ptah] setup phase 'generate' failed — generated agents may exist on disk; run `ptah wizard cancel <session-id>` to clean up.\n",
            );
          },
        },
      );
      if (r4.status !== 'completed') {
        return await emitWizardPhaseFailed(formatter, 'generate', r4.error);
      }
      await writeLastPhase('generate');

      // ---------------------------------------------------------------------
      // Phase 5 — apply_harness (sync, rollback: restore settings/preset/CLAUDE.md)
      // ---------------------------------------------------------------------
      const settingsBefore = await snapshotFileContents(readFile, settingsPath);
      const harnessConfig = buildHarnessConfig(recommendations, opts);
      pluginsEnabled = harnessConfig.skills.selectedSkills.length;
      mcpInstalled = harnessConfig.mcp.servers.length;

      let appliedPathsForRollback: string[] = [];
      const r5 = await runPhase<HarnessApplyResponse>(
        'apply_harness',
        {
          kind: 'sync',
          run: async () => {
            const result = await callRpc<HarnessApplyResponse>(
              ctx.transport,
              'harness:apply',
              { config: harnessConfig, outputFormat: 'json' },
            );
            // Capture appliedPaths for the rollback closure — needed when a
            // later RPC inside this phase throws after harness:apply succeeds.
            appliedPathsForRollback = result?.appliedPaths ?? [];
            return result;
          },
        },
        {
          formatter,
          rollback: async () => {
            await rollbackApplyHarness({
              settingsPath,
              settingsBefore,
              appliedPaths: appliedPathsForRollback,
              writeFile,
              unlink,
              readFile,
            });
          },
        },
      );
      if (r5.status !== 'completed') {
        return await emitWizardPhaseFailed(
          formatter,
          'apply_harness',
          r5.error,
        );
      }
      await writeLastPhase('apply_harness');

      // ---------------------------------------------------------------------
      // Final completion notification — exit 0.
      // ---------------------------------------------------------------------
      await formatter.writeNotification('setup.complete', {
        duration_ms: now() - setupStart,
        agents_installed: agentsInstalled,
        plugins_enabled: pluginsEnabled,
        mcp_installed: mcpInstalled,
      });
      return ExitCode.Success;
    });
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
// Phase failure helper — single emission point for `wizard_phase_failed`.
// ---------------------------------------------------------------------------

async function emitWizardPhaseFailed(
  formatter: Formatter,
  phase: string,
  error: string | undefined,
): Promise<number> {
  await formatter.writeNotification('task.error', {
    ptah_code: 'wizard_phase_failed',
    data: { phase, error: error ?? `phase '${phase}' failed` },
  });
  return ExitCode.GeneralError;
}

// ---------------------------------------------------------------------------
// Phase 3 helpers — agents-dir snapshot + rollback
// ---------------------------------------------------------------------------

async function snapshotAgentsDir(
  readdir: (path: string) => Promise<string[]>,
  dir: string,
): Promise<Set<string>> {
  try {
    const entries = await readdir(dir);
    return new Set(entries);
  } catch {
    // Missing dir is fine — phase 3 may create it. Empty snapshot means every
    // file present after the phase is treated as "added" by the rollback.
    return new Set<string>();
  }
}

async function rollbackAgentDir(
  readdir: (path: string) => Promise<string[]>,
  unlink: (path: string) => Promise<void>,
  dir: string,
  before: Set<string>,
): Promise<void> {
  let after: string[];
  try {
    after = await readdir(dir);
  } catch {
    // Dir disappeared — nothing to clean up.
    return;
  }
  for (const entry of after) {
    if (before.has(entry)) continue;
    await unlink(pathJoin(dir, entry)).catch(() => {
      /* best-effort */
    });
  }
}

// ---------------------------------------------------------------------------
// Phase 5 helpers — settings snapshot + apply rollback
// ---------------------------------------------------------------------------

async function snapshotFileContents(
  readFile: (path: string) => Promise<string>,
  path: string,
): Promise<string | null> {
  try {
    return await readFile(path);
  } catch {
    return null;
  }
}

interface RollbackApplyHarnessArgs {
  settingsPath: string;
  settingsBefore: string | null;
  appliedPaths: string[];
  writeFile: (path: string, data: string) => Promise<void>;
  unlink: (path: string) => Promise<void>;
  readFile: (path: string) => Promise<string>;
}

async function rollbackApplyHarness(
  args: RollbackApplyHarnessArgs,
): Promise<void> {
  // 1. Restore ~/.ptah/settings.json from the pre-phase snapshot. If we never
  //    captured the snapshot (file did not exist), do nothing — letting the
  //    new file remain is safer than deleting unknown user state.
  if (args.settingsBefore !== null) {
    await args.writeFile(args.settingsPath, args.settingsBefore).catch(() => {
      /* best-effort */
    });
  }

  // 2. Delete the new preset file at appliedPaths[0]. Convention used by the
  //    harness:apply handler — the preset path is always emitted first.
  if (args.appliedPaths.length > 0) {
    const presetPath = args.appliedPaths[0];
    if (presetPath) {
      await args.unlink(presetPath).catch(() => {
        /* best-effort */
      });
    }
  }

  // 3. Restore CLAUDE.md from any `.bak` path the handler returned. The
  //    convention: harness:apply emits both `<workspace>/CLAUDE.md` and
  //    `<workspace>/CLAUDE.md.bak` when it rewrote an existing file.
  for (const applied of args.appliedPaths) {
    if (!applied.endsWith('.bak')) continue;
    const target = applied.slice(0, -'.bak'.length);
    try {
      const backup = await args.readFile(applied);
      await args.writeFile(target, backup);
    } catch {
      /* best-effort — the backup may already be gone */
    }
  }
}

// ---------------------------------------------------------------------------
// Build a minimal HarnessConfig from phase-2 recommendations.
// ---------------------------------------------------------------------------

function buildHarnessConfig(
  recommendations: AgentRecommendation[],
  opts: SetupOptions,
): HarnessConfig {
  const enabledAgents: HarnessConfig['agents']['enabledAgents'] = {};
  for (const rec of recommendations) {
    if (!rec.recommended) continue;
    enabledAgents[rec.agentId] = {
      enabled: true,
      autoApprove: opts.autoApprove === true,
    };
  }

  const nowIso = new Date().toISOString();
  return {
    name: 'setup-orchestrator-default',
    persona: {
      label: 'default',
      description: 'Default persona derived from setup orchestrator',
      goals: [],
    },
    agents: { enabledAgents },
    skills: { selectedSkills: [], createdSkills: [] },
    prompt: { systemPrompt: '', enhancedSections: {} },
    mcp: { servers: [], enabledTools: {} },
    claudeMd: {
      generateProjectClaudeMd: false,
      customSections: {},
      previewContent: '',
    },
    createdAt: nowIso,
    updatedAt: nowIso,
  };
}

// ---------------------------------------------------------------------------
// Helpers — module-private.
// ---------------------------------------------------------------------------

/**
 * Map an agent pack entry → agent id used by `recommend-agents`. Agent packs
 * use `file` (e.g. `architect.md`) as the canonical entry id; the recommender
 * returns `agentId` strings that match the file basename without `.md`.
 */
function entryAgentId(entry: { file: string; name: string }): string {
  const file = entry.file ?? '';
  const stripped = file.endsWith('.md') ? file.slice(0, -'.md'.length) : file;
  return stripped.length > 0 ? stripped : entry.name;
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
