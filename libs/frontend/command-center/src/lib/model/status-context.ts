import type { CommandWorkNode } from './command-center.store';

/** A bounded snapshot for an explicit Command Center status turn. */
export function buildStatusContext(nodes: readonly CommandWorkNode[], agesMs: ReadonlyMap<string, number> = new Map()): string {
  const start = '<COMMAND_CENTER_STATUS_CONTEXT>\n';
  const end = '\n</COMMAND_CENTER_STATUS_CONTEXT>';
  const safeId = (id: string): string => /^[A-Za-z0-9:#._-]{1,120}$/.test(id) ? id : '[redacted]';
  let body = '';
  let omitted = 0;
  for (const node of nodes) {
    const age = agesMs.get(node.id);
    const line = `${safeId(node.id)} | ${node.state} | ${age !== undefined && Number.isFinite(age) && age >= 0 ? `${Math.floor(age / 1000)}s` : 'unknown'}\n`;
    if (start.length + body.length + line.length + end.length + 30 > 2048) { omitted++; continue; }
    body += line;
  }
  if (omitted) body += `... ${omitted} more nodes`;
  return `${start}${body.trimEnd()}${end}`;
}
