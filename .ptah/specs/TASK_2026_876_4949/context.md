# Context — TASK_2026_876_4949

## User request (verbatim)
in our sesison handoff when a session opens up another one, that old sessions keeps showing in our
session tree and if it has a working cli it keeps showing as running , which is a bit confusing and
i'm thinking we can have our new session close that old session and we can add a small section in
our stats right sidebar that shows linked sessions together, or what you think about that ?

## User decisions (AskUserQuestion, 2026-11-04)
- Old session after a successful handoff: **Stop + nest**. Wait for the old session's current turn
  to end (the `ptah_session_handoff` tool result must return first), stop its SDK process, mark it
  "Handed off", and show it below the new session in the session tree. Keep its history. Do not delete.
- Stats right sidebar: **Linked sessions, full chain**. Show every session in the handoff chain
  (continued from / continued in), each one clickable.

## Scope change (user, 2026-11-04, after Gate 1/1.7 reviews) — BINDING, supersedes the nesting part above
"can we show them in our stats sidebar and in our sessions list i don't want to affect our ordering mechanisms
so i think we can show them as small tiles inside the session itself or something? actually i think only on the
stats sidebar would be sufficient"
- Do NOT change the session list, the canvas rail, nesting, grouping or ordering. No "Handed off" rows/cards there.
- Linked sessions (full chain, clickable) appear ONLY in the stats right sidebar of the session.
- The old session is still stopped after its current turn ends, so it no longer shows Running. It keeps its normal
  place and history.

## Known facts
- `libs/backend/cli-agent-runtime/src/lib/session-children/session-handoff.service.ts` (TASK_2026_655)
  starts the new session, adopts the caller's running CLI lanes and child sessions
  (`adoptWork`/`settleAdoption`), and does NOT stop the caller.
- `SessionHandoffOpenedPayload` (`@ptah-extension/shared`) carries `tabId`, `fromTabId`,
  `fromSessionId`, `label`, `startedAt`.

## Execution
- Worktree: `D:\projects\ptah-extension\.claude-worktrees\handoff-linked-sessions`
  (branch `feat/handoff-linked-sessions`, from main).
- Type FEATURE, depth Full (adds a UI section → design gate applies).
- Gate 0.1: lanes `enabled` (memory: user prefers lanes-first, never codex/copilot; Glm and kimi at
  limit). Spawnable: grok (confirmed room), antigravity, opencode (limits unknown).
- Approval mode: `lane-review`.

## Lanes
| Phase | Lane | Agent ID | CLI Session ID | Result |
|-------|------|----------|----------------|--------|
| PM (task-description.md) | grok | 56ef5265-c8a9-4ca7-872d-e188515376a8 | 01a1a75f-ce58-77c1-a9f6-ea77e394ff4b | delivered, 10m 32s |
| Gate 1 review | antigravity | 0872b965-e4bc-4bb9-a405-7721efebc049 | 979104d6-f9b7-4026-b482-860087b0c363 | REVISE (1 Blocking, 3 Serious, 2 Moderate, 1 Minor) |
| PM revision round 1/2 | grok (fresh lane; resume refused, idle > 600 s) | 06eb9498-e9c6-47eb-b0e8-6837944b7175 | 01a1a774-0cce-7fa2-acc8-982dcbf98aa9 | delivered (48 KB); reported: 7/7 findings fixed, none disputed |
| Gate 1 re-review + Gate 1.7 design review | antigravity (resumed) | bf77cd9c-8e5e-456b-9942-553103156e6f | 979104d6-f9b7-4026-b482-860087b0c363 | Gate 1 APPROVED; Gate 1.7 REVISE (2 Serious, 2 Moderate, 1 Minor) |
| Design revision round 1/2 | grok (resumed) | 8f5523e1-b3f3-4d49-8bb2-85a01645ce74 | 01a1a76a-cf15-7573-a16a-5a3168fac8d1 | delivered, 5/5 fixed |
| Gate 1.7 re-review | antigravity (resumed) | f1b76ba2-0210-422c-a845-7d55132d1811 | 979104d6-f9b7-4026-b482-860087b0c363 | APPROVED |
| PM scope reduction | grok (fresh) | 93a10087-8301-4147-81ff-a71ec7718e92 | 01a1a78e-ccdb-7110-84e5-1950afa5c868 | delivered (13 criteria) |
| Design scope reduction | grok (fresh) | e1e063bd-eb75-4436-bec5-d33f1f2302f7 | 01a1a78e-d2aa-7a60-964c-804065ac55ae | delivered (sidebar only, 6 screenshots) |
| Re-review round 2 (both docs) | antigravity (fresh) | 37c99aa9-a328-48cd-8f09-4efeff4dc119 | c6f33f1a-3c5b-4f17-8307-070912786598 | Gate 1 + 1.7 APPROVED (no findings) |
| Architect (implementation-plan.md) | grok | d73c3aa5-b914-460e-8602-c893dca25fee | 01a1a799-31a5-75b3-bb3a-c21abf4b13d6 | delivered (50 KB, 21 min) |
| Gate 2 review | antigravity (fresh) | 6bcd61f8-ac66-406a-8974-e8101a930cf9 | 60aac649-fb3a-4427-8b0e-51688aeed0ab | REVISE (1 Blocking, 3 Serious, 1 Moderate) |
| Architect revision round 1/2 | grok (fresh) | 668bba43-e3ed-4a49-8384-02076ad70f8e | 01a1a7c6-b5d6-79a3-ae72-6a44423e3291 | delivered (68 KB), 5/5 fixed |
| Gate 2 re-review round 1 | antigravity (fresh) | 50a4aa06-9f13-4023-b03b-2deb6c9fb688 | 1d2765e5-371a-4773-85f4-a5535e3b095f | APPROVED (5/5 resolved); user APPROVED Gate 2 |
| Batch 1 shared contracts | grok | a86233cb-aa6e-4105-a109-574c162cd91f | – | running |
| Design + prototype | opencode | 646681cb-42f4-4b88-b750-168323e087a9 | ses_e5895fc9effeVQFV15mHSIeHQa | failed at start: `Model unavailable: opencode-go/glm-5.3` (config fault, not a limit). Skip opencode this run. |
| Design + prototype (retry) | grok | 5f984af3-1e12-4df9-b40a-84811ab3b60e | 01a1a76a-cf15-7573-a16a-5a3168fac8d1 | delivered, 15m 53s; screenshots dark+light checked by orchestrator |
