/**
 * Rotation state (part A §4, Requirement 7.5, constant L).
 *
 * One global `IStateStorage` document. The host injects global state
 * (`PLATFORM_TOKENS.STATE_STORAGE`); this class has no workspace id, so
 * every workspace shares the cursor (part A, "L rotation lifetime").
 *
 * Document at `ROTATION_STORAGE_KEY` (`laneRouting.rotation.v1`):
 * `{ version: 1, entries: [{ key, candidateId }, ...] }`.
 * `key` is `${phaseId}|${taskKind}` with `taskKind` an `OutcomeTaskKind`.
 * Entries are oldest first. A write moves that key to the end. Past
 * `ROTATION_MAX_KEYS` (200) the oldest entry is dropped.
 *
 * A throwing read returns an empty document and
 * `rotation store unavailable`. A throwing write is logged and reported
 * as not persisted; the caller still returns the decision.
 * `record` does not write when the read threw, so a transient read
 * failure cannot replace a document this process never saw.
 * `save` writes the document it is given (the pipeline's merged state).
 */
import { z } from 'zod';
import {
  OUTCOME_TASK_KINDS,
  type OutcomeTaskKind,
} from '@ptah-extension/shared';
import type { IStateStorage } from '@ptah-extension/platform-core';
import type {
  LaneRoutingLogMeta,
  LaneRoutingLogger,
} from '../lane-routing-logger';
import {
  ROTATION_KEY_SEPARATOR,
  ROTATION_MAX_KEYS,
  ROTATION_STORAGE_KEY,
} from '../routing-constants';

/** Phrase `compile-reasons.ts` already puts on a missing rotation store. */
export const ROTATION_UNAVAILABLE_REASON = 'rotation store unavailable';

export const ROTATION_DOCUMENT_VERSION = 1;

export interface RotationPick {
  readonly key: string;
  readonly candidateId: string;
}

export interface RotationState {
  readonly version: typeof ROTATION_DOCUMENT_VERSION;
  /** Oldest first. Length is at most `ROTATION_MAX_KEYS`. */
  readonly entries: readonly RotationPick[];
}

export interface RotationLoad {
  readonly state: RotationState;
  /** Set when `IStateStorage.get` throws. Null for a missing or invalid document. */
  readonly reason: typeof ROTATION_UNAVAILABLE_REASON | null;
}

export interface RotationWrite {
  readonly persisted: boolean;
}

const RotationPickSchema = z
  .object({
    key: z.string().min(1),
    candidateId: z.string().min(1),
  })
  .strict();

const RotationDocumentSchema = z
  .object({
    version: z.literal(ROTATION_DOCUMENT_VERSION),
    entries: z.array(RotationPickSchema).max(ROTATION_MAX_KEYS),
  })
  .strict()
  .superRefine((document, ctx) => {
    const seen = new Set<string>();
    document.entries.forEach((entry, index) => {
      if (seen.has(entry.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['entries', index, 'key'],
          message: 'rotation key must be unique',
        });
      }
      seen.add(entry.key);
    });
  });

export function emptyRotationState(): RotationState {
  return { version: ROTATION_DOCUMENT_VERSION, entries: [] };
}

/** `${phaseId}|${taskKind}`. The key is opaque; it is never split. */
export function rotationKey(
  phaseId: string,
  taskKind: OutcomeTaskKind,
): string {
  if (phaseId.length === 0) {
    throw new Error('phase id must be non-empty');
  }
  if (!isOutcomeTaskKind(taskKind)) {
    throw new Error('taskKind must be an OutcomeTaskKind');
  }
  return `${phaseId}${ROTATION_KEY_SEPARATOR}${taskKind}`;
}

export function lastCandidateId(
  state: RotationState,
  key: string,
): string | null {
  for (let index = state.entries.length - 1; index >= 0; index -= 1) {
    const entry = state.entries[index];
    if (entry !== undefined && entry.key === key) return entry.candidateId;
  }
  return null;
}

/**
 * Remember one pick. The key moves to the newest end. A new key past the
 * cap drops the oldest entry. The input document is not mutated.
 */
export function withPick(
  state: RotationState,
  key: string,
  candidateId: string,
): RotationState {
  if (key.length === 0 || candidateId.length === 0) {
    throw new Error('rotation key and candidate id must be non-empty');
  }
  const kept = state.entries.filter((entry) => entry.key !== key);
  const appended = [...kept, { key, candidateId }];
  const entries =
    appended.length > ROTATION_MAX_KEYS
      ? appended.slice(appended.length - ROTATION_MAX_KEYS)
      : appended;
  return { version: ROTATION_DOCUMENT_VERSION, entries };
}

/**
 * Plain class, not `@injectable`. `LANE_ROUTING_TOKENS.ROTATION_STORE`
 * is not registered yet, and di-lint rejects `@inject` of an
 * unregistered token. The register function builds this with `useFactory`.
 */
export class RotationStore {
  constructor(
    /** `PLATFORM_TOKENS.STATE_STORAGE`, global scope. */
    private readonly storage: IStateStorage,
    /** `LANE_ROUTING_TOKENS.LOGGER`. */
    private readonly logger: LaneRoutingLogger,
  ) {}

  load(): RotationLoad {
    let raw: unknown;
    try {
      raw = this.storage.get<unknown>(ROTATION_STORAGE_KEY);
    } catch (error: unknown) {
      // degradation-audit: reported - a failed rotation read yields an empty state and names the rotation store; the decision still runs
      this.logger.warn(
        '[lane-routing] rotation state could not be read',
        errorFacts(error),
      );
      return {
        state: emptyRotationState(),
        reason: ROTATION_UNAVAILABLE_REASON,
      };
    }
    if (raw === undefined || raw === null) {
      return { state: emptyRotationState(), reason: null };
    }
    const parsed = RotationDocumentSchema.safeParse(raw);
    if (!parsed.success) {
      this.logger.warn(
        '[lane-routing] rotation state is invalid; starting from an empty rotation',
      );
      return { state: emptyRotationState(), reason: null };
    }
    return { state: copyState(parsed.data), reason: null };
  }

  /**
   * Read, remember one pick, write. Does not write when the read threw.
   */
  async record(key: string, candidateId: string): Promise<RotationWrite> {
    const loaded = this.load();
    if (loaded.reason !== null) {
      return { persisted: false };
    }
    return this.persist(withPick(loaded.state, key, candidateId));
  }

  /** Write a document the caller already built. Does not read first. */
  async save(state: RotationState): Promise<RotationWrite> {
    const parsed = RotationDocumentSchema.safeParse(state);
    if (!parsed.success) {
      throw new Error('rotation state is invalid');
    }
    return this.persist(copyState(parsed.data));
  }

  private async persist(state: RotationState): Promise<RotationWrite> {
    try {
      await this.storage.update(ROTATION_STORAGE_KEY, state);
      return { persisted: true };
    } catch (error: unknown) {
      // degradation-audit: reported - a failed rotation write is logged and the decision is still returned
      this.logger.warn(
        '[lane-routing] rotation state could not be written',
        errorFacts(error),
      );
      return { persisted: false };
    }
  }
}

function copyState(
  document: z.infer<typeof RotationDocumentSchema>,
): RotationState {
  return {
    version: ROTATION_DOCUMENT_VERSION,
    entries: document.entries.map((entry) => ({
      key: entry.key,
      candidateId: entry.candidateId,
    })),
  };
}

function isOutcomeTaskKind(value: string): value is OutcomeTaskKind {
  for (const kind of OUTCOME_TASK_KINDS) {
    if (kind === value) return true;
  }
  return false;
}

function errorFacts(error: unknown): LaneRoutingLogMeta {
  const facts: LaneRoutingLogMeta = {
    name: error instanceof Error ? error.name : 'UnknownError',
  };
  if (typeof error === 'object' && error !== null && 'code' in error) {
    const code = error.code;
    if (typeof code === 'string') facts['code'] = code;
  }
  return facts;
}
