# Agent pack download spec stability

## Root cause

`holdReads` stored resume callbacks in arrival order (`agent-pack-download.service.spec.ts:797-822`). The two A2 tests at lines 825-858 and 861-892 started independent service instances together, then released slot 0 and awaited instance `a`. The spec assumed slot 0 belonged to `a`, although the service maintains its target chain per instance (`agent-pack-download.service.ts:289-306`) and performs the initial `readLocal` before acquiring the shared destination write lock (`:319-355`). The mock pauses each completed `fs/promises.readFile` at `agent-pack-download.service.spec.ts:144-170`. If `b` reaches the mock first, slot 0 resumes `b`; `a` remains held, so awaiting `first` or `creator` times out. This is a spec scheduling race, not a production write bug.

I inspected every `holdReads`/`release[index]` use in this spec. The single-installer A2 case (`:898-921`) has only one slot. The two-replacer A2 case (`:924-963`) releases both slots before awaiting either result, so it cannot hang from the order swap; I also made its assignment of slots deterministic.

## Change

Only `libs/backend/platform-core/src/agent-pack-download.service.spec.ts` changed.

- Hunk near lines 793-822: add `firstHeld` to the gate and resolve it when the first destination read is held. Keep `allHeld` and both explicit release callbacks.
- Hunk near lines 834-850: await `firstHeld` after starting installer `a`, then start `b`; wait for `allHeld` before releasing slot 0, awaiting `a`, and releasing slot 1.
- Hunk near lines 870-885: establish the same ordering for creator `a` and replacer `b`.
- Hunk near lines 934-953: establish the same ordering for both replace installers; both reads remain held before either release.

All scenarios and assertions remain in place. No timeouts, retries, or sleeps were added.

## Reproduction

As a temporary probe, I moved the failing case's `replacer = b.installFiles(...)` before `creator = a.installFiles(...)` and removed that case's `await gate.firstHeld`. With the former slot assumption in effect, the scoped verify run produced 28 passed, 1 failed out of 29 tests. The failing test was exactly `a replace of a file deleted since the plan does not clobber a concurrent create`, with Jest's 5000 ms timeout. Elapsed wall time: 60.18 s. I restored the ordered-start fix after the probe; the final diff has no reversed-start code.

The first probe invocation rejected `--skip-nx-cache` before the passthrough `--`. The corrected form places it after the first `--`, as documented in `scripts/verify.mjs:8`. In this sandbox, Nx sockets require `NX_DAEMON=false NX_ISOLATE_PLUGINS=false`; Jest config loading also required `NODE_OPTIONS=--require=/home/amun/ptah-extension/node_modules/ts-node/register`. The run without that loader stopped before tests. These are command environment settings; no repository configuration changed.

## Stability runs

Command for each row, run from the worktree: `env NX_DAEMON=false NX_ISOLATE_PLUGINS=false NODE_OPTIONS=--require=/home/amun/ptah-extension/node_modules/ts-node/register npm run verify -- -t test -p platform-core -- --skip-nx-cache --testPathPatterns=agent-pack-download --json --outputFile=/tmp/agent-pack-stable-N.json --output-style=static`, with `N` replaced by the run number. The JSON results supplied the test counts; Nx reported cache skipped on each run.

| Run | Result | Tests | Wall time |
| --- | --- | --- | --- |
| 1 | Pass | 29/29 | 26.71 s |
| 2 | Pass | 29/29 | 37.58 s |
| 3 | Pass | 29/29 | 35.79 s |
| 4 | Pass | 29/29 | 19.01 s |
| 5 | Pass | 29/29 | 13.65 s |

`env NX_DAEMON=false NX_ISOLATE_PLUGINS=false npm run verify -- -t lint,typecheck -p platform-core` passed: 2 tasks succeeded, 18.65 s wall time. Scoped Ptah diagnostics reported zero errors or warnings after the edit. `git diff --check` passed.

## Decisions

- Use an explicit first-read milestone, then start the second installer. Other option: identify each caller in the mock. Evidence: the mock only sees a destination path, while the tests already control when each instance starts. This is a reversible spec-only change.
- Keep the two-replacer test's release order explicit even though it releases both before awaiting. Evidence: it documents the same paused-after-read scenario and makes slot ownership consistent across A2. Reversible.

## Open items

None for this spec. The first test attempt exposed sandbox-specific runner setup; the five counted runs used the verified command environment above.
