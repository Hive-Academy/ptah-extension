# Orchestra Canvas — Handoff Report

**Date**: 2026-04-09
**Branch**: `ak/continue-cli`
**Status**: Phase 1 (MCP Session Threading Bug Fix) — IMPLEMENTED & VERIFIED, needs runtime testing

---

## What Was Done

### Research Phase (Complete)

Deep investigation across 3 parallel research agents covering:

1. Current session/tab architecture (TabManagerService, AgentMonitorStore, WebviewManager)
2. VS Code API capabilities for canvas/pool views
3. Architectural design for multi-session canvas

### User Decisions Captured

| Question                  | Answer                                                        |
| ------------------------- | ------------------------------------------------------------- |
| Primary interaction model | **Parallel Interaction** (2-4 sessions with full chat input)  |
| Concurrent session count  | **3-6 sessions** (focused working set)                        |
| Canvas vs tabs            | **Coexist as new view mode** (canvas alongside existing tabs) |
| Canvas location           | **Editor area panel** (full-width WebviewPanel)               |

### Bug Fix Implemented (Phase 1)

**Problem**: Agent monitor sidebar doesn't show the correct CLI agents for the selected tab.

**Root Cause**: When a Claude SDK session calls `ptah_agent_spawn` via MCP, the server used `getActiveSessionIds()[0]` (most-recently-registered session) to determine `parentSessionId`. This is a global guess, not the actual calling session.

**Fix**: Thread session identity through the MCP URL path.

```
Before: http://localhost:51820               (all sessions share one endpoint)
After:  http://localhost:51820/session/tab_xxx  (each session has its own path)
```

## Files Changed (10 files, 3 libraries + settings)

### `libs/backend/agent-sdk/` (2 files)

**`src/lib/helpers/session-lifecycle-manager.ts`** (line ~357)

- Added `getResolvedSessionId(tabIdOrSessionId: string): string` — public method to resolve tab ID → real SDK UUID via the private `tabIdToRealId` map. Returns input as-is if not a known tab ID.

**`src/lib/helpers/sdk-query-options-builder.ts`** (lines ~525, ~705-743)

- `buildMcpServers()` now accepts optional `sessionId` parameter (3rd arg)
- MCP URL includes session path: `http://localhost:${port}/session/${encodeURIComponent(sessionId)}`
- Called with `sessionId` from `build()` input (the tab ID at query creation time)

### `libs/backend/vscode-lm-tools/` (5 files)

**`src/lib/code-execution/types.ts`** (line ~726)

- Added `_callerSessionId?: string` field to `MCPRequest` interface

**`src/lib/code-execution/mcp-handlers/http-server.handler.ts`** (lines ~140-150, ~214-219)

- Added `extractCallerSessionId(url)` — parses `/session/{id}` from URL path using portable regex (Windows-compatible, no `grep -P`)
- `handleHttpRequest` stamps `_callerSessionId` on MCPRequest before dispatch

**`src/lib/code-execution/mcp-handlers/protocol-handlers.ts`** (line ~524-535)

- `ptah_agent_spawn` handler now passes `request._callerSessionId` as `parentSessionId` to `ptahAPI.agent.spawn()`

**`src/lib/code-execution/namespace-builders/agent-namespace.builder.ts`** (lines ~82-101, ~123-127)

- Added `resolveSessionId?: (tabIdOrSessionId: string) => string` to `AgentNamespaceDependencies`
- `spawn()` prefers `request.parentSessionId` (from MCP URL) over `getActiveSessionId()` (global guess)
- Resolves tab ID → real UUID via `resolveSessionId`

**`src/lib/code-execution/ptah-api-builder.service.ts`** (lines ~334-351)

- Wires `resolveSessionId` dependency using lazy DI resolution of `SessionLifecycleManager.getResolvedSessionId()`

### `libs/frontend/chat/` (2 files)

**`src/lib/services/agent-monitor.store.ts`** (line ~164)

- Added `agentsForSession(sessionId: string): MonitoredAgent[]` — scoped accessor for canvas tiles (no global `activeTab` dependency)

**`src/lib/services/agent-monitor.store.spec.ts`** (lines ~4, ~17-20)

- Added `computed` to `@angular/core` imports
- Added `activeTabSessionId` computed signal to `mockTabManager`
- All 12 agent-monitor tests pass

### `.claude/` (2 files)

**`settings.local.json`**

- Added `hooks.PreToolUse` configuration wiring guard script to Bash tool
- Changed `Bash(git reset:*)` → `Bash(git reset HEAD:*)` in allow list

**`hooks/guard-dangerous-git.sh`**

- PreToolUse hook blocking 9 dangerous git patterns with descriptive error messages
- Uses portable regex (no `grep -P`) for Windows Git Bash compatibility

---

## Verification Status

| Check                                          | Status           |
| ---------------------------------------------- | ---------------- |
| `agent-sdk` typecheck                          | **Pass**         |
| `vscode-lm-tools` typecheck                    | **Pass**         |
| `chat` typecheck                               | **Pass**         |
| `agent-monitor.store.spec.ts` (12 tests)       | **All pass**     |
| Git guard hook (9 dangerous + 7 safe patterns) | **All correct**  |
| **Runtime testing**                            | **NOT YET DONE** |

---

## What Remains

### Phase 1 Completion (Bug Fix — Runtime Testing)

- [ ] Manual testing: spawn CLI agents from different tabs, verify they appear in correct sidebar
- [ ] Edge case: verify agents spawned before session ID resolution still resolve correctly
- [ ] Edge case: verify `execute_code` → `ptah.agent.spawn()` path still works (falls back to `getActiveSessionId()`)
- [ ] Commit the Phase 1 changes

### Phase 2: Canvas Foundation

- [ ] Create `OrchestraCanvasComponent` (Angular standalone, OnPush)
- [ ] Create `CanvasStore` service (layout signal, tiles signal, focused tile)
- [ ] Integrate Gridstack.js (10KB, official Angular wrapper) or angular-gridster2 for tiling
- [ ] Add `ptah.openOrchestraCanvas` command → `createPanel({ initialView: 'orchestra-canvas' })`
- [ ] Route Angular SPA to canvas view via `initialView` config (existing pattern from analytics)

### Phase 3: Session Context Abstraction

- [ ] Create `SessionContext` abstraction (per-tile signal context replacing global `activeTab`)
- [ ] Decouple `ChatInputComponent` from global active tab — accept `tabId` input
- [ ] Decouple `MessageListComponent` from global active tab — accept `sessionId` input
- [ ] Each canvas tile embeds existing components with scoped session context

### Phase 4: Grid & Polish

- [ ] Gridstack.js drag/resize integration
- [ ] Layout presets: 2x1, 2x2, 1+2 (one large + two small)
- [ ] Layout persistence via localStorage per workspace
- [ ] "Open in Canvas" context menu on tabs / "Pop out to tab" on tiles
- [ ] Keyboard navigation: Tab/Shift+Tab cycles between tiles
- [ ] Status bar indicators per active session

---

## Key Architecture Notes for Canvas

### Broadcasting Already Works

`WebviewManager.broadcastMessage()` sends streaming events to ALL registered webviews. A canvas WebviewPanel registers as another webview and receives events for free. Each tile filters by `sessionId`.

### The Core Challenge: Decoupling from `activeTab`

Current architecture routes everything through `activeTabSessionId` — a single global signal. For canvas:

| Current (Global)                                        | Canvas (Scoped)                                  |
| ------------------------------------------------------- | ------------------------------------------------ |
| `activeTab` signal → one session                        | Each tile gets own `SessionContext`              |
| `activeTabMessages` computed                            | Per-tile `tileMessages(sessionId)`               |
| `ChatStore.sendMessage()` targets active tab            | `sendMessage(tabId)` with explicit target        |
| `StreamingHandlerService` routes to active tab fallback | Route by `sessionId` only                        |
| Single `ChatInputComponent`                             | Multiple instances, each bound to tile's `tabId` |

### Grid Library Recommendation

**Gridstack.js** (v12.5.0) — 10KB gzip, pure TypeScript, zero dependencies, official Angular wrapper, drag/resize/layout persistence built-in, MIT license.

### No VS Code Extension Does This Yet

Copilot, Cursor, Continue, Cline — all use single-session-at-a-time with tab switching. A parallel interaction canvas is genuinely novel and aligns with the "orchestra" brand.

---

## Data Flow Diagram (After Phase 1 Fix)

```
SDK Query Start (tab_xxx)
  ↓
SdkQueryOptionsBuilder.build({ sessionId: tab_xxx })
  ↓
buildMcpServers(premium, running, tab_xxx)
  → MCP URL: http://localhost:51820/session/tab_xxx
  ↓
SDK init message → resolveRealSessionId(tab_xxx, real-uuid)
  ↓
Agent calls ptah_agent_spawn → HTTP POST /session/tab_xxx
  ↓
extractCallerSessionId("/session/tab_xxx") → "tab_xxx"
  ↓
mcpRequest._callerSessionId = "tab_xxx"
  ↓
protocol handler: request.parentSessionId = "tab_xxx"
  ↓
agent-namespace: resolveSessionId("tab_xxx") → "real-uuid"
  ↓
AgentProcessManager.spawn({ parentSessionId: "real-uuid" })
  ↓
broadcastMessage(AGENT_MONITOR_SPAWNED, { parentSessionId: "real-uuid" })
  ↓
Frontend: agent.parentSessionId === tab.claudeSessionId ✓
```
