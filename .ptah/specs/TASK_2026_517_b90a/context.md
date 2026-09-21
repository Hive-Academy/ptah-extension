# Context — TASK_2026_517

## Why this exists

TASK_2026_511 closed the detection gap. A retention job that never completes
now computes a `never-completed` or `stalled` verdict, writes one warning to
the log, and renders a banner in the storage health panel.

That is still passive. The panel lives in the Electron Memory tab. A user sees
the banner only if they open that tab, and the original incident proved that
nobody opens it. The log line has the same weakness: it is there for whoever
reads the log.

The incident ran for months on a real install. The fault was readable the whole
time in two places. What was missing was something that came to the user.

## What was deliberately deferred

TASK_2026_511 offered three surfacing options. The banner was chosen, and an
active notification was explicitly ruled out of that task's scope so that the
detection could land first. This task is that deferred half.

## The decision this task must make first

Do not start building until the channel is chosen. The options differ in cost
and in blast radius:

- A host notification through the platform notification port. Reaches the user
  outside the Memory tab. Needs a de-duplication rule and a dismiss or snooze
  state, or it becomes noise the user learns to dismiss.
- A badge or dot on the Memory tab itself. Cheaper, quieter, and still requires
  the user to be looking at the window.
- A one-time message in the chat surface the user already has open.

Whichever is chosen, the suppression rule matters more than the channel. The
verdict is recomputed on every retention tick. A fault that re-announces itself
hourly trains the user to ignore it, which reproduces the original failure in a
new form.

## Constraints carried over from TASK_2026_511

- `never-completed` needs 72 counted attempts and a first attempt older than
  72 hours. The fault is already slow to raise, so the notification does not
  need its own delay.
- `unknown` means the state read threw. It must not raise a user-facing alarm.
  It is a diagnostic value only.
- `disabled` outranks every other verdict. A user who turned retention off must
  never be notified about it.
- The verdict already clears its log suppression on a healthy verdict. Any new
  channel should follow the same recovery rule.

## Out of scope

- Shipping the `scripts/` offline drain tool to users. It is repository
  maintenance, it appears in no `files` list, no `.vscodeignore` and no
  `electron-builder.yml`, and it must stay that way. A user on a packaged build
  with a large backlog is served by daily retention, not by a maintenance
  script.
- Any change to the verdict logic, the thresholds, or the attempt counter.
- Any change to retention budgets, gates or the governor.
