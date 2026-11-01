## Changes
- apps/ptah-electron/src/activation/shutdown.spec.ts:253 — Added `nativeCodexGateway: false` to the shutdown routing fixture.
- libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-adapter.spec.ts:11,118-120 — Typed the override fixture as `CodexDevRouteOverride` and supplied both consumers plus the source.
- libs/backend/agent-sdk/src/lib/codex-app-server/codex-chat-turn-lifecycle.spec.ts:10,117-119 — Typed the override fixture as `CodexDevRouteOverride` and supplied both consumers plus the source.
- libs/backend/rpc-handlers/src/lib/chat/codex-host/codex-chat-native-contract.spec.ts:41,383-385 — Typed the override fixture as `CodexDevRouteOverride` and supplied both consumers plus the source.

## Grep evidence
- Searched all `apps/` and `libs/` TypeScript files for `DevRouteOverride` registrations. The three spec registrations above were the only stale fixtures; `codex-runtime/src/lib/di/registration.ts:54,58` registers supplied values, not an old literal.
- Searched all `apps/` and `libs/` TypeScript files for old `consumer: 'chat'` override fixture patterns; none remain. Other `consumer: 'chat'` occurrences describe runtime requests or contexts.
- Searched `apps/ptah-electron/src` for `capabilities: {` and `ElectronCodexRouting`. The shutdown fixture was the only routing literal missing `nativeCodexGateway`; other capability objects are provider metadata or language registry data.
- `rg` could not run (`Access is denied`), so searches used PowerShell `Select-String`.

## Not done
- Verify, test, lint, typecheck, build, Nx, and diagnostics were not run, per task rules; coordinator owns checks.
- No CLI skill loader was exposed; no matching skill was applied for these fixture-only edits.