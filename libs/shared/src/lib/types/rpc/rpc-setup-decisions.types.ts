/**
 * Per-file keep/replace contracts for the setup wizard and community packs
 * (TASK_2026_701_9e4b, B1).
 *
 * Split out of `rpc-setup.types.ts` by domain: these are the shapes a preview
 * or a pack plan returns and the decisions the client sends back. The server
 * keeps every baseline and digest; the client only ever sees opaque tokens and
 * an opaque per-file `revision`, and sends back ids, decisions and the
 * revision it saw.
 */

/**
 * What the preview found at a wizard agent path before generation runs.
 *
 * - `new`: nothing is there; generation creates it.
 * - `exists`: a file is there. The generated content is not known before the
 *   run, so the wizard cannot say whether it differs.
 * - `unreadable`: something is there and could not be read (a non-ENOENT
 *   error). Always kept; replace is refused for it.
 */
export type LocalFileState = 'new' | 'exists' | 'unreadable';

/**
 * What a pack plan found at one destination file. Unlike the wizard, a pack's
 * incoming bytes are known before install, so it can say `identical` or
 * `differs`. `unreadable` is always kept; replace is refused for it.
 */
export type PackFileState = 'new' | 'identical' | 'differs' | 'unreadable';

/** The user's choice for one existing local file. Keep is the default. */
export type FileDecision = 'keep' | 'replace';

/**
 * One file's decision as sent on submit/install. `revision` is the opaque value
 * the preview or plan row carried; the server rejects a replace whose revision
 * no longer matches the baseline it recorded.
 */
export interface FileDecisionEntry {
  decision: FileDecision;
  revision?: string;
}

/**
 * Where generated or pack agents are written.
 *
 * - `harness-root`: the project root the Library, other CLIs and model
 *   settings read (the default).
 * - `opened-folder`: only the folder that is open, which other CLIs and the
 *   Library do not read.
 */
export type GenerationTargetChoice = 'harness-root' | 'opened-folder';

/** The two candidate roots and which one applies. */
export interface GenerationTargetInfo {
  /** Absolute project root the harness reconciles. */
  harnessRoot: string;
  /** Absolute folder that is open in the host. */
  openedFolder: string;
  chosen: GenerationTargetChoice;
  /** True when both roots are the same folder, so there is no choice to show. */
  openedIsHarnessRoot: boolean;
}

/** Where the model line an agent will carry comes from. */
export type AgentModelOrigin = 'workspace' | 'machine' | 'template' | 'none';

/** The model line a generated agent will carry, and why. */
export interface AgentModelPreview {
  /** Model id written to the agent file, or null when no model line is written. */
  value: string | null;
  origin: AgentModelOrigin;
  /**
   * A saved override that is not a Claude model and is therefore ignored in
   * favour of the template model. Absent when no override was ignored.
   */
  ignoredOverride?: string;
}

/**
 * Terminal per-file outcome of a guarded write.
 *
 * - `written`: the file now holds the new content.
 * - `kept`: the user's file was kept (by choice, or because it was unreadable).
 * - `unchanged`: the file already held the new content.
 * - `changed-since-preview`: replace was chosen, but the file changed after the
 *   preview, so it was kept.
 * - `failed`: the write failed.
 */
export type FileOutcome =
  | 'written'
  | 'kept'
  | 'unchanged'
  | 'changed-since-preview'
  | 'failed';

/**
 * Whether the Library was refreshed after a write.
 *
 * - `updated`: a pass ran and the Library reflects the new files.
 * - `failed`: a pass was due and did not complete; the files on disk are
 *   unaffected.
 * - `not-applicable`: no pass was due (opened-folder target, nothing written,
 *   or a host without a Library).
 */
export type LibraryPassStatus = 'updated' | 'failed' | 'not-applicable';

/**
 * Why the wizard preview does or does not list rival CLI files.
 *
 * - `listed`: rival paths were worked out and are listed.
 * - `harness-unavailable`: the harness could not be reached.
 * - `cli-detection-failed`: installed CLIs could not be detected.
 * - `opened-folder-elsewhere`: the opened-folder target is not the harness
 *   root, so no rival CLI reads it.
 */
export type GenerationRivalStatus =
  | 'listed'
  | 'harness-unavailable'
  | 'cli-detection-failed'
  | 'opened-folder-elsewhere';

/** One destination file of a community pack install plan. */
export interface PackFilePlan {
  /** Pack agent file name, e.g. `docs-writer.md`. */
  file: string;
  state: PackFileState;
  /** Opaque baseline revision; echo it back with a replace decision. */
  revision: string;
  /** Incoming pack text, for the diff disclosure. */
  incomingText?: string;
  /** Current local text, for the diff disclosure. Absent for `new`/`unreadable`. */
  localText?: string;
}

/** Params for `wizard:plan-pack-install`: one file or the whole pack. */
export interface WizardPlanPackInstallParams {
  source: string;
  agentFiles: string[];
  target?: GenerationTargetChoice;
}

/** Result of `wizard:plan-pack-install`. Read-only: planning writes nothing. */
export interface WizardPlanPackInstallResult {
  /** Opaque token; echo it on `wizard:install-pack-agents`. */
  planToken: string;
  target: GenerationTargetInfo;
  files: PackFilePlan[];
}

/** One file's terminal outcome in a pack install. */
export interface PackFileOutcome {
  file: string;
  outcome: FileOutcome;
}
