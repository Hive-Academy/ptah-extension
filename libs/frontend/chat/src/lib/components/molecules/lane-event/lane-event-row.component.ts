import { ChangeDetectionStrategy, Component, computed, inject, input, output, signal } from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import { SURFACE_ACTIVE } from '@ptah-extension/core';
import { ArrowUpRight, Bot, Check, ChevronRight, CircleHelp, FileText, GitBranch, Image, Info, LoaderCircle, LucideAngularModule, Square, TriangleAlert, Undo2, Users, X } from 'lucide-angular';
import { SESSION_CARD_ACTIONS } from '../../../tokens/session-context.token';
import { laneKey } from '../compact-session/compact-lane-rows';
import { toUserMessageMarkdown } from '../../../utils/user-message-markdown.utils';
import type { LaneEventRow } from '../../organisms/transcript/transcript-lane-events';

type Tone = 'run' | 'done' | 'need' | 'err' | 'neutral';
interface Chip { readonly label: string; readonly tone: Tone; readonly icon: typeof FileText; }

@Component({
  selector: 'ptah-lane-event',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, SurfaceMarkdownPipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article data-testid="lane-event" class="group my-1 rounded-lg border border-base-content/10 bg-base-200/40 px-3 py-2 text-xs border-l-[3px]"
      [class.border-l-state-run]="tone() === 'run'" [class.border-l-state-done]="tone() === 'done'"
      [class.border-l-state-need]="tone() === 'need'" [class.border-l-state-err]="tone() === 'err'"
      [class.border-l-base-content/30]="tone() === 'neutral'"
      [attr.aria-label]="row().agent + ' lane, ' + chipSummary()">
      <div class="flex items-center gap-2 min-w-0">
        <button type="button" data-testid="lane-event-toggle" class="flex items-center gap-2 min-w-0 flex-1 text-left rounded py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary hover:bg-base-content/5"
          [attr.aria-label]="(expanded() ? 'Collapse ' : 'Expand ') + row().agent + ' lane event'"
          [attr.aria-expanded]="expanded()" [attr.aria-controls]="bodyId()" (click)="expanded.update(v => !v)">
          <lucide-angular [img]="ChevronRightIcon" class="w-3.5 h-3.5 shrink-0 transition-transform duration-150 motion-reduce:transition-none" [class.rotate-90]="expanded()" aria-hidden="true" />
          <lucide-angular [img]="BotIcon" class="w-4 h-4 shrink-0" [class.text-state-run]="tone() === 'run'" [class.text-state-done]="tone() === 'done'" [class.text-state-need]="tone() === 'need'" [class.text-state-err]="tone() === 'err'" aria-hidden="true" />
          <span class="font-semibold whitespace-nowrap">{{ row().agent }}</span>
          <span class="text-base-content-muted truncate max-[360px]:hidden">{{ row().cli }}</span>
          @for (chip of chips(); track chip.label) {
            <span data-testid="lane-event-chip" class="inline-flex items-center gap-1 rounded border border-current px-1.5 text-[11px] leading-[18px] whitespace-nowrap"
              [class.text-state-run]="chip.tone === 'run'" [class.text-state-done]="chip.tone === 'done'"
              [class.text-state-need]="chip.tone === 'need'" [class.text-state-err]="chip.tone === 'err'"
              [class.text-base-content-muted]="chip.tone === 'neutral'">
              <lucide-angular [img]="chip.icon" class="w-3 h-3 motion-reduce:animate-none" aria-hidden="true" />{{ chip.label }}
            </span>
          }
          <time class="ml-auto text-base-content-muted tabular-nums" [attr.datetime]="iso(latest().timestamp)">{{ time(latest().timestamp) }}</time>
        </button>
        @if (actions && row().cli !== 'ptah-session') {
          <button type="button" data-testid="lane-event-open" class="btn btn-ghost btn-xs gap-1 text-base-content-muted hover:bg-base-content/10 hover:text-base-content focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
            [attr.aria-label]="'Open ' + row().agent + ' agent lane'" (click)="openLane()">
            <lucide-angular [img]="OpenIcon" class="w-3 h-3" aria-hidden="true" />Open lane
          </button>
        }
      </div>
      <p class="mt-0.5 pl-[22px] truncate text-xs text-base-content">{{ summary() }}</p>
      @if (canExpand()) {
        <button type="button" class="ml-[22px] btn btn-ghost btn-xs px-1 focus-visible:ring-2 focus-visible:ring-primary"
          data-testid="lane-event-show-more" [attr.aria-expanded]="expanded()" [attr.aria-controls]="bodyId()"
          (click)="expanded.update(v => !v)">{{ expanded() ? 'Show less' : 'Show more' }}</button>
      }
      <p class="pl-[22px] text-[11px] text-base-content-muted" data-testid="lane-event-peer-label"><lucide-angular [img]="UsersIcon" class="w-3 h-3 inline-block align-[-1px] mr-1" aria-hidden="true" />{{ row().peerLabel }}</p>
      <p class="pl-[22px] text-[11px] text-base-content-muted" data-testid="chat-peer-unverified-caption">Sent from another session — the sender name is self-reported and unverified.</p>
      @if (timeline().length) {
        <ol data-testid="lane-event-timeline" aria-label="Lane timeline" class="mt-1.5 pl-[22px] flex flex-wrap items-center gap-1.5 text-base-content-muted">
          @for (step of timeline(); track $index) {
            <li class="flex items-center gap-1"><span class="w-2 h-2 rounded-full border border-current" aria-hidden="true"></span>{{ step }}</li>
          }
        </ol>
      }
      <div [id]="bodyId()" data-testid="lane-event-body" [hidden]="!expanded()" class="pl-[22px] mt-2">
        @if (expanded()) {
        @for (event of row().events; track event.messageId; let first = $first) {
          <section [class.border-t]="!first" class="border-base-content/10 pt-2 mt-2">
            <h4 class="text-[11px] font-semibold text-base-content-muted">{{ event.kind === 'report' ? 'Report' : 'Completed' }}, {{ time(event.timestamp) }}@if (event.kind === 'completed' && event.verdict) { (verdict: {{ event.verdict }}) }</h4>
            <markdown [data]="markdown(event.body) | surfaceMarkdown: surfaceActive()" class="prose prose-sm max-w-none [&_*]:text-base-content" />
          </section>
        }
        }
      </div>
      @if (attachments().files.length || attachments().images) {
        <div class="pl-[22px] mt-1 flex flex-wrap gap-1 text-base-content-muted">
          @for (file of attachments().files; track $index) { <span class="badge badge-ghost badge-sm">{{ fileName(file) }}</span> }
          @if (attachments().images) { <span class="badge badge-ghost badge-sm"><lucide-angular [img]="ImageIcon" class="w-3 h-3" aria-hidden="true" />{{ attachments().images }} images</span> }
        </div>
      }
      <div class="flex gap-1 items-center mt-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity duration-200 motion-reduce:transition-none">
        <button type="button" class="btn btn-ghost btn-xs focus-visible:ring-2 focus-visible:ring-primary" title="Branch conversation from here" aria-label="Branch conversation from this message" data-testid="lane-event-branch" (click)="branchRequested.emit(lastMessageId())"><lucide-angular [img]="BranchIcon" class="w-3.5 h-3.5" aria-hidden="true" /></button>
        <button type="button" class="btn btn-ghost btn-xs focus-visible:ring-2 focus-visible:ring-primary" [title]="isSessionActive() ? 'Rewind file changes to here' : 'Rewind is only available during an active conversation'"
          [attr.aria-label]="isSessionActive() ? 'Rewind file changes to this message' : 'Rewind unavailable — session is not active'" [disabled]="!isSessionActive()" [attr.aria-disabled]="!isSessionActive()" data-testid="lane-event-rewind" (click)="requestRewind()"><lucide-angular [img]="RewindIcon" class="w-3.5 h-3.5" aria-hidden="true" /></button>
      </div>
      @if (completed()) { <span class="sr-only" role="status">{{ row().agent }} lane completed</span> }
    </article>
  `,
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
  protected readonly attachments = computed(() => ({
    files: this.row().events.flatMap(event => event.files ?? []),
    images: this.row().events.reduce((count, event) => count + (event.imageCount ?? 0), 0),
  }));
  protected readonly chips = computed<readonly Chip[]>(() => {
    const events = this.row().events;
    const reports = events.filter(event => event.kind === 'report').length;
    const chips: Chip[] = [];
    if (reports) chips.push({ label: reports === 1 ? 'Report' : `Report x${reports}`, tone: 'run', icon: FileText });
    const last = this.latest();
    if (last.kind === 'completed') {
      const verdict = last.verdict?.toLowerCase();
      const status = last.status?.toLowerCase();
      if (verdict === 'failed' || ['failed', 'error', 'timeout'].includes(status ?? '')) chips.push({ label: 'Failed', tone: 'err', icon: X });
      else if (['stopped', 'killed', 'cancelled'].includes(status ?? '')) chips.push({ label: 'Stopped', tone: 'neutral', icon: Square });
      else if (verdict === 'delivered') chips.push({ label: 'Completed', tone: 'done', icon: Check });
      else if (verdict === 'no-deliverable') chips.push({ label: 'No deliverable', tone: 'need', icon: TriangleAlert });
      else if (!verdict || verdict === 'unverified') chips.push({ label: 'Completed, unverified', tone: 'need', icon: CircleHelp });
      else chips.push({ label: this.humanize(verdict), tone: 'neutral', icon: Info });
    } else if (this.row().liveLane) chips.push({ label: 'Running', tone: 'run', icon: LoaderCircle });
    return chips;
  });
  protected readonly chipSummary = computed(() => this.chips().map(chip => chip.label).join(', '));
  protected readonly tone = computed<Tone>(() => this.chips().at(-1)?.tone ?? 'neutral');
  protected readonly timeline = computed(() => {
    const events = this.row().events;
    const completion = events.filter(event => event.kind === 'completed').at(-1);
    const visible = completion
      ? [...events.filter(event => event.kind === 'report').slice(-3), completion]
      : events.slice(this.row().liveLane ? -3 : -4);
    const steps: string[] = [];
    const earlier = this.row().earlier.at(-1);
    if (earlier) steps.push(`Earlier report ${this.time(earlier.timestamp)}`);
    if (events.length > visible.length) steps.push(`+${events.length - visible.length} earlier`);
    for (const event of visible) steps.push(`${event.kind === 'report' ? 'Report' : 'Completed'} ${this.time(event.timestamp)}`);
    if (!this.completed() && this.row().liveLane) steps.push('Completion pending');
    return steps;
  });
  protected time(timestamp: number): string { return new Date(timestamp).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true }); }
  protected iso(timestamp: number): string { return new Date(timestamp).toISOString(); }
  protected markdown(body: string): string { return toUserMessageMarkdown(body); }
  protected fileName(path: string): string { return path.split(/[/\\]/).at(-1) || path; }
  protected openLane(): void { this.actions?.openLane(laneKey('cli', this.row().agentId)); }
  protected requestRewind(): void { if (this.isSessionActive()) this.rewindRequested.emit(this.lastMessageId()); }
  private humanize(value: string): string { const text = value.replace(/-/g, ' '); return text.charAt(0).toUpperCase() + text.slice(1); }
}
