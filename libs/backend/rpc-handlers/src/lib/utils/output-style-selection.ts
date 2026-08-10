/**
 * The ONE reading and writing of Ptah's output-style selection (TASK_2026_197).
 *
 * Two classes need it, and they need it to mean the same thing:
 *
 *  - `OutputStyleRpcHandlers` reads it to answer "what is active?" — the UI's
 *    checkmark and the `outputStyle:diagnose` report — and writes it when a
 *    user activates, renames or deletes a style.
 *  - `ChatOutputStyleActivationService` reads it to answer "what do I activate?"
 *    — the value that actually reaches the SDK on a session start.
 *
 * Those were two independent implementations of the same normalisation rule,
 * each commented as mirroring the other with nothing enforcing it. The failure
 * mode is not hypothetical: if the two readings ever disagree about how a
 * stored value collapses, the picker shows one style as active while a
 * different one — or none — is sent to the SDK, which is the "two decision
 * points disagree" bug Req 5.3/R3 is built to prevent, one layer up.
 *
 * ## The normalisation rule, stated once
 *
 * A stored selection collapses to `null` ("no style") when it is the `''`
 * default, whitespace only, a value the schema rejects (someone hand-edited the
 * settings file into a number), or the literal `default`. Everything else is
 * the trimmed name.
 *
 * ## Scope
 *
 * Reads and writes go through the SAME resolution path — the workspace scope
 * resolver when the host bound one, the global store otherwise — so they can
 * never disagree about which key they mean. A host without an
 * `IActiveWorkspaceSource` falls back to one unprefixed key: a degraded scope,
 * not a broken one.
 */
import type { Logger } from '@ptah-extension/vscode-core';
import {
  OUTPUT_STYLE_SELECTED_NAME_DEF,
  type ISettingsStore,
  type WorkspaceScopeResolver,
} from '@ptah-extension/settings-core';
import type { AuthEnv } from '@ptah-extension/shared';
// The sentinel is IMPORTED, never re-spelled. `DEFAULT_OUTPUT_STYLE_NAME` in
// `built-in-output-styles.ts` is the single definition of the string that means
// "no style is chosen" (Req 2.4) — the same one `ClaudeSettingsWriter` clears
// its key on. A second literal here is how the settings file and the session
// would come to disagree about what `default` means.
import { DEFAULT_OUTPUT_STYLE_NAME } from '@ptah-extension/output-styles';

/** Everything the selection helpers need from their owning class. */
export interface OutputStyleSelectionContext {
  readonly settingsStore: ISettingsStore;
  /** Absent on a host that never bound an `IActiveWorkspaceSource`. */
  readonly scopeResolver?: WorkspaceScopeResolver;
  readonly logger: Logger;
  /** Log tag of the calling class, e.g. `[OutputStyleRpc]`. */
  readonly logTag: string;
}

/**
 * Collapse any candidate selection to a style name or `null`.
 *
 * Applied to BOTH a stored value and an incoming `activate` request, so a name
 * that clears the selection on the way in reads back as cleared on the way out.
 *
 * The SDK ships a built-in literally named `default`, and choosing it is how a
 * user says "back to normal". Ptah stores that as no selection at all, so the
 * flag tier sends no `outputStyle` key and a style the user chose through the
 * CLI is left alone (G4b).
 */
export function normalizeOutputStyleSelection(
  name: string | null | undefined,
): string | null {
  if (typeof name !== 'string') return null;
  const trimmed = name.trim();
  if (trimmed.length === 0) return null;
  return trimmed === DEFAULT_OUTPUT_STYLE_NAME ? null : trimmed;
}

/**
 * The persisted selection, or `null` for "no style".
 *
 * Never throws: a settings store that fails to read degrades to "no style" and
 * a warning. A cosmetic preference must not be able to break the surface that
 * shows it, nor stop a chat session from starting.
 */
export function readOutputStyleSelection(
  ctx: OutputStyleSelectionContext,
): string | null {
  const key = OUTPUT_STYLE_SELECTED_NAME_DEF.key;
  let raw: unknown;
  try {
    raw =
      ctx.scopeResolver !== undefined
        ? ctx.scopeResolver.read<unknown>(key)
        : ctx.settingsStore.readGlobal<unknown>(key);
  } catch (error: unknown) {
    ctx.logger.warn(`${ctx.logTag} selection could not be read`, {
      error: error instanceof Error ? error.message : String(error),
    });
    return null;
  }

  const parsed = OUTPUT_STYLE_SELECTED_NAME_DEF.schema.safeParse(raw);
  return normalizeOutputStyleSelection(
    parsed.success ? parsed.data : OUTPUT_STYLE_SELECTED_NAME_DEF.default,
  );
}

/**
 * Persist the selection, scoped to the active workspace when the host can tell
 * us what that is. `null` writes the `''` "no selection" default.
 *
 * `workspaceRoot` on an RPC request scopes FILE discovery, not the selection —
 * a host with more than one open folder resolves the selection against
 * whichever one is active, which is also the one whose styles it is showing.
 */
export async function writeOutputStyleSelection(
  ctx: OutputStyleSelectionContext,
  name: string | null,
): Promise<void> {
  const key = OUTPUT_STYLE_SELECTED_NAME_DEF.key;
  const value = name ?? OUTPUT_STYLE_SELECTED_NAME_DEF.default;
  if (ctx.scopeResolver !== undefined) {
    await ctx.scopeResolver.write(key, value, 'workspace');
    return;
  }
  await ctx.settingsStore.writeGlobal(key, value);
}

/**
 * `ANTHROPIC_BASE_URL` from the live auth snapshot, normalised to `undefined`
 * when absent, non-string or blank.
 *
 * This is the single input that can turn the activation decision from `flag`
 * into `inject`, so the reporting path and the session path must read it
 * identically — hence one function rather than two.
 */
export function resolveProviderBaseUrl(
  authEnv: AuthEnv | undefined,
): string | undefined {
  const raw = authEnv?.ANTHROPIC_BASE_URL;
  if (typeof raw !== 'string') return undefined;
  const trimmed = raw.trim();
  return trimmed.length === 0 ? undefined : trimmed;
}
