import {
  Component,
  input,
  computed,
  signal,
  effect,
  ChangeDetectionStrategy,
  inject,
} from '@angular/core';
import { MarkdownModule } from 'ngx-markdown';
import {
  LucideAngularModule,
  User,
  FileText,
  Image,
  Folder,
  Paperclip,
  ChevronDown,
  ChevronRight,
} from 'lucide-angular';
import { ExecutionNodeComponent } from './execution/execution-node.component';
import {
  TypingCursorComponent,
  StreamingQuotesComponent,
  CopyButtonComponent,
  TokenBadgeComponent,
  CostBadgeComponent,
  DurationBadgeComponent,
} from '@ptah-extension/chat-ui';
import type {
  ExecutionChatMessage,
  PermissionRequest,
  PermissionResponse,
} from '@ptah-extension/shared';
import { VSCodeService } from '@ptah-extension/core';
import { ChatStore } from '../../services/chat.store';
import {
  extractMessageSummary,
  type MessageSummary,
} from '../../utils/message-summary.utils';

/**
 * MessageBubbleComponent - Chat message with DaisyUI styling
 *
 * Complexity Level: 2 (Organism with composition)
 * Patterns: DaisyUI chat component, Role-based rendering
 *
 * Renders user messages as right-aligned bubbles (chat-end) with rawContent.
 * Renders assistant messages as left-aligned bubbles (chat-start) with ExecutionNode tree.
 *
 * Uses DaisyUI chat classes for consistent message styling.
 */
@Component({
  selector: 'ptah-message-bubble',
  standalone: true,
  imports: [
    MarkdownModule,
    ExecutionNodeComponent,
    TypingCursorComponent,
    StreamingQuotesComponent,
    CopyButtonComponent,
    TokenBadgeComponent,
    CostBadgeComponent,
    DurationBadgeComponent,
    LucideAngularModule,
  ],
  templateUrl: './message-bubble.component.html',
  styleUrl: './message-bubble.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[class.is-streaming]': 'isStreaming()',
  },
})
export class MessageBubbleComponent {
  /**
   * VS Code service for webview utilities
   */
  private readonly vscode = inject(VSCodeService);
  private readonly chatStore = inject(ChatStore);

  readonly message = input.required<ExecutionChatMessage>();

  /** Indicates if this message is currently streaming */
  readonly isStreaming = input<boolean>(false);

  /** Position of this message in the messages array */
  readonly messageIndex = input<number>(0);

  /** Total number of messages in the current conversation */
  readonly totalMessages = input<number>(0);

  // Lucide icons
  readonly UserIcon = User;
  readonly FileTextIcon = FileText;
  readonly ImageIcon = Image;
  readonly FolderIcon = Folder;
  readonly PaperclipIcon = Paperclip;
  readonly ChevronDownIcon = ChevronDown;
  readonly ChevronRightIcon = ChevronRight;
  readonly ptahIconUri = this.vscode.getPtahIconUri();
  readonly ptahUserIconUri = this.vscode.getPtahUserIconUri();

  /** Summary metadata extracted from the ExecutionNode tree */
  readonly messageSummary = computed((): MessageSummary | null => {
    const msg = this.message();
    if (msg.role !== 'assistant') return null;
    return extractMessageSummary(msg.streamingState, msg.cost, msg.duration);
  });

  /** Whether this message should auto-collapse on load */
  readonly shouldAutoCollapse = computed((): boolean => {
    const msg = this.message();
    if (msg.role !== 'assistant') return false;
    if (this.isStreaming()) return false;
    if (!msg.streamingState) return false;
    // Keep last 4 positions expanded to ensure the last ~2 assistant messages
    // stay visible (accounts for interspersed user messages in alternating pattern)
    const index = this.messageIndex();
    const total = this.totalMessages();
    return index < total - 4;
  });

  /** Local collapse state, initialized from shouldAutoCollapse */
  readonly isCollapsed = signal(false);

  /**
   * Whether the user has manually toggled collapse state.
   * Deliberately NOT a signal — the auto-collapse effect reads shouldAutoCollapse()
   * but must NOT re-trigger when userToggled changes. Using a plain boolean
   * ensures Angular's effect tracking ignores this field.
   */
  private userToggled = false;

  /** Tracks message identity to reset userToggled on component reuse */
  private previousMessageId: string | null = null;

  /** Whether collapsed footer has any data to show */
  readonly hasCollapsedFooterData = computed(() => {
    const summary = this.messageSummary();
    if (!summary) return false;
    return (
      (summary.cost !== undefined && summary.cost > 0) ||
      summary.duration !== undefined
    );
  });

  constructor() {
    // Reset userToggled when the component is reused for a different message
    // (Angular @for may reuse component instances when session changes)
    effect(() => {
      const id = this.message().id;
      if (this.previousMessageId !== null && id !== this.previousMessageId) {
        this.userToggled = false;
      }
      this.previousMessageId = id;
    });

    // Auto-collapse based on position, but respect user's manual toggle.
    effect(() => {
      const shouldCollapse = this.shouldAutoCollapse();
      if (!this.userToggled) {
        this.isCollapsed.set(shouldCollapse);
      }
    });
  }

  /**
   * User message display content with <system-reminder> tags stripped.
   * The backend wraps attachment instructions in <system-reminder> XML
   * so the frontend can hide them from the user bubble while keeping
   * them visible to the LLM. Matches the stripping pattern used in
   * CodeOutputComponent and ToolInputDisplayComponent.
   */
  readonly userDisplayContent = computed(() => {
    const raw = this.message().rawContent || '';
    return raw
      .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '')
      .trim();
  });

  /** Pre-computed image count label to avoid triple signal reads in template */
  readonly imageCountLabel = computed(() => {
    const count = this.message().imageCount;
    if (!count) return '';
    return `${count} ${count === 1 ? 'image' : 'images'}`;
  });

  /**
   * Permission lookup function to pass to execution tree
   * Enables tool cards to check if they have pending permissions
   */
  protected getPermissionForTool = (
    toolCallId: string,
  ): PermissionRequest | null => {
    return this.chatStore.getPermissionForTool(toolCallId);
  };

  /**
   * Handle permission response from execution tree
   * Delegates to ChatStore for state management
   */
  protected onPermissionResponse(response: PermissionResponse): void {
    this.chatStore.handlePermissionResponse(response);
  }

  /** Toggle the collapsed state of this message bubble */
  protected toggleCollapse(): void {
    this.userToggled = true;
    this.isCollapsed.update((v) => !v);
  }

  // TASK_2025_109: onResumeRequested removed - now uses context injection

  protected formatTime(timestamp: number): string {
    const date = new Date(timestamp);
    return date.toLocaleTimeString('en-US', {
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  }

  protected formatDateTime(timestamp: number): string {
    return new Date(timestamp).toISOString();
  }

  /**
   * Extract file name from a full path
   */
  protected getFileName(filePath: string): string {
    // Handle both Windows and Unix paths
    const parts = filePath.split(/[/\\]/);
    return parts[parts.length - 1] || filePath;
  }

  /**
   * Determine the appropriate icon for a file based on its extension
   * Returns the icon reference for lucide-angular
   */
  protected getFileIcon(
    filePath: string,
  ): typeof FileText | typeof Image | typeof Folder {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    const imageExts = [
      'jpg',
      'jpeg',
      'png',
      'gif',
      'svg',
      'webp',
      'bmp',
      'ico',
    ];
    const isDirectory =
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\');

    if (isDirectory) return Folder;
    if (imageExts.includes(ext)) return Image;
    return FileText;
  }

  /**
   * Check if the file path represents a folder
   */
  protected isFolder(filePath: string): boolean {
    return (
      !filePath.includes('.') ||
      filePath.endsWith('/') ||
      filePath.endsWith('\\')
    );
  }
}
