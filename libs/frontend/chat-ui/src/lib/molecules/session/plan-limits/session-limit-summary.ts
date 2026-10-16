import type { SessionContextCue } from '../session-stats-view';
import type { StatsLimitViewModel } from './stats-limit-view-model.types';

export interface SessionLimitSummary {
  readonly state: 'none' | 'near' | 'at';
  readonly text: string | null;
  readonly extra: number;
  readonly source: 'session' | 'lane' | null;
  readonly fullText: string | null;
}

export function sessionLimitSummary(vm: StatsLimitViewModel | null): SessionLimitSummary {
  const candidates: { state: 'near' | 'at'; text: string; source: 'session' | 'lane' }[] = [];
  if (vm?.indicator) candidates.push({
    state: vm.indicator.state === 'at-limit' ? 'at' : 'near',
    text: vm.indicator.text,
    source: 'session',
  });
  for (const lane of vm?.laneTiles ?? []) {
    for (const subgroup of lane.subgroups) {
      switch (subgroup.state) {
        case 'at-limit':
        case 'near-limit':
          candidates.push({
            state: subgroup.state === 'at-limit' ? 'at' : 'near',
            text: `${lane.label} · ${subgroup.stateChip.text}`,
            source: 'lane',
          });
          break;
        case 'confirmed-room':
        case 'unknown':
          break;
        default: {
          const exhaustive: never = subgroup.state;
          return exhaustive;
        }
      }
    }
  }
  const ordered = candidates.filter(c => c.state === 'at').concat(candidates.filter(c => c.state === 'near'));
  const first = ordered[0];
  if (!first) return { state: 'none', text: null, extra: 0, source: null, fullText: null };
  const extra = ordered.length - 1;
  return { ...first, extra, fullText: extra ? `${first.text} (+${extra} more)` : first.text };
}

export function inspectorToggleDescription(context: SessionContextCue, summary: SessionLimitSummary, needsYou: number): string {
  const parts: string[] = [];
  if (context.hasLive) parts.push(context.known && context.percent !== null
    ? `Context ${Math.round(context.percent)}%.` : 'Context unknown.');
  if (summary.fullText) parts.push(`${summary.fullText}.`);
  if (needsYou > 0) parts.push(`${needsYou} need you.`);
  return parts.join(' ');
}

export function limitAwareDot(base: 'need' | 'sel' | null, open: boolean, summary: SessionLimitSummary | null): 'need' | 'err' | 'sel' | null {
  if (open) return null;
  if (base === 'need') return 'need';
  if (summary?.state === 'at') return 'err';
  if (summary?.state === 'near') return 'need';
  return base;
}
