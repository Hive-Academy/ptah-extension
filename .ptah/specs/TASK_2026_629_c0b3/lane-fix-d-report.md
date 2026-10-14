# Fix D report

## Changes

1. **Workflow chip:** `workflow-card.component.ts:19,53-79,111` renders a static Electron label and the session lane hint; VS Code keeps the panel button and tab scoped request. `workflow-card.component.spec.ts:32-44` covers both hosts.
2. **Unknown Rail lane:** `canvas-detail.service.ts:45-64` returns `false` for an absent tile or lane, preserving focus and selection. It checks session ownership against the same agent stores used by lane tabs. `canvas-detail-transcript.component.ts:40,76-78` announces a rejected click in a visually hidden live region. `canvas-detail.service.spec.ts:64` and `canvas-detail-transcript.component.spec.ts:124-127` cover this case.
3. **Vacuous assertions:** Removed the dock null assertions from `canvas-detail-transcript.component.spec.ts` (former line 180) and `chat-transcript.component.spec.ts` (former line 1289).
4. **Cleanup:** Joined the import and removed the blank line in `display-dock.component.ts:24,31`; repaired the sentence in `chat-view.component.ts:1057`.

## Verification

All commands used `node .ptah/tmp/check-run.mjs <label> --` and scoped Nx tests with `--coverage=false --maxWorkers=2 --parallel=1 --skip-nx-cache`:

| Spec | Result |
| --- | --- |
| `workflow-card.component.spec.ts` | 1 suite, 2 tests passed |
| `chat-transcript.component.spec.ts` | 1 suite, 39 tests passed |
| `canvas-detail.service.spec.ts` | 1 suite, 6 tests passed |
| `canvas-detail-transcript.component.spec.ts` | 1 suite, 10 tests passed |

The first attempt to combine both chat specs in one `--testFile` argument failed in the Windows shell before Nx ran; each changed spec was then run separately. Scoped `ptah_get_diagnostics` returned unavailable after its 45 second TypeScript window, so it did not establish a typecheck result.

## Decisions

| Decision | Options | Evidence | Reversible |
| --- | --- | --- | --- |
| Keep the Electron workflow chip static | Static label (chosen); route to a workflow lane | Review finding 1 chose Option A; the VS Code panel request has no Electron consumer | Yes |
| Validate a lane before focusing | Validate in `open` (chosen); let lane tabs fall back | Review finding 3 and `canvas-lane-tabs.component.ts:100-175` show the same store data and fallback | Yes |
| Place the announcement in the transcript host | Host live region (chosen); use an existing region | No live region existed in this component; the host provides `SESSION_CARD_ACTIONS` | Yes |

## Not done

Finding 2, `agent-monitor.store.ts`, and the concurrently edited `canvas-rail` folder were outside this fix's scope. No build, broad suite, commit, or push was run.
