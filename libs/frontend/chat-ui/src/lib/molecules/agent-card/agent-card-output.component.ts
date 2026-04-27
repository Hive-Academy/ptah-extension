/**
 * Agent Card Output Component
 *
 * Renders all segment types (text, thinking, tool-call, tool-result, etc.)
 * with auto-scroll to bottom on new content.
 */

import {
  Component,
  input,
  effect,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { NgClass } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import type { RenderSegment, StderrSegment } from './agent-card.types';

@Component({
  selector: 'ptah-agent-card-output',
  standalone: true,
  imports: [MarkdownModule, NgClass],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      .ptah-superpower-badge {
        background: linear-gradient(
          135deg,
          #b8860b,
          #daa520,
          #ffd700,
          #daa520,
          #b8860b
        );
        background-size: 200% 200%;
        animation: ptah-gold-shimmer 3s ease infinite;
        color: #1a1a2e;
        font-weight: 600;
        border: 1px solid rgba(218, 165, 32, 0.5);
        text-shadow: 0 0 1px rgba(255, 215, 0, 0.3);
      }
      .ptah-tool-name-text {
        color: #daa520;
      }
      .ptah-gold-border {
        border-color: rgba(218, 165, 32, 0.4);
        box-shadow: 0 0 6px rgba(218, 165, 32, 0.1);
      }
      @keyframes ptah-gold-shimmer {
        0% {
          background-position: 0% 50%;
        }
        50% {
          background-position: 100% 50%;
        }
        100% {
          background-position: 0% 50%;
        }
      }
    `,
  ],
  template: `
    <div
      #outputContainer
      class="border-t border-base-content/5 h-full overflow-y-auto"
    >
      <div class="p-2 space-y-1.5">
        @for (segment of segments(); track $index) {
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
                      class="text-[10px] text-base-content/40 truncate ml-auto font-mono"
                      >{{ segment.toolArgs }}</span
                    >
                  }
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/5 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content/70 whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre
                    >
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
                      class="text-[10px] text-base-content/40 truncate ml-auto font-mono"
                      >{{ segment.toolArgs }}</span
                    >
                  }
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/5 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content/70 whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre
                    >
                  </div>
                }
              </div>
            }
            @case ('tool-result') {
              <div
                class="bg-base-200/30 rounded border border-base-content/5 overflow-hidden"
              >
                <div class="flex items-center gap-1.5 px-2 py-0.5">
                  <span class="text-[10px] text-base-content/40"
                    >Tool result</span
                  >
                </div>
                @if (segment.content) {
                  <div
                    class="px-2 py-1 max-h-32 overflow-y-auto prose prose-xs prose-invert max-w-none agent-prose"
                  >
                    <markdown [data]="segment.content" />
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
                      >{{ segment.content }}</pre
                    >
                  </div>
                }
              </div>
            }
            @case ('error') {
              <div class="bg-error/10 rounded px-2 py-1 border border-error/20">
                <pre
                  class="text-[10px] font-mono text-error whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre
                >
              </div>
            }
            @case ('info') {
              <div
                class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
              >
                <pre
                  class="text-[10px] font-mono text-base-content/40 whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre
                >
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
$ {{ segment.toolName }}</pre
                  >
                </div>
                @if (segment.content) {
                  <div
                    class="border-t border-base-content/10 px-2 py-1 max-h-24 overflow-y-auto"
                  >
                    <pre
                      class="text-[10px] font-mono text-base-content/60 whitespace-pre-wrap break-words m-0 leading-relaxed"
                      >{{ segment.content }}</pre
                    >
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
                    'text-base-content/50':
                      segment.changeKind !== 'added' &&
                      segment.changeKind !== 'modified' &&
                      segment.changeKind !== 'deleted',
                  }"
                  >{{ segment.changeKind }}</span
                >
                <code class="text-[10px] font-mono text-base-content/70">{{
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
                  <span class="text-[10px] font-medium text-base-content/50"
                    >Thinking</span
                  >
                </summary>
                <div
                  class="border-t border-base-content/5 px-2 py-1 max-h-32 overflow-y-auto"
                >
                  <pre
                    class="text-[10px] font-mono text-base-content/40 whitespace-pre-wrap break-words m-0 leading-relaxed"
                    >{{ segment.content }}</pre
                  >
                </div>
              </details>
            }
            @case ('stderr-info') {
              <div
                class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
              >
                <pre
                  class="text-[10px] font-mono text-base-content/35 whitespace-pre-wrap break-words m-0 leading-relaxed"
                  >{{ segment.content }}</pre
                >
              </div>
            }
            @case ('text') {
              @if (segment.content.trim()) {
                <div class="prose prose-xs prose-invert max-w-none agent-prose">
                  <markdown [data]="segment.content" />
                </div>
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
                >{{ seg.content }}</pre
              >
            </div>
          } @else {
            <div
              class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5 mt-1"
            >
              <pre
                class="text-[10px] font-mono text-base-content/40 whitespace-pre-wrap break-words m-0 leading-relaxed"
                >{{ seg.content }}</pre
              >
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class AgentCardOutputComponent {
  readonly segments = input.required<RenderSegment[]>();
  readonly stderrSegments = input.required<StderrSegment[]>();

  // Auto-scroll to bottom
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  /** Tracking signal for change detection — incremented externally to trigger scroll */
  readonly scrollTrigger = input<number>(0);

  protected formatPtahToolName(toolName: string | undefined): string {
    if (!toolName) return '';
    const match = toolName.match(/^mcp__ptah__(.+)$/);
    return match ? match[1].replace(/_/g, ' ') : toolName;
  }

  constructor() {
    effect(() => {
      // Read inputs to track changes
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
