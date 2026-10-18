
## Live probe P1

Date: 2026-10-17. SDK `@anthropic-ai/claude-agent-sdk` 0.3.278 (bundled CLI), user's normal auth, model `haiku` (resolved `claude-haiku-4-5-20251001`). Script: `.ptah/tmp/idle-probe/probe.mjs` (git-ignored, `.gitignore:135`), cwd `.ptah/tmp/idle-probe/cwd`. Single run, no retry.

### Setup
`query()` with streaming-input async iterable. Turn 1: "Reply with the word ok." After its `result`, pushed `{ type:'user', message:{role:'user',content:'/compact'}, parent_tool_use_id:null, session_id:<init id>, origin:{kind:'coordinator'} }`. `SDKMessageOrigin` in 0.3.278 `sdk.d.ts` includes `{kind:'coordinator'}` (line 5070), so no fallback without `origin` was needed. PreCompact/PostCompact hooks registered. Input closed after the second `result`.

### Ordered event log (trimmed, ms since start)
```
+10903 system init  (session fb578920..., haiku-4-5)
+14086 assistant    usage cache_creation_input_tokens=38400, cache_creation={ephemeral_5m:0, ephemeral_1h:38400}
+14131 result success num_turns=1 result="ok"
+14140 system status
+14144 HOOK PreCompact  trigger=manual session_id=fb578920...
+35569 HOOK PostCompact trigger=manual session_id=fb578920... (same id)
+35578 system status
+35592 system init   (re-emitted, same session_id and model)
+35593 system compact_boundary {trigger:'manual', pre_tokens:38587, post_tokens:7532, cumulative_dropped_tokens:31055, duration_ms:21423}
+35593 user (x2, local command echo frames)
+35595 result success num_turns=0 result="" usage all zero, iterations=[]
```

### Verdicts
- A2: PASS. PreCompact fired with `trigger:'manual'`; `compact_boundary` arrived; compaction result has `num_turns === 0`, empty result text, zero usage, no assistant frame answering `/compact`.
- A3: PASS. `compact_boundary` (+35593) precedes the compaction turn's `result` (+35595), by 2 ms.
- PostCompact position: BEFORE `compact_boundary` and before the result (+35569, 24 ms ahead of the boundary). Order: PreCompact, PostCompact, status, init, compact_boundary, user echoes, result. PostCompact carried the same session_id as the stream (no id change observed).
- A4: PASS (informational). Turn-1 assistant usage has the `cache_creation` split (`ephemeral_1h_input_tokens: 38400`, `ephemeral_5m_input_tokens: 0`).

### Implications for the plan
- Batch 10 gate (A2 PASS, A3 PASS) is satisfied; the `coordinator` origin plus `/compact` path works end to end, no human-origin fallback or render suppression needed for correctness.
- PostCompact arrives before the boundary; the reducer and the PostCompact rekey must tolerate that order (the plan says both orders are handled).
- A second `system init` frame is emitted after compaction with the same session_id; any consumer that treats `init` as "new session/turn start" must not treat this one as one (observed, not tested against Ptah code).
- Two `user` frames (local command echo) arrive between the boundary and the result; renderers that suppress coordinator-origin output should expect them. Their content was not inspected.
- Compaction of a 38.6k-token session took 21.4 s and the `result` carries no usage, so idle-compaction cost accounting cannot use `result.usage`; use `compact_metadata` (`pre_tokens`/`post_tokens`).
- Unverified here: A1/A5 and the in-app `sendIdleCompact` path (stay with the senior-tester QA run).
