/**
 * Auto-compaction control — the ONE translation of Ptah's `compaction.enabled`
 * and `compaction.threshold` settings into controls the pinned agent runtime
 * actually honours, plus the effective window and its source for the log.
 * Pure: no I/O, no logging, no env reads.
 *
 * Evidence (pinned `@anthropic-ai/claude-agent-sdk` 0.3.278, bundled CLI
 * 2.1.278, read from the shipped `sdk.mjs` and
 * `claude-agent-sdk-win32-x64/claude.exe`):
 *
 * - The auto-compaction gate is
 *   `function H0t(){return Boolean(De(process.env.DISABLE_COMPACT)||a.DISABLE_AUTO_COMPACT)}
 *   function Gf(){if(H0t())return!1;return Po("autoCompactEnabled",!0).value}`.
 *   The flag tier (`--settings`) is one of the sources `Po` reads, so a
 *   flag-tier `autoCompactEnabled: false` turns AUTO compaction off. Manual
 *   `/compact` is not behind `Gf`; only `DISABLE_COMPACT` would remove it, and
 *   Ptah never sets that.
 * - The settings schema is
 *   `autoCompactWindow: lrt()` with `lrt=()=>Q().int().min(Vee).max(qee).optional().catch(void 0)`,
 *   `Vee=1e5`, `qee=1e6`. An out-of-range value is silently DROPPED, so Ptah
 *   validates first and treats an invalid value as unset rather than sending
 *   something the runtime will ignore.
 * - The runtime resolves the window in `ME(model, settingsWindow)`:
 *   `CLAUDE_CODE_AUTO_COMPACT_WINDOW` first (parsed as an integer; NaN or
 *   `<= 0` is ignored, a value above 1e6 is capped to 1e6 and one below 1e5 is
 *   raised to 1e5), then the settings window, then client data, an
 *   experiment, and finally a per-model default (`R2=200000` for some models).
 *   Every branch compacts near `min(model window, configured window)`, so Ptah
 *   forwards `autoCompactWindow = threshold` unchanged.
 * - The SDK forwards `Options.settings` to the CLI as `--settings <json>`
 *   (`ProcessTransport.initialize`: `if(this.options.settings)Rn.settings=this.options.settings`).
 * - `CLAUDE_CODE_MAX_CONTEXT_TOKENS` is not a compaction control: it caps the
 *   context only when `DISABLE_COMPACT` is set (`function Oz`) and otherwise
 *   only sizes some unrecognised models (`function Pz`). Ptah does not set it.
 * - There is no `Options.compactionControl`; that name appears only in the
 *   deprecated Messages-API `BetaToolRunner` inside the same bundle.
 */

/** Smallest window the runtime accepts (`min(1e5)`). */
export const SDK_AUTO_COMPACT_WINDOW_MIN = 100_000;
/** Largest window the runtime accepts (`max(1e6)`). */
export const SDK_AUTO_COMPACT_WINDOW_MAX = 1_000_000;

/**
 * Which default applies to a session: `claude` for a first-party Anthropic
 * endpoint (no base URL, or `api.anthropic.com`), `proxied` for every other
 * base URL (translation proxies, OpenRouter, local providers).
 */
export type AutoCompactModelClass = 'claude' | 'proxied';

/**
 * Where the effective window comes from:
 * - `env`: `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, which the runtime honours ahead
 *   of every setting;
 * - `setting`: the user's `compaction.threshold` (or `compaction.enabled`
 *   turned off, where the window is moot);
 * - `default`: Ptah's class default from {@link A1_DEFAULT_WINDOW};
 * - `runtime`: Ptah sends nothing and the runtime decides.
 */
export type AutoCompactWindowSource = 'setting' | 'env' | 'default' | 'runtime';

/**
 * Ptah's default window per model class. Both stay `null` (no default, so no
 * behaviour change) until experiment E2 passes for a class; only then is that
 * class set (200,000 — the runtime's own unrecognised-model default).
 */
export const A1_DEFAULT_WINDOW: Readonly<
  Record<AutoCompactModelClass, number | null>
> = Object.freeze({ claude: null, proxied: null });

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

/**
 * The flag-tier keys plus what the runtime will actually use. Only the keys
 * reach `--settings`: `buildFlagSettings` copies `autoCompactEnabled` and
 * `autoCompactWindow` by name, so the two report fields never leave Ptah.
 */
export interface AutoCompactControl extends AutoCompactSettings {
  /** The window the runtime will use, or `null` when it decides (or auto compaction is off). */
  readonly effectiveWindow: number | null;
  readonly source: AutoCompactWindowSource;
}

export interface AutoCompactControlInput {
  /** `compaction.enabled`; Ptah's default is `true`. */
  readonly enabled: boolean;
  /** A user-set window in tokens, or `null` when unset (the runtime decides). */
  readonly windowTokens: number | null;
  /**
   * The session's model class. Omitted by a caller that cannot classify its
   * route; no class default applies then.
   */
  readonly modelClass?: AutoCompactModelClass;
  /**
   * The window the runtime takes from `CLAUDE_CODE_AUTO_COMPACT_WINDOW`, as
   * {@link parseAutoCompactWindowEnv} computes it, or `null` when the variable
   * is unset or ignored.
   */
  readonly envWindow?: number | null;
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
 * The window the runtime derives from a raw `CLAUDE_CODE_AUTO_COMPACT_WINDOW`
 * value, mirroring `ME`/`JCe` in the pinned CLI: empty → unset; not a positive
 * integer → ignored (`null`); otherwise clamped into
 * `[SDK_AUTO_COMPACT_WINDOW_MIN, SDK_AUTO_COMPACT_WINDOW_MAX]`. The runtime,
 * not Ptah, applies the clamp; this only predicts it for the log.
 */
export function parseAutoCompactWindowEnv(
  raw: string | undefined,
): number | null {
  const trimmed = raw?.trim();
  if (!trimmed) return null;
  const parsed = Number.parseInt(trimmed, 10);
  if (Number.isNaN(parsed) || parsed <= 0) return null;
  return Math.min(
    SDK_AUTO_COMPACT_WINDOW_MAX,
    Math.max(SDK_AUTO_COMPACT_WINDOW_MIN, parsed),
  );
}

/**
 * Resolve the flag-tier auto-compaction keys for one session, and the window
 * the runtime will use.
 *
 * Keys:
 * - disabled → `{ autoCompactEnabled: false }` (manual `/compact` still works);
 * - enabled with a valid user window → `{ autoCompactWindow }`;
 * - enabled with no (or an invalid) window and a class default → that default;
 * - otherwise → `{}`: the runtime decides.
 *
 * Effective window, in the runtime's precedence: env (it wins over every
 * setting), then the user setting, then the class default, then the runtime.
 * The env window never changes the keys: the runtime ignores the flag tier's
 * window while the variable is set, and sending the same keys keeps the
 * output independent of the host environment.
 *
 * An out-of-range window is never clamped into range — a clamp would apply a
 * value the user did not choose. Validation and its warning belong to the
 * settings boundary (`CompactionConfigProvider`); this re-check only keeps a
 * direct caller from sending a value the runtime would drop.
 *
 * `classDefaults` is {@link A1_DEFAULT_WINDOW} for every production caller;
 * the parameter exists so the `default` branch is specced while the shipped
 * table is still all `null`.
 */
export function resolveAutoCompactControl(
  input: AutoCompactControlInput,
  classDefaults: Readonly<
    Record<AutoCompactModelClass, number | null>
  > = A1_DEFAULT_WINDOW,
): AutoCompactControl {
  if (!input.enabled) {
    return {
      autoCompactEnabled: false,
      effectiveWindow: null,
      source: 'setting',
    };
  }

  const classDefault = input.modelClass
    ? classDefaults[input.modelClass]
    : null;
  const keys: AutoCompactSettings = isValidAutoCompactWindow(input.windowTokens)
    ? { autoCompactWindow: input.windowTokens }
    : isValidAutoCompactWindow(classDefault)
      ? { autoCompactWindow: classDefault }
      : {};

  const envWindow = input.envWindow ?? null;
  if (envWindow !== null) {
    return { ...keys, effectiveWindow: envWindow, source: 'env' };
  }
  if (keys.autoCompactWindow === undefined) {
    return { ...keys, effectiveWindow: null, source: 'runtime' };
  }
  return {
    ...keys,
    effectiveWindow: keys.autoCompactWindow,
    source: isValidAutoCompactWindow(input.windowTokens)
      ? 'setting'
      : 'default',
  };
}

/**
 * The model class of a session's route, from its effective
 * `ANTHROPIC_BASE_URL`: `claude` when it is empty or exactly
 * `api.anthropic.com`, else `proxied`. This is the one first-party test the
 * options builder also uses for its 1M beta and model pre-flight.
 */
export function autoCompactModelClass(
  baseUrl: string | undefined,
): AutoCompactModelClass {
  return isFirstPartyAnthropicBaseUrl(baseUrl) ? 'claude' : 'proxied';
}

/** No base URL, or exactly `http(s)://api.anthropic.com` with an optional trailing slash. */
export function isFirstPartyAnthropicBaseUrl(
  baseUrl: string | undefined,
): boolean {
  const trimmed = baseUrl?.trim();
  return !trimmed || /^https?:\/\/api\.anthropic\.com\/?$/i.test(trimmed);
}
