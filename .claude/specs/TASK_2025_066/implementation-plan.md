# Implementation Plan - TASK_2025_066

## Goal Description

Fix two related visual bugs in the ngx-markdown rendering within chat bubbles:

1. **Width Overflow**: Tables and other wide content break the chat bubble container layout
2. **Table Styling**: Markdown tables render without proper borders, padding, and spacing

## Proposed Changes

### Component: Chat Message Display

#### [MODIFY] [message-bubble.component.css](file:///d:/projects/ptah-extension/libs/frontend/chat/src/lib/components/organisms/message-bubble.component.css)

**Current State**: Basic markdown styling with code/pre blocks, no table handling

**Changes**:

- Add `overflow-x: auto` wrapper for horizontal scrolling on wide content
- Add comprehensive table styling (borders, padding, spacing, alignment)
- Add word-wrap rules for table cells to prevent overflow
- Use proper table-layout for responsive behavior

**CSS Structure**:

```css
/* Overflow wrapper for wide content */
:host ::ng-deep markdown {
  display: block;
  max-width: 100%;
  overflow-x: auto;
}

/* Table base styling */
:host ::ng-deep markdown table {
  border-collapse: collapse;
  width: 100%;
  margin: 0.75em 0;
  table-layout: auto;
}

/* Table cells - borders and padding */
:host ::ng-deep markdown th,
:host ::ng-deep markdown td {
  border: 1px solid rgba(255, 255, 255, 0.2);
  padding: 8px 12px;
  text-align: left;
  word-wrap: break-word;
}

/* Table headers */
:host ::ng-deep markdown th {
  background-color: rgba(0, 0, 0, 0.3);
  font-weight: 600;
}

/* Zebra striping for rows */
:host ::ng-deep markdown tr:nth-child(even) {
  background-color: rgba(0, 0, 0, 0.1);
}
```

---

## Verification Plan

### Automated Tests

- Manual verification with browser inspection (no automated tests needed for CSS-only changes)

### Manual Verification

1. **Test Wide Content**: Create a chat message with a wide markdown table
2. **Verify Horizontal Scroll**: Confirm `overflow-x: auto` adds scrollbar for wide tables
3. **Verify Table Styling**: Confirm tables have borders, padding, and zebra striping
4. **Test Word Wrap**: Verify long text in table cells wraps properly
5. **Test Existing Markdown**: Verify code blocks, inline code, and paragraphs still render correctly
