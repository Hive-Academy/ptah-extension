# Batch 1, lane S — backend implementation report (TASK_2026_380)

Tasks 1.4 (component 6) and 1.5 (component 7). Both complete. No commit made,
no `nx` target run, no file touched outside the two task file lists.

All paths below are in the worktree
`D:/projects/ptah-extension/.claude-worktrees/electron-cold-start-380`.

---

## Files changed

### Task 1.4 — skill boot-scan deferral + settings keys

- MODIFIED `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.service.ts`
  — `start()` now ARMS the boot scan instead of running it. Adds exactly the
  named set and nothing else: fields `bootScanTimer` and
  `lastActivityAt: number | null`, methods `scheduleBootScan`,
  `readBootScanDelayMs`, `readBootScanIdleBackoffMs`, `readPositiveMs`, and one
  activity stamp line. **No constructor change** — the 17-argument positional
  constructor is byte-identical.
- MODIFIED `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.ts`
  — `SKILL_TRIGGER_KEYS.bootScanDelayMs` /
  `.bootScanIdleBackoffMs` (`skillSynthesis.triggers.*`) plus both defaults
  (300 000 each). Deliberately absent from `SKILL_TRIGGER_PREFIXES`,
  `PopulatedSkillTriggers` and `readSkillTriggers`.
- MODIFIED `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger-config.spec.ts`
  — new `describe` block: key names, defaults, DTO-surface exclusion (asserted
  against `SKILL_TRIGGER_PREFIXES`), and that `readSkillTriggers`'s return shape
  did not grow.
- CREATED `libs/backend/skill-synthesis/src/lib/triggers/skill-trigger.boot-defer.spec.ts`
  — six cases, modelled on `memory-trigger.boot-defer.spec.ts` including its
  `tick` / `advance` / `advanceUntil` helpers and
  `jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate'] })`. The
  observable is `SkillSynthesisService.enqueueAnalyze` call count (the memory
  spec watches `curator.curate`), driven through the REAL `BootScanRunner` over
  a real temp sessions directory.
- MODIFIED `libs/backend/platform-core/src/file-settings-keys.ts`
  — both keys added to `FILE_BASED_SETTINGS_KEYS` **and**
  `FILE_BASED_SETTINGS_DEFAULTS`, with a comment recording that the
  memory-curator pair's absence from both tables is a latent write-dropped bug
  rather than a precedent.

### Task 1.5 — SKILL.md rescan policy + marker diagnostics

- MODIFIED `libs/backend/skill-synthesis/src/lib/skill-md-migration.ts`
  — `SKILL_MD_MIGRATION_RESCAN_INTERVAL_MS` 24 h → `7 * 24 * 60 * 60 * 1000`
  with the justification in a docblock (the transform is one-time and
  idempotent; the ceiling exists only to pick up files edited outside Ptah, and
  a week-late pickup of a missing `when_to_use:` line is a degraded description,
  not a correctness failure; `SKILL_MD_MIGRATION_VERSION` still invalidates
  immediately). New exported `SkillMdMigrationMarkerOutcome` union;
  `MigrationResult` gains `markerOutcome` and `markerWritten`. `isMarkerCurrent`
  is now `readMarkerOutcome` and returns the token; `skippedByMarker` is derived
  as `markerOutcome === 'current'` and kept for wire compatibility; `writeMarker`
  returns whether it stored. Only `'current'` skips the walk.
- MODIFIED `libs/backend/skill-synthesis/src/lib/skill-md-migration.marker.spec.ts`
  — the `toEqual` on the full result updated; the seven-mutation ledger header
  extended with M8–M11; a new `markerOutcome` describe block with one case per
  token, each asserting the token together with the `readdirSync` /
  `readFileSync` counts, plus the throwing-`write` case
  (`markerWritten === false`, `errors: []`) and an M11 case pinning that a
  two-day-old marker is now `'current'`.

---

## Behaviour notes

- **Token mapping.** Seven false-returning paths, six non-`'current'` tokens.
  `read` threw and a `lastScanAt` that is not a finite number both map to
  `'unreadable'`: in both cases the row exists (or the store answered) and
  cannot be dated. Documented at the branch and pinned by two spec cases.
- **`markerWritten: false` is three facts** — walk skipped, walk errored so the
  write was refused, or `write` threw and was swallowed. Only the third is
  invisible in `errors`, which is why the field exists; the docblock says so.
- **`0` is legal** for both new settings keys (`readPositiveMs` falls back only
  on a non-finite / negative value), so `bootScanDelayMs: 0` restores the old
  immediate scan and `bootScanIdleBackoffMs: 0` ignores activity. Both pinned.
- **Teardown order** in `stop()`: clear the timer, null it, then abort the
  controller, then null `lastActivityAt` — mirroring
  `memory-trigger.service.ts:241-245`.
- The activity stamp is the FIRST statement after the blank-session-id guard in
  `onActivity`, above the `idleMs <= 0` early return.

## Verification

Single Jest spec files only, as instructed (no `nx`, no `typecheck:all`, no
`lint:all` — two other agents share this worktree).

| Command                                                                                                                 | Result                                                                                                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npx jest --config libs/backend/skill-synthesis/jest.config.ts libs/backend/skill-synthesis/src/lib/skill-md-migration` | 3 suites / 34 tests passed                                                                                                                                                             |
| `npx jest --config libs/backend/skill-synthesis/jest.config.ts libs/backend/skill-synthesis/src/lib/triggers/`          | 4 suites / 83 tests passed — includes `skill-trigger.service.spec.ts` and `skill-trigger.integration.spec.ts` **unchanged**, plus the new `skill-trigger.boot-defer.spec.ts` (6 cases) |
| `npx jest --config libs/backend/platform-core/jest.config.ts file-settings`                                             | 5 suites / 279 tests passed — includes the `DEFAULTS ⊆ KEYS` parity rule                                                                                                               |

ts-jest type-checks each spec's import graph, so `skill-md-migration.ts`,
`skill-trigger.service.ts`, `skill-trigger-config.ts` and `file-settings-keys.ts`
were all compiled by the runs above. A full `typecheck` / `lint` remains the
team-leader's single verification pass.

## Plan deviations

None of substance. Two judgement calls, both inside the plan's own wording:

1. The plan named seven `markerOutcome` tokens for "seven distinct
   false-returning paths". Six of those tokens are non-`'current'`, so two
   source branches share `'unreadable'` (see Behaviour notes). No token was
   invented and none was dropped.
2. The plan's spec brief said "one case per token asserting the token and the
   call counts". I added two cases beyond that set — the non-finite-timestamp
   variant of `'unreadable'`, and the M11 case proving a two-day-old marker is
   now current. The second is the only case that fails if someone reverts the
   interval constant, which is the change's whole point.

## Open questions / out-of-scope observations

- `libs/backend/skill-synthesis/src/index.ts:108` exports `type MigrationResult`
  but not the new `SkillMdMigrationMarkerOutcome`. Nothing outside this lib
  currently names the token type (the two `logger.info` call sites spread the
  whole object), and `index.ts` is not in my file list, so I left it. If a later
  batch wants to type a consumer against the union it is a one-line barrel add.
- `memory.triggers.bootScanDelayMs` and `memory.triggers.bootScanIdleBackoffMs`
  are still missing from BOTH `FILE_BASED_SETTINGS_KEYS` and
  `FILE_BASED_SETTINGS_DEFAULTS`, so a user write to either is silently dropped
  today. Out of this batch's scope (memory-curator is not in my file list);
  flagged here because the fix is two lines beside the two I added.
- The `skillSynthesis.triggers.turnComplete.enabled` and
  `.skillInvocationTelemetry.enabled` keys are likewise absent from
  `FILE_BASED_SETTINGS_KEYS` — same failure shape, noticed while editing that
  block, not touched.
