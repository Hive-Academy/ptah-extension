# CI fix 2 report

## Change

- Set the shared runtime spec profile to `workspace-write-no-network`, preserving the existing workspace-write mapping for the six failing CI cases. The level-change assertions now resolve and fingerprint that explicit mode.
- Added one runtime test that leaves the mode unset, changes turn levels through ask, auto-edit, yolo, and plan, and checks the app-server `turn/start` sandbox policy is full access for the first three and read only for plan.
- Changed only `libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`. No production bug was found: `resolveCodexLevelPolicy` applies the default, and `RuntimeContext.updateNextTurn` passes the profile mode through to it.

## Decisions

| Decision | Evidence | Reversible |
| --- | --- | --- |
| Keep the historical workspace-write assertions by making their fixture mode explicit. | The shared profile had a workspace-write policy but no `codexSandboxMode`; next-turn resolution therefore used the new full-access default. | Yes. |

## Verification

- `ptah_get_diagnostics` scoped to the changed spec: 0 errors, 0 warnings.
- `git diff --check`: passed (Git only warned about line-ending normalization).
- Focused Jest command: `npx jest --runInBand -c libs/backend/codex-runtime/jest.config.ts libs/backend/codex-runtime/src/lib/codex-runtime.spec.ts`. Result: 15 passed, 127 failed, 142 total. Local Windows `CodexHomeMismatchError` prevents many cases from reaching their assertions.
- Targeted Jest run for the six named CI cases plus the new default test: 7 failed, 135 skipped. Each of the seven failed at `CodexAppServerProcess.initialize` with `CodexHomeMismatchError`; none reached the sandbox policy assertions. Thus 0 of the six CI cases passed locally, and this Windows run cannot establish their CI result.

## Remaining limitation

Rerun the focused spec in CI or an environment where Codex home verification succeeds to confirm the seven policy assertions.
