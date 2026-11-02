# B14 lane report

## Files changed

- `libs/frontend/chat/src/lib/utils/subagent-tool-count.ts`: Added the current-source maximum with finite host validation and recursive displayed-tool counting.
- `libs/frontend/chat/src/lib/utils/subagent-tool-count.spec.ts`: Covered maximum selection, nested tools, the 3 → 2 → 3 lag-and-trim sequence, and non-finite host values.
- `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.ts`: Uses the utility and labels the existing count span `Current known count`.
- `libs/frontend/chat/src/lib/components/organisms/execution/subagent-tile.component.spec.ts`: Updated the host-floor expectation and asserted the title.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.ts`: Uses the utility for tool stats, labels the existing count span, and reads the shared second clock for running duration.
- `libs/frontend/chat/src/lib/components/organisms/execution/inline-agent-bubble.component.spec.ts`: Added title and running-duration regressions with a controllable clock stub.

## Verification

Required lane check: `npm run verify -- -t test -p @ptah-extension/chat -- --testPathPatterns="subagent-tool-count|subagent-tile|inline-agent-bubble" | Select-Object -Last 60`

Final lines:

```text
[verify 2026-10-30T21:43:56.536Z] lock slot 1 acquired after 203s: verify test (@ptah-extension/chat)
 NX   1 task: 1 succeeded
 Run duration:      8.4s
 Cache:             0/1 hit (0%)
[verify 2026-10-30T21:44:13.367Z] lock released after 16.8s, exit code 0
```

The first run found a test assertion against the count span while the bubble showed its Streaming badge. The assertion was moved to a completed bubble; the next two lane checks passed. Scoped `ptah_get_diagnostics` was attempted after edits, but its TypeScript compiler timed out after 45 seconds and returned no diagnostic result.

## Decisions

- **Displayed source:** Use the execution-store tree when populated, otherwise the node's children. Both components already use that displayed-tree rule. Alternative: count both trees; that would double-count the same tools. Reversible.
- **Clock activity:** Subscribe while the record is `running` or `pending`, matching the existing `agentRunDurationMs` running flag. Alternative: subscribe only for `running`; that would leave pending durations stale. Reversible.
- **Count label:** Keep the existing `N tools`/`N tool` text and badge placement; add only the requested title attribute. The existing template chooses the Streaming badge while active. Reversible.

## Not done

- No rendered screenshot: the only permitted verification command was the scoped lane check, and this Angular component cannot be rendered as an in-workspace HTML file.
