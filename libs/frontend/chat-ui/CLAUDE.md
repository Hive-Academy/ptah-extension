# libs/frontend/chat-ui - Presentational Chat UI Components

[Back to Main](../../../CLAUDE.md)

## Purpose

The **chat-ui library** is a reusable presentational (stateless) component library extracted from `@ptah-extension/chat` as part of TASK_2026_105 Wave G4. It provides chat UI atoms and molecules that can be consumed by any webview (electron, dashboard, canvas) **without pulling in the full chat feature library** and its state management.

## Key Responsibilities

- **Atoms**: 16 basic building blocks (badges, buttons, cursors, display helpers)
- **Molecules**: Composed UI pieces grouped by feature domain (62 files across 9 groups)
- **Utilities**: Agent color generation helpers
- **No services, no state, no orchestration** — purely presentational

## Relationship with `@ptah-extension/chat`

This library sits **below** the chat feature library in the dependency graph:

```
@ptah-extension/chat-ui   ← Presentational layer (this library)
        ↑
        │  (imported by)
        │
@ptah-extension/chat      ← Feature/orchestration layer (stateful, services, store)
```

**Rules:**

- `@ptah-extension/chat` imports from `@ptah-extension/chat-ui` — ✅ correct
- `@ptah-extension/chat-ui` NEVER imports from `@ptah-extension/chat` — ❌ circular
- `@ptah-extension/chat` re-exports all chat-ui symbols from its own barrel (marked `@deprecated`) for backward compatibility — prefer direct imports from `@ptah-extension/chat-ui` in new code

## Architecture

```
libs/frontend/chat-ui/src/lib/
├── atoms/                          # Basic building blocks (no composition)
│   ├── copy-button.component.ts
│   ├── cost-badge.component.ts
│   ├── duration-badge.component.ts
│   ├── electron-resize-handle.component.ts  # Desktop drag-resize (event-based)
│   ├── error-alert.component.ts
│   ├── expandable-content.component.ts
│   ├── file-path-link.component.ts
│   ├── sidebar-tab.component.ts
│   ├── status-badge.component.ts
│   ├── streaming-quotes.component.ts
│   ├── streaming-text-reveal.component.ts
│   ├── theme-toggle.component.ts
│   ├── token-badge.component.ts
│   ├── tool-icon.component.ts
│   ├── typing-cursor.component.ts
│   └── resize-handle.styles.ts     # Shared CSS constant (used by chat's ResizeHandleComponent)
│
└── molecules/                      # Composed atoms, grouped by feature domain
    ├── agent-card/
    │   ├── agent-card-output.component.ts   # Renders RenderSegment[] (pure presentational)
    │   ├── agent-card-permission.component.ts
    │   └── agent-card.types.ts              # RenderSegment, StderrSegment types
    ├── chat-input/
    │   ├── agent-selector.component.ts      # Agent dropdown (composed by ChatInputComponent)
    │   └── autopilot-popover.component.ts
    ├── compact-session/
    │   ├── compact-session-activity.component.ts
    │   ├── compact-session-header.component.ts
    │   ├── compact-session-input.component.ts
    │   ├── compact-session-stats.component.ts
    │   └── compact-session-text.component.ts
    ├── notifications/
    │   ├── compaction-notification.component.ts
    │   └── notification-bell.component.ts
    ├── permissions/
    │   ├── deny-message-popover.component.ts
    │   ├── permission-badge.component.ts
    │   └── permission-request-card.component.ts
    ├── session/
    │   ├── session-cost-summary.component.ts
    │   ├── session-stats-summary.component.ts
    │   └── tab-item.component.ts
    ├── setup-plugins/
    │   ├── mcp-directory-browser.component.ts
    │   ├── plugin-browser-modal.component.ts
    │   ├── plugin-status-widget.component.ts
    │   ├── prompt-suggestions.component.ts
    │   ├── setup-status-widget.component.ts
    │   └── skill-sh-browser.component.ts
    ├── tool-execution/
    │   ├── code-output.component.ts
    │   ├── diff-display.component.ts
    │   ├── todo-list-display.component.ts
    │   ├── tool-call-header.component.ts
    │   ├── tool-input-display.component.ts
    │   └── tool-output-display.component.ts
    ├── agent-summary.component.ts
    ├── community-upgrade-banner.component.ts
    ├── question-card.component.ts    # AskUserQuestion tool renderer (not a setup card — see setup-wizard)
    ├── thinking-block.component.ts
    ├── trial-banner.component.ts
    └── trial-ended-modal.component.ts
```

## Naming Gotchas

### `QuestionCardComponent` — two exist, different purposes

| Library                        | Class                   | Purpose                                                       |
| ------------------------------ | ----------------------- | ------------------------------------------------------------- |
| `@ptah-extension/chat-ui`      | `QuestionCardComponent` | Renders `AskUserQuestion` tool responses during a chat stream |
| `@ptah-extension/setup-wizard` | `QuestionCardComponent` | Displays a single setup discovery question in the wizard      |

They are different components that happen to share a name. If you import both libraries, alias one:

```typescript
import { QuestionCardComponent as AskUserQuestionCardComponent } from '@ptah-extension/chat-ui';
import { QuestionCardComponent } from '@ptah-extension/setup-wizard';
```

### `ElectronResizeHandleComponent` vs `ResizeHandleComponent` (in chat)

| Component                       | Location        | Mechanism                                                           |
| ------------------------------- | --------------- | ------------------------------------------------------------------- |
| `ElectronResizeHandleComponent` | `chat-ui` atoms | Raw mousedown/mousemove events, output-based, no service dependency |
| `ResizeHandleComponent`         | `chat` atoms    | Angular CDK drag with `PanelResizeService`, horizontal axis lock    |

Different use cases — not duplicates.

## Boundaries

**Belongs here:**

- Stateless, input/output-only components
- Shared UI primitives used by multiple webviews
- Types that describe the shape of rendered data (e.g. `RenderSegment`)

**Does NOT belong here:**

- Services or injectable state
- Components that inject `ChatStore`, `VSCodeService`, or any backend service
- Organisms or templates (those go in `@ptah-extension/chat`)
- Components only used in one place (keep them co-located)

## Dependencies

**Internal Libraries:**

- `@ptah-extension/shared` — shared type contracts
- `@ptah-extension/markdown` — markdown rendering for output components

**External Dependencies:**

- `@angular/core` — signals, inputs, outputs
- `@angular/common` — control flow directives

## Import Path

```typescript
// Atoms
import { StatusBadgeComponent, TokenBadgeComponent } from '@ptah-extension/chat-ui';

// Molecules
import { AgentCardOutputComponent, QuestionCardComponent } from '@ptah-extension/chat-ui';
import type { RenderSegment } from '@ptah-extension/chat-ui';

// Utilities
import { generateAgentColor } from '@ptah-extension/chat-ui';
```

## Commands

```bash
nx test chat-ui
nx typecheck chat-ui
nx lint chat-ui
nx build chat-ui
```

## Guidelines

1. **No services** — components must be purely input/output driven
2. **No imports from `@ptah-extension/chat`** — one-way dependency only
3. **Signal-first** — all component state uses Angular signals
4. **OnPush** — all components use `ChangeDetectionStrategy.OnPush`
5. **Atoms stay flat** — atoms do not import other atoms or molecules from this library
6. **DaisyUI + Tailwind** — no inline styles
