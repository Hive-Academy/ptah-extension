# Memory Curator UI

↩️ [Back to Main](../../../CLAUDE.md)

## Purpose

Electron-only "Memory" tab inside the Thoth shell. Surfaces stored memories across tiers (`core | recall | archival`) with search, tier filtering, per-row pin/unpin/forget actions, and a read-only settings panel.

## Boundaries

**Belongs here**: memory tab UI, debounced search, tier filtering, signal state mirror.
**Does NOT belong**: memory storage (backend), tier promotion logic (backend), settings editing (lives in the Settings view).

## Public API

From `src/index.ts`: `MemoryCuratorTabComponent`, `MemoryStateService`, `MemoryRpcService`.

## Internal Structure

- `src/lib/components/` — `memory-curator-tab.component.ts` (single composite tab)
- `src/lib/services/` — `memory-state.service.ts`, `memory-rpc.service.ts`

## Key Files

- `src/lib/components/memory-curator-tab.component.ts:42` — tab UI; OnPush; renders an Electron-only gate (`isElectron()`) with a VS Code download link otherwise. Search input debounces at 300 ms; four sections: search/filters, stats, entry list, settings.
- `src/lib/services/memory-state.service.ts:40` — `providedIn: 'root'`; signal state with `entries`, `query`, `tierFilter` (`'all' | 'core' | 'recall' | 'archival'`), `stats`, `loading`, `error`. Computed `filteredEntries` and `totalsByTier` fall back to client-side derivations when `memory:stats` hasn't resolved.
- `src/lib/services/memory-rpc.service.ts` — typed wrappers around memory RPC methods.

## State Management

Signals + `computed`. Tier filter is UI-side only (`'all'` sentinel is not a wire tier). All side effects flow through `MemoryRpcService`; the state service is pure UI state.

## Dependencies

**Internal**: `@ptah-extension/core` (`VSCodeService`), `@ptah-extension/shared` (`MemoryWire`, `MemoryStatsResult`, `MemoryTierWire`).
**External**: `@angular/common`.

## Angular Conventions Observed

Standalone, OnPush, signals + `inject()`, control-flow `@if`.

## Guidelines

- Always gate the tab on `vscode.isElectron` — backend isn't available in the VS Code webview.
- Don't write settings from this tab; it's read-only by design.
- Prefer the live `memory:stats` result; fall back to client-derived totals only when stats aren't yet loaded.
