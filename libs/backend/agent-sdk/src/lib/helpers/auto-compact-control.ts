/**
 * Auto-compaction control — the ONE translation of Ptah's `compaction.enabled`
 * and `compaction.threshold` settings into controls the pinned agent runtime
 * actually honours. Pure: no I/O, no logging, no env reads.
 *
 * Evidence (pinned `@anthropic-ai/claude-agent-sdk` 0.3.150, bundled CLI
 * 2.1.150, read from the shipped `sdk.mjs` and `claude.exe`):
 *
 * - The auto-compaction gate is
 *   `function $G(){if(mH(process.env.DISABLE_COMPACT))return!1;
 *   if(mH(process.env.DISABLE_AUTO_COMPACT))return!1;
 *   return $5("autoCompactEnabled",!0).value}`.
 *   `$5` walks `km()` sources last-to-first, and `km()` always adds
 *   `"flagSettings"` (the `--settings` tier) to the allowed set, so a flag-tier
 *   `autoCompactEnabled: false` turns AUTO compaction off. Manual `/compact` is
 *   not behind `$G`; only `DISABLE_COMPACT` would remove it, and Ptah never sets
 *   that.
 * - The settings schema is
 *   `autoCompactWindow: number().int().min(1e5).max(1e6).optional().catch(void 0)`.
 *   An out-of-range value is silently DROPPED, so Ptah validates first and
 *   treats an invalid value as unset rather than sending something the runtime
 *   will ignore. The runtime compacts near `min(model window, configured window)`.
 * - The SDK forwards `Options.settings` to the CLI as `--settings <json>`
 *   (`ProcessTransport.initialize`: `if(this.options.settings)GX.settings=...`,
 *   then `i.push("--"+key, value)`).
 * - `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is read only inside
 *   `if(mH(process.env.DISABLE_COMPACT)&&process.env.CLAUDE_CODE_MAX_CONTEXT_TOKENS)`
 *   (`function XZ`), so it is not a usable control while compaction is on.
 * - There is no `Options.compactionControl`; that name appears only in the
 *   deprecated Messages-API `BetaToolRunner` inside the same bundle.
 */

/** Smallest window the runtime accepts (`min(1e5)`). */
export const SDK_AUTO_COMPACT_WINDOW_MIN = 100_000;
/** Largest window the runtime accepts (`max(1e6)`). */
export const SDK_AUTO_COMPACT_WINDOW_MAX = 1_000_000;

/**
 * The flag-tier keys Ptah may contribute. A key is PRESENT only when Ptah has
 * an opinion: the flag tier outranks the user's own settings files, so
 * emitting `autoCompactEnabled: true` for Ptah's default would silently
 * override a user who disabled auto compaction for their own CLI.
 */
export interface AutoCompactSettings {
  readonly autoCompactEnabled?: false;
  readonly autoCompactWindow?: number;
}

export interface AutoCompactControlInput {
  /** `compaction.enabled`; Ptah's default is `true`. */
  readonly enabled: boolean;
  /** A user-set window in tokens, or `null` when unset (the runtime decides). */
  readonly windowTokens: number | null;
}

/** Integer in `[SDK_AUTO_COMPACT_WINDOW_MIN, SDK_AUTO_COMPACT_WINDOW_MAX]`. */
export function isValidAutoCompactWindow(value: unknown): value is number {
  return (
    typeof value === 'number' &&
    Number.isInteger(value) &&
    value >= SDK_AUTO_COMPACT_WINDOW_MIN &&
    value <= SDK_AUTO_COMPACT_WINDOW_MAX
  );
}

/**
 * Resolve the flag-tier auto-compaction keys for one session.
 *
 * - disabled → `{ autoCompactEnabled: false }` (manual `/compact` still works);
 * - enabled with a valid user window → `{ autoCompactWindow }`;
 * - enabled with no (or an invalid) window → `{}`: the runtime decides.
 *
 * An out-of-range window is never clamped into range — a clamp would apply a
 * value the user did not choose. Validation and its warning belong to the
 * settings boundary (`CompactionConfigProvider`); this re-check only keeps a
 * direct caller from sending a value the runtime would drop.
 */
export function resolveAutoCompactControl(
  input: AutoCompactControlInput,
): AutoCompactSettings {
  if (!input.enabled) return { autoCompactEnabled: false };
  if (isValidAutoCompactWindow(input.windowTokens)) {
    return { autoCompactWindow: input.windowTokens };
  }
  return {};
}
