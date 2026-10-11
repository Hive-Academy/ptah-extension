# B-P boot/retry review — round 4

Reviewed newest commit `0c67b707a`.

## Finding status

1. **CLOSED — r3 serious: a joining `start()` could reset the stop guard and start the trigger after an abandoned run.**  
   `SkillSynthesisService.start()` now exposes the originating run's outcome: it returns `abandoned` when `performStart()` observes the lifecycle change after its migration await, and a joining caller returns the same `startRun` outcome rather than initiating a new run (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:380`, `:398`, `:413`, `:427`, `:436`, `:442`). Both boot paths reject `abandoned` before triggering (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:457`, `:462`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:321`, `:324`). Thus an abandoned first run, including a second caller that joined it, does not arm the trigger. A later independent `start()` is not constrained by a persistent stopped flag.

2. **SERIOUS — a boot caller that joins a failed start still starts the skill trigger.**  
   The `startRun` join branch returns the shared, never-rejecting outcome (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:398`); its rejection handler translates an underlying failure to `failed` (`:413`-`:421`). Consequently, if another caller began a run which fails and either boot is the joiner, that boot receives `failed` with `started` still false. Thoth excludes only `abandoned` before `startSkillTrigger()` (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:457`-`:464`), and CLI likewise starts for every outcome other than `abandoned` (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:321`-`:324`). It therefore starts a trigger for a failed synthesis service.

   The direct starter still receives the original rejection through `return await run` (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:406`, `:427`), but that does not protect a concurrent boot caller joining that run. The boot condition should positively admit only `started`, `already-started`, and `paused`; add coverage for a boot joining a rejected in-flight start.

3. **Checked — ordinary MCP-bench callers remain compatible.**  
   They await the result only for completion and do not rely on a `void` value (`tools/mcp-bench/src/memory-skills/suites/skills/funnel-host-graph.ts:560`, `:674`; `tools/mcp-bench/src/memory-skills/suites/skills/funnel-host-port.ts:286`). The widened resolved value is harmless for those calls.

## Tests run

| Command | Result |
| --- | --- |
| `npx nx test skill-synthesis --testPathPatterns="pause-resume|stage-handlers"` | `Tests: 60 passed, 60 total` |
| `npx nx test thoth-runtime` | `Tests: 103 passed, 103 total` |
| `npx nx test cli-engine` | `Tests: 222 passed, 222 total` |

## Verdict

**REVISE** — the abandoned-run regression is fixed, but both boot paths must avoid starting the trigger for a joined `failed` outcome.
