/**
 * Writes the decision-model fields of one `agent:setConfig` request: the
 * selection and at most one key slot (Component 9, criteria 2.2, 2.4, 2.5;
 * D4; DC10).
 *
 * Extracted from `AgentRpcHandlers` so the 646 rollback rules are written once
 * for every {@link DecisionKeySlot}. The caller validates the request shape
 * (types, schema, one key field) and runs every call through its
 * `setConfigQueue`, so two saves never interleave these steps.
 */
import type { Logger } from '@ptah-extension/vscode-core';
// `keyTransportAllowed` is the one copy of the D4 rule
// (lane-routing `decision-endpoint.url.ts`).
import {
  keyTransportAllowed,
  type DecisionKeySlot,
  type DecisionModelConfig,
  type DecisionModelSelection,
} from '@ptah-extension/lane-routing';
import {
  DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT,
  DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
  DECISION_MODEL_KEY_NEEDS_HTTPS,
  loggableErrorName,
  type LoggableErrorName,
} from '@ptah-extension/shared';

/** The decision-model config surface the writer uses. */
export type DecisionModelWriterConfig = Pick<
  DecisionModelConfig,
  'getSelection' | 'setSelection' | 'keys'
>;

/** One key field of the request: the slot and the raw value (`''` deletes). */
export interface DecisionKeyWrite {
  readonly slot: DecisionKeySlot;
  readonly key: string;
}

type CustomEndpointSelection = Extract<
  DecisionModelSelection,
  { kind: 'custom' }
>;

/** Fixed restore-failure text per slot; the row shows it instead of "unchanged". */
const KEY_MAY_HAVE_CHANGED: Readonly<Record<DecisionKeySlot, string>> = {
  jev: DECISION_MODEL_KEY_MAY_HAVE_CHANGED,
  custom: DECISION_MODEL_CUSTOM_KEY_MAY_HAVE_CHANGED,
};

/** Whether two parsed decision-model selections name the same model. */
export function sameDecisionModelSelection(
  a: DecisionModelSelection,
  b: DecisionModelSelection,
): boolean {
  switch (a.kind) {
    case 'unset':
      return b.kind === 'unset';
    case 'ollama':
      return b.kind === 'ollama' && b.model === a.model;
    case 'jev':
      return b.kind === 'jev' && b.model === a.model;
    case 'ollama-cloud':
      return b.kind === 'ollama-cloud' && b.model === a.model;
    case 'custom':
      return (
        b.kind === 'custom' && b.baseUrl === a.baseUrl && b.model === a.model
      );
    case 'structured':
      return (
        b.kind === 'structured' &&
        b.providerId === a.providerId &&
        b.model === a.model
      );
  }
}

/** The stored slot value `keys.snapshot` returns, for `keys.restore` only. */
type KeySnapshot = Awaited<
  ReturnType<DecisionModelWriterConfig['keys']['snapshot']>
>;

/** The failed write a key restore follows, as logged. */
type RestoreCause =
  | { readonly keyErrorType: LoggableErrorName }
  | { readonly selectionErrorType: LoggableErrorName };

type WritePlan =
  | { readonly ok: true; readonly origin?: string }
  | { readonly ok: false; readonly error: string };

export class DecisionModelWriter {
  constructor(
    private readonly config: DecisionModelWriterConfig,
    private readonly logger: Logger,
  ) {}

  /**
   * Writes the key and/or the selection; the selection is already validated.
   * Returns fixed failure text when the request is refused (D4, DC10) or a
   * rollback failed. Any other failure rejects with the original error, which
   * the caller turns into `{ success: false }` with fixed text.
   *
   * - Refusals are decided before any write, so a refused request changes
   *   nothing (2.2). A non-empty custom key needs a custom selection, sent or
   *   saved, whose origin it is bound to (DC10). A custom selection whose
   *   effective key (the new key, or a stored key bound to the same origin)
   *   would travel over plain http to a non-loopback host is refused (D4).
   * - The slot is snapshotted before the key write, and the key is written
   *   before the selection, so a failed key write leaves the selection
   *   unchanged.
   * - A rejected key write may still have changed the slot (the store can
   *   persist and then reject), so the snapshot is put back before the
   *   error propagates (`null` deletes the new key).
   * - If the selection write then fails, the snapshot is restored the same
   *   way, so the failed request leaves both unchanged.
   * - If the selection write rejects but the stored selection already equals
   *   the requested one, the selection was stored: the new key is kept and
   *   the save reports success, so the row never says "unchanged" for a save
   *   that took effect. If that check cannot read the selection, the key is
   *   put back as above.
   * - A selection-only save applies the same check: a selection stored before
   *   its write rejected reports success; otherwise the error propagates.
   * - If putting the key back fails too, the result says the slot's key may
   *   have changed. Logs carry error types only; a key is never logged or
   *   echoed (1.6).
   */
  async write(
    keyWrite: DecisionKeyWrite | undefined,
    selection: DecisionModelSelection | undefined,
  ): Promise<string | undefined> {
    const plan = await this.plan(keyWrite, selection);
    if (!plan.ok) {
      return plan.error;
    }
    if (keyWrite === undefined) {
      if (selection !== undefined) {
        await this.writeSelectionOnly(selection);
      }
      return undefined;
    }
    const previousKey = await this.config.keys.snapshot(keyWrite.slot);
    const keyFailure = await this.writeKey(keyWrite, plan.origin, previousKey);
    if (keyFailure !== undefined || selection === undefined) {
      return keyFailure;
    }
    return this.writeSelectionAfterKey(keyWrite.slot, selection, previousKey);
  }

  /**
   * D4 and DC10 checks; reads only. A non-empty custom key yields the origin
   * (the bound endpoint's base URL) it is stored against.
   */
  private async plan(
    keyWrite: DecisionKeyWrite | undefined,
    selection: DecisionModelSelection | undefined,
  ): Promise<WritePlan> {
    const customKey =
      keyWrite?.slot === 'custom' ? keyWrite.key.trim() : undefined;
    if (customKey !== undefined && customKey.length > 0) {
      const endpoint =
        selection === undefined
          ? this.savedCustomEndpoint()
          : selection.kind === 'custom'
            ? selection
            : null;
      if (endpoint === null) {
        return { ok: false, error: DECISION_MODEL_CUSTOM_KEY_NEEDS_ENDPOINT };
      }
      if (!keyTransportAllowed(endpoint.baseUrl)) {
        return { ok: false, error: DECISION_MODEL_KEY_NEEDS_HTTPS };
      }
      return { ok: true, origin: endpoint.baseUrl };
    }
    // No new custom key (none sent, or `''` deleting it): the effective key
    // of a custom selection is a stored key bound to its origin.
    if (
      customKey === undefined &&
      selection?.kind === 'custom' &&
      !keyTransportAllowed(selection.baseUrl) &&
      (await this.config.keys.has('custom', selection.baseUrl))
    ) {
      return { ok: false, error: DECISION_MODEL_KEY_NEEDS_HTTPS };
    }
    return { ok: true };
  }

  /** The saved selection when it is a custom endpoint, else `null`. */
  private savedCustomEndpoint(): CustomEndpointSelection | null {
    const saved = this.config.getSelection();
    return saved.kind === 'custom' ? saved : null;
  }

  private async writeSelectionOnly(
    selection: DecisionModelSelection,
  ): Promise<void> {
    try {
      await this.config.setSelection(selection);
    } catch (selectionError: unknown) {
      // degradation-audit: reported — a selection stored before a late rejection is a completed save; the error type is logged
      if (this.storedSelectionState(selection) !== 'stored') {
        throw selectionError;
      }
      this.logger.warn(
        'RPC: agent:setConfig decision model selection was stored before its write failed',
        { selectionErrorType: loggableErrorName(selectionError) },
      );
    }
  }

  /**
   * Writes the key. On a rejected write the snapshot is put back and the
   * original error propagates; if that restore fails too, the slot's fixed
   * "may have changed" text is returned.
   */
  private async writeKey(
    keyWrite: DecisionKeyWrite,
    origin: string | undefined,
    previousKey: KeySnapshot,
  ): Promise<string | undefined> {
    try {
      await this.config.keys.set(keyWrite.slot, keyWrite.key, origin);
      return undefined;
    } catch (keyError: unknown) {
      // degradation-audit: reported — the slot is restored and the original error rethrown; a failed restore is logged and reported
      return this.restoreKey(keyWrite.slot, previousKey, keyError, {
        keyErrorType: loggableErrorName(keyError),
      });
    }
  }

  private async writeSelectionAfterKey(
    slot: DecisionKeySlot,
    selection: DecisionModelSelection,
    previousKey: KeySnapshot,
  ): Promise<string | undefined> {
    try {
      await this.config.setSelection(selection);
      return undefined;
    } catch (selectionError: unknown) {
      // degradation-audit: reported — a selection stored before a late rejection is a completed save; the error type is logged
      if (this.storedSelectionState(selection) === 'stored') {
        this.logger.warn(
          'RPC: agent:setConfig decision model selection was stored before its write failed; keeping the new key',
          { selectionErrorType: loggableErrorName(selectionError) },
        );
        return undefined;
      }
      return this.restoreKey(slot, previousKey, selectionError, {
        selectionErrorType: loggableErrorName(selectionError),
      });
    }
  }

  /**
   * Puts `previousKey` back after `cause` failed the save, then rethrows
   * `cause`: the slot is as it was, so the caller's generic failure is true.
   * If the restore fails too, logs both error types and returns the slot's
   * fixed "may have changed" text.
   */
  private async restoreKey(
    slot: DecisionKeySlot,
    previousKey: KeySnapshot,
    cause: unknown,
    causeType: RestoreCause,
  ): Promise<string> {
    try {
      await this.config.keys.restore(slot, previousKey);
    } catch (restoreError: unknown) {
      this.logger.error(
        'RPC: agent:setConfig could not restore the previous decision model key',
        {
          slot,
          ...causeType,
          restoreErrorType: loggableErrorName(restoreError),
        },
      );
      return KEY_MAY_HAVE_CHANGED[slot];
    }
    throw cause;
  }

  /**
   * Whether the stored selection equals `selection`. A failed read is logged
   * and answers `'unreadable'`; the caller then treats the save as failed
   * (and restores the previous key when one was written), the safe choice
   * when the stored selection is unknown.
   */
  private storedSelectionState(
    selection: DecisionModelSelection,
  ): 'stored' | 'not-stored' | 'unreadable' {
    try {
      return sameDecisionModelSelection(this.config.getSelection(), selection)
        ? 'stored'
        : 'not-stored';
    } catch (readError: unknown) {
      // degradation-audit: reported — the read failure is logged as a warn;
      // 'unreadable' makes the caller restore the previous key.
      this.logger.warn(
        'RPC: agent:setConfig could not read the decision model selection after a failed write; restoring the previous key',
        { errorType: loggableErrorName(readError) },
      );
      return 'unreadable';
    }
  }
}
