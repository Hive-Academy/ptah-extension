import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { ArrowUpRight, Bot, ChevronRight, GitBranch, Image, LucideAngularModule, Undo2, Users } from 'lucide-angular';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { laneKey } from '../compact-session/compact-lane-rows';
import { toUserMessageMarkdown } from '../../../utils/user-message-markdown.utils';
import type { LaneEventRow } from './lane-event-row.types';
import { deriveLaneEventPresentation, laneEventTime, type LaneEventTone } from './lane-event-row.presentation';

@Component({
  selector: 'ptah-lane-event',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, SurfaceMarkdownPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lane-event-row.component.html',
})
export class LaneEventRowComponent {
  readonly row = input.required<LaneEventRow>();
  readonly isSessionActive = input(false);
  readonly branchRequested = output<string>();
  readonly rewindRequested = output<string>();
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);
  protected readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });
  protected readonly expanded = signal(false);
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly BotIcon = Bot;
  protected readonly OpenIcon = ArrowUpRight;
  protected readonly ImageIcon = Image;
  protected readonly UsersIcon = Users;
  protected readonly BranchIcon = GitBranch;
  protected readonly RewindIcon = Undo2;
  protected readonly latest = computed(() => this.row().events[this.row().events.length - 1]);
  protected readonly completed = computed(() => this.latest().kind === 'completed');
  protected readonly lastMessageId = computed(() => this.latest().messageId);
  protected readonly bodyId = computed(() => 'lane-event-body-' + this.row().rowKey);
  protected readonly summary = computed(() => this.latest().body.split(/\r?\n/).find(line => line.trim())?.trim() ?? '');
  protected readonly canExpand = computed(() => this.row().events.length > 1 || this.latest().body.includes('\n'));
  protected readonly presentation = computed(() => deriveLaneEventPresentation(this.row()));
  protected readonly attachments = computed(() => this.presentation());
  protected readonly chips = computed(() => this.presentation().chips);
  protected readonly chipSummary = computed(() => this.chips().map(chip => chip.label).join(', '));
  protected readonly tone = computed<LaneEventTone>(() => this.chips().at(-1)?.tone ?? 'neutral');
  protected readonly timeline = computed(() => this.presentation().timeline);
  protected time(timestamp: number): string { return laneEventTime(timestamp); }
  protected iso(timestamp: number): string { return new Date(timestamp).toISOString(); }
  protected markdown(body: string): string { return toUserMessageMarkdown(body); }
  protected fileName(path: string): string { return path.split(/[/\\]/).at(-1) || path; }
  protected openLane(): void { this.actions?.openLane(laneKey('cli', this.row().agentId)); }
  protected requestRewind(): void { if (this.isSessionActive()) this.rewindRequested.emit(this.lastMessageId()); }
}
