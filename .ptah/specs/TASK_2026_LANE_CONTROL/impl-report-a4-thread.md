# A4 thread implementation report

## Components

- `lane-transcript.component.ts` adds a communication list above existing transcript bubbles. Message bubbles, streaming, turn logs, and permission actions remain in place.
- `lane-thread-row.component.ts` renders attributed text, `<time datetime>`, sender icon, left accent, and a fixed-width receipt slot.
- `lane-event-row.component.ts/.html` adds attributed report and completion detail rows with Lucide icons, verdict copy, and the live parent signal. Existing report markdown and completion detail remain intact.
- `lane-thread.ts` maps timestamped raw messages and exact-id receipts into chronological entries. It does not guess a match by time.

## Decisions

- Exact receipt ID matching was chosen over timestamp matching because receipts do not carry message text or a transcript ID. Evidence: `AgentDeliveryReceipt` schema. Reversible when the contract adds a correlation ID.
- Report/completion detail stays in the existing lane event row because its `LaneEventRow.events` carries the payload, while the lane transcript input has only execution nodes and stream events. Reversible when the parent thread can supply the same events to the lane transcript.

## Accessibility and behaviour

- Both additions use a labelled list and named listitems, icon plus text, absolute time on hover, and `<time datetime>`. Waiting parent signal uses warning tone; receipt width is reserved.
- No timer, poll, animation, raw HTML, or new transport was added.
- The transcript and parent report rows remain separate surfaces, so this is not yet one unified chronological list containing all four sender/event kinds. The existing data contracts do not provide the report events to `LaneTranscriptComponent` or a reliable user/parent receipt correlation. This remains an unmet A4 requirement.

## Verification

- `npx ngc -p libs/frontend/chat/tsconfig.lib.json --noEmit`: passed, with pre-existing Angular warnings in other files.
- Focused Jest through `scripts/verify.mjs`: 6 suites and 44 tests passed after adding `AgentMonitorStore` test stubs. Jest reported a worker forced exit after completion.
- `ptah_get_diagnostics` scoped to changed files: unavailable after 45 seconds; `ngc` provided the type check.
- Opened `prototype/lane-control.html` in Ptah browser; opened `prototype/lane-thread-preview.html` and inspected dark and light captures. The preview shows requested vocabulary states with static sample data and does not prove Electron renderer wiring.
- Screenshots: `.ptah/screenshots/lane-thread-dark.png`, `.ptah/screenshots/lane-thread-light.png`.

## Skill availability

No skill-loading tool was listed for this lane. I read `.claude/skills/angular-frontend-patterns/SKILL.md` and `.claude/skills/frontend-design/SKILL.md` directly.
