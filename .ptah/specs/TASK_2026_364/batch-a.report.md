# Batch A report — request-scoped workspace identity (`vscode-lm-tools`)

Executor: backend-developer (Batch A, TASK_2026_364). Date: 2026-08-31.
Status: **COMPLETE**. All verification targets green. Not committed (per instructions).

## Files changed and why

### Production code

1. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/mcp-request-context.ts`
   - Added `callerWorkspaceRoot?: string` to `McpRequestContext` (same AsyncLocalStorage instance, same readonly shape as `callerSessionId`).
   - Added and exported `getCallerWorkspaceRoot()`, symmetric with `getCallerSessionId()`.

2. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/types/mcp-protocol.types.ts`
   - Added `_callerWorkspaceRoot?: string` to `MCPRequest`, beside `_callerSessionId`. (Named in the task as part of the ownership set for this purpose.)

3. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-http/http-server.handler.ts`
   - Added `extractCallerWorkspaceRoot(url)`, symmetric with `extractCallerSessionId` (decodeURIComponent, `[^/?]+` segment capture).
   - `handleHttpRequest` now stamps `_callerWorkspaceRoot` onto the request, directly beside the `_callerSessionId` stamp.
   - `extractCallerSessionId` is byte-for-byte unchanged. `handleInitialize` untouched.

4. `libs/backend/vscode-lm-tools/src/lib/code-execution/workspace-root-resolver.ts`
   - Inserted the declared workspace root as the NEW TIER 1, above the caller session id. Code comment carries the rationale: a caller that STATES its workspace outranks one we infer from a session.
   - Existing precedence (caller session → active session → platform provider) shifted down one tier, otherwise unchanged. Empty string and a throwing getter degrade exactly like the existing tiers (throw falls to provider root).
   - The new dep `getCallerWorkspaceRoot` is **optional** in `WorkspaceRootResolverDeps`. See "Deliberate seam" below.

5. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/protocol-dispatcher.ts`
   - `tools/call` now threads `callerWorkspaceRoot: request._callerWorkspaceRoot` into `runWithMcpRequestContext` beside `callerSessionId` (line ~174). No other change.

6. `libs/backend/vscode-lm-tools/src/lib/code-execution/mcp-core/index.ts`
   - Added `getCallerWorkspaceRoot` to the barrel export block that already exports `getCallerSessionId`. Batch C reads this getter; without the export it would need a deep import. The barrel spec pins no exact list, so this is additive.

### Specs

7. `mcp-core/mcp-request-context.spec.ts` — new cases: workspace root visible inside context, undefined outside, both fields coexist independently, concurrent-context isolation for the workspace root.
8. `workspace-root-resolver.spec.ts` — new cases: declared workspace outranks every inferred tier; absent getter keeps the old precedence; `undefined`/empty-string declared value falls through; a throwing getter degrades to the provider root. Header comment updated to the four-tier precedence.
9. `mcp-http/http-server.handler.spec.ts` — the URL grammar pin (see below), including the Windows-root round-trip and three rejected shapes.
10. `mcp-core/protocol-dispatcher.spec.ts` — two new cases: a `tools/call` carrying both `_caller*` fields exposes both via the context getters inside the tool; an anonymous call exposes neither.

## The URL grammar (decision, pinned in `http-server.handler.spec.ts`)

The grammar is **closed**. Exactly four shapes parse:

| URL path                         | `_callerSessionId` | `_callerWorkspaceRoot` |
| -------------------------------- | ------------------ | ---------------------- |
| `/`                              | —                  | —                      |
| `/session/{id}`                  | set                | —                      |
| `/workspace/{root}`              | —                  | set                    |
| `/session/{id}/workspace/{root}` | set                | set                    |

Rules:

- **Session first is the ONLY combined order.** The session parser is the existing anchored prefix regex (`^/session/([^/?]+)`), unchanged.
- **The workspace segment must be terminal.** Regex: `^(?:\/session\/[^/?]+)?\/workspace\/([^/?]+)\/?(?:\?.*)?$`. Only a trailing slash or a query string may follow the root.
- **Rejected shapes asserted in the spec:**
  - `/workspace/{root}/session/{id}` — rejected ENTIRELY (both fields undefined). The session is not leading and the workspace is not terminal. Half-parsing this shape would attribute the call to a workspace while silently dropping the session, so the whole request stays anonymous instead.
  - `/other/workspace/{root}` — workspace behind an unknown prefix, rejected.
  - `/workspace/{root}/extra` — trailing path segments, rejected.

Why this grammar: it matches the existing writer conventions (Ptah's own SDK writes session-first URLs; Batch B writes workspace-only URLs), keeps the existing session parser untouched, and closes the combination space so a future URL shape must change the spec deliberately rather than parse by accident.

**Windows round-trip pinned:** `encodeURIComponent('D:\projects\ptah-extension')` → `D%3A%5Cprojects%5Cptah-extension` contains no `/` or `?`, so `[^/?]+` captures it whole and `decodeURIComponent` restores it exactly. Asserted for both the workspace-only and the combined shape.

## Deliberate seam left for Batch C (not a gap I could close)

`getCallerWorkspaceRoot` is optional in `WorkspaceRootResolverDeps`. The one production caller of the resolver is `ptah-api-builder.service.ts:833` (`resolveSessionWorkspaceRoot()`), which does **not** yet pass the new getter — that file is not in Batch A's ownership set, so wiring it there would break the file-disjoint batch contract. Consequence: until Batch C (which reads `getCallerWorkspaceRoot()` for its `ICallerWorkspaceResolver` implementation) or the orchestrator adds the one-line wiring, the namespace-builder path still resolves with the old three-tier precedence. The channel itself (URL → request → context) is fully live end to end.

Recommended one-liner for whoever owns that file next: add `getCallerWorkspaceRoot,` to the deps object at `ptah-api-builder.service.ts:835` (import from `./mcp-core/mcp-request-context`).

## Constraints honored

- No platform adapter imports. No `@ts-ignore`. No global registration against `PLATFORM_TOKENS.WORKSPACE_PROVIDER`. `handleInitialize` return unchanged. No file crossed the 700-line ceiling because of this batch (the pre-existing `protocol-dispatcher.ts` warning predates it). No touch of `ptah-mcp-slots.ts`, `cli-agent-runtime`, `platform-core`, or `shared`.

## Verification (verbatim tail of the run)

Command: `npx nx run-many -t typecheck,lint,test -p @ptah-extension/vscode-lm-tools`

```
> nx run @ptah-extension/vscode-lm-tools:lint
Linting "@ptah-extension/vscode-lm-tools"...
✖ 21 problems (0 errors, 21 warnings)

> nx run @ptah-extension/vscode-lm-tools:typecheck
> tsc --noEmit --project libs/backend/vscode-lm-tools/tsconfig.lib.json

> nx run @ptah-extension/vscode-lm-tools:test
Test Suites: 45 passed, 45 total
Tests:       950 passed, 950 total
Snapshots:   0 total
Time:        55.697 s
Ran all test suites.

 NX   Successfully ran targets typecheck, lint, test for project @ptah-extension/vscode-lm-tools
```

All 21 lint warnings are pre-existing and live in files this batch did not change (`mcp-response-formatter.ts` `no-explicit-any`, `max-lines` on `protocol-dispatcher.ts`/`tool-description.builder.ts`/`harness-namespace.builder.ts`, `chrome-launcher-browser-capabilities.ts`). Zero errors.

## Not done, with reason

- Wiring the new tier into `ptah-api-builder.service.ts` — outside the ownership set (see "Deliberate seam").
- Nothing else was cut. No git state-changing command was run.
