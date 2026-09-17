# TASK_2026_411 — Large-profile performance and Codex usage

## User request and workflow

User requested `/orchestrate a fix for this in a new worktree please` following the completed read-only diagnosis of installed Electron startup/profile freezes, slow compaction, and dashboard session:stats-batch timeout under Codex subscription auth.

BUGFIX, full validation depth. Prior diagnosis substitutes for repeated broad research. Sequence: software-architect -> user architecture review -> team-leader batches -> specialist developers -> tests/reviews. No implementation before architecture approval. CLI delegation: disabled by explicit user choice (specialist subagents only). No commits/push/install/restart authorized.

## Worktree and ownership

- Source/base: codex/fix-local-production-build, 01155ae3c8b0dfcd58a6ea31292da084be4d262b.
- Created branch: fix/task-411-profile-performance.
- Implementation worktree: D:/projects/ptah-extension/.claude/worktrees/task-411-profile-performance.
- Canonical task artifacts: D:/projects/ptah-extension/.ptah/specs/TASK_2026_411 (host task board allocated atomically).
- TASK_2026_410 is unrelated concurrent background-agent execution work; do not change it.
- Use absolute worktree paths for all source reads/writes and commands. Parent session worktree-entry tool rejected schema arguments; do not assume parent cwd switched.

## Verified diagnosis

Installed ASAR identity v0.1.70 local-production gitSha 1ea605915cc481d788c8f63263fff09c6292f6e9. Hash equivalence unverified. Logs: C:/Users/abdal/AppData/Roaming/Ptah/logs/Ptah Electron-2026-09-10.log (events September 9 UTC).

### Startup

Active workspace-state.json at C:/Users/abdal/AppData/Roaming/Ptah/workspace-storage/RDpccHJvamVjdHNccHRhaC1leHRlbnNpb24/workspace-state.json is 255,969,538 bytes. External read-only measurements: read 722ms, parse 779ms, stringify 999ms before write. 174 per-agent output keys; 43 historical fat references retain 214,837 inline events. ElectronStateStorage synchronously loads and serializes whole state on each update: libs/backend/platform-electron/src/implementations/electron-state-storage.ts:18-20,28-38,55-73. Sequential session imports amplify writes: libs/backend/agent-sdk/src/lib/session-importer.service.ts:638-675; session-metadata-store.ts:295-324,458-462,1020-1059. Existing lean migration only cleans written records and separate output keys still share physical JSON. Main-loop stalls 2-5.9s observed, high-confidence bottleneck but individual spikes not stack-sampled. One-time migration42 backup 13.179s off-process is readiness delay, not continuous UI block. Integrity/backup fixes are present.

### Dashboard

Actual stats-batch 48,928.8ms (log:2889), client default 30s; unrelated RPC delays too. Dashboard default7d cap200 sessions, one uncached-ID batch: libs/frontend/dashboard/src/lib/services/session-analytics-state.service.ts:225-276. Default RPC timeout libs/frontend/core/src/lib/services/claude-rpc.service.ts:136,155-168. Backend chunks5 but full history per ID: libs/backend/rpc-handlers/src/lib/handlers/session-rpc.handlers.ts:826-838,924-931. History reader replays UI events and loads subagents despite stats caller discarding events: libs/backend/agent-sdk/src/lib/session-history-reader.service.ts:166-196. Nested agent counts19-37 observed. Legacy repeated scan defect jsonl-reader.service.ts:684-755 is latent; zero legacy files in this run, not incident cause. Need stats-only bounded reader/cache with valid invalidation and progressive UI, not timeout extension alone.

### Codex usage

Streaming responses translator emits start counters zero, stores completed input/output, then emits only output. libs/backend/auth-providers/src/lib/translation/responses-stream-translator.ts:145-159,449-456,492-499. Cache detail absent. Nonstream collector:191-196 preserves input minus cached, output, cache_read_input_tokens. Test actual SDK SSE consumer parity, not just translator JSON shape.

Subscription account allowance is DIFFERENT from per-response token accounting and local session analytics. Current translation-proxy-base.ts:254-285 routes health/models/messages only. Slash usage is generic SDK query; provider-quota.store.ts holds reactive429 cooldown, not consumed allowance. Verify authoritative Codex subscription account usage contract and add separate port/RPC/UI if supported; no guessed endpoint or credential logging. Current dollar numbers are rate-card estimates, not actual subscription invoices. Ancillary issues to assess scope: current auth used in historical costing; parent stats only after compact boundary vs all subagents; date filter lastActive not message time; UI cache stale by ID and range switch race.

### Compaction

Pre/Post first23:08:58.064->23:12:34.101 UTC216.037s6882output tokens; second23:14:27.811->23:18:00.989 213.178s6839tokens. Watchdog overdue at180s continues correctly; no first interval lag, proxy forward+84ms, history reload after Post34ms resume path. Latency inside SDK/upstream summarization, not UI reload or 180s abort. No correlated per-request first-byte/terminal/EOF so provider vs retries/buffering not proven. Other concurrent requests must not be attributed as retries. Translator responses-request-translator.ts:100-156 omits reasoning effort and output limits; do not blindly send max_output_tokens to subscription route (may reject). Proxy forces SSE; nonstream collector waits terminal plus EOF. Add metadata-only correlation/timing and capability-verified controls; preserve successful watchdog behavior and summary quality. Do not promise arbitrary latency improvement or change model silently. Previous compaction task is TASK_2026_400 (renumbered from391).

## Safety and acceptance direction

No live profile modifications or history deletion. Implement crash-safe/idempotent migration with retained source until durable verification; all performance tests on generated fixtures/temp profiles. Preserve hexagonal host contracts and all three surfaces. No merely moving expensive sync reads into another main-thread service. Read code and scoped CLAUDE instructions before proposing specifics. Test migration crash/retry and old outputs readability; large-profile responsiveness and write amplification; stats correctness/cache/workspace boundaries; streamed usage SDK consumption; supported/unsupported Codex account usage; no watchdog regression; honest instrumentation. Tests/builds must run from worktree; never nx reset other active worktrees. No commits unless user explicitly authorizes.
