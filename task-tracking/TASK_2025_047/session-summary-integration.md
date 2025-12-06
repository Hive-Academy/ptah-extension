# Session Cost Summary - Integration Guide

## Component Overview

**Component**: `SessionCostSummaryComponent`
**Location**: `@ptah-extension/chat`
**Type**: Molecule (Level 2 complexity)
**Pattern**: Standalone Angular component with signal inputs

## Purpose

Displays session-level cost and token totals with expandable details:

- Summary view: Total cost, total tokens, message count
- Expanded view: Input/output token breakdown, average cost per message
- Graceful degradation: Shows "No usage data available" when messageCount = 0

## Signal Inputs

```typescript
readonly totalCost = input.required<number>();
readonly totalTokensInput = input.required<number>();
readonly totalTokensOutput = input.required<number>();
readonly messageCount = input.required<number>();
```

## Integration Options

### Option A: Chat Header (Recommended)

**Location**: Above chat messages in the main chat view
**Visibility**: Always visible, prominent position
**User Experience**: Users see session costs at a glance

**Implementation**:

```typescript
// In chat-view.component.ts or parent container
import { SessionCostSummaryComponent } from '@ptah-extension/chat';
import { calculateSessionTotals } from '@ptah-extension/shared';

@Component({
  selector: 'ptah-chat-view',
  standalone: true,
  imports: [SessionCostSummaryComponent /* other imports */],
  template: `
    <!-- Session summary at top -->
    <ptah-session-cost-summary [totalCost]="sessionTotals().totalCost" [totalTokensInput]="sessionTotals().totalTokensInput" [totalTokensOutput]="sessionTotals().totalTokensOutput" [messageCount]="sessionTotals().messagesWithCost" />

    <!-- Chat messages below -->
    <div class="chat-messages">
      <!-- message bubbles -->
    </div>
  `,
})
export class ChatViewComponent {
  // Computed signal that calculates totals from messages
  protected readonly sessionTotals = computed(() => {
    const messages = this.chatStore.messages();
    return calculateSessionTotals(messages);
  });
}
```

### Option B: Sidebar Panel

**Location**: Collapsible sidebar panel
**Visibility**: On-demand (user opens sidebar)
**User Experience**: Less intrusive, more details possible

**Implementation**:

```typescript
// In app-shell.component.ts or sidebar component
template: `
  <aside class="sidebar">
    <div class="sidebar-section">
      <h3>Session Statistics</h3>
      <ptah-session-cost-summary
        [totalCost]="sessionTotals().totalCost"
        [totalTokensInput]="sessionTotals().totalTokensInput"
        [totalTokensOutput]="sessionTotals().totalTokensOutput"
        [messageCount]="sessionTotals().messagesWithCost"
      />
    </div>
  </aside>
`;
```

### Option C: Tooltip on Session Info Icon

**Location**: Icon in chat header
**Visibility**: Hover/click to reveal
**User Experience**: Minimal footprint, optional information

**Implementation**:

```typescript
// Using DaisyUI tooltip
template: `
  <div class="tooltip" data-tip="Session statistics">
    <button class="btn btn-ghost btn-sm" (click)="showSessionStats()">
      <lucide-angular [img]="InfoIcon" />
    </button>
  </div>

  <!-- Modal or popover with SessionCostSummaryComponent -->
  @if (showStats()) {
    <dialog class="modal modal-open">
      <div class="modal-box">
        <ptah-session-cost-summary
          [totalCost]="sessionTotals().totalCost"
          [totalTokensInput]="sessionTotals().totalTokensInput"
          [totalTokensOutput]="sessionTotals().totalTokensOutput"
          [messageCount]="sessionTotals().messagesWithCost"
        />
      </div>
    </dialog>
  }
`;
```

## Calculating Session Totals

**CRITICAL**: Session totals MUST be calculated using the `calculateSessionTotals()` utility from `@ptah-extension/shared`.

### Import the Utility

```typescript
import { calculateSessionTotals } from '@ptah-extension/shared';
```

### Calculate Totals from Messages

```typescript
// Example 1: In a computed signal (reactive)
protected readonly sessionTotals = computed(() => {
  const messages = this.chatStore.messages();
  return calculateSessionTotals(messages);
});

// Example 2: In a method (manual calculation)
private updateSessionTotals(): void {
  const messages = this.chatStore.messages();
  const totals = calculateSessionTotals(messages);

  this.totalCost.set(totals.totalCost);
  this.totalTokensInput.set(totals.totalTokensInput);
  this.totalTokensOutput.set(totals.totalTokensOutput);
  this.messageCount.set(totals.messagesWithCost);
}

// Example 3: When persisting session to backend
private async saveSession(): Promise<void> {
  const messages = this.chatStore.messages();
  const totals = calculateSessionTotals(messages);

  const session: StrictChatSession = {
    id: this.sessionId,
    messages,
    totalCost: totals.totalCost,
    totalTokensInput: totals.totalTokensInput,
    totalTokensOutput: totals.totalTokensOutput,
    // ... other session fields
  };

  await this.sessionService.save(session);
}
```

### Where to Find Session Creation Points

To find where sessions are created/persisted in the codebase:

```bash
# Search for StrictChatSession usage
npx nx run ptah-extension:grep "StrictChatSession" --output_mode=files_with_matches

# Search for session save/persist methods
npx nx run ptah-extension:grep "saveSession|persistSession" --output_mode=files_with_matches

# Search for ChatStore methods that create sessions
npx nx run ptah-extension:grep "createSession|newSession" --output_mode=files_with_matches
```

Likely locations:

- `libs/frontend/chat/src/lib/services/chat.store.ts` (session state management)
- `libs/frontend/chat/src/lib/services/session-manager.service.ts` (session persistence)
- `libs/backend/claude-domain/src/lib/services/session.service.ts` (backend session handling)

## Edge Cases Handled

The component gracefully handles these edge cases:

1. **Zero Messages** (`messageCount = 0`):

   - Shows "No usage data available" instead of cost breakdown
   - Prevents division by zero in average calculation

2. **Zero Cost with Messages** (`totalCost = 0 && messageCount > 0`):

   - Valid state: Shows "$0.00"
   - Example: Free tier usage or messages without token data

3. **Division by Zero**:
   - `averageCostPerMessage()` checks `messageCount > 0` before dividing
   - Returns 0 if messageCount is 0

## Styling & Responsiveness

- **DaisyUI Classes**: Uses `card`, `badge`, `divider` for consistent styling
- **Responsive Grid**: Details section uses `grid grid-cols-2` for compact layout
- **Mobile-Friendly**: Text sizes and spacing adjust gracefully on small screens
- **Theme Support**: Uses DaisyUI semantic colors (`text-success`, `bg-base-200`)

## Accessibility

- **Semantic HTML**: Uses `<div>` with appropriate ARIA attributes (card semantics)
- **Keyboard Navigation**: Click to expand works with keyboard (button-like behavior)
- **Screen Readers**: Text labels are descriptive ("Session Cost:", "Input tokens:")

## Next Steps for Integration

1. **Choose Placement**: Decide between Option A (header), B (sidebar), or C (tooltip)
2. **Find Session State**: Use Grep to find where `ChatStore.messages()` is available
3. **Create Computed Signal**: Use `computed(() => calculateSessionTotals(messages))`
4. **Bind Inputs**: Pass totals to `SessionCostSummaryComponent` via signal inputs
5. **Test Edge Cases**: Verify behavior with 0 messages, 0 cost, and large numbers

## Example Full Integration

```typescript
import { Component, computed, inject } from '@angular/core';
import { SessionCostSummaryComponent } from '@ptah-extension/chat';
import { calculateSessionTotals } from '@ptah-extension/shared';
import { ChatStore } from './services/chat.store';

@Component({
  selector: 'ptah-chat-container',
  standalone: true,
  imports: [SessionCostSummaryComponent],
  template: `
    <!-- Session summary in header -->
    <header class="chat-header p-4 bg-base-100 border-b border-base-300">
      <h2 class="text-lg font-bold mb-2">Chat Session</h2>

      <ptah-session-cost-summary [totalCost]="sessionTotals().totalCost" [totalTokensInput]="sessionTotals().totalTokensInput" [totalTokensOutput]="sessionTotals().totalTokensOutput" [messageCount]="sessionTotals().messagesWithCost" />
    </header>

    <!-- Chat messages -->
    <main class="chat-messages overflow-y-auto flex-1">
      <!-- message bubbles rendered here -->
    </main>
  `,
})
export class ChatContainerComponent {
  private readonly chatStore = inject(ChatStore);

  /**
   * Reactively calculate session totals from messages
   * Updates automatically when messages change
   */
  protected readonly sessionTotals = computed(() => {
    const messages = this.chatStore.messages();
    return calculateSessionTotals(messages);
  });
}
```

## References

- **Session Totals Utility**: `libs/shared/src/lib/utils/session-totals.utils.ts`
- **Component Implementation**: `libs/frontend/chat/src/lib/components/molecules/session-cost-summary.component.ts`
- **Token Badge Pattern**: `libs/frontend/chat/src/lib/components/atoms/token-badge.component.ts`
- **DaisyUI Card Docs**: https://daisyui.com/components/card/
