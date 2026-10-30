import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep, win32 } from 'node:path';
import { z } from 'zod';
import {
  DeliverablesPayloadSchema,
  OutcomeReportArgsSchema,
  ReviewPayloadSchema,
  deterministicReviewReportId,
  isSelfReview,
  reportedSubagentStopRow,
  type LaneOutcomeLogger,
  type LaneOutcomeStore,
  type OutcomeWritePipeline,
} from '@ptah-extension/lane-outcomes';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import { getCallerAgentId, getCallerSessionId } from '../mcp-request-context';
import { flattenOperationUnion } from '../surface-tools';
import type { MCPToolDefinition } from '../types/mcp-protocol.types';

export const OUTCOME_REPORT_TOOL_NAME = 'ptah_outcome_report';

export interface OutcomeReportDependencies {
  readonly pipeline?: OutcomeWritePipeline;
  readonly store?: LaneOutcomeStore;
  readonly fileSystem?: IFileSystemProvider;
  readonly workspaceRoot: string;
  readonly logger: LaneOutcomeLogger;
}

export type OutcomeReportToolResult =
  | { readonly recorded: false; readonly reason: string }
  | {
      readonly recorded: 'applied' | 'held' | 'queued';
      readonly runId: string;
      readonly reportId: string;
    };

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Publish the discriminated union as one closed object (MCP clients reject a
 * top-level `oneOf`); each per-kind field's description names the kinds that
 * require it. The zod schema stays the runtime validator.
 */
function outcomeInputSchema(): MCPToolDefinition['inputSchema'] {
  const generated: Record<string, unknown> = z.toJSONSchema(
    OutcomeReportArgsSchema,
    { io: 'input', target: 'draft-7' },
  );
  // An MCP inputSchema is a fragment, not a document.
  const { $schema: _ignoredSchemaKeyword, ...fragment } = generated;
  const schema = flattenOperationUnion(fragment, 'kind');
  const kind = schema.properties['kind'];
  if (
    !isJsonObject(kind) ||
    !Array.isArray(kind['enum']) ||
    kind['enum'].length !== OutcomeReportArgsSchema.options.length
  )
    throw new Error('invalid outcome input schema');
  return schema;
}

/**
 * Node reports a missing path as ENOENT (ENOTDIR for a file in the parent
 * chain); `vscode.workspace.fs` rejects with a FileSystemError whose code is
 * FileNotFound (FileNotADirectory for the parent case).
 */
const NOT_FOUND_CODES: ReadonlySet<unknown> = new Set([
  'ENOENT',
  'ENOTDIR',
  'FileNotFound',
  'FileNotADirectory',
]);

function isNotFound(error: unknown): boolean {
  return isJsonObject(error) && NOT_FOUND_CODES.has(error['code']);
}

export function buildOutcomeReportTool(): MCPToolDefinition {
  return {
    name: OUTCOME_REPORT_TOOL_NAME,
    description:
      'Declare checked deliverables for a run or attach a review verdict. ' +
      'Use the Ptah run tag when available, otherwise the Agent result agentId. ' +
      'For reviews, supply reviewerRunId to pair the reviewer with the reviewed run; a review may be reported before that run finishes. ' +
      'A held report joins the run when its stop arrives; queued means the outcome store is temporarily unavailable.',
    inputSchema: outcomeInputSchema(),
    annotations: { readOnlyHint: false, idempotentHint: false },
  };
}

/** Parse once at the boundary; paired reviews use a stable report ID. */
export async function runOutcomeReport(
  input: unknown,
  deps: OutcomeReportDependencies,
): Promise<OutcomeReportToolResult> {
  const args = OutcomeReportArgsSchema.parse(input);
  if (!deps.pipeline || !deps.store)
    return { recorded: false, reason: 'outcome store unavailable' };
  if (!deps.workspaceRoot.trim())
    throw new Error('session workspace root unavailable');

  let runId: string;
  let externalSubagentAgentId: string | null = null;
  if ('runId' in args.target) {
    runId = args.target.runId;
  } else {
    const subagentId = `subagent:${args.target.agentId}`;
    try {
      const [subagent, lane] = await Promise.all([
        deps.store.get(subagentId),
        deps.store.findLatestByAgent(args.target.agentId),
      ]);
      if (subagent && lane && lane.runId !== subagentId)
        return {
          recorded: false,
          reason: `ambiguous agentId ${args.target.agentId}`,
        };
      runId = subagent ? subagentId : (lane?.runId ?? subagentId);
      if (
        args.kind === 'deliverables' &&
        !subagent &&
        !lane &&
        !getCallerSessionId()
      )
        externalSubagentAgentId = args.target.agentId;
    } catch (error: unknown) {
      deps.logger.warn('Outcome target lookup failed', {
        agentId: args.target.agentId,
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return { recorded: false, reason: 'outcome store unavailable' };
    }
  }

  // A lane's MCP URL names the calling agent, which outranks the claimed
  // reviewer: host capture keys the same review by that agent, so both paths
  // share one report id, and a reviewer cannot grade its own run.
  const reviewer =
    args.kind === 'review'
      ? (getCallerAgentId() ?? args.reviewerRunId)
      : undefined;
  if (reviewer && isSelfReview(runId, reviewer))
    return { recorded: false, reason: 'self-review' };

  let payload: string;
  if (args.kind === 'deliverables') {
    const fileSystem = deps.fileSystem;
    if (!fileSystem) throw new Error('outcome filesystem unavailable');
    const root = resolve(deps.workspaceRoot);
    const checked = await Promise.all(
      args.paths.map(async (entry) => {
        const path = resolve(root, entry);
        const rel = relative(root, path);
        if (
          isAbsolute(entry) ||
          win32.isAbsolute(entry) ||
          /^[A-Za-z]:/.test(entry) ||
          rel === '..' ||
          rel.startsWith(`..${sep}`) ||
          isAbsolute(rel)
        )
          return { reason: `deliverable path escapes workspace: ${entry}` };
        try {
          const stat = await fileSystem.stat(path);
          return {
            check: { exists: true, bytes: stat.size, mtimeMs: stat.mtime },
          };
        } catch (error: unknown) {
          if (isNotFound(error))
            return { check: { exists: false, bytes: 0, mtimeMs: null } };
          deps.logger.warn('Deliverable stat failed', {
            code:
              isJsonObject(error) && typeof error['code'] === 'string'
                ? error['code']
                : 'UNKNOWN',
          });
          return { reason: `deliverable stat failed for ${entry}` };
        }
      }),
    );
    const failure = checked.find(
      (result) => result.reason !== undefined,
    )?.reason;
    if (failure !== undefined) return { recorded: false, reason: failure };
    const checks = checked.flatMap((result) =>
      'check' in result ? [result.check] : [],
    );
    payload = JSON.stringify(
      DeliverablesPayloadSchema.parse({
        checks,
        taskKind: args.taskKind,
        taskId: args.taskId,
        routingSource: args.routingSource,
      }),
    );
  } else {
    payload = JSON.stringify(
      ReviewPayloadSchema.parse({ verdict: args.verdict }),
    );
  }

  const reportId =
    reviewer !== undefined
      ? deterministicReviewReportId(runId, reviewer)
      : randomUUID();
  const heldAt = Date.now();
  try {
    if (externalSubagentAgentId)
      deps.pipeline.enqueue({
        kind: 'subagent-stop',
        row: reportedSubagentStopRow(externalSubagentAgentId, heldAt),
      });
    const result = await deps.pipeline.submit({
      kind: args.kind,
      report: {
        reportId,
        runId,
        kind: args.kind,
        payload,
        heldAt,
        expiresAt: heldAt + 24 * 60 * 60 * 1000,
      },
    });
    return result.ok
      ? { recorded: result.state, runId: result.runId, reportId }
      : { recorded: false, reason: result.error };
  } catch (error: unknown) {
    deps.logger.error('Outcome report write failed', {
      runId,
      reportId,
      code: error instanceof Error ? error.name : 'UNKNOWN',
    });
    return { recorded: false, reason: 'outcome store unavailable' };
  }
}
