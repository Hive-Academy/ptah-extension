# Context — TASK_2026_252

## What the user saw

Clicking **Start** on a Tasks board card opened a chat session, submitted
`/ptah-core:orchestrate TASK_2026_233`, and got back a single assistant turn:

> Unknown command: /ptah-core:orchestrate

0 tokens, $0.0000, 56.0s. The orchestration never ran. The board also offers
Start on cards sitting in **In Progress** and **In Review**, which already have
a run against them.

## Defect 1 — the command is plugin-namespaced and unresolvable

`TaskStartService.launchPrompt` hardcodes the namespaced form:

```ts
// libs/frontend/tasks-ui/src/lib/services/task-start.service.ts:117-119
const prompt = isolate ? `/ptah-core:orchestrate ${taskId}${ISOLATION_DIRECTIVE}` : `/ptah-core:orchestrate ${taskId}`;
```

That form cannot resolve. `CommandDiscoveryService` documents exactly why:
`SkillJunctionService` junctions skills into `.claude/skills/` and copies
commands into `.claude/commands/` at activation time specifically to avoid
"plugin-namespaced entries (e.g. ptah-core:orchestrate) that the SDK can't
resolve since plugins are not passed via the SDK query option"
(`libs/backend/workspace-intelligence/src/autocomplete/command-discovery.service.ts:173-178`).
The resolvable command is `/orchestrate`.

Fix: emit `/orchestrate <TASK_ID>` (isolation directive appended unchanged).

### Same dead string on adjacent surfaces

The namespaced form is copy-pasted across other user-facing surfaces. Same
bug, same fix — decide in the plan whether they ride along or split out:

- `libs/frontend/chat-ui/src/lib/molecules/setup-plugins/prompt-suggestions.component.ts`
  — 8 suggestion chips (`:190,195,200,213,223,292,315,330`). These are one
  click from the user, so they fail the same way.
- `libs/frontend/setup-wizard/src/lib/components/completion.component.ts`
  — 6 documentation code samples (`:138,145,227,237,247,263`) plus its spec
  assertion (`completion.component.spec.ts:163`).

Specs that pin the current (wrong) string and must move with the fix:

- `libs/frontend/tasks-ui/src/lib/services/task-start.service.spec.ts:59,80`
- `libs/frontend/core/src/lib/services/app-state.service.spec.ts:643,649`
- `libs/frontend/chat/src/lib/services/chat-store/task-prompt-bridge.service.spec.ts:66,75,87,99,122,136`
- `libs/frontend/chat/src/lib/components/molecules/chat-input/chat-input.component.spec.ts:513,520`

## Defect 2 — Start is gated on terminality, not on startability

Both layouts ask the wrong question. The card asks "is this task finished?":

```ts
// task-card.component.ts:669-671
const status = this.task().status;
return status === 'done' || status === 'cancelled';
```

and renders the isolate toggle + Start under `@if (!isTerminal())`
(`task-card.component.ts:400`). The row mirrors it with `group.terminal`,
computed the same way at `task-list.component.ts:806` and read at `:578`
(Start) and `:623` ("Start isolated" in the `⋮` menu).

Wanted: Start renders **only** for `backlog` and `blocked`. `in_progress` and
`in_review` get no launch control — the same treatment `done`/`cancelled`
already get.

Constraint from `libs/frontend/tasks-ui/CLAUDE.md` guideline 6: Start lives on
the card and the row and nowhere else, and the two layouts stay
interchangeable. So the predicate belongs in one shared place (alongside
`task-presentation.ts`, next to the status label/badge maps) rather than being
re-derived per layout — replacing the two independent `terminal` derivations
rather than adding a third condition beside them.

Open call for the implementer: whether the non-startable footer for
`in_progress`/`in_review` reuses the existing terminal "completed" footer or
gets its own affordance. The terminal footer currently renders a
done/cancelled label, so it cannot be reused verbatim.

## Verification

- Card in Backlog and Blocked: Start present. Card in In Progress / In Review /
  Done / Cancelled: absent. Same for the list layout, including the
  "Start isolated" menu action.
- Clicking Start submits `/orchestrate TASK_ID`, and the orchestration skill
  actually runs (non-zero tokens, workflow announced).

## Resolution

**Defect 1.** `task-start.service.ts` now interpolates an `ORCHESTRATE_COMMAND`
constant (`/orchestrate`) whose comment records why the namespaced form was
dead. Confirmed against the workspace itself: `.claude/commands/` holds
`orchestrate.md`, `review-code.md`, `review-logic.md`, `review-security.md` —
all un-namespaced, exactly as `SkillJunctionService` writes them.

The adjacent surfaces went with it, because a half-fix would have left the
sibling commands dead on the same panel: `prompt-suggestions.component.ts` had
twelve `ptah-core:`-prefixed commands, not eight — the four `/review-*` and
`/simplify` chips were failing the same way and were never in the report.
`/simplify` resolves as a built-in and has no file in `.claude/commands/`.
`completion.component.ts` (six samples) and the doc comments in
`app-state.service.ts`, `task-prompt-bridge.service.ts` and
`session-lifecycle-manager.ts` were corrected too.

`chat-input.component.spec.ts` was deliberately LEFT on `/ptah-core:…`: that
suite tests colon-namespace pass-through, so the string is the fixture the test
is about, not a claim that the command resolves.

**Defect 2.** `isStartableStatus` / `STARTABLE_TASK_STATUSES` in
`task-presentation.ts` is the one definition; the card's `isTerminal` and the
list group's `terminal` flag were REPLACED by it rather than joined by a third
condition. The card's `terminalIcon` generalised into `statusFooterIcon`, so the
two live statuses get their own glyph (`Loader`, `Eye`) instead of borrowing the
done/cancelled pair — this is the open call in the report, decided that way
because the existing footer's check/ban icons assert an ending those statuses
have not reached. The footer's colour bindings already muted everything that is
not `done`, so they were left alone.

**Gates**: `tasks-ui` 562 tests green (18 suites), `core`/`chat`/`chat-ui`/
`setup-wizard` 271 green, typecheck clean across all six touched projects,
lint 0 errors (the surviving warnings are pre-existing and in untouched files).
New coverage: all six statuses asserted on the card, four non-startable statuses
plus `blocked` asserted on the row.
