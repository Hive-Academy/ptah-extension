# Batch 4 Jest failure fixes

## 1. Registration fixture TS2352

- **Root cause:** The registration spec cast a metadata-only object to `CodexChatAdapterPorts`, although the interface requires the other adapter ports.
- **Decision:** Fix the spec fixture. `libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts:43-87` now supplies a fully typed `CodexChatAdapterPorts` object with explicit unused-port stubs; `:93-98` renames the reflected value to avoid colliding with that fixture. No unsafe cast, `any`, or TypeScript suppression was added.

## 2. Metadata identity, both storage modes

- **Root cause:** The spec inserted an unverified cost of 7 into a native row and expected it to survive `updateCodexExecution`. The approved batch 4 design intentionally clears native cost without a complete priced usage checkpoint; token and resume metadata remain intact.
- **Decision:** Fix the spec. `libs/backend/agent-sdk/src/lib/session-metadata-store.spec.ts:2537` clarifies the case name, and `:2556` expects `totalCost: null` for both `async=false` and `async=true`. The fixture still writes 7 first, so the test covers removal of unverified cost. No metadata-store production change was needed.

## 3. Native model usage and known context window

- **Root cause:** The normal result callback calls `publishStats`, but its `modelUsage` branch required a model ID in the usage checkpoint. These test events contain native usage and a configured model, but no evidence record, so the checkpoint has no model ID and the branch omitted the row.
- **Decision:** Fix production. `libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-stream.ts:194-205` separates the evidence model from the display model. The display row falls back to the tracked session model, allowing native usage and the reported 272000-token window to reach `modelUsage`. Pricing still uses only the evidence model, so absent evidence cannot be priced from a configured alias.

## 4. Native model usage and unknown context window

- **Root cause:** The same missing-model branch omitted `modelUsage` when native usage did not report a context window.
- **Decision:** The same production change at `codex-chat-turn-stream.ts:194-205` exposes the row. Existing context resolution and payload construction at `:222-269` retain `source: 'unknown'`, `tokens: null`, `contextWindow: 0`, `lastTurnContextTokens`, and `costUSD: null`; no assertion was weakened.

**Production code changed:** `codex-chat-turn-stream.ts` only, at lines 194-205. No frontend, MCP, or foreign `task-tracking/landing-live-demo/HANDOFF.md` change was made for this fix.

**Execution:** Per the task's strict instruction, no tests, lint, typecheck, build, Nx, npm, diagnostics, or verify command was run. The three edited source/spec files were inspected for LF endings and no BOM. This lane exposed Ptah workspace tools but no invocable skill mechanism; no skill was loaded.
