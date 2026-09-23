/** Pure lane selection and sizing, independent of Angular and the agent store. */
export interface LaneCandidate {
  readonly agentId: string;
  readonly status: string;
  readonly startedAt: number;
}

export const MIN_LANE_WIDTH = 240;
export const LANE_HANDLE_WIDTH = 6;

export function laneColumnCount(width: number, agents: number): number {
  return Math.max(0, Math.min(3, Math.floor(width / 300), agents));
}

export function defaultLaneIds(
  agents: readonly LaneCandidate[],
  count: number,
): string[] {
  return [...agents]
    .sort(
      (a, b) =>
        Number(b.status === 'running') - Number(a.status === 'running') ||
        b.startedAt - a.startedAt,
    )
    .slice(0, count)
    .map((agent) => agent.agentId);
}

export interface LaneSelection {
  readonly ids: readonly string[];
  /** Most recently shown (or explicitly picked) first. */
  readonly recent: readonly string[];
}

/** Streaming updates preserve positions; only new running work can displace idle work. */
export function reconcileLanes(
  previous: LaneSelection,
  agents: readonly LaneCandidate[],
  options: {
    capacity: number;
    fillCount: number;
    autoPick: boolean;
    newRunningIds: ReadonlySet<string>;
    dismissed: ReadonlySet<string>;
  },
): LaneSelection {
  const byId = new Map(agents.map((agent) => [agent.agentId, agent]));
  const ids = previous.ids
    .filter((id) => byId.has(id))
    .slice(0, options.capacity);
  const defaults = defaultLaneIds(agents, agents.length);
  for (const id of defaults) {
    if (ids.length >= Math.min(options.capacity, options.fillCount)) break;
    if (!ids.includes(id) && !options.dismissed.has(id)) ids.push(id);
  }
  let recent = [
    ...new Set([
      ...ids.filter((id) => !previous.ids.includes(id)),
      ...previous.recent.filter((id) => ids.includes(id)),
      ...ids,
    ]),
  ];
  if (options.autoPick && ids.length === options.capacity) {
    for (const id of defaults) {
      if (
        !options.newRunningIds.has(id) ||
        byId.get(id)?.status !== 'running' ||
        ids.includes(id)
      )
        continue;
      const oldestIdle = [...recent]
        .reverse()
        .find((shown) => byId.get(shown)?.status !== 'running');
      if (oldestIdle === undefined) break;
      ids[ids.indexOf(oldestIdle)] = id;
      recent = [id, ...recent.filter((shown) => shown !== oldestIdle)];
    }
  }
  return { ids, recent };
}

export function pickLane(
  ids: readonly string[],
  recent: readonly string[],
  id: string,
  capacity: number,
): { ids: string[]; recent: string[] } {
  if (capacity < 1) return { ids: [], recent: [] };
  const next = [...ids];
  if (!next.includes(id)) {
    if (next.length >= capacity) {
      const oldest =
        [...recent].reverse().find((key) => next.includes(key)) ?? next[0];
      next[next.indexOf(oldest)] = id;
    } else next.push(id);
  }
  return {
    ids: next,
    recent: [id, ...recent.filter((key) => key !== id && next.includes(key))],
  };
}

/** Preserve relative weights while enforcing a minimum, including after shrink. */
export function normaliseLaneFractions(
  weights: readonly number[],
  width: number,
): number[] {
  if (!weights.length) return [];
  const minimum = Math.min(
    1 / weights.length,
    MIN_LANE_WIDTH / Math.max(1, width),
  );
  const safe = weights.map((weight) =>
    Number.isFinite(weight) && weight > 0 ? weight : 1,
  );
  const result = new Array<number>(weights.length).fill(0);
  let remaining = safe.map((_, index) => index);
  let budget = 1;
  while (remaining.length) {
    const total = remaining.reduce((sum, index) => sum + safe[index], 0);
    const small = remaining.filter(
      (index) => (safe[index] / total) * budget < minimum,
    );
    if (!small.length) {
      for (const index of remaining)
        result[index] = (safe[index] / total) * budget;
      break;
    }
    for (const index of small) result[index] = minimum;
    budget -= small.length * minimum;
    remaining = remaining.filter((index) => !small.includes(index));
  }
  return result;
}

export function resizeLanePair(
  fractions: readonly number[],
  index: number,
  size: number,
  width: number,
): number[] {
  const next = normaliseLaneFractions(fractions, width);
  if (index < 0 || index + 1 >= next.length || width <= 0) return next;
  const pair = next[index] + next[index + 1];
  const min = Math.min(MIN_LANE_WIDTH / width, pair / 2);
  next[index] = Math.max(min, Math.min(size / width, pair - min));
  next[index + 1] = pair - next[index];
  return next;
}
