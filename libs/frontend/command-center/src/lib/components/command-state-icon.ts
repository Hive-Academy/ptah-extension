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
      return 'text-success';
    case 'failed':
      return 'text-error';
    case 'cancelled':
      return 'text-base-content-muted';
    case 'awaiting input':
      return 'text-warning';
    case 'running':
    case 'starting':
      return 'text-info';
    default:
      return 'text-base-content-muted';
  }
}
