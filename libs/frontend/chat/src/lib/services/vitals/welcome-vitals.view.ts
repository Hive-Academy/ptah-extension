import type { ActivityDay } from '@ptah-extension/chat-ui';
// Lazy entry: this module is reached only from the deferred welcome.
import {
  planRingCaption,
  type PlanRingData,
  type RecentWorkspaceItem,
  type StatCellState,
} from '@ptah-extension/chat-ui/vitals';
import type { RecentWorkspace } from '@ptah-extension/shared';
import type { ActivityVitals, SpendVitals } from './usage-vitals.view';
import type { VitalsLoad } from './vitals-load';

/**
 * Pure view mapping of the no-workspace welcome (`ptah-electron-welcome`):
 * recents rows, the activity grid and the vitals cells, from the
 * `WelcomeVitalsStore` loads. No Angular, no clock of its own: callers pass
 * `now` and the local `today`.
 */

const MINUTE_MS = 60_000;
const SPEND_BAR_COUNT = 7;

export const DAY_ONE_CAPTION = 'Day 1 · your activity will grow here';

const USD = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

/** A numeral cell (Agents, Skills). */
export interface CountCellView {
  readonly state: StatCellState;
  readonly text: string;
}

export interface PlanCellView {
  readonly state: StatCellState;
  readonly ring: PlanRingData | null;
  /** `null` while loading: the cell shimmers without a caption. */
  readonly caption: string | null;
}

export interface SpendCellView {
  readonly state: StatCellState;
  readonly text: string;
  readonly bars: readonly (number | null)[];
}

export interface GridView {
  readonly mode: 'history' | 'day-one';
  readonly days: readonly ActivityDay[];
  readonly today: string;
  readonly caption: string | null;
  readonly busy: boolean;
  /** Accessible name of the grid image. */
  readonly label: string;
}

/** Short age of a timestamp: "now", "5m", "3h", "2d", "3w", "4mo", "1y". */
export function ageLabel(at: number, now: number): string {
  const minutes = Math.floor(Math.max(0, now - at) / MINUTE_MS);
  if (minutes < 1) return 'now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  if (days < 30) return `${Math.floor(days / 7)}w`;
  if (days < 365) return `${Math.floor(days / 30)}mo`;
  return `${Math.floor(days / 365)}y`;
}

/** The folder that holds `path` (`D:\projects`, `/home/me`); `''` without a separator. */
export function parentPath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  if (cut < 0) return '';
  if (cut === 0) return trimmed.charAt(0);
  const parent = trimmed.slice(0, cut);
  // A drive root keeps its separator: "D:\" rather than "D:".
  return /^[A-Za-z]:$/.test(parent) ? parent + trimmed.charAt(cut) : parent;
}

/** Recents rows, newest first; none unless the list is `ready`. */
export function toRecentItems(
  load: VitalsLoad<readonly RecentWorkspace[]>,
  now: number,
): readonly RecentWorkspaceItem[] {
  if (load.status !== 'ready') return [];
  return load.value.map((workspace) => ({
    path: workspace.path,
    name: workspace.name,
    parent: parentPath(workspace.path),
    ageLabel: ageLabel(workspace.lastOpenedAt, now),
  }));
}

/** A count; a non-finite answer is shown as unavailable. */
export function toCountCell(load: VitalsLoad<number>): CountCellView {
  if (load.status !== 'ready') return { state: load.status, text: '' };
  return Number.isFinite(load.value)
    ? { state: 'ready', text: String(load.value) }
    : { state: 'error', text: '' };
}

export function toPlanCell(load: VitalsLoad<PlanRingData>): PlanCellView {
  if (load.status === 'ready') {
    return {
      state: 'ready',
      ring: load.value,
      caption: planRingCaption(load.value),
    };
  }
  return {
    state: load.status,
    ring: null,
    caption: load.status === 'loading' ? null : 'no plan window',
  };
}

/** No spend at all reads "$0.00" with flat bars; unpriced spend is "—". */
export function toSpendCell(load: VitalsLoad<SpendVitals>): SpendCellView {
  switch (load.status) {
    case 'ready': {
      const cost = load.value.totals.costUsd;
      if (cost === null) return { state: 'empty', text: '', bars: [] };
      return { state: 'ready', text: USD.format(cost), bars: load.value.days };
    }
    case 'empty':
      return {
        state: 'ready',
        text: USD.format(0),
        bars: new Array<number>(SPEND_BAR_COUNT).fill(0),
      };
    default:
      return { state: load.status, text: '', bars: [] };
  }
}

function dayOneGrid(today: string): GridView {
  return {
    mode: 'day-one',
    days: [],
    today,
    caption: DAY_ONE_CAPTION,
    busy: false,
    label: 'Activity, no sessions yet',
  };
}

function sessionsCaption(sessionCount: number | null): string {
  if (sessionCount === null) return '90 days';
  return `${sessionCount} ${sessionCount === 1 ? 'session' : 'sessions'} · 90 days`;
}

/**
 * The activity grid: the Day 1 field on a first run or with no usage, the
 * 90-day history, an empty grid while loading, or an empty grid captioned
 * as unavailable. `today` is the local day for the non-history states.
 */
export function toGridView(
  firstRun: boolean,
  load: VitalsLoad<ActivityVitals>,
  today: string,
): GridView {
  if (firstRun) return dayOneGrid(today);
  switch (load.status) {
    case 'ready': {
      const caption = sessionsCaption(load.value.sessionCount);
      return {
        mode: 'history',
        days: load.value.activity.days,
        today: load.value.activity.today,
        caption,
        busy: false,
        label: `Activity: ${caption}`,
      };
    }
    case 'empty':
      return dayOneGrid(today);
    case 'error':
      return {
        mode: 'history',
        days: [],
        today,
        caption: 'Activity unavailable',
        busy: false,
        label: 'Activity unavailable',
      };
    case 'loading':
      return {
        mode: 'history',
        days: [],
        today,
        caption: null,
        busy: true,
        label: 'Activity, loading',
      };
  }
}
