import type { MCPToolDefinition } from '../types';
import {
  HTTP_MAX_AGENT_WAIT_SEC,
  MAX_WAIT_TIMEOUT_SEC,
  WAIT_SUMMARY_MAX_CHARS,
} from './wait-tools-args.schema';

export const RUN_CHECK_WAIT_TOOL_NAME = 'ptah_run_check_wait';

/** The HTTP-only, repeat-safe collection surface for a running Nx check. */
export function buildRunCheckWaitTool(): MCPToolDefinition {
  return {
    name: RUN_CHECK_WAIT_TOOL_NAME,
    description:
      `Collect an HTTP ptah_run_check job. Each call waits at most ${HTTP_MAX_AGENT_WAIT_SEC} s; repeat while it runs. ` +
      'Set cancel true to stop the check. Finished results remain collectable for 15 minutes; full logs stay under .ptah/tmp/checks. ' +
      `Replies are at most ${WAIT_SUMMARY_MAX_CHARS} chars.`,
    inputSchema: {
      type: 'object',
      properties: {
        jobId: { type: 'string', format: 'uuid', maxLength: 128 },
        timeoutSec: {
          type: 'integer',
          minimum: 0,
          maximum: MAX_WAIT_TIMEOUT_SEC,
          description: `Seconds to wait (default ${HTTP_MAX_AGENT_WAIT_SEC}).`,
        },
        cancel: { type: 'boolean' },
      },
      required: ['jobId'],
      additionalProperties: false,
    },
    annotations: {
      readOnlyHint: false,
      destructiveHint: true,
      idempotentHint: true,
    },
  };
}
