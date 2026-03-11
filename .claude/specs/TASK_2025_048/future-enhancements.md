# Future Enhancements - TASK_2025_048

## Overview

This document captures modernization opportunities identified during TASK_2025_048 (Shared CDK Overlay UI Library). These are **enhancements**, not migrations - the chat library is already following Angular 20+ best practices.

---

## High Priority

### 1. Implement Copy-to-Clipboard Functionality

**Component**: `libs/frontend/chat/src/lib/components/message-bubble/message-bubble.component.ts`

**Current Issue**: Copy button exists (line 78-80) but has no functionality

**CDK Module**: `@angular/cdk/clipboard`

**Effort**: 2 hours

**Implementation**:

```typescript
import { Clipboard, ClipboardModule } from '@angular/cdk/clipboard';

@Component({
  imports: [
    // ... existing imports
    ClipboardModule,
  ],
})
export class MessageBubbleComponent {
  private readonly clipboard = inject(Clipboard);

  protected copyMessage(): void {
    const content = this.message().rawContent || '';
    const success = this.clipboard.copy(content);

    if (success) {
      // Show toast notification or temporarily change icon to CheckCircle
      console.log('[MessageBubble] Copied to clipboard');
    }
  }
}
```

**Template Update**:

```html
<button class="btn btn-xs btn-ghost" (click)="copyMessage()" aria-label="Copy message" title="Copy">
  <lucide-angular [img]="CopyIcon" class="w-3.5 h-3.5" />
</button>
```

**Benefits**:

- Cross-browser clipboard support
- Fallback for older browsers
- Visual feedback on copy success
- User expectation fulfilled (button exists but doesn't work)

---

## Medium Priority

### 2. Migrate Confirmation Dialog to CDK Dialog

**Component**: `libs/frontend/chat/src/lib/components/confirmation-dialog/confirmation-dialog.component.ts`

**Current Issue**: Uses native HTML `<dialog>` element with manual state management

**CDK Module**: `@angular/cdk/dialog`

**Effort**: 4 hours

**Current Pattern**:

```html
<dialog #dialog class="modal">
  <!-- Manual dialog content -->
</dialog>
```

**Recommended Pattern**:

```typescript
import { Dialog, DialogModule } from '@angular/cdk/dialog';

@Injectable({ providedIn: 'root' })
export class ConfirmationService {
  private readonly dialog = inject(Dialog);

  async confirm(options: ConfirmOptions): Promise<boolean> {
    const dialogRef = this.dialog.open(ConfirmDialogComponent, {
      data: options,
      hasBackdrop: true,
      backdropClass: 'cdk-overlay-dark-backdrop',
    });
    return firstValueFrom(dialogRef.closed);
  }
}
```

**Benefits**:

- Better accessibility (focus trap, ARIA roles)
- Programmatic dialog creation via `Dialog.open()`
- Built-in backdrop and escape key handling
- Consistent with Angular CDK ecosystem

---

### 3. Migrate ViewChild to Signal-Based API

**Component**: `libs/frontend/chat/src/lib/components/chat-view/chat-view.component.ts`

**Current Issue**: Uses `@ViewChild()` decorator instead of signal-based `viewChild()`

**Effort**: 1 hour

**Current Pattern**:

```typescript
@ViewChild('messageContainer') messageContainer?: ElementRef<HTMLElement>;
```

**Modern Pattern**:

```typescript
private readonly messageContainer = viewChild<ElementRef<HTMLElement>>('messageContainer');
```

**Benefits**:

- Reactive signal-based API
- Better type safety (no optional chaining needed)
- Consistent with Angular 20+ signal patterns
- Already used in chat-input.component.ts

---

## Low Priority

### 4. Virtual Scrolling for Message List

**Component**: `libs/frontend/chat/src/lib/components/chat-view/chat-view.component.ts`

**Current Issue**: Renders all messages in DOM, could cause performance issues with 100+ messages

**CDK Module**: `@angular/cdk/scrolling`

**Effort**: 8 hours

**When to Implement**: Only if performance issues occur with large message lists

**Current Pattern**:

```html
<div class="flex-1 overflow-y-auto">
  @for (message of messages(); track message.id) {
  <ptah-message-bubble [message]="message" />
  }
</div>
```

**Recommended Pattern**:

```html
<cdk-virtual-scroll-viewport itemSize="100" class="flex-1">
  <ptah-message-bubble *cdkVirtualFor="let message of messages(); trackBy: trackById" [message]="message" />
</cdk-virtual-scroll-viewport>
```

**Challenges**:

- Messages have variable heights (need `autosize` strategy)
- Scroll-to-bottom behavior for new messages
- Anchor scroll position when loading older messages

**Benefits**:

- Only renders visible messages (better performance)
- Smooth scrolling with dynamic height support
- Handles 1000+ messages without lag

---

### 5. CDK Tooltip for File Paths

**Component**: `libs/frontend/chat/src/lib/components/file-path-link/file-path-link.component.ts`

**Current Issue**: Uses native `title` attribute for tooltips (limited styling, poor UX)

**CDK Module**: `@angular/cdk/tooltip` (or custom ptah-tooltip component)

**Effort**: 1 hour

**Current Pattern**:

```html
<span [title]="fullPath()">{{ getShortPath() }}</span>
```

**Recommended Pattern**:

```html
<span [cdkTooltip]="fullPath()" cdkTooltipPosition="above" cdkTooltipShowDelay="500"> {{ getShortPath() }} </span>
```

**Benefits**:

- Custom styling and positioning
- Show/hide delays
- Rich content support (not just text)

**Note**: LOW priority - native `title` works fine for simple text tooltips

---

### 6. Remove Explicit `standalone: true`

**Component**: Various components in chat library

**Current Issue**: `standalone: true` explicitly set in `@Component` decorator

**Effort**: 0.5 hours

**Note**: In Angular 20+, components are standalone by default. This is a cosmetic improvement only.

---

## Summary

| Priority | Enhancement                | Effort | Module          |
| -------- | -------------------------- | ------ | --------------- |
| HIGH     | Copy-to-Clipboard          | 2h     | `cdk/clipboard` |
| MEDIUM   | CDK Dialog Migration       | 4h     | `cdk/dialog`    |
| MEDIUM   | ViewChild Signal Migration | 1h     | Angular signals |
| LOW      | Virtual Scrolling          | 8h     | `cdk/scrolling` |
| LOW      | CDK Tooltip                | 1h     | `cdk/tooltip`   |
| LOW      | Remove explicit standalone | 0.5h   | Cosmetic        |

**Total Estimated Effort**: 16.5h (or 7h for HIGH+MEDIUM only)

---

## Observations

**Already Modernized** (no work needed):

- All components use `input()` and `output()` signals
- All components use `ChangeDetectionStrategy.OnPush`
- All components use signal-based state management
- Dropdown/popover components migrated to CDK Overlay
- Keyboard navigation implemented with `ActiveDescendantKeyManager`
- No legacy Angular patterns detected

---

## Recommended Next Task

**TASK_2025_050**: Implement Copy-to-Clipboard Functionality

Create a new task to implement the copy button with `@angular/cdk/clipboard`. This is:

- High value, low effort (2h)
- User-facing feature (button exists but doesn't work)
- Foundation for other message actions (ThumbsUp/ThumbsDown could follow same pattern)
