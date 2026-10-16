# Gate 1 requirements re-review — round 2

**Verdict: REVISE — 6/10.** The four round-one findings are repaired, but the new single-message exception in criterion 5.6 still drops a retained duration value. The specification is more complete than the 5/10 round-one version; a serious parity defect prevents a sound 7/10 or approval.

## Round-one findings

| Round-one finding | Status | Evidence |
| --- | --- | --- |
| 1. Per-message metrics lost | **Partly fixed** | `task-description.md:316-324` adds message-order rows with each message's tokens, cost and duration for turns with multiple assistant messages; `parity-inventory.md:54,57-58,115-116` maps B-8/B-11/B-12 to that panel. The single-message exception at `task-description.md:322` is incorrect for duration (new finding 1). |
| 2. Two definitions of duration end `E` | **Fixed** | `task-description.md:121-128,136-139,163-166` uses only assistant `timestamp + duration` and expressly excludes CLI, sub-agent and background-command completion; `decisions.md:22` records the settled rule. |
| 3. T1-27/F9 uncheckable | **Fixed** | `task-description.md:234-265` quotes F9 and states checks (a)-(d); `:267-278` maps F6-F12. The quotation matches `TASK_2026_629_c0b3/code-style-review-R9-phase.md:120-124`. The cited defects are present at `subagent-tile.component.ts:64,75,80` and `background-agent-strip.component.ts:123-124`: inferred `status`, duplicate label lookup, non-null assertions and the strip's `In background` label. |
| 4. Inspector default versus toggle | **Fixed** | `task-description.md:333-355,542-546` defines defaults, a closable full-mode dock, per-tab in-memory manual choice, reset on mode change and narrow-overlay behavior; `decisions.md:23` records the decision. |

## New findings

1. **Serious — A single assistant message's duration is still lost.** `task-description.md:310-315` defines the panel summary's `Duration` as the requirement 1 turn elapsed value, `E − S` (`:121-125,133-135`). Criterion 5.6 at `:316-323` shows `message().duration` only when there are multiple assistant messages, claiming that a single-message summary already equals the message values. It need not: if the user timestamp is 10:00:00, the one assistant message starts at 10:00:03 and lasts 2 seconds, the summary is 5 seconds while today's B-12 badge is 2 seconds (`message-bubble.component.html:181-182`). `parity-inventory.md:58,115-116` nevertheless says B-12 loses no granularity. **Fix:** Show the single message's own duration in the activity panel, distinct from turn elapsed duration, whenever it is known; or make the breakdown apply to single-message turns too. Correct criterion 5.6 and B-12's inventory row so the retained value has an exact, reachable location. Do not call turn elapsed duration equivalent to `message().duration`.

## Removals and visibility changes for the user

- **Proposed removals:** none (`parity-inventory.md:111-116`). This review makes no removal decision.
- **B-8/B-11/B-12:** cost, token and duration badges move behind `Show activity`; per-message rows are specified for multi-message turns (`parity-inventory.md:122-124`). Finding 1 identifies the missing single-message duration.
- **B-16:** time and `You` appear on hover/focus or without hover capability; the inbound peer label remains visible at rest (`parity-inventory.md:125-126`).
- **B-14/B-15:** Branch and Rewind keep hover reveal and gain focus reveal (`parity-inventory.md:127`).

## Five logic questions

1. **Silent success:** the panel displays a plausible elapsed `Duration` while omitting the one message's duration (finding 1).
2. **Unexpected user action:** opening `Show activity` on a single-message turn does not reveal the old duration badge's value (finding 1).
3. **Wrong answer from input data:** a gap between user and assistant timestamps makes `E − S` differ from `message().duration` (finding 1).
4. **Dependency failure or malformed data:** absent message timestamps or durations have the bare `Worked` fallback (`task-description.md:144-146`); no new round-two dependency failure was found in the reviewed scope.
5. **Missing requirement:** the single-message activity panel needs an explicit place for the message's own duration (finding 1).

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Treat turn elapsed and per-message duration as different retained values, including for one-message turns. | Accept elapsed as a replacement; expose both values. | `task-description.md:121-125,310-323`; `message-bubble.component.html:181-182`; `parity-inventory.md:58`. | Yes; removal of a capability remains user-reserved. |
| Accept the settled `E` and inspector rules for this review. | Reopen them; use decisions rows 18-19. | `decisions.md:22-23`; `task-description.md:121-128,333-355`. | Yes. |

This was a document and cited-code review; no checks were run. The review did not assess the parallel design-spec revision or implementation behavior.
