/**
 * The port every harness surface implements.
 *
 * Four phases, kept separate so the reconciler owns the lock, the manifest and
 * the reporting while a target owns only its own file layout:
 *
 *   detect → plan → apply → verify
 *
 * `plan` is synchronous and pure-ish (it stats and hashes, it never writes), so
 * a plan can be inspected in a test or printed by `ptah harness doctor` without
 * side effects. `apply` is the only phase allowed to touch the workspace.
 */

import type {
  HarnessCollision,
  HarnessEntryKind,
  HarnessFacetMatrix,
  HarnessTargetHealth,
  HarnessTargetId,
  McpServerConfig,
} from '@ptah-extension/shared';
import type { HarnessDesiredState } from '../manifest/desired-state.types';
import type {
  ManagedEntries,
  ManagedManifest,
} from '../manifest-store/managed-manifest';

/** One artifact the target intends to write. */
export interface HarnessPlanWrite {
  /**
   * Workspace-relative POSIX path, e.g. `.claude/skills/orchestration`.
   *
   * For `kind: 'mcp'` this is a FRAGMENT key — `<configRelPath>#<serverKey>`,
   * e.g. `.mcp.json#github` — because many servers share one config file. A
   * leading `~/` marks a user-global config. See `mcp/mcp-facet.port.ts`.
   */
  relPath: string;
  kind: HarnessEntryKind;
  /**
   * Absolute source directory (skills) or file (commands/agents). For
   * `kind: 'mcp'` there is no source path, so this carries the registry name;
   * the field is diagnostic-only either way.
   */
  source: string;
  /** Desired content hash after the write. */
  hash: string;
  /**
   * Hash of the SOURCE, when the target rewrites content on the way out and it
   * therefore differs from {@link hash}. Recorded so the next plan can tell a
   * changed source from a hand-edited copy. Omitted by byte-copy targets.
   */
  sourceHash?: string;
  isDirectory: boolean;
  reason: 'create' | 'update';
  /**
   * True when the on-disk content differs from what the manifest says Ptah
   * wrote — i.e. someone hand-edited a managed copy. The write still proceeds
   * (source wins; edits belong in the user layer) but it is reported so the
   * user finds out where their change went (E10).
   */
  overwritesLocalEdit: boolean;
  /**
   * `kind: 'mcp'` only: the server entry to install, and under which key.
   * Absent for every other kind, whose content is read from {@link source}.
   */
  mcp?: { serverKey: string; config: McpServerConfig };
}

/** A manifest-owned artifact whose source disappeared. */
export interface HarnessPlanRemove {
  relPath: string;
  kind: HarnessEntryKind;
  isDirectory: boolean;
  /** `kind: 'mcp'` only: the key to delete from the config file. */
  mcpServerKey?: string;
}

/** A one-time repair of state left by the pre-reconciler implementation. */
export interface HarnessMigration {
  /**
   * - `unlink-junction` — a `.claude/skills/<slug>` NTFS junction or symlink
   *   from `SkillJunctionService`, PROVEN to point inside a declared source root
   *   (`link-ownership.ts`). Removed with `unlink`, NEVER `rm -r`, which on
   *   Windows would follow the junction and delete the SOURCE skill. A link
   *   pointing anywhere else is not a migration at all — it is the user's, and
   *   it is reported `foreign`.
   * - `drop-legacy-manifest` — a `.ptah-managed.json` written inside a target
   *   directory by `SkillJunctionService` or by the rival-CLI installers, whose
   *   entries have already been adopted into the new manifest.
   * - `reap-home-entry` — a leftover in a CLI's HOME directory that carries the
   *   legacy Ptah writer signature, or whose name is `<prefix><known agent id>`.
   *   Copilot resolves agents home-first, so a stale home copy silently shadows
   *   the workspace copy Ptah just wrote (E19). The prefix ALONE is not proof of
   *   ownership — see `WorkspaceHarnessTarget.planHomeReap`.
   */
  kind: 'unlink-junction' | 'drop-legacy-manifest' | 'reap-home-entry';
  /** Absolute path of the artifact being migrated. */
  path: string;
}

export interface HarnessPlan {
  target: HarnessTargetId;
  writes: HarnessPlanWrite[];
  removals: HarnessPlanRemove[];
  /** Paths that exist, are not manifest-owned, and will not be touched (E9). */
  foreign: string[];
  /**
   * DESIRED paths this pass refuses to write because something unowned already
   * occupies them. A subset of {@link foreign}, and the reason it exists.
   *
   * `foreign` alone cannot answer "is the harness whole": a user's own
   * `.claude/skills/my-thing` is foreign and irrelevant, while a user's own
   * `.claude/skills/orchestration` is foreign AND means the skill Ptah was
   * asked to install is not installed. Health counts these as `missing` too —
   * `missing` is "desired but not owned on disk", regardless of why — which is
   * what stops `reconcile` reporting a clean pass over the same paths a later
   * `verify` calls gaps.
   */
  blocked: string[];
  /** Slugs skipped for name reasons, merged with the source-level collisions. */
  collisions: HarnessCollision[];
  migrations: HarnessMigration[];
  /**
   * Unowned paths this pass CLAIMED because it could prove Ptah wrote them — a
   * legacy `.ptah-managed.json` listed them, or they carry the writer signature
   * of a deleted Ptah writer. They are overwritten with current output rather
   * than frozen as foreign.
   *
   * Reported because taking over a file nobody's manifest owned must never be
   * invisible, for the same reason every `removed` path is reported.
   */
  adopted: string[];
  /**
   * Manifest entries as they stand AFTER migration adoption but BEFORE apply.
   * The reconciler starts from this map so adopted legacy entries survive even
   * when nothing else changed.
   */
  baseEntries: ManagedEntries;
  /** Desired entries already correct on disk. */
  unchanged: number;
  /** Total desired entries this target is responsible for. */
  expected: number;
}

export interface HarnessApplyResult {
  /** Ownership records for entries that were actually written this pass. */
  written: ManagedEntries;
  /** Relative paths successfully removed. */
  removed: string[];
  writeFailed: Array<{ relPath: string; reason: string }>;
  overwrittenLocalEdit: string[];
}

export interface IHarnessTarget {
  readonly id: HarnessTargetId;

  /**
   * Which artifact families this target can carry, independent of whether the
   * tool is installed. Reported in health so an artifact a CLI simply cannot
   * accept — Codex project prompts, Antigravity subagents — reads as
   * `unsupported` rather than as a permanent missing count (defect 12).
   */
  readonly facets: HarnessFacetMatrix;

  /** Whether this target applies to the workspace at all (E17). */
  detect(workspaceRoot: string): Promise<boolean>;

  /**
   * Workspace-relative path -> expected content hash, for the preflight fast
   * path.
   *
   * Exists so the reconciler can test for drift without knowing any target's
   * directory layout: it compares this map against the manifest and stats each
   * path, which is a handful of `stat` calls instead of a full tree hash.
   */
  preflightKeys(desired: HarnessDesiredState): ReadonlyMap<string, string>;

  /**
   * Diff desired against the manifest and the disk. Never writes.
   *
   * The reconciler passes the manifest it loaded INSIDE the workspace lock, so
   * plan and apply see one consistent snapshot.
   */
  plan(
    desired: HarnessDesiredState,
    workspaceRoot: string,
    manifest: ManagedManifest,
  ): HarnessPlan;

  apply(plan: HarnessPlan, workspaceRoot: string): Promise<HarnessApplyResult>;

  /**
   * Read-only health probe. Loads its own manifest rather than taking one,
   * because Batch 4's `harness:health` RPC calls this WITHOUT reconciling and
   * must not need the lock.
   *
   * **It must be `plan()` plus `plannedTargetHealth()`, and nothing else.** An
   * implementation that walks the disk a second time with its own rules is how
   * `reconcile` came to report "in sync across 5 targets" over the same tree a
   * `verify` a second later called 23 entries short: `plan` classified a
   * blocked path `foreign` and counted no gap, `verify` classified it `missing`
   * and counted no refusal, and neither converged. `plan` never writes (that is
   * this port's contract), so calling it here is free of side effects and the
   * two answers become the same answer by construction.
   */
  verify(
    desired: HarnessDesiredState,
    workspaceRoot: string,
  ): Promise<HarnessTargetHealth>;

  /**
   * Workspace-relative POSIX directories this target fills with managed
   * COPIES, for the `.gitignore` managed block (E23).
   *
   * Directories only, and only ones whose whole contents are derived. MCP
   * config files are excluded on purpose: `.mcp.json`, `.cursor/mcp.json` and
   * `.vscode/mcp.json` are project configuration teams commit, which happen to
   * carry a Ptah-owned fragment — not build output.
   *
   * Optional because a legitimate implementation of this port may have nothing
   * to ignore (the `vscode` target writes one config file and no directory),
   * and because a test double is a legitimate implementation too. The
   * reconciler treats an absent method as an empty list.
   */
  managedDirs?(): readonly string[];
}
