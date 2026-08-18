/**
 * `{ws}/.ptah/harness/state.json` — the reconciler's per-workspace memory of
 * decisions the USER made, as opposed to the per-target manifests next to it,
 * which record what PTAH wrote.
 *
 * Today it holds exactly one decision, and the file exists because that
 * decision is unrecoverable from disk alone: "I deleted your `.gitignore`
 * block". An absent block means either "never written" or "written and
 * deleted", and those must produce opposite behaviour — write it, versus never
 * write it again. Nothing in `.gitignore` itself can tell them apart, so the
 * fact is recorded here.
 *
 * Read defensively for the same reason the managed manifests are: a corrupt or
 * hand-mangled file reads as the DEFAULT state, never as an error. The cost of
 * being wrong is one re-added `.gitignore` block, which the user can delete
 * again; the cost of throwing is a failed reconcile.
 */

import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { z } from 'zod';
import { atomicWriteWithRetry } from '../fs/atomic-write';
import { HARNESS_STATE_DIR } from '../manifest-store/managed-manifest';

export const HARNESS_STATE_FILE = 'state.json';

export const HarnessWorkspaceStateSchema = z.object({
  version: z.literal(1),
  /**
   * The user deleted the managed block. Set when a block Ptah recorded writing
   * is no longer in the file; never re-added while it is true.
   */
  gitignoreBlockRemovedByUser: z.boolean().optional(),
  /** Ptah has written the block at least once. Absence-vs-deletion evidence. */
  gitignoreBlockWritten: z.boolean().optional(),
  /**
   * The `harness.manageGitignore` value in force the last time this workspace
   * was reconciled.
   *
   * Kept so a TOGGLE is distinguishable from a steady state. Toggling the
   * setting is the documented way to undo a deletion — without this field
   * "setting is true" looks identical before and after the user flipped it
   * back on, and the deletion would be permanent with no way out but editing
   * this file.
   */
  gitignoreSetting: z.boolean().optional(),
});

export type HarnessWorkspaceState = z.infer<typeof HarnessWorkspaceStateSchema>;

export function emptyHarnessState(): HarnessWorkspaceState {
  return { version: 1 };
}

export function harnessStatePath(workspaceRoot: string): string {
  return join(workspaceRoot, HARNESS_STATE_DIR, HARNESS_STATE_FILE);
}

export class HarnessStateStore {
  constructor(
    private readonly onWarn: (message: string, detail?: unknown) => void = () =>
      undefined,
  ) {}

  load(workspaceRoot: string): HarnessWorkspaceState {
    const path = harnessStatePath(workspaceRoot);
    if (!existsSync(path)) return emptyHarnessState();
    try {
      const parsed = HarnessWorkspaceStateSchema.safeParse(
        JSON.parse(readFileSync(path, 'utf-8')),
      );
      if (!parsed.success) {
        this.onWarn('[harness-sync] state.json is malformed; using defaults', {
          path,
        });
        return emptyHarnessState();
      }
      return parsed.data;
    } catch (error: unknown) {
      this.onWarn('[harness-sync] state.json is unreadable; using defaults', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return emptyHarnessState();
    }
  }

  /**
   * Atomic and retried (`fs/atomic-write.ts`), like the manifests: a torn state
   * file that read as `gitignoreBlockRemovedByUser: true` would silently disable
   * the feature for that workspace forever.
   *
   * Returns `false` when the write failed. The caller treats that as "the
   * decision is not durable" and logs it; it never fails the reconcile.
   */
  save(workspaceRoot: string, state: HarnessWorkspaceState): boolean {
    const path = harnessStatePath(workspaceRoot);
    try {
      atomicWriteWithRetry(path, `${JSON.stringify(state, null, 2)}\n`);
      return true;
    } catch (error: unknown) {
      this.onWarn('[harness-sync] Could not persist state.json', {
        path,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }
}
