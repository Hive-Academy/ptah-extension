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

## Decision (2026-08-16, orchestration Checkpoint 0)

**Surface the per-tier caps, and include weekly.**

Rejected the other two options for stated reasons:

- _Derive_ re-couples what B0.10 split. `DRAIN_TIER_LIMITS`' own comment is the
  argument against it: raising the shared key applies the multiplier to the
  frequent tier 96 times a day, which nothing measured asks for.
- _Relabel only_ stops the display from lying but leaves the token-spending tier
  untunable from the UI.

The deciding observation, which the analysis above missed: **the panel already
exposes the per-tier cron trio** — `drain.cronExpr`, `drain.nightlyCronExpr` and
`drain.weeklyCronExpr` are all on the wire, with their own controls in
`skill-settings-panel.component.ts`. The item cap is the odd one out, not a new
precedent. Surfacing it makes the two halves of the tier config symmetric.

Weekly is in scope because `weeklyMaxItemsPerRun` (400) has the identical
defect — off the wire, invisible — and since Phase 3 the weekly tier carries
roughly two rows per eligible session. Fixing nightly alone leaves the same bug
behind under a different name.

Shape of the work:

1. `skills-synthesis-rpc.schema.ts` — add `'drain.nightlyMaxItemsPerRun'` and
   `'drain.weeklyMaxItemsPerRun'`. The schema-driven loop needs no handler
   change; bounds must admit the 40 / 400 defaults (the existing
   `.max(100)` on `drain.maxItemsPerRun` does NOT).
2. `libs/shared/.../rpc.types.ts` — the two dotted keys on
   `SkillSynthesisSettingsDto`. Flat and required, so both need form controls.
3. `skill-settings-panel.component.ts` + `skill-synthesis-tab.component.ts` —
   two number inputs; relabel the existing one to name the frequent tier.
4. Spec fixtures in both `.spec.ts` files, plus
   `apps/ptah-docs/src/content/docs/skill-synthesis/settings.md`.

`skillSynthesis.enabled` remains the stop switch and `maxTokensPerDay` remains
the only cost ceiling; these caps are throughput throttles, so exposing them is
not a safety question.

## Reference

- `libs/backend/skill-synthesis/src/lib/queue/skill-drain.service.ts` —
  `DRAIN_TIER_LIMITS`, and the two-pass `select()`.
- `libs/backend/platform-core/src/file-settings-keys.ts` — where the key is
  routed. An unrouted key fails in the **write direction only**, which is the
  failure mode this task's parent hit twice.
- `libs/backend/skill-synthesis/CLAUDE.md` — Drain semantics bullet.
