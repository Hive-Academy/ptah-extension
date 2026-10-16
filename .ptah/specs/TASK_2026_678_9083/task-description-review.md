# Gate 1 Review - task-description.md - TASK_2026_678_9083

- Author: codex CLI lane (project-manager role)
- Reviewer: in-process Claude subagent (independent cross-side reviewer)
- Artifact: task-description.md, revision 3
- Round: 2
- Scope: round-1 findings 1-10 only, plus a check that no new rule contradicts the 2026-10-15
  user correction (orchestrator = ordinary Ptah chat session, different UI only, main voice
  config, no ElevenLabs ConvAI).

## Verdict: **APPROVED**

All ten round-1 findings are resolved, including both Serious ones. No new rule brings back
ConvAI, a second LLM or a separate voice brain. Out of scope (line 25) and the Decisions table
(lines 95-96) still exclude them. The new rules (AC6, AC22-AC25, and Decisions lines 101-103)
add behaviour only to the Command Center surface and to the existing chat-session path. One
small reach into regular chat (AC25) is listed under Lane-introduced constraints as an item
for the user, not as a defect.

## Per-finding status

| # | Round-1 finding (severity) | Status | Evidence in revision 3 |
| - | --- | --- | --- |
| 1 | Permission and question prompts in voice mode (Serious) | Resolved | AC22 (line 58): the prompt is spoken and shown, and the node is marked as awaiting input. Questions can be answered by voice or UI and do not create a new chat turn. Tool approval needs an explicit on-page or keyboard action, and speech never approves. A visible actionable state prevents a silent stall. Risk row at line 44 includes a test for a misrecognised "yes". Decision at line 101. |
| 2 | TTS echo self-triggering (Serious) | Resolved | AC23 (line 59): Ptah's own audio does not create a turn or a false barge-in, while real speech is still accepted. Echo cancellation and noise suppression are requested at capture. Speaker and headset scenarios are both required. Risk row at line 45. Architect question 2 now covers echo. |
| 3 | What gets spoken (Moderate) | Resolved | AC24 (line 60): only bounded conversational text is spoken, with no tool output, code, diffs or long markdown. Full text stays in the compact view. A maximum spoken length is set before implementation. Risk row at line 46 adds a code-heavy test. |
| 4 | ElevenLabs cost per turn (Moderate) | Resolved | Risk row at line 49: narration deduplication, a spoken-length cap, local providers offered as the lower-cost option, and usage and cost assumptions recorded. It explicitly adds no cost guard, which is an accepted-risk position (see constraints). |
| 5 | Barge-in versus an in-flight turn (Moderate) | Resolved | AC6 (line 42): speech stops playback and queues the new utterance until the in-flight turn, including any tool call, completes. An explicit Stop calls `chat:abort` first. Decision at line 102. |
| 6 | Session cardinality and dual-driving (Moderate) | Resolved | AC25 (line 61): one active session per workspace, an explicit New action, and prior sessions kept for resume. Regular chat blocks competing sends while voice mode is active. AC16 (line 52) adds resume after restart. Risk row at line 52 and Decision at line 103. |
| 7 | AC10 and AC13 depended on LLM judgement (Moderate) | Resolved | AC10 (line 46) and AC13 (line 49) split into deterministic system projection plus a persona instruction checked by a manual voice scenario. |
| 8 | AC20 not testable until numbers exist (Minor) | Resolved | The new "Pre-implementation measurement gate" section requires the architect to record the workload, latency upper bound, N and refresh baseline. Architect question 5 adds the spoken-length limit. |
| 9 | Research tagged as `project-rule` (Minor) | Resolved | Lines 22, 26, 32, 38, 51 and 55 now use `evidence:`. AC7 keeps `project-rule` for `permission-policy.ts`, which is repository code, so that is correct. |
| 10 | Nav entry outside Electron (Minor) | Resolved | AC1 (line 37): the navigation entry is hidden outside Electron, and the route exposes no active page. |

## Residual notes (non-blocking, no revision required)

- AC6 queueing: during a long tool call, a barged-in utterance can wait a long time. The
  architect should make the queued state visible and spoken, for example "I'll get to that once
  the current step finishes", so the user knows they were heard.
- AC22 and AC25 touch existing chat behaviour: the pending-question answer path, and send-gating
  in the regular chat surface. The architect should confirm these reuse existing
  permission and question RPCs rather than adding a parallel approval path.

## Lane-introduced constraints

These are pm-proposed rules worth the user's attention:

- AC22 / Decision line 101: tool approvals cannot be given by voice in release 1. Voice can
  answer ordinary questions, but approving or denying a tool always needs a click or a key
  press. This is safer, but voice-only use is not fully hands-free.
- AC6 / Decision line 102: barging in does not cancel Ptah's current turn. It stops playback
  and queues the new request. Only an explicit Stop control aborts the turn.
- AC25 / Decision line 103: one active Command Center session per workspace. While voice mode
  is active, the same session opened in regular chat becomes read-only for sending. This
  changes regular chat behaviour slightly; the user asked for "different UI only".
- AC16: after an app restart, the page offers to resume the latest Command Center session.
- AC24: spoken replies are capped and exclude code and tool output. The architect sets the
  length limit.
- Risk line 49: ElevenLabs STT and TTS cost is accepted as unmetered in release 1. There is
  no cost guard, only deduplication, length caps and a pointer to local providers.
- AC12: narration includes lane or child "started" events as well as complete and fail.
  This may be noisy, given the user asked to "wait for updates".
- AC4 / Decision line 100: stop releases the mic, mute keeps the session, and there is no
  background listening after leaving the page.
- AC14: a fixed seven-state node vocabulary, with terminal nodes kept inspectable.
- AC9 and AC21: no automatic replay after a failure. A retry needs an explicitly identified
  action.
- AC20 and the measurement gate: "near real-time" stays unquantified until the architect's
  spike records the latency bound and N.
- AC17 and AC18: a text node list matching the canvas, plus full keyboard operation, are
  required for release 1.
