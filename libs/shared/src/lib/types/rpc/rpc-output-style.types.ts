/**
 * `outputStyle:` RPC namespace contracts (TASK_2026_197).
 *
 * Compile-time HALF of the dual registration. The runtime half is the
 * `'outputStyle:'` prefix in `ALLOWED_METHOD_PREFIXES`
 * (`libs/backend/vscode-core/src/messaging/rpc-handler.ts`) — neither alone
 * is sufficient; missing the runtime prefix crashes silently.
 *
 * A third site exists for this namespace: the handler manifest entry in
 * `libs/backend/rpc-handlers/src/lib/host-profile/manifest.ts`. `rpc-allowlist.spec.ts`
 * enforces all three together.
 *
 * E1 is the rule this whole surface is built around: the SDK binds an active
 * style by its frontmatter `name`, never by its filename. Every read, write,
 * compare and activate path below keys on `name`; `fileName` / `relativePath`
 * are presentation and storage only.
 */

/**
 * Where a style came from.
 *
 * `builtin` styles come from a hardcoded map inside the SDK binary and are
 * never file-discovered, so they can never be hidden by `settingSources`.
 * `plugin` is modelled here but not enumerated by discovery yet (Phase 5 is
 * deferred) — the tier exists so the list renderer and the activation
 * predicate stay total.
 */
export type OutputStyleTier = 'builtin' | 'user' | 'project' | 'plugin';

/**
 * The two tiers Ptah is allowed to write a style FILE into (Req 3.3).
 * `builtin` and `plugin` styles are immutable by construction (Req 4.2).
 */
export type WritableOutputStyleTier = Extract<
  OutputStyleTier,
  'user' | 'project'
>;

/**
 * Which `.claude/settings*.json` file an opt-in CLI-parity write targets (E2).
 *
 * - `user`    → `~/.claude/settings.json` (all projects)
 * - `project` → `<workspaceRoot>/.claude/settings.json` (committable — the default)
 * - `local`   → `<workspaceRoot>/.claude/settings.local.json` (gitignored)
 *
 * This is PARITY only. It is not how a style activates inside Ptah — that is
 * the flag tier (see `ActivationDecision`). A parity failure must never roll
 * back or block a selection.
 */
export type SettingsTier = 'user' | 'project' | 'local';

/**
 * How a chosen style reaches a session. **Exactly three members.**
 *
 * `inject` is defined as `!fileVisible`, so `flag` and `inject` are complements
 * of one boolean and CANNOT both be true — that is the structural guarantee
 * behind Req 5.3 ("applied exactly once"), not a runtime check.
 *
 * There is deliberately **no `'inert'` member**. Built-ins resolve through a
 * hardcoded map rather than a directory scan, so a built-in can never be
 * hidden and the branch was unreachable dead state. If anyone reintroduces it,
 * a compile error is the intended outcome.
 */
export type ActivationDecision =
  | { readonly path: 'none' }
  | { readonly path: 'flag'; readonly styleName: string }
  | {
      readonly path: 'inject';
      readonly body: string;
      readonly styleName: string;
    };

/** Frontmatter validation failure: a key outside the SDK's `.strict()` schema (Req 7.2). */
export interface OutputStyleUnrecognizedKeyError {
  readonly code: 'UNRECOGNIZED_KEY';
  /** The offending key, named so the user knows what to remove. */
  readonly key: string;
  /** All four keys the SDK's strict schema accepts. */
  readonly validKeys: readonly string[];
  readonly message: string;
}

/** Frontmatter validation failure: the YAML itself would not parse (Req 7.3). */
export interface OutputStyleYamlParseError {
  readonly code: 'YAML_PARSE';
  /** 1-based line from `YAMLException.mark`, when the parser supplied one. */
  readonly line?: number;
  /** 1-based column from `YAMLException.mark`, when the parser supplied one. */
  readonly column?: number;
  readonly message: string;
}

/** Frontmatter validation failure: a known key held the wrong type. */
export interface OutputStyleInvalidValueError {
  readonly code: 'INVALID_VALUE';
  readonly key?: string;
  readonly message: string;
}

/** The file could not be read at all (permissions, vanished mid-scan). */
export interface OutputStyleReadError {
  readonly code: 'READ_FAILED';
  readonly message: string;
}

/**
 * Why a discovered `.md` file is not a usable style.
 *
 * Every member carries a pre-formatted `message`. Req 7.6: raw exception text
 * and absolute host paths never reach these — the backend formats them.
 */
export type OutputStyleValidationError =
  | OutputStyleUnrecognizedKeyError
  | OutputStyleYamlParseError
  | OutputStyleInvalidValueError
  | OutputStyleReadError;

/** Why a write, delete or activate operation could not complete. */
export type OutputStyleOperationErrorCode =
  | 'NO_WORKSPACE'
  | 'NOT_FOUND'
  | 'IMMUTABLE'
  | 'INVALID_NAME'
  | 'FILE_EXISTS'
  | 'STALE_FILE'
  | 'WRITE_FAILED'
  | 'DELETE_FAILED'
  | 'SETTINGS_MALFORMED'
  | 'SETTINGS_CONFLICT';

export interface OutputStyleOperationError {
  readonly code: OutputStyleOperationErrorCode;
  /** Formatted for display. Never raw exception text (Req 7.6). */
  readonly message: string;
  /** Workspace-relative or `~`-relative. Never an absolute host path (Req 7.6). */
  readonly path?: string;
}

/**
 * One usable style, in whichever tier it was found.
 *
 * `editable` / `deletable` / `immutableReason` are DATA, not a UI convention —
 * the list renders a disabled control plus the reason string rather than a
 * silently missing button (Req 4.2).
 */
export interface OutputStyleEntry {
  /** The frontmatter `name`, or the filename without `.md` when absent. THE key everything binds to (E1). */
  readonly name: string;
  readonly tier: OutputStyleTier;
  /** Frontmatter `description`, or a derived one-line body summary (Req 1.4). Never empty. */
  readonly description: string;
  /** `keep-coding-instructions`. Absent and `false` both mean "replaces" (Req 6). */
  readonly keepCodingInstructions: boolean;
  readonly editable: boolean;
  readonly deletable: boolean;
  /** Set whenever `editable` is false — e.g. `'built-in'` or `'plugin:<id>'` (Req 4.2). */
  readonly immutableReason?: string;
  /** Trimmed markdown body. `undefined` for built-ins, whose text lives in the binary. */
  readonly body?: string;
  /** Basename with extension, for delete confirmations (Req 4.5). Absent for built-ins. */
  readonly fileName?: string;
  /** Workspace-relative or `~`-relative path. Never absolute (Req 7.6). Absent for built-ins. */
  readonly relativePath?: string;
  /** Owning plugin id, when `tier === 'plugin'`. `name` is already namespaced `${pluginId}:${styleName}` (Req 1.3). */
  readonly pluginId?: string;
  /**
   * True when another entry with the same `name` outranks this one under the
   * SDK's merge order (project > user > policy, and any file style shadows a
   * same-named built-in). The frontend cannot derive this without duplicating
   * the merge order, so discovery states it (E4).
   */
  readonly shadowed?: boolean;
}

/** A style plus the fields only needed when one style is opened for editing. */
export interface OutputStyleDetail extends OutputStyleEntry {
  /** Last-modified epoch ms at read time. Echoed back on save as the E8 concurrent-edit guard. */
  readonly mtime?: number;
  /** Byte length at read time. Belt-and-braces beside `mtime`, which the FS contract suite does not guarantee across adapters (E8). */
  readonly byteLength?: number;
}

/** A `.md` file that was found but is not usable. Listed, never omitted (Req 7.1). */
export interface InvalidOutputStyle {
  /** Basename with extension. */
  readonly fileName: string;
  /** Workspace-relative or `~`-relative. Never absolute (Req 7.6). */
  readonly relativePath: string;
  readonly tier: OutputStyleTier;
  readonly error: OutputStyleValidationError;
  /** True when the user may open it in the editor sub-view to fix it (Req 7.5). */
  readonly openable: boolean;
}

/** What Ptah currently considers active, and whether that still resolves. */
export interface ActiveOutputStyleState {
  /** The persisted selection. `null` means no style — SDK default behaviour. */
  readonly name: string | null;
  /** Tier of the entry `name` resolved to, or `null` when nothing resolved. */
  readonly tier: OutputStyleTier | null;
  /**
   * True when `name` is non-null but resolves to nothing. Two causes are
   * indistinguishable here: the file was removed or renamed outside Ptah, or
   * it still exists but no longer parses (it will then appear in `invalid`).
   * Do not claim removal — the UI checks `invalid` before wording the banner.
   * The UI names the orphan value and offers "revert to default" rather than
   * showing a phantom healthy style (E5).
   */
  readonly missing: boolean;
}

/** Workspace scoping — same convention as `TasksWorkspaceScopedParams`. */
export interface OutputStyleWorkspaceScopedParams {
  workspaceRoot?: string;
}

export type OutputStyleListParams = OutputStyleWorkspaceScopedParams;
export interface OutputStyleListResult {
  readonly styles: readonly OutputStyleEntry[];
  readonly invalid: readonly InvalidOutputStyle[];
  readonly active: ActiveOutputStyleState;
}

export interface OutputStyleGetParams extends OutputStyleWorkspaceScopedParams {
  /** The frontmatter `name`, never a filename (E1). */
  readonly name: string;
  readonly tier: OutputStyleTier;
}
export interface OutputStyleGetResult {
  readonly style: OutputStyleDetail | null;
}

/** Opt-in CLI-parity write request. Default OFF (R6, §4.2). */
export interface OutputStyleParityRequest {
  readonly enabled: boolean;
  readonly tier: SettingsTier;
}

/** What the parity write actually did. A failure here never fails activation (§4.1). */
export interface OutputStyleParityOutcome {
  readonly written: boolean;
  /** Workspace-relative or `~`-relative, so the UI can name the exact file it changed (E2). */
  readonly writtenPath?: string;
  readonly tier?: SettingsTier;
  readonly error?: OutputStyleOperationError;
}

export interface OutputStyleActivateParams extends OutputStyleWorkspaceScopedParams {
  /** The style `name` to activate, or `null` / `'default'` to clear the selection (Req 2.4). */
  readonly name: string | null;
  readonly parity?: OutputStyleParityRequest;
}
export interface OutputStyleActivateResult {
  readonly success: boolean;
  /** How the selection will reach the NEXT session (Req 2.5). */
  readonly decision: ActivationDecision;
  readonly parity?: OutputStyleParityOutcome;
  readonly error?: OutputStyleOperationError;
}

/**
 * Upsert — create and edit share one path, so renaming an active style updates
 * the binding in a single server-side operation rather than a client two-step
 * (Req 4.4).
 */
export interface OutputStyleSaveParams extends OutputStyleWorkspaceScopedParams {
  readonly tier: WritableOutputStyleTier;
  /** The new frontmatter `name`. Blank or whitespace-only is rejected (Req 3.5). */
  readonly name: string;
  readonly description: string;
  readonly keepCodingInstructions: boolean;
  /** Markdown body, preserved verbatim (Req 4.3). */
  readonly body: string;
  /** The `name` this style had before the edit. Absent on create. Drives the Req 4.4 rebind. */
  readonly originalName?: string;
  /** `mtime` from `outputStyle:get`. Mismatch aborts with `STALE_FILE` (E8). */
  readonly expectedMtime?: number;
  /** `byteLength` from `outputStyle:get`. Checked beside `expectedMtime` (E8). */
  readonly expectedByteLength?: number;
  /** Required to write over an existing file in the target tier (Req 3.4). */
  readonly overwrite?: boolean;
}
export interface OutputStyleSaveResult {
  readonly success: boolean;
  /** Workspace-relative or `~`-relative path written. Never absolute (Req 7.6). */
  readonly path?: string;
  /** True when the save renamed the active style and rebound the selection (Req 4.4). */
  readonly rebound?: boolean;
  readonly error?: OutputStyleOperationError;
}

export interface OutputStyleDeleteParams extends OutputStyleWorkspaceScopedParams {
  readonly name: string;
  readonly tier: WritableOutputStyleTier;
}
export interface OutputStyleDeleteResult {
  readonly success: boolean;
  /** True when the deleted style was active, so the selection fell back to default (Req 4.6). */
  readonly clearedActive: boolean;
  readonly error?: OutputStyleOperationError;
}

export type OutputStyleDiagnoseParams = OutputStyleWorkspaceScopedParams;
export interface OutputStyleDiagnoseResult {
  /** The decision the next session would take, re-resolved rather than cached (Req 5.6). */
  readonly decision: ActivationDecision;
  /**
   * The tiers the SDK will actually scan for style FILES on the current
   * provider. `user` drops out on localhost-proxy providers, which is the one
   * axis that makes `decision.path === 'inject'` possible (E3).
   */
  readonly visibleTiers: readonly OutputStyleTier[];
  /** The persisted selection, so the UI can name an orphan value (E5). */
  readonly activeName: string | null;
  /** True when `activeName` no longer resolves to any style (E5). */
  readonly activeMissing: boolean;
}
