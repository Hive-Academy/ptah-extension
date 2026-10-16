import {
  agentVisibleInSession,
  type BackgroundAgentEntry,
  type MonitoredAgent,
  type SubagentRecord,
} from '@ptah-extension/chat-streaming';
import type { BackgroundAgentStripEntry } from '@ptah-extension/chat-ui';
import { laneKey } from '../../components/molecules/compact-session/compact-lane-rows';

/**
 * Per-agent action context of the background-agent tray. Carried alongside
 * each strip view-model so an action dispatches to the right store method
 * without re-deriving anything from an echoed id.
 */
export interface TrayAgentContext {
  readonly entry: BackgroundAgentStripEntry;
  /** SDK `task_id`, when known — required to stop the agent. */
  readonly taskId?: string;
  /**
   * Owning session id (the session that spawned the agent) — sourced from the
   * subagent record's `parentSessionId` or the background entry's `sessionId`,
   * NOT the focused tab. Every steer / stop / background RPC targets this.
   */
  readonly sessionId?: string;
  /**
   * SDK short-hex agent id, when known. Required (with `sessionId`) to open the
   * on-demand transcript viewer via `subagent:transcript`.
   */
  readonly agentId?: string;
  /** Latest model the agent's subagent record named; `null` when unknown. */
  readonly model: string | null;
}

/** What the inspector AGENTS section adds to one roster row. */
export interface AgentRowExtras {
  /** Tray context; actions, steer and Focus exist only when present. */
  readonly tray: TrayAgentContext | null;
  /** Raw model id; display via `resolveModelDisplayName`. */
  readonly model: string | null;
  /** Tray entry `totalTokens`; `null` when unknown. */
  readonly tokens: number | null;
}

/** Teammate names this short (e.g. `r`) identify nothing on their own. */
const MIN_MEANINGFUL_NAME_LENGTH = 3;

/**
 * Pick the row label. The agent type leads when known; the teammate name is a
 * secondary hint only when it is long enough to mean something and differs from
 * the type. Without a type, a meaningful teammate name leads, then the task
 * description, then `fallback`.
 */
export function agentLabel(
  agentType: string | undefined,
  teammateName: string | undefined,
  description: string | undefined,
  fallback: string,
): { name: string; hint?: string } {
  const type = agentType?.trim();
  const teammate = teammateName?.trim();
  const meaningfulTeammate =
    teammate && teammate.length >= MIN_MEANINGFUL_NAME_LENGTH
      ? teammate
      : undefined;
  if (type) {
    const hint =
      meaningfulTeammate &&
      meaningfulTeammate.toLowerCase() !== type.toLowerCase()
        ? meaningfulTeammate
        : undefined;
    return { name: type, hint };
  }
  return { name: meaningfulTeammate || description?.trim() || fallback };
}

/**
 * Tidy one-line status summary: the rolling/final summary, else the last tool,
 * else the task description — skipping a candidate that only repeats the name.
 */
export function agentSummary(
  name: string,
  ...candidates: (string | undefined)[]
): string | undefined {
  for (const raw of candidates) {
    const tidy = raw ? tidyAgentSummary(raw) : '';
    if (tidy && tidy !== name) return tidy;
  }
  return undefined;
}

/** Path-like token: absolute (drive, `/`, `~`, `./`) or ending in a file name. */
const PATH_TOKEN =
  /^(?:[A-Za-z]:[\\/]|[\\/]|~[\\/]|\.{1,2}[\\/])\S*$|^(?:[^\s\\/]+[\\/])+[^\s\\/]*\.[^\s\\/]+$/;

export function basename(path: string): string {
  const parts = path.split(/[\\/]/).filter(Boolean);
  return parts.length > 0 ? parts[parts.length - 1] : path;
}

/**
 * First line of an agent summary with directories stripped from paths, and the
 * SDK's `WROTE: <path>` completion reply rendered as `Wrote <basename>`.
 */
export function tidyAgentSummary(raw: string): string {
  const firstLine = raw.trim().split(/\r?\n/, 1)[0].trim();
  const wrote = /^wrote:\s*(.+)$/i.exec(firstLine);
  if (wrote) return `Wrote ${basename(wrote[1].trim())}`;
  return firstLine
    .split(/(\s+)/)
    .map((token) =>
      !token.includes('://') && PATH_TOKEN.test(token)
        ? basename(token)
        : token,
    )
    .join('');
}

/**
 * Effective strip status for a background entry. A terminal subagent record
 * overrides a background entry still marked `running` — see `fromBackground`.
 */
export function backgroundStatus(
  bgStatus: BackgroundAgentEntry['status'],
  recStatus: SubagentRecord['status'] | undefined,
): BackgroundAgentStripEntry['status'] {
  if (bgStatus === 'running') {
    switch (recStatus) {
      case 'completed':
        return 'completed';
      case 'failed':
        return 'error';
      case 'killed':
      case 'stopped':
        return 'stopped';
      default:
        return 'background';
    }
  }
  return bgStatus === 'completed'
    ? 'completed'
    : bgStatus === 'error'
      ? 'error'
      : 'stopped';
}

/** Whether the subagent is still active (running/queued), not finished. */
function isActiveSubagent(status: SubagentRecord['status']): boolean {
  return status === 'running' || status === 'pending' || status === 'paused';
}

export function fromSubagent(rec: SubagentRecord): TrayAgentContext {
  const label = agentLabel(
    rec.agentType,
    rec.teammateName,
    rec.description,
    'Subagent',
  );
  return {
    entry: {
      id: rec.parentToolUseId,
      name: label.name,
      hint: label.hint,
      agentType: rec.agentType,
      origin: 'foreground',
      description: agentSummary(
        label.name,
        rec.latestSummary,
        rec.lastToolName,
        rec.description,
      ),
      durationMs: rec.durationMs,
      totalTokens: rec.totalTokens,
      status: 'running',
      steerable: true,
      stoppable: !!rec.taskId,
      canBackground: true,
      canViewTranscript: !!rec.agentId && !!rec.parentSessionId,
    },
    taskId: rec.taskId,
    sessionId: rec.parentSessionId,
    agentId: rec.agentId,
    model: rec.usage?.model ?? null,
  };
}

/**
 * Background records win over the subagent record for identity, but they
 * carry no progress of their own. The live rolling summary arrives on
 * `agent_progress` (SDK `task_progress`), which keeps firing after an agent is
 * backgrounded and lands on the subagent record. Reading it here is what
 * makes a background row show whether the agent is working or stuck.
 *
 * Status reads the subagent record too. A background entry only leaves
 * `running` on `background_agent_completed` / `_stopped` (or the SubagentStop
 * reconciliation), while the SDK's `agent_completed` (`task_notification`)
 * lands on the subagent record — often first, and sometimes alone. Reading
 * `bg.status` only left a row showing the agent's final "WROTE: …" reply
 * beside a live background dot.
 */
export function fromBackground(
  bg: BackgroundAgentEntry,
  rec: SubagentRecord | undefined,
): TrayAgentContext {
  const taskId = rec?.taskId;
  const status = backgroundStatus(bg.status, rec?.status);
  const isRunning = status === 'background';
  const agentType =
    bg.agentType && bg.agentType !== 'unknown' ? bg.agentType : rec?.agentType;
  const label = agentLabel(
    agentType,
    bg.teammateName ?? rec?.teammateName,
    bg.agentDescription ?? rec?.description,
    'Agent',
  );
  return {
    entry: {
      id: bg.toolCallId,
      name: label.name,
      hint: label.hint,
      agentType,
      origin: 'background',
      description: agentSummary(
        label.name,
        rec?.latestSummary,
        rec?.lastToolName,
        bg.agentDescription,
      ),
      durationMs: rec?.durationMs ?? bg.duration,
      totalTokens: rec?.totalTokens,
      status,
      steerable: isRunning,
      stoppable: isRunning && !!taskId,
      canBackground: false,
      canViewTranscript: bg.hasRealAgentId && !!bg.sessionId,
    },
    taskId,
    sessionId: bg.sessionId,
    agentId: bg.agentId,
    model: rec?.usage?.model ?? null,
  };
}

/**
 * Tray contexts keyed by `toolCallId`. Active foreground sub-agents are
 * inserted first; background records override them so a backgrounded agent
 * renders as its authoritative background state while still carrying the
 * subagent's `taskId` (records are never evicted, so Stop keeps working after
 * an agent moves to the background).
 *
 * `scope` is the owning-session filter: `null` lists every session's agents
 * (the unscoped main-panel tray); a string keeps only agents visible from that
 * session, and an empty string (unresolved tile) claims only agents with no
 * owner — never everyone's.
 */
export function buildTrayContexts(
  subagents: ReadonlyMap<string, SubagentRecord>,
  backgroundAgents: readonly BackgroundAgentEntry[],
  scope: string | null,
): ReadonlyMap<string, TrayAgentContext> {
  const map = new Map<string, TrayAgentContext>();

  for (const rec of subagents.values()) {
    if (!isActiveSubagent(rec.status)) continue;
    if (scope !== null && !agentVisibleInSession(rec.parentSessionId, scope))
      continue;
    map.set(rec.parentToolUseId, fromSubagent(rec));
  }

  for (const bg of backgroundAgents) {
    if (scope !== null && !agentVisibleInSession(bg.sessionId, scope)) continue;
    map.set(bg.toolCallId, fromBackground(bg, subagents.get(bg.toolCallId)));
  }

  return map;
}

/**
 * The known model of EVERY roster agent, keyed by roster key, independent of
 * tray contexts: a completed foreground sub-agent (dropped by the tray) keeps
 * its model. Keys follow the roster's own split (`session-agent-roster.ts`):
 * a `background` subagent record is a `bg:` row, any other a `sub:` row; a
 * CLI lane is a `cli:` row. Keys without a known model are absent.
 */
export function agentModelsByKey(
  subagents: Iterable<SubagentRecord>,
  cliAgents: readonly MonitoredAgent[],
): ReadonlyMap<string, string> {
  const models = new Map<string, string>();
  for (const rec of subagents) {
    const model = rec.usage?.model;
    if (!model) continue;
    models.set(
      laneKey(
        rec.status === 'background' ? 'background' : 'subagent',
        rec.parentToolUseId,
      ),
      model,
    );
  }
  for (const agent of cliAgents) {
    if (agent.model) models.set(laneKey('cli', agent.agentId), agent.model);
  }
  return models;
}
