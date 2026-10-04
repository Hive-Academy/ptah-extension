import type { ExecutionChatMessage, ExecutionNode } from '../types/execution';
import type { TurnChangeSet } from '../types/rpc/rpc-change-set.types';

import {
  collectTurnTests,
  summarizeTurnTests,
  type TurnTestRun,
  type TurnTestSummary,
} from './turn-tests.utils';
import { classifyTestCommand } from './test-command-matcher';

export type TurnSourceUnavailable =
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'pending' };

export interface TurnUsageSource {
  readonly input: number;
  readonly output: number;
  readonly cost: number;
  readonly durationMs: number;
}

export interface TurnTestsSource {
  readonly runs: readonly TurnTestRun[];
  readonly summary: TurnTestSummary;
}

export type TurnDiffSource =
  | { readonly kind: 'available'; readonly changeSet: TurnChangeSet }
  | TurnSourceUnavailable;

export type TurnTestsSnapshotSource =
  | ({ readonly kind: 'available' } & TurnTestsSource)
  | TurnSourceUnavailable;

export type TurnUsageSnapshotSource =
  | ({ readonly kind: 'available' } & TurnUsageSource)
  | TurnSourceUnavailable;

export interface TurnSourceSnapshot {
  readonly state: 'pending' | 'terminal';
  readonly incomplete: boolean;
  readonly diff: TurnDiffSource;
  readonly tests: TurnTestsSnapshotSource;
  readonly usage: TurnUsageSnapshotSource;
}

export interface BuildTurnSourceSnapshotInput {
  readonly turnMessages: readonly ExecutionChatMessage[];
  readonly blockMessage: ExecutionChatMessage;
  readonly changeSet: TurnChangeSet | null | 'pending';
  readonly finalized: boolean;
}

function hasFiniteNonNegativeValue(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function isIncomplete(messages: readonly ExecutionChatMessage[]): boolean {
  return messages.some((message) => {
    const status = message.streamingState?.status;
    return status === 'error' || status === 'interrupted' || hasNonTerminalTest(message.streamingState);
  });
}

function hasNonTerminalTest(node: ExecutionNode | null): boolean {
  if (node === null) return false;
  const command = node.toolInput !== undefined && Object.hasOwn(node.toolInput, 'command')
    ? node.toolInput['command']
    : undefined;
  if (
    node.type === 'tool' &&
    node.toolName === 'Bash' &&
    typeof command === 'string' &&
    classifyTestCommand(command) &&
    node.status !== 'complete' &&
    node.status !== 'error'
  ) {
    return true;
  }
  return node.children.some(hasNonTerminalTest);
}

function assistantRoots(messages: readonly ExecutionChatMessage[]): readonly ExecutionNode[] | null {
  const assistants = messages.filter((message) => message.role === 'assistant');
  if (assistants.length === 0 || assistants.some((message) => message.streamingState === null)) {
    return null;
  }

  return assistants.map((message) => message.streamingState as ExecutionNode);
}

function usageFor(message: ExecutionChatMessage): TurnUsageSnapshotSource {
  const input = message.tokens?.input;
  const output = message.tokens?.output;
  const cost = message.cost;
  const durationMs = message.duration;
  if (
    !hasFiniteNonNegativeValue(input) ||
    !hasFiniteNonNegativeValue(output) ||
    !hasFiniteNonNegativeValue(cost) ||
    !hasFiniteNonNegativeValue(durationMs)
  ) {
    return { kind: 'unavailable' };
  }

  return { kind: 'available', input, output, cost, durationMs };
}

/** Builds the immutable host-data view for one turn-local ptah-ui block. */
export function buildTurnSourceSnapshot(
  input: BuildTurnSourceSnapshotInput,
): TurnSourceSnapshot {
  if (!input.finalized) {
    return {
      state: 'pending',
      incomplete: false,
      diff: { kind: 'pending' },
      tests: { kind: 'pending' },
      usage: { kind: 'pending' },
    };
  }

  const roots = assistantRoots(input.turnMessages);
  const runs = roots === null ? null : collectTurnTests(roots, { finalized: true });
  return {
    state: 'terminal',
    incomplete: isIncomplete(input.turnMessages),
    diff: input.changeSet === 'pending'
      ? { kind: 'pending' }
      : input.changeSet === null
        ? { kind: 'unavailable' }
        : { kind: 'available', changeSet: input.changeSet },
    tests: runs === null
      ? { kind: 'unavailable' }
      : { kind: 'available', runs, summary: summarizeTurnTests(runs) },
    usage: usageFor(input.blockMessage),
  };
}
