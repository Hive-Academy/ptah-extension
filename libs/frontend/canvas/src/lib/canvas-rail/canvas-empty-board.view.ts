import type { ActivityDay, StatCellState } from '@ptah-extension/chat-ui';
import {
  formatUsd,
  type ActivityVitals,
  type GitVitals,
  type VitalsLoad,
} from '@ptah-extension/chat';

/**
 * Pure view mapping of the canvas zero-sessions hero (`ptah-canvas-empty-board`,
 * design screens 02 and 02b) from the `WorkspaceVitalsStore` loads. No Angular
 * and no clock of its own: callers pass the local `today` (`localDayKey`, the
 * key the store's `activity.today` uses).
 */

export const OPEN_TODAY_CAPTION = '90 days · today is open';
export const FIRST_SESSION_CAPTION = 'Day 1 · your first session lights this up';
export const QUIET_CAPTION = 'No activity in the last 90 days';

const COMPACT = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 1,
});

export interface BoardGridView {
  readonly mode: 'history' | 'day-one';
  readonly days: readonly ActivityDay[];
  readonly today: string;
  readonly caption: string | null;
  readonly busy: boolean;
  /** Accessible name of the grid image. */
  readonly label: string;
}

/** One stacked numeral beside the grid; `label` is its caption line and name. */
export interface NumeralView {
  readonly label: 'sessions' | 'tokens' | 'spend';
  readonly state: StatCellState;
  readonly text: string;
}

export interface GitLineView {
  readonly branch: string;
  readonly changed: string;
}

/** The folder name of `path` (`ptah-extension` for `D:\projects\ptah-extension\`). */
export function workspaceName(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '');
  const cut = Math.max(trimmed.lastIndexOf('/'), trimmed.lastIndexOf('\\'));
  const name = trimmed.slice(cut + 1);
  return name === '' ? path : name;
}

/** Branch and change count; `null` (hidden) until git answered for this folder. */
export function toGitLine(load: VitalsLoad<GitVitals>): GitLineView | null {
  if (load.status !== 'ready') return null;
  const count = load.value.changedFileCount;
  return {
    branch: load.value.branch,
    changed: count === 0 ? 'no changes' : `${count} changed`,
  };
}

/**
 * The workspace grid: history with "today is open"; with no usage facts, the
 * Day 1 field only once the session list confirms 0 sessions (a quiet empty
 * grid when there were sessions, the loading grid while the count is
 * unknown); an empty grid while loading; or one captioned as unavailable.
 */
export function toBoardGrid(
  load: VitalsLoad<ActivityVitals>,
  previousSessions: number | null,
  today: string,
): BoardGridView {
  switch (load.status) {
    case 'ready':
      return {
        mode: 'history',
        days: load.value.activity.days,
        today: load.value.activity.today,
        caption: OPEN_TODAY_CAPTION,
        busy: false,
        label: 'Workspace activity, 90 days',
      };
    case 'empty':
      if (previousSessions === null) return loadingGrid(today);
      if (previousSessions > 0) {
        return {
          mode: 'history',
          days: [],
          today,
          caption: QUIET_CAPTION,
          busy: false,
          label: `Workspace activity: ${QUIET_CAPTION}`,
        };
      }
      return {
        mode: 'day-one',
        days: [],
        today,
        caption: FIRST_SESSION_CAPTION,
        busy: false,
        label: `Workspace activity: ${FIRST_SESSION_CAPTION}`,
      };
    case 'error':
      return {
        mode: 'history',
        days: [],
        today,
        caption: 'Activity unavailable',
        busy: false,
        label: 'Workspace activity unavailable',
      };
    case 'loading':
      return loadingGrid(today);
  }
}

function loadingGrid(today: string): BoardGridView {
  return {
    mode: 'history',
    days: [],
    today,
    caption: null,
    busy: true,
    label: 'Workspace activity, loading',
  };
}

/**
 * Sessions, tokens and spend over the grid's 90 days, or `null` when there is
 * nothing to count (no usage facts: the Day 1 field stands alone). A figure
 * the host did not provide (session count, priced spend) reads "—".
 */
export function toNumerals(
  load: VitalsLoad<ActivityVitals>,
): readonly NumeralView[] | null {
  switch (load.status) {
    case 'empty':
      return null;
    case 'ready': {
      const { sessionCount, totals } = load.value;
      return [
        sessionCount === null
          ? { label: 'sessions', state: 'empty', text: '' }
          : { label: 'sessions', state: 'ready', text: COMPACT.format(sessionCount) },
        { label: 'tokens', state: 'ready', text: COMPACT.format(totals.tokens) },
        totals.costUsd === null
          ? { label: 'spend', state: 'empty', text: '' }
          : { label: 'spend', state: 'ready', text: formatUsd(totals.costUsd) },
      ];
    }
    default:
      return (['sessions', 'tokens', 'spend'] as const).map((label) => ({
        label,
        state: load.status,
        text: '',
      }));
  }
}

/**
 * "41 previous sessions"; "Previous sessions" while the list is unconfirmed
 * (the Rail and its trigger are hidden on an empty board, so this is the way
 * in); `null` (hidden) only once the list confirms there are none.
 */
export function previousSessionsLabel(count: number | null): string | null {
  if (count === null) return 'Previous sessions';
  if (count <= 0) return null;
  return `${count} previous ${count === 1 ? 'session' : 'sessions'}`;
}
