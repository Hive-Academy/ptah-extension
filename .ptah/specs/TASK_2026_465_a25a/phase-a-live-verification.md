# Phase A live verification — attempted, blocked on a stale host

Date 2026-09-20. Machine: `agy` 1.2.7, Windows 11.

## What was attempted

Confirm end to end that `ptah_agent_message` to a running antigravity lane
returns `queue-next-turn`, that `ptah_agent_list` agrees, and that the lane
still reaches `completed`.

## What the live host reports

`ptah_agent_list` on the running host:

| Agent | Status | Capability |
| --- | --- | --- |
| antigravity | installed | **messaging: none** |

On the landed code that answer is not reachable. `AntigravityCliAdapter.detect`
awaits `probeStreamJsonInput` and then reports
`bestMessagingCapability(this.capabilities())`; `capabilities()` returns
`continuation: this.streamJsonInputSupported === true`, and
`bestMessagingCapability` maps `continuation` to `queue`.

## The probe, run by hand against the installed binary

The probe is `agy --help` tested against `/--input-format\b/`
(`antigravity-cli.adapter.ts:357`). Run directly:

```
agy --version        → 1.2.7
agy --help           → 3,263 bytes
match /--input-format\b/ → True
```

The help text reads:

```
--input-format   Input format for print mode (text, stream-json). stream-json
                 reads one NDJSON message per line from stdin and runs a turn
                 for each; it requires --output-format stream-json
```

So the capability the adapter probes for IS present on this machine's `agy`,
and a host carrying the Phase A code would report `queue`, not `none`.

## Conclusion

The running Ptah host predates the PR #537 merge. Every live observation taken
from it would describe the pre-Phase-A build, which is why none was taken. This
is a stale-host block, not a defect in the landed code.

**To unblock**: rebuild and restart the host from `main` at or after
`32f28f79d`, then repeat the three observations above. Nothing in the code
needs to change first.

## Unchanged, and still unknown

The `--input-format` version floor. 1.2.7 has it; the first version that did is
not established here, and that is exactly why the adapter probes the binary
instead of comparing version strings. Do not replace the probe with a version
check on the strength of this one data point.
