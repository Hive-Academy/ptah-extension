# TASK_2025_223: Replace raw fetch() with axios across all backend libraries

## Task Type: REFACTORING

## Workflow: Partial (Architect -> Team-Leader -> Developers -> QA)

## Created: 2026-03-26

## User Request

Install axios as the dedicated HTTP library and replace all raw `fetch()` calls in backend libraries with axios. This ensures consistent HTTP behavior across VS Code extension host and Electron main process (where Node's native `fetch` bypasses Chromium's network stack, causing license verification failures in production Electron).

## Problem Statement

The codebase uses raw `fetch()` in 5 call sites across shared backend libraries. These libraries run on both VS Code (extension host) and Electron (main process). In Electron, Node.js's native `fetch` bypasses Chromium's network stack — it doesn't use system proxy settings, custom certificates, or authentication challenges. This causes license verification to fail in production Electron builds.

A temporary `globalThis.fetch = net.fetch` workaround was added in `apps/ptah-electron/src/main.ts` but should be replaced with a proper solution.

## Affected Files (fetch() call sites)

1. `libs/backend/vscode-core/src/services/license.service.ts` — License verification POST
2. `libs/backend/agent-sdk/src/lib/provider-models.service.ts` — OpenRouter model listing (2 calls)
3. `libs/backend/agent-sdk/src/lib/codex-provider/codex-auth.service.ts` — Codex OAuth token refresh
4. `libs/backend/agent-sdk/src/lib/copilot-provider/copilot-auth.service.ts` — Copilot token exchange

## Cleanup Required

- Remove `globalThis.fetch = net.fetch` workaround from `apps/ptah-electron/src/main.ts`
- Remove `net` import from Electron main.ts (if no longer needed)

## Constraints

- axios must be added to the root `package.json` (shared dependency)
- Must be externalized in esbuild configs for both VS Code webpack and Electron esbuild builds
- All existing timeout/abort logic must be preserved
- All error handling patterns must be preserved
- Type safety must be maintained
