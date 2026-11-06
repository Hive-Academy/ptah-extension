# Batch 8 implementation report

## Changes

- `README.md`: replaced the ACP transport claim with adapter-manifest potential support, effective live-handle support, default queueing, consent for interrupt and resume, and receipts. No vendor capability table was added.
- `.claude/skills/agent-lanes/SKILL.md`: replaced immediate completion/report delivery with bounded in-memory pending envelopes, activity/session-id drain, and idempotent retry. Kept the five-check status/read fallback. Added usage-limit failure semantics, spawn `permission`/`network` policy refusal, potential versus effective messaging support, queue/now/legacy steer, receipt states, metadata-only persistence, and OpenCode `session-mismatch` recovery.
- `ptah-core-prompt.ts`: replaced immediate-push language with pending signal recovery and a bounded status/read fallback; added manifest, preview, consent, and receipt semantics.
- `cli-adapter.utils.ts`: replaced mode-only child guidance with queue/now semantics, receipt ID and settlement checks, and pending report delivery. Kept the command-line guidance within its existing 2,057-byte guard.
- `lane-reporting-contract.ts`: replaced the claim that a report reaches the parent immediately with recorded, pending, then sent semantics; `delivered: false` remains a refusal with a reason.
- `ptah-core-prompt.spec.ts` and `cli-adapter.utils.spec.ts`: updated exact-text assertions for the new wording. Kept the core token budget, CLI byte ceiling, and vendor-roster drift checks.

## Verification

- Requested `npm run verify -- -p @ptah-extension/agent-sdk,@ptah-extension/cli-agent-runtime -- --output-style=static` ran once for the two named projects. Both lint/typecheck and test phases stopped before tasks: Nx `@nx/eslint/plugin` project-graph worker exited unexpectedly. Exit code 1; no source verdict from this run.
- Focused `cli-adapter.utils.spec.ts`: 105/105 passed. The 2,057-byte guidance ceiling and vendor-roster guard passed.
- Focused `ptah-core-prompt.spec.ts`: 7/7 passed, including the 3,380-token ceiling.
- Scoped `ptah_get_diagnostics` after edits: unavailable after 45 seconds; five TypeScript files unchecked.
- No frontend files were edited; no git mutation was run.

## Decisions

- Kept the README capability description manifest-driven. A vendor table would duplicate runtime data; this follows the plan's explicit decision and is reversible.
- Described parent envelopes as bounded in-memory pending delivery. The implementation review A2 and Batch 4 report specify this behavior; durable persistence is out of scope and the wording is reversible.
