# Batch 2 Verification Report — TASK_2026_163

**Verifier**: team-leader (MODE 2, advisory)
**Date**: 2026-07-19
**Batch**: Batch 2 — `isPremium` plumbing removal (shared-type ripple)
**Commit under review**: `c00ed38` (refactor!: purge premium feature gating — WIP B1-B2)
**Method**: All acceptance greps re-run independently (prior reports NOT trusted). Spec files excluded everywhere (spec residue is Batch 5's job per R4).

---

## VERDICT: BATCH REJECTED

Scope of rejection is **narrow**: the functional purge is complete and all `isPremium`/`isPremiumTier` production plumbing is gone across every downstream lib. The batch fails **only** on Task B2.3 stale premium-naming residue — two doc comments (one of which was an explicitly enumerated B2.3 edit) and one method name. This is trivially fixable (3 edits, no logic change) and blocks nothing else structurally, but Batch 2 Verification step 2 (`ChatPremiumContext` → zero hits) and B2.3's own acceptance ("no `ChatPremiumContext` symbol left; rename complete") are not met.

7 of 8 active tasks (B2.1, B2.2, B2.4, B2.5, B2.6, B2.7, B2.8) verified clean. B2.9 correctly **DEFERRED to Batch 5**.

---

## Step-by-step results

### Step 1 — `grep -rn "isPremium" libs/backend libs/shared` (specs excluded): PASS

All production hits fall inside the allowed set (license response shape / license wire types / deferred B2.9 tail). No stray `isPremium` in agent-sdk, agent-generation, gateway-chat-bridge, cli-agent-runtime, skill-synthesis, or cron-scheduler.

Allowed hits found:

- `libs/backend/rpc-handlers/src/lib/handlers/license-rpc.handlers.ts:117,137,157,167,311,320,354` — license response shape (ALLOWED, B2.3 KEEP).
- `libs/backend/vscode-core/src/services/license/license-types.ts:42` — `isPremium: boolean` license wire type (ALLOWED).
- `libs/shared/src/lib/types/rpc/rpc-misc.types.ts:135` — `isPremium: boolean` license wire type (ALLOWED).
- `libs/backend/vscode-core/src/services/license.service.ts:45,53` — comment + `plan?.isPremium` read inside `isPremiumTier` (part of deferred B2.9; :53 reads the license wire type — ALLOWED).
- `libs/backend/vscode-core/src/index.ts:69` — `isPremiumTier` export (deferred B2.9).
- Docs only (deferred to docs pass, not production): `libs/backend/vscode-core/CLAUDE.md:33,52`.

### Step 2 — `grep -rn "isPremiumTier"` (libs/shared/apps, specs excluded): PASS (B2.9 DEFERRED confirmed)

Only production occurrences are the definition + export; **no production (non-spec) file CALLS it**:

- `libs/backend/vscode-core/src/services/license.service.ts:50` — `export function isPremiumTier(...)` definition.
- `libs/backend/vscode-core/src/index.ts:69` — export (handoff cited `:73`; actual line is `:69`).

Non-production references (acceptable): `docs/handoff-open-source-elevation.md:74`, `libs/backend/vscode-core/CLAUDE.md:33,52` (docs pass).

Recorded as **B2.9 = DEFERRED-TO-B5** (spec files still consume `isPremiumTier`; removal deferred per plan). Not a failure.

### Step 3 — `grep -rn "ChatPremiumContext|PREMIUM_CONTEXT" libs/backend` (specs excluded): FAIL (expected zero, found 2)

The rename itself is functionally COMPLETE — verified:

- New file `libs/backend/rpc-handlers/src/lib/chat/session/chat-sdk-context.service.ts` exists.
- Old `chat-premium-context.service.ts` is gone.
- `ChatSdkContextService`/`SDK_CONTEXT` present across 7 files (di.ts, tokens.ts, chat-ptah-cli.service.ts, chat-sdk-context.service.ts, session/index.ts, chat-slash-command-router.service.ts, chat-session.service.ts).
- No `PREMIUM_CONTEXT` token hits.

**Residue (BLOCKING for B2.3):**

1. `libs/backend/rpc-handlers/src/lib/handlers/chat-rpc.handlers.ts:7` — JSDoc still reads: ``*   - `ChatPremiumContextService` — MCP-running probe + premium prompt/plugin resolution.`` — **this exact doc edit is explicitly enumerated in B2.3** ("`handlers/chat-rpc.handlers.ts (:7 doc)`") and was not performed.
2. `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:313` — JSDoc references `` `ChatSessionService` + `ChatPremiumContextService` ``.

**Related premium-naming residue (same sweep, non-grep-caught):** 3. `libs/backend/gateway-chat-bridge/src/lib/gateway-chat-bridge.ts:317` — method `private async resolvePremiumContext(...)` — the resolution is now unconditional (no `isPremium`), but the method name still carries premium framing. Not caught by any Batch 2 acceptance grep; flagged here for the OSS one-way-door (R8) so it is swept with #1/#2 rather than surfacing later.

### Step 4 — `grep -rniE "upgrade to pro" libs/backend` (specs excluded): PASS (zero hits)

### Step 5 — `ALLOWED_METHOD_PREFIXES` intact (R1): PASS

`libs/backend/vscode-core/src/messaging/rpc-handler.ts:40+` — full prefix list present and not shrunk, including `'license:'` at :55 with neutral comment `// Ptah Builders membership status and key entry`. Injection guard preserved byte-for-byte in spirit (no prefixes removed).

### Step 6 — per-batch acceptance greps B2.1–B2.8: 7 PASS / 1 FAIL

| Task | Acceptance                                                                                          | Result                                   |
| ---- | --------------------------------------------------------------------------------------------------- | ---------------------------------------- |
| B2.1 | no `isPremium` field in `agent-adapter.types.ts`                                                    | PASS                                     |
| B2.2 | `isPremium` zero in `agent-sdk/src`                                                                 | PASS                                     |
| B2.3 | no `ChatPremiumContext`/`isProTier`/"upgrade to Pro" except license response shape; rename complete | **FAIL** (step 3 residue)                |
| B2.4 | `isPremium` zero in `agent-generation/src`                                                          | PASS                                     |
| B2.5 | no `isPremium`/`isPremiumTier` in bridge                                                            | PASS (naming residue flagged under B2.3) |
| B2.6 | `isPremium` zero in `cli-agent-runtime/src`                                                         | PASS                                     |
| B2.7 | no `isPremium` in `skill-synthesis/src`                                                             | PASS                                     |
| B2.8 | no `isPremium` in `job-runner.ts`                                                                   | PASS                                     |

---

## Out-of-scope / deferred observations (NOT part of this rejection)

- **Docs pass**: `libs/backend/vscode-core/CLAUDE.md` (lines 33, 52) and `libs/backend/rpc-handlers/CLAUDE.md` still describe `isPremiumTier` / "license/feature gating" / "Pro-only methods → `PRO_ONLY_METHOD_PREFIXES`". Consistent with the deferred docs pass noted in Batch 1; not blocking Batch 2 (code) verification.
- `isPremiumTier` (B2.9) intentionally retained until Batch 5.

---

## Required fix before Batch 2 can be marked COMPLETE

Assign back to the Batch 2 executor (sub-agent `backend-developer`) for a 3-edit doc/naming sweep (no logic change):

1. `chat-rpc.handlers.ts:7` — rename doc reference to `ChatSdkContextService` and drop "premium" framing.
2. `gateway-chat-bridge.ts:313` — rename doc reference to `ChatSdkContextService`.
3. `gateway-chat-bridge.ts:317` — rename method `resolvePremiumContext` → `resolveSessionContext` (or `resolveSdkContext`) and update its call site(s).

Then re-run step 3 (`grep -rn "ChatPremiumContext|PREMIUM_CONTEXT" libs/backend`, specs excluded) → must return zero. On zero, flip B2.3 → ✅ COMPLETE and Batch 2 header → ✅ COMPLETE; then proceed to Batch 3 (3 parallel lanes).

---

## Advisory (NEXT ACTION for orchestrator)

**Do NOT commit further and do NOT advance to Batch 3 yet.** Orchestrator should re-spawn the Batch 2 executor with the 3-edit fix list above. After the executor returns, re-invoke team-leader MODE 2 to re-verify step 3 only; on clean, Batch 2 completes and Batch 3 (3 parallel lanes per tasks.md: 3a sub-agent, 3b + 3c CLI) is cleared to launch.
