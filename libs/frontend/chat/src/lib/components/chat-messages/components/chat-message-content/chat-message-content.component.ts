/**
 * Chat Message Content Component
 *
 * Pure presentation component for rendering Claude CLI message content with:
 * - Rich text display with markdown support
 * - Tool usage visualization
 * - File path detection and clickable links
 * - Image display support
 * - Code syntax highlighting
 * - VS Code themed UI
 *
 * ARCHITECTURE:
 * - Zero component dependencies (Level 1 component)
 * - Modern Angular 20 patterns (input/output/computed/inject)
 * - OnPush change detection for performance
 * - Types from @ptah-extension/core (ProcessedClaudeMessage, ClaudeContent)
 */

import {
  Component,
  input,
  output,
  computed,
  inject,
  ElementRef,
  viewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule, NgOptimizedImage } from '@angular/common';
import { type ProcessedClaudeMessage } from '@ptah-extension/core';
import {
  type ContentBlock,
  type ToolUseContentBlock,
  type ToolResultContentBlock,
  type TextContentBlock,
  type ThinkingContentBlock,
} from '@ptah-extension/shared';
import { SafeHtmlPipe } from '@ptah-extension/shared-ui';
import { ThinkingBlockComponent } from '../../../thinking-block/thinking-block.component';
import { ToolUseBlockComponent } from '../../../tool-use-block/tool-use-block.component';
import { ToolResultBlockComponent } from '../../../tool-result-block/tool-result-block.component';

@Component({
  selector: 'ptah-chat-message-content',
  standalone: true,
  imports: [
    CommonModule,
    NgOptimizedImage,
    SafeHtmlPipe,
    ThinkingBlockComponent,
    ToolUseBlockComponent,
    ToolResultBlockComponent,
  ],
  templateUrl: './chat-message-content.component.html',
  styleUrl: './chat-message-content.component.scss',
})
export class ChatMessageContentComponent implements AfterViewInit {
  // === ANGULAR 20 PATTERN: Modern input/output signals ===
  readonly message = input.required<ProcessedClaudeMessage>();
  readonly showHeader = input(true);
  readonly enableImagePreviews = input(true);

  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{
    tool: string;
    action: string;
    data?: unknown;
  }>();

  // === View children ===
  readonly contentContainer =
    viewChild<ElementRef<HTMLElement>>('contentContainer');

  /**
   * Check if message contains images by scanning content blocks for image file extensions
   */
  readonly showImagePreviews = computed(() => {
    if (!this.enableImagePreviews()) return false;

    const msg = this.message();
    // Check if any text content block references images
    return msg.content.some((block) => {
      if (block.type === 'text') {
        // Check for image file extensions in text
        const imageExtensions = /\.(jpg|jpeg|png|gif|webp|svg|bmp)$/i;
        return imageExtensions.test(block.text);
      }
      return false;
    });
  });

  readonly imageFiles = computed(() => {
    // Extract image paths from text content blocks
    const msg = this.message();
    const imagePaths: string[] = [];

    msg.content.forEach((block) => {
      if (block.type === 'text') {
        const imageRegex = /[^\s]+\.(jpg|jpeg|png|gif|webp|svg|bmp)/gi;
        const matches = block.text.match(imageRegex);
        if (matches) {
          imagePaths.push(...matches);
        }
      }
    });

    return imagePaths.map((path) => ({ path, isImage: true }));
  });

  readonly roleIcon = computed(() => {
    const role = this.message().type;
    const icons = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
    };
    return icons[role as keyof typeof icons] || '❓';
  });

  readonly formattedTimestamp = computed(() => {
    const timestamp = this.message().timestamp;
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  });

  /**
   * Token usage is not available per-message in JSONL format
   * Token usage belongs in SessionMetrics (from result messages), not per-message
   * Returns 0 for display purposes
   */
  readonly totalTokens = computed(() => {
    // Token usage not available in ProcessedClaudeMessage
    // Must be retrieved from SessionMetrics if needed
    return 0;
  });

  /**
   * Extract tool names from tool_use content blocks
   */
  readonly toolBadges = computed(() => {
    const msg = this.message();
    const tools = msg.content
      .filter(
        (block): block is ToolUseContentBlock => block.type === 'tool_use'
      )
      .map((block) => block.name);

    return tools.map((tool: string) => ({
      name: tool,
      icon: this.getToolIcon(tool),
    }));
  });

  // === Lifecycle ===
  ngAfterViewInit(): void {
    this.applySyntaxHighlighting();
  }

  // === Type guards (local implementations) ===
  isTextContent(content: ContentBlock): content is TextContentBlock {
    return content.type === 'text';
  }

  isToolUseContent(content: ContentBlock): content is ToolUseContentBlock {
    return content.type === 'tool_use';
  }

  isToolResultContent(
    content: ContentBlock
  ): content is ToolResultContentBlock {
    return content.type === 'tool_result';
  }

  isThinkingContent(content: ContentBlock): content is ThinkingContentBlock {
    return content.type === 'thinking';
  }

  // === Track by function for content blocks ===
  trackByContent(index: number, content: ContentBlock): string {
    if (this.isTextContent(content)) {
      return `text-${index}-${content.text.substring(0, 50)}`;
    } else if (this.isToolUseContent(content)) {
      return `tool-use-${content.id}`;
    } else if (this.isToolResultContent(content)) {
      return `tool-result-${content.tool_use_id}`;
    }
    return `content-${index}`;
  }

  // === Role formatting ===
  getRoleIcon(role: string): string {
    const icons = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
    };
    return icons[role as keyof typeof icons] || '❓';
  }

  // === Timestamp formatting ===
  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // === Tool methods ===
  getToolIcon(toolName: string): string {
    const iconMap: Record<string, string> = {
      Read: '📖',
      Write: '✏️',
      Edit: '📝',
      Glob: '🔍',
      Grep: '🔎',
      Bash: '💻',
      MultiEdit: '📝',
      WebFetch: '🌐',
      WebSearch: '🔍',
    };
    return iconMap[toolName] || '🔧';
  }

  hasToolParameters(toolUse: ContentBlock): boolean {
    if (!this.isToolUseContent(toolUse)) return false;
    return (
      toolUse.input !== undefined &&
      toolUse.input !== null &&
      Object.keys(toolUse.input).length > 0
    );
  }

  getToolParameters(toolUse: ContentBlock): { key: string; value: unknown }[] {
    if (!this.isToolUseContent(toolUse) || !toolUse.input) return [];
    return Object.entries(toolUse.input).map(([key, value]) => ({
      key,
      value,
    }));
  }

  formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // Check if it's a file path (simple heuristic)
      const isPath = value.includes('/') || value.includes('\\');
      if (isPath) {
        const fileType = this.detectFileType(value);
        const icon = this.getFileTypeIcon(fileType);
        return `${icon} <code>${value}</code>`;
      }
      return `<code>${value}</code>`;
    }

    if (typeof value === 'object' && value !== null) {
      return `<pre><code>${JSON.stringify(value, null, 2)}</code></pre>`;
    }

    return `<code>${String(value)}</code>`;
  }

  // === Helper: Detect file type from path ===
  private detectFileType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase();
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg', 'bmp'];
    const codeExts = [
      'ts',
      'js',
      'tsx',
      'jsx',
      'py',
      'java',
      'cpp',
      'c',
      'rs',
      'go',
    ];

    if (ext && imageExts.includes(ext)) return 'image';
    if (ext && codeExts.includes(ext)) return 'code';
    if (ext === 'txt' || ext === 'md') return 'text';
    return 'unknown';
  }

  // === File methods ===
  getFileIcon(file: { path: string; isImage: boolean }): string {
    if (file.isImage) return '🖼️';

    const extension = '.' + file.path.split('.').pop()?.toLowerCase() || '';
    const iconMap: Record<string, string> = {
      '.ts': '📘',
      '.js': '📙',
      '.tsx': '📘',
      '.jsx': '📙',
      '.html': '🌐',
      '.css': '🎨',
      '.scss': '🎨',
      '.json': '📋',
      '.md': '📝',
      '.txt': '📄',
      '.py': '🐍',
      '.java': '☕',
      '.go': '🐹',
      '.rs': '🦀',
      '.cpp': '⚡',
      '.c': '⚡',
    };

    return iconMap[extension] || '📎';
  }

  getFileTypeIcon(fileType: string): string {
    const iconMap: Record<string, string> = {
      image: '🖼️',
      code: '📄',
      text: '📃',
      unknown: '📎',
    };
    return iconMap[fileType] || '📎';
  }

  getFileName(path: string): string {
    return path.split(/[\\/]/).pop() || path;
  }

  // === Content detection ===
  isImageContent(content: string): boolean {
    return (
      /\.(png|jpg|jpeg|gif|bmp|svg|webp|ico)$/i.test(content) ||
      content.includes('data:image/')
    );
  }

  isCodeContent(content: string): boolean {
    return (
      content.includes('```') ||
      content.includes('function ') ||
      content.includes('class ') ||
      content.includes('import ') ||
      content.includes('export ')
    );
  }

  getImageSrc(content: string): string {
    if (content.startsWith('data:image/')) {
      return content;
    }
    return `file://${content}`;
  }

  getImagePreviewSrc(path: string): string {
    return `file://${path}`;
  }

  // === Event handlers ===
  handleFileClick(file: { path: string; isImage: boolean }): void {
    this.fileClicked.emit(file.path);
  }

  toggleImagePreview(
    file: { path: string; isImage: boolean },
    event: Event
  ): void {
    event.stopPropagation();
    // Image preview toggle (no logging needed for UI interaction)
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  onImageError(event: Event, _file: { path: string; isImage: boolean }): void {
    // Image failed to load - show fallback icon
    const img = event.target as HTMLImageElement;
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIxIDNIMTlWMUgxN1YzSDdWMUg1VjNIM1Y1VjE5VjIxSDVWMTlIMTlWMjFIMjFWMTlWNVYzWk01IDE5VjVIMTlWMTlINVoiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTcgMTdIMTdWMTVIN1YxN1oiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTcgMTNIMTNWMTFIN1YxM1oiIGZpbGw9IiM5OTk5OTkiLz4KPC9zdmc+';
  }

  // === Syntax highlighting ===
  highlightCode(content: string): string {
    let highlighted = this.escapeHtml(content);

    // Keywords
    highlighted = highlighted.replace(
      /\b(function|class|const|let|var|if|else|for|while|return|import|export)\b/g,
      '<span class="keyword">$1</span>'
    );

    // Strings (fixed regex - proper escape handling)
    highlighted = highlighted.replace(
      /(['"`])(?:(?=(\\?))\2.)*?\1/g,
      '<span class="string">$&</span>'
    );

    // Comments
    highlighted = highlighted.replace(
      /(\/\/.*$)/gm,
      '<span class="comment">$1</span>'
    );

    return highlighted;
  }

  private applySyntaxHighlighting(): void {
    const container = this.contentContainer();
    if (container) {
      const codeBlocks = container.nativeElement.querySelectorAll('pre code');
      codeBlocks.forEach((block) => {
        const code = block.textContent || '';
        block.innerHTML = this.highlightCode(code);
      });
    }
  }

  private escapeHtml(text: string): string {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }
}
