# Recording extraction diagnosis

## Root cause

The host replaced the `CURATOR_LLM` registration but did not replace an already-resolved `MemoryCuratorService` singleton. `MemoryCuratorService` constructor-injects and retains `CURATOR_LLM` (`libs/backend/memory-curator/src/lib/memory-curator.service.ts:220`), while the host installs the double only in `afterContainerReady` (`tools/mcp-bench/src/memory-skills/host/memory-skills-host.ts:282-294`). Thus a curator constructed by an eager bootstrap collaborator before that hook continues to use the old real adapter even though `container.resolve(CURATOR_LLM)` subsequently returns the double.

This exactly explains the failed recording: the first planned fact is durable F-001, its generated standard session is non-empty and plans one model window, yet the guard at `extraction.suite.ts:623-632` observed no calls on the installed double after that case. It is not an abstention, a minimum-turn gate, an async completion race, or a replay-only path. `runCase` awaits `curate` through the safety-cap wrapper before checking (`extraction.suite.ts:362-408`), and the product window runner invokes `llm.extract` for every planned window (`curator-window-runner.ts:186-263`).

The failure was therefore a real fail-closed signal, but its message overstated the diagnosis: the token was replaced; the already-built consumer was stale.

## Live-call assessment

**Could any live model call have happened: yes.** In record mode the double intentionally wraps the real adapter (`doubles-override.ts:78-98`), and a stale curator bypasses the double entirely. This run was non-CI and its completion says `net: null`, so there is no network-recorder evidence excluding an outbound request. The seeded OAuth refresh endpoint is deliberately unreachable (`recording-bootstrap.ts:48-54`), but a valid copied access token need not refresh; it does not prove that a real model request was impossible. The available artifacts contain no dispatch provenance or cassette entry, so they do not establish that a live request actually occurred.

## Fix

`tools/mcp-bench/src/memory-skills/host/doubles-override.ts:103-113` now re-registers `MEMORY_TOKENS.MEMORY_CURATOR` as a singleton after the curator double is registered. The bench suite resolves a fresh curator, whose constructor receives the double. This is host-only and preserves fail-closed behavior: replay still supplies no real adapter, and record still resolves exactly one real adapter only inside `RecordedCuratorLlm`.

## Proof

Added `tools/mcp-bench/src/memory-skills/host/doubles-override.spec.ts:125-143`. It creates a fake stale curator singleton before the override, installs replay doubles (no network or auth), and proves resolution changes to a new curator after the rebind. Before the fix, resolution remains the stale singleton; after it, the test passes.

Checks run:

- `doubles-override.spec.ts` plus `memory-skills-host.spec.ts`: 2 suites, 26 tests passed. Jest emitted its existing forced-worker-exit warning after reporting success.
- `npx tsc -p tools/mcp-bench/tsconfig.json --noEmit`: passed (empty diagnostics output, process exit completed).
- `npx prettier --check` on both changed files: passed.
- No bench target or real-model command was run.

## B18 and scope-write plans

Yes, both share the host-wide cause when they use this recording host: B18 extraction obtains its `MemoryCuratorService` through the same container path, and `mem.scope.write` resolves the same `PtahMemoryCurator` token and counts the same curator double. The rebind applies before all suites, so it fixes the stale-singleton bypass for both. This does not claim their assertions or cassette contents will pass; only the zero-double-call wiring failure is shared.

## Decisions

- Kept the extraction case-1 guard unchanged: F-001 is expected to dispatch, so weakening or moving it would hide this wiring defect.
- Fixed only `tools/mcp-bench/src/memory-skills/host/**` and added one focused fake-only regression spec.
- Did not edit product libraries, plans, cassettes, or any 619-owned files.
