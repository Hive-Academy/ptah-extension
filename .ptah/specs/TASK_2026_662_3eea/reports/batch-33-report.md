# Batch 33 report

## Files deleted and tests removed

- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.queue.spec.ts`: `skillSynthesis:queue` item listing, drain runs, per-stage spend, boundary validation, and failure tests.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.digest.spec.ts`: `skillSynthesis:digest` and `allowRewrite` tests.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.activity-feed.integration.spec.ts`: live push versus snapshot poll and trigger-toggle integration tests.

## Files changed and tests removed

- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.handlers.spec.ts`: removed `skillSynthesis:diagnostics` snapshot/activity tests; lane-key parity and `getLanes`/`setLanes` tests; candidate summary judge/gate projection tests; `listSuggestions`, `acceptSuggestion`, `dismissSuggestion`, `getSuggestion`, and `updateSuggestion` tests; and user-initiated `promote`, `promoteBulk`, `runCurator`, and `digest` lane tests. Removed lane imports, the now-unused digest helper parameter, and stale references to the deleted queue spec. Library coverage for clones, invocation stats, pause, telemetry, manual generation, enhancement, scorecards, history, and settings remains.
- `libs/backend/rpc-handlers/src/lib/handlers/skills-synthesis-rpc.schema.spec.ts`: removed `SkillQueueParamsSchema`, drain/budget and empirical-gate setting tests, suggestion-size boundary tests, and `SkillGetLanesParamsSchema`, `SkillLaneSchema`, and `SkillSetLanesParamsSchema` tests and imports. Retained clone, invocation, enhancement, pause/settings, scorecard, quarantine, and agent-model schema coverage.

The parity block compared all 32 dotted lane keys (`SKILL_LANE_KEYS`) and their defaults (`SKILL_LANE_DEFAULTS`) against platform-core file-based settings, including inherit defaults and absence of stray keys. It was in `skills-synthesis-rpc.handlers.spec.ts:2440-2501` before deletion. The cited `handlers.spec.ts:2192-2219` is a scorecard test, not that block.

## Decisions

- `libs/backend/rpc-handlers/src/lib/host-profile/host-profile.ts` had no lane-key parity block. It was left unchanged, preserving the `skillSynthesis` capability.
- Handler source and RPC methods remain for the later atomic contract contraction. The full required settings fixture remains because the current schema still requires its keys.
- No test, typecheck, lint, build, serve, or e2e command was run, as instructed. Static reads only.

## Clarifications Needed

none
