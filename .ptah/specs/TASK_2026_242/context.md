# Context — the settings panel and the nightly item cap disagree

## How this surfaced

TASK_2026_180 batch B0.10 fixed a measured throughput defect: the nightly drain
tier was delivering ~1 row/night against ~30 sessions/day of demand, so the
`archaeology` stage would never have kept up and Phase 2 would have shipped
inert. The fix gave the nightly tier its own cap,
`skillSynthesis.drain.nightlyMaxItemsPerRun` (default 40), and made the deal
step repeat in rounds.

That key was routed through `platform-core`'s file-settings tables — which is
what makes it take effect and persist — but was deliberately kept off the
RPC/settings-panel wire.

## Why it was left

Putting it on the wire means adding it to `SkillSynthesisSettingsSchema` and the
shared DTO. That DTO is a **flat, required** map, so a field with no form
control is round-tripped blindly, and the change pulls
`skill-synthesis-tab.component.ts`, `skill-settings-panel.component.ts` and two
Angular spec fixtures into what was a backend-only batch. B0.10 was a
throughput fix approved off a measurement; widening it into the frontend would
have been exactly the scope creep the measurement existed to avoid.

## The actual defect

The Skills settings panel renders "Max items per run" bound to
`maxItemsPerRun` (4). Since B0.10, the **nightly** tier does not read that key —
it reads `nightlyMaxItemsPerRun`. So:

- A user who lowers "max items per run" to throttle background work does **not**
  throttle the nightly tier, which is the token-spending one.
- A user who raises it hoping to clear the archaeology backlog sees no change.

The displayed number is true for the frequent and weekly tiers and false for
nightly. That is worse than an absent control, because it reads as authoritative.

## What to decide

- **Surface both**, which is honest but exposes a knob most users should not
  touch, or
- **Relabel** the existing control to say it governs the frequent tier only, and
  leave the nightly cap as a file-settings power-user knob, or
- **Derive** the nightly value from the displayed one (e.g. a multiplier) so a
  single control governs both — simplest UI, least direct control.

Whichever is chosen, note that the **budget gate, not the item cap, is the real
cost ceiling** (`maxTokensPerDay`, default 2,000,000; archaeology at B0.10's cap
uses roughly 30% of it). The item cap is a throughput throttle, so exposing it
is not a safety question.

## Reference

- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts` —
  `DRAIN_TIER_LIMITS`, and the two-pass `select()`.
- `libs/backend/platform-core/src/file-settings-keys.ts` — where the key is
  routed. An unrouted key fails in the **write direction only**, which is the
  failure mode this task's parent hit twice.
- `libs/backend/skill-synthesis/CLAUDE.md` — Drain semantics bullet.
