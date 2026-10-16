import type { BackgroundAgentStripEntry } from './background-agent-strip.component';

export function backgroundAgentPopulation(list: readonly BackgroundAgentStripEntry[]): string {
  let background = 0;
  let running = 0;
  let completed = 0;
  let failed = 0;
  let stopped = 0;
  for (const e of list) {
    if (e.origin === 'background') background++;
    if (e.status === 'running' || e.status === 'background') running++;
    else if (e.status === 'completed') completed++;
    else if (e.status === 'error') failed++;
    else stopped++;
  }
  const foreground = list.length - background;
  const parts: string[] = [];
  if (background) parts.push(`${background} background`);
  if (foreground) parts.push(`${foreground} foreground`);
  if (running) parts.push(`${running} running`);
  if (completed) parts.push(`${completed} done`);
  if (failed) parts.push(`${failed} failed`);
  if (stopped) parts.push(`${stopped} stopped`);
  return parts.join(' · ');
}
