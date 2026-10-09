# Code Style Re-review, Phase 2 — `TASK_2026_617` (fix commit c66722ee4)

## Summary

| Metric          | Value             |
| --------------- | ----------------- |
| Overall score   | 8.5/10            |
| Verdict         | APPROVED          |
| Blocking issues | 0                 |
| Major issues    | 0                 |
| Minor issues    | 3 (new, optional) |

Scope: `git show c66722ee4 -- . ":(exclude).ptah"` read in full for non-spec files (23 files in the stat; spec
files read only where they bear on a finding), plus `phase2-fix-backend.md` and `phase2-fix-frontend.md`. Nothing was
executed; pass results come from the fix reports. The commit also carries logic-review fixes (effort as a hint,
stdin backpressure, `-32000` wording, `grokModel` trimming). I read those for structure and consistency only.

## Per-finding table

| #   | Finding (phase 2)                                                    | Status                | Evidence                                                                                                                                                                                         |
| --- | -------------------------------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | Third copy of `probeModels` (Major)                                  | FIXED (see deviation) | New `cli-adapters/cli-stdout-probe.ts:25-70`; `grok-cli.adapter.ts:158-163` and `pi-cli.adapter.ts:239-242` delegate. Sync-throw guard now reaches Pi.                                           |
| 2   | Stale "six / seventh" prose in `agent-cli.ts`                        | FIXED                 | `agent-cli.ts:26,34-37,39,80-81,225-227,439,580`: count-free wording; the historical "six at the time" at `:26` is accurate.                                                                     |
| 3   | Profile imports policy; `mapEffortToGrok` exported                   | FIXED                 | `grok-acp-profile.ts` no longer imports `lane-spawn-policy`; forwards `options.reasoningEffort` (`:133-138`). `mapEffortToGrok` deleted; `lane-spawn-policy.ts:168-176` reuses `mapEffortToCli`. |
| 4   | Formatter churn in functional commits                                | NOT DONE, accepted    | Formatter-owned; to be noted in the PR body. This commit itself is tight (functional hunks only).                                                                                                |
| 5   | `ensureTokensFresh` accepted `{}` / arrays                           | FIXED                 | `grok-cli.adapter.ts:181-198`: non-null, non-array, non-empty object. The unverified `XAI_API_KEY` fallback is gone, and the catch now logs instead of swallowing.                               |
| 6   | `CLI_DISPLAY_NAMES` not exhaustive                                   | FIXED                 | `task-agent-discovery.service.ts:3,13`: `Readonly<Record<CliType, string>>` with `import type`.                                                                                                  |
| 7   | Router help strings hand-listed                                      | NOT DONE, accepted    | Preference only; `router.ts` unchanged and already contains `grok`.                                                                                                                              |
| 8   | `it.each` at `agent-process-manager.service.spec.ts:2624` omits grok | FIXED                 | List is `SYSTEM_CLI_TYPES` minus codex, copilot and cursor, so the next adapter is included automatically. The comment states the mock reports every CLI installed.                              |

## Deviation on finding 1: is the sibling file acceptable?

Yes. The stated reason is correct and verifiable: the adapter specs replace `spawnCli` with
`jest.mock('./cli-adapter.utils', ...)` (for example `grok-cli.adapter.spec.ts:24-33`). A helper defined inside
`cli-adapter.utils.ts` would call its own module-local `spawnCli` and skip that mock, so every Pi and Grok probe test
would need rewiring. Putting the helper in a sibling that imports `spawnCli` from the utils module keeps the seam
without any test change. The file name `cli-stdout-probe.ts` follows the `cli-adapter.*` / `cli-stderr-severity.ts`
naming in the same directory, it has its own spec, and the header comment records why it is not in the utils file.
That comment is the thing that prevents someone "tidying" it into utils later, so keep it. The helper is internal to
the adapters folder and rightly is not added to `cli-adapters/index.ts`.

Residual: opencode keeps its own multi-status `probeCommandOnce`. That is justified (it returns exit code and timeout
flags, which `probeCliStdout` does not), and the fix report says so.

## New observations (all Minor, none required)

1. `acp-session-handle.ts:473-478` (`const binding = entry.configId === 'model'`). The vendor-neutral runner now
   hard-codes the id `'model'` as the binding option. `model` is a standard ACP config category and the Grok error
   describer already keys on it, so this is acceptable, but if a second ACP vendor needs a different binding option,
   the right place is a profile hook (`AcpVendorProfile`), not a second literal in the runner.
2. `agent-rpc.handlers.ts:470-475,536`: only `grokModel` gets a `typeof` check and `.trim()`; the sibling
   `opencodeModel`, `piModel` and `antigravityModel` writes are unvalidated and untrimmed. The change is correct and
   safer than the siblings, but it makes Grok the odd one out. Consider applying the same treatment to the model
   keys together in a later cleanup, rather than leaving a single special case.
3. `grok-acp-profile.ts:50`: `AUTH_WORDING = /auth/i` is broad (it also matches "author", "unauthorized" and so on).
   It is paired with the `-32000` code and the Grok message wording, so a false positive is unlikely, but a word
   boundary (`/\bauth/i`) would state the intent more tightly.

## Pattern compliance (changed items only)

| Rule or convention                                         | Status | Evidence                                                                                                     |
| ---------------------------------------------------------- | ------ | ------------------------------------------------------------------------------------------------------------ |
| Reuse a shared helper at the third use                     | PASS   | `cli-stdout-probe.ts`; Pi and Grok delegate                                                                  |
| Adapter does not depend on the orchestration policy module | PASS   | import removed from `grok-acp-profile.ts`                                                                    |
| Exhaustive `Record<CliType, ...>` for display tables       | PASS   | `task-agent-discovery.service.ts:13`                                                                         |
| `import type` for type-only imports                        | PASS   | `cli-stdout-probe.ts:10-11`, `task-agent-discovery.service.ts:3`                                             |
| Logging via injected Logger, no env or argv                | PASS   | `cli-stdout-probe.ts` logs `command` and `error.message` only                                                |
| No `as any`, `@ts-ignore`                                  | PASS   | none in the diff                                                                                             |
| Barrel imports for `./acp`                                 | PASS   | unchanged                                                                                                    |
| Specs follow neighbours; new spec for the new unit         | PASS   | `cli-stdout-probe.spec.ts` (108 lines), transport and session-handle specs extended                          |
| Degradation audit                                          | PASS   | fix report records exit 0 after rewriting `ensureTokensFresh` (the frontend report's FAIL predates that fix) |

## Maintenance debt

- Introduced: one 70-line shared helper plus its spec; a per-entry "binding vs hint" branch in the ACP runner.
- Retired: two probe copies (about 60 lines), `mapEffortToGrok`, the adapter-to-policy import, and the `XAI_API_KEY`
  claim in code and docs.
- Net: down. The Grok lane is now smaller and closer to Pi and Codex than it was.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on structure; MEDIUM on runtime behaviour (not executed here; route the transport backpressure and
  the effort-as-hint logic to code-logic-reviewer, which the commit message indicates already covered them)
- Key concern: none blocking; the three Minor notes above can ride along with any later cleanup.
- What a 10/10 version would do differently: land the formatter reflow separately (finding 4, declined), derive the
  router help text from `CLI_AGENT_SELECTORS` (finding 7, declined), and apply the `grokModel` input validation to
  every `*Model` key together.
