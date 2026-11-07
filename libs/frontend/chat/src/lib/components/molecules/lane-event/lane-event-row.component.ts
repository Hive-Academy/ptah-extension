import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { AgentAvatarComponent } from '@ptah-extension/chat-ui';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { AgentDeliveryStore, type ParentDeliveryItem } from '@ptah-extension/chat-streaming';
import { DeliveryStatusComponent } from '../delivery-status/delivery-status.component';
import { ChevronRight, GitBranch, Image, LucideAngularModule, Undo2, MessageSquareText, CircleCheckBig, CircleX } from 'lucide-angular';
import { toUserMessageMarkdown } from '../../../utils/user-message-markdown.utils';
import type { LaneEventRow } from './lane-event-row.types';
import { deriveLaneEventPresentation, laneEventTime, parseLaneCompletion, type LaneEventMetrics, type LaneEventTone } from './lane-event-row.presentation';

/** About what line 2 shows, after its indent and caption, at the narrow card minimum. */
const LONG_SUMMARY_CHARS = 20;

const PARENT_DELIVERY_KINDS = ['completion', 'report'] as const;

interface ParentDeliveryEntry {
  readonly kind: (typeof PARENT_DELIVERY_KINDS)[number];
  readonly item: ParentDeliveryItem;
  readonly attention: boolean;
}

@Component({
  selector: 'ptah-lane-event',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, SurfaceMarkdownPipe, AgentAvatarComponent, DeliveryStatusComponent],
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
  private readonly delivery = inject(AgentDeliveryStore, { optional: true });
  protected readonly expanded = signal(false);
  protected readonly ChevronRightIcon = ChevronRight;
  protected readonly ImageIcon = Image;
  protected readonly BranchIcon = GitBranch;
  protected readonly RewindIcon = Undo2;
  protected readonly ReportIcon = MessageSquareText;
  protected readonly CompletionIcon = CircleCheckBig;
  protected readonly FailedIcon = CircleX;
  protected verdict(value: string | undefined): string {
    switch (value) {
      case 'delivered': return 'Deliverables written';
      case 'no-deliverable': return 'No deliverable';
      case 'failed': return 'Failed';
      default: return 'Unverified';
    }
  }
  /**
   * The newest completion and report deliveries to the parent; none when no
   * push or hydration reported one. An item that needs the user shows on the
   * collapsed card; the others show in the expanded body.
   */
  private readonly parentDeliveries = computed<readonly ParentDeliveryEntry[]>(() => {
    const store = this.delivery;
    if (!store) return [];
    const agentId = this.row().agentId;
    return PARENT_DELIVERY_KINDS.flatMap((kind) => {
      const item = store.latestParentDelivery(agentId, kind);
      return item ? [{ kind, item, attention: store.parentStatus(item).attention }] : [];
    });
  });
  protected readonly attentionDeliveries = computed(() => this.parentDeliveries().filter((entry) => entry.attention));
  protected readonly quietDeliveries = computed(() => this.parentDeliveries().filter((entry) => !entry.attention));
  protected deliverySubject(kind: 'report' | 'completion'): string {
    return `${kind} from ${this.row().agent} to the parent`;
  }
  protected readonly latest = computed(() => this.row().events[this.row().events.length - 1]);
  protected readonly completed = computed(() => this.row().events.some(event => event.kind === 'completed'));
  protected readonly lastMessageId = computed(() => this.latest().messageId);
  protected readonly bodyId = computed(() => 'lane-event-body-' + this.row().rowKey);
  // A long one-line report is truncated on line 2, so it must expand too.
  protected readonly canExpand = computed(() => this.completed() || this.row().events.length > 1 ||
    this.latest().body.trim() !== this.presentation().summary.trim() ||
    this.presentation().summary.length > LONG_SUMMARY_CHARS);
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
  protected newDateLabel(timestamp: number): string { return new Date(timestamp).toLocaleString(); }
  protected markdown(body: string): string { return toUserMessageMarkdown(body); }
  protected completionFor(body: string) { return parseLaneCompletion(body); }
  protected fileName(path: string): string { return path.split(/[/\\]/).at(-1) || path; }
  protected requestRewind(): void { if (this.isSessionActive()) this.rewindRequested.emit(this.lastMessageId()); }
}
