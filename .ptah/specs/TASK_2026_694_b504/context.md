# Context - TASK_2026_694_b504

Follow-up of TASK_2026_691_1da5 (PR #753), recorded in
`TASK_2026_689_4d4f/context.md` section "Follow-up task".

## User decisions (2026-10-18)

- The Voice (Command Center) page always opens first on a start state, also when a Command
  Center tab is already open in this app run.
- The start state is simple cards for the latest sessions of the workspace (about the last 5),
  plus a button that opens the full sessions list, plus a button that creates a new session.
  User words: "the voice page opens first on a simple cards with all latest prev like the last 5
  or so and allow using the button sessions and a button to create new one".

## Problems this removes (today's `openOrResume()`)

`CommandCenterSessionCoordinator.openOrResumeInternal()`
(`libs/frontend/command-center/src/lib/model/session-coordinator.ts:55-145`) auto-picks the
active Command Center tab, else the last recorded session, else a new tab:
- the user cannot see or choose which session resumes;
- "This session is already open in another tab" and "Could not restore" failures occur before
  the user has chosen anything;
- the records keep only ONE last session per workspace
  (`libs/frontend/chat-state/src/lib/command-center-records.ts:98-111`), so older sessions are
  unreachable from the Voice page.

## Scope

1. Start state on the Voice page: up to 5 latest-session cards (name, relative time, provider
   mark if known, a "Command Center" marker for sessions that were Command Center sessions),
   a "New session" button and an "All sessions" button that opens the full list. Choosing a card
   or a list entry loads that session into a Command Center tab. An open Command Center tab is
   shown as the first card ("Current").
2. Persona voice rule: the persona (`libs/frontend/chat-state/src/lib/command-center-persona.ts:30`)
   gets a rule: start each reply with 1-2 plain spoken sentences that give the answer, details
   after. `toSpokenText()` (`libs/frontend/command-center/src/lib/voice/spoken-text.ts`) speaks the
   first 4 sentences / 600 chars of the last assistant message.

Out of scope: the canvas scene (renderer, sprites, layout, motion), S1 of TASK_2026_691
(separate PR after #753 merges).
