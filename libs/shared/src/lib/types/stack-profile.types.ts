/**
 * StackProfile — the one descriptor for "what kind of workspace is this".
 *
 * Before this module Ptah had five uncoordinated language detectors, each with
 * its own hand-written list of manifest filenames. They disagreed: the harness
 * probed only `requirements.txt`/`go.mod`/`Cargo.toml` (so a .NET repo rendered
 * `Languages: (none detected)` into the agent prompt), while its own sibling
 * emptiness check knew `.cs` but not `.csproj`/`.sln` (so a workspace holding a
 * real solution was judged EMPTY and took the new-project branch).
 *
 * A StackProfile is the single source of truth those detectors read. It is
 * deliberately **data, not behaviour** — zero dependencies, no I/O, no platform
 * assumptions — so the backend detectors, the license-free frontend intake, and
 * anything added later can all import the same table instead of growing a sixth
 * private copy of it.
 *
 * Adding a language is adding an entry to `STACK_PROFILES`, not editing five
 * `if` chains.
 */

/** The stacks Ptah can describe end to end. */
export type StackProfileId = 'node-ts' | 'dotnet' | 'python';

/** A plugin published by an external marketplace repo (`owner/repo`). */
export interface ExternalPluginRef {
  /** Marketplace repo in `owner/repo` form, e.g. `dotnet/skills`. */
  readonly marketplace: string;
  /** Plugin id within that marketplace's `.claude-plugin/marketplace.json`. */
  readonly plugin: string;
}

/**
 * Either a bundled plugin id (a plain string, resolved against Ptah's own
 * `AVAILABLE_PLUGINS`) or a plugin sourced from an external marketplace.
 */
export type PluginRef = string | ExternalPluginRef;

/**
 * How to recognise this stack from the names of files in a workspace root.
 *
 * Split three ways because the three answer different questions:
 * - `manifests` — exact filenames. "This workspace declares itself as X."
 * - `globs` — `*.ext` patterns, for stacks whose manifest name is per-project
 *   rather than fixed (`MyApp.csproj`, `MyApp.sln`).
 * - `sourceExtensions` — file extensions that count as *source* for this stack.
 *   Used by emptiness checks, never by "which stack is this" decisions: a lone
 *   `.py` script does not make a workspace a Python project, but it does make
 *   it non-empty.
 */
export interface StackDetectRules {
  readonly manifests: readonly string[];
  readonly globs: readonly string[];
  readonly sourceExtensions: readonly string[];
}

/** The command that proves this stack's toolchain is installed. */
export interface StackToolchain {
  /** Full probe command, whitespace-separated, e.g. `dotnet --version`. */
  readonly probe: string;
  /** Lowest version Ptah's scaffolding is known to work against. */
  readonly minVersion: string;
  /** Shown to the user when the probe comes back not-installed. */
  readonly installHint: string;
}

/** How a new workspace of this stack should be laid out. */
export interface StackWorkspacePlan {
  /**
   * `nx` when an Nx-managed workspace is the default for this stack, `none`
   * when the stack's native tooling is. Never a mandate — discovery asks; this
   * is only what the question defaults to.
   */
  readonly monorepoTool: 'nx' | 'none';
  /** Nx plugins to add when the user does choose Nx. */
  readonly nxPlugins: readonly string[];
  /** Native scaffolding commands, in the order they should run. */
  readonly scaffoldCommands: readonly string[];
}

/**
 * The skills that drive this stack's Stage A.
 *
 * `domain` is pinned to `ddd-architecture` because bounded-context modelling is
 * language-independent — the whole point of the split is that only
 * `initializer` and `architect` vary per stack.
 */
export interface StackSkillSet {
  readonly initializer: string;
  readonly architect: string;
  readonly domain: 'ddd-architecture';
}

/** One chip in the New Project intake's stack question. */
export interface StackOption {
  readonly value: string;
  readonly label: string;
}

/**
 * The whole descriptor for one stack.
 *
 * Consumers: the harness workspace probe, `ProjectDetectorService`,
 * `FrameworkDetectorService`, `MonorepoDetectorService`, the toolchain probe,
 * and (from TASK_2026_270 Batch 4) the intake vocabulary and seed prompt.
 */
export interface StackProfile {
  readonly id: StackProfileId;
  /**
   * User-facing name for the *platform*, e.g. shown on an intake chip.
   * Distinct from {@link StackProfile.language} on purpose: `node-ts` is
   * offered to a user as "Node / TypeScript" but reports "TypeScript" as the
   * language of a workspace.
   */
  readonly label: string;
  /**
   * The name this stack contributes to a workspace's language list — the
   * string that reaches the agent prompt as `Languages: ...`.
   */
  readonly language: string;
  readonly detect: StackDetectRules;
  readonly toolchain: StackToolchain;
  readonly workspace: StackWorkspacePlan;
  readonly skills: StackSkillSet;
  readonly requiredPlugins: readonly PluginRef[];
  readonly stackOptions: readonly StackOption[];
}

/**
 * Outcome of running a profile's `toolchain.probe`.
 *
 * `installed` and `satisfiesMin` are independent: a machine can have .NET 6
 * (installed, does not satisfy 8.0) or a `dotnet` on PATH that fails to report
 * a version (installed, version unknown, `satisfiesMin: false`). Callers that
 * only want a yes/no gate should read `satisfiesMin`; callers writing an error
 * message need `installed` to choose between "install it" and "upgrade it".
 */
export interface ToolchainProbeResult {
  readonly profileId: StackProfileId;
  /** The command that was run, echoed back for error messages. */
  readonly command: string;
  /** The probe binary was found and exited successfully. */
  readonly installed: boolean;
  /** Version parsed out of the probe output; absent if unparseable. */
  readonly version?: string;
  /** `version >= minVersion`. Always false when `version` is absent. */
  readonly satisfiesMin: boolean;
  readonly minVersion: string;
  /** Copied from the profile so a failed result is self-contained. */
  readonly installHint: string;
}
