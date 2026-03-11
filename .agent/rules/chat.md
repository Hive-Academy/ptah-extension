---
trigger: glob
globs: libs/frontend/chat/**/*.ts
---

# chat - Chat UI Components

**Active**: Working in `libs/frontend/chat/**/*.ts`

## Purpose

Complete chat interface with 11 components for message display, streaming, input, sessions, and file attachments.

## Responsibilities

✅ **Message Display**: Render text, code blocks, images with markdown
✅ **Input**: Multi-line textarea with @/@/ triggers, autocomplete
✅ **Streaming**: Real-time token display with stop control
✅ **Sessions**: List, create, delete, rename sessions
✅ **Attachments**: File/folder picker with preview

❌ **NOT**: Backend logic (→ agent-sdk), state management (→ core)

## Components (11)

```
libs/frontend/chat/src/lib/components/
├── chat-container/           # Main chat layout
├── chat-input/               # Multi-line input
with triggers
├── chat-message-list/        # Virtual scroll message list
├── chat-bubble/              # Single message bubble
├── chat-streaming/           # Streaming indicator
├── chat-empty-state/         # No messages placeholder
├── session-list/             # Session sidebar
├── session-item/             # Individual session
├── file-attachment/          # File picker
├── unified-suggestions/      # @/autocomplete dropdown
└── stop-button/              # Stop streaming
```

## Key Patterns

### 1. Signal-Based Component State

```typescript
@Component({
  selector: 'ptah-chat-input',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatInputComponent {
  // Internal state (private writable)
  private readonly _inputValue = signal('');
  private readonly _isStreaming = signal(false);

  // Public readonly signals
  readonly inputValue = this._inputValue.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();

  // Outputs
  readonly messageSent = output<string>();
  readonly streamStopped = output<void>();

  sendMessage(): void {
    if (this._inputValue().trim()) {
      this.messageSent.emit(this._inputValue());
      this._inputValue.set('');
    }
  }
}
```

### 2. VS Code Communication

```typescript
import { VSCodeService } from '@ptah-extension/core';

export class ChatContainerComponent {
  private readonly vscodeService = inject(VSCodeService);

  async startChat(message: string): Promise<void> {
    // Send RPC message to extension
    this.vscodeService.postMessage({
      type: 'chat:start',
      payload: {
        message,
        model: this.selectedModel(),
        files: this.attachedFiles(),
      },
    });
  }

  ngOnInit(): void {
    // Listen for responses
    this.vscodeService.onMessage<StreamingResponse>('chat:streaming', (response) => {
      this._streamingText.update((text) => text + response.token);
    });
  }
}
```

### 3. CDK Overlay for Dropdowns

```typescript
import { DropdownComponent, OptionComponent } from '@ptah-extension/ui';

@Component({
  template: `
    <ptah-dropdown [isOpen]="isDropdownOpen()" (closed)="closeDropdown()">
      <button trigger (click)="toggleDropdown()">Select Model</button>

      <div content>
        @for (model of models(); track model.id) {
        <ptah-option [optionId]="'model-' + model.id" [value]="model" (selected)="selectModel($event)">
          {{ model.name }}
        </ptah-option>
        }
      </div>
    </ptah-dropdown>
  `,
  imports: [DropdownComponent, OptionComponent],
})
export class ModelSelectorComponent {}
```

### 4. Trigger Directives (@//)

```typescript
@Directive({
  selector: 'textarea[chatInput]',
  standalone: true,
})
export class ChatTriggerDirective {
  @Output() triggerActivated = new EventEmitter<TriggerType>();

  @HostListener('input', ['$event'])
  onInput(event: Event): void {
    const textarea = event.target as HTMLTextAreaElement;
    const cursorPos = textarea.selectionStart;
    const textBeforeCursor = textarea.value.substring(0, cursorPos);
    const lastChar = textBeforeCursor[textBeforeCursor.length - 1];

    if (lastChar === '@') {
      this.triggerActivated.emit('file');
    } else if (lastChar === '/') {
      this.triggerActivated.emit('command');
    }
  }
}
```

## Streaming Pattern

### Component

```typescript
export class ChatStreamingComponent {
  private readonly chatService = inject(ChatService);

  // Signals for streaming state
  readonly streamingText = this.chatService.streamingText;
  readonly isStreaming = this.chatService.isStreaming;

  stopStreaming(): void {
    this.chatService.stopStream();
  }
}
```

### Service (in core lib)

```typescript
@Injectable()
export class ChatService {
  private readonly _streamingText = signal('');
  private readonly _isStreaming = signal(false);

  readonly streamingText = this._streamingText.asReadonly();
  readonly isStreaming = this._isStreaming.asReadonly();

  startStream(): void {
    this._isStreaming.set(true);
    this._streamingText.set('');
  }

  appendToken(token: string): void {
    this._streamingText.update((text) => text + token);
  }

  stopStream(): void {
    this._isStreaming.set(false);
    // Finalize message
    this.addMessageToHistory(this._streamingText());
    this._streamingText.set('');
  }
}
```

## Session Management

### Session List Component

```typescript
export class SessionListComponent {
  private readonly chatService = inject(ChatService);

  readonly sessions = this.chatService.sessions;
  readonly currentSessionId = this.chatService.currentSessionId;

  selectSession(sessionId: SessionId): void {
    this.chatService.switchSession(sessionId);
  }

  createSession(): void {
    this.chatService.createNewSession();
  }

  deleteSession(sessionId: SessionId): void {
    if (confirm('Delete this session?')) {
      this.chatService.deleteSession(sessionId);
    }
  }
}
```

## File Attachments

### File Picker Component

```typescript
export class FileAttachmentComponent {
  private readonly vscodeService = inject(VSCodeService);
  private readonly _attachedFiles = signal<FileAttachment[]>([]);

  readonly attachedFiles = this._attachedFiles.asReadonly();

  async pickFiles(): void {
    // Request file picker from extension
    const files = await this.vscodeService.requestFilePicker();

    this._attachedFiles.update((current) => [...current, ...files]);
  }

  removeFile(path: string): void {
    this._attachedFiles.update((files) => files.filter((f) => f.path !== path));
  }
}
```

## Markdown Rendering

### Using ngx-markdown

```typescript
import { MarkdownModule } from 'ngx-markdown';

@Component({
  selector: 'ptah-chat-bubble',
  standalone: true,
  imports: [MarkdownModule],
  template: `
    <div class="chat-bubble">
      <markdown [data]="message().content" [lineNumbers]="true" [clipboard]="true"> </markdown>
    </div>
  `,
})
export class ChatBubbleComponent {
  readonly message = input.required<ChatMessage>();
}
```

### Custom Markdown Styles

```css
/* libs/frontend/chat/src/lib/components/chat-bubble/chat-bubble.component.css */

/* Code blocks */
markdown pre {
  @apply bg-base-200 rounded-lg p-4 overflow-x-auto;
}

markdown code {
  @apply font-mono text-sm;
}

/* Tables */
markdown table {
  @apply table table-zebra w-full;
  overflow-x: auto;
  display: block;
}

markdown th {
  @apply bg-base-300;
}
```

## Testing

### Component Test Example

```typescript
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { signal } from '@angular/core';
import { ChatInputComponent } from './chat-input.component';
import { VSCodeService } from '@ptah-extension/core';

describe('ChatInputComponent', () => {
  let component: ChatInputComponent;
  let fixture: ComponentFixture<ChatInputComponent>;
  let mockVSCodeService: jest.Mocked<VSCodeService>;

  beforeEach(async () => {
    mockVSCodeService = {
      postMessage: jest.fn(),
      onMessage: jest.fn(),
    } as any;

    await TestBed.configureTestingModule({
      imports: [ChatInputComponent],
      providers: [{ provide: VSCodeService, useValue: mockVSCodeService }],
    }).compileComponents();

    fixture = TestBed.createComponent(ChatInputComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should emit message on send', () => {
    const spy = jest.fn();
    component.messageSent.subscribe(spy);

    component._inputValue.set('Hello');
    component.sendMessage();

    expect(spy).toHaveBeenCalledWith('Hello');
    expect(component.inputValue()).toBe(''); // Cleared
  });
});
```

## Rules

1. **ALL components: standalone + OnPush**
2. **Use signals, avoid RxJS** (except HTTP)
3. **CDK Overlay for dropdowns** (not DaisyUI dropdown)
4. **VS Code communication: VSCodeService.postMessage()**
5. **DaisyUI for styling** (chat-bubble, btn, etc.)
6. **Markdown: ngx-markdown with syntax highlighting**
7. **Virtual scrolling for message lists** (performance)

## Commands

```bash
nx test chat
nx build chat
nx typecheck chat
nx lint chat
```
