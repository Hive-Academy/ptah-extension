import type { CompactRailState } from './compact-lane.types';

export function compactRailStateLabel(state: CompactRailState): string {
  switch (state) {
    case 'running': return 'Running';
    case 'needs': return 'Needs input';
    case 'error': return 'Error';
    case 'idle': return 'Idle';
    case 'done': return 'Done';
  }
}
