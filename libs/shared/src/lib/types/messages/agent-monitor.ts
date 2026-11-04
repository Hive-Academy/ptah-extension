/**
 * Payload for `agent-monitor:reparented` (TASK_2026_876).
 *
 * Sent once when a kept handoff settles lane adoption. `parentSessionId` is
 * the successor tab id. The existing resolve path later rewrites it to the
 * successor SDK id.
 */
export interface AgentMonitorReparentedPayload {
  readonly agentIds: readonly string[];
  readonly parentSessionId: string;
}
