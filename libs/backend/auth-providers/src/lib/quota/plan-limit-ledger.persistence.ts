/**
 * Plan-limit ledger persistence codec (TASK_2026_596, Decision 4 P6).
 *
 * Only evidence with a known reset still ahead is written: window exhaustion
 * and owner evidence. Unknown-reset evidence is never persisted, so a host
 * restart clears it. The stored blob is untrusted on the way back in: it is
 * validated per owner, so one corrupt owner is dropped without losing the
 * rest, and an owner reference must pass `parseQuotaOwnerRef` (no extra
 * fields, canonical key).
 */
import { z } from 'zod';
import { parseQuotaOwnerRef } from '@ptah-extension/agent-sdk';
import type {
  OwnerLimitEvidence,
  PlanLimitWindow,
  PlanWindowKey,
  QuotaOwnerRef,
} from '@ptah-extension/shared';
import { heldExhaustion, type OwnerState } from './plan-limit-ledger.rules';

/** `IStateStorage` key of the persisted known-reset evidence (P6). */
export const PLAN_LIMIT_LEDGER_STORAGE_KEY = 'ptah.planLimits.exhaustion.v1';

export interface PersistedLedgerOwner {
  readonly owner: QuotaOwnerRef;
  readonly windows: readonly PlanLimitWindow[];
  readonly ownerEvidence: readonly OwnerLimitEvidence[];
}

export interface PersistedLedger {
  readonly version: 1;
  readonly owners: readonly PersistedLedgerOwner[];
}

/** What a stored blob restores to at `now`. */
export interface RestoredLedger {
  /** Owners with evidence still ahead of its reset. */
  readonly owners: readonly PersistedLedgerOwner[];
  /** `false` when the blob as a whole was not a ledger payload. */
  readonly validEnvelope: boolean;
  /** Owner entries dropped as malformed. */
  readonly dropped: number;
}

const SOURCES = [
  'provider-api',
  'provider-unofficial',
  'stream-event',
  'error-derived',
  'estimated',
] as const;

const WINDOW_KINDS = [
  'five_hour',
  'weekly',
  'weekly_model',
  'monthly',
  'overage',
  'other',
] as const;

const WINDOW_KEY =
  /^(?:five_hour|weekly|monthly|overage|weekly_model:[a-z0-9._-]{1,64}|other:[^\s]{1,64})$/;

const ScopeSchema = z.string().trim().min(1).max(64);

const PersistedEvidenceSchema = z.strictObject({
  observedAt: z.number(),
  source: z.enum(SOURCES),
  resetsAt: z.number(),
  resetSource: z.enum(SOURCES).optional(),
  modelScope: ScopeSchema.optional(),
});

const PersistedWindowSchema = z.strictObject({
  key: z.custom<PlanWindowKey>(
    (value) => typeof value === 'string' && WINDOW_KEY.test(value),
  ),
  kind: z.enum(WINDOW_KINDS),
  label: z.string().trim().min(1).max(64),
  modelScope: ScopeSchema.optional(),
  exhaustion: PersistedEvidenceSchema,
  observedAt: z.number(),
});

const PersistedOwnerSchema = z.strictObject({
  owner: z.unknown(),
  windows: z.array(PersistedWindowSchema),
  ownerEvidence: z.array(PersistedEvidenceSchema),
});

const PersistedLedgerSchema = z.object({
  version: z.literal(1),
  owners: z.array(z.unknown()),
});

/** The payload to store for these owners at `now`. */
export function serializeLedger(
  states: Iterable<OwnerState>,
  now: number,
): PersistedLedger {
  const owners: PersistedLedgerOwner[] = [];
  for (const state of states) {
    const entry = persistedOwner(state, now);
    if (entry) owners.push(entry);
  }
  return { version: 1, owners };
}

/** Validate a stored blob and keep what is still ahead of its reset. */
export function restoreLedger(raw: unknown, now: number): RestoredLedger {
  const envelope = PersistedLedgerSchema.safeParse(raw);
  if (!envelope.success) {
    return { owners: [], validEnvelope: false, dropped: 0 };
  }
  const owners: PersistedLedgerOwner[] = [];
  let dropped = 0;
  for (const candidate of envelope.data.owners) {
    const parsed = PersistedOwnerSchema.safeParse(candidate);
    const owner = parsed.success
      ? parseQuotaOwnerRef(parsed.data.owner)
      : undefined;
    if (!parsed.success || !owner) {
      dropped += 1;
      continue;
    }
    const windows = parsed.data.windows.filter(
      (window) => window.exhaustion.resetsAt > now,
    );
    const ownerEvidence = parsed.data.ownerEvidence.filter(
      (evidence) => evidence.resetsAt > now,
    );
    if (windows.length > 0 || ownerEvidence.length > 0) {
      owners.push({ owner, windows, ownerEvidence });
    }
  }
  return { owners, validEnvelope: true, dropped };
}

function persistedOwner(
  state: OwnerState,
  now: number,
): PersistedLedgerOwner | undefined {
  const windows: PlanLimitWindow[] = [];
  for (const { window } of state.windows.values()) {
    const held = heldExhaustion(window, now);
    if (held?.resetsAt === undefined || held.resetsAt <= now) continue;
    windows.push({
      key: window.key,
      kind: window.kind,
      label: window.label,
      ...(window.modelScope !== undefined && { modelScope: window.modelScope }),
      exhaustion: definedFields(held),
      observedAt: window.observedAt,
    });
  }
  const ownerEvidence = [...state.ownerEvidence.values()]
    .filter(
      (evidence) => evidence.resetsAt !== undefined && evidence.resetsAt > now,
    )
    .map(definedFields);
  if (windows.length === 0 && ownerEvidence.length === 0) return undefined;
  return { owner: state.owner, windows, ownerEvidence };
}

/** Drop `undefined` members, which the strict restore schema would not expect. */
function definedFields(evidence: OwnerLimitEvidence): OwnerLimitEvidence {
  return {
    observedAt: evidence.observedAt,
    source: evidence.source,
    ...(evidence.resetsAt !== undefined && { resetsAt: evidence.resetsAt }),
    ...(evidence.resetSource !== undefined && {
      resetSource: evidence.resetSource,
    }),
    ...(evidence.modelScope !== undefined && {
      modelScope: evidence.modelScope,
    }),
  };
}
