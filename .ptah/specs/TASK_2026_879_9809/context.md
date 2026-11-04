# TASK_2026_879_9809 — context

## Request

User (2026-11-04): the decision-model findings confirm the issues the session `skills and memory`
(TASK_2026_878_5513) is fixing; coordinate with it and fix the gaps systematically.

## Coordination (agreed with TASK_2026_878_5513, 2026-11-04)

- This task owns `libs/backend/lane-routing` and `libs/backend/lane-outcomes` plus subagent outcome
  recording. The peer touches none of them.
- The peer owns: libs/frontend/memory-curator-ui, skill-synthesis-ui, workspace-indexing;
  libs/backend/memory-curator; rpc-handlers memory-rpc / indexing-rpc / skills-synthesis-rpc
  handlers; shared rpc types for memory:runNow, indexing:start/status, skillSynthesis:harvestSpecs;
  libs/backend/skill-synthesis; agent-sdk curator-llm adapter, codex-app-server
  routing-agent-adapter.ts and Codex capability wiring (agent-sdk di/register.ts,
  wiring/codex-runtime-composition.ts, apps/ptah-electron/src/di/codex-runtime-composition.ts).
- Message the peer session before touching any file in its list.

## Findings (orchestrator, read-only evidence)

1. `pastOutcomes` is never sent: `libs/backend/lane-routing/src/lib/pipeline/model-refine.ts:158`
   and `:231` pass `outcomeFigures: []` to `buildDecisionPayload`. `~/.ptah/state/ptah.sqlite`
   `lane_outcome_records` holds 363 delivered/failed rows (500 rows total, 2026-10-26..11-04).
2. No lane was ever chosen by the model: routing_source = 448 not-routed, 40 pin, 12 ranking, 0
   model. Earlier Gatsby calls all timed out.
3. All 134 subagent outcome rows have verdict `unverified` (lane_id `subagent`), so they carry no
   delivered/failed signal.
4. Successful routing calls log only at `debug`; the Electron log
   (`~/.config/Ptah/logs/Ptah Electron-YYYY-MM-DD.log`) shows only `[lane-routing] system one
   call failed` WARN lines. Decisions are not observable after the fact.
5. Pre-flight `depth` answer: model confidence 0.004 and 0.014 in two live calls → always
   `skill-table` fallback (`low-confidence`). `taskType` is fine (0.89, 0.92).
6. Timeout: `agentOrchestration.decisionModelTimeoutMs` = 60000 in `~/.ptah/settings.json`
   (mtime 2026-11-04 11:06Z); installed app clamp max is 6e4; yet every failure after that logged
   `request timed out after 30000 ms` (13:36Z..18:18Z). App process started 2026-11-03. Possible
   settings-reload bug in the per-call read (`decision-model.target.ts:184-214`). Unconfirmed.

## Ops state (not code)

Decision model served from Chappie: user unit `ptah-chappie-ollama.service` tunnels
127.0.0.1:11435 → chappie:11434; Gatsby unit disabled (file kept). Chappie Ollama has
`OLLAMA_KEEP_ALIVE=-1` (drop-in keepalive.conf). Warm `/v1/systemone` ≈ 3.4 s, cold ≈ 17 s.

## Gate 0.1

- Preference source: memory (no explicit lane preference found) → default `enabled`.
- Mode: `enabled`. Approval mode: `lane-review`.
- ptah_agent_list (2026-11-04 20:4xZ): codex installed, confirmed room (weekly 59%); grok installed,
  confirmed room (84%); antigravity installed, limits unknown; Ollama Code near limit (98%);
  kimi code AT LIMIT; copilot, claude disabled; cursor, opencode, pi not installed.

## Worktree

`/home/amun/ptah-extension/.claude-worktrees/decision-model-data-gaps`, branch
`fix/decision-model-data-gaps` from main 7e0b461c8.

## Peer contract for cross-check (TASK_2026_878_5513, received 2026-11-04, may change slightly)

- A. `memory:runNow` → `MemoryRunNowResult` (libs/shared rpc-curator-diagnostics.types.ts) gains optional
  `outcome` ('ran'|'stalled'|'failed'), `reason` (stall/deferral | 'no-output' | 'curator-error' |
  'auth-required' | 'provider-unsupported'), `error` (fixed backend sentence, never raw provider text).
  `success:false` on throw / outcome failed / provider-unsupported. `memory:diagnostics` forwards them.
  Codex refusal → stall, reason provider-unsupported, no query, observations stay queued.
  Check: curatorProvider=openai-codex → success:false, reason provider-unsupported, no secret text.
- B. `indexing:status` → `IndexingStatusWire` gains `running` {origin manual|background, startedAt, force,
  joinedBackground?, processed?, total?} | null and `lastRun` {origin, outcome, files, symbols, errors,
  durationMs, finishedAt} | null (migration 0066 `indexing_state.last_run_json`). `state` = 'indexing'
  during manual or boot/watcher census. start/resume results gain `reason`. New push 'indexing:failed'.
  INFO logs "[indexing-control] start", "start ignored — already running", "indexing failed".
  Check: Re-index during a boot census → running.origin 'background', joinedBackground.
- C. `skillSynthesis:harvestSpecs` → {scanned, harvested, reconciled}, shown in the UI; INFO log per run.
  Reconcile by task id within the workspace: success = done + latest approving review; failure =
  cancelled or rejected review; marker v3 re-harvests once; foreign-workspace grades never overwritten.
  Check: harvest twice → second harvested 0, grade count unchanged.
- Peer seeders write only to throwaway sqlite / temp workspace; they reuse our `scripts/dev/seed-lane-outcomes.mjs`.

## Lane limits (agent-lanes §5)

- grok (cli grok, family grok): confirmed usage limit 2026-11-04 22:40Z — `402 Payment Required: Grok Build usage balance exhausted`; list row weekly 98%, resets 2026-11-10 17:40 UTC. Skip grok for the rest of this run.
