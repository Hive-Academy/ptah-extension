import type { ISecretStorage } from '@ptah-extension/platform-core';
import { z } from 'zod';
import type { LaneRoutingLogger } from '../lane-routing-logger';
import { originOf } from './decision-endpoint.url';
import {
  DECISION_MODEL_CUSTOM_SECRET_KEY,
  DECISION_MODEL_JEV_SECRET_KEY,
  OLLAMA_CLOUD_SECRET_KEY,
} from './decision-model.types';

/** Key slots the decision model owns (it reads, but never owns, `ollama-cloud`). */
export type DecisionKeySlot = 'jev' | 'custom';

/**
 * The raw stored value of one slot, for a caller that must put it back after
 * a failed combined write (`agent:setConfig`). Opaque: pass it only to
 * `restore`. `null` means "no key". Never log, echo or return it across a
 * process or RPC boundary.
 */
export type DecisionKeySnapshot = string | null;

const SLOT_SECRET_KEY: Readonly<Record<DecisionKeySlot, string>> = {
  jev: DECISION_MODEL_JEV_SECRET_KEY,
  custom: DECISION_MODEL_CUSTOM_SECRET_KEY,
};

/** Stored value of the custom slot (DC3): the key is bound to one origin. */
const CustomKeyRecordSchema = z
  .object({ origin: z.string().min(1), key: z.string().min(1) })
  .strict();

/**
 * One owner for every key the decision model reads or writes (Component 4).
 *
 * - `jev`: the TypeSafe Jev key, a trimmed plain string.
 * - `custom`: JSON `{ origin, key }`. `get` returns the key only when the
 *   caller's origin equals the stored origin, so a key never reaches another
 *   host (DC3).
 * - `ollama-cloud`: the shared provider key (D1), read per call and never
 *   written here.
 *
 * Nothing is cached, so a key changed elsewhere is seen by the next read
 * (criterion 1.4). No method logs a key, returns it across RPC, or puts it in
 * an error (criterion 1.6). A rejected secret read propagates to the caller.
 */
export class DecisionModelKeys {
  constructor(
    private readonly secrets: ISecretStorage,
    private readonly logger: LaneRoutingLogger,
  ) {}

  /**
   * Whether a usable key is stored. For `custom`, with an origin: a key bound
   * to that origin; without one: a valid key bound to any origin.
   */
  async has(slot: DecisionKeySlot, origin?: string): Promise<boolean> {
    if (slot === 'jev' || origin !== undefined) {
      return (await this.get(slot, origin)) !== null;
    }
    return (await this.readCustomRecord()) !== null;
  }

  /**
   * The stored key (trimmed), or `null`. For `custom`, `null` unless `origin`
   * is given and equals the stored origin.
   */
  async get(slot: DecisionKeySlot, origin?: string): Promise<string | null> {
    if (slot === 'jev') {
      const key = await this.secrets.get(SLOT_SECRET_KEY.jev);
      return trimmedOrNull(key);
    }
    const wanted = origin === undefined ? null : originOf(origin);
    if (wanted === null) {
      return null;
    }
    const record = await this.readCustomRecord();
    return record !== null && record.origin === wanted ? record.key : null;
  }

  /**
   * Stores a key; `null` or blank deletes the slot. A non-blank `custom` key
   * needs the origin (or any URL of it) it is bound to.
   */
  async set(
    slot: DecisionKeySlot,
    key: string | null,
    origin?: string,
  ): Promise<void> {
    const trimmed = key?.trim() ?? '';
    const secretKey = SLOT_SECRET_KEY[slot];
    if (trimmed.length === 0) {
      await this.secrets.delete(secretKey);
      return;
    }
    if (slot === 'jev') {
      await this.secrets.store(secretKey, trimmed);
      return;
    }
    const bound = origin === undefined ? null : originOf(origin);
    if (bound === null) {
      throw new Error(
        'a custom endpoint key needs the http or https origin it is bound to',
      );
    }
    await this.secrets.store(
      secretKey,
      JSON.stringify({ origin: bound, key: trimmed }),
    );
  }

  /** The raw stored value of the slot, for `restore` only. */
  async snapshot(slot: DecisionKeySlot): Promise<DecisionKeySnapshot> {
    const raw = await this.secrets.get(SLOT_SECRET_KEY[slot]);
    return raw ?? null;
  }

  /** Puts a snapshot back as it was; `null` restores "no key". */
  async restore(
    slot: DecisionKeySlot,
    snapshot: DecisionKeySnapshot,
  ): Promise<void> {
    const secretKey = SLOT_SECRET_KEY[slot];
    if (snapshot === null) {
      await this.secrets.delete(secretKey);
      return;
    }
    await this.secrets.store(secretKey, snapshot);
  }

  /** The shared Ollama Cloud provider key (trimmed), or `null`. Read-only. */
  async readOllamaCloudKey(): Promise<string | null> {
    return trimmedOrNull(await this.secrets.get(OLLAMA_CLOUD_SECRET_KEY));
  }

  /**
   * The custom slot's record, or `null` when absent. An unreadable value
   * reads as "no key" and logs a warning that carries no part of the value.
   */
  private async readCustomRecord(): Promise<{
    readonly origin: string;
    readonly key: string;
  } | null> {
    const raw = await this.secrets.get(SLOT_SECRET_KEY.custom);
    if (raw === undefined || raw.trim().length === 0) {
      return null;
    }
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch {
      // Not JSON: `undefined` fails the schema check below, which logs the
      // warning. The parser's message is dropped because it can quote part
      // of the stored value.
      json = undefined;
    }
    const parsed = CustomKeyRecordSchema.safeParse(json);
    const key = parsed.success ? parsed.data.key.trim() : '';
    const origin = parsed.success ? originOf(parsed.data.origin) : null;
    if (!parsed.success || key.length === 0 || origin === null) {
      this.logger.warn(
        '[lane-routing] stored custom endpoint key is unreadable; reading it as no key',
        { slot: 'custom' },
      );
      return null;
    }
    return { origin, key };
  }
}

function trimmedOrNull(value: string | undefined): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}
