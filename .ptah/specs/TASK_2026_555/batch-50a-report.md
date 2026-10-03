# Batch 50a report: Search & Voice density, map §3.2 fold enforced (TASK_2026_555, track B)

Author: in-process frontend-developer (Advanced / Search owner). Worktree
`D:\projects\ptah-extension\.claude-worktrees\task-555-advanced-search-voice`, on top of `4fad78694`. No git commands
that write, no `batches.md` edit.

**Status:** both hosts and both themes meet the fold budget, and it is now enforced. Gate G 9/9. Scene spec 24/24 with
`--repeat-each=3`.

## 1. Files

| File | Change |
|---|---|
| `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.ts` (627 → 635 lines) | Provider rows made compact (section 2) |
| `libs/frontend/chat/src/lib/settings/ptah-ai/web-search-config.component.spec.ts` | +2 cases, +1 assertion (section 4) |
| `libs/frontend/webview-e2e-harness/src/lib/scenarios/settings/settings-advanced-search-voice.e2e.spec.ts` | `SEARCH_VOICE_FOLD_ENFORCED = true` (line 101); the ratchet comment now records the before and after numbers |

`voice-config.component.ts` was not changed. The voice rows fall within budget once the web search card is shorter.

## 2. What changed in the web search matrix

- **Provider cell**:
  - Line 1: the name.
  - Line 2: only the free-tier sentence plus the `Get API key` link, set to `whitespace-nowrap`. This is the clamp the
    pattern map asks for in §3.2.
  - The provider summary ("Google Search API. Fast, reliable results.") moved into the cell `title` (summary + free
    tier) and an `sr-only` span after the name, so screen readers still announce it.
  - `PROVIDER_OPTIONS.description` is split into `summary` and `freeTier`. The visible copy "Free tier: N
    searches/month." is unchanged.
- **Actions**: `Update key` / `Set key` and `Clear` sit in one `flex-nowrap` row. The Clear inline confirm moved out of
  that row and now opens below it (`mt-1.5`). Its behaviour is unchanged:
  - it confirms before clearing, with no Undo, and Cancel takes focus when it opens;
  - Esc and Cancel close it and return focus to Clear. Because the Clear button and the confirm now render in sibling
    blocks, the template ref `#clearBtn` can no longer reach the button. `cancelClear(provider)` finds it by its testid
    inside the component host instead.
- **Unchanged**: every testid (`settings-toggle-web-search-provider-<id>`, `-key-status-`, `-status-`, `-key-btn-`,
  `-clear-btn-`, `-clear-group-`, `-clear-confirm-`, `-clear-cancel-`, `-signup-`), Clear's aria-label, `text-base-content`
  on the text, and the Batch 45/45b behaviour (DOM checkbox and slider set back after a save, D15 fixed sentences).

## 3. Measurements (1024×768, px; fold line 660)

| Host / theme | Provider rows before (B49) | Provider rows after | Web search bottom before → after | Voice rows bottom before → after |
|---|---|---|---|---|
| vscode / anubis | 41, 41, 41 | 41, 41, 41 | 383 → 383 | n/a |
| vscode / anubis-light | **63**, 41, **63** | 41, 41, 41 | 427 → 383 | n/a |
| electron / anubis | **63, 57, 63** | 41, 41, 41 | 499 → 439 | **686** → 626 |
| electron / anubis-light | **63, 57, 63** | 41, 41, 41 | 499 → 439 | **686** → 626 |

Map §3.2: **PASS in all four** (rows ≤ 48, web search card ≤ 660, Electron voice rows ≤ 660, nothing scrolled). The
measurements were the same in all three repeats. The Advanced fold (§2.2) is unchanged: behaviour card bottom 436
(VS Code) / 532 (Electron).

## 4. Verification

| Check | Result |
|---|---|
| `npx jest -c libs/frontend/chat/jest.config.ts --maxWorkers=2` on web-search-config and voice-config | 2 suites, **59 passed**. New: one-line density case (title, sr-only summary, nowrap free-tier line, Update key + Clear in one nowrap row); Esc closes the clear confirm and returns focus to Clear; Cancel returns focus to Clear |
| `npx nx run-many -t typecheck,lint -p @ptah-extension/chat @ptah-extension/webview-e2e-harness --parallel=2` | "Successfully ran targets typecheck, lint for 2 projects" |
| `npx eslint` on the 3 touched files | 0 errors, **0 warnings** |
| `npx nx build ptah-extension-webview` | success |
| Gate G (`settings-reachability.e2e.spec.ts --workers=2`) | **9 passed (1.9 m)** |
| Scene spec, `--repeat-each=3 --workers=2` | **24 passed (1.4 m)**: captures and fold 12/12 (fold enforced), Esc 6/6 all pass, D15 6/6 all pass |

Captures: the scene run re-took the 40 Batch 49 capture names. Byte content changed in 15 of them; the rest are
identical. No other `current-*` and no `baseline-*` was touched; Gate G takes no screenshots.

## 5. Notes

- The light-theme VS Code rows were 63 px in Batch 49 because the long description wrapped once the actions column
  took its width. The single-line provider cell removes that wrap in both themes.
- Out of scope, not touched: none found.
