# Completion Validation — TASK_2026_408

**Verdict: INCOMPLETE**

## Executive Summary
PR #602 (`54f173258`) merged all code for Scope Item 1 and Phases 1–2 (Batches 1–11). All 5 architecture-level functional criteria pass. However, TASK_2026_408 is **INCOMPLETE** against its full task specification because Phase 3 ("reasoning carry-over policy") was left **OPEN** in `context.md:52-80` and `task.md` (`status: in_progress`, `labels: [partial]`), pending user authorization for the ChatGPT subscription live probe (`phase-3-options.md:63-80`). Other original scope items were formally delegated to follow-up tasks (`TASK_2026_561_9e57`, `TASK_2026_562_4b1d`, and `TASK_2026_564_87a6`).

## Verification Matrix

| Phase / Criterion / Batch | Status | file:line Evidence on `main` (7c8271e4a) |
| --- | --- | --- |
| **Scope 1 / Usage Translation** | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-helpers.ts:25-39` (`translateResponsesUsage`, commit `4f806f210`) |
| **Batch 1 (Phase 1a)** Upstream Error Classifier | DONE | `libs/backend/auth-providers/src/lib/translation/responses-error-mapping.ts:14-295` |
| **Batch 1 (Phase 1a)** Collector Terminal Handling | DONE | `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts:31-41,117-128` |
| **Batch 2 (Phase 1b)** Stream Translator Terminals | DONE | `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts:133-145,307-334` |
| **Batch 2 (Phase 1b)** Proxy Base Overflow Mapping | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:1078-1097,1228-1244` |
| **Batch 11 (Phase 1 Follow-up)** Error-First Streaming | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:805-835,878-895`; `responses-stream-translator.ts:265-274` |
| **Batch 3 (Phase 2a)** Tool-Name Guard | DONE | `libs/backend/auth-providers/src/lib/translation/responses-tool-names.ts:19-97` |
| **Batch 3 (Phase 2a)** Collector Tool-Name Resolver | DONE | `libs/backend/auth-providers/src/lib/translation/responses-stream-collector.ts:50-57,98-104` |
| **Batch 4 (Phase 2b)** Stream Tool-Call State & Blocks | DONE | `libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts:210-218,526-640` |
| **Batch 4 (Phase 2b)** Proxy Base Resolver Plumbing | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:552-579` |
| **Batch 5 (Phase 2c)** Tool-Result Image Translation | DONE | `libs/backend/auth-providers/src/lib/translation/responses-request-translator.ts:70-74,401-447` |
| **Batch 5 (Phase 2c)** Downgrade Post-Pass Module | DONE | `libs/backend/auth-providers/src/lib/translation/responses-tool-output-images.ts:17-40` |
| **Batch 6 (Phase 2d)** Image Capability Hook & Codex | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-base.ts:726-728`; `codex-translation-proxy.ts:148-150` |
| **Batch 7** Demote Codex Static Model List | DONE | `libs/shared/src/lib/providers/entries/codex-provider-entry.ts:17-95` (`contextLength: 0`) |
| **Batch 8** Dropped User-Tier Settings Disclosure | DONE | `libs/backend/agent-sdk/src/lib/helpers/sdk-query-options-builder.ts:1129-1133` |
| **Batch 9** Installed SDK Integration Spec (S1–S6) | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy.sdk.integration.spec.ts:1-1353` |
| **Batch 10** Ownership Doc & Entry-Point Comments | DONE | `.ptah/specs/TASK_2026_408/ownership.md:1-59`; `codex-cli.adapter.ts:8-12`; `anthropic-proxy.service.ts:43-48` |
| **QA Suite Pass** Raw-Wire Parity Specs & Report | DONE | `providers/codex/codex-stream-parity.spec.ts:21-39`; `providers/opencode/opencode-translation-proxy.spec.ts:30-36`; `test-report.md:1-116` |
| **Criterion 1** Semantic Cache/Token Parity | DONE | `libs/backend/auth-providers/src/lib/translation/translation-proxy-helpers.ts:25-39`; `translation-proxy-base.spec.ts:1078` |
| **Criterion 2** Error & Incomplete Stream Coverage | DONE | `responses-error-mapping.spec.ts:1-437`; `responses-stream-collector.spec.ts:1-186` |
| **Criterion 3** Integration Proves Context Accounting | DONE | `translation-proxy.sdk.integration.spec.ts:1290-1340` (S6 auto-compact & resume) |
| **Criterion 4** Model Window & Compaction Policy | PARTIAL / MOVED | Reactive overflow compaction proven (S6). Proactive window selection MOVED-TO-FOLLOW-UP to `TASK_2026_561_9e57`. |
| **Criterion 5** Skill & Slash Command Execution | PARTIAL / MOVED | Path A proven (S1–S4 in integration spec). Path C placeholder tools MOVED-TO-FOLLOW-UP to `TASK_2026_564_87a6`. |
| **Criterion 6** Scoped Diagnostics & Test Counts | DONE | `test-report.md:66-75` (53 suites, 1318 tests in `auth-providers`; mocked vs live split) |
| **Phase 3** Reasoning Carry-over & Probe (P1–P7) | NOT DONE | `.ptah/specs/TASK_2026_408/phase-3-options.md:1-80`; live probe never authorized; code remains stateless (`store: false`) |

## Resume-Point Notes Summary
Per `context.md:52-80` (updated 2026-09-27) and `commit bdc6bbdfb`:
1. **Phases 1–2**: Completed on branch `fix/task-408-codex-proxy-phase-1-2` and merged into `origin/main` via PR #602.
2. **Phase 3**: Remains **OPEN**. It defines the decision on reasoning carry-over (`phase-3-options.md`: `reasoning.encrypted_content` include/replay, `previous_response_id`, `store`).
3. **Live Probe Requirement**: Phase 3 requires a live probe (P1–P7) against the ChatGPT subscription endpoint (`https://chatgpt.com/backend-api/codex/responses`) to determine whether the endpoint supports reasoning replay, which requires user authorization.
4. **Known Residuals Recorded**:
   - An overflow arriving after partial streamed output has gone to the client is retried by the CLI rather than compacted (`ownership.md:22`).
   - `[DONE]`-only streams end as `end_turn` for gateway compatibility (`ownership.md:20`).
   - Requests remain stateless (`store: false` in `responses-request-translator.ts:154`).

## Remaining Work and Follow-Up Distribution
1. **In TASK_2026_408 (Open)**:
   - Phase 3 decision on reasoning carry-over policy (`phase-3-options.md`). If Option A (maintain status quo stateless behavior) is accepted by the project owner, no implementation code is required. If Option B is chosen, live probe P1–P7 must be authorized, and request/stream translators updated to round-trip reasoning signatures.
2. **Moved to `TASK_2026_561_9e57`**:
   - Compaction layer policies, proactive token thresholds, and default model-window selection for proxied models (`context.md:73`, `task.md` of 561).
3. **Moved to `TASK_2026_562_4b1d`**:
   - System-prompt-once translation, `prompt_cache_key`, and proxy session token efficiency (`context.md:5-10`, `task.md` of 562).
4. **Moved to `TASK_2026_564_87a6`**:
   - Path C CLI workspace proxy fixes: removal of dead `skill__` / `mcp__` placeholder tools, command flattening, and tool forwarding (`context.md:75`, `ownership.md:33-44`, `task.md` of 564).

## Recommended Registry Status
- **Option 1 (Recommended — `done`)**: If the user/team accepts the recommendation in `phase-3-options.md:53-56` (Option A: maintain stateless status quo without reasoning carry-over) and treats any future live probe as an independent spike, change status to **`done`** and remove the `partial` label. All 11 implementation batches have shipped cleanly on `main`.
- **Option 2 (`in_progress`)**: If the user intends to execute the live subscription probe P1–P7 and implement Option B before closing TASK_2026_408, retain **`in_progress`** with label **`partial`**.
