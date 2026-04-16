import {
  Component,
  ChangeDetectionStrategy,
  inject,
  computed,
  ElementRef,
  viewChild,
  effect,
} from '@angular/core';
import {
  LucideAngularModule,
  Brain,
  Wrench,
  AlertTriangle,
  CheckCircle,
  Loader2,
  MessageSquare,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';
import { HarnessStreamingService } from '../services/harness-streaming.service';
import type { StreamBlock } from '../services/harness-streaming.service';

@Component({
  selector: 'ptah-harness-execution-view',
  standalone: true,
  imports: [LucideAngularModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        height: 100%;
        width: 100%;
      }
    `,
  ],
  template: `
    <div class="flex flex-col h-full bg-base-100">
      <!-- Header bar -->
      <div
        class="flex items-center justify-between px-4 py-3 border-b border-base-300 bg-base-200/50 shrink-0"
      >
        <div class="flex items-center gap-2">
          @if (streaming.isStreaming()) {
            <span
              class="loading loading-spinner loading-sm text-primary"
            ></span>
          } @else if (streaming.hasError()) {
            <lucide-angular
              [img]="AlertTriangleIcon"
              class="w-4 h-4 text-error"
              aria-hidden="true"
            />
          } @else {
            <lucide-angular
              [img]="CheckCircleIcon"
              class="w-4 h-4 text-success"
              aria-hidden="true"
            />
          }
          <span class="text-sm font-semibold">
            {{ operationLabel() }}
          </span>
        </div>

        <div class="flex items-center gap-3 text-xs text-base-content/50">
          @if (streaming.toolCallCount() > 0) {
            <span class="flex items-center gap-1">
              <lucide-angular
                [img]="WrenchIcon"
                class="w-3 h-3"
                aria-hidden="true"
              />
              {{ streaming.toolCallCount() }} tool calls
            </span>
          }
        </div>
      </div>

      <!-- Scrollable transcript with accumulated blocks -->
      <div
        #scrollContainer
        class="flex-1 overflow-y-auto p-4 space-y-3"
        role="log"
        aria-label="Agent execution transcript"
      >
        @for (block of streaming.blocks(); track block.id) {
          @switch (block.kind) {
            @case ('thinking') {
              <div
                class="px-4 py-3 rounded-lg bg-base-200/60 border-l-3 border-info/40"
              >
                <div
                  class="flex items-center gap-2 mb-1.5 text-xs font-medium text-info/70"
                >
                  <lucide-angular
                    [img]="BrainIcon"
                    class="w-3.5 h-3.5"
                    aria-hidden="true"
                  />
                  Thinking
                </div>
                <p
                  class="text-xs text-base-content/70 whitespace-pre-wrap leading-relaxed"
                >
                  {{ block.content }}
                </p>
              </div>
            }
            @case ('text') {
              <div class="px-4 py-3">
                <div
                  class="prose prose-sm prose-invert max-w-none text-base-content whitespace-pre-wrap leading-relaxed"
                >
                  {{ block.content }}
                </div>
              </div>
            }
            @case ('tool') {
              <div class="rounded-lg border border-base-300 overflow-hidden">
                <!-- Tool header -->
                <div class="flex items-center gap-2 px-3 py-2 bg-base-200">
                  <lucide-angular
                    [img]="WrenchIcon"
                    class="w-3.5 h-3.5 text-secondary shrink-0"
                    aria-hidden="true"
                  />
                  <span class="font-mono text-xs font-semibold text-secondary">
                    {{ block.toolName }}
                  </span>
                  @if (block.isActive) {
                    <span
                      class="loading loading-dots loading-xs text-secondary"
                    ></span>
                  } @else if (block.toolIsError) {
                    <span class="badge badge-xs badge-error">error</span>
                  } @else if (block.toolResult !== undefined) {
                    <span class="badge badge-xs badge-success">done</span>
                  }
                </div>

                <!-- Tool input -->
                @if (block.toolInput) {
                  <div class="px-3 py-2 border-t border-base-300/50">
                    <pre
                      class="text-xs text-base-content/50 overflow-x-auto max-h-32 font-mono"
                      >{{ truncate(block.toolInput, 800) }}</pre
                    >
                  </div>
                }

                <!-- Tool result -->
                @if (block.toolResult !== undefined) {
                  <div
                    class="px-3 py-2 border-t border-base-300/50 text-xs"
                    [class.text-success]="!block.toolIsError"
                    [class.text-error]="block.toolIsError"
                  >
                    <pre class="overflow-x-auto max-h-48 font-mono">{{
                      truncate(block.toolResult, 1200)
                    }}</pre>
                  </div>
                }
              </div>
            }
            @case ('error') {
              <div
                class="flex items-start gap-2 px-4 py-3 rounded-lg bg-error/10 border-l-3 border-error"
              >
                <lucide-angular
                  [img]="AlertTriangleIcon"
                  class="w-4 h-4 text-error mt-0.5 shrink-0"
                  aria-hidden="true"
                />
                <p class="text-sm text-error whitespace-pre-wrap">
                  {{ block.content }}
                </p>
              </div>
            }
            @case ('status') {
              <div class="px-4 py-1 text-xs text-base-content/40 italic">
                {{ block.content }}
              </div>
            }
          }
        }

        @if (streaming.isStreaming() && streaming.blocks().length === 0) {
          <div class="flex items-center justify-center h-32">
            <div class="text-center">
              <lucide-angular
                [img]="Loader2Icon"
                class="w-6 h-6 animate-spin text-primary mx-auto"
                aria-hidden="true"
              />
              <p class="mt-2 text-xs text-base-content/50">
                Waiting for agent response...
              </p>
            </div>
          </div>
        }
      </div>

      <!-- Completion footer -->
      @if (!streaming.isStreaming() && streaming.completionResult()) {
        <div
          class="px-4 py-3 border-t border-base-300 shrink-0"
          [class.bg-success/5]="!streaming.hasError()"
          [class.bg-error/5]="streaming.hasError()"
        >
          @if (streaming.hasError()) {
            <div class="flex items-center gap-2 text-error text-sm">
              <lucide-angular
                [img]="AlertTriangleIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              <span>{{ streaming.errorMessage() }}</span>
            </div>
          } @else {
            <div class="flex items-center gap-2 text-success text-sm">
              <lucide-angular
                [img]="CheckCircleIcon"
                class="w-4 h-4"
                aria-hidden="true"
              />
              <span>Analysis complete</span>
            </div>
          }
        </div>
      }
    </div>
  `,
})
export class HarnessExecutionViewComponent {
  protected readonly streaming = inject(HarnessStreamingService);

  protected readonly BrainIcon = Brain;
  protected readonly WrenchIcon = Wrench;
  protected readonly AlertTriangleIcon = AlertTriangle;
  protected readonly CheckCircleIcon = CheckCircle;
  protected readonly Loader2Icon = Loader2;
  protected readonly MessageSquareIcon = MessageSquare;
  protected readonly ChevronDownIcon = ChevronDown;
  protected readonly ChevronRightIcon = ChevronRight;

  private readonly scrollContainer =
    viewChild<ElementRef<HTMLDivElement>>('scrollContainer');

  protected readonly operationLabel = computed(() => {
    const op = this.streaming.currentOperation();
    if (!op) return 'Agent Execution';
    const labels: Record<string, string> = {
      'analyze-intent': 'Architecting Harness',
      'suggest-config': 'Generating Suggestions',
      'design-agents': 'Designing Agent Fleet',
      'generate-skills': 'Generating Skills',
      'generate-document': 'Generating Document',
      chat: 'AI Chat',
    };
    return labels[op] ?? 'Agent Execution';
  });

  constructor() {
    effect(() => {
      this.streaming.blocks();
      const container = this.scrollContainer()?.nativeElement;
      if (container) {
        requestAnimationFrame(() => {
          container.scrollTop = container.scrollHeight;
        });
      }
    });
  }

  protected truncate(text: string, maxLength: number): string {
    if (text.length <= maxLength) return text;
    return text.substring(0, maxLength) + '...';
  }
}
