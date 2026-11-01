# B6 review fixes

## Findings and fixes

| Finding | Resolution |
| --- | --- |
| B-1 real internal identifiers | Rewrote `orchestration.json` with synthetic tasks, IDs, paths, model label, prompt, and lane output. Replaced the existing synthetic `toolu_` IDs throughout the scenario folder with `demo-call-` IDs so the requested identifier sweep is clean. Added post-sanitization replacement and an optional `--redact from=to` option to the converter. |
| M-1 hardcoded home path | `session-to-scenario.mjs` requires `--project-dir`; session state defaults to `PTAH_STATE_DIR` or `$HOME/.ptah/state`. |
| M-2 placeholders | Replaced visible sanitizer markers in all five scenarios with short synthetic output, keeping segment content and stdout aligned. The converter also replaces sanitizer markers after sanitization. |
| M-3 truncated text | Completed orchestration task and lane text. The converter emits short complete synthetic tasks and output; its fallback truncation ends at a word boundary with an ellipsis. |
| M-4 raw logs | Replaced usage counters, JSON dumps, and workspace analysis output with readable synthetic lines. |
| M-5 product name | Set the orchestration title to “PtahCode orchestration session.” |
| V-1 user bubble order | Deferred the on-send timeline timestamp shift until `PlaybackEngine.sent()`. Added a delayed-send runtime spec. |
| V-2 early tokens/cost | Added a revision 1 provisional `session:stats-live` at 800 ms to orchestration, tribunal-council, and multi-agent. Existing later snapshots remain. |
| V-3 context unknown | Added a typed `session:stats` result after the final assistant completion in each chat scenario and at 600 ms in command-center. Verified field names against `ResultStatsPayload` and `SessionStatsEntry`; after the coordinator expanded the scenario union, added required `modelUsage[].contextCapacity.providerId: null` to all five JSON fixtures and the converter. |
| Minor 1 missing RPC fixtures | Added `session:stats-batch` and `chat:running-agents` to orchestration. |
| Minor 4 duplicate lane labels | Kept CLI display names accurate and distinguished their tasks with complete, specific descriptions. |

The privacy scanner now rejects long `toolu_` IDs, `PR #` numbers, `.claude-worktrees/` paths, and `FIX_` codes. The spec covers each pattern, while all five scenario fixtures remain scan-clean. The coordinator's existing `credentialAssignment` and `secretShape` regex changes were preserved.

## Files changed

- `libs/web/landing/src/lib/live-demo/scenarios/{chat-tool-call,command-center,multi-agent,orchestration,tribunal-council}.json` and their five `.scenario.generated.ts` files
- `scripts/landing/session-to-scenario.mjs`
- `libs/web/landing/src/lib/live-demo/runtime/{playback-engine.ts,scenario-loader.ts,replay-runtime.spec.ts}`
- `libs/web/landing/src/lib/live-demo/scenario/{privacy-scan.ts,scenario-privacy.spec.ts}`
- `task-tracking/landing-live-demo/batch-b6-review-fixes.md`

## Verification

- `node scripts/landing/generate-live-demo-types.mjs --check`: passed.
- Requested scenario-folder sweep for `amun`, `/home`, `hive`, `abdallah`, `toolu_`, `PR #`, `worktree`, `CodeRabbit`, `github`, and `k3`: no matches.
- Strict sanitizer on `/tmp` copies of all five scenarios: passed with no scan findings. Reports had zero secret, PII, and path replacements after the final orchestration change. The sanitizer still reports synthetic output payload replacements and UUID remapping by design.
- `node --check scripts/landing/session-to-scenario.mjs` and `git diff --check`: passed.
- `npm run verify -- -p web-landing`: **passed** after a 796-second machine-wide lock wait. Output tail: `NX 3 tasks: 3 succeeded`; `Run duration: 42.2s`; `[verify 2026-10-31T21:36:29.602Z] lock released after 49.6s, exit code 0`.
- Scoped Ptah diagnostics before the coordinator's type addition showed ten generated scenario errors for `session:stats` plus seven unrelated sibling errors. The coordinator added that out-of-scope type; the completed `web-landing` verify confirms lint, test, and typecheck now pass.

## Unmet or out of scope

- The review's minor suggestion to add a stable `data-testid` and report a missing New session button requires editing `replay-bridge.entry.ts`, outside this lane's allowed files. The coordinator owns that follow-up.
- The host-page prompt-edit explanation and second Send behavior require section or bridge edits, outside this lane's allowed files.
- No changed demo build was available for a browser screenshot. `check-live-demo.mjs` needs built assets; build/serve/e2e targets were explicitly prohibited for this lane. Visual behavior is therefore supported by the runtime spec and data checks, not a new screenshot.
