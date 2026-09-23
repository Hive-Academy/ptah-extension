import type { StreamingState } from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  ExecutionChatMessage,
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  SdkTerminalReason,
} from '@ptah-extension/shared';
import { generateAgentColor } from '../../utils/agent-color.utils';

export type CompactSummaryStatusTone =
  'idle' | 'live' | 'success' | 'warning' | 'error';

export type CompactSemanticMarkKind =
  'tool' | 'agent' | 'prose' | 'prompt' | 'compaction' | 'terminal';

export interface CompactSemanticMark {
  readonly id: string;
  readonly kind: CompactSemanticMarkKind;
  readonly tone: CompactSummaryStatusTone;
  readonly label: string;
  /** Event time (ms since epoch), used to order and time-stamp the feed row. */
  readonly timestamp: number;
  /**
   * The detail behind `label` (e.g. `Exit code 1: 3 test suites failed`, a
   * compaction token delta). Already path-redacted by the item builders.
   * Undefined when a mark has no extra detail beyond its label.
   */
  readonly text?: string;
}

export interface CompactSummaryContent {
  readonly kind:
    'question' | 'permission' | 'error' | 'prose' | 'result' | 'idle';
  readonly text: string;
  readonly additionalPromptCount: number;
  readonly actionable: boolean;
}

export interface CompactSummaryMetrics {
  readonly model: string | null;
  readonly tokens: number;
  readonly cost: number | null;
  readonly agentCount: number;
  readonly compactionCount: number;
}

export interface CompactSessionSummary {
  readonly status: {
    readonly text: string;
    readonly icon: string;
    readonly tone: CompactSummaryStatusTone;
    readonly sessionColor: string;
    readonly workspaceLabel: string;
  };
  readonly marks: readonly CompactSemanticMark[];
  readonly content: CompactSummaryContent;
  readonly metrics: CompactSummaryMetrics;
}

export interface CompactSummaryContext {
  readonly sessionIdentity: string;
  readonly workspacePath: string;
  readonly workspaceLabel: string;
  readonly sessionStatus: string;
  readonly terminalReason?: SdkTerminalReason | null;
  readonly questions?: readonly AskUserQuestionRequest[];
  readonly permissions?: readonly PermissionRequest[];
  readonly compaction?: {
    readonly inFlight: boolean;
    readonly summary?: string | null;
    readonly preTokens?: number | null;
    readonly postTokens?: number | null;
  } | null;
  readonly metrics?: Partial<CompactSummaryMetrics>;
}

interface SemanticItem {
  readonly id: string;
  readonly kind: CompactSemanticMarkKind;
  readonly tone: CompactSummaryStatusTone;
  readonly label: string;
  readonly text?: string;
  readonly timestamp: number;
  readonly contentKind?: 'error' | 'prose' | 'result';
}

const MAX_MARKS = 24;
const MAX_ITEMS = 48;

export function summarizeLive(
  streamingState: StreamingState | null,
  context: CompactSummaryContext,
): CompactSessionSummary {
  const items = streamingState
    ? liveItems(streamingState, context.workspacePath)
    : [];
  return buildSummary(items, context);
}

export function summarizeFinalized(
  messages: readonly ExecutionChatMessage[],
  context: CompactSummaryContext,
): CompactSessionSummary {
  const items: SemanticItem[] = [];
  let latestTurnStart = 0;
  let terminalTime: number | undefined;
  for (const message of messages) {
    if (message.role === 'user') {
      latestTurnStart = items.length;
      terminalTime = undefined;
      continue;
    }
    if (!message.streamingState) continue;
    collectFinalizedNode(message.streamingState, items, context.workspacePath);
    terminalTime = message.streamingState.endTime;
  }
  const omitted = Math.max(0, items.length - MAX_ITEMS);
  return buildSummary(
    items.slice(omitted),
    context,
    Math.max(0, latestTurnStart - omitted),
    terminalTime,
  );
}

function liveItems(
  state: StreamingState,
  workspacePath: string,
): SemanticItem[] {
  const items = new Map<string, SemanticItem>();
  for (const event of state.events.values()) {
    const item = liveEventItem(event, state, workspacePath);
    if (item) items.set(item.id, item);
  }
  return [...items.values()]
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    .slice(-MAX_ITEMS);
}

function liveEventItem(
  event: FlatStreamEventUnion,
  state: StreamingState,
  workspacePath: string,
): SemanticItem | null {
  if (event.eventType === 'text_delta') {
    const blockId = `${event.messageId}:prose:${event.blockIndex}`;
    const accumulated =
      state.textAccumulators.get(
        `${event.messageId}-block-${event.blockIndex}`,
      ) ?? event.delta;
    return {
      id: blockId,
      kind: 'prose',
      tone: 'live',
      label: 'Assistant response',
      text: redactAbsolutePaths(accumulated, workspacePath),
      timestamp: event.timestamp,
      contentKind: 'prose',
    };
  }
  if (event.eventType === 'tool_start') {
    const detail = describeTool(event.toolName, event.toolInput, workspacePath);
    return {
      id: `tool:${event.toolCallId}`,
      kind: event.isTaskTool ? 'agent' : 'tool',
      tone: 'live',
      label: `${event.isTaskTool ? 'Agent' : 'Tool'} started: ${detail}`,
      text: detail,
      timestamp: event.timestamp,
      contentKind: 'result',
    };
  }
  if (event.eventType === 'tool_result') {
    const prior = state.events.get(event.toolCallId);
    const name = prior?.eventType === 'tool_start' ? prior.toolName : 'tool';
    const failed = event.isError;
    return {
      id: `tool:${event.toolCallId}`,
      kind: 'tool',
      tone: failed ? 'error' : 'success',
      label: `${name} ${failed ? 'failed' : 'completed'}`,
      text: redactAbsolutePaths(toText(event.output), workspacePath),
      timestamp: event.timestamp,
      contentKind: failed ? 'error' : 'result',
    };
  }
  if (event.eventType === 'agent_start') {
    const name = event.teammateName ?? event.agentType ?? 'agent';
    return {
      id: `agent:${event.agentId ?? event.toolCallId}`,
      kind: 'agent',
      tone: 'live',
      label: `Agent started: ${name}`,
      text: event.agentDescription || `Running ${name}`,
      timestamp: event.timestamp,
      contentKind: 'result',
    };
  }
  if (event.eventType === 'message_complete') {
    return {
      id: `terminal:${event.messageId}`,
      kind: 'terminal',
      tone: 'success',
      label: 'Turn completed',
      timestamp: event.timestamp,
    };
  }
  if (event.eventType === 'compaction_start') {
    return {
      id: `compaction:${event.messageId}`,
      kind: 'compaction',
      tone: 'warning',
      label: 'Context compaction started',
      timestamp: event.timestamp,
    };
  }
  if (event.eventType === 'compaction_complete') {
    return {
      id: `compaction:${event.messageId}`,
      kind: 'compaction',
      tone: 'success',
      label: 'Context compaction completed',
      timestamp: event.timestamp,
    };
  }
  return null;
}

function collectFinalizedNode(
  node: ExecutionNode,
  target: SemanticItem[],
  workspacePath: string,
): void {
  const timestamp = node.endTime ?? node.startTime ?? 0;
  if (node.type === 'agent') {
    const text = node.summaryContent || node.content || node.agentDescription;
    target.push({
      id: `agent:${node.agentId ?? node.toolCallId ?? node.id}`,
      kind: 'agent',
      tone: node.status === 'error' ? 'error' : 'success',
      label: `Agent ${node.status === 'error' ? 'failed' : 'completed'}: ${node.agentType ?? 'agent'}`,
      text: text ? redactAbsolutePaths(text, workspacePath) : undefined,
      timestamp,
      contentKind: node.status === 'error' ? 'error' : 'result',
    });
    // An agent's direct/summary text is represented by the agent item itself.
    // Children still contribute tools and nested agents, but direct text nodes
    // must not duplicate that prose.
    for (const child of node.children) {
      if (child.type !== 'text')
        collectFinalizedNode(child, target, workspacePath);
    }
    return;
  }
  if (node.type === 'text' && node.content?.trim()) {
    target.push({
      id: `prose:${node.id}`,
      kind: 'prose',
      tone: 'success',
      label: 'Assistant response',
      text: redactAbsolutePaths(node.content, workspacePath),
      timestamp,
      contentKind: 'prose',
    });
  } else if (node.type === 'tool') {
    const failed = node.status === 'error';
    const detail = describeTool(
      node.toolName ?? 'tool',
      node.toolInput,
      workspacePath,
    );
    target.push({
      id: `tool:${node.toolCallId ?? node.id}`,
      kind: 'tool',
      tone: failed ? 'error' : 'success',
      label: `${node.toolName ?? 'Tool'} ${failed ? 'failed' : 'completed'}`,
      text: failed
        ? redactAbsolutePaths(
            node.error || toText(node.toolOutput),
            workspacePath,
          )
        : detail,
      timestamp,
      contentKind: failed ? 'error' : 'result',
    });
  }
  for (const child of node.children) {
    collectFinalizedNode(child, target, workspacePath);
  }
}

// Badge error tones also cover limits and deliberate stops. Only genuine
// failures may change assistant prose into an error result.
const FAILURE_REASONS: ReadonlySet<SdkTerminalReason> = new Set([
  'prompt_too_long',
  'image_error',
  'model_error',
  'api_error',
  'malformed_tool_use_exhausted',
  'tool_deferred_unavailable',
  'structured_output_retry_exhausted',
  'turn_setup_failed',
]);

function markFailedTurn(
  items: readonly SemanticItem[],
  context: CompactSummaryContext,
  latestTurnStart: number,
  terminalTime?: number,
): readonly SemanticItem[] {
  const reason = context.terminalReason;
  const status = terminalStatus(reason);
  if (!reason || !FAILURE_REASONS.has(reason) || !status) return items;
  for (let index = items.length - 1; index >= latestTurnStart; index -= 1) {
    if (items[index].kind === 'prose') {
      return [
        ...items.slice(0, index),
        { ...items[index], tone: 'error', contentKind: 'error' },
        ...items.slice(index + 1),
      ];
    }
  }
  // Live message_complete already supplies a terminal mark. Reuse it instead
  // of adding a second row; finalized trees do not otherwise emit terminals.
  const terminalIndex = items.findIndex(
    (item, index) => index >= latestTurnStart && item.kind === 'terminal',
  );
  const existing = items[terminalIndex];
  const label = status.text;
  const terminal: SemanticItem = {
    id: existing?.id ?? 'terminal:failure',
    kind: 'terminal',
    tone: 'error',
    label,
    text: label,
    contentKind: 'error',
    timestamp:
      terminalTime ??
      existing?.timestamp ??
      Math.max(0, ...items.map((item) => item.timestamp)),
  };
  return [...items.filter((_, index) => index !== terminalIndex), terminal];
}

function buildSummary(
  items: readonly SemanticItem[],
  context: CompactSummaryContext,
  latestTurnStart = 0,
  terminalTime?: number,
): CompactSessionSummary {
  const semanticItems = markFailedTurn(
    items,
    context,
    latestTurnStart,
    terminalTime,
  );
  const questions = [...(context.questions ?? [])].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const permissions = [...(context.permissions ?? [])].sort(
    (a, b) => a.timestamp - b.timestamp,
  );
  const promptMarks: SemanticItem[] = [
    ...questions.map((question) => ({
      id: `question:${question.id}`,
      kind: 'prompt' as const,
      tone: 'warning' as const,
      label: 'Question needs an answer',
      timestamp: question.timestamp,
    })),
    ...permissions.map((permission) => ({
      id: `permission:${permission.id}`,
      kind: 'prompt' as const,
      tone: 'warning' as const,
      label: `${permission.toolName} needs permission`,
      timestamp: permission.timestamp,
    })),
  ];
  const compactionMarks: SemanticItem[] = context.compaction?.inFlight
    ? [
        {
          id: 'compaction:active',
          kind: 'compaction',
          tone: 'warning',
          label: 'Context compaction in progress',
          timestamp: Number.MAX_SAFE_INTEGER - 1,
        },
      ]
    : [];
  const marks = [...semanticItems, ...promptMarks, ...compactionMarks]
    .sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    .slice(-MAX_MARKS)
    .map(({ id, kind, tone, label, timestamp, text }) => ({
      id,
      kind,
      tone,
      label,
      timestamp,
      text,
    }));

  const content = selectContent(questions, permissions, semanticItems, context);
  const status = selectStatus(
    questions.length + permissions.length,
    semanticItems,
    context,
  );
  return {
    status: {
      ...status,
      sessionColor: generateAgentColor(context.sessionIdentity),
      workspaceLabel: context.workspaceLabel,
    },
    marks,
    content,
    metrics: {
      model: context.metrics?.model ?? null,
      tokens: context.metrics?.tokens ?? 0,
      cost: context.metrics?.cost ?? null,
      agentCount: context.metrics?.agentCount ?? countAgents(semanticItems),
      compactionCount: context.metrics?.compactionCount ?? 0,
    },
  };
}

function selectContent(
  questions: readonly AskUserQuestionRequest[],
  permissions: readonly PermissionRequest[],
  items: readonly SemanticItem[],
  context: CompactSummaryContext,
): CompactSummaryContent {
  const promptCount = questions.length + permissions.length;
  if (questions[0]) {
    return {
      kind: 'question',
      text:
        questions[0].questions[0]?.question || 'A question needs your answer.',
      additionalPromptCount: promptCount - 1,
      actionable: true,
    };
  }
  if (permissions[0]) {
    return {
      kind: 'permission',
      text:
        permissions[0].description ||
        `${permissions[0].toolName} needs permission to continue.`,
      additionalPromptCount: promptCount - 1,
      actionable: true,
    };
  }
  const error = findNewest(items, 'error');
  if (error) return contentFromItem('error', error);
  const prose = findNewest(items, 'prose');
  if (prose) return contentFromItem('prose', prose);
  const result = findNewest(items, 'result');
  if (result) return contentFromItem('result', result);
  if (context.compaction?.summary) {
    return {
      kind: 'result',
      text: context.compaction.summary,
      additionalPromptCount: 0,
      actionable: false,
    };
  }
  return {
    kind: 'idle',
    text:
      context.sessionStatus === 'fresh'
        ? 'Ready to start'
        : 'Waiting for activity',
    additionalPromptCount: 0,
    actionable: false,
  };
}

function selectStatus(
  promptCount: number,
  items: readonly SemanticItem[],
  context: CompactSummaryContext,
): Pick<CompactSessionSummary['status'], 'text' | 'icon' | 'tone'> {
  if (promptCount > 0)
    return { text: 'Needs input', icon: '!', tone: 'warning' };
  if (context.compaction?.inFlight) {
    return { text: 'Compacting', icon: '\u21BB', tone: 'warning' };
  }
  const newest = items[items.length - 1];
  if (
    context.sessionStatus === 'streaming' ||
    context.sessionStatus === 'resuming'
  ) {
    if (newest?.kind === 'agent')
      return { text: 'Running agent', icon: '\u25C6', tone: 'live' };
    if (newest?.kind === 'tool')
      return { text: 'Using tools', icon: '\u2699', tone: 'live' };
    return { text: 'Responding', icon: '\u2022', tone: 'live' };
  }
  const terminal = terminalStatus(context.terminalReason);
  if (terminal) return terminal;
  if (findNewest(items, 'error'))
    return { text: 'Failed', icon: '\u00D7', tone: 'error' };
  if (context.sessionStatus === 'fresh' || context.sessionStatus === 'draft') {
    return {
      text: context.sessionStatus === 'draft' ? 'Draft' : 'Ready',
      icon: '\u25CB',
      tone: 'idle',
    };
  }
  return { text: 'Idle', icon: '\u25CB', tone: 'idle' };
}

function terminalStatus(
  reason: SdkTerminalReason | null | undefined,
): Pick<CompactSessionSummary['status'], 'text' | 'icon' | 'tone'> | null {
  if (reason == null) return null;
  if (reason === 'completed')
    return { text: 'Finished', icon: '\u2713', tone: 'success' };
  if (reason === 'aborted_streaming' || reason === 'aborted_tools') {
    return { text: 'Stopped', icon: '\u25A0', tone: 'warning' };
  }
  if (
    reason === 'blocking_limit' ||
    reason === 'rapid_refill_breaker' ||
    reason === 'max_turns'
  ) {
    return { text: 'Limit reached', icon: '!', tone: 'error' };
  }
  return { text: 'Needs attention', icon: '!', tone: 'error' };
}

function contentFromItem(
  kind: 'error' | 'prose' | 'result',
  item: SemanticItem,
): CompactSummaryContent {
  return {
    kind,
    text: item.text?.trim() || item.label,
    additionalPromptCount: 0,
    actionable: false,
  };
}

function findNewest(
  items: readonly SemanticItem[],
  kind: 'error' | 'prose' | 'result',
): SemanticItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].contentKind === kind && items[index].text?.trim()) {
      return items[index];
    }
  }
  return undefined;
}

function countAgents(items: readonly SemanticItem[]): number {
  return new Set(
    items.filter((item) => item.kind === 'agent').map((item) => item.id),
  ).size;
}

function describeTool(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined,
  workspacePath: string,
): string {
  const verb = toolVerb(toolName);
  if (!input) return `${verb} ${toolName}`;
  const candidate =
    input['file_path'] ??
    input['path'] ??
    input['command'] ??
    input['pattern'] ??
    input['query'];
  const detail =
    typeof candidate === 'string'
      ? safePathOrText(candidate, workspacePath)
      : '';
  return detail ? `${verb} ${detail}` : `${verb} ${toolName}`;
}

function toolVerb(toolName: string): string {
  const normalized = toolName.toLowerCase();
  if (normalized === 'read') return 'Reading';
  if (normalized === 'write') return 'Writing';
  if (normalized === 'edit') return 'Editing';
  if (normalized === 'bash') return 'Running';
  if (normalized === 'grep' || normalized === 'glob') return 'Searching';
  if (normalized.includes('web')) return 'Browsing';
  return 'Running';
}

function safePathOrText(value: string, workspacePath: string): string {
  const normalized = value.replace(/\\/g, '/');
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  if (
    workspace &&
    normalized.toLowerCase().startsWith(`${workspace.toLowerCase()}/`)
  ) {
    return normalized.slice(workspace.length + 1);
  }
  if (/^(?:[a-z]:\/|\/)/i.test(normalized)) {
    return normalized.split('/').filter(Boolean).pop() ?? 'file';
  }
  return redactAbsolutePaths(value, workspacePath);
}

function redactAbsolutePaths(value: string, workspacePath: string): string {
  const workspace = workspacePath.replace(/\\/g, '/').replace(/\/$/, '');
  let result = value;
  if (workspace) {
    result = result.replaceAll(workspacePath, workspaceLabel(workspacePath));
    result = result.replaceAll(workspace, workspaceLabel(workspace));
  }
  return result
    .replace(/\b[A-Za-z]:[\\/](?:[^\s\\/"'`]+[\\/])*([^\s\\/"'`]+)/g, '$1')
    .replace(/\/(?:Users|home)\/[^\s/]+\/(?:[^\s/"'`]+\/)*([^\s/"'`]+)/g, '$1');
}

function workspaceLabel(path: string): string {
  return (
    path
      .replace(/[\\/]+$/, '')
      .split(/[\\/]/)
      .pop() ?? path
  );
}

function toText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  try {
    return JSON.stringify(value);
  } catch {
    // degradation-audit: optional-capability - a circular or otherwise
    // unserializable tool argument only costs this summary its one-line
    // excerpt; the empty string falls through to the zone's generic verb, so
    // the card still states what is running and stays inside its fixed height.
    return '';
  }
}
