# Security review 8q-3b

Verdict: APPROVE
Score: 8/10
Review family: codex (implementer: grok)

Static review of the agent-sdk diff and surrounding runtime code. No tests, builds, lint, diagnostics, or source edits were run.

## M3

CLOSED — codex-chat-adapter.ts:474 passes the same context.turnPermissionLevel getter to the chat sink that codex-context.ts:273 passes to the runtime approval bridge. The sink auto-accept gate only classifies read-only commands when that value is ask (codex-chat-approval-sink.ts:123-146); an undefined value falls through to the card. The bridge uses the getter for policy and the final plan guard (codex-approval-bridge.ts:315-321,335-347).

The runtime getter returns the next-turn settings while idle and the active-turn snapshot while running or interrupting (codex-context.ts:207-214). A normal start records the snapshot before running (codex-context.ts:523-524); an idle turn/started notification also records it (codex-context.ts:393-405). Completion clears it before returning to idle (codex-context.ts:414-426). A mid-turn level update changes next-turn settings, not the active snapshot (codex-context.ts:813-840). setSessionPermissionLevel still calls updateNextTurn and updates session.settings.permissionLevel after success (codex-chat-adapter.ts:722-735). The targeted search found no other agent-sdk reader of session.settings.permissionLevel making an auto-accept decision.

## Findings

1. Minor — codex-context.ts:207-214,924-952; codex-chat-adapter.ts:474. The getter returns the retained settings level after the context closes, so the sink's callback can still return ask rather than fail closed on its own. The normal approval path remains safe: close disposes the bridge (codex-context.ts:931), the bridge declines when disposed (codex-approval-bridge.ts:335-337), and adapter teardown disposes its sink (codex-chat-adapter.ts:623-636). This is a defense-in-depth gap in the callback, not a reachable grant through the live bridge.

2. Minor — codex-chat-adapter.spec.ts:669-704. The mid-turn spec calls setSessionPermissionLevel, checks updateNextTurn and the unchanged mock turnPermissionLevel, then manually changes that mock property to plan. It verifies sink wiring and behavior across the toggle, but it does not run a real runtime turn or assert the retained session.settings value directly. The runtime snapshot, including notification-started turns, is covered by the separate 8q-3a runtime implementation and spec.

The identity store source is unchanged. Its persist updater accepts a new fingerprint for the same thread and context (codex-thread-identity-store.ts:96-111), still rejects a different context at :97-98 and a lower process generation at :99-103. The new spec checks the fingerprint replacement and context refusal (codex-thread-identity-store.spec.ts:160-175); the existing adjacent spec checks stale generation (:178-190).