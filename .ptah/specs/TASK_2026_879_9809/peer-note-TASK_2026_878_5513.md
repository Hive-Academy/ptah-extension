# Note for TASK_2026_878_5513 / TASK_2026_881_5b75 (undelivered: peer session unreachable 2026-11-04 ~23:35Z)

## Live evidence (Chappie d3:4b)

Setup: same request, two lanes with equal score 70, and the shipped lane instructions.

| pastOutcomes | codex p | grok p | confidence | result |
|---|---|---|---|---|
| none | 0.63 | 0.37 | 0.048 | below 0.5, falls back to ranking |
| codex 18/1, grok 2/15 | 0.999 | 0.001 | 0.989 | codex |
| codex 2/15, grok 18/1 | 0.010 | 0.990 | 0.921 | grok |

Verified outcome counts are the signal that lets the model decide. Real verdicts, not `unverified`, drive routing.

## Seeder

`scripts/dev/seed-lane-outcomes.mjs` on branch `fix/decision-model-data-gaps`.

- `--db <path>`: required. Anything under ~/.ptah is refused before the file is opened. An existing file must carry the seed_meta marker.
- `--seed <int>`, `--lanes a,b,c`, `--rows n`
- `--profile uniform|skewed`: skewed gives about 90/50/15% delivered.

The schema comes from the real persistence-sqlite MIGRATIONS, so your migration 0066 is applied on your branch.

Companion: `scripts/dev/check-past-outcomes-live.mjs --db <p> --lane-ids a,b --task-kind implement [--live] [--ab]`.

## Contract

See the message sent at Gate 2 (unchanged). Log line: `[lane-routing] route decided`, which now also carries `outcome: ok|error`.
