/**
 * Reads the transcript of an agent spawned by a `Workflow` tool run.
 *
 * The SDK's `getSubagentMessages(sessionId, agentId)` reads only
 * `~/.claude/projects/<dir>/<sessionId>/subagents/agent-<agentId>.jsonl`.
 * Workflow agents are written one level deeper, per run:
 *
 *   ~/.claude/projects/<dir>/<sessionId>/subagents/workflows/<runId>/agent-<agentId>.jsonl
 *
 * so the SDK read comes back empty for every one of them and the monitor
 * panel showed "No transcript yet" for agents with hundreds of KB on disk.
 * This is the fallback: scan every project dir (the SDK also searches all
 * projects when `dir` is omitted), then every run under the session, for the
 * agent's file.
 *
 * Pure I/O helper, no DI: the dispatcher injects nothing new and the spec
 * points `homeDir` at a temp tree.
 */

import { promises as fs } from 'fs';
import * as os from 'os';
import * as path from 'path';

/** One parsed JSONL line, in the shape the dispatcher's normalizer expects. */
export interface WorkflowTranscriptLine {
  readonly type: 'user' | 'assistant' | 'system';
  readonly message: unknown;
  readonly timestamp?: string;
}

/** A session id or agent id is a path segment — refuse anything that is not one. */
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

async function readdirOrEmpty(dir: string): Promise<string[]> {
  try {
    return await fs.readdir(dir);
  } catch {
    return [];
  }
}

/**
 * Locate `agent-<agentId>.jsonl` under any workflow run of `sessionId`.
 * Returns null when no project holds the session or the run holds no such
 * agent. Ids that are not plain path segments resolve to null rather than
 * being joined into a path.
 */
export async function findWorkflowAgentTranscript(
  sessionId: string,
  agentId: string,
  homeDir: string = os.homedir(),
): Promise<string | null> {
  if (!SAFE_ID.test(sessionId) || !SAFE_ID.test(agentId)) return null;

  const projectsDir = path.join(homeDir, '.claude', 'projects');
  const fileName = `agent-${agentId}.jsonl`;

  for (const project of await readdirOrEmpty(projectsDir)) {
    const workflowsDir = path.join(
      projectsDir,
      project,
      sessionId,
      'subagents',
      'workflows',
    );
    for (const run of await readdirOrEmpty(workflowsDir)) {
      const candidate = path.join(workflowsDir, run, fileName);
      try {
        await fs.access(candidate);
        return candidate;
      } catch {
        // not in this run
      }
    }
  }
  return null;
}

/**
 * Parse the transcript file into user/assistant/system lines in file order.
 * Malformed lines are skipped, not fatal — the SDK writes the file while the
 * agent runs, so the last line can be partial.
 */
export async function readWorkflowAgentTranscript(
  filePath: string,
  options?: { limit?: number; offset?: number },
): Promise<WorkflowTranscriptLine[]> {
  const raw = await fs.readFile(filePath, 'utf8');
  const lines: WorkflowTranscriptLine[] = [];

  for (const line of raw.split('\n')) {
    if (!line.trim()) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    const { type, message, timestamp } = parsed as {
      type?: unknown;
      message?: unknown;
      timestamp?: unknown;
    };
    if (type !== 'user' && type !== 'assistant' && type !== 'system') continue;
    lines.push({
      type,
      message,
      ...(typeof timestamp === 'string' ? { timestamp } : {}),
    });
  }

  const offset = options?.offset ?? 0;
  const end = options?.limit !== undefined ? offset + options.limit : undefined;
  return lines.slice(offset, end);
}
