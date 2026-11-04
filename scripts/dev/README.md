# Lane outcome verification harness

Run from the repository root with system Node. Use a disposable path outside `~/.ptah`.

```sh
node scripts/dev/seed-lane-outcomes.mjs --db /tmp/ptah-lanes.sqlite --seed 7 --profile skewed
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-lanes.sqlite --lane-ids codex,grok,antigravity --task-kind implement
```

`--profile skewed` is the default. It writes 20 verified outcomes for every lane and task kind. The first three lanes have delivery rates of 90%, 50%, and 15%. `--profile uniform` retains equal counts for each verdict. `--rows N` scales the verified rows. The seeder also writes subagent, unverified, and older than 90 day rows. It uses the repository migrations and replaces rows only in a database with its `seed_meta` marker.

For the optional live check, start the `ptah-chappie-ollama.service` tunnel (warm ≈3.4 s, cold ≈17 s), then run:

```sh
node scripts/dev/check-past-outcomes-live.mjs --db /tmp/ptah-lanes.sqlite --lane-ids codex,grok,antigravity --task-kind implement --live --ab --base-url http://127.0.0.1:11435 --model d3:4b
```

`--ab` sends the same question twice, with and without `pastOutcomes`. It prints choice, probabilities, confidence, whether confidence clears the routing threshold, and latency for both. The checker makes no network call without `--live`.

For a separate Electron check, restart Ptah, confirm one `[lane-routing] route decided` INFO line with `timeoutMs` in `~/.config/Ptah/logs/Ptah Electron-YYYY-MM-DD.log`, then run a subagent and inspect its outcome row with a read-only SQLite query.
