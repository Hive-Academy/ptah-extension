# Code Logic Review — `TASK_2026_593_7c2e` PR #804 correction

## Summary

| Metric              | Value      |
| ------------------- | ---------- |
| Overall score       | 8/10       |
| Assessment          | APPROVED   |
| Blocking issues     | 0          |
| Serious issues      | 0          |
| Moderate issues     | 0          |
| Failure modes found | 0          |

**Review family: grok (Grok 4.7).** Implementer family, as stated for this round: Ollama Cloud / Glm. Not re-derived from git.

Score 8, not 9: this lane did not re-run the spec, and the `blocked` arm of the repair is not reachable from the template. Score 8, not 7: both prior defects close on the lines that run, and the new `file.set` cannot take the new sha or the new bytes.

Scope: `reload` dirty branch `spot-editor.component.ts:806-820` and the two new tests `spot-editor.component.spec.ts:994-1060`. Callers, `canEdit`, `setEditable`, `FileViewReaderService.baseState` / `mapResult`, and `save` were read to check the correction. No re-audit of the clean post-save baseline.

## Decisions

1. The error-banner Retry trap is closed. Approve.
   - Options: (a) still serious, because `blocked` has the same `status !== 'fresh'` condition but no Retry control; (b) closed, because the serious path was the error banner.
   - Evidence: non-fresh `reload(true)` still `file.set`s the error and returns before `mountDocument` (`:822-826`). `modified` stays true. Retry is the button in the error banner only (`:301-314`, `:638-640`). The dirty branch now `file.set`s `{ ...current, status: 'fresh', failure: undefined }` (`:816-818`). `baseState` copies `sha256`, `encoding`, and `content` onto a failed refresh (`file-view-reader.service.ts:117-124`), and `not-found` is not blocked so `mapResult` keeps them (`:155-172`). `canEdit` needs `status === 'fresh'`, `encoding === 'utf-8'`, and `sha256` (`spot-editor.component.ts:431-439`). `setEditable` only reconfigures the editable compartment (`codemirror-setup.ts:259-264`). `save` sends `handle.text()` and `current.sha256` (`:722-739`). The spec asserts the banner is gone, the buffer is `const a = 1;\nx`, the dirty flag remains, and `expectedSha256` is `SHA_A` (`spec.ts:1026-1038`).
   - The blocked screen has no Retry (`:279-300`). `notifyDiskChange` returns when `status === 'blocked'` (`:594-596`). That screen is pre-existing and this branch is not how a user leaves it. Not charged.
   - Reversible: yes.

2. Raise-only `stale` closes the older-read clear, and it does not create a new lost update.
   - Options: (a) still moderate, because a same-sha read never clears `stale`; (b) closed.
   - Evidence: `:812` writes `stale` only when `result.sha256 !== current.sha256`. A second push while dirty only sets `stale` (`:601-603`). The spec holds a clean read, types, pushes again, then releases the baseline sha, and the banner stays (`spec.ts:1041-1059`). A same-sha Retry after a failed confirmed reload does not need a clear: `reload(true)` already set `stale` false before storing the error (`:822-824`).
   - Reversible: yes.

## Resolved

### Retry after a failed confirmed reload (was serious)

- Before: `reload()` with `modified` true returned at the dirty guard and left `status: 'error'`. `canEdit` stayed false.
- Now: a `fresh` result with `current.status !== 'fresh'` rewrites status on the captured tab state (`:816-818`). The object spread is `current`, not `result`, so `sha256` / `encoding` / `content` stay the loaded baseline. No `mountDocument`. A different sha still raises `stale` first (`:812`).
- CI path unchanged: a background read that started `fresh` does not enter the repair, does not `file.set`, and does not mount (`:811-820`).

### Older same-sha read clearing a newer push (was moderate)

- Before: the dirty branch assigned `stale` from `result.sha256 !== current.sha256`, so a match wrote `false`.
- Now: a match writes nothing (`:812`). A newer `notifyDiskChange` mark survives. The next save still sends the loaded hash (`:739`).

## Open findings

None in this correction.

## Five logic questions

### 1. How does this fail silently?

It does not on the repaired path. A `fresh` Retry no longer looks like another failed read: the error banner is `status === 'error'` (`:301-314`), and `:817` sets `fresh` and `failure: undefined`. The editor document is not replaced (`mountDocument` is not called; `setEditable` does not call `load`). A same-sha dirty apply no longer reports success by hiding a newer stale mark (`:812` does not write `false`).

A non-fresh Retry still changes nothing (`:811` skips the writes). The existing error banner stays. That is a failed read, not a success-looking result.

### 2. What user action produces unexpected behaviour?

None new. Edit, confirm Discard and reload, get `not-found`, click Retry, get a new sha: the error banner goes away, the editor is editable, the typed buffer stays, and the stale banner is up (`spec.ts:994-1032`). Save sends the typed text with `SHA_A` (`:1034-1038`).

Confirmed Discard and reload with `discardEdits` still skips this branch (`:806`) and mounts (`:822-828`). The test at `:976-991` still covers a fresh discard.

### 3. What input data produces a wrong answer?

A `fresh` body with a new sha does not become `file()` or the buffer. `:817` spreads the pre-await error state. `save` then sends that state's `sha256` (`:739`), so the host still sees the loaded baseline.

A `fresh` body with the same sha, after a push set `stale` during the read, does not clear it (`:812`, `spec.ts:1048-1057`).

Compared sha is `current` from `:796`, not `this.file()` after the await. On this path `file()` cannot move without a new `readSeq`: `save` cannot start while `canEdit` is false (`:717`), and another `reload` / `open` bumps `readSeq` so `:805` returns first.

### 4. What happens when a dependency fails?

`read` maps a bad RPC to `error` and copies the previous hash (`file-view-reader.service.ts:81-90`, `:117-124`, `:155-172`). In the dirty branch that result is ignored (`:811`). A failed Retry leaves the banner up.

`destroyed` or a newer `readSeq` still returns at `:805` before either new write. `setEditable` after a repaired status does not reload the document (`codemirror-setup.ts:259-264`).

### 5. What is missing that the requirements never mentioned?

Nothing that changes this verdict. The same-sha Retry (disk matches the loaded hash, so `stale` stays false) is not in `spec.ts:994-1060`; the source does the right thing because `:822` already cleared `stale` and `:812` does not set it. The `blocked` repair is untested and unreachable from the UI (decision 1).

## Failure modes

No new failure mode in `:806-820`.

Reviewed and closed: failed `reload(true)` then Retry (`:673` or `:711`, then `:638-640`, then `:811-818`); same-sha read after a later push (`:601-603`, then `:812`).

Traced and not charged: non-fresh Retry; `saving()` true with `current.status === 'fresh'` (no `file.set`); `discardEdits`; superseded read at `:805`.

## Blocking issues

None.

## Serious issues

None.

## Moderate and minor issues

None.

Not charged, and not introduced here: a `reload(true)` result of `blocked` still has no Retry control (`:279-300`). `notifyDiskChange` will not call `reload` (`:594-596`), so `:816-818` never runs for that screen.

## Data flow

1. Failed `reload(true)` — unchanged. Skips the dirty guard, clears `stale` and `saveError`, `file.set(result)`, returns on non-fresh (`:822-826`). `modified` stays true.
2. Retry — `reload()` default (`:638-640`). Captures the error state (`:796-804`).
3. After the await, `destroyed` / `readSeq` — OK (`:805`).
4. Dirty guard (`:806-820`) — OK. Fresh + different sha raises `stale`. Fresh + non-fresh `current.status` repairs status from `current` only. Then return. No mount.
5. `canEdit` / `editable` effect — OK (`:431-439`, `:555-557`, `codemirror-setup.ts:259-264`).
6. Save — OK (`:714-739`). Buffer text, loaded `sha256`.

Same-sha push race: `notifyDiskChange` sets `stale` and does not read (`:601-603`); step 4 does not clear it.

## Requirements fulfilment

| Requirement | Status | Gap |
| ----------- | ------ | --- |
| Fresh Retry repairs `error` to `fresh` and keeps the buffer | COMPLETE | `:816-818`, no `mountDocument`. Spec `:1028-1032`. |
| Repair does not adopt the new sha or bytes | COMPLETE | Spread is `current`. Spec save expects `SHA_A` (`:1035-1038`). |
| `baseState` still has the loaded hash on the error state | COMPLETE | `file-view-reader.service.ts:117-124`. `canEdit` can become true (`:431-439`). |
| Stale is raise-only | COMPLETE | `:812`. Spec `:1041-1059`. |
| Dirty fresh CI apply still keeps buffer and baseline | COMPLETE | Repair requires `current.status !== 'fresh'` (`:816`). |
| `discardEdits` still mounts | COMPLETE | Guard skipped (`:806`). |
| No new public API | COMPLETE | Same `reload` signature. |

Implicit requirements not addressed: none in this round. The pre-existing clean-path post-save baseline was left out on purpose.

## Edge cases

| Case | Handled | How | Concern |
| ---- | ------- | --- | ------- |
| Retry fresh, new sha, dirty error state | YES | `:812` then `:817` | Spec `:994-1038` |
| Retry fresh, same sha | YES | No `stale` write; status still repaired | Untested |
| Retry non-fresh | YES | `:811` skips writes; banner stays | Untested |
| Same-sha read after a newer push | YES | `:812` | Spec `:1041-1059` |
| Different sha, already fresh (CI) | YES | Raise `stale`, no `file.set` | Prior spec `:942-963` |
| `discardEdits` | YES | Branch not taken | Prior spec `:976-991` |
| `blocked` tab state | NO from the UI | Repair would run only if `reload()` were entered | Pre-existing; no Retry control |
| Superseded read / destroy | YES | `:805` before the new writes | |

## Checks and limitations

- No Jest, typecheck, lint, build, serve, or e2e. The parent owns the check slot. `pr804-product-revision.md` reports 53 passing tests after the fix. This lane did not re-run them.
- `ptah_*` tools are not connected. `search_tool` for `ptah_agent_report` and `ptah_code_search_symbols` returned no ptah tools. Evidence is the reads cited above. Native search was `grep` for `file.set`, `baseState`, `canEdit`, and `viewResult`.
- Electron, TUI, and VS Code hosts were not executed. The change stays inside `@ptah-extension/git-ui`.
- `code-style-review` was not in scope. No style findings are recorded here.

## Verdict

- Recommendation: APPROVE
- Confidence: HIGH on the two closed defects and on the repair not adopting `result`. MEDIUM on behaviour that only a re-run would show (the lane did not execute Jest).
- Top risk: none in this correction. A `blocked` result from confirmed Reload is still a screen without Retry; that path does not go through the new lines.
- What a robust implementation would add: nothing required before accept. Optional later: a same-sha Retry assertion, and a way off the blocked screen. Both are outside this correction.
