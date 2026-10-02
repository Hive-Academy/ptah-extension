/**
 * `ptah_session_*` tool definitions (TASK_2026_584, plan Component 7).
 *
 * Follows `surface-tools.ts`: every input schema is GENERATED from the zod
 * contract the handler validates with (`session-tool-args.schema.ts`), so a
 * key or a bound cannot change in one place and stay stale in the other.
 *
 * The definitions are static: no caller, workspace or host value is
 * interpolated, so `tools/list` stays byte-identical for every caller.
 */
import { z } from 'zod';
import {
  SESSION_READ_DEFAULT_TAIL_KIB,
  SESSION_READ_MAX_TAIL_KIB,
} from '@ptah-extension/cli-agent-runtime';
import type { MCPToolDefinition } from '../types';
import {
  SessionReadArgsSchema,
  SessionSendArgsSchema,
  SessionStartArgsSchema,
  SessionStatusArgsSchema,
  SessionStopArgsSchema,
} from './session-tool-args.schema';

export const SESSION_START_TOOL_NAME = 'ptah_session_start';
export const SESSION_SEND_TOOL_NAME = 'ptah_session_send';
export const SESSION_STATUS_TOOL_NAME = 'ptah_session_status';
export const SESSION_READ_TOOL_NAME = 'ptah_session_read';
export const SESSION_STOP_TOOL_NAME = 'ptah_session_stop';

export const SESSION_TOOL_NAMES = [
  SESSION_START_TOOL_NAME,
  SESSION_SEND_TOOL_NAME,
  SESSION_STATUS_TOOL_NAME,
  SESSION_READ_TOOL_NAME,
  SESSION_STOP_TOOL_NAME,
] as const;

export type SessionToolName = (typeof SESSION_TOOL_NAMES)[number];

type InputSchema = MCPToolDefinition['inputSchema'];

/** The zod contract as an MCP `inputSchema` fragment (no `$schema` keyword). */
function inputSchemaOf(schema: z.ZodType): InputSchema {
  const generated: Record<string, unknown> = z.toJSONSchema(schema, {
    io: 'input',
    target: 'draft-7',
  });
  const { $schema: _ignoredSchemaKeyword, ...fragment } = generated;
  return { ...fragment, type: 'object' } as InputSchema;
}

const HELD_NOTE =
  'Every ptah_session_* result ends with any completion a child produced ' +
  'while this session was not live ("Held while this session was not live").';

/** Build the `ptah_session_start` tool definition. */
export function buildSessionStartTool(): MCPToolDefinition {
  return {
    name: SESSION_START_TOOL_NAME,
    description:
      'Start a child chat session on a NEW git branch in its own worktree. It ' +
      "opens as a tab in the user's window and runs unattended: file edits " +
      'inside its worktree and allowlisted Bash commands run without asking; ' +
      'other actions wait a bounded time for the user in that tab, then are ' +
      'denied. Steer it with ptah_session_send. It reports with ' +
      'ptah_agent_report, and a completion turn is pushed into this session ' +
      'each time it settles. A task starting with "/" (e.g. /orchestrate ...) ' +
      'runs as that slash command. The child cannot start sessions itself. ' +
      'The user owns merge, PR and cleanup: the worktree and the branch remain ' +
      'after it ends. There is no permission, path or parent argument; you are ' +
      'the parent. Refusals are returned as text with a code. ' +
      HELD_NOTE,
    inputSchema: inputSchemaOf(SessionStartArgsSchema),
  };
}

/** Build the `ptah_session_send` tool definition. */
export function buildSessionSendTool(): MCPToolDefinition {
  return {
    name: SESSION_SEND_TOOL_NAME,
    description:
      'Send a message to one of your child sessions: the primary way to steer ' +
      'it. mode "queue" (default) starts a turn now when it is idle, or holds ' +
      'the message until its current turn ends; "steer" interrupts the turn in ' +
      'flight and starts a new one with the message; "if-idle" delivers only ' +
      'when it is idle and is refused as busy otherwise. The result states the ' +
      'effect, or the refusal with its reason. ' +
      HELD_NOTE,
    inputSchema: inputSchemaOf(SessionSendArgsSchema),
  };
}

/** Build the `ptah_session_status` tool definition. */
export function buildSessionStatusTool(): MCPToolDefinition {
  return {
    name: SESSION_STATUS_TOOL_NAME,
    description:
      'Status of your child sessions: working, waiting, awaiting-permission ' +
      '(with the denial time), idle, or how it ended; branch, worktree, turns ' +
      'settled, reports and the last completion. Omit sessionId for all of ' +
      'your children. Prefer waiting for the pushed completion turn over ' +
      'polling. ' +
      HELD_NOTE,
    inputSchema: inputSchemaOf(SessionStatusArgsSchema),
    annotations: { readOnlyHint: true },
  };
}

/** Build the `ptah_session_read` tool definition. */
export function buildSessionReadTool(): MCPToolDefinition {
  return {
    name: SESSION_READ_TOOL_NAME,
    description:
      "The tail of a child session's transcript, tailKiB KiB of text " +
      `(default ${SESSION_READ_DEFAULT_TAIL_KIB}, max ${SESSION_READ_MAX_TAIL_KIB}). ` +
      'Before the child has a transcript it says so. ' +
      HELD_NOTE,
    inputSchema: inputSchemaOf(SessionReadArgsSchema),
    annotations: { readOnlyHint: true },
  };
}

/** Build the `ptah_session_stop` tool definition. */
export function buildSessionStopTool(): MCPToolDefinition {
  return {
    name: SESSION_STOP_TOOL_NAME,
    description:
      'Stop one of your child sessions. Its tab, its transcript, its worktree ' +
      'and its branch remain; nothing is merged, pushed or removed. ' +
      HELD_NOTE,
    inputSchema: inputSchemaOf(SessionStopArgsSchema),
  };
}
