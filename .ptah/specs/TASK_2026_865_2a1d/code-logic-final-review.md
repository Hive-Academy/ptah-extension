# Final code logic review — TASK_2026_865_2a1d

Commit: `364ca0c53`. Reviewer codex; implementer claude.

## Verdict

**REVISE — 5/10.** R2 and R3 are fixed, but R1 still fails end to end. This is a real functional gap (5–6 band), above 3–4 because the timeout and authorization work, and below 7–8 because a retry can bind the wrong launch.

## Findings

1. **Serious — the old-resolution-first retry can still bind the expired launch.** The retry replaces the tab's ticket (`libs/backend/rpc-handlers/src/lib/chat/session/chat-carry-over.service.ts:402-411`), and the next resolution claims that ticket based only on tab ID (`:186-191`; `libs/backend/cli-agent-runtime/src/lib/wiring/sdk-callbacks.ts:227-244`). If A expires, B is admitted, then A resolves first, A receives B's request ID. The renderer binds A as B (`libs/frontend/chat/src/lib/services/provider-carry-over.service.ts:420-427`). The B resolution is subsequently skipped or rejected. The renderer test (`provider-carry-over.service.spec.ts:914-945`) injects correct IDs directly and misses this host ordering. The pre-existing agent SDK registry also permits an older init to bind the retry's record: `libs/backend/agent-sdk/src/lib/helpers/session-lifecycle/session-registry.service.ts:355-407` accepts the first ID for a null-ID record without checking the owner token. Associate request ID with the actual launch/process or validate registry ownership before the callback, then test the combined path.
2. **Moderate — a stale host ticket can abort an unrelated new chat.** An accepted launch without init retains its ticket for 210 seconds (`chat-carry-over.service.ts:402-411`), while the renderer releases the tab after 90 seconds (`libs/frontend/chat/src/lib/services/provider-carry-over-launch.ts:220-227,345-359`). A regular session started in that tab during the gap receives the stale tag and is aborted as an expired carry-over (`provider-carry-over.service.ts:429-438`). Retire or identify the ticket by process ownership. This requires a lost resolution plus another start, so it is less likely than Finding 1.

## Four judgments

1. **R1: partial.** Correctly tagged old and foreign resolutions are aborted; the matching retry binds, and no ID follows the former tab-based path (`provider-carry-over.service.ts:351-384,420-463`). The host claim is once-only and tab-keyed, but cannot prove which launch resolved. Findings 1–2 cover both stated limits. The requested end-to-end guarantee is unmet.
2. **R2: fixed.** Accepted RPC arms a 90-second deadline (`provider-carry-over-launch.ts:220-227`); expiry releases pending, retains the offer, shows a notice, and records the ID (`:345-367`). Bind, error, refusal, and pruning remove pending; removal clears the timer (`provider-carry-over.service.ts:391-409,466-488`). Re-arming clears the previous timer (`provider-carry-over-launch.ts:326-338`). The Jest worker warning is consistent with specs ending while a real 90-second accepted-launch timer remains. Production timers are bounded; the warning alone does not prove a production leak.
3. **R3: fixed.** Proxy offers require a runtime profile and call `assertAuthorizedFolder` before returning eligible (`chat-carry-over.service.ts:382-389`). The same authorization runs in `prepare` (`chat-runtime-profile.service.ts:120-129`); this shortcut does not acquire a proxy.
4. **New defects and contracts:** Finding 2 is new. The cli-agent-runtime token is optional at broadcast (`sdk-callbacks.ts:259-278`) and aliases the existing singleton when chat DI binds it (`libs/backend/rpc-handlers/src/lib/chat/di.ts:102-113`); hosts without it retain untagged behavior. The commit leaves `chat:continue` and its AUTH_REQUIRED refusal untouched. The new request ID remains optional in the schema (`libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.schema.ts:183-190`).

## Five logic questions

1. **Silent success:** A's late resolution can carry B's ID and complete B's UI binding as though B succeeded (Finding 1).
2. **Unexpected action:** Retry after expiry, or start a normal new session in the released tab before the host ticket lapses (Findings 1–2).
3. **Wrong input:** A valid old-process session ID is accepted as B's because the broadcaster sees only the tab ID (Finding 1).
4. **Dependency failure/timeout/shape:** Lost resolution now expires; absent tag retains previous handling; optional tag provider does not break other hosts. A failed abort is logged (`provider-carry-over.service.ts:492-507`).
5. **Missing requirement:** Define ownership for overlapping launches and a subsequent ordinary start in the same tab (Findings 1–2).

## Verification

Reviewed task context, task description, implementation plan, prior review, implementer report, commit diff, full affected control paths, and the agent SDK registry. No source edits, tests, builds, Nx commands, or commits. Implementer reports 246 backend, 172 frontend, and 21 cli-agent-runtime Jest tests passing, with a worker-exit warning. Scoped `ptah_get_diagnostics` remained unavailable after 45 seconds; no typecheck claim. No code-style review file was present.

## Decisions

- **Require actual launch ownership for R1.** Options: accept the next tab resolution, or associate the request ID with the process/registry owner. The old-first sequence and registry behavior support the latter. Reversible implementation decision; current verdict is REVISE.
