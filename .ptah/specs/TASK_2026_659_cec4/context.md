# Task Context - TASK_2026_659_cec4

## User Request

> start a child session that investigate all skills trajectory basically i feel like i built a monster that
> produces toys !? and i never really gained any value out of it and i do agree with you memory should be
> kept as is, but skills trajectory should be completely re-thought and re-implemented , basically i was
> taking hermes agent as a row model in that area but i don't think it worth all the calls and cost it costs
> me , so we need an honset and physically proven evaluation of what we have, also i did had a session
> before that organize all memory and skills tasks to fix tthem so we need to do heavy search for that as well

## Task Type

RESEARCH (evaluation only; no code changes, no task status changes, no data deletion).

## Evidence the user supplied (screenshots, Thoth panel, 2026-10-14)

- Skill synthesis counters: Candidates 414, Promoted 2, Rejected 2278, Active skills 2, Invocations 0.
- "Recommended" list: every item comes from "1 session", category `general`, judge 8.0-8.4 (e.g.
  `map-oauth-translation-proxy`, `review-generator-integration`, `audit-service-adapter-integration`,
  `build-interactive-guided-tour`): one-off investigations, not reusable routines.
- Library → Agents tab: every agent shows Success 100% (backend-developer 1261 inv, code-logic-reviewer 649,
  code-style-reviewer 179, devops-engineer 64), "History 5 snapshots", "Enhance now", and the error
  "Models unavailable: RPC timeout: skillSynthesis:getAgentModels".

## Agreed position (orchestrator session, 2026-10-14)

- Memory (Thoth memory search/curation) stays as is. It is out of scope except where code is shared.
- Per-agent invocation/token/cost telemetry and harness sync (agent copies to codex/copilot/opencode) are
  likely worth keeping: TASK_2026_646_136a (decision model) reuses the telemetry as the lane outcome record.
  The evaluation must confirm or refute this with evidence.
- The user's reference model was the Hermes Agent (Nous Research) self-improving skills loop.

## Known pointers

- Epics filed 2026-10-12 ~19:39 UTC in one batch (likely the "organize memory and skills tasks" session):
  TASK_2026_636_0add (memory quality, measured), TASK_2026_637_e30b (Thoth UI), TASK_2026_638_7a8e (memory code
  health), TASK_2026_639_97f0 (skills content and synthesis), TASK_2026_640_11a5 (skills distribution to CLIs),
  children 641-644.
- TASK_2026_620_a13e (done): "Memory and skills: benchmark-first quality program" (parent TASK_2026_439_1310);
  absorbs 471, 473, 563, 578, 588, 536.
- TASK_2026_588_f4f8 (cancelled): evidence-first skills pipeline (cross-session clustering; delete the
  single-session auto-candidate). The screenshot shows single-session candidates are still produced.
- Open children: TASK_2026_245, 435_c8a6, 536, 644_f03f (639 epic); 276, 279, 280, 284, 289, 313, 564_87a6
  (640 epic); 560_2ae5; 624_d671.

## CLI Lanes

The child session decides at its own start (lanes `enabled` per the user's stored preference).

## Outcome (2026-10-14, user decisions)

- **Step 0 done:** `~/.ptah/settings.json` → `skillSynthesis.enabled = false`, `skillSynthesis.curatorEnabled = false`.
  Backup: `~/.ptah/settings.json.bak-2026-10-14-skill-synthesis-off`. The master switch does NOT gate invocation
  telemetry (`skill-trigger.service.ts:996`); it also pauses the spec harvest. Memory settings unchanged.
- **Triage applied:** cancelled TASK_2026_245, TASK_2026_536; rescope notes appended to TASK_2026_639_97f0,
  TASK_2026_624_d671, TASK_2026_637_e30b, TASK_2026_587_bffd, TASK_2026_611_8fe7.
- **Filed:** TASK_2026_660_c1ac (remove the pipeline after 14 quiet days), TASK_2026_661_6b5f (skill value metric, Gate 0).
- **Pending user answer:** merge TASK_2026_535 and TASK_2026_537 into TASK_2026_646_136a, and add `skillsLoaded`.
