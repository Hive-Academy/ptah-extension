import type {
  AgentPermissionRequest,
  AskUserQuestionRequest,
  PermissionRequest,
} from '@ptah-extension/shared';
import type { SessionAgent } from '../session-agents/session-agent-roster';
import type { InspectorRequest } from './session-inspector.types';

export const ORCHESTRATOR_OWNER_KEY = 'orchestrator';
const ORCHESTRATOR_NAME = 'Orchestrator';
const QUESTION_PREVIEW_CHARS = 60;

/** One CLI lane's queued permission, with the lane that owns it. */
export interface LaneRequestEntry {
  readonly ownerKey: string;
  readonly ownerName: string;
  readonly agentId: string;
  readonly request: AgentPermissionRequest;
}

export interface InspectorRequestSources {
  /** Session permissions already targeted at the tab. */
  readonly permissions: readonly PermissionRequest[];
  /** Session questions already targeted at the tab. */
  readonly questions: readonly AskUserQuestionRequest[];
  /** Queued permissions of the session's CLI lanes. */
  readonly lanes: readonly LaneRequestEntry[];
  /** The session roster; its `openRequestIds` decide the owner. */
  readonly roster: readonly SessionAgent[];
}

/**
 * Identity of a request. Every verified source carries an id today; the
 * composite key is the typed guard for a source that does not.
 */
function requestIdentity(
  id: string | undefined,
  source: InspectorRequest['source'],
  ownerKey: string,
  kind: InspectorRequest['kind'],
  toolName: string | null,
): string {
  return id && id.length > 0
    ? id
    : `${source}:${ownerKey}:${kind}:${toolName ?? ''}`;
}

/** The full text a permission asks about: the shell command when present. */
function permissionCommand(request: PermissionRequest): string {
  const command = request.toolInput['command'];
  if (typeof command === 'string' && command.trim().length > 0) return command;
  return request.description || request.toolName;
}

function questionText(request: AskUserQuestionRequest): string {
  return request.questions
    .map((item) => item.question)
    .filter((text) => typeof text === 'string' && text.length > 0)
    .join('\n');
}

/**
 * Every open request of one session, unique by request id and FIFO by
 * timestamp (so FIFO within each owner). A lane-owned entry wins over a
 * session entry with the same id because it names its owner. A session
 * request belongs to the roster agent whose `openRequestIds` holds its id,
 * else to the Orchestrator. Pure.
 */
export function mergeInspectorRequests(
  sources: InspectorRequestSources,
): readonly InspectorRequest[] {
  const ownerById = new Map<string, SessionAgent>();
  for (const agent of sources.roster) {
    if (agent.key === ORCHESTRATOR_OWNER_KEY) continue;
    for (const id of agent.openRequestIds) ownerById.set(id, agent);
  }
  const owner = (id: string): { key: string; name: string } => {
    const agent = ownerById.get(id);
    return agent
      ? { key: agent.key, name: agent.name }
      : { key: ORCHESTRATOR_OWNER_KEY, name: ORCHESTRATOR_NAME };
  };

  const merged = new Map<string, InspectorRequest>();

  for (const entry of sources.lanes) {
    const { request } = entry;
    const toolName = request.toolName || null;
    const requestId = requestIdentity(
      request.requestId,
      'lane',
      entry.ownerKey,
      'permission',
      toolName,
    );
    if (merged.has(requestId)) continue;
    merged.set(requestId, {
      requestId,
      kind: 'permission',
      source: 'lane',
      ownerKey: entry.ownerKey,
      ownerName: entry.ownerName,
      agentId: entry.agentId,
      toolName,
      command: request.description || request.toolArgs || request.toolName,
      questionPreview: null,
      timestamp: request.timestamp,
    });
  }

  for (const request of sources.permissions) {
    const who = owner(request.id);
    const toolName = request.toolName || null;
    const requestId = requestIdentity(
      request.id,
      'session',
      who.key,
      'permission',
      toolName,
    );
    if (merged.has(requestId)) continue;
    merged.set(requestId, {
      requestId,
      kind: 'permission',
      source: 'session',
      ownerKey: who.key,
      ownerName: who.name,
      agentId: null,
      toolName,
      command: permissionCommand(request),
      questionPreview: null,
      timestamp: request.timestamp,
    });
  }

  for (const request of sources.questions) {
    const who = owner(request.id);
    const requestId = requestIdentity(
      request.id,
      'session',
      who.key,
      'question',
      request.toolName,
    );
    if (merged.has(requestId)) continue;
    const command = questionText(request);
    merged.set(requestId, {
      requestId,
      kind: 'question',
      source: 'session',
      ownerKey: who.key,
      ownerName: who.name,
      agentId: null,
      toolName: request.toolName,
      command,
      questionPreview:
        (request.questions[0]?.question ?? command).slice(
          0,
          QUESTION_PREVIEW_CHARS,
        ) || null,
      timestamp: request.timestamp,
    });
  }

  return [...merged.values()].sort(
    (a, b) =>
      a.timestamp - b.timestamp || a.requestId.localeCompare(b.requestId),
  );
}
