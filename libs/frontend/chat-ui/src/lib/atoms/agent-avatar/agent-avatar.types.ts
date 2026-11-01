import { formatAgentDuration } from './agent-duration';

/**
 * The one status vocabulary of an agent, shared by every avatar view (the
 * turn chips, the inspector AGENTS rows and the agent dock). `error` is never
 * a word: a failed run reads `failed`, and an agent that needs the user reads
 * `waiting`.
 */
export type AgentStatusWord =
  'running' | 'waiting' | 'done' | 'failed' | 'stopped' | 'queued';

/** The four agent kinds a session can hold; there is no other lane kind. */
export type AgentKind = 'orchestrator' | 'subagent' | 'cli' | 'background';

/** Kind badge copy, one label per kind. */
export const AGENT_KIND_LABEL: Readonly<Record<AgentKind, string>> = {
  orchestrator: 'Orchestrator',
  subagent: 'Sub-agent',
  cli: 'CLI lane',
  background: 'Background',
};

/** Avatar tile sizes in px: turn chips 24, dock 28, inspector rows 32. */
export type AgentAvatarSize = 24 | 28 | 32;

/** What an accessible agent label is built from. */
export interface AgentLabelParts {
  readonly name: string;
  readonly kind: AgentKind;
  readonly status: AgentStatusWord | null;
  readonly durationMs?: number | null;
}

/**
 * The accessible name of an agent: `{name}, {kind label}, {status} {duration}`,
 * with every absent part and its separator dropped. The kind segment is
 * omitted for the Orchestrator, whose name already is `Orchestrator`. Callers
 * append their own suffix (`. Open lane`, `. {activity}`).
 */
export function agentAccessibleLabel(agent: AgentLabelParts): string {
  const name = agent.name.trim();
  const kindLabel =
    agent.kind === 'orchestrator' ? '' : AGENT_KIND_LABEL[agent.kind];
  const duration =
    agent.durationMs === null || agent.durationMs === undefined
      ? null
      : formatAgentDuration(agent.durationMs);
  const state = [agent.status, duration]
    .filter((part): part is string => !!part)
    .join(' ');
  return [name, kindLabel, state].filter((part) => part.length > 0).join(', ');
}
