import { Check, CircleHelp, LoaderCircle, TriangleAlert, X } from 'lucide-angular';
import type { LaneEventRow } from './lane-event-row.types';

export type LaneEventTone = 'run' | 'done' | 'need' | 'err' | 'neutral';
export interface LaneEventChip {
  readonly label: string;
  readonly tone: LaneEventTone;
  readonly icon: typeof Check;
}
export interface LaneEventStat {
  readonly label: string;
  readonly value: string;
  readonly compact: string;
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
export interface LaneDeliverableDetail {
  readonly path: string;
  readonly state: string;
  readonly written: boolean;
}
export interface LaneCompletionDetails {
  readonly status?: string;
  readonly duration?: string;
  readonly exitCode?: number;
  readonly reports?: number;
  readonly deliverables?: readonly LaneDeliverableDetail[] | null;
  readonly task?: string;
  readonly cliSessionId?: string;
  readonly extra: readonly string[];
}

export function laneEventTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true });
}

/** Parse known envelope fields while retaining unrecognized lines verbatim. */
export function parseLaneCompletion(body: string): LaneCompletionDetails {
  let status: string | undefined;
  let duration: string | undefined;
  let exitCode: number | undefined;
  let reports: number | undefined;
  let deliverables: LaneDeliverableDetail[] | null | undefined;
  let task: string | undefined;
  let cliSessionId: string | undefined;
  const extra: string[] = [];
  let inDeliverables = false;
  for (const line of body.split(/\r?\n/)) {
    if (!line.trim()) continue;
    const first = /^Lane [^\r\n]+ finished: (.+?)(?: \(exit code (-?\d+)\))? after (\d+(?:ms|s)|\d+m \d+s)\.$/.exec(line);
    if (first) {
      status = first[1];
      exitCode = first[2] === undefined ? undefined : Number(first[2]);
      duration = first[3];
      inDeliverables = false;
      continue;
    }
    if (line.startsWith('Task: ')) { task = line.slice(6); inDeliverables = false; continue; }
    if (line.startsWith('Deliverables: none were declared at spawn')) {
      deliverables = null;
      inDeliverables = false;
      continue;
    }
    if (line === 'Deliverables:') { deliverables = []; inDeliverables = true; continue; }
    if (inDeliverables && line.startsWith('- ')) {
      const file = /^- (.+) — (MISSING|EMPTY|\d+ bytes(?: \(NOT written by this run\))?)$/.exec(line);
      if (file) {
        (deliverables as LaneDeliverableDetail[]).push({
          path: file[1], state: file[2],
          written: !/^(?:MISSING|EMPTY)$|\(NOT written by this run\)/.test(file[2]),
        });
        continue;
      }
    }
    inDeliverables = false;
    const count = /^Reports sent by this lane before it ended: (\d+)\.$/.exec(line);
    if (count) { reports = Number(count[1]); continue; }
    const session = /^CLI Session ID: (.+?)(?: — pass it as resume_session_id.*)?$/.exec(line);
    if (session) { cliSessionId = session[1]; continue; }
    if (line.startsWith('Next:') ||
      line.startsWith('Read the lane output before you trust this result') ||
      line.startsWith('declare "deliverables"')) continue;
    extra.push(line);
  }
  return { status, duration, exitCode, reports, deliverables, task, cliSessionId, extra };
}

export function deriveLaneEventPresentation(row: LaneEventRow, metrics: LaneEventMetrics | null = null): {
  readonly chip: LaneEventChip;
  readonly files: readonly string[];
  readonly images: number;
  readonly stats: readonly LaneEventStat[];
  readonly summary: string;
  readonly completion: LaneCompletionDetails | null;
  readonly peerTitle: string | null;
} {
  const completed = row.events.filter(event => event.kind === 'completed').at(-1);
  const completion = completed ? parseLaneCompletion(completed.body) : null;
  const status = (completed?.status ?? completion?.status ?? '').toLowerCase();
  const verdict = (completed?.verdict ?? '').toLowerCase();
  const timedOut = status === 'timeout' || status === 'timed out';
  const failed = verdict === 'failed' || ['failed', 'error', 'stopped', 'killed', 'cancelled'].includes(status);
  const unverified = verdict === 'unverified';
  // The producer says a no-deliverable lane is NOT done (lane-completion-envelope.ts).
  const noDeliverable = verdict === 'no-deliverable';
  const chip: LaneEventChip = timedOut
    ? { label: 'Timed out', tone: 'err', icon: TriangleAlert }
    : failed ? { label: 'Failed', tone: 'err', icon: X }
    : completed && noDeliverable ? { label: 'Incomplete · no deliverable', tone: 'need', icon: TriangleAlert }
    : completed ? { label: unverified ? 'Completed · unverified' : 'Completed', tone: unverified ? 'need' : 'done', icon: unverified ? CircleHelp : Check }
    : { label: 'Running', tone: 'run', icon: LoaderCircle };

  const stats: LaneEventStat[] = [];
  if (completion?.duration) stats.push({ label: 'Duration', value: completion.duration, compact: completion.duration });
  const reportCount = completion?.reports ?? row.events.filter(event => event.kind === 'report').length;
  if (completion?.reports !== undefined || reportCount > 0) {
    stats.push({ label: 'Reports', value: String(reportCount), compact: `${reportCount} ${reportCount === 1 ? 'report' : 'reports'}` });
  }
  if (completion?.exitCode !== undefined && completion.exitCode !== 0) {
    stats.push({ label: 'Exit', value: String(completion.exitCode), compact: `exit ${completion.exitCode}` });
  }
  if (completion?.deliverables?.length) {
    const written = completion.deliverables.filter(file => file.written).length;
    const count = completion.deliverables.length;
    stats.push({ label: 'Deliverables', value: `${written}/${count} files`, compact: `${written}/${count} files` });
  }
  const model = metrics?.usageTotals?.model ?? metrics?.model;
  if (model) stats.push({ label: 'Lane total model', value: model, compact: `lane total ${model}` });
  const usage = metrics?.usageTotals;
  const tokens = usage?.totalTokens ?? (usage?.inputTokens !== undefined && usage.outputTokens !== undefined
    ? usage.inputTokens + usage.outputTokens : undefined);
  if (tokens !== undefined && Number.isFinite(tokens)) {
    stats.push({ label: 'Lane total tokens', value: tokens.toLocaleString('en-US'), compact: `lane total ${tokens.toLocaleString('en-US')} tokens` });
  }
  if (usage?.costUsd !== undefined && Number.isFinite(usage.costUsd)) {
    stats.push({ label: 'Lane total cost', value: `$${usage.costUsd.toFixed(3)}`, compact: `lane total $${usage.costUsd.toFixed(3)}` });
  }

  const report = row.events.filter(event => event.kind === 'report').at(-1);
  const reportLine = report?.body.split(/\r?\n/).find(line => line.trim())?.trim();
  const elapsed = completion?.duration ? ` ${failed || timedOut ? 'after' : 'in'} ${completion.duration}` : '';
  const exit = failed && completion?.exitCode !== undefined && completion.exitCode !== 0 ? ` (exit ${completion.exitCode})` : '';
  const summary = reportLine ?? (timedOut ? `Timed out${elapsed}` : failed ? `Failed${elapsed}${exit}` : completed ? `Finished${elapsed}` : 'Running');
  const peer = row.peerLabel.trim();
  const names = new Set([row.agent.trim().toLowerCase(), row.cli.trim().toLowerCase()]);
  const peerTitle = peer && !peer.toLowerCase().split(/\s*[·•]\s*/).every(part => names.has(part)) ? peer : null;
  return {
    chip, stats, summary, completion, peerTitle,
    files: row.events.flatMap(event => event.files ?? []),
    images: row.events.reduce((count, event) => count + (event.imageCount ?? 0), 0),
  };
}
