/**
 * Cross-process workspace lock for reconcile (edge case E11).
 *
 * VS Code, Electron, `ptah tui` and a cron job can all reconcile the same
 * workspace at the same moment. Without a lock the read-modify-write on the
 * managed manifest interleaves: the second writer persists a snapshot taken
 * before the first writer's entries existed, those entries vanish from the
 * record, and the NEXT reconcile classifies Ptah's own files as foreign and
 * refuses to update them forever. That is defect 10 in the TASK_2026_278
 * inventory, and it is silent.
 *
 * This file is the POLICY — one lock per workspace, at
 * `{ws}/.ptah/harness/.lock`, with an in-process queue in front of it. The
 * mechanism lives in `file-lock.ts`, which `targets/mcp/mcp-config-lock.ts`
 * also uses for a hazard the workspace lock structurally cannot cover: a
 * user-global MCP config file with two writers (TASK_2026_285).
 *
 * **What this lock does NOT protect.** It is keyed by workspace root, so it
 * serializes writers of `{ws}/...` and nothing else. A file under `$HOME` —
 * `~/.codex/config.toml`, `~/.copilot/mcp-config.json`,
 * `~/.gemini/config/mcp_config.json` — is outside it by construction, and two
 * workspaces hold two DIFFERENT workspace locks while sharing those files.
 */

import { join } from 'path';
import { HARNESS_STATE_DIR } from '../manifest-store/managed-manifest';
import {
  acquireFileLock,
  serializeByKey,
  STALE_AFTER_MS,
  type FileLockOptions,
  type HarnessLockHandle,
} from './file-lock';

export { STALE_AFTER_MS, type HarnessLockHandle };

export function lockPath(workspaceRoot: string): string {
  return join(workspaceRoot, HARNESS_STATE_DIR, '.lock');
}

/** Run `task` after every previously-queued task for this workspace. */
export function serializePerWorkspace<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  return serializeByKey(workspaceRoot, task);
}

/**
 * Acquire the workspace lock, waiting up to ~5s.
 *
 * Always returns a handle. Check `acquired` to decide whether to log the
 * degraded path; `release()` is safe either way. An unwritable workspace cannot
 * be locked and cannot be reconciled; its targets report `write-failed` per
 * entry, which is the right surface.
 */
export function acquireWorkspaceLock(
  workspaceRoot: string,
  options: FileLockOptions = {},
): Promise<HarnessLockHandle> {
  return acquireFileLock(lockPath(workspaceRoot), options);
}
