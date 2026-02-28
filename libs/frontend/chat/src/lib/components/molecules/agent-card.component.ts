/**
 * Agent Card Component
 *
 * Displays a single monitored agent in the agent monitor sidebar.
 * Shows: CLI badge, status badge, elapsed time, task description,
 * and collapsible output panel with structured formatting for
 * tool calls, plan sections, and text content.
 */

import {
  Component,
  input,
  output,
  computed,
  effect,
  inject,
  ChangeDetectionStrategy,
  ElementRef,
  viewChild,
} from '@angular/core';
import { LucideAngularModule, ChevronDown, ChevronRight } from 'lucide-angular';
import { NgClass, SlicePipe } from '@angular/common';
import { MarkdownModule } from 'ngx-markdown';
import { AgentMonitorStore } from '../../services/agent-monitor.store';
import type { MonitoredAgent } from '../../services/agent-monitor.store';

/**
 * Unified output segment for rendering.
 * Superset of CliOutputSegment (from shared) + fallback-only types (heading, stderr-info, tool).
 * Using a single interface avoids union-narrowing issues in Angular's strict template checker.
 */
interface RenderSegment {
  readonly type:
    | 'text'
    | 'tool-call'
    | 'tool-result'
    | 'tool-result-error'
    | 'error'
    | 'info'
    | 'command'
    | 'file-change'
    | 'heading'
    | 'stderr-info'
    | 'tool';
  readonly content: string;
  readonly toolName?: string;
  readonly toolArgs?: string;
  readonly exitCode?: number;
  readonly changeKind?: string;
}

/** Parsed stderr segment — informational vs actual error */
interface StderrSegment {
  type: 'info' | 'error';
  content: string;
}

@Component({
  selector: 'ptah-agent-card',
  standalone: true,
  imports: [LucideAngularModule, MarkdownModule, NgClass, SlicePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div
      class="border border-base-content/10 rounded-lg overflow-hidden bg-base-100 flex flex-col h-full"
    >
      <!-- Header -->
      <button
        type="button"
        class="flex items-center gap-2 w-full px-3 py-2 text-left hover:bg-base-200/50 transition-colors flex-shrink-0"
        (click)="toggleExpanded.emit()"
      >
        <!-- Expand/collapse icon -->
        <lucide-angular
          [img]="agent().expanded ? ChevronDownIcon : ChevronRightIcon"
          class="w-3 h-3 text-base-content/50 flex-shrink-0"
        />

        <!-- CLI badge -->
        <span
          class="badge badge-sm badge-outline font-mono text-[10px] flex-shrink-0"
        >
          {{ agent().cli }}
        </span>

        <!-- Status badge -->
        <span
          class="badge badge-sm flex-shrink-0"
          [class.badge-info]="agent().status === 'running'"
          [class.badge-success]="agent().status === 'completed'"
          [class.badge-error]="
            agent().status === 'failed' || agent().status === 'timeout'
          "
          [class.badge-warning]="agent().status === 'stopped'"
        >
          {{ agent().status }}
        </span>

        <!-- Elapsed time -->
        <span class="text-[10px] text-base-content/40 ml-auto flex-shrink-0">
          {{ elapsedDisplay() }}
        </span>

        <!-- CLI Session ID badge (Gemini resume capability) -->
        @if (agent().cliSessionId) {
        <span
          class="badge badge-xs badge-ghost font-mono text-[9px] text-base-content/30 ml-1 flex-shrink-0"
          [title]="'CLI Session: ' + agent().cliSessionId"
        >
          {{ agent().cliSessionId! | slice : 0 : 8 }}...
        </span>
        }
      </button>

      @if (agent().expanded) {
      <!-- Task description -->
      <div class="px-3 py-1.5 border-t border-base-content/10 flex-shrink-0">
        @if (agent().parentSessionId) {
        <div class="flex items-center gap-1 mb-1">
          <span class="text-[9px] text-base-content/30"
            >Linked to parent session</span
          >
        </div>
        }
        <p
          class="text-[11px] leading-relaxed text-base-content/60 line-clamp-2"
        >
          {{ agent().task }}
        </p>
      </div>

      <!-- Output -->
      @if (agent().stdout || agent().stderr || agent().segments.length > 0) {
      <div
        #outputContainer
        class="border-t border-base-content/5 flex-1 min-h-0 overflow-y-auto"
      >
        <div class="p-2 space-y-1.5">
          @for (segment of parsedOutput(); track $index) { @switch
          (segment.type) { @case ('heading') {
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
          } @case ('tool-call') {
          <div
            class="bg-base-200/60 rounded border border-base-content/5 overflow-hidden"
          >
            <div class="flex items-center gap-1.5 px-2 py-1">
              <span class="text-[10px] font-medium text-info">Tool:</span>
              <code class="text-[10px] font-mono text-accent">{{
                segment.toolName
              }}</code>
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
          } @case ('tool') {
          <div
            class="bg-base-200/60 rounded border border-base-content/5 overflow-hidden"
          >
            <div class="flex items-center gap-1.5 px-2 py-1">
              <span class="text-[10px] font-medium text-info">Tool:</span>
              <code class="text-[10px] font-mono text-accent">{{
                segment.toolName
              }}</code>
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
          } @case ('tool-result') {
          <div
            class="bg-base-200/30 rounded border border-base-content/5 overflow-hidden"
          >
            <div class="flex items-center gap-1.5 px-2 py-0.5">
              <span class="text-[10px] text-base-content/40">Tool result</span>
            </div>
            @if (segment.content) {
            <div
              class="px-2 py-1 max-h-32 overflow-y-auto prose prose-xs prose-invert max-w-none agent-prose"
            >
              <markdown [data]="segment.content" />
            </div>
            }
          </div>
          } @case ('tool-result-error') {
          <div
            class="bg-error/5 rounded border border-error/15 overflow-hidden"
          >
            <div class="flex items-center gap-1.5 px-2 py-0.5">
              <span class="text-[10px] text-error/70">Tool result (error)</span>
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
          } @case ('error') {
          <div class="bg-error/10 rounded px-2 py-1 border border-error/20">
            <pre
              class="text-[10px] font-mono text-error whitespace-pre-wrap break-words m-0 leading-relaxed"
              >{{ segment.content }}</pre
            >
          </div>
          } @case ('info') {
          <div
            class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
          >
            <pre
              class="text-[10px] font-mono text-base-content/40 whitespace-pre-wrap break-words m-0 leading-relaxed"
              >{{ segment.content }}</pre
            >
          </div>
          } @case ('command') {
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
            } @if (segment.exitCode !== undefined && segment.exitCode !== 0) {
            <div class="border-t border-error/20 px-2 py-0.5 bg-error/10">
              <span class="text-[10px] font-mono text-error"
                >exit {{ segment.exitCode }}</span
              >
            </div>
            }
          </div>
          } @case ('file-change') {
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
                  segment.changeKind !== 'deleted'
              }"
              >{{ segment.changeKind }}</span
            >
            <code class="text-[10px] font-mono text-base-content/70">{{
              segment.content
            }}</code>
          </div>
          } @case ('stderr-info') {
          <div
            class="bg-base-200/40 rounded px-2 py-1 border border-base-content/5"
          >
            <pre
              class="text-[10px] font-mono text-base-content/35 whitespace-pre-wrap break-words m-0 leading-relaxed"
              >{{ segment.content }}</pre
            >
          </div>
          } @case ('text') { @if (segment.content.trim()) {
          <div class="prose prose-xs prose-invert max-w-none agent-prose">
            <markdown [data]="segment.content" />
          </div>
          } } } } @for (seg of parsedStderr(); track $index) { @if (seg.type ===
          'error') {
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
          } }
        </div>
      </div>
      } }
    </div>
  `,
})
export class AgentCardComponent {
  readonly agent = input.required<MonitoredAgent>();
  readonly toggleExpanded = output<void>();

  private readonly store = inject(AgentMonitorStore);

  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;

  // Auto-scroll output
  private readonly outputContainer =
    viewChild<ElementRef<HTMLDivElement>>('outputContainer');

  /**
   * Elapsed time display derived from the store's shared tick signal.
   * No per-card setInterval — the store drives a single 1s timer.
   */
  readonly elapsedDisplay = computed(() => {
    const a = this.agent();
    // Read tick to re-evaluate every second while agents are running
    this.store.tick();
    return formatElapsed(Date.now() - a.startedAt);
  });

  /**
   * Parse agent output into structured segments for formatted rendering.
   * Prefers structured segments from SDK adapters (Gemini, Codex).
   * Falls back to regex parsing for raw CLI adapters (Copilot).
   */
  readonly parsedOutput = computed((): RenderSegment[] => {
    const agent = this.agent();

    // Prefer structured segments when available (SDK adapters)
    if (agent.segments.length > 0) {
      return agent.segments;
    }

    // Fallback: regex-parse raw stdout (Copilot and other raw CLI adapters)
    const stdout = agent.stdout;
    if (!stdout) return [];
    return parseAgentOutput(stdout);
  });

  /**
   * Parse stderr into informational vs error segments.
   * Usage stats, model info, mode messages → muted info style.
   * Actual errors → red error style.
   */
  readonly parsedStderr = computed(() => {
    const stderr = this.agent().stderr;
    if (!stderr) return [];
    return parseStderr(stderr);
  });

  constructor() {
    // Auto-scroll output to bottom
    effect(() => {
      const a = this.agent();
      // Read stdout/stderr/segments to track changes
      const _ = a.stdout + a.stderr + a.segments.length;
      const el = this.outputContainer()?.nativeElement;
      if (el) {
        requestAnimationFrame(() => {
          el.scrollTop = el.scrollHeight;
        });
      }
    });
  }
}

function formatElapsed(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  } else if (seconds < 3600) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    return `${m}m ${s}s`;
  } else {
    const h = Math.floor(seconds / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    return `${h}h ${m}m`;
  }
}

/** Error keywords that indicate a real problem, even inside [stderr]-prefixed lines */
const STDERR_ERROR_KEYWORDS =
  /\b(error|fail(ed)?|exception|denied|unauthorized|refused|timeout|exhausted|abort|crash|panic|fatal|quota)\b/i;

/**
 * Parse raw agent CLI output into structured segments.
 *
 * Detects patterns:
 * - "Tool: <name> <args>" lines → tool segment
 * - "Tool result" / "► Tool result" lines → tool-result segment
 * - "Reading <file>" / "Searching" lines → tool segment
 * - "● <heading>" / "• <heading>" lines → heading segment
 * - Error/warning patterns → error segment
 * - Everything else → text segment
 *
 * Adjacent text lines are merged into a single segment.
 */
function parseAgentOutput(stdout: string): RenderSegment[] {
  const lines = stdout.split('\n');
  const segments: RenderSegment[] = [];
  let currentText = '';

  const flushText = () => {
    if (currentText.trim()) {
      segments.push({ type: 'text', content: currentText.trimEnd() });
    }
    currentText = '';
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    // [stderr] lines mixed into stdout (from CLI adapter stderr forwarding)
    if (/^\[stderr\]/i.test(trimmed)) {
      flushText();
      // Accumulate consecutive [stderr] lines
      let stderrContent = trimmed.replace(/^\[stderr\]\s*/i, '');
      while (i + 1 < lines.length && /^\[stderr\]/i.test(lines[i + 1].trim())) {
        i++;
        stderrContent += '\n' + lines[i].trim().replace(/^\[stderr\]\s*/i, '');
      }
      // Classify: error keywords → error, otherwise muted info
      const isError = STDERR_ERROR_KEYWORDS.test(stderrContent);
      segments.push({
        type: isError ? 'error' : 'stderr-info',
        content: stderrContent.trim(),
      });
      continue;
    }

    // Heading patterns: "● Plan", "• Key Principles", "## Section"
    if (/^[●•]\s+\S/.test(trimmed) || /^#{1,3}\s+\S/.test(trimmed)) {
      flushText();
      segments.push({
        type: 'heading',
        content: trimmed.replace(/^[●•#]+\s*/, ''),
      });
      continue;
    }

    // Tool call: "Tool: <name> <args>"
    const toolMatch = trimmed.match(/^Tool:\s+(\w[\w_.-]*)\s*(.*)?$/);
    if (toolMatch) {
      flushText();
      // Collect tool content (indented lines or until next segment)
      let toolContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        toolContent += (toolContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool',
        content: toolContent.trim(),
        toolName: toolMatch[1],
        toolArgs: toolMatch[2]?.trim() || undefined,
      });
      continue;
    }

    // Tool result (error): "▶ Tool result (error)"
    if (/^[►▶]?\s*Tool result\s*\(error\)/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool-result-error',
        content: resultContent.trim(),
      });
      continue;
    }

    // Tool result: "► Tool result" or "Tool result"
    if (/^[►▶]?\s*Tool result/i.test(trimmed)) {
      flushText();
      let resultContent = '';
      while (i + 1 < lines.length && !isSegmentBoundary(lines[i + 1])) {
        i++;
        resultContent += (resultContent ? '\n' : '') + lines[i];
      }
      segments.push({
        type: 'tool-result',
        content: resultContent.trim(),
      });
      continue;
    }

    // Reading/Searching actions shown as tool calls
    const actionMatch = trimmed.match(
      /^(Reading|Searching|Writing|Creating|Executing)\s+(.+)$/
    );
    if (actionMatch) {
      flushText();
      segments.push({
        type: 'tool',
        content: '',
        toolName: actionMatch[1].toLowerCase(),
        toolArgs: actionMatch[2],
      });
      continue;
    }

    // Error patterns
    if (
      /^(Error|ERROR|✗|✘|Permission denied|FAILED)/i.test(trimmed) ||
      /^X\s+/.test(trimmed)
    ) {
      flushText();
      segments.push({ type: 'error', content: trimmed });
      continue;
    }

    // Regular text — accumulate
    currentText += (currentText ? '\n' : '') + line;
  }

  flushText();
  return segments;
}

/**
 * Classify a stderr line as informational or a real error.
 * Informational: model info, usage stats, mode messages, cache info, timestamps.
 * Error: lines with error keywords or unknown patterns.
 */
function isStderrInfoLine(line: string): boolean {
  const t = line.trim();
  if (!t) return true;

  // First pass: if the line contains obvious error keywords, it's an error —
  // regardless of any prefix like [stderr].
  if (STDERR_ERROR_KEYWORDS.test(t)) return false;

  // Model / provider info
  if (/^\[?(Model|Provider|model|provider)[:\]]/i.test(t)) return true;
  // Mode messages (YOLO, auto-accept, etc.)
  if (/yolo mode|auto.?accept|headless/i.test(t)) return true;
  // Cache / loading info
  if (/loaded cached|loading|initializ/i.test(t)) return true;
  // Usage stats (tokens, cost, input, output)
  if (/tokens?[\s:]/i.test(t) || /\bcost\b/i.test(t)) return true;
  if (/input[:\s]+\d|output[:\s]+\d/i.test(t)) return true;
  // Stderr prefix markers from CLI wrappers (only if no error keywords above)
  if (/^\[stderr\]/i.test(t)) return true;
  // Timing / duration info
  if (/\d+(\.\d+)?\s*(ms|sec|seconds|s)\b/i.test(t)) return true;
  // Version info
  if (/^v?\d+\.\d+/i.test(t)) return true;
  return false;
}

/**
 * Parse stderr into grouped informational vs error segments.
 * Adjacent lines of the same type are merged into one segment.
 */
function parseStderr(stderr: string): StderrSegment[] {
  const lines = stderr.split('\n');
  const segments: StderrSegment[] = [];
  let currentType: 'info' | 'error' | null = null;
  let currentLines: string[] = [];

  const flush = () => {
    if (currentLines.length > 0 && currentType) {
      const content = currentLines.join('\n').trimEnd();
      if (content) {
        segments.push({ type: currentType, content });
      }
    }
    currentLines = [];
    currentType = null;
  };

  for (const line of lines) {
    const type: 'info' | 'error' = isStderrInfoLine(line) ? 'info' : 'error';
    if (type !== currentType) {
      flush();
      currentType = type;
    }
    currentLines.push(line);
  }
  flush();

  return segments;
}

/** Check if a line starts a new segment boundary */
function isSegmentBoundary(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (/^\[stderr\]/i.test(t)) return true;
  if (/^[●•]\s+\S/.test(t)) return true;
  if (/^#{1,3}\s+\S/.test(t)) return true;
  if (/^Tool:\s+\w/.test(t)) return true;
  if (/^[►▶]?\s*Tool result/i.test(t)) return true;
  if (/^(Reading|Searching|Writing|Creating|Executing)\s+/.test(t)) return true;
  if (/^(Error|ERROR|✗|✘|Permission denied|FAILED)/i.test(t)) return true;
  if (/^X\s+/.test(t)) return true;
  return false;
}
