/**
 * Serialization for the read-modify-write every MCP facet performs.
 *
 * ## Why this exists
 *
 * Atomicity and mutual exclusion are different problems, and `atomic-write.ts`
 * only solves the first. A temp+rename guarantees no reader ever sees half a
 * config file; it guarantees nothing about two writers that each READ the file,
 * each edit their own key, and each rename their own copy over the top. The
 * second rename wins whole, and the first writer's key is gone — with no error,
 * no torn file, and nothing in any health report to notice it by.
 *
 * That was harmless while the reconciler was the only writer, because it holds
 * the workspace lock. TASK_2026_285 ended that: `AntigravityCliAdapter` writes
 * Ptah's own `ptah` server into `~/.gemini/config/mcp_config.json` before every
 * spawn and removes it after `done`, and the reconciler writes the USER's
 * servers into the same file. Two writers, and the workspace lock cannot
 * serialize them — the file is in `$HOME`, and two open workspaces hold two
 * different workspace locks over one shared config anyway.
 *
 * So the lock is keyed by the CONFIG FILE, which is the thing actually being
 * contended, and every facet mutation goes through it. The user-global files
 * (`~/.codex/config.toml`, `~/.copilot/mcp-config.json`, and now
 * `~/.gemini/config/mcp_config.json`) are the ones that needed it; the
 * workspace-scoped files get it for free, because one rule for all six config
 * files is cheaper to keep true than an exemption list.
 *
 * ## Why the lock file sits next to the config
 *
 * Same directory, same filesystem, no hashing of paths into a temp directory to
 * go stale. It is held for the length of one key's read-modify-write, and the
 * facets already write a durable `<config>.bak` in that directory — a lock file
 * that exists for a few milliseconds is strictly less intrusive than that.
 *
 * ## Deadline
 *
 * Shorter than the workspace lock's 5s, because one caller is a CLI SPAWN. A
 * user waiting on `agy` to start must not pay five seconds because a reconcile
 * is mid-pass.
 *
 * **Past the deadline the mutation FAILS — it does not proceed unlocked**
 * (TASK_2026_332). It used to run anyway, which made the deadline a hole
 * straight through this lock: two hosts contending for more than two seconds
 * both proceeded unlocked and lost each other's key, silently, which is the
 * exact failure the paragraphs above describe. A `FileLockTimeoutError` names
 * the config file and the wait duration, and every caller — the facet planner,
 * the Antigravity spawn write, `CodeExecutionMCP` — already retries a failed
 * mutation on its own schedule. See {@link withFileLock} for the full argument.
 */

import { serializeByKey, withFileLock } from '../../lock/file-lock';

/** Suffix of the lock file, beside the config it guards. */
export const MCP_CONFIG_LOCK_SUFFIX = '.ptah-lock';

/** Deadline before a contended write proceeds unlocked. */
export const MCP_CONFIG_LOCK_MAX_WAIT_MS = 2_000;

export function mcpConfigLockPath(configPath: string): string {
  return `${configPath}${MCP_CONFIG_LOCK_SUFFIX}`;
}

/**
 * Run one facet mutation with exclusive access to `configPath`.
 *
 * Both halves matter. The in-process queue is what actually serializes the
 * common case — a spawn and a reconcile inside ONE host process — with no
 * filesystem contention at all. The file lock covers the rarer case of two
 * hosts (VS Code and Electron, or two workspaces) sharing a user-global config.
 */
export function withMcpConfigLock<T>(
  configPath: string,
  task: () => Promise<T>,
): Promise<T> {
  return serializeByKey(configPath, () =>
    withFileLock(mcpConfigLockPath(configPath), task, {
      maxWaitMs: MCP_CONFIG_LOCK_MAX_WAIT_MS,
    }),
  );
}
