/**
 * Pure view model of the inspector AGENTS list: one row per agent (the
 * Orchestrator included) with status, tokens and cost, and the cells of the
 * selected row's dock detail. A figure nobody reported renders `—`, never 0.
 */
import {
  AGENT_KIND_LABEL,
  agentAccessibleLabel,
  formatAgentDuration,
  formatCost,
  formatTokenCount,
  type AgentStatusWord,
} from '@ptah-extension/chat-ui';
import type { SessionAgent } from '../../../services/session-agents/session-agent-roster';
import type { TrayAgentContext } from '../../../services/session-agents/session-agent-tray';
import type { InspectorRequest } from '../../../services/session-inspector';

export const NOT_REPORTED_VALUE = '—';
export const NOT_REPORTED_TITLE = 'not reported';

const STATUS_INK: Readonly<Record<AgentStatusWord, string>> = {
  running: 'text-state-run',
  waiting: 'text-state-need',
  queued: 'text-base-content-muted',
  done: 'text-state-done',
  failed: 'text-state-err',
  stopped: 'text-base-content-muted',
};

export interface AgentDetailCell {
  readonly label: string;
  readonly value: string;
  /** Tooltip; `not reported` for an unknown value. */
  readonly title: string | null;
}

export interface AgentListRow {
  readonly key: string;
  readonly agent: SessionAgent;
  readonly name: string;
  /** Second line: the kind (`CLI lane`, `Sub-agent`) or the Orchestrator model. */
  readonly secondary: string;
  readonly secondaryTitle: string | null;
  readonly statusText: string;
  readonly statusInk: string;
  readonly tokens: string;
  readonly cost: string;
  readonly usageLabel: string;
  readonly cells: readonly AgentDetailCell[];
  readonly ariaLabel: string;
  readonly requests: readonly InspectorRequest[];
  readonly tray: TrayAgentContext | null;
  readonly hasActions: boolean;
}

/** Token figures of one agent; `partial` marks a lower bound. */
export interface AgentUsageFigures {
  readonly tokens: number | null;
  readonly tokensPartial: boolean;
  readonly cost: number | null;
  readonly costPartial: boolean;
  /** Estimated lane cost (`~$`) rather than a reported session cost. */
  readonly costEstimated: boolean;
  readonly contextText: string | null;
  readonly contextTitle: string | null;
  readonly input: number | null;
  readonly output: number | null;
}

export interface AgentRowInput {
  readonly agent: SessionAgent;
  readonly secondary: string;
  readonly secondaryTitle: string | null;
  readonly usage: AgentUsageFigures;
  readonly durationMs: number | null;
  /** Orchestrator only: transcript turns. */
  readonly turns: number | null;
  readonly requests: readonly InspectorRequest[];
  readonly tray: TrayAgentContext | null;
  readonly hasActions: boolean;
}

function finite(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function tokensText(value: number | null, partial: boolean): string | null {
  return finite(value) ? `${partial ? '≥ ' : ''}${formatTokenCount(value)}` : null;
}

function costText(usage: AgentUsageFigures): string | null {
  if (!finite(usage.cost)) return null;
  return `${usage.costPartial ? '≥ ' : ''}${usage.costEstimated ? '~' : ''}${formatCost(usage.cost)}`;
}

function cell(label: string, value: string | null, title: string | null = null): AgentDetailCell {
  return value === null
    ? { label, value: NOT_REPORTED_VALUE, title: NOT_REPORTED_TITLE }
    : { label, value, title };
}

/** `1.1M / 48.0k`; one unknown side shows `—`, both unknown is `null`. */
export function inOutText(input: number | null, output: number | null): string | null {
  if (!finite(input) && !finite(output)) return null;
  const side = (value: number | null) =>
    finite(value) ? formatTokenCount(value) : NOT_REPORTED_VALUE;
  return `${side(input)} / ${side(output)}`;
}

/**
 * One list row. The dock detail has Context and In / out, plus Turns
 * (Orchestrator) or Duration (other agents) when that figure is known.
 */
export function agentListRow(input: AgentRowInput): AgentListRow {
  const { agent, usage } = input;
  const tokens = tokensText(usage.tokens, usage.tokensPartial);
  const cost = costText(usage);
  const cells: AgentDetailCell[] = [
    cell('Context', usage.contextText, usage.contextTitle),
    cell('In / out', inOutText(usage.input, usage.output), 'Input and output tokens'),
  ];
  if (agent.kind === 'orchestrator') {
    if (input.turns !== null) cells.push(cell('Turns', String(input.turns)));
  } else if (input.durationMs !== null) {
    const duration = formatAgentDuration(input.durationMs);
    if (duration) cells.push(cell('Duration', duration));
  }
  const usageLabel = `${tokens === null ? 'Tokens not reported' : `${tokens} tokens`}; ${
    cost === null ? 'Cost not reported' : `cost ${cost}`
  }`;
  const label = agentAccessibleLabel({
    name: agent.name,
    kind: agent.kind,
    status: agent.status,
    durationMs: input.durationMs,
  });
  return {
    key: agent.key,
    agent,
    name: agent.name,
    secondary: input.secondary,
    secondaryTitle: input.secondaryTitle,
    statusText: agent.status ?? NOT_REPORTED_VALUE,
    statusInk: agent.status ? STATUS_INK[agent.status] : 'text-base-content-muted',
    tokens: tokens ?? NOT_REPORTED_VALUE,
    cost: cost ?? NOT_REPORTED_VALUE,
    usageLabel,
    cells,
    ariaLabel: `${label}. ${usageLabel}`,
    requests: input.requests,
    tray: input.tray,
    hasActions: input.hasActions,
  };
}

/** The kind label shown on the second line of a non-Orchestrator row. */
export function agentKindLine(agent: SessionAgent): string {
  return AGENT_KIND_LABEL[agent.kind];
}

function isLive(row: AgentListRow): boolean {
  const status = row.agent.status;
  return (
    row.requests.length > 0 ||
    status === 'running' ||
    status === 'waiting' ||
    status === 'queued'
  );
}

/**
 * Running (and waiting / queued / asking) agents first, then the
 * Orchestrator, then the rest. Lane rows keep the store's recency order.
 */
export function orderAgentList(
  orchestrator: AgentListRow | null,
  lanes: readonly AgentListRow[],
): AgentListRow[] {
  const live = lanes.filter(isLive);
  const rest = lanes.filter((row) => !isLive(row));
  return [...live, ...(orchestrator ? [orchestrator] : []), ...rest];
}

/**
 * The roster key of a host selection: a sub-agent that moved to the
 * background (or back) keeps its selection; an unknown key is `orchestrator`.
 */
export function normalizeAgentKey(key: string, keys: readonly string[]): string {
  if (keys.includes(key)) return key;
  const alternate = key.startsWith('sub:')
    ? `bg:${key.slice(4)}`
    : key.startsWith('bg:')
      ? `sub:${key.slice(3)}`
      : null;
  return alternate && keys.includes(alternate) ? alternate : 'orchestrator';
}
