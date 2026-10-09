/**
 * Lane tool-call guard values (`agentOrchestration.laneToolCall*`).
 * Bounds match `invalidLaneGuard` in agent-rpc.handlers.ts: safe integers,
 * steer >= 1, stop >= 2, repeat >= 2, and stop greater than steer.
 */

export const LANE_GUARD_KEYS = [
  'laneToolCallSteerAt',
  'laneToolCallStopAt',
  'laneRepeatCallStopAt',
] as const;

export type LaneGuardKey = (typeof LANE_GUARD_KEYS)[number];

export interface LaneGuardField {
  readonly key: LaneGuardKey;
  readonly label: string;
  readonly min: number;
  readonly help: string;
  readonly testId: string;
}

export const LANE_GUARD_FIELDS: readonly LaneGuardField[] = [
  {
    key: 'laneToolCallSteerAt',
    label: 'Steer at (tool calls)',
    min: 1,
    testId: 'lane-guards-steer',
    help: 'At this many tool calls the lane is asked to wrap up. Some CLIs, for example grok and Ptah CLI providers, cannot receive the mid-turn steer, so they run until the stop value.',
  },
  {
    key: 'laneToolCallStopAt',
    label: 'Stop at (tool calls)',
    min: 2,
    testId: 'lane-guards-stop',
    help: 'At this many tool calls the lane is stopped. Stop at must be greater than Steer at.',
  },
  {
    key: 'laneRepeatCallStopAt',
    label: 'Repeat-call stop at',
    min: 2,
    testId: 'lane-guards-repeat',
    help: 'Stops a lane that repeats the same tool call this many times.',
  },
];

/** Defaults from `FILE_BASED_SETTINGS_DEFAULTS` / `LANE_GUARD_DEFAULTS`. */
export const LANE_GUARD_DEFAULTS: Readonly<Record<LaneGuardKey, number>> = {
  laneToolCallSteerAt: 40,
  laneToolCallStopAt: 60,
  laneRepeatCallStopAt: 20,
};

export type LaneGuardValues = Record<LaneGuardKey, number>;

export type LaneGuardParse =
  | { readonly ok: true; readonly value: number }
  | { readonly ok: false; readonly error: string };

const PAIR_ERROR = 'Stop at must be greater than Steer at.';

export function parseLaneGuardInteger(
  raw: string,
  min: number,
): LaneGuardParse {
  const text = raw.trim().replace(/[,_\s]/g, '');
  if (text === '') return { ok: false, error: 'Enter a value.' };
  if (!/^\d+$/.test(text)) return { ok: false, error: 'Enter a whole number.' };
  const value = Number(text);
  if (!Number.isSafeInteger(value) || value < min) {
    return { ok: false, error: `Enter a whole number from ${min}.` };
  }
  return { ok: true, value };
}

/** Stop must exceed steer. Null when the pair is allowed. */
export function laneGuardPairError(steer: number, stop: number): string | null {
  return stop > steer ? null : PAIR_ERROR;
}

export function laneGuardFieldError(
  key: LaneGuardKey,
  drafts: Readonly<Record<LaneGuardKey, string>>,
): string | null {
  const field = LANE_GUARD_FIELDS.find((item) => item.key === key);
  if (!field) return 'Enter a value.';
  const parsed = parseLaneGuardInteger(drafts[key], field.min);
  if (!parsed.ok) return parsed.error;
  if (key === 'laneRepeatCallStopAt') return null;
  const steer = parseLaneGuardInteger(drafts.laneToolCallSteerAt, 1);
  const stop = parseLaneGuardInteger(drafts.laneToolCallStopAt, 2);
  if (!steer.ok || !stop.ok) return null;
  return laneGuardPairError(steer.value, stop.value);
}

/**
 * Values to send for one commit. A steer/stop edit includes the other side
 * when its draft is a valid change, so one `agent:setConfig` keeps stop
 * greater than steer. An invalid draft is left out; the caller still refuses
 * the commit when the field being edited is itself invalid.
 */
export function laneGuardWrite(
  key: LaneGuardKey,
  drafts: Readonly<Record<LaneGuardKey, string>>,
  saved: LaneGuardValues,
): Partial<LaneGuardValues> | null {
  if (laneGuardFieldError(key, drafts)) return null;
  if (key === 'laneRepeatCallStopAt') {
    const parsed = parseLaneGuardInteger(drafts[key], 2);
    if (!parsed.ok || parsed.value === saved[key]) return null;
    return { laneRepeatCallStopAt: parsed.value };
  }
  const steerField = parseLaneGuardInteger(drafts.laneToolCallSteerAt, 1);
  const stopField = parseLaneGuardInteger(drafts.laneToolCallStopAt, 2);
  const steer = steerField.ok ? steerField.value : saved.laneToolCallSteerAt;
  const stop = stopField.ok ? stopField.value : saved.laneToolCallStopAt;
  if (laneGuardPairError(steer, stop)) return null;
  const payload: Partial<LaneGuardValues> = {};
  if (steerField.ok && steerField.value !== saved.laneToolCallSteerAt) {
    payload.laneToolCallSteerAt = steerField.value;
  }
  if (stopField.ok && stopField.value !== saved.laneToolCallStopAt) {
    payload.laneToolCallStopAt = stopField.value;
  }
  return Object.keys(payload).length === 0 ? null : payload;
}

/** Read a host config value, or the default when it is missing or out of range. */
export function laneGuardFromConfig(key: LaneGuardKey, value: unknown): number {
  const min = LANE_GUARD_FIELDS.find((field) => field.key === key)?.min ?? 1;
  return typeof value === 'number' &&
    Number.isSafeInteger(value) &&
    value >= min
    ? value
    : LANE_GUARD_DEFAULTS[key];
}

/** Which field a host rejection names, when the message includes the key. */
export function laneGuardKeyInError(error: string): LaneGuardKey | null {
  for (const key of LANE_GUARD_KEYS) {
    if (error.includes(key)) return key;
  }
  return null;
}
