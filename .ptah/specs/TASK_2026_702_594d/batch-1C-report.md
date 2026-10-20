# Batch 1C — notice assets

## Files changed

- `libs/frontend/ui/src/lib/native/brand-mark/aurora-notices.txt` — copied byte for byte from `prototype/aurora-notices.txt`; includes Omnedia's 2024 copyright and the complete MIT permission, conditions, and warranty text.
- `apps/ptah-extension-vscode/project.json` — added a root-output asset beside `brand-icons-notices.txt` in `build-esbuild`.
- `apps/ptah-electron/project.json` — added a root-output asset beside `brand-icons-notices.txt` in `build-main`.
- `apps/ptah-electron/electron-builder.yml` — added `aurora-notices.txt` to `extraResources` beside the brand-icon notice, targeting `resources/aurora-notices.txt`.

## Reference census

`rg -l --hidden --no-ignore -F 'brand-icons-notices.txt' --glob '!**/node_modules/**' --glob '!**/.git/**' .` found these 13 files:

| Reference | Treatment |
| --- | --- |
| `apps/ptah-extension-vscode/project.json` | Mirrored the asset entry. |
| `apps/ptah-electron/project.json` | Mirrored the asset entry. |
| `apps/ptah-electron/electron-builder.yml` | Mirrored the `extraResources` entry. |
| `scripts/brand-icons.manifest.json` | Brand-icon generator output path; Aurora is hand maintained per implementation plan, so no parallel generated output. Out of batch scope. |
| `libs/frontend/ui/src/lib/native/provider-mark/provider-marks.data.ts` | Comment about provider art, not a packaging or scanner rule; left unchanged. |
| `libs/frontend/ui/src/lib/native/brand-mark/provider-brand-art.vendored.ts` | Comment about provider art, not a packaging or scanner rule; left unchanged. |
| `libs/frontend/ui/src/lib/native/brand-mark/brand-marks.vendored.ts` | Generated brand-icon source comment; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/task-description.md` | Specification reference; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/task-description-review.md` | Review reference; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/implementation-plan-review.md` | Review reference; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/design-spec.md` | Design reference; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/design-spec-review.md` | Review reference; left unchanged. |
| `.ptah/specs/TASK_2026_702_594d/decisions.md` | Decision record; left unchanged. |

No separate scanner or notice-check file explicitly listed `brand-icons-notices.txt`. The existing `scripts/brand-icons/scanner-tokens.mjs` exports `findScannerTokens`; it requires no file-list change. The Electron `files` exclusions do not match `aurora-notices.txt` (`NOTICE*` is prefix based). `apps/ptah-extension-vscode/.vscodeignore` has no matching text-file or notice exclusion.

## Verification

- `node --input-type=module -e ...`: both project JSON files parsed; each asset list contains both notice entries; new notice equals prototype byte for byte; `findScannerTokens` returned `[]`.
- `node -e ...`: `yaml` parsed `electron-builder.yml`; `extraResources` contains both notice entries.
- `ptah_get_diagnostics` after edits: unavailable for these JSON, YAML, and text files (`No requested file could be checked`; clean coverage, analyzed 0).
- No Nx, Jest, build, package, or installer inspection was run, as requested. Package contents remain a release-time gate under `task-description.md` requirement 11.

## Decisions

- **Keep Aurora notice hand maintained.** Options were a new brand-icon manifest output or a static file. The implementation plan's “Notice attribution and selector migration” section explicitly says to hand-maintain it; copying the prototype preserves the approved text. Reversible by changing the source process later.
- **Use a separate asset entry and `extraResources` copy.** Options were widening the existing glob or mirroring its entry. Plan row 1C and the existing packaging pattern favor an explicit entry in each file, with no change to other assets. Reversible.

## Anything not done

- No package artifact was built or inspected; that is assigned to the release owner.
- Existing review documents, generated icon comments, and the brand-icon manifest were outside batch scope and did not require mirroring.
