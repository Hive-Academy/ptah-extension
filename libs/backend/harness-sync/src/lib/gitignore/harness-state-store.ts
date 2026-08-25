/**
 * `{ws}/.ptah/harness/state.json` — the reconciler's per-workspace memory of
 * decisions the USER made, as opposed to the per-target manifests next to it,
 * which record what PTAH wrote.
 *
 * The file exists because these decisions are unrecoverable from disk alone.
 * The first was "I deleted your `.gitignore` block": an absent block means
 * either "never written" or "written and deleted", and those must produce
 * opposite behaviour — write it, versus never write it again. Nothing in
 * `.gitignore` itself can tell them apart, so the fact is recorded here.
 *
 * The second is `agentSyncEnabled`: whether the user consented to Ptah managing
 * subagents in this workspace. Nothing on disk distinguishes "never asked" from
 * "asked and declined" either, and getting it wrong reaps files. See
 * `state/agent-sync-gate.ts`.
 *
 * The third is `skillSyncMode` / `enabledSkillSlugs`: WHICH skills this
 * workspace asked for. `~/.ptah/user/skills` is one directory per MACHINE that
 * only ever grows, so "everything the user layer holds" stopped being a per-
 * project answer the moment a second project existed. Same shape as the second
 * and the same hazard — getting it wrong reaps files, and more of them. See
 * `state/skill-sync-gate.ts`.
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
  /**
   * The user consented to Ptah managing subagents in this workspace.
   *
   * ABSENT is not `false`. Agents are manifest-owned, so a bare `false` on an
   * upgrading install would reap every `.codex/agents/*.toml`,
   * `.github/agents/*.agent.md` and `.cursor/agents/*.md` Ptah had already
   * written. `AgentSyncGate` resolves an absent flag from manifest evidence —
   * prior propagation is prior consent — and persists the answer so the
   * evidence walk runs once. See `state/agent-sync-gate.ts`.
   */
  agentSyncEnabled: z.boolean().optional(),
  /**
   * ISO timestamp of the setup wizard completing, which is what grants
   * {@link agentSyncEnabled}. Diagnostic: it is the difference between "the
   * user asked for this" and "the migration inferred it".
   */
  wizardCompletedAt: z.string().optional(),
  /**
   * Which skills this workspace propagates: `'all'` of the user layer, or only
   * the slugs named in {@link enabledSkillSlugs}.
   *
   * ABSENT is not `'selected'`. Skills are manifest-owned, so a bare
   * `'selected'` with an empty allowlist on an upgrading install would not
   * merely stop propagating — the first routine reconcile would DELETE every
   * `.claude/skills/*`, `.agents/skills/*`, `.github/skills/*` and
   * `.cursor/skills/*` Ptah had already written, in every existing workspace,
   * silently, reported as an ordinary clean pass. Skills are the largest
   * artifact family by count, so this is the worst available version of the
   * failure `agentSyncEnabled` above exists to prevent.
   *
   * `SkillSyncGate` therefore resolves an absent mode from manifest evidence —
   * prior propagation is prior consent — and persists the answer so the
   * evidence walk runs once. See `state/skill-sync-gate.ts`.
   */
  skillSyncMode: z.enum(['all', 'selected']).optional(),
  /**
   * The allowlist, keyed by skill directory name exactly as `disabledSkillIds`
   * is, so one saved selection and one saved denylist need no second
   * canonicalisation rule to keep in step.
   *
   * Meaningful only under `skillSyncMode: 'selected'`, and absent under
   * `'all'` — a stale allowlist left behind by a switch to `'all'` would read
   * as a selection nobody made the next time the mode changed.
   */
  enabledSkillSlugs: z.array(z.string()).optional(),
  /**
   * ISO timestamp of the user explicitly choosing a skill selection, via
   * `SkillSyncGate.select` or `enableAll`.
   *
   * Diagnostic, and the exact analogue of {@link wizardCompletedAt}: it is the
   * difference between "the user asked for this" and "the migration inferred
   * it". A workspace resolved to `'selected'` with an empty allowlist is a new
   * workspace the migration gated when this field is absent, and a user who
   * deliberately deselected everything when it is present.
   */
  skillSelectionAt: z.string().optional(),
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
