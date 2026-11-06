# Batch 1-2 — orchestrator spot review

Implementers: kimi-code (partial, stopped at usage limit), codex (finished).

## Verified correct
- Pi `steer: supported`, `interrupt: unsupported` (pi-cli.adapter.ts:243-245).
- Cursor `steer: unsupported`, `interrupt: supported` (cursor-cli.adapter.ts:279-281).
- Grok ACP `steer`/`interrupt` unsupported with reasons (grok-cli.adapter.ts:186-187).
- Copilot, Cursor, Pi `limitReader: no-reliable-source`.

## Defects (assigned to the Batch 4 lane)
1. Wrong limit-reader state. `grok-cli.adapter.ts:202`, `antigravity-cli.adapter.ts:456` and
   `opencode-cli.adapter.ts:372` declare `no-reliable-source` ("No verified adapter limit reader
   is registered"). Verified readers exist for Grok, Antigravity and OpenCode Go
   (verification-tier1.md, Item 4 "Reader contract and registrations"; this session's
   `ptah_agent_list` shows Grok "Weekly 37% [provider-api]"). Fix: declare `available` with the
   registered reader's source id. Add a spec that fails if an adapter's `limitReader` disagrees
   with the reader registrations (only Copilot, Cursor and Pi are `no-reliable-source`).
2. `cli-detection.service.ts:61` maps a manifest read error to `no-reliable-source` with the raw
   `cause.message`. Use a fixed reason string (no raw error text in a UI-facing field) and log the
   error with the injected logger.
