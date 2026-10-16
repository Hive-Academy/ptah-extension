import type { Logger } from '@ptah-extension/vscode-core';
import { ZodError } from 'zod';
import { describeZodIssues } from '../route-tool-handlers';
import {
  OUTCOME_REPORT_TOOL_NAME,
  runOutcomeReport,
  type OutcomeReportDependencies,
} from './outcome-report.tool';

export interface OutcomeReportReply {
  readonly isError: boolean;
  readonly invalidArguments: boolean;
  readonly text: string;
}

export function adaptOutcomeLogger(
  logger: Logger,
): OutcomeReportDependencies['logger'] {
  return {
    debug: (message, meta) => logger.debug(message, meta),
    info: (message, meta) => logger.info(message, meta),
    warn: (message, meta) => logger.warn(message, meta),
    error: (message, meta) => logger.error(message, meta),
  };
}

function outcomeReportErrorText(error: unknown): string {
  if (error instanceof ZodError) {
    return `Error: invalid ${OUTCOME_REPORT_TOOL_NAME} arguments — ${describeZodIssues(error)}`;
  }
  if (error instanceof Error && error.message.trim().length > 0) {
    return `${OUTCOME_REPORT_TOOL_NAME} failed: ${error.message.trim()}`;
  }
  return `${OUTCOME_REPORT_TOOL_NAME} failed: unknown error`;
}

/**
 * The one `ptah_outcome_report` call path of the HTTP and stdio surfaces.
 * `resolve` runs inside the `try`, so a store or pipeline factory that throws
 * becomes a tool error like any other failure, never a rejected promise that
 * the transport reports as a protocol error. Absent, or returning
 * `undefined`: arguments are still parsed, and a valid call answers
 * `outcome store unavailable`.
 */
export async function handleOutcomeReportToolCall(
  args: unknown,
  resolve: (() => OutcomeReportDependencies | undefined) | undefined,
  logger: Logger,
): Promise<OutcomeReportReply> {
  try {
    const deps: OutcomeReportDependencies = resolve?.() ?? {
      workspaceRoot: '',
      logger: adaptOutcomeLogger(logger),
    };
    const result = await runOutcomeReport(args, deps);
    return {
      isError: false,
      invalidArguments: false,
      text: JSON.stringify(result),
    };
  } catch (error: unknown) {
    return {
      isError: true,
      invalidArguments: error instanceof ZodError,
      text: outcomeReportErrorText(error),
    };
  }
}
