/**
 * Case bodies for the `ptah_session_*` tools (TASK_2026_584, plan
 * Component 7; pattern `surface-tool-handlers.ts`).
 *
 * The dispatcher turns the reply into a JSON-RPC response; this file
 * validates the arguments, calls the session namespace and maps its outcome
 * to agent-facing text. It never reads a caller from the arguments: the
 * namespace takes the caller from the MCP request context, and the strict
 * schemas reject any caller or parent key an agent adds.
 *
 * Failure mapping (plan "Failure behaviour"): a zod failure and a
 * `session-start-failed` / `worktree-failed` start are `isError` (the latter
 * with the rollback table); every other refusal is a plain-text answer with
 * its code and detail, because it is an answer the agent acts on, not a
 * fault. Every reply, error or not, ends with the caller's held completions.
 */
import type { z } from 'zod';
import type { Logger } from '@ptah-extension/vscode-core';
import type {
  SessionChildCompletionEnvelope,
  SessionChildLookupRefusal,
  SessionChildRollbackStep,
  SessionChildSendResult,
  SessionChildSnapshot,
  SessionChildStartResult,
} from '@ptah-extension/cli-agent-runtime';
import type {
  SessionNamespace,
  SessionReadOutcome,
  SessionStatusOutcome,
  SessionStopOutcome,
} from '../namespace-builders/session-namespace.builder';
import {
  SessionReadArgsSchema,
  SessionSendArgsSchema,
  SessionStartArgsSchema,
  SessionStatusArgsSchema,
  SessionStopArgsSchema,
} from './session-tool-args.schema';
import {
  SESSION_READ_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  SESSION_START_TOOL_NAME,
  SESSION_STATUS_TOOL_NAME,
  SESSION_STOP_TOOL_NAME,
  type SessionToolName,
} from './session-tools';

/** What the dispatcher needs to build a success or an `isError` result. */
export interface SessionToolReply {
  readonly isError: boolean;
  readonly text: string;
}

export const HELD_COMPLETIONS_HEADING = 'Held while this session was not live:';

/** The start refusals that are faults (with a rollback), not answers. */
const START_FAULTS: ReadonlySet<string> = new Set([
  'session-start-failed',
  'worktree-failed',
]);

/** The required keys per tool, named in a validation error. */
const REQUIRED_KEYS: Readonly<Record<SessionToolName, string>> = {
  [SESSION_START_TOOL_NAME]: 'Required: "task" and "branch".',
  [SESSION_SEND_TOOL_NAME]: 'Required: "sessionId" and "message".',
  [SESSION_STATUS_TOOL_NAME]: 'No argument is required.',
  [SESSION_READ_TOOL_NAME]: 'Required: "sessionId".',
  [SESSION_STOP_TOOL_NAME]: 'Required: "sessionId".',
};

/** Render a zod failure as one line naming each offending field. */
function describeIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('; ');
}

function argsObject(args: unknown): unknown {
  return args !== null && typeof args === 'object' ? args : {};
}

/** The held-completion block, or '' when nothing was held. */
export function renderHeldCompletions(
  envelopes: readonly SessionChildCompletionEnvelope[],
): string {
  if (envelopes.length === 0) return '';
  return `${HELD_COMPLETIONS_HEADING}\n\n${envelopes
    .map((envelope) => envelope.text)
    .join('\n\n')}`;
}

function joinBlocks(...blocks: readonly string[]): string {
  return blocks.filter((block) => block.length > 0).join('\n\n');
}

/* ---------------------------------------------------------------------------
 * Formatting
 * ------------------------------------------------------------------------- */

/** ` (detail)`, or '' when there is no detail. */
function parenthesised(detail: string | undefined): string {
  return detail ? ` (${detail})` : '';
}

function endedSuffix(child: SessionChildSnapshot): string {
  if (!child.endedAt) return '';
  return `; ended ${child.endedAt}${parenthesised(child.endReason)}`;
}

function deliveryText(
  last: NonNullable<SessionChildSnapshot['lastCompletion']>,
): string {
  if (last.delivered) return 'delivered';
  return `not delivered${parenthesised(last.refusal)}`;
}

function readStatusSuffix(available: boolean, truncated: boolean): string {
  if (!available) return '; not available.';
  return truncated ? '; the tail is shown, earlier turns are cut.' : '.';
}

function formatChild(child: SessionChildSnapshot): string {
  const lines = [
    `- ${child.label} (${child.childSessionId}): ${child.status}`,
    `  branch ${child.branch} from ${child.baseRef}; worktree ${child.worktreePath}`,
    `  started ${child.startedAt}${endedSuffix(child)}`,
    `  turns settled ${child.turnsSettled}; reports delivered ` +
      `${child.reportsDelivered}, refused ${child.reportsRefused}`,
  ];
  if (child.taskId) lines.push(`  task ${child.taskId}`);
  if (child.taskFolder) lines.push(`  task folder ${child.taskFolder}`);
  if (child.deliverables.length > 0) {
    lines.push(`  deliverables: ${child.deliverables.join(', ')}`);
  }
  if (child.pendingPermission) {
    const pending = child.pendingPermission;
    lines.push(
      `  awaiting permission: ${pending.toolName} (${pending.description}); ` +
        `denied at ${pending.deniesAt} unless the user answers in its tab`,
    );
  }
  if (child.lastCompletion) {
    const last = child.lastCompletion;
    lines.push(
      `  last completion: turn ${last.turn}, ${last.verdict}, ` +
        deliveryText(last),
    );
  }
  if (child.heldCompletion) {
    const held = child.heldCompletion;
    lines.push(
      `  held completion: turn ${held.turn}, ${held.verdict}, since ${held.heldSince}`,
    );
  }
  if (child.lastRefusedReport) {
    lines.push(`  last refused report: ${child.lastRefusedReport}`);
  }
  if (child.lastRecap) lines.push(`  last recap: ${child.lastRecap}`);
  lines.push(`  Ptah tools for its subagents: ${child.subagentPtahTools}`);
  return lines.join('\n');
}

function formatRollback(steps: readonly SessionChildRollbackStep[]): string {
  if (steps.length === 0) return 'Rollback: nothing had been created.';
  return [
    'Rollback:',
    '| Step | Result | Detail |',
    '| --- | --- | --- |',
    ...steps.map(
      (step) =>
        `| ${step.step} | ${step.ok ? 'done' : 'FAILED'} | ${step.detail ?? ''} |`,
    ),
  ].join('\n');
}

function lookupRefusal(
  tool: string,
  refusal: SessionChildLookupRefusal,
): string {
  return `${tool} refused (${refusal.reason}): ${refusal.detail}`;
}

export function sessionStartReply(
  result: SessionChildStartResult,
): SessionToolReply {
  if (result.ok) {
    if ('successor' in result) {
      return {
        isError: false,
        text: 'Successor handover accepted. The replacement will bind and focus before this session closes.',
      };
    }
    const child = result.child;
    return {
      isError: false,
      text: joinBlocks(
        `Started child session "${child.label}" (sessionId ${child.childSessionId}). ` +
          "It opened as a tab in the user's window and runs unattended.",
        formatChild(child),
        'Steer it with ptah_session_send. It reports with ptah_agent_report, ' +
          'and a completion turn arrives in this session each time it settles. ' +
          "The worktree and the branch are the user's to merge and clean up.",
      ),
    };
  }
  const head = `${SESSION_START_TOOL_NAME} refused (${result.refusal}): ${result.detail}`;
  if (START_FAULTS.has(result.refusal)) {
    return {
      isError: true,
      text: joinBlocks(head, formatRollback(result.rollback ?? [])),
    };
  }
  return { isError: false, text: head };
}

const SEND_EFFECTS: Readonly<
  Record<Extract<SessionChildSendResult, { delivered: true }>['effect'], string>
> = {
  'started-turn': 'the child was idle; the message started a turn',
  'held-until-turn-end':
    'the child is mid-turn; the message is held and starts its next turn',
  'interrupted-and-started':
    'the turn in flight was interrupted and the message started a new turn',
};

export function sessionSendReply(
  childSessionId: string,
  result: SessionChildSendResult,
): SessionToolReply {
  if (result.delivered) {
    return {
      isError: false,
      text:
        `Message delivered to ${childSessionId}: ${SEND_EFFECTS[result.effect]}.` +
        (result.code ? ` ${result.code}` : ''),
    };
  }
  return {
    isError: false,
    text:
      `Message NOT delivered to ${childSessionId} (${result.reason}): ` +
      result.detail,
  };
}

export function sessionStatusReply(
  outcome: SessionStatusOutcome,
): SessionToolReply {
  if (!outcome.ok) {
    return {
      isError: false,
      text: lookupRefusal(SESSION_STATUS_TOOL_NAME, outcome),
    };
  }
  if (outcome.children.length === 0) {
    return { isError: false, text: 'This session has no child sessions.' };
  }
  return {
    isError: false,
    text: joinBlocks(
      `Child sessions (${outcome.children.length}):`,
      outcome.children.map(formatChild).join('\n'),
    ),
  };
}

/**
 * The read reply in its two parts. The transcript goes LAST, after the held
 * completions: an over-budget answer is cut to a prefix (the tool is
 * `preformatted`), and a cut must never take a held completion with it.
 */
export function sessionReadReply(outcome: SessionReadOutcome): {
  readonly head: string;
  readonly transcript: string;
} {
  if (!outcome.ok) {
    return {
      head: lookupRefusal(SESSION_READ_TOOL_NAME, outcome),
      transcript: '',
    };
  }
  const { child, transcript, truncated, available } = outcome.result;
  return {
    head:
      `Transcript of "${child.label}" (${child.childSessionId}), ${child.status}` +
      readStatusSuffix(available, truncated),
    transcript,
  };
}

export function sessionStopReply(
  outcome: SessionStopOutcome,
): SessionToolReply {
  if (!outcome.ok) {
    return {
      isError: false,
      text: lookupRefusal(SESSION_STOP_TOOL_NAME, outcome),
    };
  }
  const child = outcome.child;
  return {
    isError: false,
    text:
      `Stopped "${child.label}" (${child.childSessionId}): ${child.status}. ` +
      `Its tab, its transcript, the worktree ${child.worktreePath} and the ` +
      `branch ${child.branch} remain; nothing was merged, pushed or removed.`,
  };
}

/* ---------------------------------------------------------------------------
 * Routing
 * ------------------------------------------------------------------------- */

/** The tool's own reply, before the held completions are added. */
type Body =
  | { readonly kind: 'reply'; readonly reply: SessionToolReply }
  | {
      readonly kind: 'read';
      readonly head: string;
      readonly transcript: string;
    };

function invalid(name: SessionToolName, error: z.ZodError): Body {
  return {
    kind: 'reply',
    reply: {
      isError: true,
      text:
        `Error: invalid ${name} arguments: ${describeIssues(error)}. ` +
        REQUIRED_KEYS[name],
    },
  };
}

async function runTool(
  name: SessionToolName,
  args: unknown,
  session: SessionNamespace,
): Promise<Body> {
  const input = argsObject(args);
  switch (name) {
    case SESSION_START_TOOL_NAME: {
      const parsed = SessionStartArgsSchema.safeParse(input);
      if (!parsed.success) return invalid(name, parsed.error);
      return {
        kind: 'reply',
        reply: sessionStartReply(await session.start(parsed.data)),
      };
    }
    case SESSION_SEND_TOOL_NAME: {
      const parsed = SessionSendArgsSchema.safeParse(input);
      if (!parsed.success) return invalid(name, parsed.error);
      const { sessionId, message, mode } = parsed.data;
      return {
        kind: 'reply',
        reply: sessionSendReply(
          sessionId,
          await session.send({ childSessionId: sessionId, message, mode }),
        ),
      };
    }
    case SESSION_STATUS_TOOL_NAME: {
      const parsed = SessionStatusArgsSchema.safeParse(input);
      if (!parsed.success) return invalid(name, parsed.error);
      return {
        kind: 'reply',
        reply: sessionStatusReply(await session.status(parsed.data.sessionId)),
      };
    }
    case SESSION_READ_TOOL_NAME: {
      const parsed = SessionReadArgsSchema.safeParse(input);
      if (!parsed.success) return invalid(name, parsed.error);
      return {
        kind: 'read',
        ...sessionReadReply(
          await session.read(parsed.data.sessionId, parsed.data.tailKiB),
        ),
      };
    }
    case SESSION_STOP_TOOL_NAME: {
      const parsed = SessionStopArgsSchema.safeParse(input);
      if (!parsed.success) return invalid(name, parsed.error);
      return {
        kind: 'reply',
        reply: sessionStopReply(await session.stop(parsed.data.sessionId)),
      };
    }
  }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The caller's held completions. Taking them must not cost the tool's own
 * answer (a started child is still started), so a failure here is logged
 * and the reply goes out without them; the spawner keeps them held only if
 * it never returned them.
 */
function takeHeld(
  session: SessionNamespace,
  logger: Logger,
): readonly SessionChildCompletionEnvelope[] {
  try {
    return session.takeHeldCompletions();
  } catch (error: unknown) {
    // degradation-audit: reported - logged at warn; the tool's own reply is
    // still returned, and nothing was marked delivered by a call that threw.
    logger.warn(
      `[MCP] could not collect held session completions: ${errorText(error)}`,
    );
    return [];
  }
}

/** Route one `ptah_session_*` call and append the caller's held completions. */
export async function handleSessionToolCall(
  name: SessionToolName,
  args: unknown,
  session: SessionNamespace,
  logger: Logger,
): Promise<SessionToolReply> {
  let body: Body;
  try {
    body = await runTool(name, args, session);
  } catch (error: unknown) {
    // degradation-audit: reported - the failure is returned to the agent as
    // an isError result naming the cause (e.g. no session spawner in this
    // host) and logged at warn.
    logger.warn(`[MCP] ${name} failed: ${errorText(error)}`);
    body = {
      kind: 'reply',
      reply: { isError: true, text: `${name} failed: ${errorText(error)}` },
    };
  }
  const held = renderHeldCompletions(takeHeld(session, logger));
  if (body.kind === 'read') {
    return {
      isError: false,
      text: joinBlocks(body.head, held, body.transcript),
    };
  }
  return {
    isError: body.reply.isError,
    text: joinBlocks(body.reply.text, held),
  };
}
