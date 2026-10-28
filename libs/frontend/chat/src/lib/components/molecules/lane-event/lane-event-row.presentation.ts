import { Check, CircleHelp, FileText, Info, LoaderCircle, Square, TriangleAlert, X } from 'lucide-angular';
import type { LaneEventRow } from './lane-event-row.types';

export type LaneEventTone = 'run' | 'done' | 'need' | 'err' | 'neutral';
export interface LaneEventChip {
  readonly label: string;
  readonly tone: LaneEventTone;
  readonly icon: typeof FileText;
}

export function laneEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

function humanize(value: string): string {
  const text = value.replace(/-/g, ' ');
  return text.charAt(0).toUpperCase() + text.slice(1);
}

const verdictChips: Readonly<Record<string, LaneEventChip>> = {
  delivered: { label: 'Completed', tone: 'done', icon: Check },
  'no-deliverable': { label: 'No deliverable', tone: 'need', icon: TriangleAlert },
  unverified: { label: 'Completed, unverified', tone: 'need', icon: CircleHelp },
  failed: { label: 'Failed', tone: 'err', icon: X },
};

export function deriveLaneEventPresentation(row: LaneEventRow): {
  readonly chips: readonly LaneEventChip[];
  readonly timeline: readonly string[];
  readonly files: readonly string[];
  readonly images: number;
} {
  const events = row.events;
  const last = events[events.length - 1];
  const reports = events.filter(event => event.kind === 'report').length;
  const chips: LaneEventChip[] = [];
  if (reports) chips.push({ label: reports === 1 ? 'Report' : `Report x${reports}`, tone: 'run', icon: FileText });

  if (last.kind === 'completed') {
    const verdict = last.verdict?.toLowerCase();
    const status = last.status?.toLowerCase();
    if (verdict === 'failed' || ['failed', 'error', 'timeout'].includes(status ?? '')) chips.push(verdictChips['failed']);
    else if (['stopped', 'killed', 'cancelled'].includes(status ?? '')) chips.push({ label: 'Stopped', tone: 'neutral', icon: Square });
    else if (verdict) chips.push(verdictChips[verdict] ?? { label: humanize(verdict), tone: 'neutral', icon: Info });
    else chips.push(verdictChips['unverified']);
  } else if (row.liveLane) chips.push({ label: 'Running', tone: 'run', icon: LoaderCircle });

  const completion = events.filter(event => event.kind === 'completed').at(-1);
  const visible = completion
    ? [...events.filter(event => event.kind === 'report').slice(-3), completion]
    : events.slice(row.liveLane ? -3 : -4);
  const timeline: string[] = [];
  const earlier = row.earlier.at(-1);
  if (earlier) timeline.push(`Earlier report ${laneEventTime(earlier.timestamp)}`);
  if (events.length > visible.length) timeline.push(`+${events.length - visible.length} earlier`);
  for (const event of visible) timeline.push(`${event.kind === 'report' ? 'Report' : 'Completed'} ${laneEventTime(event.timestamp)}`);
  if (last.kind !== 'completed' && row.liveLane) timeline.push('Completion pending');

  return {
    chips,
    timeline,
    files: events.flatMap(event => event.files ?? []),
    images: events.reduce((count, event) => count + (event.imageCount ?? 0), 0),
  };
}
