import type {
  LaneCompletionSignal,
  LaneDeliverableCheck,
} from '@ptah-extension/shared';

function escape(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function duration(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  const seconds = Math.round(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
}

function deliverableLine(check: LaneDeliverableCheck): string {
  if (!check.exists) return `- ${check.path} — MISSING`;
  if ((check.bytes ?? 0) === 0) return `- ${check.path} — EMPTY`;
  const stale =
    check.writtenAfterSpawn === false ? ' (NOT written by this run)' : '';
  return `- ${check.path} — ${check.bytes} bytes${stale}`;
}

function nextAction(signal: LaneCompletionSignal): string {
  switch (signal.verdict) {
    case 'delivered':
      return 'Next: read the deliverable files and verify the work yourself. A lane writing its file is not proof the content is right.';
    case 'no-deliverable':
      return 'Next: this lane exited without writing every deliverable it was given, so treat the task as NOT done. Read its output with ptah_agent_read to see how far it got, then resume it with the missing paths named, or do the work another way. Do not report this lane as complete.';
    case 'failed':
      return 'Next: the lane did not finish. Read its output with ptah_agent_read, then resume it when a CLI Session ID is present or respawn with a smaller task.';
    case 'unverified':
      return 'Next: read the lane output and check its claims against the files and the project tests before you use them.';
  }
}

export function buildLaneCompletionEnvelope(
  signal: LaneCompletionSignal,
): string {
  const attrs = [
    `agent-id="${escape(signal.agentId)}"`,
    `agent="${escape(signal.agentLabel)}"`,
    `cli="${escape(signal.cli)}"`,
    `status="${escape(signal.status)}"`,
    `verdict="${escape(signal.verdict)}"`,
  ].join(' ');
  const lines: string[] = [
    `Lane ${signal.agentLabel} finished: ${signal.status}` +
      (signal.exitCode !== undefined ? ` (exit code ${signal.exitCode})` : '') +
      ` after ${duration(signal.durationMs)}.`,
    `Task: ${signal.taskHeadline || '(no task headline)'}`,
  ];
  if (signal.role) lines.push(`Role: ${signal.role}`);
  if (signal.mcpAttachmentWarning) lines.push(`MCP warning: ${signal.mcpAttachmentWarning}`);
  if (signal.taskFolder) lines.push(`Task folder: ${signal.taskFolder}`);
  if (signal.deliverables.length === 0) {
    lines.push(
      'Deliverables: none were declared at spawn, so nothing was checked. Read the lane output before you trust this result, and declare "deliverables" on the next spawn so the next signal can verify it.',
    );
  } else {
    lines.push('Deliverables:', ...signal.deliverables.map(deliverableLine));
  }
  lines.push(
    `Reports sent by this lane before it ended: ${signal.reportsDelivered}.`,
  );
  if (signal.cliSessionId)
    lines.push(
      `CLI Session ID: ${signal.cliSessionId} — pass it as resume_session_id to continue this lane instead of respawning it.`,
    );
  lines.push(nextAction(signal));
  return `<agent-lane-completed ${attrs}>\n${lines.join('\n')}\n</agent-lane-completed>`;
}
