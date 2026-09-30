import type { StreamingState } from '@ptah-extension/chat-types';
import type {
  AskUserQuestionRequest,
  ExecutionChatMessage,
  ExecutionNode,
  FlatStreamEventUnion,
  PermissionRequest,
  SdkTerminalReason,
  ToolStartEvent,
} from '@ptah-extension/shared';
import { generateAgentColor } from '../../utils/agent-color.utils';
import { boundedText } from './compact-bounded-text';
import {
  describeToolTarget,
  shortenToolPath,
} from '../../utils/tool-target.utils';

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
   * The detail behind `label`. For tool marks it is the call's target (a
   * shortened path, a pattern or a command) taken from the tool input, never
   * the tool output. Already path-redacted by the item builders. Undefined
   * when a mark has no extra detail beyond its label.
   */
  readonly text?: string;
  /** The raw tool name, on `tool` marks only. */
  readonly toolName?: string;
  /** Bounded, path-redacted error excerpt, on failed tool marks only. */
  readonly excerpt?: string;
}

/**
 * How the recap renders its text: `markdown` for assistant prose and agent
 * summaries only, `snippet` for a bounded tool error in plain monospace, and
 * `plain` for everything else. Tool text is never parsed as markdown.
 */
export type CompactSummaryContentFormat = 'markdown' | 'snippet' | 'plain';

export interface CompactSummaryContent {
  readonly kind:
    'question' | 'permission' | 'error' | 'prose' | 'result' | 'idle';
  readonly text: string;
  readonly format: CompactSummaryContentFormat;
  readonly additionalPromptCount: number;
  readonly actionable: boolean;
}

export interface CompactSummaryMetrics {
  readonly model: string | null;
  /** Session token total; `null` when unavailable (never shown as 0). */
  readonly tokens: number | null;
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
  readonly format?: CompactSummaryContentFormat;
  readonly toolName?: string;
  readonly excerpt?: string;
}

const MAX_MARKS = 24;
const MAX_ITEMS = 48;
/** A tool error excerpt keeps at most this many lines... */
const EXCERPT_MAX_LINES = 8;
/** ...and at most this many characters. */
const EXCERPT_MAX_CHARS = 600;

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
      format: 'markdown',
    };
  }
  if (event.eventType === 'tool_start') {
    const target = toolTargetText(
      event.toolName,
      toolInputOf(state, event.toolCallId, event.toolInput),
      workspacePath,
    );
    if (event.isTaskTool) {
      return {
        id: `tool:${event.toolCallId}`,
        kind: 'agent',
        tone: 'live',
        label: `Agent started: ${target}`,
        text: target,
        timestamp: event.timestamp,
        contentKind: 'result',
        format: 'plain',
      };
    }
    return {
      id: `tool:${event.toolCallId}`,
      kind: 'tool',
      tone: 'live',
      label: `${event.toolName} started`,
      text: target,
      timestamp: event.timestamp,
      contentKind: 'result',
      format: 'plain',
      toolName: event.toolName,
    };
  }
  if (event.eventType === 'tool_result') {
    // The row is built from the call's input. A result's output is read only
    // for a failure, and then only as a bounded excerpt.
    const start = findToolStart(state, event.toolCallId);
    const name = start?.toolName ?? 'tool';
    const failed = event.isError;
    return {
      id: `tool:${event.toolCallId}`,
      kind: 'tool',
      tone: failed ? 'error' : 'success',
      label: `${name} ${failed ? 'failed' : 'completed'}`,
      text: toolTargetText(
        name,
        toolInputOf(state, event.toolCallId, start?.toolInput),
        workspacePath,
      ),
      timestamp: event.timestamp,
      contentKind: failed ? 'error' : 'result',
      format: 'plain',
      toolName: name,
      excerpt: failed
        ? errorExcerpt(
            boundedText(event.output, EXCERPT_MAX_CHARS),
            workspacePath,
          )
        : undefined,
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
      format: 'markdown',
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

/**
 * The `tool_start` of a call. `events` is keyed by event id, not by tool call
 * id, so the start is found through `toolCallMap` (tool call id -> event ids).
 */
function findToolStart(
  state: StreamingState,
  toolCallId: string,
): ToolStartEvent | undefined {
  for (const eventId of state.toolCallMap.get(toolCallId) ?? []) {
    const event = state.events.get(eventId);
    if (event?.eventType === 'tool_start') return event;
  }
  return undefined;
}

/**
 * A call's input. A stream-source `tool_start` carries none; the input then
 * streams into `toolInputAccumulators`, and is used once it parses.
 */
function toolInputOf(
  state: StreamingState,
  toolCallId: string,
  input: Readonly<Record<string, unknown>> | undefined,
): Readonly<Record<string, unknown>> | undefined {
  if (input && Object.keys(input).length > 0) return input;
  const raw = state.toolInputAccumulators.get(`${toolCallId}-input`);
  if (!raw) return input;
  try {
    const parsed: unknown = JSON.parse(raw);
    return parsed !== null &&
      typeof parsed === 'object' &&
      !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : input;
  } catch {
    // degradation-audit: optional-capability - input that is still streaming
    // (partial JSON) only costs the row its target until a later rebuild;
    // the row shows the tool name meanwhile.
    return input;
  }
}

function collectFinalizedNode(
  node: ExecutionNode,
  target: SemanticItem[],
  workspacePath: string,
): void {
  const timestamp = node.endTime ?? node.startTime ?? 0;
  if (node.type === 'agent') {
    // An agent's direct/summary text is represented by the agent item itself.
    // Children still contribute tools and nested agents, but direct text nodes
    // must not duplicate that prose. Children go first: the agent finished
    // after them, so a completed agent answers its children's failures.
    for (const child of node.children) {
      if (child.type !== 'text')
        collectFinalizedNode(child, target, workspacePath);
    }
    const failed = node.status === 'error';
    const text = node.summaryContent || node.content || node.agentDescription;
    target.push({
      id: `agent:${node.agentId ?? node.toolCallId ?? node.id}`,
      kind: 'agent',
      tone: failed ? 'error' : 'success',
      label: `Agent ${failed ? 'failed' : 'completed'}: ${node.agentType ?? 'agent'}`,
      text: text ? redactAbsolutePaths(text, workspacePath) : undefined,
      timestamp,
      contentKind: failed ? 'error' : 'result',
      // A failed agent's text is error text: a plain snippet, like a tool's.
      format: failed ? 'snippet' : 'markdown',
      excerpt: failed
        ? errorExcerpt(node.error || text || '', workspacePath)
        : undefined,
    });
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
      format: 'markdown',
    });
  } else if (node.type === 'tool') {
    const failed = node.status === 'error';
    const name = node.toolName ?? 'tool';
    target.push({
      id: `tool:${node.toolCallId ?? node.id}`,
      kind: 'tool',
      tone: failed ? 'error' : 'success',
      label: `${node.toolName ?? 'Tool'} ${failed ? 'failed' : 'completed'}`,
      text: toolTargetText(name, node.toolInput, workspacePath),
      timestamp,
      contentKind: failed ? 'error' : 'result',
      format: 'plain',
      toolName: name,
      excerpt: failed
        ? errorExcerpt(
            node.error || boundedText(node.toolOutput, EXCERPT_MAX_CHARS),
            workspacePath,
          )
        : undefined,
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
    format: 'plain',
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
    .map(({ id, kind, tone, label, timestamp, text, toolName, excerpt }) => ({
      id,
      kind,
      tone,
      label,
      timestamp,
      text,
      toolName,
      excerpt,
    }));

  const content = selectContent(questions, permissions, semanticItems, context);
  const status = selectStatus(
    questions.length + permissions.length,
    semanticItems,
    content,
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
      tokens: context.metrics?.tokens ?? null,
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
      format: 'plain',
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
      format: 'plain',
      additionalPromptCount: promptCount - 1,
      actionable: true,
    };
  }
  const recap = selectRecapItem(items);
  if (recap) return recap;
  const result = findNewestResult(items);
  if (result) return contentFromItem('result', result);
  if (context.compaction?.summary) {
    return {
      kind: 'result',
      text: context.compaction.summary,
      format: 'markdown',
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
    format: 'plain',
    additionalPromptCount: 0,
    actionable: false,
  };
}

/**
 * Newest-first scan for what the recap shows. The newest assistant prose
 * wins, so a tool failure the assistant already answered never replaces its
 * reply. A tool or agent failure wins only while nothing came after it: a
 * later successful or running tool or agent means the assistant moved on.
 * Either failure shows as a bounded plain snippet, never as markdown.
 */
function selectRecapItem(
  items: readonly SemanticItem[],
): CompactSummaryContent | null {
  let movedOn = false;
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index];
    const failed = item.contentKind === 'error';
    if (item.kind === 'prose' && item.text?.trim()) {
      return contentFromItem(failed ? 'error' : 'prose', item);
    }
    if (item.kind === 'terminal' && failed) {
      return contentFromItem('error', item);
    }
    if (item.kind !== 'tool' && item.kind !== 'agent') continue;
    if (!failed) {
      movedOn = true;
      continue;
    }
    if (movedOn) continue;
    return {
      kind: 'error',
      text: item.excerpt || item.label,
      format: 'snippet',
      additionalPromptCount: 0,
      actionable: false,
    };
  }
  return null;
}

function selectStatus(
  promptCount: number,
  items: readonly SemanticItem[],
  content: CompactSummaryContent,
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
  if (content.kind === 'error')
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
    format: item.format ?? 'plain',
    additionalPromptCount: 0,
    actionable: false,
  };
}

function findNewestResult(
  items: readonly SemanticItem[],
): SemanticItem | undefined {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    if (items[index].contentKind === 'result' && items[index].text?.trim()) {
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

/**
 * A tool call's target, from its input only: what the normal view's header
 * names (a Bash description before its command), uncut, path-redacted, with
 * file paths shortened for the row.
 */
function toolTargetText(
  toolName: string,
  input: Readonly<Record<string, unknown>> | undefined,
  workspacePath: string,
): string {
  const target = describeToolTarget(toolName, input);
  if (!target.text) return redactAbsolutePaths(target.short, workspacePath);
  const redacted = redactAbsolutePaths(target.text, workspacePath);
  return target.isPath ? shortenToolPath(redacted) : redacted;
}

/**
 * The first 8 lines, then the first 600 characters, of a tool error,
 * path-redacted. Taking the first 600 characters before splitting gives the
 * same prefix and keeps the split and the redaction regexes on bounded input.
 */
function errorExcerpt(value: string, workspacePath: string): string {
  const bounded = value
    .slice(0, EXCERPT_MAX_CHARS)
    .split(/\r?\n/)
    .slice(0, EXCERPT_MAX_LINES)
    .join('\n');
  return redactAbsolutePaths(bounded, workspacePath).trimEnd();
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
