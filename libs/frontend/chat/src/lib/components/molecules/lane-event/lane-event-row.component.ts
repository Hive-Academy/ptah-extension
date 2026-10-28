import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { AgentAvatarComponent } from '@ptah-extension/chat-ui';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { ArrowUpRight, ChevronRight, GitBranch, Image, LucideAngularModule, Undo2, Users } from 'lucide-angular';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { laneKey } from '../compact-session/compact-lane-rows';
import { toUserMessageMarkdown } from '../../../utils/user-message-markdown.utils';
import type { LaneEventRow } from './lane-event-row.types';
import { deriveLaneEventPresentation, laneEventTime, type LaneEventMetrics, type LaneEventTone } from './lane-event-row.presentation';

@Component({
  selector: 'ptah-lane-event',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, SurfaceMarkdownPipe, AgentAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lane-event-row.component.html',
})
export class LaneEventRowComponent {
  readonly row = input.required<LaneEventRow>();
  readonly monitorAgent = input<LaneEventMetrics | null>(null);
  readonly isSessionActive = input(false);
  readonly branchRequested = output<string>();
  readonly rewindRequested = output<string>();
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);
  protected readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });
  protected readonly expanded = signal(false);
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly OpenIcon = ArrowUpRight;
  protected readonly ImageIcon = Image;
  protected readonly UsersIcon = Users;
  protected readonly BranchIcon = GitBranch;
  protected readonly RewindIcon = Undo2;
  protected readonly latest = computed(() => this.row().events[this.row().events.length - 1]);
  protected readonly completed = computed(() => this.latest().kind === 'completed');
  protected readonly lastMessageId = computed(() => this.latest().messageId);
  protected readonly bodyId = computed(() => 'lane-event-body-' + this.row().rowKey);
  protected readonly canExpand = computed(() => this.row().events.length > 1 || this.latest().body.includes('\n'));
  protected readonly presentation = computed(() => deriveLaneEventPresentation(this.row(), this.monitorAgent()));
  protected readonly summary = computed(() => this.presentation().summary);
  protected readonly stats = computed(() => this.presentation().stats);
  protected readonly cliLabel = computed(() => this.presentation().cliLabel);
  protected readonly attachments = computed(() => this.presentation());
  protected readonly chips = computed(() => this.presentation().chips);
  protected readonly chipSummary = computed(() => this.chips().map(chip => chip.label).join(', '));
  protected readonly tone = computed<LaneEventTone>(() => this.chips().at(-1)?.tone ?? 'neutral');
  protected readonly timeline = computed(() => this.presentation().timeline);
  protected readonly avatarStatus = computed(() => {
    if (this.tone() === 'run') return 'running' as const;
    if (this.tone() === 'err') return 'failed' as const;
    if (this.tone() === 'done') return 'done' as const;
    return null;
  });
  protected time(timestamp: number): string { return laneEventTime(timestamp); }
  protected iso(timestamp: number): string { return new Date(timestamp).toISOString(); }
  protected markdown(body: string): string { return toUserMessageMarkdown(body); }
  protected fileName(path: string): string { return path.split(/[/\\]/).at(-1) || path; }
  protected openLane(): void { this.actions?.openLane(laneKey('cli', this.row().agentId)); }
  protected requestRewind(): void { if (this.isSessionActive()) this.rewindRequested.emit(this.lastMessageId()); }
}
