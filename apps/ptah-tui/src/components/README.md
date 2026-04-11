# Ptah TUI Component Library

Atomic-design component library for the Ptah terminal UI. Mirrors the Angular chat library at `libs/frontend/chat/src/lib/components/` with parallel naming and prop signatures so design changes stay in sync across frontends.

## Structure

```
apps/ptah-tui/src/components/
├── atoms/          — leaf primitives (Box/Text wrappers with theme)
├── molecules/      — feature-grouped compositions of atoms
├── organisms/      — complex sections (message bubbles, panels)
├── templates/      — top-level layouts
└── hooks/          — shared services ported from Angular (focus, keyboard, discovery)
```

Existing folders (`chat/`, `common/`, `diff/`, `layout/`, `main-panel/`, `overlays/`, `settings/`, `sidebar/`) will be migrated into this structure during Phase 3. During Phases 1-2, primitives are added alongside existing folders.

## Atom Map — Angular → Ink

Every atom mirrors the Angular component's prop signature. Status/color props use the theme tokens from `lib/themes.ts`.

| Angular                      | Ink atom             | Props                                                                                     | Status                  |
| ---------------------------- | -------------------- | ----------------------------------------------------------------------------------------- | ----------------------- |
| `ptah-status-badge`          | `<StatusBadge>`      | `status: 'pending' \| 'streaming' \| 'complete' \| 'interrupted' \| 'resumed' \| 'error'` | New                     |
| `ptah-cost-badge`            | `<CostBadge>`        | `cost: number`                                                                            | New                     |
| `ptah-duration-badge`        | `<DurationBadge>`    | `durationMs: number`                                                                      | New                     |
| `ptah-token-badge`           | `<TokenBadge>`       | `tokens: number \| TokenUsage`                                                            | New                     |
| `ptah-error-alert`           | `<ErrorAlert>`       | `message: string`                                                                         | New                     |
| `ptah-tool-icon`             | `<ToolIcon>`         | `name: string`                                                                            | New                     |
| `ptah-streaming-text-reveal` | `<StreamingText>`    | `content: string; isStreaming?: boolean; revealSpeed?: number`                            | New                     |
| `ptah-typing-cursor`         | `<TypingCursor>`     | `color?: string`                                                                          | New                     |
| `ptah-markdown-block`        | `<MarkdownBlock>`    | `content: string`                                                                         | Exists (rewire to atom) |
| `ptah-expandable-content`    | `<Expandable>`       | `content: string; isExpanded: boolean; onToggle: () => void`                              | New                     |
| `ptah-file-path-link`        | `<FilePathLink>`     | `path: string; onOpen?: (path) => void`                                                   | New                     |
| `ptah-copy-button`           | `<CopyButton>`       | `text: string`                                                                            | New                     |
| `ptah-theme-toggle`          | `<ThemeToggle>`      | — (uses useTheme hook)                                                                    | New                     |
| `ptah-sidebar-tab`           | `<SidebarTab>`       | `label: string; side: 'left' \| 'right'; isOpen: boolean; onToggle: () => void`           | New                     |
| `ptah-streaming-quotes`      | `<StreamingQuotes>`  | —                                                                                         | New                     |
| `ptah-file-tag`              | `<FileTag>`          | `file: ChatFile; onRemove: () => void`                                                    | New                     |
| `ptah-suggestion-option`     | `<SuggestionOption>` | `item: SuggestionItem; isActive: boolean; onSelect: () => void`                           | New                     |

### New Ink-native atoms (no Angular equivalent, needed for TTY layout)

| Atom        | Props                                                                       | Purpose                                                                  |
| ----------- | --------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `<Panel>`   | `title?: string; isActive?: boolean; children`                              | Bordered box with optional header — replaces ad-hoc `<Box borderStyle>`  |
| `<Card>`    | `variant?: 'default' \| 'subtle'; children`                                 | Unbordered content container with theme background                       |
| `<Divider>` | `dashed?: boolean; title?: string`                                          | Wraps `ink-divider` — replaces manual `'─'.repeat(50)`                   |
| `<Badge>`   | `variant: 'info' \| 'success' \| 'warning' \| 'error' \| 'ghost'; children` | Base for all badge atoms (StatusBadge/CostBadge/TokenBadge compose this) |
| `<KeyHint>` | `keys: string; label: string`                                               | Consistent `^K palette` rendering for StatusBar                          |
| `<Spinner>` | `label?: string`                                                            | Already exists in `common/Spinner.tsx` — promote to atom                 |

### Dropped atoms (no TTY equivalent)

- `ptah-resize-handle`, `ptah-electron-resize-handle` — TTY has fixed dimensions
- `ptah-avatar` — no image support

## Molecule Map

Molecules are feature-grouped folders. Each molecule composes atoms.

```
molecules/
├── chat-input/
│   ├── ChatInput.tsx              — textarea + overlay + file tags (existing, refactor)
│   ├── AgentSelector.tsx          — @agent dropdown
│   ├── ModelSelector.tsx          — inline model picker
│   └── EffortSelector.tsx         — effort level picker
├── tool-execution/
│   ├── ToolCallHeader.tsx         — ToolIcon + StatusBadge + DurationBadge
│   ├── ToolInputDisplay.tsx       — Expandable + CodeOutput
│   ├── ToolOutputDisplay.tsx      — Expandable + CodeOutput | DiffDisplay
│   ├── ToolCallItem.tsx           — header + input + output
│   ├── CodeOutput.tsx              — syntax-highlighted code
│   ├── DiffDisplay.tsx             — exists in diff/, move here
│   └── TodoListDisplay.tsx
├── session/
│   ├── SessionCostSummary.tsx     — CostBadge + TokenBadge + DurationBadge
│   ├── SessionStatsSummary.tsx
│   └── TabItem.tsx
├── notifications/
│   ├── NotificationBell.tsx
│   ├── CompactionNotification.tsx
│   └── ResumeBanner.tsx
├── permissions/
│   ├── PermissionBadge.tsx
│   ├── PermissionRequestCard.tsx  — replaces common/PermissionPrompt
│   └── DenyMessagePopover.tsx
├── forms/                         — Ink-specific, no Angular equivalent
│   ├── FormField.tsx              — label + input + hint + error
│   ├── ListItem.tsx               — selected/current/dimmed row
│   └── SectionHeader.tsx
├── ThinkingBlock.tsx
├── AgentSummary.tsx
├── ConfirmationDialog.tsx         — replaces common/UserQuestionPrompt
└── QuestionCard.tsx
```

## Organism Map

```
organisms/
├── MessageBubble.tsx              — exists in chat/, move here
├── AgentMonitorPanel.tsx          — exists in sidebar/AgentMonitor, rename
├── TabBar.tsx                     — session tabs
├── WorkspaceSidebar.tsx           — exists in sidebar/, rename
└── execution/
    ├── ExecutionNode.tsx          — RECURSIVE tree renderer
    ├── AgentExecution.tsx
    └── InlineAgentBubble.tsx
```

## Template Map

```
templates/
├── AppShell.tsx                   — exists as layout/Layout.tsx, move + rename
├── ChatView.tsx                   — exists as chat/ChatPanel.tsx, move + rename
└── WelcomeScreen.tsx              — currently inside MessageList.tsx, extract
```

## Hooks / Services

Ported from Angular services. All are signal-friendly (React state/context).

| Angular service                  | Ink hook                     | Purpose                                                                                     |
| -------------------------------- | ---------------------------- | ------------------------------------------------------------------------------------------- |
| `ThemeService`                   | `useTheme` (exists)          | Theme state + persistence                                                                   |
| `KeyboardNavigationService`      | `useKeyboardNav`             | Arrow/Home/End/Enter/Escape list navigation with activeIndex                                |
| `FocusManagerService` (implicit) | `useFocusManager`            | Centralized focus stack — replaces `isActive` prop drilling across 16 `useInput` call sites |
| `AgentDiscoveryFacade`           | `useAgentDiscovery`          | Fuzzy-search agents for @ trigger                                                           |
| `CommandDiscoveryFacade`         | `useCommandDiscovery`        | Fuzzy-search commands for / trigger (extend existing `useCommands`)                         |
| `FilePickerService`              | `useFilePicker` (exists)     | File attachment discovery                                                                   |
| `ChatStore`                      | `useChat` (exists)           | Central chat state                                                                          |
| `ExecutionTreeBuilder`           | `buildExecutionTree` util    | Stack-based nesting algorithm                                                               |
| `MessageSenderService`           | `useChat.startChat` (exists) | Centralized send mediator                                                                   |

## Design Tokens

Theme tokens live in `apps/ptah-tui/src/lib/themes.ts`. The existing 6 themes (anubis/dark, anubis-light, etc.) map to Angular's DaisyUI `anubis`/`anubis-light` themes. Color roles stay the same:

| Role             | Angular (DaisyUI)             | TUI (theme.ts)                                   |
| ---------------- | ----------------------------- | ------------------------------------------------ |
| primary          | `#2563eb`                     | `theme.ui.brand`                                 |
| secondary        | `#d4af37` (pharaoh gold)      | `theme.ui.accent`                                |
| success          | `#16a34a`                     | `theme.status.success`                           |
| warning          | `#fbbf24`                     | `theme.status.warning`                           |
| error            | `#dc2626`                     | `theme.status.error`                             |
| info             | `#3b82f6`                     | `theme.status.info`                              |
| base-100/200/300 | `#131317`/`#1a1a20`/`#242430` | `theme.ui.bg`/`theme.ui.panel`/`theme.ui.border` |

No new token work needed — the existing theme already covers these roles. Atoms will consume them via `useTheme()`.

## Dependencies to Add

New npm packages for Phase 1:

- `ink-table` — structured tables for SessionList, ModelSelector, AgentMonitor
- `ink-divider` — consistent section separators
- `ink-gradient` — welcome screen branding
- `ink-big-text` — welcome screen ASCII logo
- `ink-link` — clickable URLs in messages (stretch)

All are small, mature, Ink-ecosystem packages.

## Phase Rollout

| Phase | What                                                           | Files touched |
| ----- | -------------------------------------------------------------- | ------------- |
| **0** | This doc                                                       | 1             |
| **1** | Primitives + hooks, no migration                               | +20 new       |
| **2** | MessageList → `Static`, `useFocusManager`, lists → `ink-table` | ~6 refactored |
| **3** | Sweep all components to use primitives                         | ~25 touched   |
| **4** | Polish: gradient welcome, streaming progress, theme swatches   | ~5 touched    |
| **5** | Typecheck + regression walkthrough                             | verify        |

## Naming conventions

- Atom/molecule/organism file names: **PascalCase** matching component name (`StatusBadge.tsx`, not `status-badge.tsx`)
- One component per file
- Props interface named `{ComponentName}Props`
- Export: named export + default export matching the component
- No ptah- prefix (Angular uses it for CSS selector uniqueness; Ink imports are scoped)

## References

- Angular source: `libs/frontend/chat/src/lib/components/`
- Angular theme tokens: `apps/ptah-extension-webview/tailwind.config.js`
- Existing TUI theme: `apps/ptah-tui/src/lib/themes.ts`
