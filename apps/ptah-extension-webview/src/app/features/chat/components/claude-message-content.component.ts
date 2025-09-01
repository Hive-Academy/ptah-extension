/**
 * Claude Message Content Renderer
 * Advanced content renderer for Claude CLI messages with:
 * - Rich text display with markdown support
 * - Tool usage visualization
 * - File path detection and clickable links
 * - Image display support
 * - Code syntax highlighting
 * - Beautiful VS Code styled UI
 */

import {
  Component,
  input,
  output,
  computed,
  inject,
  ElementRef,
  ViewChild,
  AfterViewInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import {
  ProcessedClaudeMessage,
  ClaudeContent,
  ToolUsageSummary,
  ExtractedFileInfo,
  isTextContent,
  isToolUseContent,
  isToolResultContent,
  extractFilePathsFromText,
  detectFileType,
} from '@ptah-extension/shared';
import { ClaudeMessageTransformerService } from '../../core/services/claude-message-transformer.service';

@Component({
  selector: 'app-claude-message-content',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div
      class="claude-message-content"
      [class.streaming]="message().isStreaming"
      [class.complete]="message().isComplete"
    >
      <!-- Message Header -->
      @if (showHeader) {
      <div class="message-header">
        <div class="message-metadata">
          <span class="message-role" [class]="message().role">
            {{ getRoleIcon(message().role) }} {{ message().role }}
          </span>
          <span class="message-timestamp">
            {{ formatTimestamp(message().timestamp) }}
          </span>
          <span class="token-usage" *ngIf="message().tokenUsage">
            🪙
            {{
              (message().tokenUsage?.input_tokens || 0) + (message().tokenUsage?.output_tokens || 0)
            }}
            tokens
          </span>
        </div>

        <!-- Model Information -->
        <div class="model-info" *ngIf="message().model">
          <span class="model-name">{{ message().model }}</span>
        </div>

        <!-- Tools Used Indicator -->
        <div class="tools-indicator" *ngIf="message().toolsUsed.length > 0">
          <span class="tools-label">Tools:</span>
          <span class="tool-badge" *ngFor="let tool of message().toolsUsed">
            {{ getToolIcon(tool) }} {{ tool }}
          </span>
        </div>
      </div>

      <!-- Content Sections -->
      <div class="message-body">
        <div
          *ngFor="let contentBlock of message().content; trackBy: trackByContent"
          class="content-block"
          [attr.data-content-type]="contentBlock.type"
        >
          <!-- Text Content -->
          <div
            *ngIf="isTextContent(contentBlock)"
            class="text-content"
            [innerHTML]="processedContent().renderedContent"
          ></div>

          <!-- Tool Use Visualization -->
          <div
            *ngIf="isToolUseContent(contentBlock)"
            class="tool-use-block"
            [class.running]="message().isStreaming"
          >
            <div class="tool-header">
              <div class="tool-icon">{{ getToolIcon(contentBlock.name) }}</div>
              <div class="tool-info">
                <span class="tool-name">{{ contentBlock.name }}</span>
                <span class="tool-status">
                  <span class="status-indicator" [class.running]="message().isStreaming"></span>
                  {{ message().isStreaming ? 'Running...' : 'Completed' }}
                </span>
              </div>
            </div>

            <!-- Tool Parameters -->
            <div class="tool-parameters" *ngIf="hasToolParameters(contentBlock)">
              <div class="parameters-header">Parameters:</div>
              <div class="parameter-grid">
                <div *ngFor="let param of getToolParameters(contentBlock)" class="parameter-item">
                  <span class="param-name">{{ param.key }}:</span>
                  <span class="param-value" [innerHTML]="formatParameterValue(param.value)"></span>
                </div>
              </div>
            </div>
          </div>

          <!-- Tool Result Visualization -->
          <div
            *ngIf="isToolResultContent(contentBlock)"
            class="tool-result-block"
            [class.error]="contentBlock.is_error"
          >
            <div class="result-header">
              <span class="result-status" [class.error]="contentBlock.is_error">
                {{ contentBlock.is_error ? '❌ Error' : '✅ Success' }}
              </span>
            </div>
            <div class="result-content">
              <div *ngIf="isImageContent(contentBlock.content)" class="image-result">
                <img [src]="getImageSrc(contentBlock.content)" alt="Tool result image" />
              </div>
              <div *ngIf="isCodeContent(contentBlock.content)" class="code-result">
                <pre><code [innerHTML]="highlightCode(contentBlock.content)"></code></pre>
              </div>
              <div
                *ngIf="
                  !isImageContent(contentBlock.content) && !isCodeContent(contentBlock.content)
                "
                class="text-result"
              >
                <pre>{{ contentBlock.content }}</pre>
              </div>
            </div>
          </div>
        </div>
      </div>

      <!-- File Attachments -->
      <div class="file-attachments" *ngIf="message().hasFiles">
        <div class="attachments-header">📎 Files:</div>
        <div class="file-grid">
          <div
            *ngFor="let file of processedContent().extractedFiles"
            class="file-item"
            [class.clickable]="file.isClickable"
            (click)="handleFileClick(file)"
          >
            <div class="file-icon">{{ getFileIcon(file) }}</div>
            <div class="file-info">
              <div class="file-name">{{ getFileName(file.path) }}</div>
              <div class="file-path">{{ file.path }}</div>
            </div>
            <div class="file-actions" *ngIf="file.isImage">
              <button class="preview-btn" (click)="toggleImagePreview(file, $event)">
                👁️ Preview
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- Image Previews -->
      <div class="image-previews" *ngIf="showImagePreviews">
        <div *ngFor="let imageFile of getImageFiles()" class="image-preview">
          <img
            [src]="getImagePreviewSrc(imageFile.path)"
            [alt]="getFileName(imageFile.path)"
            (error)="onImageError($event, imageFile)"
          />
        </div>
      </div>

      <!-- Streaming Indicator -->
      <div class="streaming-indicator" *ngIf="message().isStreaming">
        <div class="typing-dots"><span></span><span></span><span></span></div>
        <span class="streaming-text">Claude is typing...</span>
      </div>
    </div>
  `,
  styleUrl: './claude-message-content.component.scss',
})
export class ClaudeMessageContentComponent implements AfterViewInit {
  // Inputs
  readonly message = input.required<ProcessedClaudeMessage>();
  readonly showHeader = input(true);
  readonly enableImagePreviews = input(true);

  // Outputs
  readonly fileClicked = output<string>();
  readonly toolActionRequested = output<{ tool: string; action: string; data?: any }>();

  // Services
  private readonly transformer = inject(ClaudeMessageTransformerService);

  // Element reference for DOM manipulation
  @ViewChild('contentContainer') contentContainer?: ElementRef<HTMLElement>;

  // Computed properties
  readonly processedContent = computed(() => {
    const msg = this.message();
    return this.transformer.extractContent(msg.content);
  });

  readonly showImagePreviews = computed(() => {
    return this.enableImagePreviews() && this.message().hasImages;
  });

  ngAfterViewInit(): void {
    // Apply syntax highlighting after view init
    this.applySyntaxHighlighting();
  }

  // Content type guards (for template)
  isTextContent = isTextContent;
  isToolUseContent = isToolUseContent;
  isToolResultContent = isToolResultContent;

  // Track by function for content blocks
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

  // Role formatting
  getRoleIcon(role: string): string {
    const icons = {
      user: '👤',
      assistant: '🤖',
      system: '⚙️',
    };
    return icons[role as keyof typeof icons] || '❓';
  }

  // Timestamp formatting
  formatTimestamp(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // Tool methods
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

  hasToolParameters(toolUse: any): boolean {
    return toolUse.input && Object.keys(toolUse.input).length > 0;
  }

  getToolParameters(toolUse: any): { key: string; value: any }[] {
    if (!toolUse.input) return [];
    return Object.entries(toolUse.input).map(([key, value]) => ({ key, value }));
  }

  formatParameterValue(value: any): string {
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

  // File methods
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

  getImageFiles(): ExtractedFileInfo[] {
    return this.processedContent().extractedFiles.filter((file: ExtractedFileInfo) => file.isImage);
  }

  // Content detection
  isImageContent(content: string): boolean {
    return (
      /\.(png|jpg|jpeg|gif|bmp|svg|webp|ico)$/i.test(content) || content.includes('data:image/')
    );
  }

  isCodeContent(content: string): boolean {
    // Check if content looks like code or has code patterns
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
    // For file paths, we might need to convert to a viewable URL
    return `file://${content}`;
  }

  getImagePreviewSrc(path: string): string {
    return `file://${path}`;
  }

  // Event handlers
  handleFileClick(file: ExtractedFileInfo): void {
    this.fileClicked.emit(file.path);
  }

  toggleImagePreview(file: ExtractedFileInfo, event: Event): void {
    event.stopPropagation();
    // Toggle image preview logic
    console.log('Toggle image preview for:', file.path);
  }

  onImageError(event: Event, file: ExtractedFileInfo): void {
    console.warn('Failed to load image:', file.path);
    const img = event.target as HTMLImageElement;
    img.src =
      'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iMjQiIGhlaWdodD0iMjQiIHZpZXdCb3g9IjAgMCAyNCAyNCIgZmlsbD0ibm9uZSIgeG1sbnM9Imh0dHA6Ly93d3cudzMub3JnLzIwMDAvc3ZnIj4KPHBhdGggZD0iTTIxIDNIMTlWMUgxN1YzSDdWMUg1VjNIM1Y1VjE5VjIxSDVWMTlIMTlWMjFIMjFWMTlWNVYzWk01IDE5VjVIMTlWMTlINVoiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTcgMTdIMTdWMTVIN1YxN1oiIGZpbGw9IiM5OTk5OTkiLz4KPHBhdGggZD0iTTcgMTNIMTNWMTFIN1YxM1oiIGZpbGw9IiM5OTk5OTkiLz4KPC9zdmc+';
  }

  // Syntax highlighting
  highlightCode(content: string): string {
    // Basic syntax highlighting - can be enhanced with a proper syntax highlighter
    let highlighted = this.escapeHtml(content);

    // Keywords
    highlighted = highlighted.replace(
      /\\b(function|class|const|let|var|if|else|for|while|return|import|export)\\b/g,
      '<span class="keyword">$1</span>',
    );

    // Strings
    highlighted = highlighted.replace(
      /(['"`])([^\\1]*?)\\1/g,
      '<span class="string">$1$2$1</span>',
    );

    // Comments
    highlighted = highlighted.replace(/(\/\/.*$)/gm, '<span class="comment">$1</span>');

    return highlighted;
  }

  private applySyntaxHighlighting(): void {
    // Apply syntax highlighting to code blocks
    if (this.contentContainer) {
      const codeBlocks = this.contentContainer.nativeElement.querySelectorAll('pre code');
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
