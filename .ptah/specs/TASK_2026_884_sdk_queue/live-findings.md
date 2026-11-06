# Live Electron run findings (Haiku 5.5, real Claude backend)

Spec: apps/ptah-electron-e2e/src/specs/chat/live-follow-up-queue.spec.ts (PTAH_E2E_LIVE=1).
Screenshots/history dumps: .ptah/specs/TASK_2026_884_sdk_queue/live/.

Prompt 1: "Use the Bash tool to run the command: sleep 25. Then reply with exactly: FIRST-DONE".
While it runs, the follow-up "Reply with exactly: FOLLOWUP-ONE" is sent (UI shows
"Queued for the next turn"). Then a new tab hides tab 1.

## Defect 1 — Claude follow-up enters the turn before turn 1 ends (ordering)
Run 3 (screenshot 05): history = user prompt 1 ... user FOLLOWUP-ONE, then ONE assistant
block that contains turn 1's final text ("The sleep 25 command was blocked ... not sending
FIRST-DONE") AND "FOLLOWUP-ONE".
Run 4 (05-history.json): user prompt 1; assistant [tool only: Bash sleep, no final text];
user FOLLOWUP-ONE; assistant [continues turn-1 work: starts sleep in background, explains,
...]; assistant "FOLLOWUP-ONE".
In both runs turn 1's final assistant text appears AFTER the follow-up bubble. Expected:
prompt 1, complete reply 1 (incl. its final text), follow-up, reply 2.
Hypothesis: session-stream-pump releases the held follow-up into the SDK input stream at a
message/tool boundary (turnInFlight cleared too early, e.g. on assistant message end or
tool result) instead of on the turn's terminal `result` message, so the SDK folds it into
the running turn. Contract says Claude = deliver as the NEXT turn.

## Defect 2 — hidden tab card shows "Error" (intermittent)
Run 3 (screenshot 04): while tab 1 is hidden and its backend turn + follow-up complete,
the tab's rail card shows data-state="error" / "Error". After the user selects the tab,
it shows "Done". Run 4 did not reproduce. Renderer hidden tabs only get a statusOnly
terminal turn_state; something maps a hidden-tab terminal/queue transition to error.
