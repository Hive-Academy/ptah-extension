/**
 * Chat Input Area Component
 *
 * Multi-line message input with advanced features:
 * - Agent selection dropdown
 * - File inclusion with @ mentions
 * - File optimization suggestions
 * - Auto-resizing textarea
 * - Keyboard shortcuts (Ctrl+Enter to send)
 *
 * ARCHITECTURE:
 * - Level 2 component (depends on FileTag, FileSuggestions - Level 0)
 * - Modern Angular 20 patterns (input/output/computed/viewChild/inject)
 * - OnPush change detection for performance
 *
 * DEPENDENCIES:
 * - FileTagComponent (Level 0) ✅
 * - FileSuggestionsDropdownComponent (Level 0) ✅
 * - FilePickerService ⚠️ (needs migration from core)
 * - VSCodeDropdownComponent ⚠️ (needs migration from shared-ui)
 * - VSCodeActionButtonComponent ⚠️ (needs migration from shared-ui)
 *
 * TODO: Update imports once all dependencies are migrated
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
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { LucideAngularModule, Send, Command } from 'lucide-angular';
import { type DropdownOption } from '@ptah-extension/shared';

// Core services - Already migrated ✅
import { FilePickerService, type FileSuggestion } from '@ptah-extension/core';

// Shared UI components - Already migrated ✅
import {
  DropdownComponent,
  ActionButtonComponent,
} from '@ptah-extension/shared-ui';

// Chat components - Already migrated ✅
import { FileSuggestionsDropdownComponent } from '../file-suggestions-dropdown/file-suggestions-dropdown.component';
import { FileTagComponent } from '../file-tag/file-tag.component';

/**
 * Chat Input Area - Message input with file suggestions and agent selection
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
    FileSuggestionsDropdownComponent,
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

          <!-- File Suggestions Dropdown -->
          @if (showFileSuggestions()) {
          <ptah-file-suggestions-dropdown
            [suggestions]="fileSuggestions()"
            [searchQuery]="fileSearchQuery()"
            [isLoading]="filePickerService.isLoading()"
            [positionTop]="dropdownPosition().top"
            [positionLeft]="dropdownPosition().left"
            (suggestionSelected)="selectFileSuggestion($event)"
            (closed)="hideFileSuggestions()"
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
export class ChatInputAreaComponent {
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

  // === Internal state signals ===
  private readonly _showFileSuggestions = signal(false);
  private readonly _fileSearchQuery = signal('');
  private readonly _fileSuggestions = signal<FileSuggestion[]>([]);
  private readonly _dropdownPosition = signal({ top: 0, left: 0 });
  private readonly _caretPosition = signal(0);
  private readonly _atSymbolPosition = signal(-1);

  // === Readonly signals for external access ===
  readonly showFileSuggestions = this._showFileSuggestions.asReadonly();
  readonly fileSearchQuery = this._fileSearchQuery.asReadonly();
  readonly fileSuggestions = this._fileSuggestions.asReadonly();
  readonly dropdownPosition = this._dropdownPosition.asReadonly();

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

  // === Event handlers ===
  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.messageChange.emit(target.value);
    this.adjustTextareaHeight(target);
    this.handleAtSymbolInput(target);
  }

  onSelectionChange(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this._caretPosition.set(target.selectionStart || 0);
  }

  onKeyDown(event: KeyboardEvent): void {
    // Handle file suggestion navigation
    if (this.showFileSuggestions()) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          this.hideFileSuggestions();
          return;
        case 'ArrowDown':
        case 'ArrowUp':
        case 'Enter':
          // Let the dropdown component handle these
          return;
      }
    }

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

  // === File suggestion handling ===
  selectFileSuggestion(suggestion: FileSuggestion): void {
    const input = this.messageInput();
    if (!input) return;

    const textarea = input.nativeElement;
    const currentText = textarea.value;
    const atPos = this._atSymbolPosition();
    const cursorPos = textarea.selectionStart || 0;

    if (atPos === -1) return;

    // Replace @search with @filename
    const beforeAt = currentText.substring(0, atPos);
    const afterCursor = currentText.substring(cursorPos);
    const newText = `${beforeAt}@${suggestion.name} ${afterCursor}`;

    // Update textarea
    textarea.value = newText;
    const newCursorPos = atPos + suggestion.name.length + 2; // +2 for @ and space
    textarea.setSelectionRange(newCursorPos, newCursorPos);

    // Emit changes
    this.messageChange.emit(newText);
    this.filePickerService.includeFile(suggestion.path);
    this.hideFileSuggestions();
    textarea.focus();
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  hideFileSuggestions(): void {
    this._showFileSuggestions.set(false);
    this._fileSearchQuery.set('');
    this._fileSuggestions.set([]);
    this._atSymbolPosition.set(-1);
  }

  removeFile(filePath: string): void {
    this.filePickerService.removeFile(filePath);
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  // === Document click handler ===
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.showFileSuggestions()) return;

    const target = event.target as Element;
    const dropdown = target.closest('ptah-file-suggestions-dropdown');
    const input = this.messageInput();
    const textarea = input?.nativeElement;

    if (!dropdown && target !== textarea) {
      this.hideFileSuggestions();
    }
  }

  // === Private helper methods ===
  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 200;
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }

  private handleAtSymbolInput(textarea: HTMLTextAreaElement): void {
    const cursorPos = textarea.selectionStart || 0;
    const text = textarea.value;
    const textBeforeCursor = text.substring(0, cursorPos);

    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      this.hideFileSuggestions();
      return;
    }

    const charBeforeAt =
      lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    const isValidAtPosition = /\s/.test(charBeforeAt) || lastAtIndex === 0;

    if (!isValidAtPosition) {
      this.hideFileSuggestions();
      return;
    }

    const searchText = textBeforeCursor.substring(lastAtIndex + 1);

    if (searchText.includes(' ')) {
      this.hideFileSuggestions();
      return;
    }

    this._atSymbolPosition.set(lastAtIndex);
    this._fileSearchQuery.set(searchText);

    const suggestions = this.filePickerService.searchFiles(searchText);
    this._fileSuggestions.set(suggestions);

    this.updateDropdownPosition(textarea, lastAtIndex);
    this._showFileSuggestions.set(true);
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
