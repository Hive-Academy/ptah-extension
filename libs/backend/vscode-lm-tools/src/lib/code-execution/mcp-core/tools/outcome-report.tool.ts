import { randomUUID } from 'node:crypto';
import { isAbsolute, relative, resolve, sep } from 'node:path';
import { checkLaneDeliverable } from '@ptah-extension/cli-agent-runtime';
import {
  DeliverablesPayloadSchema,
  OutcomeReportArgsSchema,
  ReviewPayloadSchema,
  type LaneOutcomeLogger,
  type LaneOutcomeStore,
  type OutcomeWritePipeline,
} from '@ptah-extension/lane-outcomes';
import type { IFileSystemProvider } from '@ptah-extension/platform-core';
import type { MCPToolDefinition } from '../types/mcp-protocol.types';

export const OUTCOME_REPORT_TOOL_NAME = 'ptah_outcome_report';

export interface OutcomeReportDependencies {
  readonly pipeline?: OutcomeWritePipeline;
  readonly store?: LaneOutcomeStore;
  readonly fileSystem: IFileSystemProvider;
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

export function buildOutcomeReportTool(): MCPToolDefinition {
  return {
    name: OUTCOME_REPORT_TOOL_NAME,
    description:
      'Declare checked deliverables for a run or attach a review verdict. ' +
      'Use the Ptah run tag when available, otherwise the Agent result agentId. ' +
      'A held report joins the run when its stop arrives; queued means the outcome store is temporarily unavailable.',
    inputSchema: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['deliverables', 'review'] },
        target: {
          type: 'object',
          properties: {
            runId: { type: 'string' },
            agentId: { type: 'string' },
          },
          additionalProperties: false,
        },
        paths: { type: 'array', items: { type: 'string' }, maxItems: 20 },
        taskKind: { type: 'string' },
        taskId: { type: 'string' },
        routingSource: { type: 'string' },
        verdict: { type: 'string', enum: ['approved', 'rejected', 'revise'] },
      },
      required: ['kind', 'target'],
      additionalProperties: false,
    },
    annotations: { readOnlyHint: false, idempotentHint: false },
  };
}

/** Parse once at the boundary; report IDs are deliberately unique per call. */
export async function runOutcomeReport(
  input: unknown,
  deps: OutcomeReportDependencies,
): Promise<OutcomeReportToolResult> {
  const args = OutcomeReportArgsSchema.parse(input);
  if (!deps.pipeline || !deps.store)
    return { recorded: false, reason: 'outcome store unavailable' };

  let runId: string;
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
    } catch (error: unknown) {
      deps.logger.warn('Outcome target lookup failed', {
        agentId: args.target.agentId,
        code: error instanceof Error ? error.name : 'UNKNOWN',
      });
      return { recorded: false, reason: 'outcome store unavailable' };
    }
  }

  let payload: string;
  if (args.kind === 'deliverables') {
    const root = resolve(deps.workspaceRoot);
    const checks = await Promise.all(
      args.paths.map(async (entry) => {
        const path = resolve(root, entry);
        const rel = relative(root, path);
        if (isAbsolute(entry) || rel === '..' || rel.startsWith(`..${sep}`))
          throw new Error('deliverable path escapes workspace');
        const check = await checkLaneDeliverable(
          deps.fileSystem,
          { deliverables: args.paths, workingDirectory: root, id: runId },
          entry,
          Number.NaN,
          (_path, error) =>
            deps.logger.warn('Deliverable stat failed', {
              code: error instanceof Error ? error.name : 'UNKNOWN',
            }),
        );
        if (!check.exists) return { exists: false, bytes: 0, mtimeMs: null };
        try {
          const stat = await deps.fileSystem.stat(path);
          return { exists: true, bytes: stat.size, mtimeMs: stat.mtime };
        } catch (error: unknown) {
          deps.logger.warn('Deliverable mtime read failed', {
            code: error instanceof Error ? error.name : 'UNKNOWN',
          });
          return { exists: false, bytes: 0, mtimeMs: null };
        }
      }),
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

  const reportId = randomUUID();
  const heldAt = Date.now();
  try {
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
