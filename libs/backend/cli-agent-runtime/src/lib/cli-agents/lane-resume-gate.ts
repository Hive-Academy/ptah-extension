/**
 * Lane resume gate (TASK_2026_597, component 14, R9.1).
 *
 * A resumed lane re-sends its whole thread on the first request of the new
 * turn. Past a certain size, or once the provider's prompt cache has expired,
 * that costs more than a fresh lane handed a short brief. The gate decides
 * which, from the lane's last per-request context figure and its idle time:
 *
 * - Codex: the figure is read from the thread's rollout file
 *   (`info.last_token_usage.input_tokens` of the last `token_count`).
 * - Every other CLI, OpenCode included: the figure the manager recorded from
 *   the stream, carrying the source label it was recorded with. Until an
 *   adapter reports a per-request figure, that label is `estimate`.
 *
 * The decision is always logged with its source, through the output channel.
 * The gate does no I/O of its own beyond the rollout read.
 */

import type {
  CliOutputSegment,
  CliType,
  LaneRequestContext,
  LaneRequestContextSource,
} from '@ptah-extension/shared';
import type { IOutputChannel } from '@ptah-extension/platform-core';
import {
  readCodexRolloutUsage,
  type CodexRolloutUsage,
} from './cli-adapters/codex/codex-rollout-usage.reader';

/** A lane whose last request was larger than this starts fresh. */
export const RESUME_GATE_MAX_CONTEXT_TOKENS = 60_000;

/** A lane idle for longer than this starts fresh (the prompt cache is cold). */
export const RESUME_GATE_MAX_IDLE_MS = 600_000;

/** How much of the previous lane's final text a handoff carries. */
export const HANDOFF_FINAL_TEXT_MAX_CHARS = 2_000;

const LOG_PREFIX = '[LaneResumeGate]';

export interface LaneResumeGateInput {
  readonly cli: CliType;
  /** The CLI-native session (Codex thread id) the caller asked to resume. */
  readonly cliSessionId: string;
  /** Epoch milliseconds of the lane's last activity, when this host knows it. */
  readonly lastActivityAt?: number;
  /** The figure recorded from the lane's stream, when there is one. */
  readonly lastRequestContext?: LaneRequestContext;
}

export interface LaneResumeDecision {
  readonly decision: 'resume' | 'fresh';
  readonly reason: string;
  /** The context figure the decision used; `null` when none was known. */
  readonly contextTokens: number | null;
  readonly source: LaneRequestContextSource;
  /** Milliseconds since the lane's last activity; `null` when unknown. */
  readonly idleMs: number | null;
}

/** The rollout read, as a seam a spec can replace. */
export type CodexRolloutUsageReader = (
  threadId: string,
) => Promise<CodexRolloutUsage | null>;

/**
 * Not decorated for tsyringe: the reader and the clock are constructor seams
 * for specs. `register.ts` builds it with a factory that passes the output
 * channel.
 */
export class LaneResumeGate {
  constructor(
    private readonly output: IOutputChannel,
    private readonly readRolloutUsage: CodexRolloutUsageReader = (threadId) =>
      readCodexRolloutUsage(threadId),
    private readonly now: () => number = Date.now,
  ) {}

  async evaluate(input: LaneResumeGateInput): Promise<LaneResumeDecision> {
    const figure = await this.contextFigure(input);
    const lastActivityAt = input.lastActivityAt ?? figure.modifiedAtMs;
    const idleMs =
      lastActivityAt === undefined
        ? null
        : Math.max(0, this.now() - lastActivityAt);

    const decision = decide(figure.tokens, idleMs);
    const result: LaneResumeDecision = {
      ...decision,
      contextTokens: figure.tokens,
      source: figure.source,
      idleMs,
    };
    this.output.appendLine(
      `${LOG_PREFIX} ${result.decision}: ${input.cli} session ${input.cliSessionId} — ` +
        `${result.reason} (context ${result.contextTokens ?? 'unknown'} tokens, ` +
        `source: ${result.source}, idle ${idleMs === null ? 'unknown' : `${Math.round(idleMs / 1000)}s`}` +
        `${figure.note ? `; ${figure.note}` : ''})`,
    );
    return result;
  }

  private async contextFigure(input: LaneResumeGateInput): Promise<{
    tokens: number | null;
    source: LaneRequestContextSource;
    modifiedAtMs?: number;
    note?: string;
  }> {
    const streamed = {
      tokens: input.lastRequestContext?.tokens ?? null,
      source: input.lastRequestContext?.source ?? ('estimate' as const),
    };
    if (input.cli !== 'codex') return streamed;

    try {
      const usage = await this.readRolloutUsage(input.cliSessionId);
      if (usage === null) {
        return { ...streamed, source: 'estimate', note: 'no rollout figure' };
      }
      return {
        tokens: usage.lastRequestInputTokens,
        source: 'rollout',
        modifiedAtMs: usage.modifiedAtMs,
      };
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      return {
        ...streamed,
        source: 'estimate',
        note: `rollout unreadable: ${message}`,
      };
    }
  }
}

function decide(
  contextTokens: number | null,
  idleMs: number | null,
): Pick<LaneResumeDecision, 'decision' | 'reason'> {
  if (
    contextTokens !== null &&
    contextTokens > RESUME_GATE_MAX_CONTEXT_TOKENS
  ) {
    return {
      decision: 'fresh',
      reason: `last request ${contextTokens} tokens exceeds ${RESUME_GATE_MAX_CONTEXT_TOKENS}`,
    };
  }
  if (idleMs !== null && idleMs > RESUME_GATE_MAX_IDLE_MS) {
    return {
      decision: 'fresh',
      reason: `idle ${Math.ceil(idleMs / 1000)}s exceeds ${RESUME_GATE_MAX_IDLE_MS / 1000}s`,
    };
  }
  return { decision: 'resume', reason: 'within the context and idle limits' };
}

/** What a handoff carries over from the previous lane's segments. */
export interface LaneHandoffCarryOver {
  /** The tail of the previous lane's text output. */
  readonly finalText: string;
  /** Paths from `file-change` segments, first-seen order, no repeats. */
  readonly changedFiles: readonly string[];
}

/** Collect the handoff fields from accumulated segments. No git process. */
export function collectHandoffCarryOver(
  segments: readonly CliOutputSegment[],
): LaneHandoffCarryOver {
  const changed = new Set<string>();
  let text = '';
  for (const segment of segments) {
    if (segment.type === 'file-change' && segment.content.trim() !== '') {
      changed.add(segment.content.trim());
    } else if (segment.type === 'text') {
      text += segment.content;
    }
  }
  return {
    finalText: text.trim().slice(-HANDOFF_FINAL_TEXT_MAX_CHARS),
    changedFiles: [...changed],
  };
}

export interface LaneHandoffInput extends LaneHandoffCarryOver {
  /** The message the caller wanted delivered to the resumed lane. */
  readonly message: string;
  /** Why the gate chose a fresh lane. */
  readonly reason: string;
  /** False when this host holds no record of the session asked to resume. */
  readonly sessionKnown: boolean;
  /** The previous lane's task, when this host still holds its record. */
  readonly originalTask?: string;
}

/**
 * The task a fresh lane receives in place of a resume. Follows the guidance
 * already given for cold subagents (`chat-subagent-context-injector`): do not
 * resume, start fresh with a short brief of the work that remains.
 */
export function buildLaneHandoffTask(input: LaneHandoffInput): string {
  const finalText = input.finalText.slice(-HANDOFF_FINAL_TEXT_MAX_CHARS);
  const sections = [
    '[LANE HANDOFF]',
    `A previous lane worked on this task. It was not resumed (${input.reason}), ` +
      'so this is a fresh lane with a short brief of the work that remains. ' +
      'Check the current state of the files below before changing them.',
    ...(input.sessionKnown
      ? []
      : [
          'This host holds no record of the previous lane (it ran in another window or before a restart), ' +
            'so its original task, the files it changed and its final text are unknown here. ' +
            'Work from the new instruction below and inspect the repository for what was already done.',
        ]),
    '',
    'Original task:',
    input.originalTask?.trim() ||
      (input.sessionKnown
        ? '(not recorded)'
        : '(unknown: this host holds no record of the previous lane)'),
    '',
    'Files the previous lane changed:',
    input.changedFiles.length > 0
      ? input.changedFiles.map((file) => `- ${file}`).join('\n')
      : '(none recorded)',
    '',
    `The previous lane's final text (last ${HANDOFF_FINAL_TEXT_MAX_CHARS.toLocaleString('en-US')} characters):`,
    finalText || '(none recorded)',
    '[END LANE HANDOFF]',
    '',
    'New instruction:',
    input.message,
  ];
  return sections.join('\n');
}
