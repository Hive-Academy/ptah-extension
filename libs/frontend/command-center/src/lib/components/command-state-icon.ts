import {
  Ban,
  CircleCheck,
  CircleDashed,
  CircleX,
  LoaderCircle,
  MessageCircleQuestion,
} from 'lucide-angular';
import type { LucideIconData } from 'lucide-angular';
import type { CommandWorkState } from '../model/command-center.store';

export function stateIcon(state: CommandWorkState): LucideIconData {
  switch (state) {
    case 'completed':
      return CircleCheck;
    case 'failed':
      return CircleX;
    case 'cancelled':
      return Ban;
    case 'awaiting input':
      return MessageCircleQuestion;
    case 'running':
    case 'starting':
      return LoaderCircle;
    default:
      return CircleDashed;
  }
}

export function stateColor(state: CommandWorkState): string {
  switch (state) {
    case 'completed':
      return 'text-state-done';
    case 'failed':
      return 'text-state-err';
    case 'cancelled':
      return 'text-state-idle';
    case 'awaiting input':
      return 'text-state-need';
    case 'running':
    case 'starting':
      return 'text-state-run';
    default:
      return 'text-state-idle';
  }
}

export function stateBorder(state: CommandWorkState): string {
  switch (state) {
    case 'completed': return 'border-l-state-done';
    case 'failed': return 'border-l-state-err';
    case 'awaiting input': return 'border-l-state-need';
    case 'running':
    case 'starting': return 'border-l-state-run';
    default: return 'border-l-state-idle';
  }
}
