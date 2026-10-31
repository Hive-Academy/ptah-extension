# B10 lane report

## Files changed

- `libs/frontend/chat/src/lib/utils/lane-stats.adapters.ts`: Added `CliLaneUsage` and `resolveCliLaneUsage`. Host `usageTotals` takes precedence; retained segments are folded only when host totals are absent and are flagged partial. The stats bar now uses the resolver and shared token helpers.
- `libs/frontend/chat/src/lib/utils/lane-stats.adapters.spec.ts`: Covers host precedence, partial segment totals, exact and inexact counts, zero, and absent usage; existing `cliLaneStats` fixtures remain in place.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.ts`: Uses shared token validation when formatting optional counts. The existing `extractCliAgentStats` fold remains inside `usageTotalsFromSegments`.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/stats-bar.utils.spec.ts`: Covers invalid counts rendering as `—` while a reported zero remains `0`.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.ts`: Computes the shared resolver once per agent and uses its `partial` flag to prefix retained counts and cost with `≥` and show the partial title.
- `libs/frontend/chat/src/lib/components/molecules/agent-card/cli-lane-usage-summary.component.spec.ts`: Confirms missing data renders `—`; existing DOM fixtures cover `≥`, host precedence, cache labels, and the partial title.

## Lane check

Command (one foreground run):

`npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="lane-stats.adapters|stats-bar.utils|cli-lane-usage-summary" | Select-Object -Last 60`

Exit code: `0`. Tail:

```text
[verify 2026-10-30T20:11:41.495Z] lock slot 0 acquired after 281s: verify test (@ptah-extension/chat)

 NX   1 task: 1 succeeded

Re-run with --output-style=static to inline logs.

  Run duration:      6.8s
  Cache:             0/1 hit (0%)
  Critical path:     6.8s (1 task)
  Recoverable time:  <1ms
[verify 2026-10-30T20:11:54.659Z] lock released after 13.2s, exit code 0
```

## Decisions

- `tokensExact` records whether the source carried a `totalTokens` value; `partial` separately records retained-segment provenance. The stats bar marks either partial or inexact counts as a lower bound.
- A present but empty host `usageTotals` still wins over segments. With no valid token count, the resolver returns `null`, which renders as `—`.
- Applied `angular-frontend-patterns` from the workspace `SKILL.md`; this CLI had no skill invocation command, so the file was read directly.

## Not done

No implementation items remain. No browser screenshot was taken: this lane allows only the specified test command and forbids build/serve; the component DOM specs verify the rendered symbols and title.
