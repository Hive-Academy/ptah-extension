# Batch 6h WIRING3 — P6 fix 22

Implementation complete; diagnostics passed; the single permitted verification run is pending the machine-wide FIFO lock.

## Changes

- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.ts:8 — track execution of the SDK default capabilities provider in a WeakSet keyed by resolving container. Returns a stable object; inherited defaults work. Host bindings of the identical value or object are detected.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.ts:44 — reject all partial compositions naming every missing token before constructing the native adapter; preserve immutable-binding checks.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition-error.ts:2 — replace missing-admission-port with partial-native-binding.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.ts:990 — install the tracked default provider only when no capability binding is registered, including ancestors.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/wiring/codex-runtime-composition.spec.ts:35 — test all 14 partial subsets, both aliases, no premature construction, inherited/repeated defaults, identical-default-object rebinding, complete compositions with both capability values, and late capability binding.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/register.codex-runtime.spec.ts:56 — preserve exact SDK identity with defaults; update error code and complete existing routing fixture.
- D:/projects/ptah-extension/.claude-worktrees/codex-runtime-integration/libs/backend/agent-sdk/src/lib/di/tokens.ts:45 — document all-or-nothing host contract and default provenance (JSDoc only).

## Verification

Prettier completed for all six source/spec files.

Scoped ptah_get_diagnostics:
> Source: typescript-compiler
> Errors: 0 | Warnings: 0 — No issues found.
> Coverage: clean
> Shown 0 of 0 (0 in requested files, 0 in sibling files omitted)

One verification command launched (no repeat):
`npm run verify -- -t test -p @ptah-extension/agent-sdk -- --testPathPatterns="wiring/|register.codex-runtime"`

Result pending. No build, live/paid tests, dependency installation, or git commands performed. No host/application files changed.

## Decisions

1. Track actual default provider execution instead of capability values or object identity alone. Evidence: P6 fix 22 distinguishes host false from SDK defaults; registerCodexChatServices supports inherited registrations. This also detects a host rebinding the identical default object. Weak container references need no explicit lifetime cleanup. Reversible internal implementation.
2. Replace missing-admission-port with partial-native-binding rather than retaining an admission-only special case. Evidence: previous admission failures are partial compositions; the new contract names every missing token. Scoped uses/specs updated. Reversible change.
3. Validate four inputs before native adapter resolution. Evidence: register.ts constructs native adapters from ports and lookup; early validation prevents incidental construction failures from hiding the coded composition error. Reversible ordering change.

## Scope

Only the six assigned source/spec files and this report were written. Concurrent ADAPTER3/CORE3 ownership untouched.

