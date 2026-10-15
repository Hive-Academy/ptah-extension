import type { StreamingState } from '@ptah-extension/chat-types';
import {
  isTodoWriteToolInput,
  type ExecutionChatMessage,
  type ExecutionNode,
  type TodoItem,
} from '@ptah-extension/shared';
import { toolInputOf } from './compact-session-summary-cache';

export type CompactTodoState =
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown' }
  | {
      readonly kind: 'known';
      readonly done: number;
      readonly total: number;
      readonly active: string | null;
    };

export type CompactGitState =
  | { readonly kind: 'none' }
  | { readonly kind: 'unknown'; readonly reason: 'unavailable' | 'failed' }
  | {
      readonly kind: 'known';
      readonly additions: number;
      readonly deletions: number;
      readonly partial: boolean;
    };

export function sameGitState(
  a: CompactGitState | undefined,
  b: CompactGitState | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b || a.kind !== b.kind) return false;
  if (a.kind === 'none') return true;
  if (a.kind === 'unknown')
    return b.kind === 'unknown' && a.reason === b.reason;
  return (
    b.kind === 'known' &&
    a.additions === b.additions &&
    a.deletions === b.deletions &&
    a.partial === b.partial
  );
}

export function todoTitle(todo: CompactTodoState | null): string {
  return todo?.kind === 'known'
    ? todo.active || 'Todos'
    : todo?.kind === 'unknown'
      ? 'Todos unknown'
      : 'Todos not reported by this session';
}

export function gitTitle(git: CompactGitState | null): string {
  if (git?.kind === 'known')
    return git.partial
      ? 'Some files could not be counted'
      : 'Uncommitted changes';
  if (git?.kind === 'unknown')
    return git.reason === 'failed'
      ? 'Could not read git status'
      : 'Git changes unavailable';
  return 'Git changes unknown';
}

export function parseTodoList(input: unknown): readonly TodoItem[] | null {
  if (!isTodoWriteToolInput(input)) return null;
  for (const item of input.todos) {
    if (
      typeof item !== 'object' ||
      item === null ||
      !['pending', 'in_progress', 'completed'].includes(item.status) ||
      typeof item.content !== 'string' ||
      typeof item.activeForm !== 'string'
    ) {
      return null;
    }
  }
  return input.todos;
}

function summarizeList(input: unknown): CompactTodoState {
  const todos = parseTodoList(input);
  if (todos === null) return { kind: 'unknown' };
  if (todos.length === 0) return { kind: 'none' };
  const active = todos.find((item) => item.status === 'in_progress');
  return {
    kind: 'known',
    done: todos.filter((item) => item.status === 'completed').length,
    total: todos.length,
    active: active ? active.activeForm || active.content : null,
  };
}

function latestFinalizedTodo(node: ExecutionNode): ExecutionNode | null {
  if (node.type === 'agent') return null;
  for (let i = node.children.length - 1; i >= 0; i--) {
    const found = latestFinalizedTodo(node.children[i]);
    if (found) return found;
  }
  return node.type === 'tool' && node.toolName === 'TodoWrite' ? node : null;
}

export function summarizeTodos(
  messages: readonly ExecutionChatMessage[],
  streaming: StreamingState | null,
  compactionCompletedAt = 0,
): CompactTodoState {
  const marker = streaming?.latestTodoWrite;
  if (streaming && marker) {
    let startToolInput: Readonly<Record<string, unknown>> | undefined;
    for (const event of streaming.events.values()) {
      if (
        event.eventType === 'tool_start' &&
        event.toolCallId === marker.toolCallId &&
        !event.parentToolUseId
      ) {
        startToolInput = event.toolInput;
        break;
      }
    }
    const input =
      toolInputOf(streaming, marker.toolCallId, startToolInput) ??
      marker.input;
    return summarizeList(input);
  }
  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i];
    if (message.timestamp < compactionCompletedAt) return { kind: 'unknown' };
    if (message.role !== 'assistant' || !message.streamingState) continue;
    const todo = latestFinalizedTodo(message.streamingState);
    if (todo) return summarizeList(todo.toolInput);
  }
  return { kind: 'none' };
}
