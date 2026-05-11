# @ptah-extension/chat-ui

[Back to Main](../../../CLAUDE.md)

## Purpose

Reusable **presentational** (stateless) chat UI components — atoms and molecules — extracted from `@ptah-extension/chat` (TASK_2026_105 Wave G4) so other webview apps (electron, dashboard, canvas) can consume chat primitives without pulling the full chat feature library and its state management.

## Boundaries

**Belongs here**: stateless input/output components, shared UI primitives consumed by multiple webviews, types describing rendered data shapes (e.g. `RenderSegment`, `StderrSegment`, `LiveModelStats`, `ModelUsageEntry`, `OklchColor`), color utilities.

**Does NOT belong**: services, injectable state, components that inject `ChatStore` / `VSCodeService` / any backend service, organisms or templates (those stay in `@ptah-extension/chat`), components only used in one place (keep them co-located).

## Public API (from `src/index.ts`)

- **15 atoms**: `CopyButtonComponent`, `CostBadgeComponent`, `DurationBadgeComponent`, `ElectronResizeHandleComponent`, `ErrorAlertComponent`, `ExpandableContentComponent`, `FilePathLinkComponent`, `SidebarTabComponent`, `StatusBadgeComponent`, `StreamingQuotesComponent`, `StreamingTextRevealComponent`, `ThemeToggleComponent`, `TokenBadgeComponent`, `ToolIconComponent`, `TypingCursorComponent` + `RESIZE_HANDLE_STYLES` constant
- **Molecule groups**: `agent-card/`, `chat-input/` (`AgentSelectorComponent`, `AutopilotPopoverComponent`), `compact-session/` (5 components), `notifications/` (`CompactionNotificationComponent`, `NotificationBellComponent`), `permissions/` (3 components), `session/` (`SessionCostSummaryComponent`, `SessionStatsSummaryComponent`, `TabItemComponent`), `setup-plugins/` (6 components), `tool-execution/` (6 components), plus standalone molecules: `AgentSummaryComponent`, `CommunityUpgradeBannerComponent`, `QuestionCardComponent`, `ThinkingBlockComponent`, `TrialBannerComponent`, `TrialEndedModalComponent`
- **Utilities**: `generateAgentColor`, `generateAgentColorOklch`, `formatOklch`, `isThemeFallbackColor`, `THEME_FALLBACK_OKLCH`, `OklchColor`
- **Types**: `RenderSegment`, `StderrSegment`, `LiveModelStats`, `ModelUsageEntry`

## Internal Structure

- `src/lib/atoms/` — flat directory of 15 atomic components + `resize-handle.styles.ts` (shared CSS constant used by chat's CDK-based resize handle)
- `src/lib/molecules/` — molecules grouped by feature domain (agent-card, chat-input, compact-session, notifications, permissions, session, setup-plugins, tool-execution) plus standalone molecules at the root
- `src/lib/utils/agent-color.utils.ts` — OKLCH-based agent color generation

## Naming Gotchas

- `QuestionCardComponent` exists in both `@ptah-extension/chat-ui` (renders `AskUserQuestion` tool responses) and `@ptah-extension/setup-wizard` (renders setup discovery questions). Alias one if you import both.
- `ElectronResizeHandleComponent` here is a no-CDK raw-event handle for the desktop app. `chat`'s `ResizeHandleComponent` uses Angular CDK drag — different mechanism, different use case.

## State Management Pattern

None. Components are `input()` / `output()` only. The library has no `@Injectable` services and no shared signal state.

## Dependencies

**Internal**: `@ptah-extension/shared`, `@ptah-extension/markdown` (for output components that render AI text)

**External**: `@angular/core`, `@angular/common`, `lucide-angular`

## Angular Conventions Observed

- Standalone components, `ChangeDetectionStrategy.OnPush` on every component
- `input.required<T>()` / `output<T>()` exclusively
- `inject()` only when a child component needs DI (e.g. markdown rendering)
- Templates use new control flow (`@if`, `@for`, `@switch`)
- DaisyUI + Tailwind classes; no inline styles

## Guidelines

1. **No services.** Components are purely input/output driven.
2. **No imports from `@ptah-extension/chat`** — one-way dependency only (chat imports chat-ui).
3. **Atoms stay flat.** Atoms do not import other atoms or molecules from this library.
4. **Signal-first.** All local component state uses Angular signals.
5. **OnPush.** Every component declares `changeDetection: ChangeDetectionStrategy.OnPush`.
6. **DaisyUI + Tailwind only.** No inline `style="..."` strings, no per-component CSS files (except the shared `resize-handle.styles.ts` constant).
7. **AI-rendered text** must go through `@ptah-extension/markdown` `MarkdownBlockComponent` — never bind `[innerHTML]` to raw model output.
