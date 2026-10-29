import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { AgentAvatarComponent } from '@ptah-extension/chat-ui';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { ArrowUpRight, ChevronRight, GitBranch, Image, LucideAngularModule, Undo2 } from 'lucide-angular';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { laneKey } from '../compact-session/compact-lane-rows';
import { toUserMessageMarkdown } from '../../../utils/user-message-markdown.utils';
import type { LaneEventRow } from './lane-event-row.types';
import { deriveLaneEventPresentation, laneEventTime, parseLaneCompletion, type LaneEventMetrics, type LaneEventTone } from './lane-event-row.presentation';

@Component({
  selector: 'ptah-lane-event',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, SurfaceMarkdownPipe, AgentAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './lane-event-row.component.html',
  // The card takes a faint wash of its status color and the chip a soft pill
  // of its own text color, so the tone reads without heavy borders.
  styles: `
    .lane-card { --lane-tone: oklch(var(--bc)); background: color-mix(in srgb, var(--lane-tone) 5%, oklch(var(--b2) / 0.4)); }
    .lane-card[data-tone='run'] { --lane-tone: var(--state-ink-run, oklch(var(--in))); }
    .lane-card[data-tone='done'] { --lane-tone: var(--state-ink-done, oklch(var(--su))); }
    .lane-card[data-tone='need'] { --lane-tone: var(--state-ink-need, oklch(var(--wa))); }
    .lane-card[data-tone='err'] { --lane-tone: var(--state-ink-err, oklch(var(--er))); }
    .lane-chip { background: color-mix(in srgb, currentColor 12%, transparent); }
  `,
})
export class LaneEventRowComponent {
  readonly row = input.required<LaneEventRow>();
  readonly monitorAgent = input<LaneEventMetrics | null>(null);
  readonly monitorStatus = input<string | null>(null);
  readonly laterCompleted = input(false);
  readonly isSessionActive = input(false);
  readonly branchRequested = output<string>();
  readonly rewindRequested = output<string>();
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);
  protected readonly actions = inject(SESSION_CARD_ACTIONS, { optional: true });
  protected readonly expanded = signal(false);
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly OpenIcon = ArrowUpRight;
  protected readonly ImageIcon = Image;
  protected readonly BranchIcon = GitBranch;
  protected readonly RewindIcon = Undo2;
  protected readonly latest = computed(() => this.row().events[this.row().events.length - 1]);
  protected readonly completed = computed(() => this.row().events.some(event => event.kind === 'completed'));
  protected readonly lastMessageId = computed(() => this.latest().messageId);
  protected readonly bodyId = computed(() => 'lane-event-body-' + this.row().rowKey);
  protected readonly canExpand = computed(() => this.completed() || this.row().events.length > 1 ||
    this.latest().body.trim() !== this.presentation().summary.trim());
  protected readonly presentation = computed(() => deriveLaneEventPresentation(this.row(), this.monitorAgent(), this.laterCompleted(), this.monitorStatus()));
  protected readonly summary = computed(() => this.presentation().summary);
  protected readonly stats = computed(() => this.presentation().stats);
  protected readonly attachments = computed(() => this.presentation());
  protected readonly chip = computed(() => this.presentation().chip);
  protected readonly tone = computed<LaneEventTone>(() => this.chip().tone);
  protected readonly compactStats = computed(() => this.stats().map(stat => stat.compact).join(' · '));
  protected readonly statsTitle = computed(() => this.stats().map(stat => `${stat.label}: ${stat.value}`).join(' · '));
  protected readonly avatarStatus = computed(() => {
    if (this.tone() === 'run') return 'running' as const;
    if (this.tone() === 'err') return 'failed' as const;
    if (this.tone() === 'done') return 'done' as const;
    return null;
  });
  protected time(timestamp: number): string { return laneEventTime(timestamp); }
  protected iso(timestamp: number): string { return new Date(timestamp).toISOString(); }
  protected markdown(body: string): string { return toUserMessageMarkdown(body); }
  protected completionFor(body: string) { return parseLaneCompletion(body); }
  protected fileName(path: string): string { return path.split(/[/\\]/).at(-1) || path; }
  protected readonly canOpenLane = computed(() =>
    this.actions?.canOpenLane?.(laneKey('cli', this.row().agentId)) ?? true);
  protected openLane(): void { this.actions?.openLane(laneKey('cli', this.row().agentId)); }
  protected requestRewind(): void { if (this.isSessionActive()) this.rewindRequested.emit(this.lastMessageId()); }
}
