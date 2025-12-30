import {
  Component,
  input,
  computed,
  signal,
  ChangeDetectionStrategy,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  Brain,
  Wrench,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';

/**
 * Represents a parsed block from Claude's XML-like agent summary format.
 */
export type ParsedBlock =
  | { type: 'text'; content: string }
  | { type: 'thinking'; content: string }
  | { type: 'function_call'; name: string; parameters: Record<string, string> };

/**
 * AgentSummaryComponent - Parses and displays Claude's XML-like agent summary format
 *
 * Complexity Level: 2 (Molecule with parsing logic)
 * Patterns: Parser composition, Collapsible sections
 *
 * This component parses the special XML-like format that Claude CLI streams
 * during agent execution summaries. It extracts:
 * - <thinking>...</thinking> blocks
 * - <function_calls><invoke name="..."><parameter name="...">...</parameter></invoke></function_calls>
 * - Regular markdown text
 *
 * The summary session provides real-time progress updates while the full
 * agent session files contain the actual detailed execution.
 */
@Component({
  selector: 'ptah-agent-summary',
  standalone: true,
  imports: [MarkdownModule, LucideAngularModule],
  template: `
    <div class="space-y-1.5">
      @for (block of parsedBlocks(); track $index) { @switch (block.type) {
      @case ('thinking') {
      <div class="bg-base-300/30 rounded border border-base-300/50">
        <!-- Header (clickable to toggle) -->
        <button
          type="button"
          class="w-full py-1.5 px-2 text-[11px] flex items-center gap-1.5 text-base-content/60 hover:bg-base-300/50 transition-colors cursor-pointer rounded-t"
          (click)="toggleThinking($index)"
        >
          <!-- Expand/Collapse icon -->
          <lucide-angular
            [img]="ChevronDownIcon"
            class="w-3 h-3 flex-shrink-0 text-base-content/50 transition-transform"
            [class.rotate-0]="!collapsedThinking()[$index]"
            [class.-rotate-90]="collapsedThinking()[$index]"
          />
          <lucide-angular
            [img]="BrainIcon"
            class="w-3.5 h-3.5 text-secondary"
          />
          <span class="font-medium">Thinking...</span>
        </button>
        <!-- Collapsible content -->
        @if (!collapsedThinking()[$index]) {
        <div class="px-2 pb-2 border-t border-base-300/30">
          <div
            class="prose prose-xs prose-invert max-w-none text-[11px] text-base-content/70 pt-1.5"
          >
            <markdown [data]="block.content" />
          </div>
        </div>
        }
      </div>
      } @case ('function_call') {
      <div class="flex items-start gap-1.5 py-0.5 text-[11px]">
        <lucide-angular
          [img]="WrenchIcon"
          class="w-3.5 h-3.5 text-info mt-0.5 flex-shrink-0"
        />
        <div class="flex-1 min-w-0">
          <span class="badge badge-xs badge-ghost font-mono">{{
            block.name
          }}</span>
          @if (getMainParam(block)) {
          <span class="text-base-content/50 ml-1 truncate">{{
            getMainParam(block)
          }}</span>
          }
        </div>
      </div>
      } @case ('text') { @if (block.content.trim()) {
      <div class="prose prose-xs prose-invert max-w-none text-[12px]">
        <markdown [data]="block.content" />
      </div>
      } } } }
    </div>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AgentSummaryComponent {
  readonly content = input.required<string>();

  // Icons
  readonly BrainIcon = Brain;
  readonly WrenchIcon = Wrench;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;

  // Track collapsed state for thinking blocks
  readonly collapsedThinking = signal<Record<number, boolean>>({});

  /**
   * Parse the XML-like content into structured blocks
   */
  readonly parsedBlocks = computed<ParsedBlock[]>(() => {
    const text = this.content();
    if (!text) return [];

    return this.parseContent(text);
  });

  protected toggleThinking(index: number): void {
    this.collapsedThinking.update((state) => ({
      ...state,
      [index]: !state[index],
    }));
  }

  protected getMainParam(block: ParsedBlock): string {
    if (block.type !== 'function_call') return '';
    const params = block.parameters;

    // Return the most relevant parameter for each tool type
    if (params['file_path']) return params['file_path'];
    if (params['command']) {
      const cmd = params['command'];
      return cmd.length > 60 ? cmd.substring(0, 60) + '...' : cmd;
    }
    if (params['pattern']) return `Pattern: ${params['pattern']}`;
    if (params['query']) return `Query: ${params['query']}`;

    // Return first non-empty parameter value
    const firstValue = Object.values(params).find((v) => v && v.trim());
    if (firstValue) {
      return firstValue.length > 60
        ? firstValue.substring(0, 60) + '...'
        : firstValue;
    }

    return '';
  }

  /**
   * Parse content into blocks, handling:
   * - <thinking>...</thinking>
   * - <function_calls>...<invoke name="...">...</invoke>...</function_calls>
   * - Regular text/markdown
   */
  private parseContent(text: string): ParsedBlock[] {
    const blocks: ParsedBlock[] = [];
    let remaining = text;

    while (remaining.length > 0) {
      // Find the next special tag
      const thinkingMatch = remaining.match(/<thinking>([\s\S]*?)<\/thinking>/);
      const functionMatch = remaining.match(
        /<function_calls>([\s\S]*?)<\/function_calls>/
      );

      // Determine which comes first
      const thinkingIndex = thinkingMatch
        ? remaining.indexOf(thinkingMatch[0])
        : -1;
      const functionIndex = functionMatch
        ? remaining.indexOf(functionMatch[0])
        : -1;

      // No more special tags, treat rest as text
      if (thinkingIndex === -1 && functionIndex === -1) {
        if (remaining.trim()) {
          blocks.push({ type: 'text', content: remaining.trim() });
        }
        break;
      }

      // Determine next tag
      let nextIndex: number;
      let isThinking: boolean;

      if (thinkingIndex === -1) {
        nextIndex = functionIndex;
        isThinking = false;
      } else if (functionIndex === -1) {
        nextIndex = thinkingIndex;
        isThinking = true;
      } else {
        isThinking = thinkingIndex < functionIndex;
        nextIndex = isThinking ? thinkingIndex : functionIndex;
      }

      // Add text before the tag
      if (nextIndex > 0) {
        const textBefore = remaining.substring(0, nextIndex).trim();
        if (textBefore) {
          blocks.push({ type: 'text', content: textBefore });
        }
      }

      // Process the tag
      if (isThinking && thinkingMatch) {
        blocks.push({
          type: 'thinking',
          content: thinkingMatch[1].trim(),
        });
        remaining = remaining.substring(nextIndex + thinkingMatch[0].length);
      } else if (!isThinking && functionMatch) {
        // Parse function calls from the block
        const functionCalls = this.parseFunctionCalls(functionMatch[1]);
        blocks.push(...functionCalls);
        remaining = remaining.substring(nextIndex + functionMatch[0].length);
      }
    }

    return blocks;
  }

  /**
   * Parse <invoke> elements from function_calls block
   */
  private parseFunctionCalls(content: string): ParsedBlock[] {
    const calls: ParsedBlock[] = [];
    const invokeRegex = /<invoke name="([^"]+)">([\s\S]*?)<\/invoke>/g;
    let match;

    while ((match = invokeRegex.exec(content)) !== null) {
      const name = match[1];
      const invokeContent = match[2];

      // Parse parameters
      const params: Record<string, string> = {};
      const paramRegex = /<parameter name="([^"]+)">([^<]*)<\/parameter>/g;
      let paramMatch;

      while ((paramMatch = paramRegex.exec(invokeContent)) !== null) {
        params[paramMatch[1]] = paramMatch[2].trim();
      }

      calls.push({
        type: 'function_call',
        name,
        parameters: params,
      });
    }

    return calls;
  }
}
