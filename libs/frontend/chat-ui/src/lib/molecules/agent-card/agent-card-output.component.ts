import { SURFACE_ACTIVE } from '@ptah-extension/core';
/**
 * Agent Card Output Component
 *
 * Renders all segment types (text, thinking, tool-call, tool-result, etc.)
 * with auto-scroll to bottom on new content.
 */

import {
  signal,
  inject,
  Component,
  computed,
  input,
  effect,
  untracked,
  ChangeDetectionStrategy,
  DestroyRef,
  ElementRef,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { SurfaceMarkdownPipe } from '@ptah-extension/markdown';
import type { RenderSegment, StderrSegment } from './agent-card.types';
import { LaneResultCardComponent } from '../lane-result/lane-result-card.component';
import { LaneResultPipe } from '../lane-result/lane-result.pipe';

interface KeyedRenderSegment {
  readonly key: string;
  readonly segment: RenderSegment;
}

/** The last segment's text while it is still streaming. */
interface TailText {
  readonly index: number;
  readonly content: string;
}

/**
 * Minimum time between two markdown renders of the streaming tail segment.
 * Only the last text segment changes while output streams; earlier segments
 * are final and render once.
 */
const TAIL_MARKDOWN_THROTTLE_MS = 150;

@Component({
  selector: 'ptah-agent-card-output',
  standalone: true,
  imports: [
    SurfaceMarkdownPipe,
    MarkdownModule,
    NgClass,
    LaneResultPipe,
    LaneResultCardComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // `.ptah-superpower-badge` and `.ptah-gold-border` are defined once globally
  // in apps/ptah-extension-webview/src/styles.css, keyed off the theme-aware
  // `--ptah-gold*` tokens. Only `.ptah-tool-name-text` — used nowhere else —
  // stays local, and it reads the same token.
  styles: [
    `
      .ptah-tool-name-text {
        color: var(--ptah-gold);
      }
    `,
  ],
  template: `
    <div
      #outputContainer
      [class]="
        embedded()
          ? ''
          : 'border-t border-base-content/5 h-full overflow-y-auto'
      "
    >
      <div class="p-2 space-y-1.5">
        @for (keyedSegment of keyedSegments(); track keyedSegment.key) {
          @let segment = keyedSegment.segment;
          @switch (segment.type) {
            @case ('heading') {
              <div class="flex items-center gap-1.5 mt-2.5 mb-1 first:mt-0">
                <span
                  class="w-1 h-3 rounded-full bg-warning/70 flex-shrink-0"
                ></span>
                <span
                  class="text-[10px] font-semibold text-warning/90 uppercase tracking-wide"
                >
                  {{ segment.content }}
                </span>
              </div>
            }
            @case ('tool-call') {
              <div
                [class]="
                  segment.toolName?.startsWith('mcp__ptah')
                    ? 'bg-base-200/60 rounded border ptah-gold-border overflow-hidden'
                    : 'bg-base-200/60 rounded border border-base-content/5 overflow-hidden'
                "
              >
                <div class="flex items-center gap-1.5 px-2 py-1">
                  @if (segment.toolName?.startsWith('mcp__ptah')) {
                    <span
                      class="badge badge-xs font-mono px-1.5 ptah-superpower-badge"
                      >Ptah Superpower</span
                    >
                    <code class="text-[10px] font-mono ptah-tool-name-text">{{
                      formatPtahToolName(segment.toolName)
                    }}</code>
                  } @else {
                    <span class="text-[10px] font-medium text-info">Tool:</span>
                    <code class="text-[10px] font-mono text-accent">{{
                      segment.toolName
                    }}</code>
                  }
                  @if (segment.toolArgs) {
                    <span
                      class="text-[10px] text-base-content-muted truncate ml-auto font-mono"
                      >{{ segment.toolArgs }}</span
                    >
                  }
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/5 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre>
                  </div>
                }
              </div>
            }
            @case ('tool') {
              <div
                [class]="
                  segment.toolName?.startsWith('mcp__ptah')
                    ? 'bg-base-200/60 rounded border ptah-gold-border overflow-hidden'
                    : 'bg-base-200/60 rounded border border-base-content/5 overflow-hidden'
                "
              >
                <div class="flex items-center gap-1.5 px-2 py-1">
                  @if (segment.toolName?.startsWith('mcp__ptah')) {
                    <span
                      class="badge badge-xs font-mono px-1.5 ptah-superpower-badge"
                      >Ptah Superpower</span
                    >
                    <code class="text-[10px] font-mono ptah-tool-name-text">{{
                      formatPtahToolName(segment.toolName)
                    }}</code>
                  } @else {
                    <span class="text-[10px] font-medium text-info">Tool:</span>
                    <code class="text-[10px] font-mono text-accent">{{
                      segment.toolName
                    }}</code>
                  }
                  @if (segment.toolArgs) {
                    <span
                      class="text-[10px] text-base-content-muted truncate ml-auto font-mono"
                      >{{ segment.toolArgs }}</span
                    >
                  }
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/5 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre>
                  </div>
                }
              </div>
            }
            @case ('tool-result') {
              <div
                class="bg-base-200/30 rounded border border-base-content/5 overflow-hidden"
              >
                <div class="flex items-center gap-1.5 px-2 py-0.5">
                  <span class="text-[10px] text-base-content-muted"
                    >Tool result</span
                  >
                </div>
                @if (segment.content) {
                  <div class="px-2 py-1 max-h-32 overflow-y-auto">
                    <pre
                      class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre>
                  </div>
                }
              </div>
            }
            @case ('tool-result-error') {
              <div
                class="bg-error/5 rounded border border-error/15 overflow-hidden"
              >
                <div class="flex items-center gap-1.5 px-2 py-0.5">
                  <span class="text-[10px] text-error/70"
                    >Tool result (error)</span
                  >
                </div>
                @if (segment.content) {
                  <div class="px-2 py-1 max-h-32 overflow-y-auto">
                    <pre
                      class="text-[10px] font-mono text-error/80 whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre>
                  </div>
                }
              </div>
            }
            @case ('error') {
              <div class="bg-error/10 rounded px-2 py-1 border border-error/20">
                <pre
                  class="text-[10px] font-mono text-error whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre>
              </div>
            }
            @case ('info') {
              <div
                class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
              >
                <pre
                  class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre>
              </div>
            }
            @case ('command') {
              <div
                class="bg-neutral/80 rounded border border-base-content/10 overflow-hidden"
              >
                <div class="px-2 py-1">
                  <pre
                    class="text-[10px] font-mono text-neutral-content whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >
$ {{ segment.toolName }}</pre>
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/10 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre>
                  </div>
                }
                @if (segment.exitCode !== undefined && segment.exitCode !== 0) {
                  <div class="border-t border-error/20 px-2 py-0.5 bg-error/10">
                    <span class="text-[10px] font-mono text-error"
                      >exit {{ segment.exitCode }}</span
                    >
                  </div>
                }
              </div>
            }
            @case ('file-change') {
              <div
                class="inline-flex items-center gap-1 bg-base-200/50 rounded px-1.5 py-0.5 border border-base-content/5"
              >
                <span
                  class="text-[9px] font-semibold uppercase tracking-wider"
                  [ngClass]="{
                    'text-success': segment.changeKind === 'added',
                    'text-info': segment.changeKind === 'modified',
                    'text-error': segment.changeKind === 'deleted',
                    'text-base-content-muted':
                      segment.changeKind !== 'added' &&
                      segment.changeKind !== 'modified' &&
                      segment.changeKind !== 'deleted',
                  }"
                  >{{ segment.changeKind }}</span
                >
                <code class="text-[10px] font-mono text-base-content-muted">{{
                  segment.content
                }}</code>
              </div>
            }
            @case ('thinking') {
              <details
                class="bg-base-200/30 rounded border border-base-content/5 overflow-hidden"
              >
                <summary
                  class="flex items-center gap-1.5 px-2 py-1 cursor-pointer select-none hover:bg-base-200/50 transition-colors"
                >
                  <span class="text-[10px] font-medium text-base-content-muted"
                    >Thinking</span
                  >
                </summary>
                <div
                  class="border-t border-base-content/5 px-2 py-1 max-h-32 overflow-y-auto"
                >
                  <pre
                    class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                    >{{ segment.content }}</pre>
                </div>
              </details>
            }
            @case ('stderr-info') {
              <div
                class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
              >
                <pre
                  class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre>
              </div>
            }
            @case ('text') {
              @if (segment.content.trim()) {
                <!-- Trailing WROTE lines become a result card, parsed from
                     the raw text; the markdown gets the rest. -->
                @let source = markdownSource(segment, $index);
                @let lane = source | laneResult;
                @if (lane ? lane.body.trim() : true) {
                  <div
                    class="prose prose-xs prose-invert max-w-none agent-prose"
                  >
                    <markdown
                      [data]="
                        (lane ? lane.body : source)
                          | surfaceMarkdown: surfaceActive()
                      "
                    />
                  </div>
                }
                @if (lane) {
                  <ptah-lane-result-card [result]="lane" />
                }
              }
            }
          }
        }
        @for (seg of stderrSegments(); track $index) {
          @if (seg.type === 'error') {
            <div
              class="bg-error/10 rounded px-2 py-1 border border-error/20 mt-1"
            >
              <pre
                class="text-[10px] font-mono text-error whitespace-pre-wrap break-words m-0 leading-relaxed"
                >{{ seg.content }}</pre>
            </div>
          } @else {
            <div
              class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5 mt-1"
            >
              <pre
                class="text-[10px] font-mono text-base-content-muted whitespace-pre-wrap break-words m-0 leading-relaxed"
                >{{ seg.content }}</pre>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class AgentCardOutputComponent {
  protected readonly surfaceActive = inject(SURFACE_ACTIVE);

  readonly segments = input.required<RenderSegment[]>();
  readonly embedded = input(false);
  readonly stderrSegments = input.required<StderrSegment[]>();
  /**
   * Segments keyed by position and type. Output grows by appending (or by
   * extending the last segment), so every existing view keeps its key and is
   * reused; only a type change at an index, or a front trim, re-creates views.
   */
  readonly keyedSegments = computed<readonly KeyedRenderSegment[]>(() =>
    this.segments().map((segment, index) => ({
      key: `${index}:${segment.type}`,
      segment,
    })),
  );

  /** The last segment's text, when the last segment is text. */
  private readonly liveTail = computed<TailText | null>(
    () => {
      const segments = this.segments();
      const index = segments.length - 1;
      const last = segments[index];
      return last?.type === 'text' ? { index, content: last.content } : null;
    },
    {
      equal: (a, b) =>
        a === b ||
        (a !== null &&
          b !== null &&
          a.index === b.index &&
          a.content === b.content),
    },
  );

  /**
   * What the tail's markdown renders: the live tail, at most once per
   * {@link TAIL_MARKDOWN_THROTTLE_MS}, always with the latest content on the
   * trailing edge.
   */
  private readonly renderedTail = signal<TailText | null>(null);
  private tailTimer: ReturnType<typeof setTimeout> | null = null;
  private lastTailRenderAt = 0;
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  /** Tracking signal for change detection — incremented externally to trigger scroll */
  readonly scrollTrigger = input<number>(0);

  protected formatPtahToolName(toolName: string | undefined): string {
    if (!toolName) return '';
    const match = toolName.match(/^mcp__ptah__(.+)$/);
    return match ? match[1].replace(/_/g, ' ') : toolName;
  }

  /**
   * Markdown source for a text segment. The streaming tail reads the
   * throttled copy; every other segment (including a former tail, the moment
   * a new segment follows it) binds its own, final content.
   */
  protected markdownSource(segment: RenderSegment, index: number): string {
    const rendered = this.renderedTail();
    return rendered !== null &&
      rendered.index === index &&
      index === this.segments().length - 1
      ? rendered.content
      : segment.content;
  }

  private applyTail(tail: TailText | null): void {
    this.renderedTail.set(tail);
    this.lastTailRenderAt = Date.now();
  }

  private clearTailTimer(): void {
    if (this.tailTimer !== null) {
      clearTimeout(this.tailTimer);
      this.tailTimer = null;
    }
  }

  constructor() {
    inject(DestroyRef).onDestroy(() => this.clearTailTimer());

    effect(() => {
      const tail = this.liveTail();
      const shown = untracked(this.renderedTail);
      // A new tail segment (or none) renders at once; only growth of the same
      // segment is throttled.
      if (tail === null || shown === null || shown.index !== tail.index) {
        this.clearTailTimer();
        this.applyTail(tail);
        return;
      }
      if (shown.content === tail.content || this.tailTimer !== null) return;
      const wait =
        TAIL_MARKDOWN_THROTTLE_MS - (Date.now() - this.lastTailRenderAt);
      if (wait <= 0) {
        this.applyTail(tail);
        return;
      }
      this.tailTimer = setTimeout(() => {
        this.tailTimer = null;
        this.applyTail(untracked(this.liveTail));
      }, wait);
    });

    effect(() => {
      if (this.embedded()) return;
      this.segments();
      this.stderrSegments();
      this.scrollTrigger();
      const el = this.outputContainer()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }
}
