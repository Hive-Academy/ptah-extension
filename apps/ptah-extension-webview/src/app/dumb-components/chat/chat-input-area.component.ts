import {
  Component,
  Input,
  Output,
  EventEmitter,
  ViewChild,
  ElementRef,
  ChangeDetectionStrategy,
  HostListener,
  inject,
  DestroyRef,
  computed,
  signal,
} from '@angular/core';
import { CommonModule } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { LucideAngularModule, SendIcon, CommandIcon } from 'lucide-angular';
import { VSCodeDropdownComponent } from '../../smart-components/forms/vscode-dropdown.component';
import { VSCodeActionButtonComponent } from '../inputs/action-button.component';
import { VSCodeFileSuggestionsDropdownComponent } from './file-suggestions-dropdown.component';
import { VSCodeFileTagComponent } from './file-tag.component';
import { type DropdownOption } from '@ptah-extension/shared';
import {
  FilePickerService,
  type FileSuggestion,
  type ChatFile,
} from '../../core/services/file-picker.service';

/**
 * VS Code Chat Input Area - Pure Presentation Component
 * - Message input with agent selection and send button
 * - No business logic or state management
 * - Pure VS Code styling - NO Tailwind classes
 * - Accessible form controls with proper labels
 */
@Component({
  selector: 'vscode-chat-input-area',
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    VSCodeDropdownComponent,
    VSCodeActionButtonComponent,
    VSCodeFileSuggestionsDropdownComponent,
    VSCodeFileTagComponent,
  ],

  template: `
    <footer class="vscode-input-area">
      <div class="vscode-input-controls">
        <!-- Agent Selection -->
        <vscode-dropdown
          [options]="agentOptions"
          [placeholder]="'Select Agent'"
          [(ngModel)]="selectedAgentValue"
          [disabled]="disabled"
          [ariaLabel]="'Agents'"
          (selectionChange)="onAgentChange($event)"
          class="vscode-agent-selector"
        ></vscode-dropdown>

        <!-- Commands Button -->
        <vscode-action-button
          [icon]="CommandIcon"
          [disabled]="disabled"
          [ariaLabel]="'Open quick commands'"
          variant="secondary"
          (buttonClick)="commandsClick.emit()"
        ></vscode-action-button>
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
              <vscode-file-tag
                [file]="file"
                [showMetadata]="true"
                (removeFile)="removeFile(file.path)"
              ></vscode-file-tag>
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
            [(ngModel)]="message"
            [placeholder]="placeholder"
            [disabled]="disabled"
            [rows]="3"
            (keydown)="onKeyDown($event)"
            (input)="onInput($event)"
            (selectionChange)="onSelectionChange($event)"
            [attr.aria-label]="'Type your message'"
            [attr.aria-describedby]="'input-help'"
          ></textarea>

          <!-- File Suggestions Dropdown -->
          @if (showFileSuggestions()) {
            <vscode-file-suggestions-dropdown
              [suggestions]="fileSuggestions()"
              [searchQuery]="fileSearchQuery()"
              [isLoading]="filePickerService.isLoading()"
              [positionTop]="dropdownPosition().top"
              [positionLeft]="dropdownPosition().left"
              (suggestionSelected)="selectFileSuggestion($event)"
              (closed)="hideFileSuggestions()"
            ></vscode-file-suggestions-dropdown>
          }
        </div>

        <vscode-action-button
          [icon]="SendIcon"
          [disabled]="!canSend"
          [ariaLabel]="'Send message'"
          variant="primary"
          (buttonClick)="sendMessage.emit()"
        ></vscode-action-button>
      </div>

      <!-- Input Helper Text -->
      <div id="input-help" class="vscode-input-help" [attr.aria-live]="'polite'">
        @if (disabled) {
          <span class="vscode-help-text">Please wait while processing...</span>
        } @else if (message.length > 0) {
          <span class="vscode-help-text">Press Ctrl+Enter to send, or click the send button</span>
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

        .vscode-send-button {
          border: 1px solid var(--vscode-contrastBorder);
        }
      }

      /* Focus Management for Screen Readers */
      .vscode-message-textarea:focus + .vscode-send-button {
        /* Ensure send button is easily discoverable after textarea */
      }
    `,
  ],
})
export class VSCodeChatInputAreaComponent {
  @ViewChild('messageInput') messageInput!: ElementRef<HTMLTextAreaElement>;

  // Injected services
  readonly filePickerService = inject(FilePickerService);
  private readonly destroyRef = inject(DestroyRef);

  @Input() message: string = '';
  @Input() selectedAgent: string = '';
  @Input() agentOptions: DropdownOption[] = [];
  @Input() disabled: boolean = false;
  @Input() placeholder: string = 'Type your task here...';
  @Input() canSend: boolean = false;

  // ANGULAR 20 PATTERN: Private signals for component state
  private readonly _showFileSuggestions = signal(false);
  private readonly _fileSearchQuery = signal('');
  private readonly _fileSuggestions = signal<FileSuggestion[]>([]);
  private readonly _dropdownPosition = signal({ top: 0, left: 0 });
  private readonly _caretPosition = signal(0);
  private readonly _atSymbolPosition = signal(-1);

  // ANGULAR 20 PATTERN: Readonly signals for external access
  readonly showFileSuggestions = this._showFileSuggestions.asReadonly();
  readonly fileSearchQuery = this._fileSearchQuery.asReadonly();
  readonly fileSuggestions = this._fileSuggestions.asReadonly();
  readonly dropdownPosition = this._dropdownPosition.asReadonly();

  // ANGULAR 20 PATTERN: Computed signals for derived state
  readonly includedFiles = computed(() => this.filePickerService.includedFiles());
  readonly optimizationSuggestions = computed(() =>
    this.filePickerService.optimizationSuggestions(),
  );
  readonly hasIncludedFiles = computed(() => this.includedFiles().length > 0);

  // For ngModel binding
  get selectedAgentValue(): string {
    return this.selectedAgent;
  }

  set selectedAgentValue(value: string) {
    // This will be handled by selectionChange event
  }

  @Output() messageChange = new EventEmitter<string>();
  @Output() agentChange = new EventEmitter<DropdownOption>();
  @Output() sendMessage = new EventEmitter<void>();
  @Output() keyDown = new EventEmitter<KeyboardEvent>();
  @Output() commandsClick = new EventEmitter<void>();
  @Output() filesChanged = new EventEmitter<string[]>();

  readonly SendIcon = SendIcon;
  readonly CommandIcon = CommandIcon;

  onInput(event: Event): void {
    const target = event.target as HTMLTextAreaElement;
    this.messageChange.emit(target.value);
    this.adjustTextareaHeight(target);

    // Handle @ syntax for file suggestions
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

  focus(): void {
    this.messageInput?.nativeElement.focus();
  }

  private adjustTextareaHeight(textarea: HTMLTextAreaElement): void {
    // Auto-resize textarea
    textarea.style.height = 'auto';
    const scrollHeight = textarea.scrollHeight;
    const maxHeight = 200; // max-height in pixels
    textarea.style.height = Math.min(scrollHeight, maxHeight) + 'px';
  }

  /**
   * Handle @ symbol input for file suggestions
   */
  private handleAtSymbolInput(textarea: HTMLTextAreaElement): void {
    const cursorPos = textarea.selectionStart || 0;
    const text = textarea.value;
    const textBeforeCursor = text.substring(0, cursorPos);

    // Find the last @ symbol before cursor
    const lastAtIndex = textBeforeCursor.lastIndexOf('@');

    if (lastAtIndex === -1) {
      // No @ symbol found, hide suggestions
      this.hideFileSuggestions();
      return;
    }

    // Check if @ symbol is at start of line or preceded by whitespace
    const charBeforeAt = lastAtIndex > 0 ? textBeforeCursor[lastAtIndex - 1] : ' ';
    const isValidAtPosition = /\s/.test(charBeforeAt) || lastAtIndex === 0;

    if (!isValidAtPosition) {
      this.hideFileSuggestions();
      return;
    }

    // Extract search query after @
    const searchText = textBeforeCursor.substring(lastAtIndex + 1);

    // Check if there's a space in the search text (end of @ mention)
    if (searchText.includes(' ')) {
      this.hideFileSuggestions();
      return;
    }

    // Update search state
    this._atSymbolPosition.set(lastAtIndex);
    this._fileSearchQuery.set(searchText);

    // Search for file suggestions
    const suggestions = this.filePickerService.searchFiles(searchText);
    this._fileSuggestions.set(suggestions);

    // Calculate dropdown position
    this.updateDropdownPosition(textarea, lastAtIndex);

    // Show suggestions
    this._showFileSuggestions.set(true);
  }

  /**
   * Calculate dropdown position relative to cursor
   */
  private updateDropdownPosition(textarea: HTMLTextAreaElement, atPosition: number): void {
    const rect = textarea.getBoundingClientRect();
    const style = window.getComputedStyle(textarea);
    const lineHeight = parseInt(style.lineHeight) || 20;

    // Create a temporary element to measure text dimensions
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d')!;
    context.font = style.font;

    // Get text up to @ position to calculate cursor position
    const textBeforeAt = textarea.value.substring(0, atPosition);
    const lines = textBeforeAt.split('\n');
    const currentLineIndex = lines.length - 1;
    const currentLineText = lines[currentLineIndex] || '';

    // Calculate approximate cursor position
    const textWidth = context.measureText(currentLineText).width;
    const paddingLeft = parseInt(style.paddingLeft) || 12;
    const paddingTop = parseInt(style.paddingTop) || 8;

    const left = Math.min(textWidth + paddingLeft, rect.width - 300); // Ensure dropdown fits
    const top = currentLineIndex * lineHeight + paddingTop - 40; // Position above cursor

    this._dropdownPosition.set({ top, left });
  }

  /**
   * Select a file suggestion and insert it into the message
   */
  selectFileSuggestion(suggestion: FileSuggestion): void {
    const textarea = this.messageInput.nativeElement;
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

    // Emit change
    this.messageChange.emit(newText);

    // Include the file
    this.filePickerService.includeFile(suggestion.path);

    // Hide suggestions
    this.hideFileSuggestions();

    // Focus back to textarea
    textarea.focus();

    // Emit files changed
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  /**
   * Hide file suggestions dropdown
   */
  hideFileSuggestions(): void {
    this._showFileSuggestions.set(false);
    this._fileSearchQuery.set('');
    this._fileSuggestions.set([]);
    this._atSymbolPosition.set(-1);
  }

  /**
   * Remove a file from inclusion
   */
  removeFile(filePath: string): void {
    this.filePickerService.removeFile(filePath);
    this.filesChanged.emit(this.filePickerService.getFilePathsForMessage());
  }

  /**
   * Handle document click to hide suggestions
   */
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: Event): void {
    if (!this.showFileSuggestions()) return;

    const target = event.target as Element;
    const dropdown = target.closest('vscode-file-suggestions-dropdown');
    const textarea = this.messageInput?.nativeElement;

    if (!dropdown && target !== textarea) {
      this.hideFileSuggestions();
    }
  }

  /**
   * Get included file paths for message transmission
   */
  getIncludedFilePaths(): string[] {
    return this.filePickerService.getFilePathsForMessage();
  }
}
