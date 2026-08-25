/**
 * The `skillSynthesis.<lane>.*` settings sub-tree.
 *
 * Structural copy of `triggers/skill-trigger-config.ts`, which is the house
 * pattern for dotted settings sub-trees in this library: a `*_KEYS` map of
 * literal dotted keys, a `*_DEFAULTS` map with the same shape, a `read*(ws)`
 * that walks `getConfiguration` key by key, and a `flatten*(partial)` that
 * turns a sparse patch back into `[key, value]` pairs for the write path.
 *
 * Reading key by key rather than fetching one object is deliberate and shared
 * with the triggers: `IWorkspaceProvider.getConfiguration` resolves each
 * dotted key through its own routing (file-based vs. VS Code settings), so a
 * whole-object read would bypass that and silently serve stale or absent data.
 *
 * ## Defaults are "inherit", and that is the existing-installs guarantee
 *
 * Every lane defaults to `provider: ''` and `model: ''`. `LaneResolverService`
 * turns that pair into `{auth: undefined, model: resolveJudgeModel(...)}` —
 * byte-identical to what `SkillJudgeService` and `SkillSynthesizerService`
 * already do today. An install that never touches these keys therefore
 * behaves exactly as it did before lanes existed.
 */
import type { IWorkspaceProvider } from '@ptah-extension/platform-core';
import {
  SKILL_LANE_IDS,
  type SkillLaneConfig,
  type SkillLaneId,
  type SkillLaneTier,
} from './lane.types';

export const SKILL_LANE_SECTION = 'ptah';

/** The eight per-lane settings fields, in key order. */
export const SKILL_LANE_FIELDS = [
  'provider',
  'model',
  'defaultTier',
  'structuredOutput',
  'toolUse',
  'timeoutMs',
  'maxInputChars',
  'maxPasses',
] as const;

export type SkillLaneField = (typeof SKILL_LANE_FIELDS)[number];

/** `skillSynthesis.<lane>` — the prefix a sparse patch flattens against. */
export const SKILL_LANE_PREFIXES: Record<SkillLaneId, string> = {
  archaeologist: 'skillSynthesis.archaeologist',
  synthesis: 'skillSynthesis.synthesis',
  judge: 'skillSynthesis.judge',
  replay: 'skillSynthesis.replay',
};

function laneKeys(id: SkillLaneId): Record<SkillLaneField, string> {
  const prefix = SKILL_LANE_PREFIXES[id];
  return {
    provider: `${prefix}.provider`,
    model: `${prefix}.model`,
    defaultTier: `${prefix}.defaultTier`,
    structuredOutput: `${prefix}.structuredOutput`,
    toolUse: `${prefix}.toolUse`,
    timeoutMs: `${prefix}.timeoutMs`,
    maxInputChars: `${prefix}.maxInputChars`,
    maxPasses: `${prefix}.maxPasses`,
  };
}

/** Every dotted lane key, four lanes × eight fields. */
export const SKILL_LANE_KEYS: Record<
  SkillLaneId,
  Record<SkillLaneField, string>
> = {
  archaeologist: laneKeys('archaeologist'),
  synthesis: laneKeys('synthesis'),
  judge: laneKeys('judge'),
  replay: laneKeys('replay'),
};

/**
 * Per-lane defaults.
 *
 * `provider` / `model` are `''` on every lane — see the header. The capability
 * numbers are NOT invented: each is anchored to the module constant it
 * replaces, then given headroom, because the old constants were sized for
 * direct Anthropic and a self-hosted or proxied endpoint is routinely several
 * times slower on the same prompt.
 *
 *  - `synthesis` — `SYNTHESIS_TIMEOUT_MS = 30_000` and the `8000`-char
 *    trajectory slice (`skill-synthesizer.service.ts`). Timeout tripled;
 *    `maxInputChars` left at today's 8000 so truncation behaviour is
 *    unchanged for an install that edits nothing.
 *  - `judge` — `JUDGE_TIMEOUT_MS = 15_000` and the `3000`-char body slice
 *    (`skill-judge.service.ts`). Same treatment.
 *  - `archaeologist` — net-new in phase 2 and the only multi-pass lane, so it
 *    carries the largest budget of the four and `maxPasses: 4`.
 *  - `replay` — net-new in phase 3; a single pass over one held-out session,
 *    sized like synthesis.
 *
 * `structuredOutput: 'sdk'` and `toolUse` are optimistic defaults: the runner
 * detects an endpoint that cannot honour them and degrades ONCE, which is
 * cheaper than making every user opt in to a capability their provider has.
 */
export const SKILL_LANE_DEFAULTS: Record<SkillLaneId, SkillLaneConfig> = {
  archaeologist: {
    id: 'archaeologist',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'required',
    timeoutMs: 120_000,
    maxInputChars: 12_000,
    maxPasses: 4,
  },
  synthesis: {
    id: 'synthesis',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 90_000,
    maxInputChars: 8_000,
    maxPasses: 1,
  },
  judge: {
    id: 'judge',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 45_000,
    maxInputChars: 3_000,
    maxPasses: 1,
  },
  replay: {
    id: 'replay',
    provider: '',
    model: '',
    defaultTier: 'haiku',
    structuredOutput: 'sdk',
    toolUse: 'none',
    timeoutMs: 90_000,
    maxInputChars: 8_000,
    maxPasses: 1,
  },
};

/** The longest any single lane call may run — B1.5 feeds this to the drain's R5 assertion. */
export function maxLaneTimeoutMs(
  lanes: Record<SkillLaneId, SkillLaneConfig>,
): number {
  return Math.max(...SKILL_LANE_IDS.map((id) => lanes[id].timeoutMs));
}

function readString(
  ws: IWorkspaceProvider,
  key: string,
  fallback: string,
): string {
  const raw = ws.getConfiguration<string>(SKILL_LANE_SECTION, key, fallback);
  return typeof raw === 'string' ? raw.trim() : fallback;
}

/**
 * Read a numeric key, rejecting anything that is not a finite positive number.
 *
 * A `0` or a negative `timeoutMs` would arm an `AbortController` that fires
 * before the request leaves, so every call on that lane would fail as a
 * timeout with no way to tell it from a real one. Settings arrive from a JSON
 * file a user can hand-edit, so this is a real boundary, not defensive noise.
 */
function readPositiveNumber(
  ws: IWorkspaceProvider,
  key: string,
  fallback: number,
): number {
  const raw = ws.getConfiguration<number>(SKILL_LANE_SECTION, key, fallback);
  return typeof raw === 'number' && Number.isFinite(raw) && raw > 0
    ? raw
    : fallback;
}

function readEnum<T extends string>(
  ws: IWorkspaceProvider,
  key: string,
  members: readonly T[],
  fallback: T,
): T {
  const raw = ws.getConfiguration<string>(SKILL_LANE_SECTION, key, fallback);
  return typeof raw === 'string' && (members as readonly string[]).includes(raw)
    ? (raw as T)
    : fallback;
}

const TIERS: readonly SkillLaneTier[] = ['haiku', 'sonnet', 'opus'];
const STRUCTURED_OUTPUT_MODES = ['sdk', 'parse'] as const;
const TOOL_USE_MODES = ['required', 'none'] as const;

/** Read one lane's configuration, falling back field by field. */
export function readSkillLane(
  ws: IWorkspaceProvider,
  id: SkillLaneId,
): SkillLaneConfig {
  const keys = SKILL_LANE_KEYS[id];
  const defaults = SKILL_LANE_DEFAULTS[id];
  return {
    id,
    provider: readString(ws, keys.provider, defaults.provider),
    model: readString(ws, keys.model, defaults.model),
    defaultTier: readEnum(ws, keys.defaultTier, TIERS, defaults.defaultTier),
    structuredOutput: readEnum(
      ws,
      keys.structuredOutput,
      STRUCTURED_OUTPUT_MODES,
      defaults.structuredOutput,
    ),
    toolUse: readEnum(ws, keys.toolUse, TOOL_USE_MODES, defaults.toolUse),
    timeoutMs: readPositiveNumber(ws, keys.timeoutMs, defaults.timeoutMs),
    maxInputChars: readPositiveNumber(
      ws,
      keys.maxInputChars,
      defaults.maxInputChars,
    ),
    maxPasses: readPositiveNumber(ws, keys.maxPasses, defaults.maxPasses),
  };
}

/** Read all four lanes. */
export function readSkillLanes(
  ws: IWorkspaceProvider,
): Record<SkillLaneId, SkillLaneConfig> {
  return {
    archaeologist: readSkillLane(ws, 'archaeologist'),
    synthesis: readSkillLane(ws, 'synthesis'),
    judge: readSkillLane(ws, 'judge'),
    replay: readSkillLane(ws, 'replay'),
  };
}

/**
 * A sparse settings patch: any subset of lanes, any subset of their fields.
 *
 * Declared here rather than taken from `@ptah-extension/shared` because the
 * wire DTO does not exist yet — B1.8 adds `skillSynthesis:setLanes` and will
 * map its DTO onto this shape. `id` is excluded: a lane's identity is the key
 * it is filed under, never a writable field.
 */
export type SkillLanesPatch = Partial<
  Record<SkillLaneId, Partial<Omit<SkillLaneConfig, 'id'>>>
>;

/**
 * Flatten a sparse patch into `[dottedKey, value]` pairs for the write path.
 *
 * `undefined` values are skipped rather than written, so a caller that sends
 * `{judge: {model: undefined}}` leaves the persisted model alone instead of
 * blanking it — the same contract `flattenSkillTriggers` has. Unknown lane ids
 * and unknown fields are dropped rather than persisted under a key nothing
 * reads.
 */
export function flattenSkillLanes(
  input: SkillLanesPatch,
): Array<[string, unknown]> {
  const out: Array<[string, unknown]> = [];
  for (const id of SKILL_LANE_IDS) {
    const lane = input[id];
    if (!lane) continue;
    const keys = SKILL_LANE_KEYS[id];
    for (const field of SKILL_LANE_FIELDS) {
      const value = (lane as Record<string, unknown>)[field];
      if (value === undefined) continue;
      out.push([keys[field], value]);
    }
  }
  return out;
}
