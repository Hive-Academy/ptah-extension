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
import {
  type ProcessedClaudeMessage,
  type ClaudeContent,
  type ExtractedFileInfo,
  ClaudeMessageTransformerService,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  extractFilePathsFromText,
  detectFileType,
} from '@ptah-extension/core';
import { SafeHtmlPipe } from '@ptah-extension/shared-ui';

@Component({
  selector: 'ptah-chat-message-content',
  standalone: true,
  imports: [CommonModule, NgOptimizedImage, SafeHtmlPipe],
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

  // === Dependency injection ===
  private readonly transformer = inject(ClaudeMessageTransformerService);

  // === View children ===
  readonly contentContainer =
    viewChild<ElementRef<HTMLElement>>('contentContainer');

  // === ANGULAR 20 PATTERN: Computed signals for derived state ===
  readonly processedContent = computed(() => {
    const msg = this.message();
    return this.transformer.extractContent(msg.content);
  });

  readonly showImagePreviews = computed(() => {
    return this.enableImagePreviews() && (this.message().hasImages || false);
  });

  readonly imageFiles = computed(() => {
    return this.processedContent().extractedFiles.filter(
      (file: ExtractedFileInfo) => file.isImage
    );
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

  readonly totalTokens = computed(() => {
    const usage = this.message().tokenUsage;
    if (!usage) return 0;
    return (usage.input_tokens || 0) + (usage.output_tokens || 0);
  });

  readonly toolBadges = computed(() => {
    const tools = this.message().toolsUsed || [];
    return tools.map((tool) => ({
      name: tool,
      icon: this.getToolIcon(tool),
    }));
  });

  // === Lifecycle ===
  ngAfterViewInit(): void {
    this.applySyntaxHighlighting();
  }

  // === Type guards (exported from core for template use) ===
  readonly isTextContent = isTextContent;
  readonly isToolUseContent = isToolUseContent;
  readonly isToolResultContent = isToolResultContent;

  // === Track by function for content blocks ===
  trackByContent(index: number, content: ClaudeContent): string {
    if (isTextContent(content)) {
      return `text-${index}-${content.text.substring(0, 50)}`;
    } else if (isToolUseContent(content)) {
      return `tool-use-${content.id}`;
    } else if (isToolResultContent(content)) {
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

  hasToolParameters(toolUse: ClaudeContent): boolean {
    if (!isToolUseContent(toolUse)) return false;
    return toolUse.input !== undefined && Object.keys(toolUse.input).length > 0;
  }

  getToolParameters(toolUse: ClaudeContent): { key: string; value: unknown }[] {
    if (!isToolUseContent(toolUse) || !toolUse.input) return [];
    return Object.entries(toolUse.input).map(([key, value]) => ({
      key,
      value,
    }));
  }

  formatParameterValue(value: unknown): string {
    if (typeof value === 'string') {
      // Check if it's a file path
      const filePaths = extractFilePathsFromText(value);
      if (filePaths.length > 0) {
        const fileType = detectFileType(value);
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

  // === File methods ===
  getFileIcon(file: ExtractedFileInfo): string {
    if (file.isImage) return '🖼️';

    const extension = file.extension?.toLowerCase();
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

    return iconMap[extension || ''] || '📎';
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
  handleFileClick(file: ExtractedFileInfo): void {
    this.fileClicked.emit(file.path);
  }

  toggleImagePreview(file: ExtractedFileInfo, event: Event): void {
    event.stopPropagation();
    // Image preview toggle (no logging needed for UI interaction)
  }

  onImageError(event: Event, file: ExtractedFileInfo): void {
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
