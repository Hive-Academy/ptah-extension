# Phase D code logic review, round 3

**Verdict: REVISE. Score: 8/10.** Defects 2 and 3 are fixed. Defect 1 is partial: the new coded failure works when an intent read occurs, but an empty installed inventory can bypass the read. This is a source review of only the bounded round-2 correction; no tests, builds, or verify were run.

## Bounded corrections

| Defect | Status | Evidence |
| --- | --- | --- |
| 1. Unreadable MCP intent store returns empty success | **PARTIAL** | `libs/backend/rpc-handlers/src/lib/handlers/mcp-directory-rpc.handlers.ts:669-684,700-715` codes caught failures for uninstall and listInstalled; `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/installed-mcp-removal.ts:81-85`, `mcp-directory-browser.component.ts:864-873`, and `libs/frontend/marketplace/src/lib/data/marketplace-inventory.store.ts:684-696` display those codes. However, `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:381-400,418-431,482` only reads the intent store while annotating a harness config row, and `mcp-directory-rpc.handlers.ts:732-739` also skips a read for zero rows. With an unreadable intent file and no harness MCP entries, listInstalled still returns `{ servers: [] }` without a code. **Major:** an Installed view can say there are no servers while its intent store is inaccessible. Read/validate the intent store unconditionally before returning the installed list, then let the existing RPC catch return `intent-unreadable`. Add a zero-row unreadable-store spec. |
| 2. No-folder install without reconciler reports a hard failure | **FIXED** | `libs/backend/cli-agent-runtime/src/lib/mcp-directory/mcp-install.service.ts:724-743` returns `deferred-no-workspace` for every target before checking for a reconciler, after the intent is saved by `install`. The added spec covers a null reconciler and both workspace and home targets. |
| 3. `excludedBySelection` set before eligibility gates | **FIXED** | `libs/backend/harness-sync/src/lib/manifest/harness-manifest.builder.ts:511-531` checks disabled, retired, and plugin-origin gates before selection for user-layer skills. Lines `543-565` check disabled plugin/root/skill gates before selection for overlay skills. The added spec covers retired and disabled clones. |

## New defects

None found in these edits beyond the incomplete correction to defect 1 above.

## Decisions

- Decision #82's coded-result contract is implemented for caught `McpIntentPersistError` failures and consumed in the reviewed Angular paths. Its claim that `listInstalled` never presents an unreadable store as zero installed servers still needs the unconditional read described above.
- Decision #79's every-target deferred behavior holds in the no-folder branch. The post-gate `excludedBySelection` behavior matches decision #82.
- The optional code remains ignored by the `apps/ptah-cli` consumers, as explicitly accepted. No CLI finding is raised.
- Only the named round-2 files and their relevant caller paths were reviewed. No source files were modified; no tests, builds, or verify commands were run under the active machine lock.
