/**
 * OutputStyleStore — the frontend half of the `outputStyle:` RPC surface.
 *
 * One root-provided signal store behind the whole Advanced-tab section. It owns
 * the list, the invalid files, the persisted selection and the activation
 * decision, and nothing else: no rendering choices, no copy, no view state.
 *
 * Three rules this file exists to keep:
 *
 *  1. **`name` is the key.** Every read, write, compare and activate below is
 *     keyed on `OutputStyleEntry.name`, never on a filename or path (E1). The
 *     backend binds the SDK's `outputStyle` value to the frontmatter `name`, so
 *     anything else here would silently no-op.
 *  2. **`ClaudeRpcService.call()` returns a Result object, it does not throw.**
 *     Every call site uses `result.isSuccess()` / `result.data` / `result.error`.
 *     A `try/catch` around these would catch nothing and hide the real branch.
 *  3. **`save()` refreshes but never activates.** Req 3.6 wants the new style in
 *     the list without a reload; Req 3.7 wants activation to stay an explicit
 *     second action. Both are satisfied by `save()` calling `refresh()` and
 *     nothing else.
 *
 * `activate()` is optimistic-set-then-rollback (the shape used by
 * `workflows-config.component.ts`), which is what makes Req 2.7 — "a failed
 * write leaves the previous selection intact" — structural rather than a
 * promise.
 *
 * ## The parity argument does not participate in the rollback
 *
 * `activate(name, parity?)` may ask the backend to ALSO mirror the choice into
 * a `.claude/settings*.json` for the command line. That write is opt-in, and
 * its result arrives on `result.data.parity` — a field the rollback branch
 * never reads. The rollback is driven solely by `result.data.success`, which
 * describes the SELECTION. So a parity failure lands in `parityOutcome` and is
 * rendered as its own warning, while the chosen style stays exactly where the
 * user put it (§4.1).
 */

import { Injectable, computed, inject, signal } from '@angular/core';
import { ClaudeRpcService } from '@ptah-extension/core';
import type {
  ActivationDecision,
  ActiveOutputStyleState,
  InvalidOutputStyle,
  OutputStyleDetail,
  OutputStyleEntry,
  OutputStyleOperationError,
  OutputStyleParityOutcome,
  OutputStyleParityRequest,
  OutputStyleSaveParams,
  OutputStyleTier,
  WritableOutputStyleTier,
} from '@ptah-extension/shared';

/** The SDK's null sentinel. Not a style object — selecting it clears the key. */
const DEFAULT_STYLE_NAME = 'default';

@Injectable({ providedIn: 'root' })
export class OutputStyleStore {
  private readonly rpc = inject(ClaudeRpcService);

  readonly styles = signal<readonly OutputStyleEntry[]>([]);
  readonly invalid = signal<readonly InvalidOutputStyle[]>([]);
  readonly active = signal<ActiveOutputStyleState | null>(null);
  readonly decision = signal<ActivationDecision | null>(null);
  readonly loading = signal(false);
  readonly saving = signal(false);
  readonly error = signal<string | null>(null);

  /**
   * What the last opt-in parity write did, or `null` when none was requested.
   *
   * Deliberately separate from `error`: `error` means "your selection did not
   * change". A parity problem means the opposite — the selection DID change,
   * and only the extra copy for the command line did not.
   */
  readonly parityOutcome = signal<OutputStyleParityOutcome | null>(null);

  /** The persisted selection, or `null` for SDK-default behaviour. */
  readonly activeName = computed<string | null>(
    () => this.active()?.name ?? null,
  );

  /**
   * E5 — the selection points at a name that no longer resolves, because the
   * file was deleted outside Ptah. The UI names the orphan value rather than
   * rendering a phantom healthy style.
   */
  readonly activeMissing = computed(() => this.active()?.missing === true);

  /**
   * E4 — two tiers hold the same `name`. Discovery states this via `shadowed`
   * on the losing entries; the frontend must not re-derive the merge order.
   */
  readonly hasCollision = computed(() =>
    this.styles().some((style) => style.shadowed === true),
  );

  /** The colliding names, de-duplicated, so the banner can name them. */
  readonly collidingNames = computed<readonly string[]>(() => [
    ...new Set(
      this.styles()
        .filter((style) => style.shadowed === true)
        .map((style) => style.name),
    ),
  ]);

  /**
   * True only for the narrow E3 case: a user-tier style on a localhost-proxy
   * provider, where the provider does not read user-level style FILES and the
   * backend appends the body to the session prompt instead.
   */
  readonly usingFallbackInjection = computed(
    () => this.decision()?.path === 'inject',
  );

  /** The file the last parity write actually changed, for the confirmation line. */
  readonly parityWrittenPath = computed<string | null>(() => {
    const outcome = this.parityOutcome();
    return outcome?.written === true ? (outcome.writtenPath ?? null) : null;
  });

  /**
   * A parity failure, phrased as a warning rather than an error — the style is
   * active either way, so nothing here asks the user to retry their selection.
   */
  readonly parityWarning = computed<string | null>(
    () => this.parityOutcome()?.error?.message ?? null,
  );

  /** `outputStyle:list` + `outputStyle:diagnose`, in parallel. */
  async refresh(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [list, diagnose] = await Promise.all([
        this.rpc.call('outputStyle:list', {}),
        this.rpc.call('outputStyle:diagnose', {}),
      ]);

      if (list.isSuccess()) {
        this.styles.set([...list.data.styles]);
        this.invalid.set([...list.data.invalid]);
        this.active.set(list.data.active);
      } else {
        this.error.set(list.error ?? 'Could not read the output styles.');
      }

      if (diagnose.isSuccess()) {
        this.decision.set(diagnose.data.decision);
      }
    } finally {
      this.loading.set(false);
    }
  }

  /**
   * Persist the selection. Optimistic, with rollback to the exact previous
   * state on any failure (Req 2.7).
   *
   * @param name the style `name`, or `null` / `'default'` to clear it.
   * @param parity opt-in CLI-parity write. Omitted → the params carry no
   *   `parity` key at all and no settings file is touched (default OFF, R6).
   *
   * The rollback branch below reads `result.data.success` and nothing else.
   * `result.data.parity` is recorded and rendered separately, so a failed
   * parity write can never disturb the selection (§4.1).
   */
  async activate(
    name: string | null,
    parity?: OutputStyleParityRequest,
  ): Promise<boolean> {
    const previous = this.active();
    this.active.set(this.projectSelection(name));
    this.saving.set(true);
    this.error.set(null);
    this.parityOutcome.set(null);

    try {
      const result = await this.rpc.call(
        'outputStyle:activate',
        parity === undefined ? { name } : { name, parity },
      );

      if (result.isSuccess() && result.data.success) {
        this.decision.set(result.data.decision);
        this.parityOutcome.set(result.data.parity ?? null);
        return true;
      }

      this.active.set(previous);
      this.error.set(
        this.failureMessage(
          result.isSuccess() ? result.data.error : undefined,
          result.error,
          'Could not change the active output style.',
        ),
      );
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /**
   * Upsert a user- or project-tier style file.
   *
   * Returns `null` on success, or the typed operation error so the editor can
   * react to `FILE_EXISTS` (offer overwrite) and `STALE_FILE` (E8) rather than
   * only showing a string.
   *
   * Refreshes on success (Req 3.6). Deliberately does NOT activate (Req 3.7).
   */
  async save(
    params: OutputStyleSaveParams,
  ): Promise<OutputStyleOperationError | null> {
    this.saving.set(true);
    this.error.set(null);

    try {
      const result = await this.rpc.call('outputStyle:save', params);

      if (result.isSuccess() && result.data.success) {
        await this.refresh();
        return null;
      }

      const operationError = result.isSuccess() ? result.data.error : undefined;
      const message = this.failureMessage(
        operationError,
        result.error,
        'Could not save the output style.',
      );
      this.error.set(message);
      return operationError ?? { code: 'WRITE_FAILED', message };
    } finally {
      this.saving.set(false);
    }
  }

  /** Delete a user- or project-tier style file, then re-read the list. */
  async remove(name: string, tier: WritableOutputStyleTier): Promise<boolean> {
    this.saving.set(true);
    this.error.set(null);

    try {
      const result = await this.rpc.call('outputStyle:delete', { name, tier });

      if (result.isSuccess() && result.data.success) {
        await this.refresh();
        return true;
      }

      this.error.set(
        this.failureMessage(
          result.isSuccess() ? result.data.error : undefined,
          result.error,
          'Could not delete the output style.',
        ),
      );
      return false;
    } finally {
      this.saving.set(false);
    }
  }

  /** One style with its body and the E8 guard stamp, for the editor sub-view. */
  async load(
    name: string,
    tier: OutputStyleTier,
  ): Promise<OutputStyleDetail | null> {
    const result = await this.rpc.call('outputStyle:get', { name, tier });

    if (result.isSuccess()) {
      return result.data.style;
    }

    this.error.set(result.error ?? 'Could not open that output style.');
    return null;
  }

  /**
   * Req 5.5 — the escape hatch out of the fallback-injection path. Copies a
   * user-tier style into the project tier, where every provider reads it as a
   * file and no injection is needed.
   */
  async copyToProjectTier(
    name: string,
  ): Promise<OutputStyleOperationError | null> {
    const source = await this.load(name, 'user');

    if (source === null) {
      const message = `Could not read "${name}" to copy it into this project.`;
      this.error.set(message);
      return { code: 'NOT_FOUND', message };
    }

    return this.save({
      tier: 'project',
      name: source.name,
      description: source.description,
      keepCodingInstructions: source.keepCodingInstructions,
      body: source.body ?? '',
      overwrite: true,
    });
  }

  /** Clear a transient error banner without re-reading anything. */
  dismissError(): void {
    this.error.set(null);
  }

  /** Dismiss the parity confirmation or warning. The selection is unaffected. */
  dismissParityOutcome(): void {
    this.parityOutcome.set(null);
  }

  /**
   * The `ActiveOutputStyleState` the backend is about to persist, derived from
   * the list already in hand. Used as the optimistic value so the checkmark
   * moves on click instead of after the round trip.
   */
  private projectSelection(name: string | null): ActiveOutputStyleState {
    if (name === null || name === DEFAULT_STYLE_NAME) {
      return { name: null, tier: null, missing: false };
    }

    const match = this.styles().find(
      (style) => style.name === name && style.shadowed !== true,
    );

    return {
      name,
      tier: match?.tier ?? null,
      missing: match === undefined,
    };
  }

  /**
   * Operation errors win over transport errors: they are pre-formatted by the
   * backend and carry a `~`- or workspace-relative path, never a host path or
   * raw exception text (Req 7.6).
   */
  private failureMessage(
    operationError: OutputStyleOperationError | undefined,
    transportError: string | undefined,
    fallback: string,
  ): string {
    return operationError?.message ?? transportError ?? fallback;
  }
}
