import { Check, CircleHelp, FileText, Info, LoaderCircle, Square, TriangleAlert, X } from 'lucide-angular';
import type { LaneEventRow } from './lane-event-row.types';

export type LaneEventTone = 'run' | 'done' | 'need' | 'err' | 'neutral';
export interface LaneEventChip {
  readonly label: string;
  readonly tone: LaneEventTone;
  readonly icon: typeof FileText;
}

export interface LaneEventStat {
  readonly label: string;
  readonly value: string;
}

export interface LaneEventMetrics {
  readonly model?: string;
  readonly usageTotals?: {
    readonly model?: string;
    readonly totalTokens?: number;
    readonly inputTokens?: number;
    readonly outputTokens?: number;
    readonly costUsd?: number;
  } | null;
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

export function deriveLaneEventPresentation(row: LaneEventRow, metrics: LaneEventMetrics | null = null): {
  readonly chips: readonly LaneEventChip[];
  readonly timeline: readonly string[];
  readonly files: readonly string[];
  readonly images: number;
  readonly stats: readonly LaneEventStat[];
  readonly summary: string;
  readonly cliLabel: string | null;
} {
  const events = row.events;
  const last = events[events.length - 1];
  const reports = events.filter(event => event.kind === 'report').length;
  const chips: LaneEventChip[] = [];
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

  const body = last.body;
  const stats: LaneEventStat[] = [];
  const duration = last.kind === 'completed' ? body.match(/^Lane .+ finished: .+? after (\d+(?:ms|s)|\d+m \d+s)\./m)?.[1] : undefined;
  if (duration) stats.push({ label: 'Duration', value: duration });
  const exitCode = last.kind === 'completed' ? body.match(/\(exit code (-?\d+)\)/)?.[1] : undefined;
  if (exitCode !== undefined) stats.push({ label: 'Exit', value: exitCode });
  const reportedCount = last.kind === 'completed' ? body.match(/^Reports sent by this lane before it ended: (\d+)\./m)?.[1] : undefined;
  if (reportedCount !== undefined) stats.push({ label: 'Reports', value: reportedCount });
  else if (reports) stats.push({ label: 'Reports', value: String(reports) });
  if (last.kind === 'completed') {
    if (/^Deliverables: none were declared at spawn/m.test(body)) {
      stats.push({ label: 'Deliverables', value: 'none declared' });
    } else {
      const lines = body.match(/^Deliverables:\r?\n((?:- [^\r\n]+(?:\r?\n|$))*)/m)?.[1]
        ?.split(/\r?\n/).filter(line => line.startsWith('- ')) ?? [];
      if (lines.length) {
        const written = lines.filter(line => !/\u2014 (?:MISSING|EMPTY)|\(NOT written by this run\)/.test(line)).length;
        stats.push({ label: 'Deliverables', value: `${written}/${lines.length} written` });
      }
    }
    if (last.verdict) stats.push({ label: 'Verdict', value: humanize(last.verdict) });
  }
  const model = metrics?.usageTotals?.model ?? metrics?.model;
  if (model) stats.push({ label: 'Model', value: model });
  const usage = metrics?.usageTotals;
  const tokens = usage?.totalTokens ?? (usage?.inputTokens !== undefined && usage.outputTokens !== undefined
    ? usage.inputTokens + usage.outputTokens : undefined);
  if (tokens !== undefined && Number.isFinite(tokens)) stats.push({ label: 'Tokens', value: tokens.toLocaleString('en-US') });
  if (usage?.costUsd !== undefined && Number.isFinite(usage.costUsd)) {
    stats.push({ label: 'Cost', value: `$${usage.costUsd.toFixed(3)}` });
  }

  const task = last.kind === 'completed' ? body.match(/^Task: (.+)$/m)?.[1] : undefined;
  const summary = task && task !== '(no task headline)' ? task :
    (last.kind === 'completed' ? '' : body.split(/\r?\n/).find(line => line.trim())?.trim() ?? '');

  return {
    chips,
    timeline,
    files: events.flatMap(event => event.files ?? []),
    images: events.reduce((count, event) => count + (event.imageCount ?? 0), 0),
    stats,
    summary,
    cliLabel: row.cli.trim().toLowerCase() === row.agent.trim().toLowerCase() ? null : row.cli,
  };
}
