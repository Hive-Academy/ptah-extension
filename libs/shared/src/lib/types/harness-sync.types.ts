/**
 * Harness-sync wire types.
 *
 * These live in `shared` rather than in `@ptah-extension/harness-sync` because
 * the health report crosses the RPC boundary: Batch 4 adds `harness:health` and
 * a Marketplace panel badge, and the webview cannot import a backend lib.
 * The reconciler and its targets are the only producers; everything else reads.
 */

/**
 * Every harness surface Ptah can populate.
 *
 * The five CLI surfaces plus `vscode`. `vscode` carries no skills, commands or
 * agents — VS Code has no such discovery directories — but it does own
 * `.vscode/mcp.json`, and the MCP install surface has always offered it as a
 * target. Modelling it here is what lets `McpInstallService` become a thin
 * wrapper over the reconciler instead of keeping a second write mechanism alive
 * for one config file (TASK_2026_278 Batch 2).
 */
export const HARNESS_TARGET_IDS = [
  'claude',
  'codex',
  'copilot',
  'cursor',
  'antigravity',
  'vscode',
] as const;

export type HarnessTargetId = (typeof HARNESS_TARGET_IDS)[number];

/** What a managed entry is, for reporting and for per-kind removal semantics. */
export type HarnessEntryKind = 'skill' | 'command' | 'agent' | 'mcp';

/** The four artifact families a target may or may not be able to carry. */
export type HarnessFacet = 'skills' | 'commands' | 'agents' | 'mcp';

/**
 * Whether a target can carry a facet at all.
 *
 * `unsupported` is a first-class, REPORTED answer rather than a silent gap.
 * Codex and Copilot reject project-level prompt directories upstream, and
 * Antigravity documents no subagent format, so those artifacts genuinely cannot
 * be delivered — the health report says so instead of showing a permanent
 * `missing` count nobody can act on (defect 12 of the TASK_2026_278 inventory).
 *
 * `source-managed` means the target's directory is itself an editable source.
 * Ptah intentionally does not write, track in its manifest, or reap that facet:
 * doing so would feed derived output back into the source layer.
 */
export type HarnessFacetSupport =
  | 'supported'
  | 'unsupported'
  | 'source-managed';

/** Per-facet capability of one target. */
export type HarnessFacetMatrix = Readonly<
  Record<HarnessFacet, HarnessFacetSupport>
>;

/**
 * Whether the user layer had anything to offer this run.
 *
 * - `ok` — sources resolved and produced at least one artifact.
 * - `sources-missing` — `~/.ptah/user` is absent or empty. Cold offline first
 *   run; the next online activation heals it. Never an error.
 * - `pending-download` — sources are empty AND a content download is known to
 *   be in flight, so the emptiness is expected to be temporary.
 */
export type HarnessSourcesStatus =
  | 'ok'
  | 'sources-missing'
  | 'pending-download';

/** Why a desired entry could not be written. */
export interface HarnessWriteFailure {
  /** Workspace-relative POSIX path of the entry, e.g. `.claude/skills/foo`. */
  relPath: string;
  /** Narrowed error message; never a raw stack. */
  reason: string;
}

/**
 * A source artifact that exists but will never reach a target.
 *
 * Ptah keeps a flat skill namespace on purpose (see the `SkillJunctionService`
 * rationale carried forward into `harness-manifest.builder.ts`): a skill's
 * identity is its frontmatter `name`, and namespacing on copy would break every
 * cross-skill reference and invalidate every saved per-skill toggle. So the
 * loser is recorded and surfaced instead of being silently renamed.
 */
export interface HarnessCollision {
  /** Slug that lost, e.g. `run-tests`. */
  slug: string;
  /** Absolute path of the source that lost. */
  shadowedSource: string;
  /** Basename of the losing plugin directory, when the loser came from one. */
  shadowedPluginId?: string;
  /**
   * - `duplicate-slug` — another source already claimed this exact slug.
   * - `case-collision` — differs only by case from a claimed slug, which is the
   *   same directory on NTFS/APFS (E20).
   * - `reserved-name` — a Windows device name (`CON`, `LPT1`, …) or a slug with
   *   characters no Windows path can hold.
   */
  reason: 'duplicate-slug' | 'case-collision' | 'reserved-name';
}

/** Per-target outcome of one reconcile pass. */
export interface HarnessTargetHealth {
  target: HarnessTargetId;
  /** False when the target CLI/host is not present in this workspace. */
  detected: boolean;
  /**
   * What this target can carry, independent of whether it is installed.
   *
   * Read together with `detected`: an undetected Codex still reports
   * `commands: 'unsupported'`, because installing Codex would not make project
   * prompts appear.
   */
  facets: HarnessFacetMatrix;
  /** Entries the desired state says this target should carry. */
  expected: number;
  /** Entries actually present on disk with the expected content hash. */
  found: number;
  /**
   * Desired entries that are NOT owned by Ptah on disk — absent, stale after a
   * failed write, or blocked by an unowned file sitting at the path.
   *
   * "Regardless of why" is the whole definition, and it is what keeps a
   * reconcile's report and a later verify's report identical over an unchanged
   * tree. A blocked path therefore appears here AND in {@link foreign}.
   */
  missing: string[];
  /** Paths that exist but are not manifest-owned — never touched. */
  foreign: string[];
  writeFailed: HarnessWriteFailure[];
  /** Manifest-owned paths whose local edits were overwritten (source wins). */
  overwrittenLocalEdit: string[];
  /** Manifest-owned paths deleted because the source disappeared. */
  removed: string[];
  /**
   * Unowned paths claimed on proof that Ptah wrote them — a legacy
   * `.ptah-managed.json` listed them, or they carry the writer signature of a
   * deleted Ptah writer — and then overwritten with current output.
   *
   * On a `full` report these were claimed; on a read-only report they are what
   * a repair WOULD claim, exactly as `missing` there is what it would write.
   *
   * Optional because a report produced without a plan (an undetected target, a
   * removal pass) has nothing to say here, and because every existing producer
   * of this type must keep compiling.
   */
  adopted?: string[];
  durationMs: number;
}

/** Aggregate result of `HarnessReconciler.reconcile`. */
export interface HarnessHealth {
  workspaceRoot: string;
  /** ISO-8601. */
  generatedAt: string;
  mode: 'full' | 'preflight';
  /** Free-text trigger label, e.g. `activation`, `plugins:save-config`. */
  reason: string;
  sources: HarnessSourcesStatus;
  targets: HarnessTargetHealth[];
  /** Source-level, not per-target: a shadowed skill is shadowed everywhere. */
  collisions: HarnessCollision[];
}

// ---------------------------------------------------------------------------
// Health summary (TASK_2026_278 Batch 4)
//
// One reducer, three consumers: the Marketplace badge, `ptah harness doctor`'s
// exit code, and the `harness:healthChanged` push. They must never disagree
// about what "healthy" means, so the rule is defined once, here, next to the
// report it reduces — and it is a pure function so both sides can call it.
// ---------------------------------------------------------------------------

/**
 * Severity of a health report, worst-first.
 *
 * - `unknown` — no pass has run yet, or no workspace is open. Not a fault.
 * - `error` — at least one desired entry could not be WRITTEN. Ptah tried and
 *   the filesystem refused (locked file, permissions); a human has to look.
 * - `degraded` — everything Ptah attempted succeeded, but the harness is not
 *   whole: entries are missing, or the sources themselves were unavailable.
 * - `ok` — every detected target carries everything the desired state asked for.
 *
 * `collisions` and `foreign` deliberately do NOT raise the level. A collision is
 * a source-authoring problem the user resolves by renaming a skill, and a
 * foreign path is a file Ptah is correctly refusing to touch — neither is a
 * malfunction of the reconcile, and treating them as one would leave a
 * permanently amber badge nobody can clear.
 */
export type HarnessHealthLevel = 'ok' | 'degraded' | 'error' | 'unknown';

/** Flattened counts across every target of one report, plus its severity. */
export interface HarnessHealthSummary {
  level: HarnessHealthLevel;
  /** Targets whose CLI/host was actually found in this workspace. */
  detectedTargets: number;
  /** Desired entries summed across detected targets. */
  expected: number;
  /** Entries present on disk with the expected hash. */
  found: number;
  missing: number;
  writeFailed: number;
  foreign: number;
  removed: number;
  collisions: number;
  sources: HarnessSourcesStatus;
  /** One-line human label, e.g. `2 missing across 3 targets`. */
  label: string;
}

/**
 * Reduce a report to a badge/exit-code verdict.
 *
 * Pure and total: `null` (no pass yet, or no workspace) reduces to `unknown`
 * with zeroed counts rather than throwing, because every caller renders it.
 */
export function summarizeHarnessHealth(
  health: HarnessHealth | null | undefined,
): HarnessHealthSummary {
  if (health === null || health === undefined) {
    return {
      level: 'unknown',
      detectedTargets: 0,
      expected: 0,
      found: 0,
      missing: 0,
      writeFailed: 0,
      foreign: 0,
      removed: 0,
      collisions: 0,
      sources: 'sources-missing',
      label: 'No harness reconcile has run yet',
    };
  }

  // Undetected targets are excluded from every count on purpose: a Codex that
  // is not installed is not a gap, and counting its skills as `expected`
  // would make a healthy single-CLI workspace read as permanently incomplete.
  const detected = health.targets.filter((target) => target.detected);
  const sum = (pick: (target: HarnessTargetHealth) => number): number =>
    detected.reduce((total, target) => total + pick(target), 0);

  const missing = sum((target) => target.missing.length);
  const writeFailed = sum((target) => target.writeFailed.length);

  const level: HarnessHealthLevel =
    writeFailed > 0
      ? 'error'
      : missing > 0 || health.sources !== 'ok'
        ? 'degraded'
        : 'ok';

  return {
    level,
    detectedTargets: detected.length,
    expected: sum((target) => target.expected),
    found: sum((target) => target.found),
    missing,
    writeFailed,
    foreign: sum((target) => target.foreign.length),
    removed: sum((target) => target.removed.length),
    collisions: health.collisions.length,
    sources: health.sources,
    label: harnessHealthLabel(level, {
      missing,
      writeFailed,
      detected: detected.length,
      sources: health.sources,
    }),
  };
}

function harnessHealthLabel(
  level: HarnessHealthLevel,
  counts: {
    missing: number;
    writeFailed: number;
    detected: number;
    sources: HarnessSourcesStatus;
  },
): string {
  const targets = `${counts.detected} target${counts.detected === 1 ? '' : 's'}`;
  switch (level) {
    case 'error':
      return `${counts.writeFailed} entr${counts.writeFailed === 1 ? 'y' : 'ies'} could not be written`;
    case 'degraded':
      if (counts.sources === 'pending-download')
        return 'Content download in progress';
      if (counts.sources === 'sources-missing')
        return 'Harness sources not installed yet';
      return `${counts.missing} missing across ${targets}`;
    case 'ok':
      return `Harness in sync across ${targets}`;
    case 'unknown':
      return 'No harness reconcile has run yet';
  }
}

/**
 * The BLOCKED set for one target: desired paths an unowned file occupies.
 *
 * `blocked = missing ∩ foreign`, DERIVED from the payload rather than carried
 * as a field. Both terms are already computed and already transmitted, so every
 * consumer can answer "which of these gaps are refusals?" with no contract
 * change at all — and a new field would be a second producer of a set two sides
 * already agree on.
 *
 * It lives HERE, beside {@link summarizeHarnessHealth}, for that function's
 * exact reason: more than one consumer reads it and they must never disagree.
 * The reconciler's blocked-path log line is one; the webview health card's
 * blocked disclosure is another, and a frontend lib cannot import
 * `harness-sync`, so a derivation on the backend side would have forced the
 * card to write a second intersection. One rule, one place.
 *
 * The intersection IS the reconciler's `plan.blocked`, structurally, and it
 * cannot drift from it:
 *
 *   - every planner pushes a blocked path into BOTH lists in one step
 *     (`harness-sync/.../claude-target.ts:277`, `workspace-target.ts:164-166`,
 *     `mcp/mcp-facet-planner.ts:107-108`), so `blocked ⊆ foreign` holds by
 *     construction rather than by two lists being kept in step;
 *   - `missing` is the planned (or failed) writes PLUS `plan.blocked`, and a
 *     desired path is either written or blocked and never both — so the only
 *     members of `missing` that can also be `foreign` are the blocked ones.
 *
 * Deriving it rather than reading `plan.blocked` is also what makes the same
 * answer available on the read-only `verify()` path, which never sees a plan.
 *
 * Order follows `missing`, which is the order the target planned its desired
 * entries in. Duplicates are collapsed; nothing else is reordered.
 */
export function blockedTargetPaths(target: HarnessTargetHealth): string[] {
  if (target.missing.length === 0 || target.foreign.length === 0) return [];

  const foreign = new Set(target.foreign);
  const seen = new Set<string>();
  const blocked: string[] = [];
  for (const relPath of target.missing) {
    if (!foreign.has(relPath) || seen.has(relPath)) continue;
    seen.add(relPath);
    blocked.push(relPath);
  }
  return blocked;
}

// ---------------------------------------------------------------------------
// RPC wire shapes (TASK_2026_278 Batch 4)
// ---------------------------------------------------------------------------

/** Params for `harness:health`. */
export interface HarnessHealthParams {
  /**
   * Run a fresh pass instead of returning the cached report.
   *
   * The default is the cache, because the badge polls and a report the
   * reconciler produced ten seconds ago at activation is the same report a
   * fresh `preflight` would produce. When no pass has run yet the handler
   * runs one regardless — an empty badge is worse than one cheap walk.
   */
  refresh?: boolean;
}

/** Result of `harness:health`. */
export interface HarnessHealthResult {
  /** `null` when no workspace is open; the panel renders that as `unknown`. */
  health: HarnessHealth | null;
  summary: HarnessHealthSummary;
  /** True when `health` came from the reconciler's cache, not a fresh pass. */
  cached: boolean;
}

/** Params for `harness:reconcile`. */
export interface HarnessReconcileParams {
  /** Defaults to `full` — the manual button means "actually fix it". */
  mode?: 'full' | 'preflight';
  /** Restrict the pass to these targets. Empty/absent means every target. */
  targets?: HarnessTargetId[];
}

/** Result of `harness:reconcile`. */
export interface HarnessReconcileResult {
  health: HarnessHealth | null;
  summary: HarnessHealthSummary;
}

/** Params for `harness:remove`. */
export interface HarnessRemoveParams {
  /**
   * Explicit confirmation. The handler refuses without it — this deletes every
   * managed copy in the workspace, and an accidental RPC must not be enough.
   */
  confirm: boolean;
}

/** Result of `harness:remove`. */
export interface HarnessRemoveResult {
  health: HarnessHealth | null;
  summary: HarnessHealthSummary;
  /** Manifest-owned paths actually deleted, summed across targets. */
  removed: number;
}

/**
 * Payload of the `harness:healthChanged` push.
 *
 * Sent whenever the reconciler completes a pass whose SUMMARY differs from the
 * last one pushed — not on every pass. A preflight runs on every session start
 * and a full pass on every activation; pushing each would be a message per
 * session for a badge that did not change.
 */
export interface HarnessHealthChangedPayload {
  health: HarnessHealth;
  summary: HarnessHealthSummary;
}
