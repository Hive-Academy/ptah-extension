/**
 * Canonical workspace-root key used by the index store, the watcher event
 * filter, and RPC params alike — so the same workspace never yields two
 * different keys (NFR-8).
 *
 * The implementation was PROMOTED to `@ptah-extension/platform-core`
 * (`src/utils/normalize-workspace-root.ts`) by TASK_2026_200 task 1.1, so that
 * `workspace-intelligence` and `vscode-lm-tools` can share the one canonical
 * key function without taking a dependency edge on this lib (which pulls
 * `persistence-sqlite` → `better-sqlite3` with it).
 *
 * This module is now a pure re-export: `task-specs`' public API
 * (`normalizeWorkspaceRoot` from its barrel) and every internal import path are
 * unchanged, and there is exactly ONE implementation body. Do NOT re-inline a
 * copy here — divergent normalization is the defect class this helper exists to
 * prevent.
 */

export { normalizeWorkspaceRoot } from '@ptah-extension/platform-core';
