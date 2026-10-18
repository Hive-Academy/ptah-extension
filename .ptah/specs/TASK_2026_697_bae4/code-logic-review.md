# Code Logic Review - TASK_2026_697_bae4 (Phase 1, V01-V08)

Review family: reviewer: Anthropic Claude; implementer: codex

Score: 6/10
Verdict: NEEDS_REVISION (0 Blocking, 2 Serious, 3 Moderate, 3 Minor)

Scope: git diff of libs/frontend/command-center/src/lib (19 modified, 5 new files) read in full for non-spec sources. I did not re-run tests. Paths below are relative to libs/frontend/command-center/src/lib.

## Findings

### 1. Serious - Scene inks go stale on theme switches within the same dark/light class (V01)
- Evidence: scene/command-scene.component.ts:121-135 (`inks` computed). Its only reactive deps are `theme()` and `ready()`. `theme` comes from `ThemeService.isDarkMode()` mapped to 'dark' | 'light' (components/command-center-page.controller.ts:192-194). Many stock themes exist (apps/ptah-extension-webview/src/styles.css:320-340, e.g. dark -> forest, light -> cupcake). Switching between two themes of the same class leaves `theme()` unchanged, so the computed never re-reads `--state-ink-*`. The canvas keeps the previous theme's inks, and no getComputedStyle runs again.
- Ordering risk even on a dark/light flip: `store.setTheme` runs in an effect (controller :192), and `ThemeService` writes `data-theme` in its own effect (core theme.service.ts:188). If the scene's computed runs before the attribute is written, it reads the old theme's inks and does not re-run.
- Also, `--state-ink-idle` is never defined by the stock theme blocks (styles.css:317 says so), so `idle` always uses the hardcoded FALLBACK_INKS value, not `base-content`. The idle ink (hover halo, idle node ring, muted voice) is therefore not theme-aware.
- Fix: key the resolution on the actual `data-theme` value. Either add a `themeKey` input or signal driven by ThemeService.currentTheme(), or observe `document.documentElement` with a MutationObserver on `data-theme` (disconnect in destroy). Re-resolve in a post-render step (afterNextRender), not inside a computed. For idle, resolve `--bc` or fall back to the computed text color of the stage.

### 2. Serious - Freshness labels vanish for any update newer than the last clock tick (V06/V07)
- Evidence: components/command-relative-time.ts:3 returns null when `timestamp > now`. `now` is the 30 s signal in components/command-center-clock.ts (set at creation, then every 30 000 ms). Any node or session whose `updatedAt` is stamped after the last tick (up to 30 s ago, the freshest and most relevant case) has `timestamp > now`, so it returns null. Node detail and work list hide "Updated ...". The start list (components/command-center-start.component.ts, `relativeTime(...) ?? 'Unknown'`) now shows "Unknown" for a just-updated session, where the old code clamped to "Just now" via Math.max(0, ...). Host-vs-webview clock skew triggers the same thing. This is a regression of the start list.
- Fix: tolerate small future skew. Treat `timestamp - now <= 60_000` (or the clock period plus margin) as "Just now", and return null only beyond that. Keep the invalid/NaN guard. Add a spec for timestamp = now + 5 000 -> 'Just now' and now + 10 min -> null.

### 3. Moderate - Running/waiting counts include non-agent nodes (V08)
- Evidence: components/command-center-page.component.ts, `stageCounts` iterates every `projection().nodes`, including root, phase and tool-style nodes, not only delegated work. A running root or phase node inflates "N running", and a phase in 'awaiting input' counts as a waiting agent.
- Fix: restrict to the same node kinds the work list shows (child/agent/cli), or exclude `kind === 'root' | 'phase'`. Add a spec with a running phase node.

### 4. Moderate - Task preview drops text when the first line is blank (V06)
- Evidence: components/command-node-detail.component.ts `taskPreview` splits to the first line only and trims. A task such as "\nFix the bug" yields '' -> null and shows no task. Escaping itself is fine (Angular interpolation, 160-char slice, line-clamp-2).
- Fix: trim the whole string first (`task.trim().split(/\r?\n/, 1)[0]`), or take the first non-empty line.

### 5. Moderate - Detail and list components default `now` to a frozen Date.now() (V07)
- Evidence: `input(Date.now())` in components/command-node-detail.component.ts, command-overlay.component.ts, command-work-list.component.ts and command-center-start.component.ts is evaluated once at construction. Any host that forgets to bind `[now]` silently shows ever-staler labels. The page binds all four, so no live bug today. The default hides a missing binding.
- Fix: make `now` `input.required<number>()`, or default to `0` and render nothing when it is unset.

### 6. Minor - Unknown context renders as "Context —" with no word for assistive tech (V04)
- Evidence: components/command-center-page.component.ts chip uses `contextCue().label`, which is '—' when unknown (chat-ui session-stats-view.ts:54). Known/unknown logic and the >=70 warning (with a "Warning" text, not colour only) are correct.
- Fix: render "Context unknown" when `!contextCue().known`. If the tab is missing, show the same text.

### 7. Minor - Selected row/node border colour conflict (V05)
- Evidence: command-work-list.component.ts and command-overlay.component.ts apply `border-l-state-*` plus `border-warning` plus `ring-2 ring-warning`. The left edge keeps the state colour, and selection is carried by the ring only. This is acceptable for visibility, but forced-colors or high-contrast modes drop box-shadow rings. `aria-current` is set on the work list only.
- Fix: also use `outline` or a thicker border for selection, and add `aria-current` or `aria-pressed` on overlay buttons if absent.

### 8. Minor - Test stub change and projection (informational, no defect)
- integration/integration-harness.testing.ts:39-43 adds `layout` to SceneStubComponent, which is needed because the page now reads `scene().layout()`. It is test-only and matches the real shape (`overflowCompleted`, `overflowOther`, `nodes`). Note the stub's `nodes: []` means `visibleLabelIds` is empty in integration tests, so the overlay is hidden there. Document this or give the stub a minimal node.
- model/work-projection.ts: `tabId` is carried exactly from `child.tabId` for live children and set `undefined` for persisted children (no invented ids), and `task` is copied from `agent.task`. Correct. Note the live child's id remains `sessionId ?? tabId`, so a node's `tabId` can differ from its id (intended).

## Requirement checks
- V01: no getComputedStyle in draw (only in the `inks` computed). The theme-change trigger is incomplete (finding 1).
- V02/V03: `setHoveredId` replaces the snapshot and calls `invalidate()` once, with no extra rAF loop (renderer.ts:111-115, component updateHover). Hover is also synced via the effect snapshot. OK.
- V04: known/unknown via the shared `sessionContextCue`, warning at >=70. OK (see 6).
- V05: state edges plus ring keep selection visible. OK (see 7).
- V06: escaped, bounded text, phase fraction (placeholder phase labels excluded), freshness. Gaps in findings 2 and 4.
- V07: one formatter and the single existing 30 s clock (no new timers). The future-timestamp rule is too strict (finding 2). Overflow counts come from `scene.layout()` and are wired to the work list.
- V08: counts shown, but over-broad (finding 3).
- a11y: the canvas stays aria-hidden. DOM equivalents exist (overlay buttons, work list, counts text, context chip with text).
