# Lane outcome verification harness

Run from the repository root with system Node. Use a disposable database path outside `~/.ptah`;
the seeder refuses a Ptah profile path.

```sh
node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-lanes.sqlite --seed 7 --profile skewed
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-lanes.sqlite --lane-ids codex,grok,antigravity --task-kind implement
```

`seed-lane-outcomes.mjs` flags: `--db` (required), `--seed`, `--lanes`, `--rows`, `--profile`
(`skewed`, the default, or `uniform`). `--rows N` scales the rows per lane and task kind. It uses
the repository migrations and replaces rows only in a database that has its `seed_meta` marker.
Behaviour is covered by `seed-lane-outcomes.spec.ts`.

`check-past-outcomes-live.mjs` makes no network call unless you pass `--live`. With `--live` it
sends a routing question to the decision-model endpoint (`--base-url`, `--model`). `--ab`
(which requires `--live`) sends the same question with and without `pastOutcomes` and prints the
result of each. Run the script with `--help` for the defaults.
