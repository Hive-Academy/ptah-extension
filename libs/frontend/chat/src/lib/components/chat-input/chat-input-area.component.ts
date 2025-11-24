/**
 * Chat Input Area Component
 *
 * Multi-line message input with advanced features:
 * - Agent selection dropdown
 * - File inclusion with @ mentions
 * - Agent autocomplete with @ mentions
 * - MCP server autocomplete with @server: syntax
 * - Command autocomplete with / trigger
 * - File optimization suggestions
 * - Auto-resizing textarea
 * - Keyboard shortcuts (Ctrl+Enter to send)
 *
 * ARCHITECTURE:
 * - Level 2-3 component (Medium-High complexity)
 * - Modern Angular 20 patterns (input/output/computed/viewChild/inject)
 * - OnPush change detection for performance
 * - Unified autocomplete system (TASK_2025_019)
 *
 * DEPENDENCIES:
 * - FileTagComponent (Level 0) ✅
 * - UnifiedSuggestionsDropdownComponent (Level 1) ✅
 * - FilePickerService ✅
 * - AgentDiscoveryFacade ✅ (TASK_2025_019)
 * - MCPDiscoveryFacade ✅ (TASK_2025_019)
 * - CommandDiscoveryFacade ✅ (TASK_2025_019)
 *
 * COMPLEXITY ASSESSMENT:
 * - Level: 2-3 (Medium-High) - Multiple state signals, complex detection logic
 * - Patterns: Dependency injection (3 facades), Composition (UnifiedDropdown)
 * - Rejected: Further decomposition (would break existing behavior)
 */

import {
  Component,
  input,
  output,
  computed,
  signal,
  viewChild,
  ElementRef,
  HostListener,
  inject,
  OnInit,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Send, Command } from 'lucide-angular';
import { type DropdownOption } from '@ptah-extension/shared';

// Core services - Already migrated ✅
import { FilePickerService, type FileSuggestion } from '../../services';
import {
  AgentDiscoveryFacade,
  MCPDiscoveryFacade,
  CommandDiscoveryFacade,
} from '@ptah-extension/core';

// Shared UI components - Already migrated ✅
import {
  DropdownComponent,
  ActionButtonComponent,
} from '@ptah-extension/shared-ui';

// Chat components - Already migrated ✅
import {
  UnifiedSuggestionsDropdownComponent,
  type SuggestionItem,
} from '../unified-suggestions-dropdown/unified-suggestions-dropdown.component';
import { FileTagComponent } from '../file-tag/file-tag.component';

/**
 * Chat Input Area - Message input with unified autocomplete
 */
@Component({
  selector: 'ptah-chat-input-area',
  standalone: true,

  imports: [
    CommonModule,
    FormsModule,
    LucideAngularModule,
    DropdownComponent,
    ActionButtonComponent,
    UnifiedSuggestionsDropdownComponent,
    FileTagComponent,
  ],
  template: `
    <footer class="vscode-input-area">
      <div class="vscode-input-controls">
        <!-- Agent Selection -->
        <ptah-dropdown
          [options]="agentOptions()"
          [placeholder]="'Select Agent'"
          [disabled]="disabled()"
          [ariaLabel]="'Agents'"
          (selectionChange)="onAgentChange($event)"
          class="vscode-agent-selector"
        />

        <!-- Commands Button -->
        <ptah-action-button
          [icon]="CommandIcon"
          [disabled]="disabled()"
          [ariaLabel]="'Open quick commands'"
          [variant]="'secondary'"
          (buttonClick)="commandsClick.emit()"
        />
      </div>

      <!-- Included Files Display -->
      @if (includedFiles().length > 0) {
      <div class="vscode-included-files">
        <div class="vscode-included-files-header">
          <span class="vscode-included-files-label">
            📎 {{ includedFiles().length }} file{{
              includedFiles().length === 1 ? '' : 's'
            }}
            included
          </span>
          @if (optimizationSuggestions().length > 0) {
          <span class="vscode-optimization-warning"
            >⚠️ {{ optimizationSuggestions().length }} optimization{{
              optimizationSuggestions().length === 1 ? '' : 's'
            }}</span
          >
          }
        </div>

        <div class="vscode-file-tags">
          @for (file of includedFiles(); track file.path) {
          <ptah-file-tag
            [file]="file"
            [showMetadata]="true"
            (removeFile)="removeFile(file.path)"
          />
          }
        </div>

        @if (optimizationSuggestions().length > 0) {
        <div class="vscode-optimization-suggestions">
          @for (suggestion of optimizationSuggestions(); track suggestion) {
          <div class="vscode-optimization-item">💡 {{ suggestion }}</div>
          }
        </div>
        }
      </div>
      }

      <!-- Message Input Area -->
      <div class="vscode-message-input-container">
        <div class="vscode-textarea-wrapper">
          <textarea
            #messageInput
            class="vscode-message-textarea"
            [value]="message()"
            (input)="onInput($event)"
            [placeholder]="placeholder()"
            [disabled]="disabled()"
            [rows]="3"
            (keydown)="onKeyDown($event)"
            (selectionChange)="onSelectionChange($event)"
            [attr.aria-label]="'Type your message'"
            [attr.aria-describedby]="'input-help'"
          ></textarea>

          <!-- Unified Suggestions Dropdown -->
          @if (showUnifiedSuggestions()) {
          <ptah-unified-suggestions-dropdown
            [suggestions]="unifiedSuggestions()"
            [isLoading]="isLoadingSuggestions()"
            [positionTop]="dropdownPosition().top"
            [positionLeft]="dropdownPosition().left"
            (suggestionSelected)="selectUnifiedSuggestion($event)"
            (closed)="hideUnifiedSuggestions()"
          />
          }
        </div>

        <ptah-action-button
          [icon]="SendIcon"
          [disabled]="!canSend()"
          [ariaLabel]="'Send message'"
          [variant]="'primary'"
          (buttonClick)="sendMessage.emit()"
        />
      </div>

      <!-- Input Helper Text -->
      <div
        id="input-help"
        class="vscode-input-help"
        [attr.aria-live]="'polite'"
      >
        @if (disabled()) {
        <span class="vscode-help-text">Please wait while processing...</span>
        } @else if (message().length > 0) {
        <span class="vscode-help-text"
          >Press Ctrl+Enter to send, or click the send button</span
        >
        } @else {
        <span class="vscode-help-text"></span>
        }
      </div>
    </footer>
  `,
  styles: [
    `
      .vscode-input-area {
        background-color: var(--vscode-panel-background);
        border-top: 1px solid var(--vscode-panel-border);
        padding: 12px;
        display: flex;
        flex-direction: column;
        gap: 8px;
        flex-shrink: 0;
      }

      .vscode-input-controls {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 8px;
      }

      .vscode-agent-selector {
        flex: 1;
        max-width: 200px;
      }

      .vscode-included-files {
        background-color: var(--vscode-panel-background);
        border: 1px solid var(--vscode-panel-border);
        border-radius: 4px;
        padding: 8px;
        margin-bottom: 8px;
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .vscode-included-files-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
      }

      .vscode-included-files-label {
        font-weight: 500;
      }

      .vscode-optimization-warning {
        color: var(--vscode-charts-orange);
        font-weight: 500;
      }

      .vscode-file-tags {
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        align-items: flex-start;
      }

      .vscode-optimization-suggestions {
        display: flex;
        flex-direction: column;
        gap: 4px;
        font-size: 11px;
        color: var(--vscode-charts-orange);
        background-color: var(--vscode-inputValidation-warningBackground);
        padding: 6px 8px;
        border-radius: 2px;
        border-left: 3px solid var(--vscode-charts-orange);
      }

      .vscode-optimization-item {
        line-height: 1.3;
      }

      .vscode-message-input-container {
        display: flex;
        gap: 8px;
        align-items: flex-end;
      }

      .vscode-textarea-wrapper {
        flex: 1;
        position: relative;
      }

      .vscode-message-textarea {
        width: 100%;
        min-height: 60px;
        max-height: 200px;
        padding: 8px 12px;
        background-color: var(--vscode-input-background);
        color: var(--vscode-input-foreground);
        border: 1px solid var(--vscode-input-border);
        border-radius: 2px;
        font-family: var(--vscode-font-family);
        font-size: var(--vscode-font-size, 13px);
        resize: vertical;
        outline: none;
        transition: border-color 0.15s ease;
        box-sizing: border-box;
      }

      .vscode-message-textarea:focus {
        border-color: var(--vscode-focusBorder);
        outline: 1px solid var(--vscode-focusBorder);
        outline-offset: -1px;
      }

      .vscode-message-textarea:disabled {
        opacity: 0.6;
        cursor: not-allowed;
        background-color: var(--vscode-input-background);
      }

      .vscode-message-textarea::placeholder {
        color: var(--vscode-input-placeholderForeground);
      }

      .vscode-input-help {
        font-size: 11px;
        color: var(--vscode-descriptionForeground);
        line-height: 1.3;
        padding: 0 4px;
      }

      .vscode-help-text {
        opacity: 0.8;
      }

      /* High Contrast Mode */
      @media (prefers-contrast: high) {
        .vscode-input-area {
          border-top-width: 2px;
        }

        .vscode-message-textarea {
          border-width: 2px;
        }
      }
    `,
  ],
})
export class ChatInputAreaComponent implements OnInit {
  // === ANGULAR 20 PATTERN: Modern input/output signals ===
  readonly message = input('');
  readonly selectedAgent = input('');
  readonly agentOptions = input<DropdownOption[]>([]);
  readonly disabled = input(false);
  readonly placeholder = input('Type your task here...');
  readonly canSend = input(false);

  readonly messageChange = output<string>();
  readonly agentChange = output<DropdownOption>();
  readonly sendMessage = output<void>();
  readonly keyDown = output<KeyboardEvent>();
  readonly commandsClick = output<void>();
  readonly filesChanged = output<string[]>();

  // === View children ===
  readonly messageInput =
    viewChild<ElementRef<HTMLTextAreaElement>>('messageInput');

  // === Injected services ===
  readonly filePickerService = inject(FilePickerService);
  readonly agentDiscovery = inject(AgentDiscoveryFacade);
  readonly mcpDiscovery = inject(MCPDiscoveryFacade);
  readonly commandDiscovery = inject(CommandDiscoveryFacade);

  // === Internal state signals ===
  private readonly _showUnifiedSuggestions = signal(false);
  private readonly _suggestionType = signal<
    'file' | 'agent' | 'mcp' | 'command' | null
  >(null);
  private readonly _unifiedSuggestions = signal<SuggestionItem[]>([]);
  private readonly _dropdownPosition = signal({ top: 0, left: 0 });
  private readonly _caretPosition = signal(0);
  private readonly _triggerPosition = signal(-1); // For @ or /

  // === Readonly signals for external access ===
  readonly showUnifiedSuggestions = this._showUnifiedSuggestions.asReadonly();
  readonly suggestionType = this._suggestionType.asReadonly();
  readonly unifiedSuggestions = this._unifiedSuggestions.asReadonly();
  readonly dropdownPosition = this._dropdownPosition.asReadonly();
  readonly isLoadingSuggestions = computed(
    () =>
      this.filePickerService.isLoading() ||
      this.agentDiscovery.isLoading() ||
      this.mcpDiscovery.isLoading() ||
      this.commandDiscovery.isLoading()
  );

  // === ANGULAR 20 PATTERN: Computed signals for derived state ===
  readonly includedFiles = computed(() =>
    this.filePickerService.includedFiles()
  );
  readonly optimizationSuggestions = computed(() =>
    this.filePickerService.optimizationSuggestions()
  );
  readonly hasIncludedFiles = computed(() => this.includedFiles().length > 0);

  // Lucide icons
  readonly SendIcon = Send;
  readonly CommandIcon = Command;

  // === Lifecycle hooks ===
  async ngOnInit(): Promise<void> {
    // Fetch all suggestions on component initialization
    await Promise.all([
      this.agentDiscovery.fetchAgents(),
      this.mcpDiscovery.fetchServers(),
      this.commandDiscovery.fetchCommands(),
    ]);
  }

  // === Event handlers ===
  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.messageChange.emit(target.value);
    this.adjustTextareaHeight(target);

    // Check for both @ and / triggers
    this.handleAtSymbolInput(target);
    this.handleSlashTrigger(target);
  }

  onSelectionChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this._caretPosition.set(target.selectionStart || 0);
  }

  onKeyDown(event: KeyboardEvent): void {
    // Handle unified suggestion navigation
    if (this.showUnifiedSuggestions()) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.hideUnifiedSuggestions();
          return;
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
          // Let the dropdown component handle these
          return;
      }
    }

    // CRITICAL FIX: Handle Ctrl+Enter to send message
    // This should NOT emit keyDown event to prevent double handling
    if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault(); // Prevent default textarea behavior
      event.stopPropagation(); // Stop event bubbling
      this.sendMessage.emit(); // Directly emit sendMessage
      return; // Exit early - DO NOT emit keyDown
    }

    // Only emit keyDown for other keys
    this.keyDown.emit(event);
  }

  onAgentChange(option: DropdownOption | null): void {
    if (option) {
      this.agentChange.emit(option);
    }
  }

  // === Public methods ===
  focus(): void {
    const input = this.messageInput();
    if (input) {
      input.nativeElement.focus();
    }
  }

  getIncludedFilePaths(): string[] {
    return this.filePickerService.getFilePathsForMessage();
  }

  // === Unified suggestion handling ===
  selectUnifiedSuggestion(suggestion: SuggestionItem): void {
    const input = this.messageInput();
    if (!input) return;

    const textarea = input.nativeElement;
    const currentText = textarea.value;
    const triggerPos = this._triggerPosition();
    const cursorPos = textarea.selectionStart || 0;

    if (triggerPos === -1) return;

    const beforeTrigger = currentText.substring(0, triggerPos);
    const afterCursor = currentText.substring(cursorPos);

    let insertText = '';
    let newCursorPos = 0;

    switch (suggestion.type) {
      case 'file':
        // Insert @filename
        insertText = `${beforeTrigger}@${suggestion.name} ${afterCursor}`;
        newCursorPos = triggerPos + suggestion.name.length + 2;
        break;

      case 'agent':
        // Insert @agent-name
        insertText = `${beforeTrigger}@${suggestion.name} ${afterCursor}`;
        newCursorPos = triggerPos + suggestion.name.length + 2;
        break;

      case 'mcp':
        // Insert @server:resource
        insertText = `${beforeTrigger}@${suggestion.name} ${afterCursor}`;
        newCursorPos = triggerPos + suggestion.name.length + 2;
        break;

      case 'command':
        // Replace entire line with /command
        const lineStart = currentText.lastIndexOf('\n', triggerPos) + 1;
        const beforeLine = currentText.substring(0, lineStart);
        insertText = `${beforeLine}/${suggestion.name} ${afterCursor}`;
        newCursorPos = lineStart + suggestion.name.length + 2;
        break;
    }

    // Update textarea
    textarea.value = insertText;
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // Emit changes
    this.messageChange.emit(insertText);
    this.hideUnifiedSuggestions();
    textarea.focus();
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  hideUnifiedSuggestions(): void {
    this._showUnifiedSuggestions.set(false);
    this._suggestionType.set(null);
    this._unifiedSuggestions.set([]);
    this._triggerPosition.set(-1);
  }

  removeFile(filePath: string): void {
    this.filePickerService.removeFile(filePath);
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  // === Document click handler ===
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.showUnifiedSuggestions()) return;

    const target = event.target as Element;
    const dropdown = target.closest('ptah-unified-suggestions-dropdown');
    const input = this.messageInput();
    const textarea = input?.nativeElement;

    if (!dropdown && target !== textarea) {
      this.hideUnifiedSuggestions();
    }
  }

  // === Private helper methods ===
  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 200;
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }

  private async handleAtSymbolInput(
    textarea: HTMLTextAreaElement
  ): Promise<void> {
    const cursorPos = textarea.selectionStart || 0;
    const text = textarea.value;
    const textBeforeCursor = text.substring(0, cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      // No @ found, hide if currently showing @ suggestions
      if (
        this._suggestionType() === 'file' ||
        this._suggestionType() === 'agent' ||
        this._suggestionType() === 'mcp'
      ) {
        this.hideUnifiedSuggestions();
      }
      return;
    }

    const charBeforeAt =
      lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    const isValidAtPosition = /\s/.test(charBeforeAt) || lastAtIndex === 0;

    if (!isValidAtPosition) {
      this.hideUnifiedSuggestions();
      return;
    }

    const searchText = textBeforeCursor.substring(lastAtIndex + 1);

    if (searchText.includes(' ')) {
      this.hideUnifiedSuggestions();
      return;
    }

    // TASK_2025_019: Unified autocomplete logic
    await this.filePickerService.ensureFilesLoaded();

    this._triggerPosition.set(lastAtIndex);

    // Determine suggestion type based on pattern
    if (searchText.includes(':')) {
      // MCP resource pattern: @server:resource
      const serverName = searchText.split(':')[0];
      const suggestions = this.mcpDiscovery.searchServers(serverName);
      this._suggestionType.set('mcp');
      this._unifiedSuggestions.set(
        suggestions.map((s) => {
          const { type: _, ...rest } = s;
          return {
            type: 'mcp' as const,
            ...rest,
            description: `MCP ${s.type} server - ${s.status}`,
          };
        })
      );
    } else if (searchText.match(/^[a-z0-9-]+$/)) {
      // Could be agent or file - check both
      const agentSuggestions = this.agentDiscovery.searchAgents(searchText);
      const fileSuggestions = this.filePickerService.searchFiles(searchText);

      const unified: SuggestionItem[] = [];

      // Add agents first (if any)
      if (agentSuggestions.length > 0) {
        unified.push(
          ...agentSuggestions.map((s) => ({ type: 'agent' as const, ...s }))
        );
      }

      // Add files (with icon generation)
      if (fileSuggestions.length > 0) {
        unified.push(
          ...fileSuggestions.map((s) => {
            const { type: _, ...rest } = s;
            return {
              type: 'file' as const,
              ...rest,
              icon: this.getFileIcon(s),
              description: s.directory,
            };
          })
        );
      }

      this._suggestionType.set(agentSuggestions.length > 0 ? 'agent' : 'file');
      this._unifiedSuggestions.set(unified);
    } else {
      // File path pattern (contains . or /)
      const fileSuggestions = this.filePickerService.searchFiles(searchText);
      this._suggestionType.set('file');
      this._unifiedSuggestions.set(
        fileSuggestions.map((s) => {
          const { type: _, ...rest } = s;
          return {
            type: 'file' as const,
            ...rest,
            icon: this.getFileIcon(s),
            description: s.directory,
          };
        })
      );
    }

    this.updateDropdownPosition(textarea, lastAtIndex);
    this._showUnifiedSuggestions.set(true);
  }

  private handleSlashTrigger(textarea: HTMLTextAreaElement): void {
    const cursorPos = textarea.selectionStart || 0;
    const text = textarea.value;
    const textBeforeCursor = text.substring(0, cursorPos);

    const lastSlashIndex = textBeforeCursor.lastIndexOf('/');

    if (lastSlashIndex === -1) {
      // No / found, hide if currently showing command suggestions
      if (this._suggestionType() === 'command') {
        this.hideUnifiedSuggestions();
      }
      return;
    }

    // Check if / is at line start
    const textBeforeSlash = textBeforeCursor.substring(0, lastSlashIndex);
    const lastNewlineIndex = textBeforeSlash.lastIndexOf('\n');
    const textAfterNewline = textBeforeSlash.substring(lastNewlineIndex + 1);

    if (textAfterNewline.trim() !== '') {
      // Not at line start - hide if showing commands
      if (this._suggestionType() === 'command') {
        this.hideUnifiedSuggestions();
      }
      return;
    }

    const searchText = textBeforeCursor.substring(lastSlashIndex + 1);

    if (searchText.includes(' ')) {
      this.hideUnifiedSuggestions();
      return;
    }

    // Search commands
    this._triggerPosition.set(lastSlashIndex);
    const commandSuggestions = this.commandDiscovery.searchCommands(searchText);
    this._suggestionType.set('command');
    this._unifiedSuggestions.set(
      commandSuggestions.map((s) => ({ type: 'command' as const, ...s }))
    );

    this.updateDropdownPosition(textarea, lastSlashIndex);
    this._showUnifiedSuggestions.set(true);
  }

  // Helper: Generate file icon (same as FileSuggestionsDropdown)
  private getFileIcon(file: FileSuggestion): string {
    if (file.isImage) return '🖼️';
    if (file.isText) return '📄';

    const ext = file.extension?.toLowerCase();
    switch (ext) {
      case '.ts':
        return '🔵';
      case '.js':
        return '🟡';
      case '.html':
        return '🌐';
      case '.css':
      case '.scss':
        return '🎨';
      case '.json':
        return '📋';
      case '.md':
        return '📝';
      case '.py':
        return '🐍';
      case '.java':
        return '☕';
      case '.go':
        return '🐹';
      case '.rs':
        return '🦀';
      case '.php':
        return '🐘';
      case '.rb':
        return '💎';
      default:
        return '📄';
    }
  }

  private updateDropdownPosition(
    textarea: HTMLTextAreaElement,
    atPosition: number
  ): void {
    const rect = textarea.getBoundingClientRect();
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseInt(style.lineHeight) || 20;

    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) {
      // Fallback if canvas context is not available
      this._dropdownPosition.set({ top: 0, left: 0 });
      return;
    }

    context.font = style.font;

    const textBeforeAt = textarea.value.substring(0, atPosition);
    const lines = textBeforeAt.split('\n');
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex] || '';

    const textWidth = context.measureText(currentLineText).width;
    const paddingLeft = parseInt(style.paddingLeft) || 12;
    const paddingTop = parseInt(style.paddingTop) || 8;

    const left = Math.min(textWidth + paddingLeft, rect.width - 300);
    const top = currentLineIndex * lineHeight + paddingTop - 40;

    this._dropdownPosition.set({ top, left });
  }
}
