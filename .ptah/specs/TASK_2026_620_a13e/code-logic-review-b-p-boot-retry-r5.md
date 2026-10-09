# B-P boot/retry review — round 5

Reviewed `8e25a6df6`.

## Finding status

1. **CLOSED — r4 serious: a boot that joined a failed start could start the skill trigger.**  
   The shared outcome contract explicitly reserves `failed` for a caller joining a rejected run (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:198`-`:204`, `:398`-`:425`). Thoth now returns before trigger startup for either `abandoned` or `failed` (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:457`-`:468`), and CLI applies the same guard (`libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:321`-`:326`). The new host tests cover the joined-failure case (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts:535`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:371`).

2. **CLOSED — recovery after an initial failure still starts the trigger.**  
   Both hosts subscribe before their initial call to `start()` (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:442`-`:447`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:316`-`:321`). A successful master-switch retry notifies those listeners (`libs/backend/skill-synthesis/src/lib/skill-synthesis.service.ts:543`-`:569`), which invoke the idempotent local trigger starter (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.ts:414`-`:436`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.ts:282`-`:306`). Both regression tests also fire the recovery callback and assert one trigger start (`libs/backend/thoth-runtime/src/lib/boot-thoth-runtime.spec.ts:504`-`:532`; `libs/backend/cli-engine/src/lib/bootstrap/thoth-runtime.spec.ts:350`-`:368`).

## Outcome × host sweep

| `SkillSynthesisStartOutcome` | Thoth runtime | CLI engine | Assessment |
| --- | --- | --- | --- |
| `started` | Starts, unless host aborts (`boot-thoth-runtime.ts:459`-`:468`) | Starts (`thoth-runtime.ts:321`-`:326`) | Correct; `onStarted` may already have started it, and the local ref guard prevents duplication. |
| `already-started` | Starts if this boot lacks a trigger ref | Starts if this boot lacks a trigger ref | Correct; the synthesis service is already running. |
| `paused` | Starts trigger for the owed resume boot scan | Starts trigger for the owed resume boot scan | Correct by the B-P paused-boot requirement. |
| `abandoned` | Does not start (`boot-thoth-runtime.ts:460`-`:465`) | Does not start (`thoth-runtime.ts:323`-`:326`) | Correct; `stop()` overtook boot work. |
| `failed` | Does not start (`boot-thoth-runtime.ts:461`-`:465`) | Does not start (`thoth-runtime.ts:323`-`:326`) | Correct; it is a joined failure. A later successful retry reaches `onStarted`. |

No remaining incorrect outcome mapping found.

## Tests run

| Command | Result |
| --- | --- |
| `npx nx test thoth-runtime` | `Tests: 104 passed, 104 total` |
| `npx nx test cli-engine` | `Tests: 223 passed, 223 total` |

## Verdict

**APPROVED** — the r4 failed-join trigger regression is closed, and all five start outcomes map correctly in both boot hosts.
